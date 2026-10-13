const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('./db/connection');
const offsite = require('./offsite');
const { UPLOAD_DIR } = require('./storage');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'db/lifetracker.sqlite');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_FILE), 'backups');
const KEEP_DAYS = 14;
const NAME_RE = /^lifetracker-\d{4}-\d{2}-\d{2}\.sqlite$/;
// Which uploaded files are already off-site. Their names are random and
// never reused, so a name sent once never needs sending again.
const SENT_FILE = () => path.join(BACKUP_DIR, 'offsite-uploads.json');

// How the last backup went, for the owner's Metrics page.
let last = null;
const lastResult = () => last;

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

// The day's database, compressed, plus any uploaded file not sent before.
// How long copies are kept off-site is set on the bucket (a lifecycle rule).
async function sendOffsite(file) {
  const name = path.basename(file);
  await offsite.put(`db/${name}.gz`, zlib.gzipSync(fs.readFileSync(file)), 'application/gzip');
  let sent = [];
  try { sent = JSON.parse(fs.readFileSync(SENT_FILE(), 'utf8')); } catch { sent = []; }
  const done = new Set(sent);
  let files = 0;
  for (const f of fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : []) {
    const p = path.join(UPLOAD_DIR, f);
    if (done.has(f) || !fs.statSync(p).isFile()) continue;
    await offsite.put(`uploads/${f}`, fs.readFileSync(p));
    done.add(f); files++;
    fs.writeFileSync(SENT_FILE(), JSON.stringify([...done])); // a failure part way keeps what got through
  }
  return { db: `db/${name}.gz`, files };
}

// The nightly job: back up, send it off-site if storage is set up, and say
// loudly (logs, and Sentry when it's on) if either part fails.
async function nightly() {
  const at = new Date().toISOString();
  try {
    const file = await runBackup();
    let remote = null;
    if (offsite.isConfigured()) remote = await sendOffsite(file);
    last = { at, ok: true, file: path.basename(file), offsite: remote };
    console.log(`Database backup written: ${file}${remote ? `, sent off-site with ${remote.files} new upload(s)` : ' (off-site storage not set up)'}`);
  } catch (e) {
    last = { at, ok: false, error: e.message };
    console.error('Database backup failed:', e.message);
    try { require('@sentry/node').captureException(e); } catch { /* Sentry not set up */ }
  }
  return last;
}

function startBackupScheduler() {
  cron.schedule('30 3 * * *', () => { nightly(); });
  // A fresh deploy with no backup yet today makes one a few minutes in,
  // so a bad deploy never sits more than a day from a good copy.
  const today = path.join(BACKUP_DIR, `lifetracker-${new Date().toISOString().slice(0, 10)}.sqlite`);
  if (!fs.existsSync(today)) setTimeout(() => { nightly(); }, 3 * 60 * 1000).unref();
}

module.exports = { startBackupScheduler, runBackup, sendOffsite, nightly, lastResult, BACKUP_DIR };
