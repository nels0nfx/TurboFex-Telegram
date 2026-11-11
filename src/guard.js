'use strict';
const actions = require('./actions');
const warnMod = require('./warn');
const ai = require('./ai');
const { adminOnly, ownerOnly, isAdminId } = require('./perms');
const { say, sayTo, esc, mention, mentionOf, displayName, getTarget, onOff, autoDelete } = require('./util');

const joins = new Map();
const FOREVER = 1e15;

// ----- moderation log -----
function log(api, store, chatId, html) {
  const s = store.chat(chatId);
  if (s.log && s.log.chat) sayTo(api, s.log.chat, html);
}
function logAction(ctx, store, action, target, extra) {
  log(ctx.api, store, ctx.chat.id, `📋 <b>${esc(action)}</b> · ${esc(ctx.chat.title || '')}\n${target ? 'User: ' + mentionOf(target) + '\n' : ''}${ctx.from ? 'By: ' + mention(ctx.from) : ''}${extra ? '\n' + esc(extra) : ''}`);
}

// ----- new members: recent-joiner memory, global bans, raid protection -----
// Returns true when the new member was removed.
async function onJoin(ctx, store, s, u) {
  const now = Date.now();
  s.joined[u.id] = now;
  for (const k of Object.keys(s.joined)) if (now - s.joined[k] > 7 * 86400000) delete s.joined[k];
  store.touch();
  const byAdmin = !!(ctx.from && ctx.from.id !== u.id && (await isAdminId(ctx.api, ctx.chat.id, ctx.from.id)));

  if (s.gban && store.data.gbans[u.id]) {
    try {
      await actions.ban(ctx.api, ctx.chat.id, u.id);
      const g = store.data.gbans[u.id];
      const n = await say(ctx, `🌐 ${esc(displayName(u))} is on the global ban list and was removed.`);
      if (n) autoDelete(ctx.api, ctx.chat.id, n.message_id, 10000);
      log(ctx.api, store, ctx.chat.id, `📋 <b>Global ban</b> · ${esc(ctx.chat.title || '')}\nUser: ${mentionOf({ id: u.id, name: displayName(u) })}${g.reason ? '\nReason: ' + esc(g.reason) : ''}`);
    } catch (e) { console.error('gban:', e.description || e.message); }
    return true;
  }

  const arr = (joins.get(ctx.chat.id) || []).filter((t) => now - t < 60000);
  arr.push(now);
  joins.set(ctx.chat.id, arr);
  if (s.raid.auto && arr.length >= s.raid.threshold && !(s.raid.active > now)) {
    s.raid.active = now + 15 * 60000;
    store.save();
    await say(ctx, `🚨 <b>Raid mode on</b> for 15 minutes: ${arr.length} people joined within a minute. New members are removed until it ends. Admins can use /raidmode off.`);
    log(ctx.api, store, ctx.chat.id, `📋 <b>Raid mode started</b> · ${esc(ctx.chat.title || '')}`);
  }
  if (s.raid.active > now && !byAdmin) {
    try { await actions.kick(ctx.api, ctx.chat.id, u.id); } catch (e) { console.error('raid:', e.description || e.message); }
    return true;
  }
  return false;
}

const isNewbie = (s, userId) => s.newbie.hours > 0 && !!s.joined[userId] && Date.now() - s.joined[userId] < s.newbie.hours * 3600000;

// ----- AI scam check (runs in the background, only for suspicious-looking messages) -----
const SUSPECT = /(https?:\/\/|t\.me\/|@\w{4,}|\bdm\b|inbox|whatsapp|crypto|bitcoin|btc|usdt|forex|invest|profit|airdrop|giveaway|earn|\$\d|binary|signal|wallet|loan|click|free money|100%)/i;
const SCAM_PROMPT = 'You are a spam and scam filter for a Telegram community about a WhatsApp bot. Decide whether the message is spam or a scam (crypto or investment schemes, fake giveaways, "DM me to earn", phishing, adult promotion, unsolicited ads). Normal questions, bot talk and links to GitHub or the TurboFex project are fine. Reply with only JSON: {"scam": true} or {"scam": false}.';

