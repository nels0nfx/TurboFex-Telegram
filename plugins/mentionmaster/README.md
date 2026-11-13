# MentionMaster v1.0.0

TurboFex plugin that lets the bot owner configure an automatic reply when their account is mentioned in a group.

## Commands

- `.mention set <message>` — save the response and bind the configuration to the command user's private TurboFex sender ID.
- `.mention on` — enable automatic replies.
- `.mention off` — disable automatic replies.
- `.mention view` — view the saved response.
- `.mention cooldown <seconds>` — set per-chat/per-sender cooldown (5–3600 seconds).
- `.mention reset` — clear the configuration.

## Important compatibility requirement

This plugin depends on the TurboFex message event `tfx.on('message', handler)` and on that event context exposing `c.mentions` as an array of mentioned user IDs (strings) or objects with an `id`, `userId`, or `jid` field.

The published Plugin Guide does not conclusively document the message-event mention field shape. Confirm that the live runtime exposes this field before publishing or approving the plugin. If it does not, the bot's plugin event context must be extended to expose mention IDs. The plugin will otherwise install but cannot reliably detect mentions.

## Permissions

- `chat.send`
- `storage`
- `events.message`

No external network access is used.
