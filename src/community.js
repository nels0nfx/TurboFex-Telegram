'use strict';
const crypto = require('crypto');
const { InlineKeyboard } = require('grammy');
const actions = require('./actions');
const guard = require('./guard');
const dest = require('./dest');
const { adminOnly, isGroup } = require('./perms');
const { say, sayTo, esc, mention, mentionOf, displayName, getTarget, onOff, parseDuration, fmtDuration, autoDelete } = require('./util');

const levelOf = (xp) => Math.floor(Math.sqrt(xp / 100));
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const pad = (n) => String(n).padStart(2, '0');

const localMinutes = (tz, now) => (((Math.floor(now / 60000) + Math.round(tz * 60)) % 1440) + 1440) % 1440;
function nextDaily(at, tz, now) {
  const [h, m] = at.split(':').map(Number);
  const d = new Date(now + tz * 3600000);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + (h * 60 + m) * 60000 - tz * 3600000;
  if (t <= now) t += 86400000;
  return t;
}
function inWindow(from, to, minutes) {
  const f = from.split(':').map(Number); const t = to.split(':').map(Number);
  const a = f[0] * 60 + f[1]; const b = t[0] * 60 + t[1];
  if (a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

async function endGiveaway(api, store, chatId, id) {
  const s = store.chat(chatId);
  const g = s.giveaways[id];
  if (!g) return;
  delete s.giveaways[id];
  store.save();
  const pool = [...g.entries];
  const winners = [];
  while (pool.length && winners.length < g.winners) winners.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  const text = winners.length
    ? `🎉 <b>Giveaway ended!</b>\nPrize: ${esc(g.prize)}\n\n🏆 Winner${winners.length > 1 ? 's' : ''}: ${winners.map((w) => mentionOf(w)).join(', ')}\nCongratulations! An admin will contact you.`
    : `🎉 <b>Giveaway ended</b>\nPrize: ${esc(g.prize)}\n\nNobody joined this time.`;
  api.editMessageText(chatId, g.msgId, `🎉 <b>Giveaway ended</b>\nPrize: ${esc(g.prize)}\nEntries: ${g.entries.length}`, { parse_mode: 'HTML' }).catch(() => {});
  await dest.send(api, store, chatId, 'giveaway', text, { reply_parameters: { message_id: g.msgId, allow_sending_without_reply: true } });
}

async function setNight(api, store, chatId, lock) {
  const s = store.chat(chatId);
  try {
    if (lock) {
      const chat = await api.getChat(chatId);
      s.night.saved = chat.permissions || null;
      await api.setChatPermissions(chatId, actions.NO_PERMS);
      s.night.active = true;
      sayTo(api, chatId, `🌙 <b>Night mode</b>: the group is quiet until ${esc(s.night.to)}. Good night!`);
    } else {
      await api.setChatPermissions(chatId, s.night.saved || actions.FULL_PERMS);
      s.night.active = false;
      s.night.saved = null;
      sayTo(api, chatId, '☀️ <b>Good morning!</b> Night mode is over, the chat is open again.');
    }
    store.save();
  } catch (e) {
    console.error('night mode:', e.description || e.message);
    if (!lock) { s.night.active = false; store.save(); }
  }
}

// Called every 30 seconds: reminders, schedules, giveaways, night mode
async function tick(api, store) {
  const now = Date.now();
  const due = store.data.reminders.filter((r) => r.at <= now);
  if (due.length) {
    store.data.reminders = store.data.reminders.filter((r) => r.at > now);
    store.save();
    for (const r of due) sayTo(api, r.chat, `⏰ <a href="tg://user?id=${r.user}">${esc(r.name)}</a>, reminder: ${esc(r.text)}`, r.thread ? { message_thread_id: r.thread } : {});
  }
  for (const id of store.chatIds()) {
    const s = store.chat(id);
    for (const it of s.schedules) {
      if (it.next > now) continue;
      dest.send(api, store, id, 'schedule', it.text);
      it.next = it.kind === 'daily' ? nextDaily(it.at, s.tz, now) : now + it.every * 1000;
      store.save();
    }
    for (const g of Object.values(s.giveaways)) if (g.end <= now) await endGiveaway(api, store, id, g.id);
    if (s.night.enabled) {
      const inside = inWindow(s.night.from, s.night.to, localMinutes(s.tz, now));
      if (inside && !s.night.active) await setNight(api, store, id, true);
      else if (!inside && s.night.active) await setNight(api, store, id, false);
    } else if (s.night.active) await setNight(api, store, id, false);
  }
}

function register(bot, store) {
  const chatOf = (ctx) => store.chat(ctx.chat.id);

  // ----- XP and levels -----
  bot.on('message:text', (ctx, next) => {
    if (!isGroup(ctx) || !ctx.from || ctx.from.is_bot || ctx.msg.text.startsWith('/') || ctx.msg.text.length < 3) return next();
    const s = chatOf(ctx);
    if (!s.levels.enabled) return next();
    const key = String(ctx.from.id);
    let u = s.xp[key];
    if (!u) {
      const keys = Object.keys(s.xp);
      if (keys.length >= 5000) keys.sort((a, b) => s.xp[a].xp - s.xp[b].xp).slice(0, 500).forEach((k) => delete s.xp[k]);
      u = s.xp[key] = { xp: 0, last: 0, name: '', daily: 0, streak: 0 };
    }
    const now = Date.now();
    if (now - u.last < 60000) return next();
    u.last = now;
    u.name = displayName(ctx.from);
    const before = levelOf(u.xp);
    u.xp += 5 + crypto.randomInt(6);
    store.touch();
    if (levelOf(u.xp) > before) say(ctx, `🎉 ${mention(ctx.from)} reached <b>level ${levelOf(u.xp)}</b>!`).then((n) => n && autoDelete(ctx.api, ctx.chat.id, n.message_id, 15000));
    return next();
  });

  bot.command('levels', adminOnly, async (ctx) => {
    const v = onOff(String(ctx.match || '').trim().split(/\s+/)[0]);
    const s = chatOf(ctx);
    if (v === null) return say(ctx, `🏅 Levels are ${s.levels.enabled ? 'on' : 'off'}.\nMembers earn XP by chatting (once a minute) and with /daily. Commands: /rank, /top, /daily.\n<code>/levels on</code> · <code>/levels off</code>`);
    s.levels.enabled = v;
    store.save();
    return say(ctx, v ? '✅ Levels are on. Members earn XP by chatting. Try /rank, /top and /daily.' : '⛔ Levels are off (XP is kept).');
  });

  const position = (s, id) => Object.entries(s.xp).sort((a, b) => b[1].xp - a[1].xp).findIndex(([k]) => k === String(id)) + 1;
  bot.command('rank', async (ctx) => {
    if (!isGroup(ctx)) return;
    const s = chatOf(ctx);
    if (!s.levels.enabled) return;
    const { target } = getTarget(ctx);
    const t = target || { id: ctx.from.id, name: displayName(ctx.from) };
    const u = s.xp[String(t.id)];
    if (!u) return say(ctx, `${mentionOf(t)} has no XP yet. Chat a bit and try /daily.`);
    const lv = levelOf(u.xp);
    return say(ctx, `🏅 ${mentionOf(t)}\nLevel <b>${lv}</b> · ${u.xp} XP (next level at ${100 * (lv + 1) ** 2})\nRank #${position(s, t.id)} of ${Object.keys(s.xp).length}${u.streak > 1 ? `\n🔥 Daily streak: ${u.streak}` : ''}`);
  });

  bot.command('top', async (ctx) => {
    if (!isGroup(ctx)) return;
    const s = chatOf(ctx);
    if (!s.levels.enabled) return;
    const top = Object.entries(s.xp).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
    if (!top.length) return say(ctx, 'Nobody has XP yet.');
    const medal = ['🥇', '🥈', '🥉'];
    return say(ctx, '🏆 <b>Top members</b>\n' + top.map(([id, u], i) => `${medal[i] || i + 1 + '.'} <a href="tg://user?id=${id}">${esc(u.name || id)}</a> · level ${levelOf(u.xp)} · ${u.xp} XP`).join('\n'));
  });

  bot.command('daily', async (ctx) => {
    if (!isGroup(ctx) || !ctx.from) return;
    const s = chatOf(ctx);
    if (!s.levels.enabled) return;
    const key = String(ctx.from.id);
    const u = s.xp[key] || (s.xp[key] = { xp: 0, last: 0, name: '', daily: 0, streak: 0 });
    const now = Date.now();
    if (now - u.daily < 22 * 3600000) return say(ctx, `⏳ You already claimed today. Come back in ${fmtDuration(Math.ceil((22 * 3600000 - (now - u.daily)) / 1000))}.`);
    u.streak = now - u.daily < 48 * 3600000 ? u.streak + 1 : 1;
    u.daily = now;
    u.name = displayName(ctx.from);
    const reward = 100 + 25 * Math.min(u.streak, 10);
    u.xp += reward;
    store.save();
    return say(ctx, `🎁 ${mention(ctx.from)} claimed <b>+${reward} XP</b>! Level ${levelOf(u.xp)} · 🔥 streak ${u.streak}`);
  });

  // ----- polls and quizzes -----
  const parsePoll = (text) => text.split('|').map((x) => x.trim()).filter(Boolean);
  bot.command('poll', adminOnly, async (ctx) => {
    const p = parsePoll(String(ctx.match || ''));
    if (p.length < 3 || p.length > 11) return say(ctx, 'Usage: <code>/poll Question | option 1 | option 2 | option 3</code> (2 to 10 options)');
    try { await ctx.api.sendPoll(ctx.chat.id, p[0].slice(0, 290), p.slice(1).map((o) => ({ text: o.slice(0, 95) })), { is_anonymous: false }); } catch (e) { return say(ctx, '⚠️ ' + esc(actions.explain(e))); }
  });
  bot.command('quiz', adminOnly, async (ctx) => {
    const p = parsePoll(String(ctx.match || ''));
    const right = p.findIndex((o, i) => i > 0 && o.startsWith('*'));
    if (p.length < 3 || p.length > 11 || right < 1) return say(ctx, 'Usage: <code>/quiz Question | *Correct answer | Wrong answer | Another wrong</code>\nPut a star before the correct answer.');
    const opts = p.slice(1).map((o) => o.replace(/^\*/, '').trim().slice(0, 95));
    try { await ctx.api.sendPoll(ctx.chat.id, p[0].slice(0, 290), opts.map((o) => ({ text: o })), { type: 'quiz', correct_option_id: right - 1, is_anonymous: false }); } catch (e) { return say(ctx, '⚠️ ' + esc(actions.explain(e))); }
  });

  // ----- giveaways -----
  const giveawayKb = (id, n) => new InlineKeyboard().text(`🎉 Join (${n})`, `gw:${id}`);
  bot.command('giveaway', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    const arg = String(ctx.match || '').trim();
    if (/^end$/i.test(arg)) {
      const g = Object.values(s.giveaways)[0];
      return g ? endGiveaway(ctx.api, store, ctx.chat.id, g.id) : say(ctx, 'There is no active giveaway.');
    }
    const m = /^(\S+)\s+(\d{1,2})\s+([\s\S]+)$/.exec(arg);
    const dur = m && parseDuration(m[1]);
    if (!m || !dur || dur < 60 || dur > 14 * 86400) return say(ctx, 'Usage: <code>/giveaway 30m 2 A free pro key</code>\n(time, number of winners, prize) · <code>/giveaway end</code> ends it now.');
    if (Object.keys(s.giveaways).length >= 3) return say(ctx, 'There are already 3 active giveaways. End one with /giveaway end.');
    const id = crypto.randomBytes(4).toString('hex');
    const g = { id, prize: m[3].slice(0, 200), winners: Math.max(1, Number(m[2])), end: Date.now() + dur * 1000, entries: [], msgId: 0 };
    const msg = await dest.send(ctx.api, store, ctx.chat.id, 'giveaway', `🎉 <b>GIVEAWAY</b>\nPrize: ${esc(g.prize)}\nWinners: ${g.winners}\nEnds in ${fmtDuration(dur)}\n\nTap the button to join!`, { reply_markup: giveawayKb(id, 0) });
    if (!msg) return;
    g.msgId = msg.message_id;
    s.giveaways[id] = g;
    store.save();
  });
  bot.callbackQuery(/^gw:(\w+)$/, async (ctx) => {
    const s = store.chat(ctx.chat.id);
    const g = s.giveaways[ctx.match[1]];
    if (!g) return ctx.answerCallbackQuery({ text: 'This giveaway has ended.', show_alert: true });
    const i = g.entries.findIndex((e) => e.id === ctx.from.id);
    if (i >= 0) g.entries.splice(i, 1);
    else if (g.entries.length < 5000) g.entries.push({ id: ctx.from.id, name: displayName(ctx.from) });
    store.save();
    await ctx.answerCallbackQuery({ text: i >= 0 ? 'You left the giveaway.' : "You're in! Good luck 🍀" });
    ctx.editMessageReplyMarkup({ reply_markup: giveawayKb(g.id, g.entries.length) }).catch(() => {});
  });

  // ----- invite links and who brought whom -----
  bot.command('invite', async (ctx) => {
    if (!isGroup(ctx) || !ctx.from) return;
    const s = chatOf(ctx);
    let inv = s.invites[String(ctx.from.id)];
    if (!inv) {
      try {
        const link = await ctx.api.createChatInviteLink(ctx.chat.id, { name: `TF ${ctx.from.id}` });
        inv = s.invites[String(ctx.from.id)] = { link: link.invite_link, count: 0, name: displayName(ctx.from) };
        store.save();
      } catch (e) { return say(ctx, '⚠️ I could not create an invite link. I need the "invite users" admin right.'); }
    }
    return say(ctx, `🔗 Your personal invite link:\n${esc(inv.link)}\nEveryone who joins with it counts for you. See /invites.`);
  });
  bot.command(['invites', 'inviters'], async (ctx) => {
    if (!isGroup(ctx)) return;
    const top = Object.values(chatOf(ctx).invites).filter((i) => i.count > 0).sort((a, b) => b.count - a.count).slice(0, 10);
    return say(ctx, top.length ? '📈 <b>Top inviters</b>\n' + top.map((i, k) => `${k + 1}. ${esc(i.name)} · ${i.count}`).join('\n') : 'Nobody has invited anyone yet. Use /invite to get your link.');
  });
  bot.on('chat_member', async (ctx) => {
    const u = ctx.chatMember;
    const link = u && u.invite_link && u.invite_link.invite_link;
    if (!link || !['left', 'kicked'].includes(u.old_chat_member.status) || u.new_chat_member.status !== 'member') return;
    const entry = Object.values(store.chat(ctx.chat.id).invites).find((i) => i.link === link);
    if (!entry) return;
    entry.count++;
    store.save();
  });

  // ----- reminders (groups and private chat) -----
  bot.command('remind', async (ctx) => {
    if (!ctx.from) return;
    const m = /^(\S+)\s+([\s\S]+)$/.exec(String(ctx.match || '').trim());
    const dur = m && parseDuration(m[1]);
    if (!m || !dur || dur > 30 * 86400) return say(ctx, 'Usage: <code>/remind 2h call the bank</code>\nTime: 30s, 10m, 2h, 1d (up to 30 days).');
    if (store.data.reminders.filter((r) => r.user === ctx.from.id).length >= 5) return say(ctx, 'You already have 5 reminders. See /reminders.');
    store.data.reminders.push({ id: crypto.randomBytes(3).toString('hex'), chat: ctx.chat.id, user: ctx.from.id, name: displayName(ctx.from), at: Date.now() + dur * 1000, text: m[2].slice(0, 200), thread: ctx.msg.message_thread_id });
    store.save();
    return say(ctx, `⏰ Okay, I will remind you in ${fmtDuration(dur)}.`);
  });
  bot.command('reminders', async (ctx) => {
    if (!ctx.from) return;
    const mine = store.data.reminders.filter((r) => r.user === ctx.from.id);
    return say(ctx, mine.length ? '⏰ <b>Your reminders</b>\n' + mine.map((r, i) => `${i + 1}. in ${fmtDuration(Math.max(0, Math.round((r.at - Date.now()) / 1000)))} · ${esc(r.text)}`).join('\n') + '\n\n<code>/unremind 1</code> removes one.' : 'You have no reminders. Set one with /remind 2h text.');
  });
  bot.command('unremind', async (ctx) => {
    if (!ctx.from) return;
    const mine = store.data.reminders.filter((r) => r.user === ctx.from.id);
    const r = mine[Number(String(ctx.match || '').trim()) - 1];
    if (!r) return say(ctx, 'Usage: <code>/unremind 1</code> (the number from /reminders)');
    store.data.reminders = store.data.reminders.filter((x) => x !== r);
    store.save();
    return say(ctx, '🗑 Reminder removed.');
  });

  // ----- time zone, scheduled messages, night mode -----
  bot.command('timezone', adminOnly, async (ctx) => {
    const arg = String(ctx.match || '').trim();
    const s = chatOf(ctx);
    const h = Number(arg.replace(/^utc/i, ''));
    if (arg && Number.isFinite(h) && h >= -12 && h <= 14) { s.tz = h; store.save(); return say(ctx, `🌍 Time zone set to UTC${h >= 0 ? '+' : ''}${h}. Scheduled messages and night mode use it.`); }
    return say(ctx, `🌍 Time zone: UTC${s.tz >= 0 ? '+' : ''}${s.tz}\nNow: ${pad(Math.floor(localMinutes(s.tz, Date.now()) / 60))}:${pad(localMinutes(s.tz, Date.now()) % 60)}\n<code>/timezone +1</code> (hours from UTC)`);
  });

  bot.command('schedule', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    const arg = String(ctx.match || '').trim();
    const usage = 'Usage:\n<code>/schedule every 6h Text to post</code>\n<code>/schedule daily 18:00 Text to post</code>\n<code>/schedule list</code> · <code>/schedule del 2</code>\nDaily times use the group time zone (/timezone).';
    if (!arg || /^list$/i.test(arg)) {
      return say(ctx, s.schedules.length ? '🗓 <b>Scheduled messages</b>\n' + s.schedules.map((i) => `#${i.id} · ${i.kind === 'daily' ? 'daily ' + i.at : 'every ' + fmtDuration(i.every)} · ${esc(i.text.slice(0, 60))}`).join('\n') : usage);
    }
    let m;
    if ((m = /^del\s+(\d+)$/i.exec(arg))) {
      const n = s.schedules.length;
      s.schedules = s.schedules.filter((i) => i.id !== Number(m[1]));
      store.save();
      return say(ctx, s.schedules.length < n ? '🗑 Removed.' : 'No scheduled message with that number.');
    }
    if (s.schedules.length >= 20) return say(ctx, 'You already have 20 scheduled messages.');
    let item;
    if ((m = /^every\s+(\S+)\s+([\s\S]+)$/i.exec(arg))) {
      const sec = parseDuration(m[1]);
      if (!sec || sec < 600) return say(ctx, 'The interval must be at least 10 minutes, for example <code>6h</code>.\n' + usage);
      item = { kind: 'every', every: sec, next: Date.now() + sec * 1000, text: m[2] };
    } else if ((m = /^daily\s+(\d{1,2}:\d{2})\s+([\s\S]+)$/i.exec(arg)) && HHMM.test(m[1])) {
      item = { kind: 'daily', at: m[1].padStart(5, '0'), next: nextDaily(m[1], s.tz, Date.now()), text: m[2] };
    } else return say(ctx, usage);
    item.id = s.scheduleNext++;
    item.text = item.text.slice(0, 3500);
    s.schedules.push(item);
    store.save();
    return say(ctx, `✅ Scheduled as #${item.id}. First post in ${fmtDuration(Math.max(1, Math.round((item.next - Date.now()) / 1000)))}.`);
  });

  bot.command('nightmode', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    const a = String(ctx.match || '').trim().split(/\s+/);
    const v = onOff(a[0]);
    if (v === false) { s.night.enabled = false; store.save(); if (s.night.active) await setNight(ctx.api, store, ctx.chat.id, false); return say(ctx, '⛔ Night mode is off.'); }
    if (v === true) {
      if (a[1] || a[2]) {
        if (!HHMM.test(a[1] || '') || !HHMM.test(a[2] || '')) return say(ctx, 'Usage: <code>/nightmode on 23:00 06:00</code>');
        s.night.from = a[1].padStart(5, '0'); s.night.to = a[2].padStart(5, '0');
      }
      s.night.enabled = true;
      store.save();
      return say(ctx, `🌙 Night mode is on: the group is quiet from ${s.night.from} to ${s.night.to} (UTC${s.tz >= 0 ? '+' : ''}${s.tz}). I need the "restrict members" admin right.`);
    }
    return say(ctx, `🌙 <b>Night mode</b>: ${s.night.enabled ? 'on' : 'off'}${s.night.enabled ? ` (${s.night.from} to ${s.night.to}, UTC${s.tz >= 0 ? '+' : ''}${s.tz})` : ''}\n<code>/nightmode on 23:00 06:00</code> · <code>/nightmode off</code>\nChange the time zone with /timezone.`);
  });
}

module.exports = { register, tick, levelOf, nextDaily, inWindow, localMinutes };
