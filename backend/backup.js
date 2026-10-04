const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const db = require('./db/connection');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'db/lifetracker.sqlite');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_FILE), 'backups');
const KEEP_DAYS = 14;
const NAME_RE = /^lifetracker-\d{4}-\d{2}-\d{2}\.sqlite$/;

// SQLite's online backup API copies a consistent snapshot even while the app
// is writing, unlike copying the file directly.
async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(BACKUP_DIR, `lifetracker-${stamp}.sqlite`);
  fs.rmSync(dest, { force: true });
  await db.backup(dest);

  const backups = fs.readdirSync(BACKUP_DIR).filter(f => NAME_RE.test(f)).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_DAYS))) {
    fs.rmSync(path.join(BACKUP_DIR, old), { force: true });
  }
  return dest;
}

function startBackupScheduler() {
  cron.schedule('30 3 * * *', () => {
    runBackup()
      .then(file => console.log(`Database backup written: ${file}`))
      .catch(e => console.error('Database backup failed:', e.message));
  });
}

module.exports = { startBackupScheduler, runBackup, BACKUP_DIR };
