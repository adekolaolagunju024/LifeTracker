const db = require('./connection');
const { v4: uuid } = require('uuid');

// ── USERS ────────────────────────────────────────────────────────
function createUser({ id, email, passwordHash, createdAt }) {
  db.prepare(`INSERT INTO users (id, email, passwordHash, createdAt) VALUES (?,?,?,?)`)
    .run(id, email, passwordHash, createdAt);

  // Explicit, not relying on the column DEFAULT — SQLite bakes a column's
  // default into the table at CREATE TABLE time, so editing the DEFAULT in
  // code has no effect on a database (local or the live one) that already
  // exists with the table already created.
  db.prepare(`INSERT INTO profile (userId, tagline) VALUES (?, ?)`).run(id, 'Every Goal, One Path');
  db.prepare(`INSERT INTO integrations (userId) VALUES (?)`).run(id);
  return getUserById(id);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function setUserPasswordHash(id, passwordHash) {
  db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(passwordHash, id);
}

// Every other table's userId column is ON DELETE CASCADE, so this alone
// removes the profile, projects, tasks, wealth data, and integrations too.
function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function setPasswordResetToken(id, token, expiresAt) {
  db.prepare('UPDATE users SET resetToken = ?, resetTokenExpires = ? WHERE id = ?').run(token, expiresAt, id);
}

function getUserByResetToken(token) {
  return db.prepare('SELECT * FROM users WHERE resetToken = ?').get(token);
}

function clearPasswordResetToken(id) {
  db.prepare('UPDATE users SET resetToken = NULL, resetTokenExpires = NULL WHERE id = ?').run(id);
}

// ── PROFILE ──────────────────────────────────────────────────────
function getProfile(userId) {
  const row = db.prepare('SELECT * FROM profile WHERE userId = ?').get(userId);
  return { ...row, onboarded: !!row.onboarded };
}

function updateProfile(userId, patch) {
  const current = getProfile(userId);
  const next = { ...current, ...patch };
  db.prepare(`
    UPDATE profile SET name=?, tagline=?, currency=?, targetNetWorth=?, targetDate=?, onboarded=?
    WHERE userId = ?
  `).run(next.name, next.tagline, next.currency, next.targetNetWorth, next.targetDate, next.onboarded ? 1 : 0, userId);
  return getProfile(userId);
}

// ── PROJECTS (a project may have a parentId, making it a sub-folder) ──
function listProjects(userId, filters = {}) {
  let sql = 'SELECT * FROM projects WHERE userId = ?';
  const params = [userId];
  if (filters.parentId === 'null') {
    sql += ' AND parentId IS NULL';
  } else if (filters.parentId) {
    sql += ' AND parentId = ?';
    params.push(filters.parentId);
  }
  sql += ' ORDER BY createdAt ASC';
  return db.prepare(sql).all(...params);
}

function getProjectById(userId, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ? AND userId = ?').get(id, userId);
}

function createProject(userId, project) {
  // Only one level of sub-folders is supported — a sub-folder can't itself
  // have sub-folders, so Gantt grouping and project stats (which only look
  // one level deep) never have to deal with deeper nesting.
  if (project.parentId) {
    const parent = getProjectById(userId, project.parentId);
    if (parent && parent.parentId) throw new Error("A sub-folder can't contain another sub-folder");
  }
  db.prepare(`
    INSERT INTO projects (id, userId, parentId, title, description, icon, color, startDate, type, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(project.id, userId, project.parentId || null, project.title, project.description || '', project.icon || '📁', project.color || '#0A7E8C', project.startDate || '', project.type || 'career', project.createdAt);
  return getProjectById(userId, project.id);
}

function updateProjectById(userId, id, patch) {
  const current = getProjectById(userId, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  if (next.parentId) {
    if (next.parentId === id) throw new Error("A folder can't be its own sub-folder");
    const parent = getProjectById(userId, next.parentId);
    if (parent && parent.parentId) throw new Error("A sub-folder can't contain another sub-folder");
  }
  db.prepare(`UPDATE projects SET title=?, description=?, icon=?, color=?, startDate=?, parentId=?, type=? WHERE id = ? AND userId = ?`)
    .run(next.title, next.description, next.icon, next.color, next.startDate || '', next.parentId || null, next.type || 'career', id, userId);
  return getProjectById(userId, id);
}

function deleteProjectById(userId, id) {
  db.prepare('DELETE FROM projects WHERE id = ? AND userId = ?').run(id, userId); // sub-folders + tasks cascade via FK
}

// ── TASKS ────────────────────────────────────────────────────────
function listTasks(userId, filters = {}) {
  let sql = 'SELECT * FROM tasks WHERE userId = ?';
  const params = [userId];
  if (filters.projectId) { sql += ' AND projectId = ?'; params.push(filters.projectId); }
  if (filters.status)    { sql += ' AND status = ?';    params.push(filters.status); }
  if (filters.priority)  { sql += ' AND priority = ?';  params.push(filters.priority); }
  if (filters.category)  { sql += ' AND category = ?';  params.push(filters.category); }
  if (filters.search)    { sql += ' AND LOWER(title) LIKE ?'; params.push('%' + filters.search.toLowerCase() + '%'); }
  sql += ' ORDER BY sortOrder ASC, createdAt ASC';
  return db.prepare(sql).all(...params).map(t => ({ ...t, cost: t.cost || 0 }));
}

function getTaskById(userId, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ? AND userId = ?').get(id, userId);
}

// A task can't start before the project it belongs to does — only checked
// when both dates are actually set, so tasks/projects without a start date
// are unaffected.
function assertTaskNotBeforeProject(project, taskStartDate) {
  if (project.startDate && taskStartDate && taskStartDate < project.startDate) {
    throw new Error(`Task can't start before the project's start date (${project.startDate})`);
  }
}

function createTask(userId, task) {
  const project = getProjectById(userId, task.projectId);
  if (!project) throw new Error('Project not found');
  assertTaskNotBeforeProject(project, task.startDate);
  // New tasks go to the bottom of their project's manual order.
  const { maxOrder } = db.prepare('SELECT MAX(sortOrder) AS maxOrder FROM tasks WHERE userId = ? AND projectId = ?').get(userId, task.projectId);
  const sortOrder = (maxOrder ?? -1) + 1;
  db.prepare(`
    INSERT INTO tasks (id, userId, projectId, title, category, status, priority, startDate, endDate, cost, notes, recurrence, sortOrder, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(task.id, userId, task.projectId, task.title, task.category || '', task.status || 'Not Started', task.priority || 'Medium',
         task.startDate || '', task.endDate || '', task.cost || 0, task.notes || '', task.recurrence || 'none', sortOrder, task.createdAt);
  return getTaskById(userId, task.id);
}

// Persists a manual drag-to-reorder within one project — taskIds is the
// full new order for that project, so each task's sortOrder becomes its
// index in the array.
function reorderTasks(userId, projectId, taskIds) {
  const stmt = db.prepare('UPDATE tasks SET sortOrder = ? WHERE id = ? AND userId = ? AND projectId = ?');
  const run = db.transaction((ids) => {
    ids.forEach((id, index) => stmt.run(index, id, userId, projectId));
  });
  run(taskIds);
}

// Shifts a date forward by one recurrence interval — used to schedule the
// next occurrence when a recurring task is completed.
function shiftDateByRecurrence(dateStr, recurrence) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (recurrence === 'daily')        d.setDate(d.getDate() + 1);
  else if (recurrence === 'weekly')  d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  else return dateStr;
  return d.toISOString().slice(0, 10);
}

function updateTaskById(userId, id, patch) {
  const current = getTaskById(userId, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  const project = getProjectById(userId, next.projectId);
  if (!project) throw new Error('Project not found');
  assertTaskNotBeforeProject(project, next.startDate);
  db.prepare(`
    UPDATE tasks SET projectId=?, title=?, category=?, status=?, priority=?, startDate=?, endDate=?, cost=?, notes=?, recurrence=?
    WHERE id = ? AND userId = ?
  `).run(next.projectId, next.title, next.category, next.status, next.priority, next.startDate, next.endDate, next.cost, next.notes, next.recurrence || 'none', id, userId);

  // Completing a recurring task schedules its next occurrence automatically
  // — e.g. "apply to 5 jobs this week" comes back next week instead of
  // needing to be recreated by hand every time.
  const justCompleted = current.status !== 'Completed' && next.status === 'Completed';
  if (justCompleted && next.recurrence && next.recurrence !== 'none') {
    createTask(userId, {
      id: uuid(),
      projectId: next.projectId,
      title: next.title,
      category: next.category,
      status: 'Not Started',
      priority: next.priority,
      startDate: shiftDateByRecurrence(next.startDate, next.recurrence),
      endDate: shiftDateByRecurrence(next.endDate, next.recurrence),
      cost: next.cost,
      notes: next.notes,
      recurrence: next.recurrence,
      createdAt: new Date().toISOString(),
    });
  }

  return getTaskById(userId, id);
}

function deleteTaskById(userId, id) {
  db.prepare('DELETE FROM tasks WHERE id = ? AND userId = ?').run(id, userId);
}

// ── WEALTH ───────────────────────────────────────────────────────
function getWealth(userId) {
  const targets = db.prepare('SELECT * FROM wealth_targets WHERE userId = ?').all(userId);
  const entries = db.prepare('SELECT * FROM wealth_entries WHERE userId = ?').all(userId);
  const monthlyLog = db.prepare('SELECT * FROM wealth_log WHERE userId = ? ORDER BY date DESC').all(userId);

  const targetsMap = {};
  targets.forEach(t => { targetsMap[t.key] = { label: t.label, target: t.target }; });
  const entriesMap = {};
  entries.forEach(e => { entriesMap[e.key] = e.value; });

  return { entries: entriesMap, targets: targetsMap, monthlyLog };
}

function updateWealthEntries(userId, patch) {
  const upsert = db.prepare(`
    INSERT INTO wealth_entries (userId, key, value) VALUES (?, ?, ?)
    ON CONFLICT(userId, key) DO UPDATE SET value = excluded.value
  `);
  Object.entries(patch).forEach(([key, value]) => upsert.run(userId, key, parseFloat(value) || 0));
  return getWealth(userId).entries;
}

function addWealthTarget(userId, key, label, target) {
  db.prepare('INSERT INTO wealth_targets (userId, key, label, target) VALUES (?,?,?,?)').run(userId, key, label, target || 0);
  db.prepare('INSERT INTO wealth_entries (userId, key, value) VALUES (?, ?, 0)').run(userId, key);
}

function updateWealthTarget(userId, key, { label, target }) {
  db.prepare('UPDATE wealth_targets SET label = ?, target = ? WHERE userId = ? AND key = ?')
    .run(label, target || 0, userId, key);
  return getWealth(userId).targets[key];
}

function deleteWealthTarget(userId, key) {
  db.prepare('DELETE FROM wealth_targets WHERE userId = ? AND key = ?').run(userId, key);
  db.prepare('DELETE FROM wealth_entries WHERE userId = ? AND key = ?').run(userId, key);
}

function addMonthlyLogEntry(userId, entry) {
  db.prepare(`
    INSERT INTO wealth_log (id, userId, date, month, income, business, expenses, saved, notes) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(entry.id, userId, entry.date, entry.month || '', entry.income || 0, entry.business || 0, entry.expenses || 0, entry.saved || 0, entry.notes || '');
  return entry;
}

function deleteMonthlyLogEntry(userId, id) {
  db.prepare('DELETE FROM wealth_log WHERE id = ? AND userId = ?').run(id, userId);
}

// ── INTEGRATIONS (Google Drive) ─────────────────────────────────
function getGoogleDrive(userId) {
  const row = db.prepare('SELECT * FROM integrations WHERE userId = ?').get(userId);
  return {
    connected: !!row.googleDriveConnected,
    refreshToken: row.googleDriveRefreshToken,
    folderId: row.googleDriveFolderId,
    folderName: row.googleDriveFolderName,
    lastBackupAt: row.googleDriveLastBackupAt,
  };
}

function setGoogleDrive(userId, patch) {
  const current = getGoogleDrive(userId);
  const next = { ...current, ...patch };
  db.prepare(`
    UPDATE integrations SET googleDriveConnected=?, googleDriveRefreshToken=?, googleDriveFolderId=?, googleDriveFolderName=?, googleDriveLastBackupAt=?
    WHERE userId = ?
  `).run(next.connected ? 1 : 0, next.refreshToken, next.folderId, next.folderName, next.lastBackupAt, userId);
  return getGoogleDrive(userId);
}

// ── FULL SNAPSHOT (for exports/backups) ─────────────────────────
function getFullSnapshot(userId) {
  return {
    profile: getProfile(userId),
    projects: listProjects(userId),
    tasks: listTasks(userId),
    wealth: getWealth(userId),
  };
}

module.exports = {
  createUser, getUserByEmail, getUserById, setUserPasswordHash, deleteUser,
  setPasswordResetToken, getUserByResetToken, clearPasswordResetToken,
  getProfile, updateProfile,
  listProjects, getProjectById, createProject, updateProjectById, deleteProjectById,
  listTasks, getTaskById, createTask, updateTaskById, deleteTaskById, reorderTasks,
  getWealth, updateWealthEntries, addWealthTarget, updateWealthTarget, deleteWealthTarget, addMonthlyLogEntry, deleteMonthlyLogEntry,
  getGoogleDrive, setGoogleDrive,
  getFullSnapshot,
};
