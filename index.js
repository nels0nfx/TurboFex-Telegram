'use strict';
// Supervisor: runs the bot (src/main.js) and restarts it after an update or a crash.
// If a fresh update keeps crashing, it restores the previous version automatically.
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const UPD = path.join(ROOT, '.update');
const BACKUP = path.join(UPD, 'backup');
const PENDING = path.join(UPD, 'pending.json');
const ROLLED = path.join(UPD, 'rolledback.json');
const MAIN = path.join(ROOT, 'src', 'main.js');

function walk(dir, base = '') {
  let out = [];
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(base, n.name);
    out = n.isDirectory() ? out.concat(walk(path.join(dir, n.name), rel)) : out.concat(rel);
  }
  return out;
}

function rollback() {
  const dir = path.join(BACKUP, 'files');
  if (!fs.existsSync(dir)) return false;
  let info = {};
  try { info = JSON.parse(fs.readFileSync(PENDING, 'utf8')); } catch (e) { /* no marker */ }
  for (const rel of walk(dir)) {
    const dst = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(dir, rel), dst);
  }
  fs.writeFileSync(ROLLED, JSON.stringify({ from: info.from, to: info.to }));
  fs.rmSync(PENDING, { force: true });
  return true;
}

let child = null;
let stopping = false;
let crashes = [];

function launch() {
  const startedAt = Date.now();
  child = fork(MAIN, [], { env: { ...process.env, TFX_SUPERVISED: '1' } });
  child.on('exit', (code) => {
    child = null;
    if (stopping || code === 0) return process.exit(0);
    if (code === 42) { console.log('🔄 Restarting with the updated files...'); return setTimeout(launch, 500); }
    if (code === 78) return process.exit(1); // configuration problem, restarting will not help
    const now = Date.now();
    crashes = now - startedAt < 20000 ? crashes.filter((t) => now - t < 120000).concat(now) : [];
    if (crashes.length >= 3 && fs.existsSync(PENDING) && rollback()) {
      console.error('⚠️ The new version keeps crashing. Restored the previous version.');
      crashes = [];
      return setTimeout(launch, 1000);
    }
    if (crashes.length >= 6) {
      console.error('❌ The bot keeps crashing. Stopping. Check the errors above.');
      return process.exit(1);
    }
    console.error(`⚠️ Bot stopped (code ${code}). Restarting shortly...`);
    setTimeout(launch, Math.min(30000, 2000 * Math.max(1, crashes.length)));
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (child) { child.kill(sig); setTimeout(() => process.exit(0), 5000).unref(); } else process.exit(0);
  });
}

launch();
