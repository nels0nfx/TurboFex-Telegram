'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { InlineKeyboard } = require('grammy');
const cfg = require('./config');
const { ownerOnly, isOwner } = require('./perms');
const { say, sayTo, esc, onOff } = require('./util');

const ROOT = cfg.ROOT;
const UPD = path.join(ROOT, '.update');
const BACKUP = path.join(UPD, 'backup');
const PENDING = path.join(UPD, 'pending.json');
const ROLLED = path.join(UPD, 'rolledback.json');
// Never touched by an update
const SKIP = [/^data\//, /^config\.env$/, /^\.env$/, /^node_modules\//, /^\.git\//, /^\.update\//, /^OWNER_PREFERENCES\.private\.md$/];

let busy = false;
const supervised = () => !!process.env.TFX_SUPERVISED;

const localPkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function cmpVer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

async function gh(url, accept) {
  const headers = { 'User-Agent': 'TurboFex-Telegram-Updater', Accept: accept };
  if (cfg.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + cfg.GITHUB_TOKEN;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { const e = new Error('GitHub answered ' + r.status); e.status = r.status; throw e; }
  return r;
}

async function remotePackage() {
  const r = await gh(`https://api.github.com/repos/${cfg.UPDATE_REPO}/contents/package.json?ref=${encodeURIComponent(cfg.UPDATE_BRANCH)}`, 'application/vnd.github.raw+json');
  return JSON.parse(await r.text());
}

function explain(e) {
  if (e && e.status === 404) return 'I could not find the repository or branch. If the repository is private, add GITHUB_TOKEN to config.env.';
  if (e && (e.status === 401 || e.status === 403)) return 'GitHub refused the request (rate limit or a wrong GITHUB_TOKEN). Try again later.';
  return (e && e.message) || String(e);
}

// Minimal tar reader (GitHub tarballs), no dependencies needed.
function untar(buf) {
  const out = [];
  let off = 0;
  let paxPath = null;
  const str = (o, a, l) => buf.toString('utf8', o + a, o + a + l).replace(/\0[\s\S]*$/, '');
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every((b) => b === 0)) break;
    const name = str(off, 0, 100);
    const size = parseInt(str(off, 124, 12).trim() || '0', 8) || 0;
    const type = str(off, 156, 1) || '0';
    const prefix = str(off, 345, 155);
    off += 512;
    const data = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
    if (type === 'g') continue;
    if (type === 'x') {
      let p = 0;
      while (p < data.length) {
        const sp = data.indexOf(0x20, p);
        const len = parseInt(data.toString('utf8', p, sp), 10);
        if (!len) break;
        const rec = data.toString('utf8', sp + 1, p + len - 1);
        const eq = rec.indexOf('=');
        if (rec.slice(0, eq) === 'path') paxPath = rec.slice(eq + 1);
        p += len;
      }
      continue;
    }
    const full = paxPath || (prefix ? prefix + '/' + name : name);
    paxPath = null;
    if (type === '0') out.push({ path: full, data: Buffer.from(data) });
  }
  return out;
}

function checkSyntax(files) {
  for (const [rel, data] of files) {
    if (!rel.endsWith('.js')) continue;
    try {
      new vm.Script('(function (exports, require, module, __filename, __dirname) {' + data.toString('utf8') + '\n})', { filename: rel });
    } catch (e) {
      throw new Error(`The new ${rel} has a syntax error (${e.message}). Nothing was changed.`);
    }
  }
}

function walk(dir, base = '') {
  let out = [];
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(base, n.name);
    out = n.isDirectory() ? out.concat(walk(path.join(dir, n.name), rel)) : out.concat(rel);
  }
  return out;
}

function backupVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(BACKUP, 'meta.json'), 'utf8')).version; } catch (e) { return null; }
}

function restore() {
  const dir = path.join(BACKUP, 'files');
  if (!fs.existsSync(dir)) return false;
  for (const rel of walk(dir)) {
    const dst = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(dir, rel), dst);
  }
  return true;
}

