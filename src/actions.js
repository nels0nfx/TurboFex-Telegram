'use strict';

const NO_PERMS = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false, can_change_info: false,
  can_invite_users: false, can_pin_messages: false, can_manage_topics: false,
};
const FULL_PERMS = {
  can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true,
  can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true,
  can_send_other_messages: true, can_add_web_page_previews: true,
};

const until = (sec) => (sec ? { until_date: Math.floor(Date.now() / 1000) + sec } : {});

const mute = (api, chatId, userId, seconds) => api.restrictChatMember(chatId, userId, NO_PERMS, until(seconds));

// Restore the group's default member permissions.
async function unmute(api, chatId, userId) {
  const chat = await api.getChat(chatId);
  return api.restrictChatMember(chatId, userId, chat.permissions || FULL_PERMS);
}

const ban = (api, chatId, userId, seconds) => api.banChatMember(chatId, userId, until(seconds));
const unban = (api, chatId, userId) => api.unbanChatMember(chatId, userId, { only_if_banned: true });

async function kick(api, chatId, userId) {
  await api.banChatMember(chatId, userId);
  await api.unbanChatMember(chatId, userId, { only_if_banned: true });
}

function explain(e) {
  const d = (e && (e.description || e.message)) || '';
  if (/not enough rights|CHAT_ADMIN_REQUIRED|need to be (an )?administrator|have no rights/i.test(d)) {
    return "I don't have the admin rights for that. Give me: delete messages, ban users and pin messages in the group's admin settings.";
  }
  if (/user not found|USER_ID_INVALID|PARTICIPANT_ID_INVALID/i.test(d)) return "I can't find that user in this group.";
  if (/message to (delete|pin) not found|can't be deleted/i.test(d)) return "I can't delete that message.";
  return 'Telegram refused: ' + d;
}

module.exports = { mute, unmute, ban, unban, kick, explain };
