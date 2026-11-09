'use strict';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripHtml = (s) => String(s).replace(/<[^>]+>/g, '');

function displayName(u) {
  if (!u) return 'Unknown';
  const n = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return n || (u.username ? '@' + u.username : String(u.id));
}

const mention = (u) => `<a href="tg://user?id=${u.id}">${esc(displayName(u))}</a>`;
const mentionOf = (t) => `<a href="tg://user?id=${t.id}">${esc(t.name)}</a>`;

// "10m", "2h", "1d", "30s", "1w" (a bare number means minutes). Returns seconds or null.
function parseDuration(s) {
  const m = /^(\d+)\s*([smhdw])?$/i.exec(String(s || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[(m[2] || 'm').toLowerCase()];
  const sec = n * mult;
  if (!sec || sec > 366 * 86400) return null;
  return sec;
}

function fmtDuration(sec) {
  const parts = [];
  for (const [label, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    if (sec >= size) { parts.push(Math.floor(sec / size) + label); sec %= size; }
  }
  return parts.join(' ') || '0s';
}

const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

function onOff(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['on', 'yes', 'enable', 'enabled', 'true', '1'].includes(s)) return true;
  if (['off', 'no', 'disable', 'disabled', 'false', '0'].includes(s)) return false;
  return null;
}

// Reply target (a replied-to message) or a numeric user ID as the first argument.
function getTarget(ctx) {
  const args = String(ctx.match || '').trim().split(/\s+/).filter(Boolean);
  const r = ctx.msg && ctx.msg.reply_to_message;
  if (r && r.from && !r.forum_topic_created && r.from.id !== 777000) {
    return { target: { id: r.from.id, name: displayName(r.from) }, rest: args };
  }
  if (args[0] && /^\d{5,15}$/.test(args[0])) {
    return { target: { id: Number(args[0]), name: args[0] }, rest: args.slice(1) };
  }
  return { target: null, rest: args };
}

// Send HTML; if Telegram rejects the markup, resend as plain text.
async function trySend(fn, text, extra = {}) {
  const opts = { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra };
  try {
    return await fn(text, opts);
  } catch (e) {
    if (e && e.error_code === 400 && /parse entities/i.test(e.description || '')) {
      const { parse_mode, ...plain } = opts;
      return fn(stripHtml(text), plain);
    }
    console.error('send failed:', e && (e.description || e.message));
    return null;
  }
}

const say = (ctx, text, extra) => trySend((t, o) => ctx.reply(t, o), text, extra);
const sayTo = (api, chatId, text, extra) => trySend((t, o) => api.sendMessage(chatId, t, o), text, extra);

function autoDelete(api, chatId, messageId, ms = 8000) {
  if (!messageId) return;
  setTimeout(() => api.deleteMessage(chatId, messageId).catch(() => {}), ms).unref();
}

module.exports = { esc, stripHtml, displayName, mention, mentionOf, parseDuration, fmtDuration, fill, onOff, getTarget, say, sayTo, autoDelete };
