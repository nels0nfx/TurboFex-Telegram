'use strict';
const { adminOnly, ownerOnly } = require('./perms');
const { say, sayTo, esc } = require('./util');

// What can be sent somewhere else. "any": a channel or another group is fine; otherwise it must stay in the same group (a topic of it).
const PURPOSES = {
  releases: { label: 'Release news', any: true },
  announce: { label: 'Announcements', any: true },
  log: { label: 'Moderation log', any: true },
  schedule: { label: 'Scheduled messages', any: true },
  welcome: { label: 'Welcome & goodbye', any: false },
  giveaway: { label: 'Giveaways', any: false },
  reports: { label: 'Reports to admins', any: false },
  ai: { label: 'AI answers (only here)', any: false },
};
const GLOBAL = { announce: 'Announcements', releases: 'Release news' };

const threadOpt = (d) => (d && d.thread ? { message_thread_id: d.thread } : {});

function get(store, chatId, purpose) {
  const s = store.chat(chatId);
  if (s.dest && s.dest[purpose]) return s.dest[purpose];
  if (purpose === 'log' && s.log && s.log.chat) return { chat: s.log.chat, thread: 0 };
  return null;
}
const getGlobal = (store, purpose) => (store.data.settings.dest || {})[purpose] || null;

// Sends to the group's chosen place for this purpose (or the group itself)
async function send(api, store, chatId, purpose, html, extra = {}) {
  const d = get(store, chatId, purpose);
  if (!d) return sayTo(api, chatId, html, extra);
  const out = await sayTo(api, d.chat, html, { ...extra, ...threadOpt(d) });
  if (out || d.chat !== chatId) return out;
  return sayTo(api, chatId, html, extra); // the topic may be gone: fall back to the group itself
}

async function sendGlobal(api, store, purpose, html) {
  const d = getGlobal(store, purpose);
  return d ? sayTo(api, d.chat, html, threadOpt(d)) : null;
}

// Announcements go to every chosen group (to its announcement place) and to the global channel
async function announce(api, store, chatIds, text, includeChannel = true) {
  let ok = 0;
  for (const id of chatIds) if (await send(api, store, id, 'announce', text)) ok++;
  const channel = includeChannel && getGlobal(store, 'announce') ? !!(await sendGlobal(api, store, 'announce', text)) : false;
  return { ok, channel };
}

// "here" (this topic), a channel/group ID, @channel, or a t.me link
async function parseTarget(api, raw, ctx) {
  const t = String(raw || '').trim();
  if (!t || /^here$/i.test(t)) {
    if (!ctx || ctx.chat.type === 'private') throw new Error('Send it inside the topic or group you want, or give a channel ID, an @channel or a topic link.');
    return { chat: ctx.chat.id, thread: ctx.msg && ctx.msg.is_topic_message ? ctx.msg.message_thread_id : 0 };
  }
  let m;
  if ((m = /^https?:\/\/t\.me\/c\/(\d+)\/(\d+)/.exec(t))) return { chat: Number('-100' + m[1]), thread: Number(m[2]) };
  if ((m = /^https?:\/\/t\.me\/c\/(\d+)\/?$/.exec(t))) return { chat: Number('-100' + m[1]), thread: 0 };
  if (/^-?\d{5,}$/.test(t)) return { chat: Number(t), thread: 0 };
  if ((m = /^(?:https?:\/\/t\.me\/|@)([A-Za-z]\w{3,})(?:\/(\d+))?\/?$/.exec(t))) {
    const chat = await api.getChat('@' + m[1]).catch(() => null);
    if (!chat) throw new Error(`I cannot find @${m[1]}. Is it public and am I a member?`);
    return { chat: chat.id, thread: m[2] ? Number(m[2]) : 0 };
  }
  throw new Error('I did not understand that. Use "here", a channel ID, @channel or a topic link (https://t.me/c/…).');
}

const where = (d, origin) => (!d ? 'the group itself' : d.chat === origin ? (d.thread ? `topic ${d.thread}` : 'this group') : `${d.chat < 0 ? 'chat' : 'user'} ${d.chat}${d.thread ? ', topic ' + d.thread : ''}`);

async function connect(api, label, target) {
  const ok = await sayTo(api, target.chat, `✅ <b>${esc(label)}</b> will be posted here.`, threadOpt(target));
  if (!ok) throw new Error('I could not post there. Make me an admin of that channel or group (with permission to post) and check the topic link.');
}

