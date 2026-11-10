'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

loadEnvFile(path.join(ROOT, 'config.env'));
loadEnvFile(path.join(ROOT, '.env'));

const ids = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

// The key tells us the provider: Groq keys start with gsk_, Google keys with AIza
const aiKey = (process.env.AI_API_KEY || '').trim();
const aiBase = (process.env.AI_BASE_URL || (aiKey.startsWith('gsk_') ? 'https://api.groq.com/openai/v1' : 'https://generativelanguage.googleapis.com/v1beta/openai')).trim().replace(/\/+$/, '');
const isGroq = aiBase.includes('groq.com');
const isGoogle = aiBase.includes('googleapis.com');

module.exports = {
  ROOT,
  BOT_TOKEN: (process.env.BOT_TOKEN || '').trim(),
  OWNER_IDS: ids(process.env.OWNER_IDS || process.env.OWNER_ID),
  SUPPORT_IDS: ids(process.env.SUPPORT_IDS),
  UPDATE_REPO: (process.env.UPDATE_REPO || 'nels0nfx/TurboFex-Telegram').trim(),
  UPDATE_BRANCH: (process.env.UPDATE_BRANCH || 'main').trim(),
  GITHUB_TOKEN: (process.env.GITHUB_TOKEN || '').trim(),
  AUTO_UPDATE_HOURS: Number(process.env.AUTO_UPDATE_HOURS) || 6,
  // AI answers (any OpenAI-compatible API; defaults to Google Gemini's free tier)
  AI_API_KEY: aiKey,
  AI_BASE_URL: aiBase,
  AI_MODEL: (process.env.AI_MODEL || (isGroq ? 'openai/gpt-oss-20b' : 'gemini-2.5-flash-lite')).trim(),
  AI_FALLBACK_MODEL: (process.env.AI_FALLBACK_MODEL !== undefined ? process.env.AI_FALLBACK_MODEL : (isGroq ? 'openai/gpt-oss-120b' : isGoogle ? 'gemini-2.5-flash' : '')).trim(),
  AI_MAX_PER_MIN: Number(process.env.AI_MAX_PER_MIN) || 10,
  AI_DAILY_LIMIT: Number(process.env.AI_DAILY_LIMIT) || 300,
  AI_KNOWLEDGE_MAX: Number(process.env.AI_KNOWLEDGE_MAX) || (isGroq ? 6000 : 12000),
  AI_MAX_TOKENS: Number(process.env.AI_MAX_TOKENS) || (isGoogle ? 800 : isGroq ? 1000 : 450),
  ALLOWED_CHATS: ids(process.env.ALLOWED_CHATS),
  DATA_DIR: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
};
