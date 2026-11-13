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

**Everyone also gets:** `/report` (reply: pings the admins), `/admins`, `/faq`, `/notes`, `/get <topic>` and `#topic` (reads a FAQ/note).

**Admins** (the bot stays silent for everyone else):
- Warnings: `/warn` `/unwarn` `/warns` `/clearwarns [all]` `/warnsettings [limit N | action mute|kick|ban]`
- Punishments: `/mute [1h]` `/unmute` `/kick` `/ban [1d]` `/unban <id>`
- Messages: `/del` `/purge` (reply: deletes everything from that message on) `/pin [loud]` `/unpin` `/info`
- Protection (all off by default; admins and approved users are never affected):
  - `/antilink on|off`
  - `/antispam on|off|limit 5 8|action mute|warn|kick` (flooding or the same message 4 times in a minute)
  - `/antibot on|off` (only admins can add bots)
  - `/antimention on|off|limit 5` (stops tag-spam; Telegram does not let bots check if an @username is a member)
  - `/lock <type>` `/unlock <type|all>` `/locks`: stickers, gifs, photos, videos, voice, files, forwards, polls, contacts, invites, inline
  - `/addword` `/delword` `/words`: forbidden words (message deleted, sender warned)
  - `/approve` `/unapprove` `/approved`: exempt a trusted user from all of the above
- Welcome: `/setwelcome` `/getwelcome` `/delwelcome` `/welcome on|off` `/setgoodbye` `/goodbye on|off` `/cleanservice on|off` (hides "joined/left" messages) `/captcha on|off [seconds]`
- Content: `/setrules` `/addfaq` (or `/addnote`) `/delfaq` (or `/delnote`) `/setfilter <keyword> <reply>` `/filters` `/delfilter`
- Other: `/warnlimit` `/warnaction` `/ai on|off|status|fix|test` `/settings`

**Owner:** `/status` `/announce <message>` `/knowledge` `/panel` `/reply <id> <text>` `/block <id>` `/unblock <id>`

## Private chat (DM) features

- **Support inbox:** anyone can message the bot privately. It forwards the message to the owners (and anyone listed in `SUPPORT_IDS`). Reply to that message in your DM and the answer goes back to the user. Spam is limited to 5 messages a minute, and `/block <id>` stops a user for good. Everyone who should receive tickets must press **Start** on the bot once.
- **`/mywarns`:** members see their own warnings across all groups (in a group the answer disappears after 15 seconds).
- **`/panel` (owner):** buttons to switch welcome, captcha and anti-link on or off, change the warn limit and the action at the limit, and check the bot's admin rights, for any group the bot is in.

Durations: `30s`, `10m`, `2h`, `1d`, `1w`. Without a duration `/mute` and `/ban` last until an admin undoes them.

## Optional settings (config.env)

- `ALLOWED_CHATS` : group IDs the bot may work in. It leaves every other group. Send `/id` in your group to get its ID.
- `DATA_DIR` : where settings and warnings are saved (default `data`). Keep this folder when you update the bot.

## Unanswered questions: teach the AI what it misses

When a member asks something the knowledge does not cover, the AI says it is not sure and the question is saved. Similar questions are merged and counted.
- `/gaps` lists them, most asked first. `/gapanswer <id> your answer` teaches the AI (saved as a Q&A in the knowledge), `/gapdel <id>`, `/gapclear`.
- In `/panel` → **AI & knowledge** → **Unanswered**: tap a question, send the answer, done.
- The questions are stored in `data/` and are part of `/backup`.

## Health check

- `/health` (or `/panel` → Status): version, uptime, memory, AI status and errors, and for every group whether I still have the admin rights I need.
- You get a DM when: I was offline unexpectedly (crash or host restart), I lose a right or am removed from a group (and when it is fixed), or memory is high (`HEALTH_MEMORY_MB`, default 450).
- Normal restarts and updates stay quiet.

## Destinations: choose where I post (topics and channels)

You decide where each kind of post goes. In a group with topics, open the topic and send `/setdest <purpose>` there. Or give a channel ID, an `@channel` or a topic link (`https://t.me/c/…/12`).

| Purpose | What it posts | Topic of the group | Channel or other group |
| --- | --- | --- | --- |
| `releases` | new release news | yes | yes |
| `announce` | announcements | yes | yes |
| `log` | moderation log | yes | yes |
| `schedule` | scheduled messages | yes | yes |
| `welcome` | welcome and goodbye | yes | no |
| `giveaway` | giveaways | yes | no |
| `reports` | `/report` for admins | yes | no |
| `ai` | AI answers only here (mentions and replies still work everywhere) | yes | no |

- `/setdest releases` (inside the topic) · `/setdest announce -1001234567890` · `/dest` shows everything · `/cleardest releases` or `/cleardest all`.
- For a channel, make the bot an admin there. If a topic is deleted, posts fall back to the group itself.
- **Owner, for all groups:** `/setchannel announce <channel>` and `/setchannel releases <channel>`. Then `/announce` and the panel's Announce also post to your announcement channel, and new releases go to the release channel. `/channels` shows them, `/clearchannel` removes one. `/announceto channel,1 text` includes the channel.
- In `/panel`: **Groups → your group → Destinations**, and **Channels** in the main menu. The Announce screen has a **Channel** toggle.

