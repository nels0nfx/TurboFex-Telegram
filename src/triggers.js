'use strict';
const { adminOnly, isGroup } = require('./perms');
const { say, esc, mention, displayName, fill } = require('./util');

const MAX_FILTERS = 100;
const cooldown = new Map();
const keyRe = (kw) => new RegExp('(^|[^\\p{L}\\p{N}_])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}_])', 'iu');

function register(bot, store) {
  const vars = (u) => ({ mention: mention(u), name: esc(displayName(u)), id: String(u.id) });

  bot.command('setfilter', adminOnly, async (ctx) => {
    const m = /^(?:"([^"]{1,60})"|(\S{1,60}))\s+([\s\S]+)$/.exec(String(ctx.match || '').trim());
    if (!m) return say(ctx, 'Usage: <code>/setfilter keyword reply text</code>\nFor a keyword with spaces use quotes: <code>/setfilter "good morning" Morning {mention}!</code>\nPlaceholders: {mention} {name} {id}');
    const s = store.chat(ctx.chat.id);
    const kw = (m[1] || m[2]).toLowerCase();
    if (!s.filters[kw] && Object.keys(s.filters).length >= MAX_FILTERS) return say(ctx, `You already have ${MAX_FILTERS} filters. Remove one with /delfilter first.`);
    if (m[3].length > 3500) return say(ctx, 'That reply is too long. Keep it under 3500 characters.');
    s.filters[kw] = m[3];
    store.save();
    return say(ctx, `✅ Filter saved. When someone writes <b>${esc(kw)}</b> I will reply.`);
  });

  bot.command('filters', adminOnly, async (ctx) => {
    const keys = Object.keys(store.chat(ctx.chat.id).filters);
    return say(ctx, keys.length ? '🔎 <b>Filters</b>\n' + keys.map((k) => '• ' + esc(k)).join('\n') : 'No filters yet. Add one with /setfilter.');
  });

  bot.command(['delfilter', 'stop'], adminOnly, async (ctx) => {
    const kw = String(ctx.match || '').trim().replace(/^"|"$/g, '').toLowerCase();
    const s = store.chat(ctx.chat.id);
    if (!s.filters[kw]) return say(ctx, 'No filter with that keyword. Send /filters to see the list.');
    delete s.filters[kw];
    store.save();
    return say(ctx, '🗑 Filter removed.');
  });

  // #note triggers and keyword filters
  bot.on('message:text', async (ctx, next) => {
    if (!isGroup(ctx) || !ctx.from || ctx.from.is_bot) return next();
    const text = ctx.msg.text;
    if (text.startsWith('/')) return next();
    const s = store.chat(ctx.chat.id);
    const reply = { reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true } };
    if (text.startsWith('#')) {
      const key = text.slice(1).split(/\s/)[0].toLowerCase().slice(0, 32);
      if (key && s.faq[key]) { await say(ctx, fill(s.faq[key], vars(ctx.from)), reply); return; }
    }
    for (const kw of Object.keys(s.filters)) {
      if (!keyRe(kw).test(text)) continue;
      const ck = `${ctx.chat.id}:${kw}`;
      if (Date.now() - (cooldown.get(ck) || 0) < 15000) break;
      cooldown.set(ck, Date.now());
      if (cooldown.size > 2000) cooldown.clear();
      await say(ctx, fill(s.filters[kw], vars(ctx.from)), reply);
      return; // a filter answered: the AI stays quiet
    }
    return next();
  });
}

module.exports = { register };
