'use strict';
const { InlineKeyboard } = require('grammy');
const cfg = require('./config');
const { isOwner, botRights } = require('./perms');
const { say, esc } = require('./util');
const ai = require('./ai');
const updater = require('./updater');

const WHATSAPP_REPO = 'https://github.com/nels0nfx/TurboFex';
const NEXT_ACTION = { mute: 'kick', kick: 'ban', ban: 'mute' };
const NEXT_TIMEOUT = { 30: 60, 60: 120, 120: 300, 300: 30 };
const GROUP_ACTS = ['g', 't', 'l', 'a', 'ct', 'wt', 'ru', 'fq', 'fa', 'fd', 'cw', 'cy'];
const onOff = (v) => (v ? 'ON' : 'OFF');
const version = () => { try { return updater.currentVersion(); } catch (e) { return '?'; } };
const note = (n, text) => (n ? n + '\n\n' : '') + text;

function register(bot, store) {
  const awaiting = new Map(); // owner id -> what the next message is for

  // ---------- menus (each returns { text, kb }) ----------
  const mainMenu = (n) => ({
    text: note(n, `🛠 <b>Owner panel</b>\nTurboFex Telegram Bot v${esc(version())}`),
    kb: new InlineKeyboard()
      .text('👥 Groups', 'pn:gl').text('🧠 AI & knowledge', 'pn:ai').row()
      .text('🔄 Updates', 'pn:u').text('📩 Support', 'pn:s').row()
      .text('📊 Status', 'pn:st').text('📢 Announce', 'pn:an'),
  });

  function groupsMenu() {
    const ids = store.chatIds().slice(0, 30);
    const kb = new InlineKeyboard();
    for (const id of ids) kb.text(store.chat(id).title || String(id), `pn:g:${id}`).row();
    kb.text('⬅️ Back', 'pn:b');
    return { text: ids.length ? '👥 <b>Groups</b>\nPick a group:' : '👥 I am not in any group yet. Add me to one first.', kb };
  }

  async function groupMenu(ctx, id, n) {
    const s = store.chat(id);
    const r = await botRights(ctx, id);
    const rights = r.missing.length ? `⚠️ Bot still needs: ${r.missing.join(', ')}` : '✅ Bot has all needed rights';
    const text = note(n, `🛠 <b>${esc(s.title || id)}</b>\nRules: ${s.rules ? 'set' : 'not set'} · FAQ: ${Object.keys(s.faq).length} · Users with warnings: ${Object.keys(s.warns).length}\n${rights}`);
    const kb = new InlineKeyboard()
      .text(`👋 Welcome: ${onOff(s.welcome.enabled)}`, `pn:t:${id}:w`).text(`🤖 Captcha: ${onOff(s.captcha.enabled)}`, `pn:t:${id}:c`).row()
      .text(`🔗 Anti-link: ${onOff(s.antilink)}`, `pn:t:${id}:l`).text(`🧠 AI: ${onOff(s.ai.enabled)}`, `pn:t:${id}:i`).row()
      .text('➖', `pn:l:${id}:-`).text(`⚠️ Limit: ${s.warnLimit}`, 'pn:n').text('➕', `pn:l:${id}:+`).row()
      .text(`At limit: ${s.warnAction}`, `pn:a:${id}`).text(`⏱ Captcha: ${s.captcha.timeout}s`, `pn:ct:${id}`).row()
      .text('✏️ Welcome text', `pn:wt:${id}`).text('📜 Rules', `pn:ru:${id}`).row()
      .text(`❓ FAQ (${Object.keys(s.faq).length})`, `pn:fq:${id}`).text('🧹 Warnings', `pn:cw:${id}`).row()
      .text('⬅️ Back', 'pn:gl');
    return { text, kb };
  }

  function faqMenu(id, n) {
    const s = store.chat(id);
    const keys = Object.keys(s.faq);
    const kb = new InlineKeyboard();
    keys.slice(0, 20).forEach((k, i) => kb.text('🗑 ' + k.slice(0, 24), `pn:fd:${id}:${i}`).row());
    kb.text('➕ Add FAQ', `pn:fa:${id}`).row().text('⬅️ Back', `pn:g:${id}`);
    return { text: note(n, `❓ <b>FAQ</b> · ${esc(s.title || id)}\n${keys.length ? 'Tap an entry to delete it.' : 'No entries yet.'}`), kb };
  }

  function aiMenu(n) {
    const i = ai.info();
    const text = note(n, [
      '🧠 <b>AI & knowledge</b>',
      i.enabled ? `Provider: ${esc(i.host)}` : '⚠️ <b>No AI key set.</b> Add AI_API_KEY to config.env and restart.',
      `Model: ${esc(i.using)}${i.using !== i.model ? ' (picked automatically, configured: ' + esc(i.model) + ')' : i.fallback ? ' (backup: ' + esc(i.fallback) + ')' : ''}`,
      `Knowledge: ${i.chars} of ${i.max} characters (built-in ${i.base}, yours ${i.extra})`,
      `Today: ${i.calls} requests, ${i.errors} errors${i.lastError ? '\nLast error: ' + esc(i.lastError) : ''}`,
    ].join('\n'));
    const kb = new InlineKeyboard()
      .text('📥 Import TurboFex README', 'pn:ki').text('🔗 Import a link', 'pn:kl').row()
      .text('➕ Add a note', 'pn:kn').text('👁 View knowledge', 'pn:kv').row()
      .text('🧪 Test a question', 'pn:kt').text('🔧 Find a working model', 'pn:km').row()
      .text('🗑 Clear my notes', 'pn:kc').row()
      .text('⬅️ Back', 'pn:b');
    return { text, kb };
  }

  function updatesMenu(n) {
    const auto = !!store.data.settings.autoUpdate;
    const bv = updater.backupVersion();
    const kb = new InlineKeyboard().text('🔎 Check & install', 'pn:uc').text(`Auto-update: ${onOff(auto)}`, 'pn:au').row();
    if (bv) kb.text(`↩️ Roll back to v${bv}`, 'pn:ur').row();
    kb.text('⬅️ Back', 'pn:b');
    return {
      text: note(n, `🔄 <b>Updates</b>\nRunning v${esc(version())} · Source: ${esc(cfg.UPDATE_REPO)}\nAuto-update: ${onOff(auto)}\nSelf-restart: ${updater.supervised() ? 'yes' : 'no (restart from the hosting panel after updating)'}`),
      kb,
    };
  }

  function supportMenu(n) {
    const staff = new Set([...cfg.OWNER_IDS, ...cfg.SUPPORT_IDS]).size;
    return {
      text: note(n, `📩 <b>Support inbox</b>\nTeam members who receive messages: ${staff}\nBlocked users: ${store.data.blocked.length}`),
      kb: new InlineKeyboard().text('🚫 Block an ID', 'pn:sn').text('📋 Blocked list', 'pn:sb').row().text('⬅️ Back', 'pn:b'),
    };
  }

  function blockedMenu(n) {
    const kb = new InlineKeyboard();
    store.data.blocked.slice(0, 20).forEach((id) => kb.text(`✅ Unblock ${id}`, `pn:su:${id}`).row());
    kb.text('⬅️ Back', 'pn:s');
    return { text: note(n, store.data.blocked.length ? '📋 <b>Blocked users</b>\nTap one to unblock.' : '📋 Nobody is blocked.'), kb };
  }

  function statusMenu() {
    const up = Math.floor(process.uptime());
    const i = ai.info();
    return {
      text: `📊 <b>Status</b>\nVersion: v${esc(version())}\nUptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m\nMemory: ${Math.round(process.memoryUsage().rss / 1048576)} MB\nGroups known: ${store.chatIds().length}\nPending captchas: ${store.allPending().length}\nAI: ${i.enabled ? 'on' : 'off'}\nNode: ${process.version}`,
      kb: new InlineKeyboard().text('🔄 Refresh', 'pn:st').text('⬅️ Back', 'pn:b'),
    };
  }

  const confirm = (text, yes, no) => ({ text, kb: new InlineKeyboard().text('✅ Yes', yes).text('No', no) });

  async function show(ctx, menu) {
    try {
      await ctx.editMessageText(menu.text, { parse_mode: 'HTML', reply_markup: menu.kb });
    } catch (e) {
      if (!/not modified/i.test(e.description || '')) console.error('panel:', e.description || e.message);
    }
  }

  // ---------- commands ----------
  bot.command('panel', async (ctx) => {
    if (!ctx.from || !isOwner(ctx.from.id)) return;
    if (ctx.chat.type !== 'private') return say(ctx, 'Open me in a private chat and send /panel there.');
    const m = mainMenu();
    return say(ctx, m.text, { reply_markup: m.kb });
  });

  bot.command('cancel', async (ctx) => {
    if (!ctx.from || !isOwner(ctx.from.id) || !awaiting.delete(ctx.from.id)) return;
    return say(ctx, 'Cancelled. Send /panel to open the panel again.');
  });

  // ---------- buttons ----------
  bot.callbackQuery(/^pn:/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Owner only.', show_alert: true });
    const [, act, a, b] = ctx.callbackQuery.data.split(':');
    const id = Number(a);
    if (GROUP_ACTS.includes(act) && !store.chatIds().includes(id)) return ctx.answerCallbackQuery({ text: 'Unknown group.', show_alert: true });
    const s = GROUP_ACTS.includes(act) ? store.chat(id) : null;
    let toast;
    const done = async (menu) => { await ctx.answerCallbackQuery(toast ? { text: toast } : undefined); return show(ctx, await menu); };
    const prompt = async (type, extra, text) => {
      awaiting.set(ctx.from.id, { type, ...extra, msgId: ctx.callbackQuery.message.message_id, t: Date.now() });
      await ctx.answerCallbackQuery();
      return show(ctx, { text, kb: new InlineKeyboard().text('❌ Cancel', 'pn:x') });
    };

    switch (act) {
      case 'n': return ctx.answerCallbackQuery();
      case 'b': return done(mainMenu());
      case 'x': awaiting.delete(ctx.from.id); return done(mainMenu());
      case 'gl': return done(groupsMenu());
      case 'g': return done(groupMenu(ctx, id));
      case 't':
        if (b === 'w') s.welcome.enabled = !s.welcome.enabled;
        if (b === 'c') s.captcha.enabled = !s.captcha.enabled;
        if (b === 'l') s.antilink = !s.antilink;
        if (b === 'i') s.ai.enabled = !s.ai.enabled;
        store.save();
        return done(groupMenu(ctx, id));
      case 'l':
        s.warnLimit = Math.min(20, Math.max(1, s.warnLimit + (b === '+' ? 1 : -1)));
        store.save();
        return done(groupMenu(ctx, id));
      case 'a': s.warnAction = NEXT_ACTION[s.warnAction] || 'mute'; store.save(); return done(groupMenu(ctx, id));
      case 'ct': s.captcha.timeout = NEXT_TIMEOUT[s.captcha.timeout] || 30; store.save(); return done(groupMenu(ctx, id));
      case 'wt': return prompt('welcome', { chatId: id }, `✏️ Send the new welcome message for <b>${esc(s.title || id)}</b>.\nPlaceholders: {mention} {name} {chat} {id}. Basic HTML like &lt;b&gt;bold&lt;/b&gt; works.\n\n<b>Current:</b>\n${esc(s.welcome.text)}`);
      case 'ru': return prompt('rules', { chatId: id }, `📜 Send the new rules for <b>${esc(s.title || id)}</b>. New lines are kept.${s.rules ? '\n\n<b>Current:</b>\n' + esc(s.rules) : ''}`);
      case 'fq': return done(faqMenu(id));
      case 'fa': return prompt('faq', { chatId: id }, '➕ Send the FAQ as one message: the topic word first, then the answer.\nExample:\n<code>pair Open the pairing website, copy your session ID and paste it in config.env</code>');
      case 'fd': {
        const k = Object.keys(s.faq)[Number(b)];
        if (k) { delete s.faq[k]; store.save(); toast = 'Deleted'; }
        return done(faqMenu(id, k ? '🗑 Deleted ' + esc(k) : ''));
      }
      case 'cw': return done(confirm(`🧹 Remove all warnings in <b>${esc(s.title || id)}</b>? (${Object.keys(s.warns).length} users)`, `pn:cy:${id}`, `pn:g:${id}`));
      case 'cy': s.warns = {}; store.save(); return done(groupMenu(ctx, id, '✅ All warnings removed.'));

      case 'ai': return done(aiMenu());
      case 'ki': {
        await ctx.answerCallbackQuery({ text: 'Importing…' });
        try {
          const got = await ai.fetchKnowledge(WHATSAPP_REPO);
          if (!got.text) throw new Error('The README was empty.');
          ai.appendExtra(`## Imported from ${got.url}\n${got.text}`);
          return show(ctx, aiMenu(`✅ Imported the TurboFex README (${got.text.length} characters).`));
        } catch (e) {
          return show(ctx, aiMenu('❌ ' + esc(e.message)));
        }
      }
      case 'kl': return prompt('link', {}, '🔗 Send an https link to import. A GitHub repository link imports its README; a link to a file on GitHub or any text page works too.');
      case 'kn': return prompt('note', {}, '➕ Send the note the AI should learn (commands, setup steps, answers to common questions).');
      case 'kv': {
        await ctx.answerCallbackQuery();
        const k = ai.knowledge();
        return say(ctx, k ? '<pre>' + esc(k.slice(0, 3500)) + '</pre>' + (k.length > 3500 ? `\n(first 3500 of ${k.length} characters)` : '') : 'The knowledge is empty.');
      }
      case 'kc': return done(confirm('🗑 Remove all notes you added? The built-in knowledge file stays.', 'pn:kd', 'pn:ai'));
      case 'kd': ai.clearExtra(); return done(aiMenu('🗑 Your notes were removed.'));
      case 'km': {
        await ctx.answerCallbackQuery({ text: 'Looking for a working model…' });
        try {
          const r = await ai.fixModel();
          return show(ctx, aiMenu(`✅ Now using ${esc(r.model)}.`));
        } catch (e) {
          return show(ctx, aiMenu('❌ ' + esc(e.message)));
        }
      }
      case 'kt': return prompt('test', {}, '🧪 Send a question, the way a member would ask it.');

      case 'u': return done(updatesMenu());
      case 'uc': {
        await ctx.answerCallbackQuery({ text: 'Checking GitHub…' });
        try {
          const r = await updater.check();
          const kb = new InlineKeyboard();
          if (r.newer) kb.text('⬇️ Install & restart', 'up:go').row();
          kb.text('⬅️ Back', 'pn:u');
          return show(ctx, { text: r.newer ? `🆕 <b>v${esc(r.latest)}</b> is available (you have v${esc(r.cur)}).` : `✅ Up to date (v${esc(r.cur)}).`, kb });
        } catch (e) {
          return show(ctx, updatesMenu('❌ ' + esc(updater.explain(e))));
        }
      }
      case 'au': store.data.settings.autoUpdate = !store.data.settings.autoUpdate; store.save(); return done(updatesMenu());
      case 'ur': {
        const kb = new InlineKeyboard().text('✅ Yes, go back', 'up:rb').text('No', 'pn:u');
        return done({ text: `↩️ Restore the previous version <b>v${esc(updater.backupVersion() || '?')}</b> and restart?\nAuto-update will be switched off.`, kb });
      }

      case 's': return done(supportMenu());
      case 'sb': return done(blockedMenu());
      case 'sn': return prompt('block', {}, '🚫 Send the numeric Telegram ID of the user to block from support.');
      case 'su': store.unblock(id); toast = 'Unblocked'; return done(blockedMenu());
      case 'st': return done(statusMenu());
      case 'an': return prompt('announce', {}, '📢 Send the announcement. It goes to every group I am in.');
      default: return ctx.answerCallbackQuery();
    }
  });

  // ---------- the owner's next message after a "send me…" button ----------
  bot.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private' || !ctx.from || !isOwner(ctx.from.id)) return next();
    const w = awaiting.get(ctx.from.id);
    if (!w) return next();
    if (Date.now() - w.t > 600000) { awaiting.delete(ctx.from.id); return next(); }
    const text = ctx.msg.text.trim();
    if (text.startsWith('/')) return next();
    awaiting.delete(ctx.from.id);

    const back = (n) => {
      if (w.chatId !== undefined) return w.type === 'faq' ? faqMenu(w.chatId, n) : groupMenu(ctx, w.chatId, n);
      if (w.type === 'block') return supportMenu(n);
      if (w.type === 'announce') return mainMenu(n);
      return aiMenu(n);
    };
    let menu;
    try {
      switch (w.type) {
        case 'welcome':
          if (text.length > 3500) throw new Error('That is too long (max 3500 characters).');
          store.chat(w.chatId).welcome.text = text;
          store.save();
          menu = await back('✅ Welcome message saved.');
          break;
        case 'rules':
          if (text.length > 3500) throw new Error('That is too long (max 3500 characters).');
          store.chat(w.chatId).rules = text;
          store.save();
          menu = await back('✅ Rules saved.');
          break;
        case 'faq': {
          const m = /^(\S+)\s+([\s\S]+)$/.exec(text);
          const faq = store.chat(w.chatId).faq;
          if (!m) { awaiting.set(ctx.from.id, { ...w, t: Date.now() }); return say(ctx, 'Please send the topic word first, then the answer, in one message. Or tap Cancel.'); }
          const key = m[1].toLowerCase().replace(/^\//, '').slice(0, 32);
          if (!faq[key] && Object.keys(faq).length >= 50) throw new Error('You already have 50 FAQ entries.');
          if (m[2].length > 3500) throw new Error('That answer is too long (max 3500 characters).');
          faq[key] = m[2];
          store.save();
          menu = await back(`✅ Saved. Members can use /faq ${esc(key)}`);
          break;
        }
        case 'note':
          menu = back(`✅ Note added (your notes: ${ai.appendExtra(text)} characters).`);
          break;
        case 'link': {
          const got = await ai.fetchKnowledge(text);
          if (!got.text) throw new Error('That page had no readable text.');
          ai.appendExtra(`## Imported from ${got.url}\n${got.text}`);
          menu = back(`✅ Imported ${got.text.length} characters.`);
          break;
        }
        case 'test': {
          const out = await ai.askTest(ctx, text);
          await say(ctx, out ? ai.toHtml(out) : '(the AI chose not to answer that one)');
          menu = back();
          break;
        }
        case 'block': {
          const uid = Number(text);
          if (!Number.isInteger(uid) || uid < 10000) throw new Error('That is not a Telegram ID. Send only the number.');
          store.block(uid);
          menu = back(`⛔ Blocked ${uid}.`);
          break;
        }
        case 'announce': {
          let ok = 0;
          for (const cid of store.chatIds()) { try { await ctx.api.sendMessage(cid, '📢 ' + text); ok++; } catch (e) { /* removed from that group */ } }
          menu = back(`✅ Sent to ${ok} group(s).`);
          break;
        }
        default: return next();
      }
    } catch (e) {
      menu = await back('❌ ' + esc(e.message));
    }
    menu = await menu;
    return ctx.api.editMessageText(ctx.chat.id, w.msgId, menu.text, { parse_mode: 'HTML', reply_markup: menu.kb }).catch(() => say(ctx, menu.text, { reply_markup: menu.kb }));
  });
}

module.exports = { register };
