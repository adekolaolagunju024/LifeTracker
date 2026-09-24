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
    resetToken TEXT,
    resetTokenExpires TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile (
    userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Your Name',
    tagline TEXT NOT NULL DEFAULT 'Every Goal, One Path',
    currency TEXT NOT NULL DEFAULT '£',
    targetNetWorth REAL NOT NULL DEFAULT 100000,
    targetDate TEXT NOT NULL DEFAULT '2027-05-01',
    onboarded INTEGER NOT NULL DEFAULT 0,
    emailDigestEnabled INTEGER NOT NULL DEFAULT 0,
    lastDigestSentDate TEXT
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
    type TEXT DEFAULT 'career',
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
    recurrence TEXT DEFAULT 'none',
    sortOrder INTEGER DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    color TEXT DEFAULT '#6B7280'
  );

  CREATE TABLE IF NOT EXISTS task_tags (
    taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tagId TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (taskId, tagId)
  );

  CREATE TABLE IF NOT EXISTS checklist_items (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS integrations (
    userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    googleDriveConnected INTEGER NOT NULL DEFAULT 0,
    googleDriveRefreshToken TEXT,
    googleDriveFolderId TEXT,
    googleDriveFolderName TEXT NOT NULL DEFAULT 'Waypoint Backups',
    googleDriveLastBackupAt TEXT
  );

  -- Google-Sheets-style project sharing between existing individual
  -- accounts: the project keeps its original owner (projects.userId
  -- unchanged), and this grants specific other users access to it.
  -- joinedAt is NULL until the invite is accepted.
  CREATE TABLE IF NOT EXISTS project_collaborators (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    invitedAt TEXT NOT NULL,
    joinedAt TEXT,
    UNIQUE(projectId, userId)
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  -- Project-wide chat (separate from per-task comments) — a running
  -- discussion for everyone with access to the project, polled by the
  -- client every few seconds rather than pushed over a socket.
  CREATE TABLE IF NOT EXISTS project_messages (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL
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
addColumnIfMissing('projects', "type TEXT DEFAULT 'career'");
addColumnIfMissing('tasks', "recurrence TEXT DEFAULT 'none'");
addColumnIfMissing('tasks', "sortOrder INTEGER DEFAULT 0");
addColumnIfMissing('users', "resetToken TEXT");
addColumnIfMissing('users', "resetTokenExpires TEXT");
addColumnIfMissing('profile', "emailDigestEnabled INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing('profile', "lastDigestSentDate TEXT");
// Soft delete: "deleting" a project or task just stamps deletedAt instead of
// removing the row, so it can show up in Trash and be restored. Every read
// query filters deletedAt IS NULL; a lazy purge (see db.js) hard-deletes
// anything that's been in Trash more than 30 days.
addColumnIfMissing('projects', "deletedAt TEXT");
addColumnIfMissing('tasks', "deletedAt TEXT");
// Collaboration: who a task is assigned to (any project owner or accepted
// collaborator), and a lightweight "last seen" heartbeat per user — a
// timestamp updated while the app is open, not a live socket connection —
// used to show a collaborator as active/away on a shared project.
addColumnIfMissing('tasks', "assigneeId TEXT REFERENCES users(id) ON DELETE SET NULL");
addColumnIfMissing('users', "lastActiveAt TEXT");
// Notifications: a single "last checked" timestamp per user is enough to
// derive "what's new since you last looked" (chat/comment activity, newly
// assigned tasks) without a per-item read/unread table — same lightweight
// approach as the presence heartbeat above. Pending invites aren't gated
// by this timestamp; they stay in the list until accepted/declined.
addColumnIfMissing('users', "notificationsCheckedAt TEXT");
addColumnIfMissing('tasks', "assigneeAssignedAt TEXT");

// Collaborator roles used to be a single "member" (full edit access, same
// as the owner short of deleting the project). Replaced with Google-Drive
// style viewer/commenter/editor — upgrade any pre-existing rows so nobody
// loses access they already had.
db.exec("UPDATE project_collaborators SET role = 'editor' WHERE role = 'member'");

// The manually-maintained "actions" checklist was replaced by a live feed
// computed from tasks (overdue / due this week / high priority) — drop the
// now-unused table for databases created before this change.
db.exec('DROP TABLE IF EXISTS actions');

module.exports = db;
