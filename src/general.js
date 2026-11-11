'use strict';
const { InlineKeyboard } = require('grammy');
const { isGroup, isSenderAdmin, ownerOnly, isOwner } = require('./perms');
const { say, esc, mention, autoDelete } = require('./util');

const GENERAL = [
  ['rules', 'Show the group rules'],
  ['faq', 'Show frequently asked questions and notes'],
  ['report', 'Report a message to the admins (reply)'],
  ['admins', 'List the group admins'],
  ['mywarns', 'Show your warnings'],
  ['id', 'Show your Telegram ID and the chat ID'],
  ['ping', 'Check if the bot is alive'],
  ['help', 'Show all commands'],
];

const ADMIN = [
  ['warn', 'Warn a user (reply)'],
  ['unwarn', 'Remove a warning (reply)'],
  ['warns', 'Show warnings (reply)'],
  ['clearwarns', 'Clear warnings (reply or all)'],
  ['warnsettings', 'Warn limit and action'],
  ['mute', 'Mute a user: /mute 1h (reply)'],
  ['unmute', 'Unmute a user (reply)'],
  ['kick', 'Remove a user (reply)'],
  ['ban', 'Ban a user (reply)'],
  ['unban', 'Unban a user by ID'],
  ['del', 'Delete the replied message'],
  ['purge', 'Delete everything from the replied message'],
  ['pin', 'Pin the replied message'],
  ['unpin', 'Unpin a message'],
  ['info', 'Info about a user (reply)'],
  ['approve', 'Exempt a user from the filters (reply)'],
  ['unapprove', 'Remove that exemption (reply)'],
  ['approved', 'List approved users'],
  ['settings', 'Show group settings'],
  ['setwelcome', 'Set the welcome message'],
  ['getwelcome', 'Show the welcome message'],
  ['delwelcome', 'Reset and switch off the welcome'],
  ['welcome', 'Welcome message on/off'],
  ['setgoodbye', 'Set the goodbye message'],
  ['goodbye', 'Goodbye message on/off'],
  ['cleanservice', 'Delete join/leave messages on/off'],
  ['captcha', 'Join captcha on/off'],
  ['antilink', 'Delete links on/off'],
  ['antispam', 'Flood protection on/off/limit/action'],
  ['antibot', 'Only admins can add bots on/off'],
  ['antimention', 'Limit mentions per message'],
  ['lock', 'Lock a message type: /lock stickers'],
  ['unlock', 'Unlock a message type'],
  ['locks', 'Show all locks'],
  ['addword', 'Add forbidden words'],
  ['delword', 'Remove forbidden words'],
  ['words', 'List forbidden words'],
  ['setfilter', 'Auto-reply to a keyword'],
  ['filters', 'List the filters'],
  ['delfilter', 'Remove a filter'],
  ['setrules', 'Set the group rules'],
  ['addfaq', 'Add a FAQ entry / note'],
  ['delfaq', 'Remove a FAQ entry / note'],
  ['warnlimit', 'Warnings before punishment'],
  ['warnaction', 'mute, kick or ban at the limit'],
  ['ai', 'AI answers on/off/status/fix'],
];

const OWNER = [
  ['status', 'Bot status'],
  ['announce', 'Send a message to all groups'],
  ['panel', 'Manage your groups (private chat)'],
  ['knowledge', 'What the AI knows (add/import/show/clear)'],
  ['update', 'Check GitHub and update the bot'],
  ['autoupdate', 'Automatic updates on/off'],
  ['rollback', 'Go back to the previous version'],
  ['version', 'Show the running version'],
  ['reply', 'Reply to a support user: /reply <id> <text>'],
  ['block', 'Block a user from support: /block <id>'],
  ['unblock', 'Unblock a user: /unblock <id>'],
];

const line = (c) => `/${c[0]} - ${c[1]}`;

