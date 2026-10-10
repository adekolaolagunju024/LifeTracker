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

  -- Media/file attachments on a chat message or task comment. Stored on
  -- disk (backend/uploads/), scoped to the TOP-LEVEL project id so access
  -- checks work the same way sharing itself does (see topLevelProjectId).
  -- filename is the random on-disk name; originalName is what the
  -- uploader called it.
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uploaderId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    originalName TEXT NOT NULL,
    mimetype TEXT NOT NULL,
    size INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  );

  -- WhatsApp-style Status: a project-scoped update (photo/video + optional
  -- caption, or text-only) visible to the project's team for 24 hours,
  -- then it's gone — expiresAt is checked at read time and expired rows
  -- are swept lazily (see purgeExpiredStatuses), no separate cron job.
  CREATE TABLE IF NOT EXISTS project_statuses (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT DEFAULT '',
    attachmentId TEXT REFERENCES attachments(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL
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

// Optional media/file attachment on a chat message or task comment.
addColumnIfMissing('project_messages', "attachmentId TEXT REFERENCES attachments(id) ON DELETE SET NULL");
addColumnIfMissing('task_comments', "attachmentId TEXT REFERENCES attachments(id) ON DELETE SET NULL");

// The manually-maintained "actions" checklist was replaced by a live feed
// computed from tasks (overdue / due this week / high priority) — drop the
// now-unused table for databases created before this change.
db.exec('DROP TABLE IF EXISTS actions');

// The Wealth Tracker (net worth categories/targets, monthly income/savings
// log) was removed — this is a general-purpose goal tracker, not a
// finance app. Drop its tables for databases created before this change.
db.exec('DROP TABLE IF EXISTS wealth_targets');
db.exec('DROP TABLE IF EXISTS wealth_entries');
db.exec('DROP TABLE IF EXISTS wealth_log');

// Optional numeric progress target on a task (e.g. "20 mock tests") — a
// lower-friction alternative to a checklist for a repetitive goal made of
// identical units: one tap bumps progressCount instead of typing out
// "Mock test 1", "Mock test 2"... Hitting the target auto-completes the
// task, same as the recurrence auto-next-occurrence behavior above.
addColumnIfMissing('tasks', "targetCount INTEGER");
addColumnIfMissing('tasks', "targetUnit TEXT");
addColumnIfMissing('tasks', "progressCount INTEGER NOT NULL DEFAULT 0");

// Reply-to-a-specific-message threading, task comments and project chat
// both — a lightweight "in response to X" pointer rather than a full
// nested-thread model, same one-level-deep quote style as WhatsApp/Slack.
addColumnIfMissing('task_comments', "replyToId TEXT REFERENCES task_comments(id) ON DELETE SET NULL");
addColumnIfMissing('project_messages', "replyToId TEXT REFERENCES project_messages(id) ON DELETE SET NULL");

// "Go Live" — an embedded video room (Jitsi Meet's public server, no new
// infrastructure) for a site rep to broadcast a walkthrough to the rest of
// the project's team, who watch and comment in the project's existing
// chat alongside it. Only one active room per project at a time; a stale
// one (crashed tab, lost connection) is treated as ended after a few
// hours rather than needing an explicit "end" that never comes.
addColumnIfMissing('projects', "liveRoomName TEXT");
addColumnIfMissing('projects', "liveStartedAt TEXT");
addColumnIfMissing('projects', "liveStartedBy TEXT REFERENCES users(id) ON DELETE SET NULL");

// Push reminders (real OS-level notifications, distinct from both the
// email digest and the in-app bell) — see backend/push/. app_config holds
// the server's own VAPID keypair (generated once on first use, not a
// per-.env secret, so the feature works with zero manual setup); a device
// can hold several subscriptions per user (phone + desktop + tablet).
db.exec(`
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);
addColumnIfMissing('profile', "pushRemindersEnabled INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing('profile', "lastPushDigestSentDate TEXT");
addColumnIfMissing('profile', "lastFocusNudgeAt TEXT");
// Dedupes the "just went overdue" push so it fires once, not on every
// ~15-minute scheduler tick while the task stays overdue — cleared
// whenever the task's own dates/status change (see updateTaskById).
addColumnIfMissing('tasks', "overdueNotifiedAt TEXT");

// Activity emails (Asana/ClickUp-style instant per-event emails — assigned,
// @mentioned, commented on your task, invited — as opposed to the once-a-
// day digest above) — see backend/email/activity.js. One blanket toggle
// rather than Asana's per-event checkboxes, deliberately: simpler to ship,
// and these four events are already each fairly low-noise on their own.
addColumnIfMissing('profile', "activityEmailsEnabled INTEGER NOT NULL DEFAULT 0");

// Per-type push controls, layered on top of pushRemindersEnabled (which
// stays the master "is this device subscribed at all" switch — these three
// just gate which kinds of push actually get sent once it is). Default to
// on for all three so an account that already enabled Push Reminders
// keeps getting exactly what it already had, not a feature regression.
addColumnIfMissing('profile', "pushOverdueEnabled INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing('profile', "pushDueTodayEnabled INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing('profile', "pushFocusNudgeEnabled INTEGER NOT NULL DEFAULT 1");
// Focus-nudge timing, previously hardcoded (9am-6pm, every 2h) — now
// user-configurable per account.
addColumnIfMissing('profile', "focusNudgeStartHour INTEGER NOT NULL DEFAULT 9");
addColumnIfMissing('profile', "focusNudgeEndHour INTEGER NOT NULL DEFAULT 18");
addColumnIfMissing('profile', "focusNudgeIntervalMinutes INTEGER NOT NULL DEFAULT 120");

// AI-generated goal roadmaps (Dashboard "Chat with AI" -> /api/ai/project-chat)
// get flagged so they can be distinguished from an ordinary project: a
// dedicated Dashboard "Goals" section, and eligibility for the weekly AI
// check-in below. Only the top-level project of a roadmap is flagged — its
// phase sub-projects are already part of its tree for rollup purposes.
addColumnIfMissing('projects', "isGoal INTEGER NOT NULL DEFAULT 0");
// Dedupe guard for the weekly check-in, same role as lastPushDigestSentDate.
addColumnIfMissing('projects', "lastCheckInAt TEXT");
// Separate opt-in from Push Reminders/Activity Emails — this one triggers a
// billable AI call per goal per week, so it defaults off even for an
// account that already has the other two notification types on.
addColumnIfMissing('profile', "aiCheckInsEnabled INTEGER NOT NULL DEFAULT 0");

// Momentum streak — consecutive days with at least one completed task,
// the habit-loop mechanic behind the Dashboard's 🔥 badge and the evening
// "don't lose your streak" push. completedAt is new: nothing previously
// tracked WHEN a task was finished, only its current status.
addColumnIfMissing('tasks', "completedAt TEXT");
addColumnIfMissing('profile', "currentStreak INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing('profile', "longestStreak INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing('profile', "lastStreakDate TEXT");
addColumnIfMissing('profile', "lastStreakNudgeDate TEXT");
// 4th per-type push toggle, alongside pushOverdueEnabled/pushDueTodayEnabled/
// pushFocusNudgeEnabled above.
addColumnIfMissing('profile', "pushStreakEnabled INTEGER NOT NULL DEFAULT 1");

// Consent record: when the user accepted the Terms and Privacy Policy. Null
// for accounts created before this existed.
addColumnIfMissing('users', "acceptedTermsAt TEXT");

// Per-account daily cap on user-triggered AI calls, so one account can't run
// up an unbounded AI bill. Resets when aiCallsResetDate isn't today.
addColumnIfMissing('profile', "aiCallsToday INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing('profile', "aiCallsResetDate TEXT");
// Referrals: each account gets a personal invite code. A referred account
// records who invited it, and a referral row tracks the reward.
addColumnIfMissing('users', "referralCode TEXT");
addColumnIfMissing('users', "referredBy TEXT");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referralCode);
  CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    referrerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refereeId TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL,
    rewardedAt TEXT
  );
`);
addColumnIfMissing('profile', "bonusAiCredits INTEGER NOT NULL DEFAULT 0");

// The assistant is a conversation, so it gets its own, larger daily allowance.
addColumnIfMissing('profile', "assistantCallsToday INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing('profile', "assistantCallsResetDate TEXT");

// Minimal first-party event log (signups, goals created, tasks completed) —
// enough to answer "is anyone signing up or activating" without a third-party
// analytics account. Deliberately not a full analytics product.
db.exec(`
  CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    userId TEXT,
    event TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);

// Status updates: a short, timestamped "here's why" note a teammate posts
// against a task — separate from the general discussion in task_comments
// so "why is this still In Progress" stays scannable on its own instead of
// buried in chit-chat. status snapshots the task's status at post time, so
// the log reads as a trail ("Not Started" -> "In Progress" -> ...) even
// after the task itself has since moved on.
db.exec(`
  CREATE TABLE IF NOT EXISTS task_status_updates (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);
// A status update can be flagged as a blocker — "this needs help/tools to
// move" — so it stands out from an ordinary progress note wherever updates
// are shown (task row badge, the panel itself).
addColumnIfMissing('task_status_updates', "isBlocker INTEGER NOT NULL DEFAULT 0");

// Task obstacles: named things standing between a task and done ("Waiting
// on the supplier quote"), each with a count. The Journey draws each one as
// that many themed enemies on the path before the task's flag; finishing
// the task clears them.
db.exec(`
  CREATE TABLE IF NOT EXISTS task_obstacles (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_task_obstacles_task ON task_obstacles(taskId);
`);
// An obstacle can be ticked off (resolved) on its own, before the task
// itself is done — the Journey then knocks out just that obstacle's enemies.
addColumnIfMissing('task_obstacles', "resolvedAt TEXT");

// Journey gaming: XP accrues per account (not per project) as real tasks
// are completed anywhere — the same worker/house "levels up" across every
// project's Journey view. Deliberately not project-scoped: the point is to
// reward real work, not to reset progress per project.
addColumnIfMissing('profile', "journeyXp INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing('profile', "journeyTasksCompleted INTEGER NOT NULL DEFAULT 0");

// Unlocked achievements — a small, fixed set of codes (see JOURNEY_ACHIEVEMENTS
// in backend/journey.js); one row per account per code, granted once.
db.exec(`
  CREATE TABLE IF NOT EXISTS journey_achievements (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    unlockedAt TEXT NOT NULL,
    UNIQUE(userId, code)
  );
`);

// Confetti/balloons/the full-screen "project complete" page — some people
// find this kind of thing more annoying than fun. One blanket on/off
// switch, defaulting on, checked client-side before any of it fires.
addColumnIfMissing('profile', "celebrationEffectsEnabled INTEGER NOT NULL DEFAULT 1");

module.exports = db;
