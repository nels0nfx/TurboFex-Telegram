// MentionMaster v1.0.0
// Requires TurboFex message events to expose c.mentions as an array of
// mentioned WhatsApp user IDs (strings) or objects containing id/userId/jid.

const PREFIX = 'mentionmaster:';
const DEFAULT_COOLDOWN = 30;

async function get(key, fallback) {
  const value = await tfx.storage.get(PREFIX + key);
  return value == null ? fallback : value;
}

async function set(key, value) {
  await tfx.storage.set(PREFIX + key, String(value));
}

function cleanMentionId(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    return String(value.id || value.userId || value.jid || '').trim();
  }
  return '';
}

tfx.command('mention', async (c) => {
  const raw = String(c.rest || '').trim();
  const splitAt = raw.indexOf(' ');
  const action = (splitAt < 0 ? raw : raw.slice(0, splitAt)).toLowerCase();
  const argument = splitAt < 0 ? '' : raw.slice(splitAt + 1).trim();

  if (action === 'set') {
    if (!argument) return c.reply('▸ Usage: .mention set <your response message>');
    if (argument.length > 1500) return c.reply('▸ Your response is too long. Maximum: 1,500 characters.');
    await set('ownerId', c.sender.id);
    await set('message', argument);
    return c.reply('▸ *Mention response saved.*\n▸ Use `.mention on` to activate it.');
  }

  if (action === 'on') {
    const ownerId = await get('ownerId', '');
    const message = await get('message', '');
    if (!ownerId || !message) {
      return c.reply('▸ Set your response first with `.mention set <message>`.');
    }
    await set('enabled', 'true');
    return c.reply('▸ *MentionMaster enabled.*\n▸ I will respond when your account is mentioned in a group.');
  }

  if (action === 'off') {
    await set('enabled', 'false');
    return c.reply('▸ MentionMaster is now disabled.');
  }

  if (action === 'view') {
    const message = await get('message', '');
    const enabled = (await get('enabled', 'false')) === 'true';
    if (!message) return c.reply('▸ No response message has been configured yet.');
    return c.reply('▸ *MentionMaster:* ' + (enabled ? 'Enabled' : 'Disabled') + '\n▸ *Saved response:*\n' + message);
  }

  if (action === 'reset') {
    await set('enabled', 'false');
    await set('message', '');
    await set('ownerId', '');
    await set('cooldown', String(DEFAULT_COOLDOWN));
    return c.reply('▸ MentionMaster settings have been reset and the feature is disabled.');
  }

  if (action === 'cooldown') {
    const seconds = Number(argument);
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) {
      return c.reply('▸ Usage: `.mention cooldown <seconds>` (5–3600).');
    }
    await set('cooldown', String(seconds));
    return c.reply('▸ Mention response cooldown set to ' + seconds + ' seconds.');
  }

  return c.reply(
    '▸ *MentionMaster settings*\n' +
    '▸ `.mention set <message>` — save your response\n' +
    '▸ `.mention on` — enable\n' +
    '▸ `.mention off` — disable\n' +
    '▸ `.mention view` — view settings\n' +
    '▸ `.mention cooldown <seconds>` — set cooldown\n' +
    '▸ `.mention reset` — clear settings'
  );
});

tfx.on('message', async (c) => {
  try {
    if (!c || !c.chat || !c.chat.isGroup) return;
    if ((await get('enabled', 'false')) !== 'true') return;

    const ownerId = await get('ownerId', '');
    const message = await get('message', '');
    if (!ownerId || !message) return;

    const mentions = Array.isArray(c.mentions) ? c.mentions : [];
    const mentionedIds = mentions.map(cleanMentionId).filter(Boolean);
    if (!mentionedIds.includes(ownerId)) return;

    // Do not trigger on the configured owner's own messages.
    if (String(c.sender && c.sender.id || '') === ownerId) return;

    const cooldown = Number(await get('cooldown', String(DEFAULT_COOLDOWN))) || DEFAULT_COOLDOWN;
    const senderId = String(c.sender && c.sender.id || 'unknown');
    const chatId = String(c.chat.id || 'unknown');
    const cooldownKey = 'last:' + chatId + ':' + senderId;
    const last = Number(await get(cooldownKey, '0')) || 0;
    const now = Date.now();

    if (now - last < cooldown * 1000) return;
    await set(cooldownKey, String(now));
    await c.reply(message);
  } catch (error) {
    tfx.log('MentionMaster event error: ' + String(error && error.message || error));
  }
});
