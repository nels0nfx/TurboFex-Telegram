'use strict';
const { adminOnly, isAdminId, botRights } = require('./perms');
const actions = require('./actions');
const warnMod = require('./warn');
const cfg = require('./config');
const { say, mention, mentionOf, esc, getTarget, parseDuration, fmtDuration, onOff } = require('./util');

const MAX_TEXT = 3500;
const ACTIONS = ['mute', 'kick', 'ban'];

function register(bot, store) {
  const chatOf = (ctx) => store.chat(ctx.chat.id);

  // Returns the target if it is safe to act on, otherwise replies and returns null.
  async function pick(ctx) {
    const { target, rest } = getTarget(ctx);
    if (!target) { await say(ctx, 'Reply to a user\'s message, or give their numeric ID.'); return null; }
    if (target.id === ctx.me.id) { await say(ctx, "I can't do that to myself."); return null; }
    if (await isAdminId(ctx.api, ctx.chat.id, target.id)) { await say(ctx, "I can't do that to an admin."); return null; }
    return { target, rest };
  }

  const fail = (ctx, e) => say(ctx, '⚠️ ' + esc(actions.explain(e)));

  // duration (optional first word) + reason (the rest)
  function durationAndReason(rest) {
    const dur = rest[0] ? parseDuration(rest[0]) : null;
    return { dur, reason: (dur ? rest.slice(1) : rest).join(' ') };
  }
  const reasonLine = (r) => (r ? `\nReason: ${esc(r)}` : '');

  bot.command('warn', adminOnly, async (ctx) => {
    const p = await pick(ctx); if (!p) return;
    try {
      return say(ctx, await warnMod.warn(ctx.api, store, ctx.chat.id, p.target, p.rest.join(' ')));
    } catch (e) { return fail(ctx, e); }
  });

  bot.command('unwarn', adminOnly, async (ctx) => {
    const { target } = getTarget(ctx);
    if (!target) return say(ctx, 'Reply to a user\'s message, or give their numeric ID.');
    const s = chatOf(ctx);
    const key = String(target.id);
    s.warns[key] = Math.max(0, (s.warns[key] || 0) - 1);
    if (!s.warns[key]) delete s.warns[key];
    store.save();
    return say(ctx, `✅ Removed one warning from ${mentionOf(target)}. Now ${s.warns[key] || 0}/${s.warnLimit}.`);
  });

  bot.command('warns', adminOnly, async (ctx) => {
    const { target } = getTarget(ctx);
    if (!target) {
      const list = Object.entries(chatOf(ctx).warns);
      if (!list.length) return say(ctx, 'Nobody has warnings.');
      return say(ctx, '⚠️ <b>Warnings</b>\n' + list.map(([id, n]) => `<a href="tg://user?id=${id}">${id}</a>: ${n}/${chatOf(ctx).warnLimit}`).join('\n'));
    }
    return say(ctx, `${mentionOf(target)} has ${chatOf(ctx).warns[String(target.id)] || 0}/${chatOf(ctx).warnLimit} warnings.`);
  });

  bot.command('mute', adminOnly, async (ctx) => {
    const p = await pick(ctx); if (!p) return;
    const { dur, reason } = durationAndReason(p.rest);
    try { await actions.mute(ctx.api, ctx.chat.id, p.target.id, dur || 0); } catch (e) { return fail(ctx, e); }
    return say(ctx, `🔇 ${mentionOf(p.target)} muted ${dur ? 'for ' + fmtDuration(dur) : 'until an admin uses /unmute'}.${reasonLine(reason)}`);
  });

  bot.command('unmute', adminOnly, async (ctx) => {
    const { target } = getTarget(ctx);
    if (!target) return say(ctx, 'Reply to a user\'s message, or give their numeric ID.');
    try { await actions.unmute(ctx.api, ctx.chat.id, target.id); } catch (e) { return fail(ctx, e); }
    return say(ctx, `🔊 ${mentionOf(target)} can talk again.`);
  });

  bot.command('kick', adminOnly, async (ctx) => {
    const p = await pick(ctx); if (!p) return;
    try { await actions.kick(ctx.api, ctx.chat.id, p.target.id); } catch (e) { return fail(ctx, e); }
    return say(ctx, `👢 ${mentionOf(p.target)} was removed. They can rejoin with an invite link.${reasonLine(p.rest.join(' '))}`);
  });

  bot.command('ban', adminOnly, async (ctx) => {
    const p = await pick(ctx); if (!p) return;
    const { dur, reason } = durationAndReason(p.rest);
    try { await actions.ban(ctx.api, ctx.chat.id, p.target.id, dur || 0); } catch (e) { return fail(ctx, e); }
    return say(ctx, `⛔ ${mentionOf(p.target)} banned ${dur ? 'for ' + fmtDuration(dur) : 'permanently'}.${reasonLine(reason)}`);
  });

  bot.command('unban', adminOnly, async (ctx) => {
    const { target } = getTarget(ctx);
    if (!target) return say(ctx, 'Give the numeric ID of the user: <code>/unban 123456789</code>');
    try { await actions.unban(ctx.api, ctx.chat.id, target.id); } catch (e) { return fail(ctx, e); }
    return say(ctx, `✅ ${mentionOf(target)} was unbanned.`);
  });

  bot.command('del', adminOnly, async (ctx) => {
    const r = ctx.msg.reply_to_message;
    if (!r || r.forum_topic_created) return say(ctx, 'Reply to the message you want to delete.');
    try { await ctx.api.deleteMessage(ctx.chat.id, r.message_id); } catch (e) { return fail(ctx, e); }
    ctx.deleteMessage().catch(() => {});
  });

  bot.command('pin', adminOnly, async (ctx) => {
    const r = ctx.msg.reply_to_message;
    if (!r || r.forum_topic_created) return say(ctx, 'Reply to the message you want to pin. Add <code>loud</code> to notify everyone.');
    const loud = /\bloud\b/i.test(String(ctx.match || ''));
    try { await ctx.api.pinChatMessage(ctx.chat.id, r.message_id, { disable_notification: !loud }); } catch (e) { return fail(ctx, e); }
  });

  bot.command('unpin', adminOnly, async (ctx) => {
    const r = ctx.msg.reply_to_message;
    try {
      if (r && !r.forum_topic_created) await ctx.api.unpinChatMessage(ctx.chat.id, { message_id: r.message_id });
      else await ctx.api.unpinChatMessage(ctx.chat.id);
    } catch (e) { return fail(ctx, e); }
    return say(ctx, '📌 Unpinned.');
  });

  bot.command('setwelcome', adminOnly, async (ctx) => {
    const text = String(ctx.match || '').trim();
    const s = chatOf(ctx);
    if (!text) {
      return say(ctx, 'Usage: <code>/setwelcome your text</code>\nPlaceholders: <code>{mention}</code> <code>{name}</code> <code>{chat}</code> <code>{id}</code>\nBasic HTML works: &lt;b&gt;bold&lt;/b&gt;, &lt;i&gt;italic&lt;/i&gt;.\n\n<b>Current:</b>\n' + esc(s.welcome.text));
    }
    if (text.length > MAX_TEXT) return say(ctx, 'That is too long. Keep it under 3500 characters.');
    s.welcome.text = text;
    store.save();
    return say(ctx, '✅ Welcome message updated.');
  });

  bot.command('setrules', adminOnly, async (ctx) => {
    const text = String(ctx.match || '').trim();
    if (!text) return say(ctx, 'Usage: <code>/setrules your rules</code> (new lines are kept).');
    if (text.length > MAX_TEXT) return say(ctx, 'That is too long. Keep it under 3500 characters.');
    chatOf(ctx).rules = text;
    store.save();
    return say(ctx, '✅ Rules updated. Members can read them with /rules.');
  });

  function toggle(name, label, apply) {
    bot.command(name, adminOnly, async (ctx) => {
      const v = onOff(String(ctx.match || '').trim().split(/\s+/)[0]);
      if (v === null) return say(ctx, `Usage: <code>/${name} on</code> or <code>/${name} off</code>`);
      apply(chatOf(ctx), v, String(ctx.match || '').trim().split(/\s+/)[1]);
      store.save();
      return say(ctx, `${v ? '✅' : '⛔'} ${label} ${v ? 'enabled' : 'disabled'}.`);
    });
  }
  toggle('welcome', 'Welcome message', (s, v) => { s.welcome.enabled = v; });
  toggle('antilink', 'Link blocking', (s, v) => { s.antilink = v; });
  toggle('captcha', 'Join captcha', (s, v, secs) => {
    s.captcha.enabled = v;
    const n = Number(secs);
    if (v && n >= 30 && n <= 600) s.captcha.timeout = Math.round(n);
  });

  bot.command('warnlimit', adminOnly, async (ctx) => {
    const n = Number(String(ctx.match || '').trim());
    if (!Number.isInteger(n) || n < 1 || n > 20) return say(ctx, 'Usage: <code>/warnlimit 3</code> (1 to 20)');
    chatOf(ctx).warnLimit = n;
    store.save();
    return say(ctx, `✅ Users are punished after ${n} warning(s).`);
  });

  bot.command('warnaction', adminOnly, async (ctx) => {
    const a = String(ctx.match || '').trim().toLowerCase();
    if (!ACTIONS.includes(a)) return say(ctx, 'Usage: <code>/warnaction mute</code>, <code>kick</code> or <code>ban</code>');
    chatOf(ctx).warnAction = a;
    store.save();
    return say(ctx, `✅ At the warning limit users will be: <b>${a}</b>.`);
  });

  bot.command(['addfaq', 'addnote'], adminOnly, async (ctx) => {
    const m = /^(\S+)\s+([\s\S]+)$/.exec(String(ctx.match || '').trim());
    if (!m) return say(ctx, 'Usage: <code>/addfaq topic answer text</code>');
    const key = m[1].toLowerCase().replace(/^\//, '').slice(0, 32);
    const s = chatOf(ctx);
    if (!s.faq[key] && Object.keys(s.faq).length >= 50) return say(ctx, 'You already have 50 FAQ entries. Remove one with /delfaq first.');
    if (m[2].length > MAX_TEXT) return say(ctx, 'That answer is too long. Keep it under 3500 characters.');
    s.faq[key] = m[2];
    store.save();
    return say(ctx, `✅ FAQ saved. Members can use <code>/faq ${esc(key)}</code>`);
  });

  bot.command(['delfaq', 'delnote'], adminOnly, async (ctx) => {
    const key = String(ctx.match || '').trim().toLowerCase();
    const s = chatOf(ctx);
    if (!s.faq[key]) return say(ctx, 'No FAQ entry with that name. Send /faq to see the list.');
    delete s.faq[key];
    store.save();
    return say(ctx, '🗑 FAQ entry removed.');
  });

  bot.command('settings', adminOnly, async (ctx) => {
    const s = chatOf(ctx);
    const r = await botRights(ctx);
    const yn = (v) => (v ? '✅ on' : '⛔ off');
    const rights = r.missing.length ? `⚠️ I still need to: ${r.missing.join(', ')}` : '✅ I have all the rights I need';
    return say(ctx, [
      '⚙️ <b>Group settings</b>',
      `Welcome: ${yn(s.welcome.enabled)}`,
      `Captcha: ${yn(s.captcha.enabled)} (${s.captcha.timeout}s)`,
      `Anti-link: ${yn(s.antilink)}`,
      `Anti-spam: ${yn(s.antispam.enabled)} (${s.antispam.limit} msgs / ${s.antispam.seconds}s → ${s.antispam.action})`,
      `Anti-bot: ${yn(s.antibot)} · Anti-mention: ${yn(s.antimention.enabled)} (max ${s.antimention.limit})`,
      `Goodbye: ${yn(s.goodbye.enabled)} · Clean join/leave messages: ${yn(s.cleanService)}`,
      `Locks: ${Object.keys(s.locks).filter((k) => s.locks[k]).join(', ') || 'none'}`,
      `Filters: ${Object.keys(s.filters).length} · Bad words: ${s.words.length} · Approved users: ${s.approved.length}`,
      `AI answers: ${yn(s.ai.enabled)}${cfg.AI_API_KEY ? '' : ' (no AI key set yet)'}`,
      `Warn limit: ${s.warnLimit} → ${s.warnAction}`,
      `Rules: ${s.rules ? 'set' : 'not set'}`,
      `FAQ entries: ${Object.keys(s.faq).length}`,
      '',
      rights,
    ].join('\n'));
  });
}

module.exports = { register };
