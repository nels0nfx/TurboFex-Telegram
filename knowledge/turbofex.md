<!--
Owner note (this comment is not sent to the AI):
This file is the starting point of what the AI knows about the TurboFex WhatsApp bot.
Add the real details from Telegram with:
  /knowledge import https://github.com/nels0nfx/TurboFex     (adds the README)
  /knowledge add <text>                                       (adds your own notes)
Things you add that way live in data/ and survive updates.
-->

# TurboFex knowledge

## About TurboFex
- TurboFex is a WhatsApp bot made by Nelson (GitHub: nels0nfx). On hosting panels it can appear as "NelsonFx Bot".
- Source code and downloads: https://github.com/nels0nfx/TurboFex
- It has an economy system for WhatsApp groups. Every group has its own separate economy: balances, investments, transactions and progress never mix between groups. A bigger investment and market economy with news events is being developed.
- The bot stays completely silent when someone without permission tries an owner, admin or role-restricted command. This is on purpose and not a bug.

## Getting started
- TurboFex works with a session ID, like other session-based WhatsApp bots. You generate your SESSION_ID on the TurboFex pairing website: https://turbofex-pair.onrender.com/ . Session IDs look like TFX-XXXX-XXXX-XXXX.
- Put the SESSION_ID in the config.env file of the bot, then start the bot.
- Hosting: upload the bot files to a hosting panel (for example Spaceify) so that index.js sits directly in the main folder, not inside another folder.
- A flat, hosting-ready ZIP named TurboFex-hosting.zip is published on the GitHub Releases page of the TurboFex repository.
- If the bot does not start, look at the console on the panel for the error message, check that the SESSION_ID in config.env is correct and complete, and check that index.js is in the main folder.

## This Telegram group
- The Telegram bot @TurboFexBot manages this group: welcome message, join captcha, warnings, link blocking, rules (/rules) and FAQ (/faq).
- Members can send /mywarns to see their warnings.
- Members can message @TurboFexBot privately to reach the team; the team replies through the bot.
- Admins of the group handle anything the bot cannot answer.
