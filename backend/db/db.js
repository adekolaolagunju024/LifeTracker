const db = require('./connection');

// ── USERS ────────────────────────────────────────────────────────
function createUser({ id, email, passwordHash, createdAt }) {
  db.prepare(`INSERT INTO users (id, email, passwordHash, createdAt) VALUES (?,?,?,?)`)
    .run(id, email, passwordHash, createdAt);

  db.prepare(`INSERT INTO profile (userId) VALUES (?)`).run(id);
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
    INSERT INTO projects (id, userId, parentId, title, description, icon, color, startDate, createdAt) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(project.id, userId, project.parentId || null, project.title, project.description || '', project.icon || '📁', project.color || '#0A7E8C', project.startDate || '', project.createdAt);
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
  db.prepare(`UPDATE projects SET title=?, description=?, icon=?, color=?, startDate=?, parentId=? WHERE id = ? AND userId = ?`)
    .run(next.title, next.description, next.icon, next.color, next.startDate || '', next.parentId || null, id, userId);
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
  sql += ' ORDER BY createdAt ASC';
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
  db.prepare(`
    INSERT INTO tasks (id, userId, projectId, title, category, status, priority, startDate, endDate, cost, notes, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(task.id, userId, task.projectId, task.title, task.category || '', task.status || 'Not Started', task.priority || 'Medium',
         task.startDate || '', task.endDate || '', task.cost || 0, task.notes || '', task.createdAt);
  return getTaskById(userId, task.id);
}

function updateTaskById(userId, id, patch) {
  const current = getTaskById(userId, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  const project = getProjectById(userId, next.projectId);
  if (!project) throw new Error('Project not found');
  assertTaskNotBeforeProject(project, next.startDate);
  db.prepare(`
    UPDATE tasks SET projectId=?, title=?, category=?, status=?, priority=?, startDate=?, endDate=?, cost=?, notes=?
    WHERE id = ? AND userId = ?
  `).run(next.projectId, next.title, next.category, next.status, next.priority, next.startDate, next.endDate, next.cost, next.notes, id, userId);
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

function addMonthlyLogEntry(userId, entry) {
  db.prepare(`
    INSERT INTO wealth_log (id, userId, date, month, income, business, expenses, saved, notes) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(entry.id, userId, entry.date, entry.month || '', entry.income || 0, entry.business || 0, entry.expenses || 0, entry.saved || 0, entry.notes || '');
  return entry;
}

function deleteMonthlyLogEntry(userId, id) {
  db.prepare('DELETE FROM wealth_log WHERE id = ? AND userId = ?').run(id, userId);
}

// ── ACTIONS ──────────────────────────────────────────────────────
function listActions(userId) {
  return db.prepare('SELECT * FROM actions WHERE userId = ? ORDER BY createdAt ASC').all(userId).map(a => ({ ...a, done: !!a.done }));
}

function getActionById(userId, id) {
  const row = db.prepare('SELECT * FROM actions WHERE id = ? AND userId = ?').get(id, userId);
  return row ? { ...row, done: !!row.done } : null;
}

function createAction(userId, action) {
  db.prepare(`
    INSERT INTO actions (id, userId, text, area, by, priority, done, createdAt) VALUES (?,?,?,?,?,?,?,?)
  `).run(action.id, userId, action.text, action.area || '', action.by || '', action.priority || 'Medium', action.done ? 1 : 0, action.createdAt);
  return getActionById(userId, action.id);
}

function updateActionById(userId, id, patch) {
  const current = getActionById(userId, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  db.prepare(`UPDATE actions SET text=?, area=?, by=?, priority=?, done=? WHERE id = ? AND userId = ?`)
    .run(next.text, next.area, next.by, next.priority, next.done ? 1 : 0, id, userId);
  return getActionById(userId, id);
}

function deleteActionById(userId, id) {
  db.prepare('DELETE FROM actions WHERE id = ? AND userId = ?').run(id, userId);
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
    actions: listActions(userId),
  };
}

module.exports = {
  createUser, getUserByEmail, getUserById, setUserPasswordHash,
  getProfile, updateProfile,
  listProjects, getProjectById, createProject, updateProjectById, deleteProjectById,
  listTasks, getTaskById, createTask, updateTaskById, deleteTaskById,
  getWealth, updateWealthEntries, addWealthTarget, addMonthlyLogEntry, deleteMonthlyLogEntry,
  listActions, getActionById, createAction, updateActionById, deleteActionById,
  getGoogleDrive, setGoogleDrive,
  getFullSnapshot,
};