## More features (v0.4.5)

All of these are off by default and can be switched on per group in `/panel` → Groups → your group → **More**.

**Safety**
- `/raidmode on|off|auto on` : when many people join within a minute, new members are removed for a while (`/panel` has the threshold).
- `/newbie 24` : new members cannot send links or forwards for their first 24 hours.
- `/aiscan on` : the AI checks messages with links or money talk and removes scams (admins and approved users are skipped).
- `/gban <id> reason` (owner), `/ungban`, `/gbans` : one ban list for all your groups; `/gbansync off` opts a group out.
- `/setlog <channel id>` : every warn, mute, ban, kick, raid and AI removal is posted to your log channel.
- `/warnexpiry 14` : warnings disappear after 14 days.

**Community**
- `/levels on` : members earn XP by chatting; `/rank`, `/top`, `/daily` (with streaks).
- `/giveaway 30m 2 Prize` (time, winners, prize) with a Join button; `/giveaway end`.
- `/poll Question | a | b` and `/quiz Question | *right | wrong`.
- `/invite` gives each member a personal link, `/invites` shows the top inviters.
- `/remind 2h text`, `/reminders`, `/unremind 1` (also works in private chat).
- `/schedule every 6h text` or `/schedule daily 18:00 text`, `/schedule list`, `/schedule del 2`; `/timezone +1` sets the group time zone.
- `/nightmode on 23:00 06:00` locks the chat at night and restores the old permissions in the morning.

**Release news:** `/changelog` shows the latest GitHub release of the WhatsApp bot. `/releases on` makes the bot post new releases by itself. It asks GitHub every 10 minutes (`RELEASE_CHECK_MINUTES`; `RELEASE_REPO` picks the repository; `RELEASE_PRERELEASES=true` includes pre-releases). Only published releases count, not drafts. Owners can use `/releasecheck` to look right now and `/releasecheck post` to announce the latest again (also `/panel` → Updates → Check releases now).

**AI tools:** `/translate [language]` and `/explain` (reply to a message), `/summary [N]` (an admin switches it on with `/summary on`; the last 200 messages are kept in memory only). AI answers can name the section they used (`/aisources on|off`).

**Support tickets:** every private message becomes a numbered ticket. Owners use `/tickets` and `/close 12 message`; members see theirs with `/mytickets`. `/panel` → Support lists open tickets with Close buttons.

**Owner tools:** `/stats` (members and messages per group, AI usage), `/groups` and `/announceto 1,3 text` (or pick groups with buttons in `/panel` → Announce), `/backup` and `/restore` (reply to the backup file), and automatic error alerts in your DM.

## Owner panel (/panel)

Send `/panel` to the bot in a private chat. Everything is controlled with buttons:
- **Groups**, each with sub-menus: **Welcome & captcha** (welcome, goodbye, captcha and timer, clean join/leave messages, texts), **Protection** (anti-link, anti-spam, anti-bot, anti-mention, AI, warn limit and action), **Locks**, **Content** (rules, FAQ and notes, filters, bad words) and clear warnings.
- **AI & knowledge:** status, import the TurboFex README, import any link, add notes, view what the AI knows, test a question, clear your notes.
- **Updates:** check and install, auto-update on/off, roll back.
- **Support:** block and unblock users. **Status** and **Announce** to all groups.

When a button asks you to send text (welcome text, rules, a note...), just send it as your next message. `/cancel` or the Cancel button stops it.

All settings in `config.env` can also be set as variables on the hosting panel. The panel variable wins.

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
- The provider is detected from your key: a Groq key (starts with `gsk_`) uses Groq (`openai/gpt-oss-20b`, backup `openai/gpt-oss-120b`), a Google key (starts with `AIza`) uses Gemini (`gemini-2.5-flash-lite`, backup `gemini-2.5-flash`). Only `AI_API_KEY` is needed. Any OpenAI-compatible provider also works with `AI_BASE_URL` and `AI_MODEL`.
- Providers retire models now and then (Groq retired its Llama 3.1 8B and 3.3 70B on 16 Aug 2026). If the model stops working the bot finds a working one by itself and remembers it. `/ai fix` (or the panel button) does it on demand and `/ai models` lists what your key can use.
- If the AI fails (wrong key, wrong model, quota used up) the bot messages the owners once with the reason, and `/ai test <question>` shows the exact error.
- Privacy: messages that look like questions are sent to the AI provider. On Google's free tier, prompts may be used to improve their models, so do not use it for private information.

What the AI knows lives in `knowledge/turbofex.md` plus your own notes. **There is no limit on how much you can teach it.** Each question only carries the most relevant parts (up to `AI_KNOWLEDGE_MAX` characters, default 8000 on Groq and 24000 on Gemini) so the free quota is not wasted. Set `AI_KNOWLEDGE_MAX=0` to send everything with every question.
- `/knowledge repo https://github.com/nels0nfx/TurboFex` imports every documentation file (.md and .txt) of the WhatsApp bot repository. Run it again to refresh. In `/panel` this is the **Import TurboFex docs** button.
- `/knowledge import <link>` imports one page or file. Importing the same link again replaces the old copy.
- `/knowledge add <text>` adds your own notes, `/knowledge show` shows what the AI knows, `/knowledge clear` removes your notes.
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
