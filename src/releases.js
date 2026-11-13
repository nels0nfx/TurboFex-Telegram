'use strict';
const cfg = require('./config');
const { adminOnly, ownerOnly } = require('./perms');
const { say, esc, onOff } = require('./util');
const ai = require('./ai');
const dest = require('./dest');

let cache = { t: 0, rel: null };
let etag = null;
let backoffUntil = 0;

// fresh = ask GitHub now (a conditional request: "nothing changed" answers are free and fast)
async function latest(fresh = false) {
  if (!fresh && Date.now() - cache.t < 600000) return cache.rel;
  if (Date.now() < backoffUntil) {
    if (fresh) throw new Error(`GitHub rate limit reached. I try again in ${Math.ceil((backoffUntil - Date.now()) / 60000)} minute(s).`);
    if (cache.rel) return cache.rel;
  }
  const headers = { 'User-Agent': 'TurboFex-Telegram-Bot', Accept: 'application/vnd.github+json' };
  if (cfg.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + cfg.GITHUB_TOKEN;
  if (fresh && etag) headers['If-None-Match'] = etag;
  const url = cfg.RELEASE_PRERELEASES ? `https://api.github.com/repos/${cfg.RELEASE_REPO}/releases?per_page=5` : `https://api.github.com/repos/${cfg.RELEASE_REPO}/releases/latest`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (r.status === 304) { cache.t = Date.now(); return cache.rel; }
  if (r.status === 404) { cache = { t: Date.now(), rel: null }; return null; }
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers && r.headers.get && r.headers.get('x-ratelimit-reset')) * 1000;
    backoffUntil = reset > Date.now() ? reset : Date.now() + 15 * 60000;
    throw new Error('GitHub rate limit reached (add GITHUB_TOKEN to config.env for a higher limit)');
  }
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  etag = (r.headers && r.headers.get && r.headers.get('etag')) || etag;
  let j = await r.json();
  if (Array.isArray(j)) j = j.find((x) => !x.draft);
  if (!j) { cache = { t: Date.now(), rel: null }; return null; }
  cache = { t: Date.now(), rel: { tag: j.tag_name, name: j.name || j.tag_name, body: j.body || '', url: j.html_url, at: j.published_at } };
  return cache.rel;
}

function format(rel, head) {
  const body = rel.body.replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 1400);
  return `${head} <b>${esc(rel.name)}</b>${rel.at ? ' · ' + esc(rel.at.slice(0, 10)) : ''}\n${body ? '\n' + ai.toHtml(body) + '\n' : ''}\n${esc(rel.url)}`;
}

async function announceRelease(api, store, rel) {
  const text = format(rel, '🚀 New release:');
  for (const id of store.chatIds()) if (store.chat(id).releases) await dest.send(api, store, id, 'releases', text);
  await dest.sendGlobal(api, store, 'releases', text);
}

// Looks at GitHub now. Announces a release the bot has not announced yet (force = announce the latest again).
async function checkNow(api, store, { force = false } = {}) {
  const rel = await latest(true);
  if (!rel) return { rel: null, announced: false, first: false };
  const st = store.data.settings;
  const seen = st.releaseSeen;
  st.releaseSeen = rel.tag;
  store.save();
  const isNew = !!seen && seen !== rel.tag;
  if (isNew || force) { await announceRelease(api, store, rel); return { rel, announced: true, first: !seen }; }
  return { rel, announced: false, first: !seen };
}

function register(bot, store) {
  bot.command('changelog', async (ctx) => {
    try {
      const rel = await latest();
      return say(ctx, rel ? format(rel, '📦 Latest release:') : 'No release has been published yet.');
    } catch (e) { return say(ctx, '⚠️ I could not reach GitHub right now. Try again later.'); }
  });

  bot.command('releases', adminOnly, async (ctx) => {
    const s = store.chat(ctx.chat.id);
    const v = onOff(String(ctx.match || '').trim().split(/\s+/)[0]);
    if (v === null) return say(ctx, `📦 Release news are ${s.releases ? 'on' : 'off'} in this group (source: <code>${esc(cfg.RELEASE_REPO)}</code>, checked every ${cfg.RELEASE_CHECK_MINUTES} minutes).\n<code>/releases on</code> · <code>/releases off</code> · members can use /changelog`);
    s.releases = v;
    store.save();
    return say(ctx, v ? '✅ I will post here when a new release is published.' : '⛔ Release news are off.');
  });

  // owner: look at GitHub right now ("post" announces the latest release again, handy for testing)
  bot.command('releasecheck', ownerOnly, async (ctx) => {
    const force = /post/i.test(String(ctx.match || ''));
    try {
      const r = await checkNow(ctx.api, store, { force });
      if (!r.rel) return say(ctx, `No release found in <code>${esc(cfg.RELEASE_REPO)}</code>. Publish one on GitHub (a draft does not count).`);
      return say(ctx, r.announced ? `✅ Announced <b>${esc(r.rel.name)}</b> in the groups with release news on${dest.getGlobal(store, 'releases') ? ' and in the release channel' : ''}.`
        : `Latest release: <b>${esc(r.rel.name)}</b>. ${r.first ? 'I remember it now; the next new release will be announced.' : 'It was already announced.'}\nSend <code>/releasecheck post</code> to announce it again.`);
    } catch (e) { return say(ctx, '⚠️ ' + esc(e.message)); }
  });
}

// Checks GitHub every few minutes and announces new releases in the groups that switched it on
function start(api, store) {
  const check = () => checkNow(api, store).catch((e) => console.error('releases:', e.message));
  setTimeout(check, 30000).unref();
  setInterval(check, cfg.RELEASE_CHECK_MINUTES * 60000).unref();
}

module.exports = { register, start, latest, format, checkNow };
