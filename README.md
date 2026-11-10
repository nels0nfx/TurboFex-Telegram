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
- `/welcome on|off` `/captcha on|off [seconds]` `/antilink on|off` `/ai on|off` `/warnlimit <n>` `/settings`

**Owner:** `/status` `/announce <message>` `/knowledge` `/panel` `/reply <id> <text>` `/block <id>` `/unblock <id>`

## Private chat (DM) features

- **Support inbox:** anyone can message the bot privately. It forwards the message to the owners (and anyone listed in `SUPPORT_IDS`). Reply to that message in your DM and the answer goes back to the user. Spam is limited to 5 messages a minute, and `/block <id>` stops a user for good. Everyone who should receive tickets must press **Start** on the bot once.
- **`/mywarns`:** members see their own warnings across all groups (in a group the answer disappears after 15 seconds).
- **`/panel` (owner):** buttons to switch welcome, captcha and anti-link on or off, change the warn limit and the action at the limit, and check the bot's admin rights, for any group the bot is in.

Durations: `30s`, `10m`, `2h`, `1d`, `1w`. Without a duration `/mute` and `/ban` last until an admin undoes them.

## Optional settings (config.env)

- `ALLOWED_CHATS` : group IDs the bot may work in. It leaves every other group. Send `/id` in your group to get its ID.
- `DATA_DIR` : where settings and warnings are saved (default `data`). Keep this folder when you update the bot.

## AI answers (free)

Members just type their question in the group, with no command, and the bot answers by itself using what it knows about the TurboFex WhatsApp bot. Chat that is not a question about TurboFex is ignored.

1. Get a free key at https://aistudio.google.com/apikey (sign in, press **Create API key**).
2. Put it in `config.env` as `AI_API_KEY=...` (or add `AI_API_KEY` as a variable on the panel) and restart.
3. Send `/ai status`, then try `/ai test how do I get a session ID?`.

How it behaves:
- In a group it answers messages that look like a question, never replies to messages aimed at other people, and always answers when someone mentions the bot or replies to it.
- In a private chat it answers first and adds a **Send this to the team** button. Anything it cannot handle (payments, account problems) goes straight to the team.
- Admins can switch it off per group with `/ai off` (or in `/panel`).
- Limits protect the free quota: 10 AI calls a minute, 300 a day per group, one answer per member every 12 seconds. Change them with `AI_MAX_PER_MIN` and `AI_DAILY_LIMIT`.
- Default model is Gemini 2.5 Flash-Lite (backup: Gemini 2.5 Flash). To use Groq instead, set `AI_BASE_URL=https://api.groq.com/openai/v1` and `AI_MODEL=llama-3.3-70b-versatile`. Any OpenAI-compatible provider works.
- Privacy: messages that look like questions are sent to the AI provider. On Google's free tier, prompts may be used to improve their models, so do not use it for private information.

What the AI knows lives in `knowledge/turbofex.md` plus your own notes:
- `/knowledge import https://github.com/nels0nfx/TurboFex` adds the README of the WhatsApp bot.
- `/knowledge add <text>` adds your own notes, `/knowledge show` shows what the AI sees, `/knowledge clear` removes your notes.
- Your notes are stored in `data/` and survive updates.

## Updating the bot (from Telegram)

The bot updates itself from this GitHub repository, so you never have to upload files to the panel again.

1. Push the new version to GitHub as usual (raise the `version` in `package.json`).
2. In a private chat with the bot send **/update**. It shows the new version, you tap **Install & restart**, and it comes back by itself.

- **/autoupdate on** : checks GitHub every few hours (`AUTO_UPDATE_HOURS`) and installs newer versions by itself. Off by default, because it installs whatever is pushed to the branch.
- **/update force** : reinstall the GitHub files even if the version number is the same.
- **/rollback** : go back to the previous version.
- **/version** : show the running version.

Safety: the new files are syntax-checked before anything is replaced, the old version is backed up, and if a new version keeps crashing right after an update the bot restores the old one by itself and tells you.

Never touched by an update: `config.env` (your token), `data/` (settings and warnings) and `OWNER_PREFERENCES.private.md`.

Notes:
- Keep the startup command as `node index.js`. `index.js` restarts the bot after updates.
- A private repository needs `GITHUB_TOKEN` in `config.env` (a GitHub token with read access to the repo).
- Updating from the bot only works from this version on. Installing this first version is a normal upload (keep your own `config.env`).
