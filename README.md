# TurboFex Telegram Bot

A Telegram group manager for the TurboFex community: welcome messages, join captcha, link blocking, warnings, mute/ban tools, rules and FAQ.

## Setup (5 minutes)

1. Create a bot with **@BotFather** and copy the token.
2. Open the included `config.env` and paste your token after `BOT_TOKEN=`. `OWNER_IDS` already has the owner ID (change it if needed; get IDs from @userinfobot).
3. In BotFather run `/setprivacy` and choose **Disable** for your bot.
4. Add the bot to your group and make it **admin** with: delete messages, ban users, pin messages.
5. Install and start: `npm install` then `npm start`.
   On a panel host (Spaceify), upload the files so `index.js` sits in the main folder, and the startup command is `node index.js`.
6. In the group, send `/settings` to check the bot has every right it needs.

Only run **one copy** of the bot at a time, otherwise Telegram reports a "409 Conflict" error.

## Commands

**Everyone:** `/rules` `/faq [topic]` `/id` `/ping` `/help`

**Admins** (the bot stays silent for everyone else):
- `/warn` `/unwarn` `/warns` : reply to a user. At the limit they are muted 24h, kicked or banned (`/warnaction`).
- `/mute [1h]` `/unmute` `/kick` `/ban [1d]` `/unban <id>`
- `/del` `/pin [loud]` `/unpin` : reply to a message
- `/setwelcome <text>` : placeholders `{mention}` `{name}` `{chat}` `{id}`
- `/setrules <text>` `/addfaq <topic> <answer>` `/delfaq <topic>`
- `/welcome on|off` `/captcha on|off [seconds]` `/antilink on|off` `/warnlimit <n>` `/settings`

**Owner:** `/status` `/announce <message>` `/panel` `/reply <id> <text>` `/block <id>` `/unblock <id>`

## Private chat (DM) features

- **Support inbox:** anyone can message the bot privately. It forwards the message to the owners (and anyone listed in `SUPPORT_IDS`). Reply to that message in your DM and the answer goes back to the user. Spam is limited to 5 messages a minute, and `/block <id>` stops a user for good. Everyone who should receive tickets must press **Start** on the bot once.
- **`/mywarns`:** members see their own warnings across all groups (in a group the answer disappears after 15 seconds).
- **`/panel` (owner):** buttons to switch welcome, captcha and anti-link on or off, change the warn limit and the action at the limit, and check the bot's admin rights, for any group the bot is in.

Durations: `30s`, `10m`, `2h`, `1d`, `1w`. Without a duration `/mute` and `/ban` last until an admin undoes them.

## Optional settings (config.env)

- `ALLOWED_CHATS` : group IDs the bot may work in. It leaves every other group. Send `/id` in your group to get its ID.
- `DATA_DIR` : where settings and warnings are saved (default `data`). Keep this folder when you update the bot.

## Updating

Replace the files with the new version and restart, but **keep your own `config.env`** (it holds your token) and the `data/` folder. When unzipping an update on the host, skip it: `unzip -o TurboFex-Telegram-vX.Y.Z.zip -x config.env`.
