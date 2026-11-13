'use strict';
const { InlineKeyboard } = require('grammy');
const cfg = require('./config');
const { isOwner, botRights } = require('./perms');
const { say, esc } = require('./util');
const ai = require('./ai');
const updater = require('./updater');
const { LOCK_TYPES } = require('./protect');
const ops = require('./ops');
const health = require('./health');
const releases = require('./releases');
const dest = require('./dest');
const { support } = require('./support');

const WHATSAPP_REPO = 'https://github.com/nels0nfx/TurboFex';
const NEXT_ACTION = { mute: 'kick', kick: 'ban', ban: 'mute' };
const NEXT_TIMEOUT = { 30: 60, 60: 120, 120: 300, 300: 30 };
const GROUP_ACTS = ['ds', 'dp', 'dc', 'mo', 'nb', 'we', 'rt', 'g', 't', 'l', 'a', 'ct', 'sl', 'sa', 'ml', 'k', 'sw', 'sp', 'lk', 'cn', 'wt', 'gt', 'ru', 'fq', 'fa', 'fd', 'fl', 'fn', 'fx', 'wl', 'wn', 'wx', 'cw', 'cy'];
const NEXT_SPAM = { mute: 'warn', warn: 'kick', kick: 'mute' };
const NEXT_NEWBIE = { 0: 6, 6: 24, 24: 72, 72: 0 };
const NEXT_EXPIRY = { 0: 7, 7: 14, 14: 30, 30: 0 };
const NEXT_RAID = { 5: 8, 8: 12, 12: 20, 20: 5 };
const WELCOME_KEYS = ['w', 'g', 'c', 'v'];
const MORE_KEYS = ['lv', 'rl', 'ra', 'gs', 'as', 'su', 'nm', 'rm'];
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
      .text('📊 Status', 'pn:st').text('📈 Stats', 'pn:ss').row()
      .text('📢 Announce', 'pn:an').text('📍 Channels', 'pn:gd'),
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
      .text('🧰 More', `pn:mo:${id}`).text('📍 Destinations', `pn:ds:${id}`).row()
      .text('🧹 Clear warnings', `pn:cw:${id}`).row()
      .text('⬅️ Back', 'pn:gl');
    return { text, kb };
  }

  function moreMenu(id, n) {
    const s = store.chat(id);
    const raidOn = s.raid.active > Date.now();
    const kb = new InlineKeyboard()
      .text(`🏅 Levels: ${onOff(s.levels.enabled)}`, `pn:t:${id}:lv`).text(`📦 Release news: ${onOff(s.releases)}`, `pn:t:${id}:rl`).row()
      .text(`🚨 Raid auto: ${onOff(s.raid.auto)}`, `pn:t:${id}:ra`).text(`Raid at ${s.raid.threshold}/min`, `pn:rt:${id}`).row()
      .text(`🚨 Raid mode now: ${onOff(raidOn)}`, `pn:t:${id}:rm`).row()
      .text(`🌐 Global bans: ${onOff(s.gban)}`, `pn:t:${id}:gs`).text(`🤖 AI scan: ${onOff(s.aiscan)}`, `pn:t:${id}:as`).row()
      .text(`📝 Summaries: ${onOff(s.summary)}`, `pn:t:${id}:su`).text(`🌙 Night mode: ${onOff(s.night.enabled)}`, `pn:t:${id}:nm`).row()
      .text(`🆕 New members: ${s.newbie.hours ? s.newbie.hours + 'h' : 'off'}`, `pn:nb:${id}`).text(`⏳ Warn expiry: ${s.warnExpiryDays ? s.warnExpiryDays + 'd' : 'off'}`, `pn:we:${id}`).row()
      .text('⬅️ Back', `pn:g:${id}`);
    return { text: note(n, `🧰 <b>More</b> · ${title(s, id)}\nLog channel: ${s.log.chat ? s.log.chat : 'off (set with /setlog)'} · Time zone: UTC${s.tz >= 0 ? '+' : ''}${s.tz} (/timezone)\nNight mode ${s.night.from}–${s.night.to} (/nightmode) · New members cannot send links or forwards for the chosen hours.`), kb };
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
      .text('🗑 Clear my notes', 'pn:kc').text(`📚 Sources: ${onOff(ai.aiSources())}`, 'pn:ks').row()
      .text(`❓ Unanswered (${ai.listGaps().length})`, 'pn:qg').row()
      .text('⬅️ Back', 'pn:b');
    return { text, kb };
  }

  function updatesMenu(n) {
    const auto = !!store.data.settings.autoUpdate;
    const bv = updater.backupVersion();
    const kb = new InlineKeyboard().text('🔎 Check & install', 'pn:uc').text(`Auto-update: ${onOff(auto)}`, 'pn:au').row()
      .text('📦 Check releases now', 'pn:rc').row();
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
      text: note(n, `📩 <b>Support inbox</b>\nTeam members who receive messages: ${staff}\nOpen tickets: ${Object.values(store.data.support.items).filter((t) => t.status === 'open').length} · Blocked users: ${store.data.blocked.length}`),
      kb: new InlineKeyboard().text('📋 Open tickets', 'pn:tk').row().text('🚫 Block an ID', 'pn:sn').text('📋 Blocked list', 'pn:sb').row().text('⬅️ Back', 'pn:b'),
    };
  }

  function blockedMenu(n) {
    const kb = new InlineKeyboard();
    store.data.blocked.slice(0, 20).forEach((id) => kb.text(`✅ Unblock ${id}`, `pn:su:${id}`).row());
    kb.text('⬅️ Back', 'pn:s');
    return { text: note(n, store.data.blocked.length ? '📋 <b>Blocked users</b>\nTap one to unblock.' : '📋 Nobody is blocked.'), kb };
  }

  async function statusMenu(ctx) {
    return {
      text: await health.healthText(ctx.api, store, ctx.me.id),
      kb: new InlineKeyboard().text('🔄 Refresh', 'pn:st').text('⬅️ Back', 'pn:b'),
    };
  }

  function gapsMenu(n) {
    const list = ai.listGaps();
    const kb = new InlineKeyboard();
    list.slice(0, 8).forEach((g) => kb.text(`💬 ${g.count}× ${g.q.slice(0, 30)}`, `pn:qa:${g.id}`).text('🗑', `pn:qx:${g.id}`).row());
    if (list.length) kb.text('🗑 Clear all', 'pn:qc').row();
    kb.text('⬅️ Back', 'pn:ai');
    return { text: note(n, list.length ? `❓ <b>Unanswered questions (${list.length})</b>\nTap one to teach the AI the answer. 🗑 removes it.` : '✅ <b>No unanswered questions.</b>\nWhen the AI is asked something its knowledge does not cover, it appears here.'), kb };
  }

  function destMenu(id, n) {
    const s = store.chat(id);
    const kb = new InlineKeyboard();
    for (const [k, p] of Object.entries(dest.PURPOSES)) kb.text(`${p.label}: ${dest.where(dest.get(store, id, k), id)}`, `pn:dp:${id}:${k}`).text('❌', `pn:dc:${id}:${k}`).row();
    kb.text('⬅️ Back', `pn:g:${id}`);
    return { text: note(n, `📍 <b>Destinations</b> · ${title(s, id)}\nChoose where each kind of post goes: a topic of this group or (for some) a channel. Tap one to set it, ❌ to post in the group itself again.\nTip: open the topic and send <code>/setdest releases</code> there.`), kb };
  }

  function globalMenu(n) {
    const kb = new InlineKeyboard();
    for (const [k, l] of Object.entries(dest.GLOBAL)) kb.text(`${l}: ${dest.where(dest.getGlobal(store, k), 0)}`, `pn:gp:${k}`).text('❌', `pn:gc:${k}`).row();
    kb.text('⬅️ Back', 'pn:b');
    return { text: note(n, '📍 <b>Channels for all groups</b>\nAnnouncements you send from the panel (or /announce) also go to the announcement channel. New releases of the WhatsApp bot go to the release channel. I must be an admin of the channel.'), kb };
  }

  const sel = new Map(); // owner id -> chats chosen for an announcement
  const selCh = new Map(); // owner id -> include the announcement channel?
  function announceMenu(ownerId) {
    const ids = store.chatIds().slice(0, 30);
    if (!sel.has(ownerId)) sel.set(ownerId, new Set(ids));
    const chosen = sel.get(ownerId);
    const kb = new InlineKeyboard();
    for (const id of ids) kb.text(`${chosen.has(id) ? '✅' : '⬜'} ${store.chat(id).title || id}`, `pn:as:${id}`).row();
    if (dest.getGlobal(store, 'announce')) kb.text(`📣 Channel: ${selCh.get(ownerId) !== false ? '✅' : '⬜'}`, 'pn:ac').row();
    kb.text('Select all', 'pn:aa:1').text('Select none', 'pn:aa:0').row().text('➡️ Write the message', 'pn:ag').row().text('⬅️ Back', 'pn:b');
    return { text: ids.length ? `📢 <b>Announce</b>\nChoose the groups (${chosen.size} selected):` : '📢 I am not in any group yet.', kb };
  }

  function ticketsMenu(n) {
    const open = Object.values(store.data.support.items).filter((t) => t.status === 'open').sort((a, b) => a.created - b.created);
    const kb = new InlineKeyboard();
    open.slice(0, 15).forEach((t) => kb.text(`✅ Close #${t.id} · ${t.name.slice(0, 16)}`, `pn:tc:${t.id}`).row());
    kb.text('⬅️ Back', 'pn:s');
    return { text: note(n, open.length ? `📋 <b>Open tickets (${open.length})</b>\nAnswer by replying to the ticket message in your chat with me. Tap to close:` : '✅ No open tickets.'), kb };
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
      case 'mo': return done(moreMenu(id));
      case 'nb': s.newbie.hours = NEXT_NEWBIE[s.newbie.hours] || 0; store.save(); return done(moreMenu(id));
      case 'we': s.warnExpiryDays = NEXT_EXPIRY[s.warnExpiryDays] || 0; store.save(); return done(moreMenu(id));
      case 'rt': s.raid.threshold = NEXT_RAID[s.raid.threshold] || 8; store.save(); return done(moreMenu(id));
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
        if (b === 'lv') s.levels.enabled = !s.levels.enabled;
        if (b === 'rl') s.releases = !s.releases;
        if (b === 'ra') s.raid.auto = !s.raid.auto;
        if (b === 'gs') s.gban = !s.gban;
        if (b === 'as') s.aiscan = !s.aiscan;
        if (b === 'su') s.summary = !s.summary;
        if (b === 'nm') s.night.enabled = !s.night.enabled;
        if (b === 'rm') s.raid.active = s.raid.active > Date.now() ? 0 : 1e15;
        store.save();
        return done(MORE_KEYS.includes(b) ? moreMenu(id) : WELCOME_KEYS.includes(b) ? welcomeMenu(id) : protectMenu(id));
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
      case 'rc': {
        await ctx.answerCallbackQuery({ text: 'Checking GitHub…' });
        try {
          const r = await releases.checkNow(ctx.api, store);
          return show(ctx, updatesMenu(!r.rel ? 'No release found yet.' : r.announced ? `✅ Announced ${esc(r.rel.name)}.` : `📦 Latest release: ${esc(r.rel.name)}${r.first ? ' (remembered; the next new one will be announced)' : ' (already announced)'}.`));
        } catch (e) { return show(ctx, updatesMenu('❌ ' + esc(e.message))); }
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
      case 'st': return done(statusMenu(ctx));
      case 'qg': return done(gapsMenu());
      case 'qa': {
        const g = ai.getGap(a);
        if (!g) return done(gapsMenu('That question is gone.'));
        return prompt('gap', { gapId: a }, `💬 <b>${esc(g.q)}</b>\nAsked ${g.count} time(s). Send the answer the AI should give. It is saved as knowledge.`);
      }
      case 'qx': ai.removeGap(a); toast = 'Removed'; return done(gapsMenu());
      case 'qc': return done(confirm('🗑 Remove all unanswered questions?', 'pn:qy', 'pn:qg'));
      case 'qy': ai.clearGaps(); return done(gapsMenu('🗑 Cleared.'));
      case 'an': return done(announceMenu(ctx.from.id));
      case 'as': { const c = sel.get(ctx.from.id) || new Set(); if (store.chatIds().includes(id)) { if (c.has(id)) c.delete(id); else c.add(id); } sel.set(ctx.from.id, c); return done(announceMenu(ctx.from.id)); }
      case 'aa': sel.set(ctx.from.id, a === '1' ? new Set(store.chatIds()) : new Set()); return done(announceMenu(ctx.from.id));
      case 'ac': selCh.set(ctx.from.id, selCh.get(ctx.from.id) === false); return done(announceMenu(ctx.from.id));
      case 'ag': {
        const chosen = [...(sel.get(ctx.from.id) || [])].filter((x) => store.chatIds().includes(x));
        const ch = !!dest.getGlobal(store, 'announce') && selCh.get(ctx.from.id) !== false;
        if (!chosen.length && !ch) { toast = 'Select at least one group'; return done(announceMenu(ctx.from.id)); }
        return prompt('announce', { sel: chosen, ch }, `📢 Send the announcement. It goes to ${chosen.length} group(s)${ch ? ' and the announcement channel' : ''}.`);
      }
      case 'ds': return done(destMenu(id));
      case 'dp': {
        const p = dest.PURPOSES[b];
        if (!p) return ctx.answerCallbackQuery();
        return prompt('dest', { chatId: id, purpose: b }, `📍 <b>${esc(p.label)}</b> · ${title(s, id)}\nSend a topic link of this group${p.any ? ', a channel ID or an @channel (I must be admin there)' : ''}.\nOr open the topic and send <code>/setdest ${b}</code> there.`);
      }
      case 'dc': if (s.dest && s.dest[b]) { delete s.dest[b]; store.save(); toast = 'Cleared'; } return done(destMenu(id));
      case 'gd': return done(globalMenu());
      case 'gp': {
        if (!dest.GLOBAL[a]) return ctx.answerCallbackQuery();
        return prompt('gdest', { purpose: a }, `📍 <b>${esc(dest.GLOBAL[a])}</b> (all groups)\nSend the channel ID, an @channel or a topic link. I must be an admin there.`);
      }
      case 'gc': if (store.data.settings.dest && store.data.settings.dest[a]) { delete store.data.settings.dest[a]; store.save(); toast = 'Cleared'; } return done(globalMenu());
      case 'ss': { await ctx.answerCallbackQuery({ text: 'Collecting stats…' }); return show(ctx, { text: await ops.statsText(ctx.api, store), kb: new InlineKeyboard().text('🔄 Refresh', 'pn:ss').text('⬅️ Back', 'pn:b') }); }
      case 'tk': return done(ticketsMenu());
      case 'tc': { const t = await support.closeTicket(ctx.api, id, ''); toast = t ? 'Closed' : 'Not open'; return done(ticketsMenu(t ? `✅ Closed #${id}.` : '')); }
      case 'ks': ai.setAiSources(!ai.aiSources()); return done(aiMenu());
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
        const m = { welcome: welcomeMenu, goodbye: welcomeMenu, rules: contentMenu, faq: faqMenu, filter: filterMenu, word: wordsMenu, dest: destMenu }[w.type];
        return m ? m(w.chatId, n) : groupMenu(ctx, w.chatId, n);
      }
      if (w.type === 'block') return supportMenu(n);
      if (w.type === 'announce') return mainMenu(n);
      if (w.type === 'gdest') return globalMenu(n);
      if (w.type === 'gap') return gapsMenu(n);
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
        case 'gap': {
          const g = ai.answerGap(w.gapId, text);
          menu = back(`✅ Learned. It can now answer: ${esc(g.q)}`);
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
          const r = await dest.announce(ctx.api, store, w.sel || store.chatIds(), '📢 ' + text, w.ch !== false);
          menu = back(`✅ Sent to ${r.ok} group(s)${r.channel ? ' and the announcement channel' : ''}.`);
          break;
        }
        case 'dest': {
          const target = await dest.parseTarget(ctx.api, text, null);
          await dest.setDest(ctx.api, store, w.chatId, w.purpose, target);
          menu = back(`✅ ${esc(dest.PURPOSES[w.purpose].label)} will be posted in ${esc(dest.where(target, w.chatId))}.`);
          break;
        }
        case 'gdest': {
          const target = await dest.parseTarget(ctx.api, text, null);
          await dest.setGlobal(ctx.api, store, w.purpose, target);
          menu = back(`✅ ${esc(dest.GLOBAL[w.purpose])} will also be posted in ${esc(dest.where(target, 0))}.`);
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
