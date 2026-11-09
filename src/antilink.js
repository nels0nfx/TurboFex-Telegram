'use strict';
const { isGroup, isSenderAdmin } = require('./perms');
const { say, mention, autoDelete } = require('./util');

const hasLink = (msg) => [...(msg.entities || []), ...(msg.caption_entities || [])].some((e) => e.type === 'url' || e.type === 'text_link');

function register(bot, store) {
  bot.on('message', async (ctx, next) => {
    if (!isGroup(ctx) || !hasLink(ctx.msg)) return next();
    if (!store.chat(ctx.chat.id).antilink) return next();
    if (await isSenderAdmin(ctx)) return next();
    try { await ctx.deleteMessage(); } catch (e) { return next(); }
    const note = await say(ctx, `🚫 ${mention(ctx.from)}, links are not allowed here.`);
    if (note) autoDelete(ctx.api, ctx.chat.id, note.message_id);
  });
}

module.exports = { register };
