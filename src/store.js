'use strict';
const fs = require('fs');
const path = require('path');

const defaults = () => ({
  title: '',
  welcome: { enabled: true, text: 'Welcome {mention} to <b>{chat}</b>! 👋\nPlease read /rules before chatting.' },
  rules: '',
  captcha: { enabled: false, timeout: 120 },
  antilink: false,
  antibot: false,
  dest: {},
  levels: { enabled: false },
  xp: {},
  raid: { auto: false, threshold: 8, active: 0 },
  newbie: { hours: 0 },
  joined: {},
  log: { chat: 0 },
  warnExpiryDays: 0,
  warnTimes: {},
  aiscan: false,
  summary: false,
  night: { enabled: false, from: '23:00', to: '06:00', active: false, saved: null },
  tz: 0,
  schedules: [],
  scheduleNext: 1,
  giveaways: {},
  invites: {},
  releases: false,
  gban: true,
  antispam: { enabled: false, limit: 5, seconds: 8, action: 'mute' },
  antimention: { enabled: false, limit: 5 },
  cleanService: false,
  goodbye: { enabled: false, text: 'Goodbye {name} 👋' },
  locks: {},
  words: [],
  filters: {},
  approved: [],
  ai: { enabled: true },
  warnLimit: 3,
  warnAction: 'mute',
  warns: {},
  faq: {},
});

function fill(target, def) {
  for (const k of Object.keys(def)) {
    if (target[k] === undefined) target[k] = def[k];
    else if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) fill(target[k], def[k]);
  }
  return target;
}

class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.data = { chats: {}, pending: {}, tickets: {}, blocked: [], settings: {}, gbans: {}, reminders: [], support: { next: 1, items: {} }, stats: {} };
    this.dirty = false;
    setInterval(() => { if (this.dirty) this.flush(); }, 30000).unref();
    this.timer = null;
    this.load();
  }

  load() {
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    try {
      const j = JSON.parse(raw);
      this.data = { chats: j.chats || {}, pending: j.pending || {}, tickets: j.tickets || {}, blocked: j.blocked || [], settings: j.settings || {},
        gbans: j.gbans || {}, reminders: j.reminders || [], support: j.support || { next: 1, items: {} }, stats: j.stats || {} };
    } catch (e) {
      const bak = path.join(this.dir, `db.corrupt-${Date.now()}.json`);
      fs.writeFileSync(bak, raw);
      console.error(`⚠️ db.json was unreadable, saved a copy as ${path.basename(bak)} and started fresh.`);
    }
  }

  chat(id) {
    const k = String(id);
    if (!this.data.chats[k]) this.data.chats[k] = defaults();
    else fill(this.data.chats[k], defaults());
    return this.data.chats[k];
  }

  chatIds() { return Object.keys(this.data.chats).map(Number); }

  addPending(e) { this.data.pending[`${e.chatId}:${e.userId}`] = e; this.save(); }
  getPending(chatId, userId) { return this.data.pending[`${chatId}:${userId}`]; }
  removePending(chatId, userId) { delete this.data.pending[`${chatId}:${userId}`]; this.save(); }
  allPending() { return Object.values(this.data.pending); }

  // support inbox: which staff message belongs to which user
  addTicket(chat, msg, userId) {
    const t = this.data.tickets;
    t[`${chat}:${msg}`] = userId;
    const keys = Object.keys(t);
    if (keys.length > 1000) for (const k of keys.slice(0, keys.length - 1000)) delete t[k];
    this.save();
  }
  getTicket(chat, msg) { return this.data.tickets[`${chat}:${msg}`]; }
  isBlocked(id) { return this.data.blocked.includes(id); }
  block(id) { if (!this.isBlocked(id)) this.data.blocked.push(id); this.save(); }
  unblock(id) { this.data.blocked = this.data.blocked.filter((x) => x !== id); this.save(); }

  // for things that change on every message (XP, counters): written out every 30 seconds
  touch() { this.dirty = true; }

  countMessage(chatId) {
    const day = new Date().toISOString().slice(0, 10);
    const st = this.data.stats;
    st[day] = st[day] || {};
    st[day][chatId] = (st[day][chatId] || 0) + 1;
    for (const d of Object.keys(st)) if (d < new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)) delete st[d];
    this.touch();
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 500);
  }

  flush() {
    this.dirty = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('❌ Could not save data:', e.message);
    }
  }
}

module.exports = { Store, defaults };
