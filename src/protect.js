'use strict';
const { isGroup, isSenderAdmin } = require('./perms');
const actions = require('./actions');
const warnMod = require('./warn');
const { say, mention, displayName, autoDelete } = require('./util');

const LOCK_TYPES = {
  stickers: 'Stickers', gifs: 'GIFs', photos: 'Photos', videos: 'Videos', voice: 'Voice & audio', files: 'Files',
  forwards: 'Forwarded messages', polls: 'Polls', contacts: 'Contacts & locations', invites: 'Invite links', inline: 'Inline bots',
};
const INVITE = /(?:t(?:elegram)?\.me\/(?:\+|joinchat\/)|telegram\.dog\/joinchat)/i;

function lockHit(msg, locks) {
  const text = msg.text || msg.caption || '';
  const is = {
    stickers: !!msg.sticker, gifs: !!msg.animation, photos: !!msg.photo, videos: !!(msg.video || msg.video_note),
    voice: !!(msg.voice || msg.audio), files: !!msg.document && !msg.animation, forwards: !!msg.forward_origin,
    polls: !!msg.poll, contacts: !!(msg.contact || msg.location || msg.venue), invites: INVITE.test(text), inline: !!msg.via_bot,
  };
  return Object.keys(locks).find((k) => locks[k] && is[k]);
}

// ----- bad words: one cached regex per group -----
const reCache = new Map();
function wordsRegex(chatId, words) {
  const sig = words.join('\u0001');
  const hit = reCache.get(chatId);
  if (hit && hit.sig === sig) return hit.re;
  const alt = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('(^|[^\\p{L}\\p{N}_])(?:' + alt + ')($|[^\\p{L}\\p{N}_])', 'iu');
  reCache.set(chatId, { sig, re });
  return re;
}

// ----- flood control -----
const floods = new Map();
function floodHit(chatId, userId, text, spam) {
  const key = `${chatId}:${userId}`;
  const now = Date.now();
  let f = floods.get(key);
  if (!f) { f = { t: [], x: [] }; floods.set(key, f); }
  f.t = f.t.filter((t) => now - t < spam.seconds * 1000);
  f.t.push(now);
  const norm = (text || '').toLowerCase().slice(0, 200);
  if (norm) { f.x = f.x.filter((e) => now - e[0] < 60000); f.x.push([now, norm]); }
  if (floods.size > 5000) floods.clear();
  const reason = f.t.length > spam.limit ? 'flooding the chat'
    : (norm && f.x.filter((e) => e[1] === norm).length >= 4 ? 'repeating the same message' : null);
  if (reason) { f.t = []; f.x = []; }
  return reason;
}

function register(bot, store) {
  async function punish(ctx, s, v) {
    const chatId = ctx.chat.id;
    ctx.deleteMessage().catch(() => {});
    const target = { id: ctx.from.id, name: displayName(ctx.from) };
    let text;
    try {
      if (v.kind === 'spam') {
        if (s.antispam.action === 'warn') text = await warnMod.warn(ctx.api, store, chatId, target, v.reason);
        else if (s.antispam.action === 'kick') { await actions.kick(ctx.api, chatId, target.id); text = `👢 ${mention(ctx.from)} was removed (${v.reason}).`; }
        else { await actions.mute(ctx.api, chatId, target.id, 600); text = `🔇 ${mention(ctx.from)} muted for 10 minutes (${v.reason}).`; }
      } else if (v.kind === 'word') {
        text = await warnMod.warn(ctx.api, store, chatId, target, 'forbidden word');
      } else {
        text = `🚫 ${mention(ctx.from)}, ${v.reason}.`;
      }
    } catch (e) {
      console.error('protect:', e.description || e.message);
      return;
    }
    const n = await say(ctx, text);
    if (n) autoDelete(ctx.api, chatId, n.message_id, 10000);
  }

  bot.on('message', async (ctx, next) => {
    if (!isGroup(ctx) || !ctx.from || ctx.from.is_bot) return next();
    const msg = ctx.msg;
    if (!(msg.text || msg.caption || msg.sticker || msg.animation || msg.photo || msg.video || msg.video_note || msg.voice || msg.audio || msg.document || msg.poll || msg.contact || msg.location || msg.venue)) return next();
    const s = store.chat(ctx.chat.id);
    const lockOn = Object.keys(s.locks).some((k) => s.locks[k]);
    if (!s.antispam.enabled && !s.antimention.enabled && !s.words.length && !lockOn) return next();

    const text = msg.text || msg.caption || '';
    let v = null;
    const lock = lockOn && lockHit(msg, s.locks);
    if (lock) v = { kind: 'lock', reason: `${LOCK_TYPES[lock].toLowerCase()} are not allowed here` };
    if (!v && s.words.length && text && wordsRegex(ctx.chat.id, s.words).test(text)) v = { kind: 'word' };
    if (!v && s.antimention.enabled) {
      const mentions = [...(msg.entities || []), ...(msg.caption_entities || [])].filter((e) => e.type === 'mention' || e.type === 'text_mention');
      if (mentions.length > s.antimention.limit) v = { kind: 'mention', reason: 'please do not mention that many people at once' };
    }
    if (!v && s.antispam.enabled) {
      const reason = floodHit(ctx.chat.id, ctx.from.id, text, s.antispam);
      if (reason) v = { kind: 'spam', reason };
    }
    if (!v) return next();
    if (s.approved.includes(ctx.from.id) || (await isSenderAdmin(ctx))) return next();
    return punish(ctx, s, v);
  });
}

module.exports = { register, LOCK_TYPES };
