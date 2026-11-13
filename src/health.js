'use strict';
const fs = require('fs');
const cfg = require('./config');
const ai = require('./ai');
const updater = require('./updater');
const { ownerOnly } = require('./perms');
const { say, sayTo, esc, fmtDuration } = require('./util');

const NEED = { can_delete_messages: 'delete messages', can_restrict_members: 'ban/restrict users', can_pin_messages: 'pin messages' };
const notifyOwners = (api, html) => Promise.all(cfg.OWNER_IDS.map((id) => sayTo(api, id, html)));
const version = () => { try { return updater.currentVersion(); } catch (e) { return '?'; } };

// What can the bot do in this group right now?
async function rights(api, chatId, meId) {
  try {
    const m = await api.getChatMember(chatId, meId);
    if (m.status === 'left' || m.status === 'kicked') return { state: 'removed', missing: [] };
    if (m.status === 'creator') return { state: 'ok', missing: [] };
    if (m.status !== 'administrator') return { state: 'missing', missing: ['be an administrator'] };
    const missing = Object.keys(NEED).filter((k) => !m[k]).map((k) => NEED[k]);
    return { state: missing.length ? 'missing' : 'ok', missing };
  } catch (e) {
    return { state: e && (e.error_code === 400 || e.error_code === 403) ? 'removed' : 'unknown', missing: [] };
  }
}
const sig = (r) => (r.state === 'missing' ? 'missing:' + r.missing.join(',') : r.state);

async function healthText(api, store, meId) {
  const st = store.data.settings;
  const up = Math.floor(process.uptime());
  const i = ai.info();
  const open = Object.values(store.data.support.items).filter((t) => t.status === 'open').length;
  let size = 0;
  try { size = fs.statSync(store.file).size; } catch (e) { /* not written yet */ }
  const lines = [
    '🩺 <b>Health</b>',
    `Version v${esc(version())} · up ${fmtDuration(up)} · memory ${Math.round(process.memoryUsage().rss / 1048576)} MB`,
    st.lastCrash ? `Last unexpected restart: ${fmtDuration(Math.round((Date.now() - st.lastCrash.at) / 1000))} ago (down ${fmtDuration(Math.round(st.lastCrash.down / 1000))})` : 'No unexpected restarts recorded.',
    `AI: ${i.enabled ? 'on' : 'off'}${i.enabled ? ` · ${esc(i.using)} · today ${i.calls} requests, ${i.errors} errors${i.lastError ? '\nLast AI error: ' + esc(i.lastError) : ''}` : ''}`,
  ];
  const ids = store.chatIds().slice(0, 25);
  const rs = await Promise.all(ids.map((id) => rights(api, id, meId)));
  lines.push('', `👥 <b>Groups (${store.chatIds().length})</b>`);
  ids.forEach((id, k) => {
    const r = rs[k];
    const name = esc(store.chat(id).title || id);
    lines.push(r.state === 'ok' ? `✅ ${name}` : r.state === 'missing' ? `⚠️ ${name}: needs to ${esc(r.missing.join(', '))}` : r.state === 'removed' ? `❌ ${name}: I am not in this group` : `❔ ${name}: could not check`);
  });
  lines.push('', `📩 Open tickets: ${open} · ❓ Unanswered AI questions: ${ai.listGaps().length} · Pending captchas: ${store.allPending().length}`);
  lines.push(`💾 Data file: ${Math.round(size / 1024)} KB`);
  return lines.join('\n');
}

function register(bot, store) {
  bot.command('health', ownerOnly, async (ctx) => say(ctx, await healthText(ctx.api, store, ctx.me.id)));
}

// Runs once when the bot is online: tells the owners if the last stop was not a normal one
async function onBoot(api, store) {
  const st = store.data.settings;
  const now = Date.now();
  const clean = !!st.cleanStop;
  const was = st.alive || 0;
  st.cleanStop = false;
  st.alive = now;
  store.save();
  const down = was ? now - was : 0;
  if (!clean && was && down > 150000) {
    st.lastCrash = { at: now, down };
    store.save();
    if (now - (st.crashNotice || 0) > 900000) {
      st.crashNotice = now;
      await notifyOwners(api, `⚠️ <b>I was offline for ${fmtDuration(Math.round(down / 1000))}</b> and just came back (v${esc(version())}). It was not a normal restart, so if this repeats, check the panel console.`);
    }
  }
}

// Tells the owners (once per change) when the bot lost rights in a group, was removed, or got its rights back
async function checkRights(api, store, meId) {
  const st = store.data.settings;
  st.rights = st.rights || {};
  for (const id of store.chatIds().slice(0, 60)) {
    const r = await rights(api, id, meId);
    if (r.state === 'unknown') continue;
    const now = sig(r);
    const before = st.rights[id];
    if (before === now) continue;
    st.rights[id] = now;
    store.save();
    const name = esc(store.chat(id).title || id);
    if (r.state === 'removed') await notifyOwners(api, `❌ <b>${name}</b>: I am no longer in this group.`);
    else if (r.state === 'missing') await notifyOwners(api, `⚠️ <b>${name}</b>: I still need to ${esc(r.missing.join(', '))} so I can work properly. Open the group's admin settings and give me those rights.`);
    else if (before) await notifyOwners(api, `✅ <b>${name}</b>: I have all the rights I need again.`);
  }
}

// Background checks: heartbeat, admin rights in every group, memory
function start(api, store, meId) {
  const st = store.data.settings;
  st.rights = st.rights || {};
  setInterval(() => { st.alive = Date.now(); store.touch(); }, 60000).unref();

  setTimeout(() => checkRights(api, store, meId).catch((e) => console.error('health:', e.message)), 120000).unref();
  setInterval(() => checkRights(api, store, meId).catch((e) => console.error('health:', e.message)), 1800000).unref();

  const limit = cfg.HEALTH_MEMORY_MB;
  setInterval(() => {
    const mb = Math.round(process.memoryUsage().rss / 1048576);
    if (mb > limit && Date.now() - (st.memNotice || 0) > 6 * 3600000) {
      st.memNotice = Date.now();
      notifyOwners(api, `⚠️ <b>Memory is high</b>: ${mb} MB (limit ${limit} MB). If your hosting plan is small, restart the bot or lower AI_KNOWLEDGE_MAX.`);
    }
  }, 300000).unref();
}

module.exports = { register, onBoot, start, healthText, rights, checkRights };