async function setDest(api, store, origin, purpose, target) {
  const p = PURPOSES[purpose];
  if (!p) throw new Error('Unknown purpose. Choose: ' + Object.keys(PURPOSES).join(', '));
  if (!p.any && target.chat !== origin) throw new Error(`${p.label} must stay inside this group. Pick a topic of this group.`);
  await connect(api, p.label, target);
  const s = store.chat(origin);
  s.dest = s.dest || {};
  s.dest[purpose] = target;
  store.save();
}

async function setGlobal(api, store, purpose, target) {
  if (!GLOBAL[purpose]) throw new Error('Choose: ' + Object.keys(GLOBAL).join(' or '));
  await connect(api, GLOBAL[purpose], target);
  store.data.settings.dest = store.data.settings.dest || {};
  store.data.settings.dest[purpose] = target;
  store.save();
}

function register(bot, store) {
  const names = Object.keys(PURPOSES).join(', ');

  bot.command('setdest', adminOnly, async (ctx) => {
    const [purpose, ...rest] = String(ctx.match || '').trim().split(/\s+/);
    if (!purpose || !PURPOSES[purpose.toLowerCase()]) {
      return say(ctx, `📍 <b>Set where I post</b>\n<code>/setdest releases</code> inside a topic posts release news in that topic.\n<code>/setdest announce -1001234567890</code> posts announcements in a channel (I must be admin there).\nYou can also paste a topic link.\n\nPurposes: ${names}\nSee /dest, clear with /cleardest.`);
    }
    try {
      const target = await dest.parseTarget(ctx.api, rest.join(' '), ctx);
      await setDest(ctx.api, store, ctx.chat.id, purpose.toLowerCase(), target);
      return say(ctx, `✅ ${PURPOSES[purpose.toLowerCase()].label} will be posted in ${where(target, ctx.chat.id)}.`);
    } catch (e) { return say(ctx, '⚠️ ' + esc(e.message)); }
  });

  bot.command('dest', adminOnly, async (ctx) => {
    return say(ctx, '📍 <b>Where I post</b>\n' + Object.entries(PURPOSES).map(([k, p]) => `• ${p.label}: ${where(get(store, ctx.chat.id, k), ctx.chat.id)}`).join('\n') + '\n\n<code>/setdest purpose</code> (in a topic) · <code>/cleardest purpose</code>');
  });

  bot.command('cleardest', adminOnly, async (ctx) => {
    const p = String(ctx.match || '').trim().toLowerCase();
    const s = store.chat(ctx.chat.id);
    if (p === 'all') { s.dest = {}; store.save(); return say(ctx, '🗑 Everything posts in the group itself again.'); }
    if (!PURPOSES[p]) return say(ctx, `Usage: <code>/cleardest releases</code> or <code>/cleardest all</code>\nPurposes: ${names}`);
    if (s.dest) delete s.dest[p];
    store.save();
    return say(ctx, `🗑 ${PURPOSES[p].label} posts in the group itself again.`);
  });

  // ----- owner: channels for announcements and release news to all groups -----
  bot.command('setchannel', ownerOnly, async (ctx) => {
    const [purpose, ...rest] = String(ctx.match || '').trim().split(/\s+/);
    if (!GLOBAL[(purpose || '').toLowerCase()] || !rest.length) return say(ctx, 'Usage: <code>/setchannel announce -1001234567890</code>\nPurposes: announce, releases. Use a channel ID, @channel or a topic link. I must be admin there.');
    try {
      const target = await parseTarget(ctx.api, rest.join(' '), ctx.chat.type === 'private' ? null : ctx);
      await setGlobal(ctx.api, store, purpose.toLowerCase(), target);
      return say(ctx, `✅ ${GLOBAL[purpose.toLowerCase()]} will also be posted in ${where(target, 0)}.`);
    } catch (e) { return say(ctx, '⚠️ ' + esc(e.message)); }
  });
  bot.command('clearchannel', ownerOnly, async (ctx) => {
    const p = String(ctx.match || '').trim().toLowerCase();
    if (!GLOBAL[p]) return say(ctx, 'Usage: <code>/clearchannel announce</code> or <code>releases</code>');
    if (store.data.settings.dest) delete store.data.settings.dest[p];
    store.save();
    return say(ctx, `🗑 ${GLOBAL[p]} no longer go to a channel.`);
  });
  bot.command('channels', ownerOnly, async (ctx) => say(ctx, '📣 <b>Channels for all groups</b>\n' + Object.entries(GLOBAL).map(([k, l]) => `• ${l}: ${where(getGlobal(store, k), 0)}`).join('\n') + '\n\n<code>/setchannel announce -100…</code> · <code>/clearchannel announce</code>'));


}

const dest = { PURPOSES, GLOBAL, get, getGlobal, send, sendGlobal, announce, parseTarget, setDest, setGlobal, where, register };
module.exports = dest;