function register(bot, store) {
  bot.command('start', async (ctx) => {
    if (isGroup(ctx)) return say(ctx, '✅ I am online. Send /help to see what I can do.');
    const kb = new InlineKeyboard().url('➕ Add me to a group', `https://t.me/${ctx.me.username}?startgroup=true&admin=delete_messages+restrict_members+pin_messages+invite_users`);
    let t = '👋 <b>TurboFex Bot</b>\nI keep your group clean, welcomed and organised.\n\n📩 Need help? Just send me a message here and the team will reply.\n🔎 /mywarns shows your warnings.\n\nAdd me to a group, make me admin, then send /help there.';
    if (ctx.from && isOwner(ctx.from.id)) t += '\n\n🛠 Owner: use /panel to manage your groups from here.';
    return say(ctx, t, { reply_markup: kb });
  });

  bot.command('help', async (ctx) => {
    let text = '<b>TurboFex Bot - commands</b>\n\n' + GENERAL.map(line).join('\n');
    if (isGroup(ctx) && (await isSenderAdmin(ctx))) text += '\n\n<b>Admin</b>\n' + ADMIN.map(line).join('\n');
    if (ctx.from && isOwner(ctx.from.id)) text += '\n\n<b>Owner</b>\n' + OWNER.map(line).join('\n');
    return say(ctx, text);
  });

  bot.command('rules', async (ctx) => {
    if (!isGroup(ctx)) return say(ctx, 'Use /rules inside a group.');
    const s = store.chat(ctx.chat.id);
    return say(ctx, s.rules ? `📜 <b>Rules</b>\n\n${s.rules}` : 'No rules have been set yet.');
  });

  bot.command(['faq', 'notes', 'get'], async (ctx) => {
    if (!isGroup(ctx)) return say(ctx, 'Use /faq inside a group.');
    const s = store.chat(ctx.chat.id);
    const key = String(ctx.match || '').trim().toLowerCase();
    const keys = Object.keys(s.faq);
    if (!key) {
      return say(ctx, keys.length ? '❓ <b>FAQ</b>\nSend <code>/faq topic</code> for one of:\n\n' + keys.map((k) => '• ' + esc(k)).join('\n') : 'No FAQ entries yet.');
    }
    if (!s.faq[key]) return say(ctx, 'No FAQ entry called <b>' + esc(key) + '</b>. Send /faq to see the list.');
    return say(ctx, s.faq[key]);
  });

  bot.command('id', async (ctx) => {
    let t = `👤 Your ID: <code>${ctx.from.id}</code>`;
    if (isGroup(ctx)) t += `\n💬 Chat ID: <code>${ctx.chat.id}</code>`;
    const r = ctx.msg.reply_to_message;
    if (r && r.from) t += `\n↩️ Replied user ID: <code>${r.from.id}</code>`;
    return say(ctx, t);
  });

  bot.command('ping', async (ctx) => {
    const t0 = Date.now();
    const m = await ctx.reply('🏓');
    return ctx.api.editMessageText(ctx.chat.id, m.message_id, `🏓 Pong! ${Date.now() - t0} ms`).catch(() => {});
  });

  bot.command('status', ownerOnly, async (ctx) => {
    const up = Math.floor(process.uptime());
    const mem = Math.round(process.memoryUsage().rss / 1048576);
    return say(ctx, `📊 <b>Status</b>\nUptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m\nMemory: ${mem} MB\nGroups known: ${store.chatIds().length}\nPending captchas: ${store.allPending().length}\nNode: ${process.version}`);
  });

  bot.command('announce', ownerOnly, async (ctx) => {
    const text = String(ctx.match || '').trim();
    if (!text) return say(ctx, 'Usage: <code>/announce your message</code>\nSends it to every group I know.');
    let ok = 0;
    for (const id of store.chatIds()) {
      try { await ctx.api.sendMessage(id, '📢 ' + text); ok++; } catch (e) { /* bot removed from that group */ }
    }
    return say(ctx, `Sent to ${ok} group(s).`);
  });
  bot.command('mywarns', async (ctx) => {
    const uid = String(ctx.from.id);
    if (isGroup(ctx)) {
      const s = store.chat(ctx.chat.id);
      const m = await say(ctx, `${mention(ctx.from)}, you have ${s.warns[uid] || 0}/${s.warnLimit} warnings here.`);
      autoDelete(ctx.api, ctx.chat.id, m && m.message_id, 15000);
      autoDelete(ctx.api, ctx.chat.id, ctx.msg.message_id, 15000);
      return;
    }
    const rows = store.chatIds().map((id) => ({ s: store.chat(id) })).filter((r) => r.s.warns[uid]);
    if (!rows.length) return say(ctx, '✅ You have no warnings in any group I manage.');
    return say(ctx, '⚠️ <b>Your warnings</b>\n' + rows.map((r) => `• ${esc(r.s.title || 'Group')}: ${r.s.warns[uid]}/${r.s.warnLimit}`).join('\n'));
  });
}

module.exports = { register, GENERAL, ADMIN, OWNER };
