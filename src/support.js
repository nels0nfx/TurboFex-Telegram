'use strict';
const cfg = require('./config');
const { ownerOnly } = require('./perms');
const ai = require('./ai');
const { say, sayTo, esc, mention, displayName, fmtDuration, autoDelete } = require('./util');

const hits = new Map();
const acked = new Map();

const staff = () => [...new Set([...cfg.OWNER_IDS, ...cfg.SUPPORT_IDS])];
const isStaff = (id) => staff().includes(id);

function tooFast(uid) {
  const now = Date.now();
  const arr = (hits.get(uid) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(uid, arr);
  if (hits.size > 2000) hits.clear();
  return arr.length > 5;
}

const support = {};
function register(bot, store) {
  const staffOnly = async (ctx, next) => {
    if (!ctx.from || !isStaff(ctx.from.id)) return;
    return next();
  };

  // A user writes to the bot in private -> forward to the team
  async function incoming(ctx) {
    if (store.isBlocked(ctx.from.id)) return;
    if (await ai.answerDM(ctx)) return; // the AI answered; the member can tap "Send this to the team"
    return forward(ctx, ctx.msg.message_id);
  }

  async function forward(ctx, messageId, always = false) {
    const uid = ctx.from.id;
    if (store.isBlocked(uid) || tooFast(uid)) return;
    const targets = staff();
    if (!targets.length) return say(ctx, 'Support is not set up yet. Please try again later.');
    const sup = store.data.support;
    let tk = Object.values(sup.items).find((x) => x.userId === uid && x.status === 'open');
    const isNew = !tk;
    if (isNew) {
      tk = { id: sup.next++, userId: uid, name: displayName(ctx.from), username: ctx.from.username || '', status: 'open', created: Date.now(), updated: Date.now(), count: 0 };
      sup.items[tk.id] = tk;
      const keys = Object.keys(sup.items);
      if (keys.length > 1000) keys.filter((k) => sup.items[k].status === 'closed').slice(0, keys.length - 1000).forEach((k) => delete sup.items[k]);
    }
    tk.count++;
    tk.updated = Date.now();
    store.save();
    const user = ctx.from.username ? ` (@${esc(ctx.from.username)})` : '';
    const header = `📩 <b>Ticket #${tk.id}</b>${isNew ? ' (new)' : ''}\nFrom: ${mention(ctx.from)}${user}\nID: <code>${uid}</code>\n<i>Reply to this message to answer.</i>`;
    let delivered = 0;
    for (const t of targets) {
      try {
        const h = await ctx.api.sendMessage(t, header, { parse_mode: 'HTML' });
        const c = await ctx.api.copyMessage(t, ctx.chat.id, messageId);
        store.addTicket(t, h.message_id, uid);
        store.addTicket(t, c.message_id, uid);
        delivered++;
      } catch (e) {
        console.error(`support: could not reach ${t}:`, e.description || e.message);
      }
    }
    if (!delivered) return say(ctx, '⚠️ I could not reach the team right now. Please try again later.');
    if (isNew || always || Date.now() - (acked.get(uid) || 0) > 600000) {
      acked.set(uid, Date.now());
      await say(ctx, isNew ? `✅ Sent to the team as <b>ticket #${tk.id}</b>. You will get the reply here.` : '✅ Sent to the team. You will get the reply here.');
    }
  }

  async function deliver(api, uid, fn) {
    await api.sendMessage(uid, '💬 <b>Reply from the TurboFex team:</b>', { parse_mode: 'HTML' });
    await fn();
  }

  bot.callbackQuery(/^ai:team:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.editMessageReplyMarkup().catch(() => {});
    if (isStaff(ctx.from.id)) return;
    return forward(ctx, Number(ctx.match[1]), true);
  });

  // Staff replies (reply to a ticket message in the DM)
  async function relay(ctx) {
    const r = ctx.msg.reply_to_message;
    const uid = r && store.getTicket(ctx.chat.id, r.message_id);
    if (!uid) return;
    try {
      await deliver(ctx.api, uid, () => ctx.api.copyMessage(uid, ctx.chat.id, ctx.msg.message_id));
      const n = await ctx.reply('✅ Sent.');
      autoDelete(ctx.api, ctx.chat.id, n.message_id, 4000);
    } catch (e) {
      await say(ctx, '⚠️ Could not deliver. The user may have blocked the bot.');
    }
  }

  bot.command('reply', staffOnly, async (ctx) => {
    const m = /^(\d{5,15})\s+([\s\S]+)$/.exec(String(ctx.match || '').trim());
    if (!m) return say(ctx, 'Usage: <code>/reply 123456789 your answer</code>\nOr simply reply to the ticket message.');
    try {
      await ctx.api.sendMessage(Number(m[1]), '💬 <b>Reply from the TurboFex team:</b>\n' + esc(m[2]), { parse_mode: 'HTML' });
      return say(ctx, '✅ Sent.');
    } catch (e) {
      return say(ctx, '⚠️ Could not deliver. The user may have blocked the bot or never started it.');
    }
  });

  bot.command('tickets', staffOnly, async (ctx) => {
    const open = Object.values(store.data.support.items).filter((t) => t.status === 'open').sort((a, b) => a.created - b.created);
    return say(ctx, open.length
      ? '📋 <b>Open tickets</b>\n' + open.slice(0, 30).map((t) => `#${t.id} · ${esc(t.name)} · ${t.count} msg · ${fmtDuration(Math.round((Date.now() - t.created) / 1000))} ago`).join('\n') + '\n\n<code>/close 12 optional message</code> closes one.'
      : '✅ No open tickets.');
  });

  async function closeTicket(api, id, msg) {
    const t = store.data.support.items[id];
    if (!t || t.status !== 'open') return null;
    t.status = 'closed';
    t.closed = Date.now();
    store.save();
    sayTo(api, t.userId, `✅ Your ticket #${t.id} was closed.${msg ? '\n' + esc(msg) : ''}\nWrite to me again any time to open a new one.`);
    return t;
  }
  bot.command('close', staffOnly, async (ctx) => {
    const m = /^#?(\d+)\s*([\s\S]*)$/.exec(String(ctx.match || '').trim());
    if (!m) return say(ctx, 'Usage: <code>/close 12</code> or <code>/close 12 Thanks, glad it works now!</code>');
    const t = await closeTicket(ctx.api, Number(m[1]), m[2].trim().slice(0, 500));
    return say(ctx, t ? `✅ Ticket #${t.id} closed and ${esc(t.name)} was told.` : 'There is no open ticket with that number.');
  });
  bot.command('mytickets', async (ctx) => {
    if (ctx.chat.type !== 'private' || !ctx.from) return;
    const mine = Object.values(store.data.support.items).filter((t) => t.userId === ctx.from.id).sort((a, b) => b.created - a.created).slice(0, 5);
    return say(ctx, mine.length ? '🎫 <b>Your tickets</b>\n' + mine.map((t) => `#${t.id} · ${t.status === 'open' ? '🟢 open' : '⚪ closed'} · ${new Date(t.created).toISOString().slice(0, 10)}`).join('\n') : 'You have no tickets. Just write me a message to open one.');
  });
  support.closeTicket = closeTicket;

  bot.command('block', ownerOnly, async (ctx) => {
    const id = Number(String(ctx.match || '').trim());
    if (!Number.isInteger(id) || id < 10000) return say(ctx, 'Usage: <code>/block 123456789</code>');
    store.block(id);
    return say(ctx, `⛔ <code>${id}</code> can no longer message support.`);
  });

  bot.command('unblock', ownerOnly, async (ctx) => {
    const id = Number(String(ctx.match || '').trim());
    if (!Number.isInteger(id) || id < 10000) return say(ctx, 'Usage: <code>/unblock 123456789</code>');
    store.unblock(id);
    return say(ctx, `✅ <code>${id}</code> can message support again.`);
  });

  // Keep this registered last: it handles plain (non-command) private messages
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type !== 'private' || !ctx.from) return next();
    if (ctx.msg.text && ctx.msg.text.startsWith('/')) return next();
    if (isStaff(ctx.from.id)) return relay(ctx);
    incoming(ctx).catch((e) => console.error('support:', e.message)); // do not hold up other updates
    return;
  });
}

module.exports = { register, support };
