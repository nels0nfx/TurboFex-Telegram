'use strict';
const cfg = require('./config');
const { Bot } = require('grammy');
const { Store } = require('./store');
const { GENERAL, ADMIN, OWNER } = require('./general');

if (!cfg.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing. Copy config.env.example to config.env and paste your BotFather token.');
  process.exit(78);
}
if (/PASTE_YOUR/i.test(cfg.BOT_TOKEN)) {
  console.error('❌ Open config.env and replace PASTE_YOUR_BOT_TOKEN_HERE with the token from @BotFather.');
  process.exit(78);
}
if (!cfg.OWNER_IDS.length) console.warn('⚠️ OWNER_IDS is empty, so owner commands are disabled. Set it in config.env.');

const store = new Store(cfg.DATA_DIR);
const bot = new Bot(cfg.BOT_TOKEN);

const ops = require('./ops');
bot.catch((err) => {
  const e = err.error || err;
  console.error('❌ Error while handling an update:', (e && (e.description || e.message)) || e);
  ops.alertError(bot.api, 'update', e);
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
    if (ctx.msg) store.countMessage(chat.id);
    const s = store.chat(chat.id);
    if (s.title !== chat.title) { s.title = chat.title; store.save(); }
  }
  return next();
});

const welcome = require('./welcome');
require('./antilink').register(bot, store);
require('./protect').register(bot, store);
welcome.register(bot, store);
require('./general').register(bot, store);
require('./admin').register(bot, store);
require('./panel').register(bot, store);
const updater = require('./updater');
updater.register(bot, store);
const guard = require('./guard');
const community = require('./community');
const releases = require('./releases');
guard.register(bot, store);
community.register(bot, store);      // XP is counted before keyword filters answer
require('./aitools').register(bot, store);
require('./tools').register(bot, store);
require('./dest').register(bot, store);
require('./triggers').register(bot, store);
releases.register(bot, store);
ops.register(bot, store);
require('./ai').register(bot, store);
require('./support').register(bot, store);

async function setCommands() {
  const toApi = (list) => list.map(([command, description]) => ({ command, description }));
  try {
    await bot.api.setMyCommands(toApi(GENERAL), { scope: { type: 'default' } });
    await bot.api.setMyCommands(toApi([...GENERAL, ...ADMIN]), { scope: { type: 'all_chat_administrators' } });
    for (const id of cfg.OWNER_IDS) {
      await bot.api.setMyCommands(toApi([...GENERAL, ...OWNER]), { scope: { type: 'chat', chat_id: id } }).catch(() => {});
    }
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
process.on('unhandledRejection', (e) => {
  console.error('Unhandled rejection:', (e && (e.description || e.message)) || e);
  ops.alertError(bot.api, 'background', e);
});

(async () => {
  await bot.init();
  console.log(`✅ TurboFex Telegram bot online as @${bot.botInfo.username}`);
  await setCommands();
  const aiInfo = require('./ai').info();
  console.log(aiInfo.enabled ? `🧠 AI answers on: ${aiInfo.host} · ${aiInfo.model}${aiInfo.fallback ? ' (backup ' + aiInfo.fallback + ')' : ''}` : '🧠 AI answers off (no AI_API_KEY set)');
  welcome.resume(bot.api, store);
  await bot.start({
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query', 'chat_member'],
    onStart: () => {
      updater.onBoot(bot.api, store);
      releases.start(bot.api, store);
      // background jobs every 30 seconds: reminders, schedules, giveaways, night mode, raid timers, warning expiry
      setInterval(() => {
        guard.tick(bot.api, store).catch((e) => console.error('tick:', e.message));
        community.tick(bot.api, store).catch((e) => console.error('tick:', e.message));
      }, 30000).unref();
    },
  });
})().catch((e) => {
  console.error('❌ Could not start:', (e && (e.description || e.message)) || e);
  process.exit(e && (e.error_code === 401 || e.error_code === 404) ? 78 : 1);
});
