'use strict';
const cfg = require('./config');

const cache = new Map();
const TTL = 20000;

const isOwner = (id) => cfg.OWNER_IDS.includes(id);
const isGroup = (ctx) => !!ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup');

async function member(api, chatId, userId) {
  const key = chatId + ':' + userId;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.m;
  const m = await api.getChatMember(chatId, userId);
  cache.set(key, { t: Date.now(), m });
  return m;
}

async function isAdminId(api, chatId, userId) {
  if (isOwner(userId)) return true;
  try {
    const m = await member(api, chatId, userId);
    return m.status === 'administrator' || m.status === 'creator';
  } catch (e) {
    return false;
  }
}

async function isSenderAdmin(ctx) {
  if (!ctx.from) return false;
  // Anonymous admins post as the group itself
  if (ctx.msg && ctx.msg.sender_chat && ctx.msg.sender_chat.id === ctx.chat.id) return true;
  return isAdminId(ctx.api, ctx.chat.id, ctx.from.id);
}

// Admin commands: complete silence for everyone who is not an admin.
async function adminOnly(ctx, next) {
  if (!isGroup(ctx)) {
    if (ctx.from && isOwner(ctx.from.id)) await ctx.reply('Use this command inside your group.');
    return;
  }
  if (!(await isSenderAdmin(ctx))) return;
  return next();
}

async function ownerOnly(ctx, next) {
  if (!ctx.from || !isOwner(ctx.from.id)) return;
  return next();
}

async function botRights(ctx, chatId = ctx.chat.id) {
  try {
    const m = await ctx.api.getChatMember(chatId, ctx.me.id);
    if (m.status === 'creator') return { admin: true, missing: [] };
    if (m.status !== 'administrator') return { admin: false, missing: ['be an administrator'] };
    const need = { can_delete_messages: 'delete messages', can_restrict_members: 'ban/restrict users', can_pin_messages: 'pin messages' };
    return { admin: true, missing: Object.keys(need).filter((k) => !m[k]).map((k) => need[k]) };
  } catch (e) {
    return { admin: false, missing: ['be an administrator'] };
  }
}

module.exports = { isOwner, isGroup, isAdminId, isSenderAdmin, adminOnly, ownerOnly, botRights };