async function install() {
  const r = await gh(`https://api.github.com/repos/${cfg.UPDATE_REPO}/tarball/${encodeURIComponent(cfg.UPDATE_BRANCH)}`, 'application/vnd.github+json');
  const gz = Buffer.from(await r.arrayBuffer());
  if (gz.length > 20 * 1024 * 1024) throw new Error('The download is unexpectedly large, so I did not install it.');

  const files = new Map();
  for (const e of untar(zlib.gunzipSync(gz))) {
    const rel = e.path.split('/').slice(1).join('/');
    if (!rel || rel.includes('..') || path.isAbsolute(rel) || SKIP.some((re) => re.test(rel))) continue;
    files.set(rel, e.data);
  }
  for (const need of ['index.js', 'package.json', 'src/main.js']) {
    if (!files.has(need)) throw new Error(`The repository has no ${need}, so I did not update.`);
  }
  const newPkg = JSON.parse(files.get('package.json').toString('utf8'));
  checkSyntax(files);

  const oldPkg = localPkg();
  fs.rmSync(BACKUP, { recursive: true, force: true });
  fs.mkdirSync(BACKUP, { recursive: true });
  for (const rel of files.keys()) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(BACKUP, 'files', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  fs.writeFileSync(path.join(BACKUP, 'meta.json'), JSON.stringify({ version: oldPkg.version }));
  fs.writeFileSync(PENDING, JSON.stringify({ from: oldPkg.version, to: newPkg.version, at: Date.now(), notified: false }));

  try {
    for (const [rel, data] of files) {
      const dst = path.join(ROOT, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, data);
    }
    if (JSON.stringify(oldPkg.dependencies || {}) !== JSON.stringify(newPkg.dependencies || {})) {
      execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ROOT, timeout: 180000, stdio: 'pipe' });
    }
  } catch (e) {
    restore();
    fs.rmSync(PENDING, { force: true });
    throw new Error('The update failed and was undone: ' + String((e && e.message) || e).slice(0, 200));
  }
  return { from: oldPkg.version, to: newPkg.version };
}

const notifyOwners = (api, text) => Promise.all(cfg.OWNER_IDS.map((id) => sayTo(api, id, text)));

function restartSoon(store) {
  store.flush();
  setTimeout(() => process.exit(42), 800);
}

