'use strict';
const { InlineKeyboard } = require('grammy');
const actions = require('./actions');
const { isGroup, isAdminId } = require('./perms');
const { say, sayTo, mention, esc, displayName, fill, autoDelete } = require('./util');

const timers = new Map();
const keyOf = (c, u) => `${c}:${u}`;

function welcomeText(s, chatTitle, u) {
  return fill(s.welcome.text, { mention: mention(u), name: esc(displayName(u)), id: String(u.id), chat: esc(chatTitle || 'the group') });
}

function clearTimer(chatId, userId) {
  const t = timers.get(keyOf(chatId, userId));
  if (t) { clearTimeout(t); timers.delete(keyOf(chatId, userId)); }
}

function schedule(api, store, entry) {
  const ms = Math.max(0, entry.expiresAt - Date.now());
  const t = setTimeout(async () => {
    timers.delete(keyOf(entry.chatId, entry.userId));
    if (!store.getPending(entry.chatId, entry.userId)) return;
    store.removePending(entry.chatId, entry.userId);
    try { await actions.kick(api, entry.chatId, entry.userId); } catch (e) { console.error('captcha kick failed:', e.description || e.message); }
    api.deleteMessage(entry.chatId, entry.messageId).catch(() => {});
  }, ms);
  timers.set(keyOf(entry.chatId, entry.userId), t);
}

// Re-arm captcha timers after a restart.
function resume(api, store) {
  for (const entry of store.allPending()) schedule(api, store, entry);
}

async function startCaptcha(ctx, s, u) {
  try {
    await actions.mute(ctx.api, ctx.chat.id, u.id, 0);
  } catch (e) {
    console.error('captcha needs "restrict members" right:', e.description || e.message);
    return false;
  }
  const secs = s.captcha.timeout;
  const kb = new InlineKeyboard().text("✅ I'm human", `cap:${u.id}`);
  const msg = await say(ctx, `👋 Welcome ${mention(u)}!\nTap the button within <b>${secs}s</b> to prove you're human, or you'll be removed.`, { reply_markup: kb });
  if (!msg) {
    await actions.unmute(ctx.api, ctx.chat.id, u.id).catch(() => {});
    return false;
  }
  const entry = { chatId: ctx.chat.id, userId: u.id, messageId: msg.message_id, expiresAt: Date.now() + secs * 1000 };
  ctx.store.addPending(entry);
  schedule(ctx.api, ctx.store, entry);
  return true;
}

function register(bot, store) {
  bot.use((ctx, next) => { ctx.store = store; return next(); });

  bot.on('message:new_chat_members', async (ctx) => {
    if (!isGroup(ctx)) return;
    const s = store.chat(ctx.chat.id);
    for (const u of ctx.message.new_chat_members) {
      if (u.id === ctx.me.id) {
        await say(ctx, '👋 Thanks for adding me!\nMake me an <b>admin</b> (delete messages, ban users, pin messages) and send /settings to check everything is ready.');
        continue;
      }
      if (u.is_bot) {
        if (s.antibot && ctx.from && ctx.from.id !== u.id && !(await isAdminId(ctx.api, ctx.chat.id, ctx.from.id))) {
          try {
            await actions.kick(ctx.api, ctx.chat.id, u.id);
            const n = await say(ctx, `🤖 Only admins can add bots, so ${esc(displayName(u))} was removed.`);
            if (n) autoDelete(ctx.api, ctx.chat.id, n.message_id, 10000);
          } catch (e) { console.error('anti-bot:', e.description || e.message); }
        }
        continue;
      }
      if (s.captcha.enabled && (await startCaptcha(ctx, s, u))) continue;
      if (s.welcome.enabled) await say(ctx, welcomeText(s, ctx.chat.title, u));
    }
    if (s.cleanService) ctx.deleteMessage().catch(() => {});
  });

  bot.on('message:left_chat_member', async (ctx) => {
    const u = ctx.message.left_chat_member;
    const s = store.chat(ctx.chat.id);
    const entry = store.getPending(ctx.chat.id, u.id);
    if (entry) {
      clearTimer(entry.chatId, entry.userId);
      store.removePending(entry.chatId, entry.userId);
      ctx.api.deleteMessage(entry.chatId, entry.messageId).catch(() => {});
    } else if (s.goodbye.enabled && !u.is_bot && !(ctx.from && ctx.from.id === ctx.me.id)) {
      await say(ctx, fill(s.goodbye.text, { mention: mention(u), name: esc(displayName(u)), id: String(u.id), chat: esc(ctx.chat.title || 'the group') }));
    }
    if (s.cleanService) ctx.deleteMessage().catch(() => {});
  });

  bot.callbackQuery(/^cap:(\d+)$/, async (ctx) => {
    const uid = Number(ctx.match[1]);
    if (ctx.from.id !== uid) return ctx.answerCallbackQuery({ text: 'This button is not for you.', show_alert: true });
    const entry = store.getPending(ctx.chat.id, uid);
    if (!entry) {
      await ctx.answerCallbackQuery({ text: 'This verification has expired.' });
      return ctx.deleteMessage().catch(() => {});
    }
    clearTimer(entry.chatId, entry.userId);
    store.removePending(entry.chatId, entry.userId);
    try { await actions.unmute(ctx.api, ctx.chat.id, uid); } catch (e) { console.error('unmute failed:', e.description || e.message); }
    await ctx.answerCallbackQuery({ text: '✅ Verified, welcome!' });
    await ctx.deleteMessage().catch(() => {});
    const s = store.chat(ctx.chat.id);
    if (s.welcome.enabled) await sayTo(ctx.api, ctx.chat.id, welcomeText(s, ctx.chat.title, ctx.from), { message_thread_id: ctx.msg && ctx.msg.message_thread_id });
  });
}

module.exports = { register, resume };
