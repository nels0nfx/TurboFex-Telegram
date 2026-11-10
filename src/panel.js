'use strict';
const { InlineKeyboard } = require('grammy');
const { isOwner, botRights } = require('./perms');
const { say, esc } = require('./util');

const NEXT_ACTION = { mute: 'kick', kick: 'ban', ban: 'mute' };

function register(bot, store) {
  const onOff = (v) => (v ? 'ON' : 'OFF');

  function mainMenu() {
    const ids = store.chatIds().slice(0, 30);
    const kb = new InlineKeyboard();
    for (const id of ids) kb.text(store.chat(id).title || String(id), `pn:g:${id}`).row();
    const text = ids.length ? '🛠 <b>Owner panel</b>\nPick a group:' : 'I am not in any group yet. Add me to one first.';
    return { text, kb };
  }

  async function groupMenu(ctx, id) {
    const s = store.chat(id);
    const r = await botRights(ctx, id);
    const rights = r.missing.length ? `⚠️ Bot still needs: ${r.missing.join(', ')}` : '✅ Bot has all needed rights';
    const text = `🛠 <b>${esc(s.title || id)}</b>\n\nRules: ${s.rules ? 'set' : 'not set'} · FAQ: ${Object.keys(s.faq).length} entries\n${rights}`;
    const kb = new InlineKeyboard()
      .text(`👋 Welcome: ${onOff(s.welcome.enabled)}`, `pn:t:${id}:w`)
      .text(`🤖 Captcha: ${onOff(s.captcha.enabled)}`, `pn:t:${id}:c`).row()
      .text(`🔗 Anti-link: ${onOff(s.antilink)}`, `pn:t:${id}:l`)
      .text(`🧠 AI: ${onOff(s.ai.enabled)}`, `pn:t:${id}:i`).row()
      .text('➖', `pn:l:${id}:-`).text(`⚠️ Limit: ${s.warnLimit}`, 'pn:n').text('➕', `pn:l:${id}:+`).row()
      .text(`At limit: ${s.warnAction}`, `pn:a:${id}`).row()
      .text('⬅️ Back', 'pn:b');
    return { text, kb };
  }

  async function show(ctx, { text, kb }) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
      if (!/not modified/i.test(e.description || '')) console.error('panel:', e.description || e.message);
    }
  }

  bot.command('panel', async (ctx) => {
    if (!ctx.from || !isOwner(ctx.from.id)) return;
    if (ctx.chat.type !== 'private') return say(ctx, 'Open me in a private chat and send /panel there.');
    const m = mainMenu();
    return say(ctx, m.text, { reply_markup: m.kb });
  });

  bot.callbackQuery(/^pn:/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Owner only.', show_alert: true });
    const [, act, rawId, arg] = ctx.callbackQuery.data.split(':');
    if (act === 'n') return ctx.answerCallbackQuery();
    if (act === 'b') { await ctx.answerCallbackQuery(); return show(ctx, mainMenu()); }

    const id = Number(rawId);
    if (!store.chatIds().includes(id)) return ctx.answerCallbackQuery({ text: 'Unknown group.', show_alert: true });
    const s = store.chat(id);
    if (act === 't') {
      if (arg === 'w') s.welcome.enabled = !s.welcome.enabled;
      if (arg === 'c') s.captcha.enabled = !s.captcha.enabled;
      if (arg === 'l') s.antilink = !s.antilink;
      if (arg === 'i') s.ai.enabled = !s.ai.enabled;
    } else if (act === 'l') {
      s.warnLimit = Math.min(20, Math.max(1, s.warnLimit + (arg === '+' ? 1 : -1)));
    } else if (act === 'a') {
      s.warnAction = NEXT_ACTION[s.warnAction] || 'mute';
    }
    store.save();
    await ctx.answerCallbackQuery();
    return show(ctx, await groupMenu(ctx, id));
  });

}

module.exports = { register };
