'use strict';
const { adminOnly, isGroup } = require('./perms');
const { defaults } = require('./store');
const actions = require('./actions');
const { LOCK_TYPES } = require('./protect');
const { say, esc, mention, mentionOf, displayName, getTarget, onOff, autoDelete } = require('./util');

const adminCache = new Map();
async function adminList(api, chatId) {
  const hit = adminCache.get(chatId);
  if (hit && Date.now() - hit.t < 60000) return hit.list;
  const list = await api.getChatAdministrators(chatId);
  adminCache.set(chatId, { t: Date.now(), list });
  return list;
}
const reported = new Map();

function register(bot, store) {
  const chatOf = (ctx) => store.chat(ctx.chat.id);
  const yn = (v) => (v ? '✅ on' : '⛔ off');
  const noTarget = (ctx) => say(ctx, "Reply to a user's message, or give their numeric ID.");

  function toggle(name, label, get, set) {
    bot.command(name, adminOnly, async (ctx) => {
      const v = onOff(String(ctx.match || '').trim().split(/\s+/)[0]);
      if (v === null) return say(ctx, `${label} is ${yn(get(chatOf(ctx)))}.\nUse <code>/${name} on</code> or <code>/${name} off</code>.`);
      set(chatOf(ctx), v);
      store.save();
      return say(ctx, `${v ? '✅' : '⛔'} ${label} ${v ? 'enabled' : 'disabled'}.`);
    });
  }
  toggle('antibot', 'Anti-bot (only admins can add bots)', (s) => s.antibot, (s, v) => { s.antibot = v; });
  toggle('cleanservice', 'Clean join/leave messages', (s) => s.cleanService, (s, v) => { s.cleanService = v; });
  toggle('goodbye', 'Goodbye message', (s) => s.goodbye.enabled, (s, v) => { s.goodbye.enabled = v; });

  bot.command('setgoodbye', adminOnly, async (ctx) => {
    const text = String(ctx.match || '').trim();
    if (!text) return say(ctx, 'Usage: <code>/setgoodbye your text</code>\nPlaceholders: <code>{mention}</code> <code>{name}</code> <code>{chat}</code> <code>{id}</code>\n\n<b>Current:</b>\n' + esc(chatOf(ctx).goodbye.text));
    if (text.length > 3500) return say(ctx, 'That is too long. Keep it under 3500 characters.');
    chatOf(ctx).goodbye.text = text;
    store.save();
    return say(ctx, '✅ Goodbye message updated. Switch it on with /goodbye on.');
  });

  bot.command('getwelcome', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    return say(ctx, `👋 <b>Welcome message</b> (${s.welcome.enabled ? 'on' : 'off'})\n<code>${esc(s.welcome.text)}</code>`);
  });

  bot.command('delwelcome', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    s.welcome.text = defaults().welcome.text;
    s.welcome.enabled = false;
    store.save();
    return say(ctx, '🗑 Welcome message reset to the default and switched off.');
  });

  bot.command('antispam', adminOnly, async (ctx) => {
    const a = String(ctx.match || '').trim().split(/\s+/);
    const s = chatOf(ctx).antispam;
    const sub = (a[0] || '').toLowerCase();
    const v = onOff(sub);
    if (v !== null) { s.enabled = v; store.save(); return say(ctx, `${v ? '✅' : '⛔'} Anti-spam ${v ? 'on' : 'off'} (${s.limit} messages in ${s.seconds}s → ${s.action}).`); }
    if (sub === 'limit') {
      const n = Number(a[1]);
      const t = Number(a[2] || s.seconds);
      if (!Number.isInteger(n) || n < 2 || n > 30 || !(t >= 2 && t <= 60)) return say(ctx, 'Usage: <code>/antispam limit 5 8</code> (5 messages in 8 seconds)');
      s.limit = n; s.seconds = Math.round(t); store.save();
      return say(ctx, `✅ Limit: ${s.limit} messages in ${s.seconds} seconds.`);
    }
    if (sub === 'action') {
      const x = (a[1] || '').toLowerCase();
      if (!['mute', 'warn', 'kick'].includes(x)) return say(ctx, 'Usage: <code>/antispam action mute</code>, <code>warn</code> or <code>kick</code>');
      s.action = x; store.save();
      return say(ctx, `✅ Flooders will be: <b>${x}</b>${x === 'mute' ? ' (10 minutes)' : ''}.`);
    }
    return say(ctx, `🌊 <b>Anti-spam</b> is ${yn(s.enabled)}\n${s.limit} messages in ${s.seconds}s (or the same message 4 times in a minute) → ${s.action}\n\n<code>/antispam on|off</code>\n<code>/antispam limit 5 8</code>\n<code>/antispam action mute|warn|kick</code>`);
  });

  bot.command('antimention', adminOnly, async (ctx) => {
    const a = String(ctx.match || '').trim().split(/\s+/);
    const s = chatOf(ctx).antimention;
    const sub = (a[0] || '').toLowerCase();
    const v = onOff(sub);
    if (v !== null) { s.enabled = v; store.save(); return say(ctx, `${v ? '✅' : '⛔'} Anti-mention ${v ? 'on' : 'off'} (max ${s.limit} mentions per message).`); }
    if (sub === 'limit') {
      const n = Number(a[1]);
      if (!Number.isInteger(n) || n < 1 || n > 30) return say(ctx, 'Usage: <code>/antimention limit 5</code>');
      s.limit = n; store.save();
      return say(ctx, `✅ Messages with more than ${n} mentions are deleted.`);
    }
    return say(ctx, `📣 <b>Anti-mention</b> is ${yn(s.enabled)}\nMessages with more than ${s.limit} @mentions are deleted. Telegram does not let bots check whether an @username belongs to a member, so this stops tag-spam rather than single mentions.\n\n<code>/antimention on|off</code>\n<code>/antimention limit 5</code>`);
  });

  // ----- locks -----
  const lockNames = () => Object.keys(LOCK_TYPES).join(', ');
  bot.command('lock', adminOnly, async (ctx) => {
    const t = String(ctx.match || '').trim().toLowerCase();
    if (!LOCK_TYPES[t]) return say(ctx, `Usage: <code>/lock stickers</code>\nTypes: ${lockNames()}`);
    chatOf(ctx).locks[t] = true; store.save();
    return say(ctx, `🔒 ${LOCK_TYPES[t]} are now locked. Admins and approved users can still send them.`);
  });
  bot.command('unlock', adminOnly, async (ctx) => {
    const t = String(ctx.match || '').trim().toLowerCase();
    const s = chatOf(ctx);
    if (t === 'all') { s.locks = {}; store.save(); return say(ctx, '🔓 Everything is unlocked.'); }
    if (!LOCK_TYPES[t]) return say(ctx, `Usage: <code>/unlock stickers</code> or <code>/unlock all</code>\nTypes: ${lockNames()}`);
    delete s.locks[t]; store.save();
    return say(ctx, `🔓 ${LOCK_TYPES[t]} are unlocked.`);
  });
  bot.command('locks', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    return say(ctx, '🔒 <b>Locks</b>\n' + Object.entries(LOCK_TYPES).map(([k, label]) => `${s.locks[k] ? '🔒' : '🔓'} ${label} (<code>${k}</code>)`).join('\n'));
  });

  // ----- bad words -----
  bot.command('addword', adminOnly, async (ctx) => {
    const list = String(ctx.match || '').toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 2 && w.length <= 40);
    if (!list.length) return say(ctx, 'Usage: <code>/addword word1 word2</code>');
    const s = chatOf(ctx);
    let added = 0;
    for (const w of list) if (!s.words.includes(w) && s.words.length < 200) { s.words.push(w); added++; }
    store.save();
    ctx.deleteMessage().catch(() => {}); // do not leave the word in the chat
    const n = await say(ctx, `✅ Added ${added} word(s). Messages with them are deleted and the sender is warned.`);
    if (n) autoDelete(ctx.api, ctx.chat.id, n.message_id, 6000);
  });
  bot.command('delword', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    const arg = String(ctx.match || '').trim().toLowerCase();
    if (arg === 'all') { s.words = []; store.save(); return say(ctx, '🗑 All bad words removed.'); }
    const list = arg.split(/[\s,]+/).filter(Boolean);
    if (!list.length) return say(ctx, 'Usage: <code>/delword word</code> or <code>/delword all</code>');
    s.words = s.words.filter((w) => !list.includes(w));
    store.save();
    return say(ctx, '🗑 Removed.');
  });
  bot.command('words', adminOnly, async (ctx) => {
    const w = chatOf(ctx).words;
    return say(ctx, w.length ? `🚫 <b>Bad words (${w.length})</b>\n<tg-spoiler>${esc(w.join(', ').slice(0, 3000))}</tg-spoiler>` : 'No bad words set. Add some with /addword.');
  });

  // ----- approved users (exempt from filters) -----
  bot.command('approve', adminOnly, async (ctx) => {
    const { target } = getTarget(ctx);
    if (!target) return noTarget(ctx);
    const s = chatOf(ctx);
    if (!s.approved.includes(target.id)) { if (s.approved.length >= 200) return say(ctx, 'You already have 200 approved users.'); s.approved.push(target.id); store.save(); }
    return say(ctx, `✅ ${mentionOf(target)} is approved: link, spam, word, mention and lock rules do not apply to them.`);
  });
  bot.command('unapprove', adminOnly, async (ctx) => {
    const { target } = getTarget(ctx);
    if (!target) return noTarget(ctx);
    const s = chatOf(ctx);
    s.approved = s.approved.filter((id) => id !== target.id);
    store.save();
    return say(ctx, `✅ ${mentionOf(target)} is no longer approved.`);
  });
  bot.command('approved', adminOnly, async (ctx) => {
    const a = chatOf(ctx).approved;
    return say(ctx, a.length ? '✅ <b>Approved users</b>\n' + a.map((id) => `<a href="tg://user?id=${id}">${id}</a>`).join('\n') : 'Nobody is approved.');
  });

  // ----- warnings -----
  bot.command('clearwarns', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    if (/^all$/i.test(String(ctx.match || '').trim())) { s.warns = {}; store.save(); return say(ctx, '🧹 All warnings removed.'); }
    const { target } = getTarget(ctx);
    if (!target) return say(ctx, 'Reply to a user, give their ID, or send <code>/clearwarns all</code>.');
    delete s.warns[String(target.id)]; store.save();
    return say(ctx, `🧹 Warnings of ${mentionOf(target)} removed.`);
  });

  bot.command('warnsettings', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    const a = String(ctx.match || '').trim().split(/\s+/);
    if ((a[0] || '').toLowerCase() === 'limit') {
      const n = Number(a[1]);
      if (!Number.isInteger(n) || n < 1 || n > 20) return say(ctx, 'Usage: <code>/warnsettings limit 3</code> (1 to 20)');
      s.warnLimit = n; store.save();
    } else if ((a[0] || '').toLowerCase() === 'action') {
      const x = (a[1] || '').toLowerCase();
      if (!['mute', 'kick', 'ban'].includes(x)) return say(ctx, 'Usage: <code>/warnsettings action mute</code>, <code>kick</code> or <code>ban</code>');
      s.warnAction = x; store.save();
    }
    return say(ctx, `⚠️ <b>Warn settings</b>\nLimit: ${s.warnLimit}\nAt the limit: ${s.warnAction}${s.warnAction === 'mute' ? ' (24h)' : ''}\nUsers with warnings: ${Object.keys(s.warns).length}\n\n<code>/warnsettings limit 3</code>\n<code>/warnsettings action mute|kick|ban</code>\n<code>/clearwarns</code> (reply) or <code>/clearwarns all</code>`);
  });

  // ----- cleanup and info -----
  bot.command('purge', adminOnly, async (ctx) => {
    const r = ctx.msg.reply_to_message;
    if (!r || r.forum_topic_created) return say(ctx, 'Reply to the first message you want to delete. Everything from there up to your command is removed.');
    const from = r.message_id;
    const to = ctx.msg.message_id;
    if (to - from > 300) return say(ctx, 'That is more than 300 messages. Reply to a newer message.');
    const ids = [];
    for (let i = from; i <= to; i++) ids.push(i);
    try {
      for (let i = 0; i < ids.length; i += 100) await ctx.api.deleteMessages(ctx.chat.id, ids.slice(i, i + 100));
    } catch (e) { return say(ctx, '⚠️ ' + esc(actions.explain(e))); }
    const n = await ctx.api.sendMessage(ctx.chat.id, '🧹 Cleaned up.', { message_thread_id: ctx.msg.message_thread_id }).catch(() => null);
    if (n) autoDelete(ctx.api, ctx.chat.id, n.message_id, 4000);
  });

  bot.command('info', adminOnly, async (ctx) => {
    const { target } = getTarget(ctx);
    const t = target || { id: ctx.from.id, name: displayName(ctx.from) };
    let status = 'not in this group';
    let user = null;
    try { const m = await ctx.api.getChatMember(ctx.chat.id, t.id); status = m.status; user = m.user; } catch (e) { /* unknown user */ }
    const s = chatOf(ctx);
    return say(ctx, [
      `ℹ️ ${mentionOf(user ? { id: user.id, name: displayName(user) } : t)}`,
      `ID: <code>${t.id}</code>`,
      user && user.username ? `Username: @${esc(user.username)}` : null,
      `Status: ${status}`,
      `Warnings: ${s.warns[String(t.id)] || 0}/${s.warnLimit}`,
      `Approved: ${s.approved.includes(t.id) ? 'yes' : 'no'}`,
    ].filter(Boolean).join('\n'));
  });

  // ----- for everyone -----
  bot.command('admins', async (ctx) => {
    if (!isGroup(ctx)) return;
    try {
      const list = (await adminList(ctx.api, ctx.chat.id)).filter((a) => !a.user.is_bot);
      return say(ctx, '👮 <b>Admins</b>\n' + list.map((a) => `• ${mention(a.user)}${a.status === 'creator' ? ' (owner)' : ''}`).join('\n'));
    } catch (e) { /* no rights to list admins */ }
  });

  bot.command('report', async (ctx) => {
    if (!isGroup(ctx) || !ctx.from) return;
    const key = `${ctx.chat.id}:${ctx.from.id}`;
    if (Date.now() - (reported.get(key) || 0) < 60000) return;
    reported.set(key, Date.now());
    if (reported.size > 2000) reported.clear();
    try {
      const admins = (await adminList(ctx.api, ctx.chat.id)).filter((a) => !a.user.is_bot).slice(0, 8);
      const r = ctx.msg.reply_to_message;
      const link = r && String(ctx.chat.id).startsWith('-100') ? `\nhttps://t.me/c/${String(ctx.chat.id).slice(4)}/${r.message_id}` : '';
      const about = r && r.from ? ` about ${mention(r.from)}` : '';
      const extra = String(ctx.match || '').trim();
      await say(ctx, `🚨 <b>Report</b> by ${mention(ctx.from)}${about}${extra ? '\n' + esc(extra.slice(0, 300)) : ''}${link}\n${admins.map((a) => mention(a.user)).join(' ')}`, r ? { reply_parameters: { message_id: r.message_id, allow_sending_without_reply: true } } : {});
      ctx.deleteMessage().catch(() => {});
    } catch (e) { /* cannot list admins */ }
  });

}

module.exports = { register };
