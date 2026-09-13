const Database = require('better-sqlite3');
const path     = require('path');

// Override with DB_PATH to point at a persistent volume on hosts with an
// ephemeral filesystem (most PaaS containers wipe local disk on redeploy).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'lifetracker.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    passwordHash TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile (
    userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Your Name',
    tagline TEXT NOT NULL DEFAULT 'My Life & Wealth Tracker',
    currency TEXT NOT NULL DEFAULT '£',
    targetNetWorth REAL NOT NULL DEFAULT 100000,
    targetDate TEXT NOT NULL DEFAULT '2027-05-01',
    onboarded INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parentId TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon TEXT DEFAULT '📁',
    color TEXT DEFAULT '#0A7E8C',
    startDate TEXT DEFAULT '',
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT DEFAULT '',
    status TEXT DEFAULT 'Not Started',
    priority TEXT DEFAULT 'Medium',
    startDate TEXT DEFAULT '',
    endDate TEXT DEFAULT '',
    cost REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wealth_targets (
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    target REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (userId, key)
  );

  CREATE TABLE IF NOT EXISTS wealth_entries (
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (userId, key)
  );

  CREATE TABLE IF NOT EXISTS wealth_log (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    month TEXT DEFAULT '',
    income REAL DEFAULT 0,
    business REAL DEFAULT 0,
    expenses REAL DEFAULT 0,
    saved REAL DEFAULT 0,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    area TEXT DEFAULT '',
    by TEXT DEFAULT '',
    priority TEXT DEFAULT 'Medium',
    done INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS integrations (
    userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    googleDriveConnected INTEGER NOT NULL DEFAULT 0,
    googleDriveRefreshToken TEXT,
    googleDriveFolderId TEXT,
    googleDriveFolderName TEXT NOT NULL DEFAULT 'LifeTracker Backups',
    googleDriveLastBackupAt TEXT
  );
`);

// Lightweight migration for databases created before a column existed.
// ALTER TABLE ADD COLUMN throws if the column is already there — that's
// how we detect "nothing to do" and stay idempotent across restarts.
function addColumnIfMissing(table, columnDef) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`); } catch (e) { /* already exists */ }
}
addColumnIfMissing('projects', "startDate TEXT DEFAULT ''");
addColumnIfMissing('projects', "parentId TEXT REFERENCES projects(id) ON DELETE CASCADE");

module.exports = db;
