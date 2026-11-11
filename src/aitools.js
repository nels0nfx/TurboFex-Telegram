'use strict';
const ai = require('./ai');
const { ownerOnly, isGroup, isSenderAdmin } = require('./perms');
const { say, displayName, onOff } = require('./util');

const buffer = new Map();
const cool = new Map();
const limited = (key, ms) => {
  const now = Date.now();
  if (now - (cool.get(key) || 0) < ms) return true;
  cool.set(key, now);
  if (cool.size > 2000) cool.clear();
  return false;
};
const replyTo = (ctx, id) => ({ reply_parameters: { message_id: id, allow_sending_without_reply: true } });

function register(bot, store) {
  const noAi = (ctx) => say(ctx, '⚠️ The AI is not set up yet. The owner needs to add AI_API_KEY.');
  const busy = (ctx) => say(ctx, '⚠️ The AI is busy right now. Please try again in a moment.');

  // chat memory for /summary (only when an admin switched it on; kept in memory, last 200 messages)
  bot.on('message:text', (ctx, next) => {
    if (!isGroup(ctx) || !ctx.from || ctx.from.is_bot || ctx.msg.text.startsWith('/')) return next();
    if (!store.chat(ctx.chat.id).summary) return next();
    const list = buffer.get(ctx.chat.id) || [];
    list.push({ name: displayName(ctx.from), text: ctx.msg.text.slice(0, 300) });
    if (list.length > 200) list.shift();
    buffer.set(ctx.chat.id, list);
    return next();
  });

  bot.command('translate', async (ctx) => {
    if (!ctx.from) return;
    const arg = String(ctx.match || '').trim();
    const r = ctx.msg.reply_to_message;
    let lang;
    let text;
    if (r && (r.text || r.caption)) { lang = arg || 'English'; text = r.text || r.caption; } else {
      const m = /^(.{2,30}?)\s*\|\s*([\s\S]+)$/.exec(arg);
      if (!m) return say(ctx, 'Reply to a message with <code>/translate</code> (English) or <code>/translate French</code>.\nOr: <code>/translate French | text to translate</code>');
      lang = m[1]; text = m[2];
    }
    lang = lang.replace(/[^\p{L}\s-]/gu, '').trim().slice(0, 30) || 'English';
    if (!ai.enabled()) return noAi(ctx);
    if (limited(`tr:${ctx.from.id}`, 10000) || !ai.canCall()) return;
    try {
      const out = await ai.raw(`Translate the user's text to ${lang}. Reply with only the translation, nothing else.`, text, 700);
      return say(ctx, ai.toHtml(out), r ? replyTo(ctx, r.message_id) : {});
    } catch (e) { return busy(ctx); }
  });

  bot.command('explain', async (ctx) => {
    if (!ctx.from) return;
    const r = ctx.msg.reply_to_message;
    const text = (r && (r.text || r.caption)) || String(ctx.match || '').trim();
    if (!text) return say(ctx, 'Reply to a message with <code>/explain</code>, or send <code>/explain some text</code>.');
    if (!ai.enabled()) return noAi(ctx);
    if (limited(`ex:${ctx.from.id}`, 10000) || !ai.canCall()) return;
    try {
      const out = await ai.raw(`Explain the user's message in simple words, in at most 80 words, in the same language. If it is about the TurboFex WhatsApp bot, use the KNOWLEDGE. Plain text.\n\nKNOWLEDGE:\n${ai.knowledgeFor(text) || '(empty)'}`, text, 500);
      return say(ctx, ai.toHtml(out), r ? replyTo(ctx, r.message_id) : {});
    } catch (e) { return busy(ctx); }
  });

  bot.command('summary', async (ctx) => {
    if (!isGroup(ctx) || !ctx.from) return;
    const s = store.chat(ctx.chat.id);
    const arg = String(ctx.match || '').trim().toLowerCase();
    const v = onOff(arg);
    if (v !== null) {
      if (!(await isSenderAdmin(ctx))) return;
      s.summary = v;
      if (!v) buffer.delete(ctx.chat.id);
      store.save();
      return say(ctx, v ? '✅ Chat summaries are on. I now remember the last 200 text messages (in memory only, cleared on restart) so /summary works.' : '⛔ Chat summaries are off and the remembered messages were deleted.');
    }
    if (!s.summary) return say(ctx, 'Chat summaries are off. An admin can switch them on with <code>/summary on</code>.');
    if (!ai.enabled()) return noAi(ctx);
    const list = buffer.get(ctx.chat.id) || [];
    const n = Math.min(200, Math.max(10, Number(arg) || 50));
    const part = list.slice(-n);
    if (part.length < 5) return say(ctx, 'There is not enough chat to summarize yet.');
    if (limited(`sum:${ctx.chat.id}`, 120000) || !ai.canCall()) return say(ctx, '⏳ A summary was made a moment ago. Please wait two minutes.');
    let transcript = part.map((m) => `${m.name}: ${m.text}`).join('\n');
    if (transcript.length > 6000) transcript = transcript.slice(-6000);
    try {
      const out = await ai.raw('Summarize this chat conversation in at most 8 short bullet points: what was discussed, open questions, decisions. Same language as the chat. Plain text.', transcript, 600);
      return say(ctx, `📝 <b>Summary of the last ${part.length} messages</b>\n\n${ai.toHtml(out)}`);
    } catch (e) { return busy(ctx); }
  });

  bot.command('aisources', ownerOnly, async (ctx) => {
    const v = onOff(String(ctx.match || '').trim().split(/\s+/)[0]);
    if (v === null) return say(ctx, `📚 AI answers ${ai.aiSources() ? 'name the section they used' : 'do not name their source'}.\n<code>/aisources on</code> · <code>/aisources off</code>`);
    ai.setAiSources(v);
    return say(ctx, v ? '✅ AI answers will end with the section they came from, for example [Getting started].' : '⛔ AI answers will not name their source.');
  });

}

module.exports = { register };
