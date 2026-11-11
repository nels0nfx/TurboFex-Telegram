'use strict';
const cfg = require('./config');
const { adminOnly } = require('./perms');
const { say, sayTo, esc, onOff } = require('./util');
const ai = require('./ai');

let cache = { t: 0, rel: null };

async function latest() {
  if (Date.now() - cache.t < 600000) return cache.rel;
  const headers = { 'User-Agent': 'TurboFex-Telegram-Bot', Accept: 'application/vnd.github+json' };
  if (cfg.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + cfg.GITHUB_TOKEN;
  const r = await fetch(`https://api.github.com/repos/${cfg.RELEASE_REPO}/releases/latest`, { headers, signal: AbortSignal.timeout(20000) });
  if (r.status === 404) { cache = { t: Date.now(), rel: null }; return null; }
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const j = await r.json();
  cache = { t: Date.now(), rel: { tag: j.tag_name, name: j.name || j.tag_name, body: j.body || '', url: j.html_url, at: j.published_at } };
  return cache.rel;
}

function format(rel, head) {
  const body = rel.body.replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 1400);
  return `${head} <b>${esc(rel.name)}</b>${rel.at ? ' · ' + esc(rel.at.slice(0, 10)) : ''}\n${body ? '\n' + ai.toHtml(body) + '\n' : ''}\n${esc(rel.url)}`;
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
    if (v === null) return say(ctx, `📦 Release news are ${s.releases ? 'on' : 'off'} in this group (source: <code>${esc(cfg.RELEASE_REPO)}</code>).\n<code>/releases on</code> · <code>/releases off</code> · members can use /changelog`);
    s.releases = v;
    store.save();
    return say(ctx, v ? '✅ I will post here when a new release is published.' : '⛔ Release news are off.');
  });
}

// Checks GitHub every few hours and announces a new release in the groups that switched it on
function start(api, store) {
  const check = async () => {
    try {
      cache.t = 0;
      const rel = await latest();
      if (!rel) return;
      const seen = store.data.settings.releaseSeen;
      store.data.settings.releaseSeen = rel.tag;
      store.save();
      if (!seen || seen === rel.tag) return; // first run only remembers the current release
      for (const id of store.chatIds()) if (store.chat(id).releases) await sayTo(api, id, format(rel, '🚀 New release:'));
    } catch (e) { console.error('releases:', e.message); }
  };
  setTimeout(check, 60000).unref();
  setInterval(check, Math.max(1, cfg.RELEASE_CHECK_HOURS) * 3600000).unref();
}

module.exports = { register, start, latest, format };