async function scanMessage(ctx, store, s) {
  const text = String(ctx.msg.text || ctx.msg.caption || '').slice(0, 600);
  if (text.length < 15 || !SUSPECT.test(text) || !ai.canCall()) return;
  const verdict = await ai.raw(SCAM_PROMPT, text, 40);
  if (!/"?scam"?\s*:\s*true/i.test(verdict)) return;
  ctx.deleteMessage().catch(() => {});
  const target = { id: ctx.from.id, name: displayName(ctx.from) };
  const t = await warnMod.warn(ctx.api, store, ctx.chat.id, target, 'suspected scam or spam');
  const n = await say(ctx, t);
  if (n) autoDelete(ctx.api, ctx.chat.id, n.message_id, 10000);
  log(ctx.api, store, ctx.chat.id, `📋 <b>AI scan removed a message</b> · ${esc(ctx.chat.title || '')}\nUser: ${mentionOf(target)}\n${esc(text.slice(0, 200))}`);
}

function register(bot, store) {
  const chatOf = (ctx) => store.chat(ctx.chat.id);

  bot.command('raidmode', adminOnly, async (ctx) => {
    const a = String(ctx.match || '').trim().toLowerCase().split(/\s+/);
    const s = chatOf(ctx);
    if (a[0] === 'on') { s.raid.active = FOREVER; store.save(); logAction(ctx, store, 'Raid mode on'); return say(ctx, '🚨 Raid mode is ON. New members are removed until you send /raidmode off.'); }
    if (a[0] === 'off') { s.raid.active = 0; store.save(); logAction(ctx, store, 'Raid mode off'); return say(ctx, '✅ Raid mode is off.'); }
    if (a[0] === 'auto') {
      const v = onOff(a[1]);
      if (v === null) return say(ctx, 'Usage: <code>/raidmode auto on</code>, <code>/raidmode auto off</code> or <code>/raidmode auto 10</code> (people per minute)');
      s.raid.auto = v;
      store.save();
      return say(ctx, `${v ? '✅' : '⛔'} Automatic raid detection is ${v ? 'on' : 'off'} (${s.raid.threshold} joins in a minute starts raid mode).`);
    }
    const on = s.raid.active > Date.now();
    return say(ctx, `🚨 <b>Raid mode</b>: ${on ? 'ON' : 'off'}\nAutomatic detection: ${s.raid.auto ? 'on' : 'off'} (${s.raid.threshold} joins in a minute)\n\n<code>/raidmode on</code> · <code>/raidmode off</code>\n<code>/raidmode auto on|off</code>`);
  });

  bot.command('newbie', adminOnly, async (ctx) => {
    const arg = String(ctx.match || '').trim().toLowerCase();
    const s = chatOf(ctx);
    if (arg === 'off' || arg === '0') { s.newbie.hours = 0; store.save(); return say(ctx, '⛔ New-member restrictions are off.'); }
    const h = Number(arg);
    if (Number.isFinite(h) && h >= 1 && h <= 720) { s.newbie.hours = Math.round(h); store.save(); return say(ctx, `✅ For their first ${s.newbie.hours} hours, new members cannot send links or forwarded messages.`); }
    return say(ctx, `🆕 <b>New-member restrictions</b>: ${s.newbie.hours ? s.newbie.hours + ' hours' : 'off'}\nNew members cannot send links or forwards at first.\n<code>/newbie 24</code> (hours) · <code>/newbie off</code>`);
  });

  bot.command('setlog', adminOnly, async (ctx) => {
    const arg = String(ctx.match || '').trim();
    const s = chatOf(ctx);
    if (arg === 'off' || arg === '0') { s.log.chat = 0; store.save(); return say(ctx, '⛔ Moderation log is off.'); }
    if (!/^-?\d{5,}$/.test(arg)) return say(ctx, `📋 Moderation log: ${s.log.chat ? '<code>' + s.log.chat + '</code>' : 'off'}\nUsage: <code>/setlog -1001234567890</code> (a channel or group where I am admin) or <code>/setlog off</code>`);
    const sent = await sayTo(ctx.api, Number(arg), `📋 Moderation log for <b>${esc(ctx.chat.title || '')}</b> is connected.`);
    if (!sent) return say(ctx, "⚠️ I could not post there. Add me to that channel or group as an admin and try again.");
    s.log.chat = Number(arg);
    store.save();
    return say(ctx, '✅ Warnings, mutes, bans, kicks, raids and AI scan removals will be logged there.');
  });

  bot.command('warnexpiry', adminOnly, async (ctx) => {
    const arg = String(ctx.match || '').trim().toLowerCase();
    const s = chatOf(ctx);
    if (arg === 'off' || arg === '0') { s.warnExpiryDays = 0; store.save(); return say(ctx, '⛔ Warnings no longer expire.'); }
    const d = Number(arg);
    if (Number.isFinite(d) && d >= 1 && d <= 365) { s.warnExpiryDays = Math.round(d); warnMod.prune(s); store.save(); return say(ctx, `✅ Warnings expire after ${s.warnExpiryDays} days.`); }
    return say(ctx, `⏳ <b>Warning expiry</b>: ${s.warnExpiryDays ? s.warnExpiryDays + ' days' : 'off'}\n<code>/warnexpiry 14</code> (days) · <code>/warnexpiry off</code>`);
  });

  bot.command('aiscan', adminOnly, async (ctx) => {
    const v = onOff(String(ctx.match || '').trim().split(/\s+/)[0]);
    const s = chatOf(ctx);
    if (v === null) return say(ctx, `🤖 AI scam scan is ${s.aiscan ? 'on' : 'off'}${ai.enabled() ? '' : ' (no AI key set)'}.\nIt checks messages with links or money talk from members and removes scams.\n<code>/aiscan on</code> · <code>/aiscan off</code>`);
    s.aiscan = v;
    store.save();
    return say(ctx, v ? '✅ AI scam scan is on. Admins and approved users are never scanned.' : '⛔ AI scam scan is off.');
  });

  bot.command('gbansync', adminOnly, async (ctx) => {
    const v = onOff(String(ctx.match || '').trim().split(/\s+/)[0]);
    const s = chatOf(ctx);
    if (v === null) return say(ctx, `🌐 Global ban list is ${s.gban ? 'used' : 'not used'} in this group.\n<code>/gbansync on</code> · <code>/gbansync off</code>`);
    s.gban = v;
    store.save();
    return say(ctx, v ? '✅ People on the global ban list are removed when they join.' : '⛔ This group ignores the global ban list.');
  });

  // ----- global bans (owner) -----
  bot.command('gban', ownerOnly, async (ctx) => {
    const { target, rest } = getTarget(ctx);
    if (!target) return say(ctx, 'Usage: <code>/gban 123456789 reason</code> (or reply to a message). Bans the user in every group I manage.');
    if (store.data.gbans[target.id]) return say(ctx, 'That user is already on the global ban list.');
    store.data.gbans[target.id] = { reason: rest.join(' ').slice(0, 200), at: Date.now(), by: ctx.from.id };
    store.save();
    let ok = 0;
    for (const id of store.chatIds()) {
      if (!store.chat(id).gban) continue;
      try { await actions.ban(ctx.api, id, target.id); ok++; } catch (e) { /* not a member or no rights there */ }
    }
    return say(ctx, `🌐 ${mentionOf(target)} was globally banned (${ok} group(s) updated). They are removed automatically when they join any group.`);
  });

  bot.command('ungban', ownerOnly, async (ctx) => {
    const { target } = getTarget(ctx);
    if (!target) return say(ctx, 'Usage: <code>/ungban 123456789</code>');
    if (!store.data.gbans[target.id]) return say(ctx, 'That user is not on the global ban list.');
    delete store.data.gbans[target.id];
    store.save();
    let ok = 0;
    for (const id of store.chatIds()) { try { await actions.unban(ctx.api, id, target.id); ok++; } catch (e) { /* ignore */ } }
    return say(ctx, `✅ ${mentionOf(target)} was removed from the global ban list (${ok} group(s) updated).`);
  });

  bot.command('gbans', ownerOnly, async (ctx) => {
    const list = Object.entries(store.data.gbans);
    return say(ctx, list.length ? `🌐 <b>Global bans (${list.length})</b>\n` + list.slice(0, 40).map(([id, g]) => `• <code>${id}</code>${g.reason ? ' · ' + esc(g.reason) : ''}`).join('\n') : 'The global ban list is empty.');
  });
}

// Called every 30 seconds
async function tick(api, store) {
  const now = Date.now();
  for (const id of store.chatIds()) {
    const s = store.chat(id);
    if (s.raid.active && s.raid.active < FOREVER && s.raid.active <= now) {
      s.raid.active = 0;
      store.save();
      sayTo(api, id, '✅ Raid mode is over. New members can join again.');
    }
    if (s.warnExpiryDays) warnMod.prune(s);
  }
}

const looksSuspicious = (text) => String(text).length >= 15 && SUSPECT.test(text);

module.exports = { register, tick, onJoin, isNewbie, scanMessage, looksSuspicious, log, logAction };
