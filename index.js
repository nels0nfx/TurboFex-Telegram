'use strict';
const cfg = require('./src/config');
const { Bot } = require('grammy');
const { Store } = require('./src/store');
const { GENERAL, ADMIN, OWNER } = require('./src/general');

if (!cfg.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing. Copy config.env.example to config.env and paste your BotFather token.');
  process.exit(1);
}
if (/PASTE_YOUR/i.test(cfg.BOT_TOKEN)) {
  console.error('❌ Open config.env and replace PASTE_YOUR_BOT_TOKEN_HERE with the token from @BotFather.');
  process.exit(1);
}
if (!cfg.OWNER_IDS.length) console.warn('⚠️ OWNER_IDS is empty, so owner commands are disabled. Set it in config.env.');

const store = new Store(cfg.DATA_DIR);
const bot = new Bot(cfg.BOT_TOKEN);

bot.catch((err) => {
  const e = err.error || err;
  console.error('❌ Error while handling an update:', (e && (e.description || e.message)) || e);
});

// Gatekeeper: allowed groups only, and remember group names
bot.use(async (ctx, next) => {
  const chat = ctx.chat;
  if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
    if (cfg.ALLOWED_CHATS.length && !cfg.ALLOWED_CHATS.includes(chat.id)) {
      console.log(`Leaving group ${chat.id} (not in ALLOWED_CHATS)`);
      await ctx.api.leaveChat(chat.id).catch(() => {});
      return;
    }
    const s = store.chat(chat.id);
    if (s.title !== chat.title) { s.title = chat.title; store.save(); }
  }
  return next();
});

const welcome = require('./src/welcome');
require('./src/antilink').register(bot, store);
welcome.register(bot, store);
require('./src/general').register(bot, store);
require('./src/admin').register(bot, store);

async function setCommands() {
  const toApi = (list) => list.map(([command, description]) => ({ command, description }));
  try {
    await bot.api.setMyCommands(toApi(GENERAL), { scope: { type: 'default' } });
    await bot.api.setMyCommands(toApi([...GENERAL, ...ADMIN]), { scope: { type: 'all_chat_administrators' } });
  } catch (e) {
    console.error('Could not set the command menu:', e.description || e.message);
  }
}

function shutdown(signal) {
  console.log(`${signal} received, saving and stopping...`);
  store.flush();
  bot.stop().catch(() => {});
  setTimeout(() => process.exit(0), 500).unref();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', (e && (e.description || e.message)) || e));

(async () => {
  await bot.init();
  console.log(`✅ TurboFex Telegram bot online as @${bot.botInfo.username}`);
  await setCommands();
  welcome.resume(bot.api, store);
  await bot.start({
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query'],
  });
})().catch((e) => {
  console.error('❌ Could not start:', (e && (e.description || e.message)) || e);
  process.exit(1);
});
