'use strict';
const actions = require('./actions');
const { esc, mentionOf } = require('./util');

// Adds one warning. At the limit the configured punishment is applied. Returns the message to post.
async function warn(api, store, chatId, target, reason) {
  const s = store.chat(chatId);
  const key = String(target.id);
  s.warns[key] = (s.warns[key] || 0) + 1;
  const count = s.warns[key];
  const why = reason ? `\nReason: ${esc(reason)}` : '';
  if (count < s.warnLimit) {
    store.save();
    return `⚠️ ${mentionOf(target)} has been warned (${count}/${s.warnLimit}).${why}`;
  }
  delete s.warns[key];
  store.save();
  if (s.warnAction === 'ban') await actions.ban(api, chatId, target.id);
  else if (s.warnAction === 'kick') await actions.kick(api, chatId, target.id);
  else await actions.mute(api, chatId, target.id, 86400);
  const what = { ban: 'banned', kick: 'removed', mute: 'muted for 24h' }[s.warnAction] || 'muted for 24h';
  return `🚫 ${mentionOf(target)} reached ${s.warnLimit} warnings and was ${what}.${why}`;
}

module.exports = { warn };
