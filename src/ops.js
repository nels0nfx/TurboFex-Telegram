'use strict';
const cfg = require('./config');
const ai = require('./ai');
const { InlineKeyboard } = require('grammy');
const { ownerOnly, isOwner } = require('./perms');
const dest = require('./dest');
const { say, sayTo, esc } = require('./util');

const seen = new Map();
// Tells the owners about an error (the same error at most every 10 minutes)
function alertError(api, where, e) {
  const msg = String((e && (e.description || e.message)) || e).slice(0, 300);
  const sig = where + msg.slice(0, 60);
  if (Date.now() - (seen.get(sig) || 0) < 600000) return;
  seen.set(sig, Date.now());
  if (seen.size > 200) seen.clear();
  for (const id of cfg.OWNER_IDS) sayTo(api, id, `⚠️ <b>Error</b> (${esc(where)})\n<code>${esc(msg)}</code>`);
}

async function statsText(api, store) {
  const ids = store.chatIds();
  const st = store.data.stats;
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const lines = ['📈 <b>Stats</b>'];
  for (const id of ids.slice(0, 15)) {
    let members = '?';
    try { members = await api.getChatMemberCount(id); } catch (e) { /* removed from the group */ }
    const today = (st[day(0)] || {})[id] || 0;
    let week = 0;
    for (let i = 0; i < 7; i++) week += (st[day(i)] || {})[id] || 0;
    lines.push(`• ${esc(store.chat(id).title || id)}: ${members} members · ${today} messages today · ${week} this week`);
  }
  const i = ai.info();
  const open = Object.values(store.data.support.items).filter((t) => t.status === 'open').length;
  lines.push('', `🧠 AI: ${i.enabled ? 'on' : 'off'} · ${i.calls} requests today, ${i.errors} errors`);
  lines.push(`📩 Open tickets: ${open} · 🌐 Global bans: ${Object.keys(store.data.gbans).length} · ⏰ Reminders: ${store.data.reminders.length}`);
  lines.push(`🏅 Members with XP: ${ids.reduce((n, id) => n + Object.keys(store.chat(id).xp).length, 0)}`);
  return lines.join('\n');
}

function register(bot, store) {
  const pending = new Map();

  bot.command('stats', ownerOnly, async (ctx) => say(ctx, await statsText(ctx.api, store)));

  bot.command('groups', ownerOnly, async (ctx) => {
    const ids = store.chatIds();
    return say(ctx, ids.length ? '👥 <b>Groups</b>\n' + ids.map((id, i) => `${i + 1}. ${esc(store.chat(id).title || id)} <code>${id}</code>`).join('\n') + '\n\n<code>/announceto 1,3 your message</code>' : 'I am not in any group yet.');
  });

  bot.command('announceto', ownerOnly, async (ctx) => {
    const m = /^([\w,\s]+?)\s+([\s\S]+)$/.exec(String(ctx.match || '').trim());
    if (!m) return say(ctx, 'Usage: <code>/announceto 1,3 your message</code> (numbers from /groups). Add <code>channel</code> to include the announcement channel: <code>/announceto channel,1 text</code>');
    const all = store.chatIds();
    const tokens = m[1].split(/[\s,]+/).filter(Boolean);
    const withChannel = tokens.some((t) => /^(channel|ch)$/i.test(t));
    const picks = [...new Set(tokens.map(Number))].filter((n) => n >= 1 && n <= all.length);
    if (!picks.length && !withChannel) return say(ctx, 'Those group numbers do not exist. See /groups.');
    const r = await dest.announce(ctx.api, store, picks.map((n) => all[n - 1]), '📢 ' + m[2], withChannel);
    return say(ctx, `Sent to ${r.ok} of ${picks.length} group(s)${withChannel ? (r.channel ? ' and the channel' : ' (no announcement channel is set, see /setchannel)') : ''}.`);
  });

  bot.command('backup', ownerOnly, async (ctx) => {
    if (ctx.chat.type !== 'private') return say(ctx, 'Please send /backup in a private chat with me. The file contains your settings and user IDs.');
    const { InputFile } = require('grammy');
    store.flush();
    const name = `turbofex-backup-${new Date().toISOString().slice(0, 10)}.json`;
    await ctx.api.sendDocument(ctx.chat.id, new InputFile(Buffer.from(JSON.stringify(store.data, null, 2)), name), { caption: '💾 Settings backup. Keep it private. To restore: reply to this file with /restore.' });
  });

  bot.command('restore', ownerOnly, async (ctx) => {
    if (ctx.chat.type !== 'private') return say(ctx, 'Please use /restore in a private chat with me.');
    const d = ctx.msg.reply_to_message && ctx.msg.reply_to_message.document;
    if (!d) return say(ctx, 'Reply to a backup file with <code>/restore</code>.');
    if ((d.file_size || 0) > 20 * 1024 * 1024) return say(ctx, 'That file is too big to be a backup.');
    try {
      const f = await ctx.api.getFile(d.file_id);
      const res = await fetch(`https://api.telegram.org/file/bot${cfg.BOT_TOKEN}/${f.file_path}`, { signal: AbortSignal.timeout(30000) });
      const j = JSON.parse(await res.text());
      if (!j || typeof j.chats !== 'object' || Array.isArray(j.chats)) throw new Error('not a backup');
      pending.set(ctx.from.id, j);
      const kb = new InlineKeyboard().text('✅ Restore', 'bk:go').text('Cancel', 'bk:no');
      return say(ctx, `💾 This backup has ${Object.keys(j.chats).length} group(s).\nRestoring <b>replaces all current settings, warnings and tickets</b>. Continue?`, { reply_markup: kb });
    } catch (e) { return say(ctx, '❌ That file is not a valid TurboFex backup.'); }
  });

  bot.callbackQuery(/^bk:(go|no)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Owner only.', show_alert: true });
    await ctx.answerCallbackQuery();
    const j = pending.get(ctx.from.id);
    pending.delete(ctx.from.id);
    if (ctx.match[1] === 'no' || !j) return ctx.editMessageText('Cancelled.').catch(() => {});
    store.data = Object.assign({ chats: {}, pending: {}, tickets: {}, blocked: [], settings: {}, gbans: {}, reminders: [], support: { next: 1, items: {} }, stats: {} }, j, { pending: {} });
    store.flush();
    return ctx.editMessageText(`✅ Restored ${Object.keys(store.data.chats).length} group(s). Settings are active now.`).catch(() => {});
  });
}

module.exports = { register, alertError, statsText };
