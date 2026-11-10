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

module.exports = {
  ROOT,
  BOT_TOKEN: (process.env.BOT_TOKEN || '').trim(),
  OWNER_IDS: ids(process.env.OWNER_IDS || process.env.OWNER_ID),
  SUPPORT_IDS: ids(process.env.SUPPORT_IDS),
  ALLOWED_CHATS: ids(process.env.ALLOWED_CHATS),
  DATA_DIR: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
};