function register(bot, store) {
  store.data.settings = store.data.settings || {};

  const edit = (ctx, msg, text, kb) => ctx.api.editMessageText(ctx.chat.id, msg.message_id, text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});

  bot.command('version', ownerOnly, async (ctx) => {
    const auto = store.data.settings.autoUpdate ? 'on' : 'off';
    return say(ctx, `🤖 <b>TurboFex Telegram Bot</b> v${esc(localPkg().version)}\nSource: <code>${esc(cfg.UPDATE_REPO)}</code> (${esc(cfg.UPDATE_BRANCH)})\nAuto-update: ${auto}\nSelf-restart: ${supervised() ? 'yes' : 'no (restart from the panel after updates)'}`);
  });

  bot.command('update', ownerOnly, async (ctx) => {
    if (ctx.chat.type !== 'private') return say(ctx, 'Please send /update in a private chat with me.');
    if (busy) return say(ctx, 'An update is already running.');
    const force = /force/i.test(String(ctx.match || ''));
    const m = await say(ctx, '🔎 Checking GitHub...');
    if (!m) return;
    try {
      const remote = await remotePackage();
      const cur = localPkg().version;
      const newer = cmpVer(remote.version, cur) > 0;
      if (!newer && !force) return edit(ctx, m, `✅ Up to date (v${esc(cur)}).\nChanged files on GitHub without a new version number? Send <code>/update force</code>.`);
      const kb = new InlineKeyboard().text('⬇️ Install & restart', 'up:go').text('Cancel', 'up:no');
      return edit(ctx, m, newer
        ? `🆕 <b>v${esc(remote.version)}</b> is available (you have v${esc(cur)}).\nInstall it now? I will restart by myself.`
        : `You are on v${esc(cur)}. Reinstall the current GitHub files anyway?`, kb);
    } catch (e) {
      return edit(ctx, m, '❌ ' + esc(explain(e)));
    }
  });

  bot.command('rollback', ownerOnly, async (ctx) => {
    if (ctx.chat.type !== 'private') return say(ctx, 'Please send /rollback in a private chat with me.');
    const v = backupVersion();
    if (!v) return say(ctx, 'There is no previous version saved yet.');
    const kb = new InlineKeyboard().text(`↩️ Go back to v${v}`, 'up:rb').text('Cancel', 'up:no');
    return say(ctx, `Restore the previous version <b>v${esc(v)}</b> and restart?\nAuto-update will be switched off so it does not install the newer one again.`, { reply_markup: kb });
  });

  bot.command('autoupdate', ownerOnly, async (ctx) => {
    const v = onOff(String(ctx.match || '').trim());
    if (v === null) {
      return say(ctx, `Auto-update is <b>${store.data.settings.autoUpdate ? 'ON' : 'OFF'}</b> (checks every ${cfg.AUTO_UPDATE_HOURS}h).\nUse <code>/autoupdate on</code> or <code>/autoupdate off</code>.\nWhen on, anything you push to the <code>${esc(cfg.UPDATE_BRANCH)}</code> branch with a higher version number is installed automatically.`);
    }
    store.data.settings.autoUpdate = v;
    store.save();
    return say(ctx, v ? `✅ Auto-update is on. I check GitHub every ${cfg.AUTO_UPDATE_HOURS}h and tell you when I update.` : '⛔ Auto-update is off. Use /update to update by hand.');
  });

  bot.callbackQuery(/^up:(go|no|rb)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Owner only.', show_alert: true });
    const act = ctx.match[1];
    await ctx.answerCallbackQuery();
    if (act === 'no') return ctx.editMessageText('Cancelled.').catch(() => {});
    if (busy) return;
    busy = true;
    try {
      if (act === 'rb') {
        const v = backupVersion();
        if (!v || !restore()) throw new Error('There is no previous version saved.');
        fs.rmSync(PENDING, { force: true });
        store.data.settings.autoUpdate = false;
        await ctx.editMessageText(`↩️ Restored v${esc(v)}.${supervised() ? ' Restarting...' : ' Please restart the server from the panel.'}`, { parse_mode: 'HTML' }).catch(() => {});
        if (supervised()) restartSoon(store); else store.flush();
      } else {
        await ctx.editMessageText('⏳ Downloading and checking the new version...').catch(() => {});
        const r = await install();
        await ctx.editMessageText(`✅ Installed v${esc(r.to)} (was v${esc(r.from)}).${supervised() ? ' Restarting...' : ' Please restart the server from the panel to run it.'}`, { parse_mode: 'HTML' }).catch(() => {});
        if (supervised()) restartSoon(store);
      }
    } catch (e) {
      await ctx.editMessageText('❌ ' + esc(explain(e))).catch(() => {});
    } finally {
      busy = false;
    }
  });
}

function startAuto(api, store) {
  const tick = async () => {
    if (!store.data.settings.autoUpdate || busy) return;
    busy = true;
    try {
      const remote = await remotePackage();
      if (cmpVer(remote.version, localPkg().version) > 0) {
        const r = await install();
        await notifyOwners(api, `🔄 Auto-update: v${r.from} → v${r.to}.${supervised() ? ' Restarting now...' : ' Restart the server from the panel to run it.'}`);
        if (supervised()) restartSoon(store);
      }
    } catch (e) {
      console.error('auto-update:', explain(e));
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 120000).unref();
  setInterval(tick, Math.max(1, cfg.AUTO_UPDATE_HOURS) * 3600 * 1000).unref();
}

// Called once the bot is online: report what happened with the last update, start the auto-update timer.
function onBoot(api, store) {
  store.data.settings = store.data.settings || {};
  try {
    if (fs.existsSync(ROLLED)) {
      const r = JSON.parse(fs.readFileSync(ROLLED, 'utf8'));
      fs.rmSync(ROLLED, { force: true });
      store.data.settings.autoUpdate = false;
      store.save();
      notifyOwners(api, `⚠️ The update to v${r.to} kept crashing, so I went back to v${r.from}. Auto-update is now off. Check the panel console for the error.`);
    } else if (fs.existsSync(PENDING)) {
      const p = JSON.parse(fs.readFileSync(PENDING, 'utf8'));
      if (!p.notified) {
        p.notified = true;
        fs.writeFileSync(PENDING, JSON.stringify(p));
        notifyOwners(api, `✅ Running v${p.to} now (updated from v${p.from}).`);
      }
      setTimeout(() => fs.rmSync(PENDING, { force: true }), 45000).unref();
    }
  } catch (e) {
    console.error('update status:', e.message);
  }
  startAuto(api, store);
}

module.exports = { register, onBoot, untar, cmpVer, checkSyntax, install };
