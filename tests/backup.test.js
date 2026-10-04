const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waypoint-backup-'));
process.env.DB_PATH = path.join(tmp, 'app.sqlite');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
const db = require('../backend/db/connection');
const { runBackup } = require('../backend/backup');

after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a backup is written as a readable SQLite database', async () => {
  const file = await runBackup();
  assert.ok(fs.existsSync(file));
  const copy = require('better-sqlite3')(file, { readonly: true });
  const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
  copy.close();
  assert.equal(tables.length, 1);
});

test('only the most recent 14 daily backups are kept', async () => {
  for (let d = 1; d <= 20; d++) {
    const d2 = new Date(Date.UTC(2026, 0, d)).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(process.env.BACKUP_DIR, `lifetracker-${d2}.sqlite`), '');
  }
  await runBackup();
  const kept = fs.readdirSync(process.env.BACKUP_DIR).filter(f => /^lifetracker-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f));
  assert.equal(kept.length, 14);
});
