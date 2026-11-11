'use strict';
const { InlineKeyboard } = require('grammy');
const cfg = require('./config');
const { isOwner, botRights } = require('./perms');
const { say, esc } = require('./util');
const ai = require('./ai');
const updater = require('./updater');
const { LOCK_TYPES } = require('./protect');

const WHATSAPP_REPO = 'https://github.com/nels0nfx/TurboFex';
const NEXT_ACTION = { mute: 'kick', kick: 'ban', ban: 'mute' };
const NEXT_TIMEOUT = { 30: 60, 60: 120, 120: 300, 300: 30 };
const GROUP_ACTS = ['g', 't', 'l', 'a', 'ct', 'sl', 'sa', 'ml', 'k', 'sw', 'sp', 'lk', 'cn', 'wt', 'gt', 'ru', 'fq', 'fa', 'fd', 'fl', 'fn', 'fx', 'wl', 'wn', 'wx', 'cw', 'cy'];
const NEXT_SPAM = { mute: 'warn', warn: 'kick', kick: 'mute' };
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

  const title = (s, id) => esc(s.title || id);
  const lockCount = (s) => Object.keys(s.locks).filter((k) => s.locks[k]).length;

  async function groupMenu(ctx, id, n) {
    const s = store.chat(id);
    const r = await botRights(ctx, id);
    const rights = r.missing.length ? `⚠️ Bot still needs: ${r.missing.join(', ')}` : '✅ Bot has all needed rights';
    const text = note(n, `🛠 <b>${title(s, id)}</b>\nWelcome ${onOff(s.welcome.enabled)} · Captcha ${onOff(s.captcha.enabled)} · Anti-link ${onOff(s.antilink)} · Anti-spam ${onOff(s.antispam.enabled)} · AI ${onOff(s.ai.enabled)}\nLocks: ${lockCount(s)} · Filters: ${Object.keys(s.filters).length} · Bad words: ${s.words.length} · Users with warnings: ${Object.keys(s.warns).length}\n${rights}`);
    const kb = new InlineKeyboard()
      .text('👋 Welcome & captcha', `pn:sw:${id}`).text('🛡 Protection', `pn:sp:${id}`).row()
      .text('🔒 Locks', `pn:lk:${id}`).text('📝 Content', `pn:cn:${id}`).row()
      .text('🧹 Clear warnings', `pn:cw:${id}`).row()
      .text('⬅️ Back', 'pn:gl');
    return { text, kb };
  }

  function welcomeMenu(id, n) {
    const s = store.chat(id);
    const kb = new InlineKeyboard()
      .text(`👋 Welcome: ${onOff(s.welcome.enabled)}`, `pn:t:${id}:w`).text(`🚪 Goodbye: ${onOff(s.goodbye.enabled)}`, `pn:t:${id}:g`).row()
      .text(`🤖 Captcha: ${onOff(s.captcha.enabled)}`, `pn:t:${id}:c`).text(`⏱ Captcha: ${s.captcha.timeout}s`, `pn:ct:${id}`).row()
      .text(`🧽 Clean join/leave: ${onOff(s.cleanService)}`, `pn:t:${id}:v`).row()
      .text('✏️ Welcome text', `pn:wt:${id}`).text('✏️ Goodbye text', `pn:gt:${id}`).row()
      .text('⬅️ Back', `pn:g:${id}`);
    return { text: note(n, `👋 <b>Welcome & captcha</b> · ${title(s, id)}`), kb };
  }

  function protectMenu(id, n) {
    const s = store.chat(id);
    const kb = new InlineKeyboard()
      .text(`🔗 Anti-link: ${onOff(s.antilink)}`, `pn:t:${id}:l`).text(`🌊 Anti-spam: ${onOff(s.antispam.enabled)}`, `pn:t:${id}:s`).row()
      .text('➖', `pn:sl:${id}:-`).text(`${s.antispam.limit} msgs / ${s.antispam.seconds}s`, 'pn:n').text('➕', `pn:sl:${id}:+`).row()
      .text(`Flooders: ${s.antispam.action}`, `pn:sa:${id}`).text(`🤖 Anti-bot: ${onOff(s.antibot)}`, `pn:t:${id}:b`).row()
      .text(`📣 Anti-mention: ${onOff(s.antimention.enabled)}`, `pn:t:${id}:m`).row()
      .text('➖', `pn:ml:${id}:-`).text(`Max mentions: ${s.antimention.limit}`, 'pn:n').text('➕', `pn:ml:${id}:+`).row()
      .text(`🧠 AI answers: ${onOff(s.ai.enabled)}`, `pn:t:${id}:i`).row()
      .text('➖', `pn:l:${id}:-`).text(`⚠️ Warn limit: ${s.warnLimit}`, 'pn:n').text('➕', `pn:l:${id}:+`).row()
      .text(`At the limit: ${s.warnAction}`, `pn:a:${id}`).row()
      .text('⬅️ Back', `pn:g:${id}`);
    return { text: note(n, `🛡 <b>Protection</b> · ${title(s, id)}\nAdmins and approved users are never affected.`), kb };
  }

  function locksMenu(id, n) {
    const s = store.chat(id);
    const kb = new InlineKeyboard();
    Object.entries(LOCK_TYPES).forEach(([k, label], i) => {
      kb.text(`${s.locks[k] ? '🔒' : '🔓'} ${label}`, `pn:k:${id}:${k}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text('⬅️ Back', `pn:g:${id}`);
    return { text: note(n, `🔒 <b>Locks</b> · ${title(s, id)}\nLocked message types are deleted when a normal member sends them.`), kb };
  }

  function contentMenu(id, n) {
    const s = store.chat(id);
    const kb = new InlineKeyboard()
      .text(`📜 Rules (${s.rules ? 'set' : 'not set'})`, `pn:ru:${id}`).text(`❓ FAQ & notes (${Object.keys(s.faq).length})`, `pn:fq:${id}`).row()
      .text(`🔎 Filters (${Object.keys(s.filters).length})`, `pn:fl:${id}`).text(`🚫 Bad words (${s.words.length})`, `pn:wl:${id}`).row()
      .text('⬅️ Back', `pn:g:${id}`);
    return { text: note(n, `📝 <b>Content</b> · ${title(s, id)}`), kb };
  }

  function faqMenu(id, n) {
    const s = store.chat(id);
    const keys = Object.keys(s.faq);
    const kb = new InlineKeyboard();
    keys.slice(0, 20).forEach((k, i) => kb.text('🗑 ' + k.slice(0, 24), `pn:fd:${id}:${i}`).row());
    kb.text('➕ Add FAQ / note', `pn:fa:${id}`).row().text('⬅️ Back', `pn:cn:${id}`);
    return { text: note(n, `❓ <b>FAQ & notes</b> · ${title(s, id)}\n${keys.length ? 'Members use /faq topic or #topic. Tap an entry to delete it.' : 'No entries yet.'}`), kb };
  }

  function filterMenu(id, n) {
    const s = store.chat(id);
    const keys = Object.keys(s.filters);
    const kb = new InlineKeyboard();
    keys.slice(0, 20).forEach((k, i) => kb.text('🗑 ' + k.slice(0, 24), `pn:fx:${id}:${i}`).row());
    kb.text('➕ Add filter', `pn:fn:${id}`).row().text('⬅️ Back', `pn:cn:${id}`);
    return { text: note(n, `🔎 <b>Filters</b> · ${title(s, id)}\n${keys.length ? 'The bot replies when a message contains the keyword. Tap one to delete it.' : 'No filters yet.'}`), kb };
  }

  function wordsMenu(id, n) {
    const s = store.chat(id);
    const kb = new InlineKeyboard();
    s.words.slice(0, 30).forEach((w, i) => kb.text('🗑 ' + w.slice(0, 24), `pn:wx:${id}:${i}`).row());
    kb.text('➕ Add words', `pn:wn:${id}`).row().text('⬅️ Back', `pn:cn:${id}`);
    return { text: note(n, `🚫 <b>Bad words</b> · ${title(s, id)}\n${s.words.length ? 'Messages with these words are deleted and the sender is warned. Tap one to remove it.' : 'No bad words yet.'}`), kb };
  }

  function aiMenu(n) {
    const i = ai.info();
    const text = note(n, [
      '🧠 <b>AI & knowledge</b>',
      i.enabled ? `Provider: ${esc(i.host)}` : '⚠️ <b>No AI key set.</b> Add AI_API_KEY to config.env and restart.',
      `Model: ${esc(i.using)}${i.using !== i.model ? ' (picked automatically, configured: ' + esc(i.model) + ')' : i.fallback ? ' (backup: ' + esc(i.fallback) + ')' : ''}`,
      `Knowledge: ${i.chars} characters (built-in ${i.base}, yours ${i.extra}). No limit; each question gets the most relevant parts${i.max ? ' (up to ' + i.max + ')' : ''}.`,
      `Today: ${i.calls} requests, ${i.errors} errors${i.lastError ? '\nLast error: ' + esc(i.lastError) : ''}`,
    ].join('\n'));
    const kb = new InlineKeyboard()
      .text('📥 Import TurboFex docs', 'pn:ki').text('🔗 Import a link', 'pn:kl').row()
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
      case 'sw': return done(welcomeMenu(id));
      case 'sp': return done(protectMenu(id));
      case 'lk': return done(locksMenu(id));
      case 'cn': return done(contentMenu(id));
      case 't': {
        if (b === 'w') s.welcome.enabled = !s.welcome.enabled;
        if (b === 'g') s.goodbye.enabled = !s.goodbye.enabled;
        if (b === 'c') s.captcha.enabled = !s.captcha.enabled;
        if (b === 'v') s.cleanService = !s.cleanService;
        if (b === 'l') s.antilink = !s.antilink;
        if (b === 's') s.antispam.enabled = !s.antispam.enabled;
        if (b === 'b') s.antibot = !s.antibot;
        if (b === 'm') s.antimention.enabled = !s.antimention.enabled;
        if (b === 'i') s.ai.enabled = !s.ai.enabled;
        store.save();
        return done('wgcv'.includes(b) ? welcomeMenu(id) : protectMenu(id));
      }
      case 'l':
        s.warnLimit = Math.min(20, Math.max(1, s.warnLimit + (b === '+' ? 1 : -1)));
        store.save();
        return done(protectMenu(id));
      case 'a': s.warnAction = NEXT_ACTION[s.warnAction] || 'mute'; store.save(); return done(protectMenu(id));
      case 'sl': s.antispam.limit = Math.min(30, Math.max(2, s.antispam.limit + (b === '+' ? 1 : -1))); store.save(); return done(protectMenu(id));
      case 'sa': s.antispam.action = NEXT_SPAM[s.antispam.action] || 'mute'; store.save(); return done(protectMenu(id));
      case 'ml': s.antimention.limit = Math.min(30, Math.max(1, s.antimention.limit + (b === '+' ? 1 : -1))); store.save(); return done(protectMenu(id));
      case 'ct': s.captcha.timeout = NEXT_TIMEOUT[s.captcha.timeout] || 30; store.save(); return done(welcomeMenu(id));
      case 'k':
        if (LOCK_TYPES[b]) { if (s.locks[b]) delete s.locks[b]; else s.locks[b] = true; store.save(); }
        return done(locksMenu(id));
      case 'wt': return prompt('welcome', { chatId: id }, `✏️ Send the new welcome message for <b>${title(s, id)}</b>.\nPlaceholders: {mention} {name} {chat} {id}. Basic HTML like &lt;b&gt;bold&lt;/b&gt; works.\n\n<b>Current:</b>\n${esc(s.welcome.text)}`);
      case 'gt': return prompt('goodbye', { chatId: id }, `✏️ Send the new goodbye message for <b>${title(s, id)}</b>.\nPlaceholders: {mention} {name} {chat} {id}.\n\n<b>Current:</b>\n${esc(s.goodbye.text)}`);
      case 'ru': return prompt('rules', { chatId: id }, `📜 Send the new rules for <b>${title(s, id)}</b>. New lines are kept.${s.rules ? '\n\n<b>Current:</b>\n' + esc(s.rules) : ''}`);
      case 'fq': return done(faqMenu(id));
      case 'fa': return prompt('faq', { chatId: id }, '➕ Send the FAQ or note as one message: the topic word first, then the answer.\nExample:\n<code>pair Open the pairing website, copy your session ID and paste it in config.env</code>');
      case 'fd': {
        const k = Object.keys(s.faq)[Number(b)];
        if (k) { delete s.faq[k]; store.save(); toast = 'Deleted'; }
        return done(faqMenu(id, k ? '🗑 Deleted ' + esc(k) : ''));
      }
      case 'fl': return done(filterMenu(id));
      case 'fn': return prompt('filter', { chatId: id }, '➕ Send the filter as one message: the keyword first, then the reply. Use quotes for a keyword with spaces.\nExample:\n<code>price The price is free.</code>\n<code>"good morning" Morning {mention}!</code>');
      case 'fx': {
        const k = Object.keys(s.filters)[Number(b)];
        if (k) { delete s.filters[k]; store.save(); toast = 'Deleted'; }
        return done(filterMenu(id, k ? '🗑 Deleted ' + esc(k) : ''));
      }
      case 'wl': return done(wordsMenu(id));
      case 'wn': return prompt('word', { chatId: id }, '➕ Send the bad words, separated by spaces or commas.');
      case 'wx': {
        const w = s.words[Number(b)];
        if (w) { s.words.splice(Number(b), 1); store.save(); toast = 'Removed'; }
        return done(wordsMenu(id));
      }
      case 'cw': return done(confirm(`🧹 Remove all warnings in <b>${esc(s.title || id)}</b>? (${Object.keys(s.warns).length} users)`, `pn:cy:${id}`, `pn:g:${id}`));
      case 'cy': s.warns = {}; store.save(); return done(groupMenu(ctx, id, '✅ All warnings removed.'));

      case 'ai': return done(aiMenu());
      case 'ki': {
        await ctx.answerCallbackQuery({ text: 'Importing…' });
        try {
          const r = await ai.importRepo(WHATSAPP_REPO);
          return show(ctx, aiMenu(`✅ Imported ${r.files} documentation file(s) of the TurboFex repository (${r.chars} characters).`));
        } catch (e) {
          return show(ctx, aiMenu('❌ ' + esc(e.message)));
        }
      }
      case 'kl': return prompt('link', {}, '🔗 Send an https link to import. A GitHub repository link imports all its documentation files (.md and .txt); a link to one file or any text page works too.');
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
      if (w.chatId !== undefined) {
        const m = { welcome: welcomeMenu, goodbye: welcomeMenu, rules: contentMenu, faq: faqMenu, filter: filterMenu, word: wordsMenu }[w.type];
        return m ? m(w.chatId, n) : groupMenu(ctx, w.chatId, n);
      }
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
        case 'goodbye':
          if (text.length > 3500) throw new Error('That is too long (max 3500 characters).');
          store.chat(w.chatId).goodbye.text = text;
          store.save();
          menu = await back('✅ Goodbye message saved. Switch it on with the Goodbye button.');
          break;
        case 'filter': {
          const m = /^(?:"([^"]{1,60})"|(\S{1,60}))\s+([\s\S]+)$/.exec(text);
          if (!m) { awaiting.set(ctx.from.id, { ...w, t: Date.now() }); return say(ctx, 'Please send the keyword first, then the reply, in one message. Or tap Cancel.'); }
          const filters = store.chat(w.chatId).filters;
          const kw = (m[1] || m[2]).toLowerCase();
          if (!filters[kw] && Object.keys(filters).length >= 100) throw new Error('You already have 100 filters.');
          if (m[3].length > 3500) throw new Error('That reply is too long (max 3500 characters).');
          filters[kw] = m[3];
          store.save();
          menu = await back(`✅ Filter saved for ${esc(kw)}.`);
          break;
        }
        case 'word': {
          const list = text.toLowerCase().split(/[\s,]+/).filter((x) => x.length >= 2 && x.length <= 40);
          const ws = store.chat(w.chatId).words;
          let added = 0;
          for (const x of list) if (!ws.includes(x) && ws.length < 200) { ws.push(x); added++; }
          store.save();
          ctx.deleteMessage().catch(() => {});
          menu = await back(`✅ Added ${added} word(s).`);
          break;
        }
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
          if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(text)) {
            const r = await ai.importRepo(text);
            menu = back(`✅ Imported ${r.files} documentation file(s) (${r.chars} characters).`);
            break;
          }
          const got = await ai.fetchKnowledge(text);
          if (!got.text) throw new Error('That page had no readable text.');
          ai.setSource(got.url, `## Imported from ${got.url}\n${got.text}`);
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
