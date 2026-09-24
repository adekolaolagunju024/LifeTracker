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
  return { ...row, onboarded: !!row.onboarded, emailDigestEnabled: !!row.emailDigestEnabled };
}

function updateProfile(userId, patch) {
  const current = getProfile(userId);
  const next = { ...current, ...patch };
  db.prepare(`
    UPDATE profile SET name=?, tagline=?, currency=?, targetNetWorth=?, targetDate=?, onboarded=?, emailDigestEnabled=?
    WHERE userId = ?
  `).run(next.name, next.tagline, next.currency, next.targetNetWorth, next.targetDate, next.onboarded ? 1 : 0, next.emailDigestEnabled ? 1 : 0, userId);
  return getProfile(userId);
}

// All users with the digest turned on — the scheduler needs the email
// address too, which lives on `users`, not `profile`.
function listUsersForDigest() {
  return db.prepare(`
    SELECT u.id AS userId, u.email, p.name, p.lastDigestSentDate
    FROM profile p JOIN users u ON u.id = p.userId
    WHERE p.emailDigestEnabled = 1
  `).all();
}

function setLastDigestSentDate(userId, dateStr) {
  db.prepare('UPDATE profile SET lastDigestSentDate = ? WHERE userId = ?').run(dateStr, userId);
}

// ── ACCESS CONTROL (Google-Sheets-style project sharing) ─────────
// A project is accessible to a user if they own it, or are an accepted
// collaborator on it or on its parent — sharing a top-level project also
// shares its one level of sub-folders, since they're the same tree/team.
// This subquery needs `userId` bound three times, in this order; every
// caller uses threeUserIds(userId) to build that part of its params array.
function accessibleProjectIdsSQL() {
  return `(
    SELECT p.id FROM projects p WHERE p.deletedAt IS NULL AND (
      p.userId = ?
      OR p.id IN (SELECT projectId FROM project_collaborators WHERE userId = ? AND joinedAt IS NOT NULL)
      OR p.parentId IN (SELECT projectId FROM project_collaborators WHERE userId = ? AND joinedAt IS NOT NULL)
    )
  )`;
}
function threeUserIds(userId) { return [userId, userId, userId]; }

// 'owner' | 'member' | null. Owner-only actions (delete the project, manage
// collaborators) check this directly; everything else that's collaborative
// by design (edit project details, create/edit/delete tasks) just needs
// non-null — an accepted member has full working access, same as the
// owner, short of deleting the project or managing who's on it.
function getProjectRole(userId, projectId) {
  const project = db.prepare('SELECT userId, parentId FROM projects WHERE id = ? AND deletedAt IS NULL').get(projectId);
  if (!project) return null;
  if (project.userId === userId) return 'owner';
  const onThis = db.prepare('SELECT role FROM project_collaborators WHERE projectId = ? AND userId = ? AND joinedAt IS NOT NULL').get(projectId, userId);
  if (onThis) return onThis.role;
  if (project.parentId) {
    const onParent = db.prepare('SELECT role FROM project_collaborators WHERE projectId = ? AND userId = ? AND joinedAt IS NOT NULL').get(project.parentId, userId);
    if (onParent) return onParent.role;
  }
  return null;
}
function canAccessProject(userId, projectId) { return getProjectRole(userId, projectId) !== null; }
function isProjectOwner(userId, projectId) {
  const row = db.prepare('SELECT userId, parentId FROM projects WHERE id = ? AND deletedAt IS NULL').get(projectId);
  if (!row) return false;
  if (row.userId === userId) return true;
  // A sub-folder's own userId should already match its tree's real owner
  // (see createProject), but fall back to checking the parent directly —
  // defense in depth against stale data from before that was true.
  if (row.parentId) {
    const parent = db.prepare('SELECT userId FROM projects WHERE id = ? AND deletedAt IS NULL').get(row.parentId);
    return !!parent && parent.userId === userId;
  }
  return false;
}

// A sub-folder's own id if it has no parent, otherwise its parent's id.
// Sharing always operates on this — clicking "Share" from inside a
// sub-folder invites someone to the whole tree, same as sharing from the
// top-level project, rather than creating an orphaned invite that grants
// access to just that one sub-folder with no navigable path to it (the
// sidebar and All Projects only ever list top-level projects).
function topLevelProjectId(projectId) {
  const row = db.prepare('SELECT parentId FROM projects WHERE id = ? AND deletedAt IS NULL').get(projectId);
  return row && row.parentId ? row.parentId : projectId;
}

// ── PROJECTS (a project may have a parentId, making it a sub-folder) ──
// The name on the project's own userId — for a shared project this is
// "who owns this", surfaced in the UI as "Shared by X" for anyone who
// isn't that owner.
function getOwnerName(ownerId) {
  const row = db.prepare('SELECT name FROM profile WHERE userId = ?').get(ownerId);
  return row ? row.name : null;
}

function listProjects(userId, filters = {}) {
  let sql = `SELECT * FROM projects WHERE deletedAt IS NULL AND id IN ${accessibleProjectIdsSQL()}`;
  const params = threeUserIds(userId);
  if (filters.parentId === 'null') {
    sql += ' AND parentId IS NULL';
  } else if (filters.parentId) {
    sql += ' AND parentId = ?';
    params.push(filters.parentId);
  }
  sql += ' ORDER BY createdAt ASC';
  return db.prepare(sql).all(...params).map(p => ({ ...p, role: getProjectRole(userId, p.id), ownerName: getOwnerName(p.userId) }));
}

function getProjectById(userId, id) {
  const row = db.prepare(`SELECT * FROM projects WHERE id = ? AND deletedAt IS NULL AND id IN ${accessibleProjectIdsSQL()}`).get(id, ...threeUserIds(userId));
  if (!row) return null;
  return { ...row, role: getProjectRole(userId, id), ownerName: getOwnerName(row.userId) };
}

function createProject(userId, project) {
  // Only one level of sub-folders is supported — a sub-folder can't itself
  // have sub-folders, so Gantt grouping and project stats (which only look
  // one level deep) never have to deal with deeper nesting.
  let ownerId = userId;
  if (project.parentId) {
    const parent = getProjectById(userId, project.parentId);
    if (parent && parent.parentId) throw new Error("A sub-folder can't contain another sub-folder");
    // A sub-folder always belongs to the same owner as the rest of its
    // tree, regardless of which collaborator actually created it —
    // otherwise a member creating a sub-folder under a shared project
    // would become ITS owner, silently locking the real project owner
    // (and every other collaborator) out of it.
    if (parent) ownerId = parent.userId;
  }
  db.prepare(`
    INSERT INTO projects (id, userId, parentId, title, description, icon, color, startDate, type, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(project.id, ownerId, project.parentId || null, project.title, project.description || '', project.icon || '📁', project.color || '#0A7E8C', project.startDate || '', project.type || 'career', project.createdAt);
  return getProjectById(userId, project.id);
}

// Any accepted collaborator (not just the owner) can edit a shared
// project's own details — deleting it and managing who's on it are the
// owner-only actions, checked separately below.
function updateProjectById(userId, id, patch) {
  const current = getProjectById(userId, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  if (next.parentId) {
    if (next.parentId === id) throw new Error("A folder can't be its own sub-folder");
    const parent = getProjectById(userId, next.parentId);
    if (parent && parent.parentId) throw new Error("A sub-folder can't contain another sub-folder");
  }
  db.prepare(`UPDATE projects SET title=?, description=?, icon=?, color=?, startDate=?, parentId=?, type=? WHERE id = ?`)
    .run(next.title, next.description, next.icon, next.color, next.startDate || '', next.parentId || null, next.type || 'career', id);
  return getProjectById(userId, id);
}

// Soft delete: stamps deletedAt instead of removing the row, so it shows up
// in Trash and can be restored. FK ON DELETE CASCADE only fires on a real
// DELETE, so a plain UPDATE here wouldn't touch sub-folders/tasks on its
// own — cascade it by hand to the same one level of sub-folders the rest
// of the app supports, plus every task belonging to the project or any of
// those sub-folders. Owner-only: a collaborator who could delete the
// project could lock everyone else out of it.
function deleteProjectById(userId, id) {
  if (!isProjectOwner(userId, id)) return;
  const now = new Date().toISOString();
  // Not scoped to the owner's own userId — a sub-folder or task within a
  // shared project may have been created by a collaborator, not the owner,
  // but still belongs to (and cascades with) this project tree.
  const childIds = db.prepare('SELECT id FROM projects WHERE parentId = ? AND deletedAt IS NULL').all(id).map(r => r.id);
  const allIds = [id, ...childIds];
  const stmtProj  = db.prepare('UPDATE projects SET deletedAt = ? WHERE id = ?');
  const stmtTasks = db.prepare('UPDATE tasks SET deletedAt = ? WHERE projectId = ? AND deletedAt IS NULL');
  db.transaction(() => {
    allIds.forEach(pid => { stmtProj.run(now, pid); stmtTasks.run(now, pid); });
  })();
}

// ── TASKS ────────────────────────────────────────────────────────
// checklistTotal/checklistDone are subquery counts, not real columns — lets
// the task table/Kanban card show a "n/m" checklist badge without an extra
// round trip per task.
const CHECKLIST_COUNT_COLUMNS = `
  (SELECT COUNT(*) FROM checklist_items WHERE taskId = t.id) AS checklistTotal,
  (SELECT COUNT(*) FROM checklist_items WHERE taskId = t.id AND completed = 1) AS checklistDone,
  (SELECT p.name FROM profile p WHERE p.userId = t.assigneeId) AS assigneeName
`;

// A task is visible to anyone who can access its project — owner or
// accepted collaborator — not just whoever originally created it. Task
// "ownership" (the userId column) now just records who created it;
// assigneeId is who it's actually for.
function listTasks(userId, filters = {}) {
  let sql = `SELECT t.*, ${CHECKLIST_COUNT_COLUMNS} FROM tasks t WHERE t.deletedAt IS NULL AND t.projectId IN ${accessibleProjectIdsSQL()}`;
  const params = threeUserIds(userId);
  if (filters.projectId)   { sql += ' AND t.projectId = ?';   params.push(filters.projectId); }
  if (filters.status)      { sql += ' AND t.status = ?';      params.push(filters.status); }
  if (filters.priority)    { sql += ' AND t.priority = ?';    params.push(filters.priority); }
  if (filters.category)    { sql += ' AND t.category = ?';    params.push(filters.category); }
  if (filters.assigneeId)  { sql += ' AND t.assigneeId = ?';  params.push(filters.assigneeId); }
  if (filters.search)      { sql += ' AND LOWER(t.title) LIKE ?'; params.push('%' + filters.search.toLowerCase() + '%'); }
  sql += ' ORDER BY t.sortOrder ASC, t.createdAt ASC';
  const tasks = db.prepare(sql).all(...params).map(t => ({ ...t, cost: t.cost || 0 }));
  return attachTagsToTasks(tasks);
}

function getTaskById(userId, id) {
  const task = db.prepare(`SELECT t.*, ${CHECKLIST_COUNT_COLUMNS} FROM tasks t WHERE t.id = ? AND t.deletedAt IS NULL AND t.projectId IN ${accessibleProjectIdsSQL()}`).get(id, ...threeUserIds(userId));
  if (!task) return task;
  task.tags = getTaskTags(id);
  return task;
}

// A task can't start before the project it belongs to does — only checked
// when both dates are actually set, so tasks/projects without a start date
// are unaffected.
function assertTaskNotBeforeProject(project, taskStartDate) {
  if (project.startDate && taskStartDate && taskStartDate < project.startDate) {
    throw new Error(`Task can't start before the project's start date (${project.startDate})`);
  }
}

// An assignee must actually have access to the task's project — otherwise
// you could "assign" a task to someone who can't even see it.
function assertAssigneeCanAccessProject(assigneeId, projectId) {
  if (assigneeId && !canAccessProject(assigneeId, projectId)) {
    throw new Error("Assignee must be a collaborator on this project");
  }
}

function createTask(userId, task) {
  const project = getProjectById(userId, task.projectId);
  if (!project) throw new Error('Project not found');
  assertTaskNotBeforeProject(project, task.startDate);
  assertAssigneeCanAccessProject(task.assigneeId, task.projectId);
  // New tasks go to the bottom of their project's manual order — not
  // scoped to this creator's own tasks, so ordering stays correct when
  // several collaborators are adding tasks to the same project.
  const { maxOrder } = db.prepare('SELECT MAX(sortOrder) AS maxOrder FROM tasks WHERE projectId = ?').get(task.projectId);
  const sortOrder = (maxOrder ?? -1) + 1;
  db.prepare(`
    INSERT INTO tasks (id, userId, projectId, title, category, status, priority, startDate, endDate, cost, notes, recurrence, sortOrder, assigneeId, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(task.id, userId, task.projectId, task.title, task.category || '', task.status || 'Not Started', task.priority || 'Medium',
         task.startDate || '', task.endDate || '', task.cost || 0, task.notes || '', task.recurrence || 'none', sortOrder, task.assigneeId || null, task.createdAt);
  return getTaskById(userId, task.id);
}

// Persists a manual drag-to-reorder within one project — taskIds is the
// full new order for that project, so each task's sortOrder becomes its
// index in the array. Requires access to the project, not ownership of
// each individual task (a collaborator can reorder tasks someone else
// created, same as dragging a Kanban card).
function reorderTasks(userId, projectId, taskIds) {
  if (!canAccessProject(userId, projectId)) return;
  const stmt = db.prepare('UPDATE tasks SET sortOrder = ? WHERE id = ? AND projectId = ?');
  const run = db.transaction((ids) => {
    ids.forEach((id, index) => stmt.run(index, id, projectId));
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

// Any collaborator with access to the task's project can edit it — not
// just whoever created it, same collaborative model as the project itself.
function updateTaskById(userId, id, patch) {
  const current = getTaskById(userId, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  const project = getProjectById(userId, next.projectId);
  if (!project) throw new Error('Project not found');
  assertTaskNotBeforeProject(project, next.startDate);
  assertAssigneeCanAccessProject(next.assigneeId, next.projectId);
  db.prepare(`
    UPDATE tasks SET projectId=?, title=?, category=?, status=?, priority=?, startDate=?, endDate=?, cost=?, notes=?, recurrence=?, assigneeId=?
    WHERE id = ?
  `).run(next.projectId, next.title, next.category, next.status, next.priority, next.startDate, next.endDate, next.cost, next.notes, next.recurrence || 'none', next.assigneeId || null, id);

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
      assigneeId: next.assigneeId,
      createdAt: new Date().toISOString(),
    });
  }

  return getTaskById(userId, id);
}

function deleteTaskById(userId, id) {
  if (!getTaskById(userId, id)) return; // access check — owner or any accepted collaborator
  db.prepare('UPDATE tasks SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL').run(new Date().toISOString(), id);
}

// ── COLLABORATION (project sharing, invites, presence) ────────────
// Includes the project owner as a synthetic first entry (role 'owner',
// already-joined) — callers building an "assign to" picker or a "people
// with access" list want the complete set in one call, not the owner
// fetched separately.
function listCollaborators(projectId) {
  projectId = topLevelProjectId(projectId);
  const project = db.prepare('SELECT userId, createdAt FROM projects WHERE id = ?').get(projectId);
  if (!project) return [];
  const owner = db.prepare(`
    SELECT u.id AS userId, u.email, p.name, u.lastActiveAt
    FROM users u JOIN profile p ON p.userId = u.id WHERE u.id = ?
  `).get(project.userId);
  const ownerRow = owner ? [{ id: 'owner-' + owner.userId, userId: owner.userId, role: 'owner', invitedAt: project.createdAt, joinedAt: project.createdAt, email: owner.email, name: owner.name, lastActiveAt: owner.lastActiveAt }] : [];
  const collaborators = db.prepare(`
    SELECT pc.id, pc.userId, pc.role, pc.invitedAt, pc.joinedAt, u.email, p.name, u.lastActiveAt
    FROM project_collaborators pc
    JOIN users u ON u.id = pc.userId
    JOIN profile p ON p.userId = u.id
    WHERE pc.projectId = ?
    ORDER BY pc.invitedAt ASC
  `).all(projectId);
  return [...ownerRow, ...collaborators];
}

// Invites an existing account (by email) onto a project — owner-only.
// There's deliberately no "invite a stranger who doesn't have an account
// yet" flow — every person in the target scenario (a team where each
// member already runs the app individually) already has one.
function inviteCollaborator(inviterUserId, projectId, email) {
  projectId = topLevelProjectId(projectId);
  if (!isProjectOwner(inviterUserId, projectId)) throw new Error('Only the project owner can invite collaborators');
  const invitee = getUserByEmail(String(email || '').trim());
  if (!invitee) throw new Error('No Waypoint account found for that email');
  if (invitee.id === inviterUserId) throw new Error("That's your own account");
  const existing = db.prepare('SELECT * FROM project_collaborators WHERE projectId = ? AND userId = ?').get(projectId, invitee.id);
  if (existing) throw new Error(existing.joinedAt ? 'Already a collaborator on this project' : 'Already invited — waiting on them to accept');
  const row = { id: uuid(), projectId, userId: invitee.id, role: 'member', invitedAt: new Date().toISOString(), joinedAt: null };
  db.prepare('INSERT INTO project_collaborators (id, projectId, userId, role, invitedAt, joinedAt) VALUES (?,?,?,?,?,?)')
    .run(row.id, row.projectId, row.userId, row.role, row.invitedAt, row.joinedAt);
  return row;
}

// Every pending invite for this user, across every project that's invited
// them — their "you've been invited" inbox.
function listPendingInvites(userId) {
  return db.prepare(`
    SELECT pc.id, pc.projectId, pc.invitedAt, pr.title AS projectTitle, pr.icon AS projectIcon,
      op.name AS ownerName
    FROM project_collaborators pc
    JOIN projects pr ON pr.id = pc.projectId
    JOIN profile op ON op.userId = pr.userId
    WHERE pc.userId = ? AND pc.joinedAt IS NULL AND pr.deletedAt IS NULL
    ORDER BY pc.invitedAt DESC
  `).all(userId);
}

function acceptInvite(userId, inviteId) {
  const invite = db.prepare('SELECT * FROM project_collaborators WHERE id = ? AND userId = ?').get(inviteId, userId);
  if (!invite) return null;
  db.prepare('UPDATE project_collaborators SET joinedAt = ? WHERE id = ?').run(new Date().toISOString(), inviteId);
  return db.prepare('SELECT * FROM project_collaborators WHERE id = ?').get(inviteId);
}

function declineInvite(userId, inviteId) {
  db.prepare('DELETE FROM project_collaborators WHERE id = ? AND userId = ? AND joinedAt IS NULL').run(inviteId, userId);
}

// Owner-only. Any tasks already assigned to them keep that assignment —
// reassign manually if needed, same as any other team departure.
function removeCollaborator(ownerUserId, projectId, collaboratorUserId) {
  projectId = topLevelProjectId(projectId);
  if (!isProjectOwner(ownerUserId, projectId)) throw new Error('Only the project owner can remove collaborators');
  const result = db.prepare('DELETE FROM project_collaborators WHERE projectId = ? AND userId = ?').run(projectId, collaboratorUserId);
  return result.changes > 0;
}

// A lightweight "last seen" heartbeat, not a live socket connection — see
// connection.js. Called on ordinary API activity; a collaborator reads as
// active if this is recent, away otherwise.
function touchLastActive(userId) {
  db.prepare('UPDATE users SET lastActiveAt = ? WHERE id = ?').run(new Date().toISOString(), userId);
}

// ── TASK COMMENTS ──────────────────────────────────────────────────
function listComments(userId, taskId) {
  if (!getTaskById(userId, taskId)) return null;
  return db.prepare(`
    SELECT tc.id, tc.taskId, tc.userId, tc.text, tc.createdAt, p.name AS authorName
    FROM task_comments tc JOIN profile p ON p.userId = tc.userId
    WHERE tc.taskId = ? ORDER BY tc.createdAt ASC
  `).all(taskId);
}

function addComment(userId, taskId, text) {
  if (!getTaskById(userId, taskId)) return null;
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Comment text is required');
  const comment = { id: uuid(), taskId, userId, text: clean, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO task_comments (id, taskId, userId, text, createdAt) VALUES (?,?,?,?,?)')
    .run(comment.id, comment.taskId, comment.userId, comment.text, comment.createdAt);
  return { ...comment, authorName: getProfile(userId).name };
}

// The comment's own author, or the project owner, can delete it — a
// lightweight moderation boundary rather than a full permission matrix.
function deleteComment(userId, commentId) {
  const comment = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(commentId);
  if (!comment) return false;
  const task = db.prepare('SELECT projectId FROM tasks WHERE id = ?').get(comment.taskId);
  const authorized = comment.userId === userId || (task && isProjectOwner(userId, task.projectId));
  if (!authorized) return false;
  db.prepare('DELETE FROM task_comments WHERE id = ?').run(commentId);
  return true;
}

// ── TRASH ────────────────────────────────────────────────────────
// Soft-deleted projects/tasks older than this are purged for good — swept
// lazily on every listTrash() call rather than a separate cron job.
const TRASH_RETENTION_DAYS = 30;

function purgeOldTrash(userId) {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86400000).toISOString();
  // Projects first: their FK ON DELETE CASCADE takes any remaining trashed
  // tasks under them with it, so the tasks sweep below only has to catch
  // trashed tasks whose project is still active (or already gone).
  db.prepare('DELETE FROM projects WHERE userId = ? AND deletedAt IS NOT NULL AND deletedAt < ?').run(userId, cutoff);
  db.prepare('DELETE FROM tasks WHERE userId = ? AND deletedAt IS NOT NULL AND deletedAt < ?').run(userId, cutoff);
}

function listTrash(userId) {
  purgeOldTrash(userId);
  const projects = db.prepare('SELECT * FROM projects WHERE userId = ? AND deletedAt IS NOT NULL ORDER BY deletedAt DESC').all(userId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE userId = ? AND deletedAt IS NOT NULL ORDER BY deletedAt DESC').all(userId)
    .map(t => ({ ...t, cost: t.cost || 0 }));
  return { projects, tasks };
}

// Restoring a project brings back every task/sub-folder that was trashed
// alongside it (see deleteProjectById's cascade) — a sub-folder trashed
// independently, before its parent, is left alone.
function restoreProject(userId, id) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND userId = ? AND deletedAt IS NOT NULL').get(id, userId);
  if (!project) return null;
  const childIds = db.prepare('SELECT id FROM projects WHERE parentId = ? AND userId = ? AND deletedAt IS NOT NULL').all(id, userId).map(r => r.id);
  const allIds = [id, ...childIds];
  const stmtProj  = db.prepare('UPDATE projects SET deletedAt = NULL WHERE id = ? AND userId = ?');
  const stmtTasks = db.prepare('UPDATE tasks SET deletedAt = NULL WHERE projectId = ? AND userId = ?');
  db.transaction(() => {
    allIds.forEach(pid => { stmtProj.run(pid, userId); stmtTasks.run(pid, userId); });
  })();
  return getProjectById(userId, id);
}

// A task's own project might still be in the trash (it was deleted solo,
// or its project was trashed after it) — restore that too, so the
// restored task doesn't land on a project page that 404s.
function restoreTask(userId, id) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND userId = ? AND deletedAt IS NOT NULL').get(id, userId);
  if (!task) return null;
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND userId = ?').get(task.projectId, userId);
  if (project && project.deletedAt) restoreProject(userId, project.id);
  db.prepare('UPDATE tasks SET deletedAt = NULL WHERE id = ? AND userId = ?').run(id, userId);
  return getTaskById(userId, id);
}

function purgeProjectForever(userId, id) {
  db.prepare('DELETE FROM projects WHERE id = ? AND userId = ? AND deletedAt IS NOT NULL').run(id, userId); // tasks cascade via FK
}

function purgeTaskForever(userId, id) {
  db.prepare('DELETE FROM tasks WHERE id = ? AND userId = ? AND deletedAt IS NOT NULL').run(id, userId);
}

// ── TAGS (custom labels, many-to-many with tasks) ────────────────
function listTags(userId) {
  return db.prepare('SELECT * FROM tags WHERE userId = ? ORDER BY label ASC').all(userId);
}

function createTag(userId, { label, color }) {
  const tag = { id: uuid(), userId, label: String(label || '').trim(), color: color || '#6B7280' };
  if (!tag.label) throw new Error('Tag name is required');
  db.prepare('INSERT INTO tags (id, userId, label, color) VALUES (?,?,?,?)').run(tag.id, tag.userId, tag.label, tag.color);
  return tag;
}

function updateTag(userId, id, { label, color }) {
  const current = db.prepare('SELECT * FROM tags WHERE id = ? AND userId = ?').get(id, userId);
  if (!current) return null;
  const next = { ...current, label: label !== undefined ? String(label).trim() : current.label, color: color || current.color };
  if (!next.label) throw new Error('Tag name is required');
  db.prepare('UPDATE tags SET label = ?, color = ? WHERE id = ? AND userId = ?').run(next.label, next.color, id, userId);
  return next;
}

// task_tags cascades via FK, so deleting a tag also detaches it from
// every task that had it — no separate cleanup needed.
function deleteTag(userId, id) {
  db.prepare('DELETE FROM tags WHERE id = ? AND userId = ?').run(id, userId);
}

// Every tag currently attached to one task, ordered by label.
function getTaskTags(taskId) {
  return db.prepare(`
    SELECT tg.id, tg.label, tg.color FROM task_tags tt JOIN tags tg ON tg.id = tt.tagId
    WHERE tt.taskId = ? ORDER BY tg.label ASC
  `).all(taskId);
}

// Attaches this task's tags to a whole batch of already-fetched tasks in
// one extra query, instead of one query per task — used by listTasks.
function attachTagsToTasks(tasks) {
  if (!tasks.length) return tasks;
  const placeholders = tasks.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT tt.taskId, tg.id, tg.label, tg.color FROM task_tags tt JOIN tags tg ON tg.id = tt.tagId
    WHERE tt.taskId IN (${placeholders}) ORDER BY tg.label ASC
  `).all(...tasks.map(t => t.id));
  const byTask = {};
  rows.forEach(r => { (byTask[r.taskId] = byTask[r.taskId] || []).push({ id: r.id, label: r.label, color: r.color }); });
  tasks.forEach(t => { t.tags = byTask[t.id] || []; });
  return tasks;
}

// Replaces a task's whole tag set with exactly the given list — simpler
// "set" semantics than incremental attach/detach, matching a multi-select
// checkbox picker in the UI that always submits the full current selection.
function setTaskTags(userId, taskId, tagIds) {
  if (!getTaskById(userId, taskId)) return null;
  const ids = [...new Set((tagIds || []).filter(Boolean))];
  // Only tags that actually belong to this user can be attached — silently
  // drop anything else rather than erroring on a stale/foreign id.
  const owned = ids.length
    ? db.prepare(`SELECT id FROM tags WHERE userId = ? AND id IN (${ids.map(() => '?').join(',')})`).all(userId, ...ids).map(r => r.id)
    : [];
  db.transaction(() => {
    db.prepare('DELETE FROM task_tags WHERE taskId = ?').run(taskId);
    const insert = db.prepare('INSERT INTO task_tags (taskId, tagId) VALUES (?, ?)');
    owned.forEach(tagId => insert.run(taskId, tagId));
  })();
  return getTaskTags(taskId);
}

// ── CHECKLIST ITEMS (lightweight subtasks within a task) ─────────
function listChecklistItems(userId, taskId) {
  if (!getTaskById(userId, taskId)) return null;
  return db.prepare('SELECT * FROM checklist_items WHERE taskId = ? ORDER BY sortOrder ASC').all(taskId);
}

function addChecklistItem(userId, taskId, title) {
  if (!getTaskById(userId, taskId)) return null;
  const { maxOrder } = db.prepare('SELECT MAX(sortOrder) AS maxOrder FROM checklist_items WHERE taskId = ?').get(taskId);
  const item = { id: uuid(), taskId, title, completed: 0, sortOrder: (maxOrder ?? -1) + 1 };
  db.prepare('INSERT INTO checklist_items (id, taskId, title, completed, sortOrder) VALUES (?,?,?,?,?)')
    .run(item.id, item.taskId, item.title, item.completed, item.sortOrder);
  return item;
}

// A checklist item's own row doesn't carry userId — authorize an
// update/delete by item id alone by looking up which task it belongs to
// and checking that task against the requesting user.
function getChecklistItemTaskId(id) {
  const row = db.prepare('SELECT taskId FROM checklist_items WHERE id = ?').get(id);
  return row ? row.taskId : null;
}

function updateChecklistItem(userId, id, patch) {
  const taskId = getChecklistItemTaskId(id);
  if (!taskId || !getTaskById(userId, taskId)) return null;
  const current = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id);
  const next = { ...current, ...patch };
  db.prepare('UPDATE checklist_items SET title = ?, completed = ? WHERE id = ?').run(next.title, next.completed ? 1 : 0, id);
  return db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id);
}

function deleteChecklistItem(userId, id) {
  const taskId = getChecklistItemTaskId(id);
  if (!taskId || !getTaskById(userId, taskId)) return false;
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(id);
  return true;
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

// ── SEARCH (topbar global search) ───────────────────────────────
function searchAll(userId, q) {
  const like = '%' + q.toLowerCase() + '%';
  const projects = db.prepare(`
    SELECT * FROM projects WHERE userId = ? AND deletedAt IS NULL AND LOWER(title) LIKE ?
    ORDER BY createdAt DESC LIMIT 8
  `).all(userId, like);
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE userId = ? AND deletedAt IS NULL AND LOWER(title) LIKE ?
    ORDER BY createdAt DESC LIMIT 8
  `).all(userId, like).map(t => ({ ...t, cost: t.cost || 0 }));
  return { projects, tasks };
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
  getProfile, updateProfile, listUsersForDigest, setLastDigestSentDate,
  listProjects, getProjectById, createProject, updateProjectById, deleteProjectById,
  getProjectRole, canAccessProject, isProjectOwner,
  listTasks, getTaskById, createTask, updateTaskById, deleteTaskById, reorderTasks,
  listCollaborators, inviteCollaborator, listPendingInvites, acceptInvite, declineInvite, removeCollaborator, touchLastActive,
  listComments, addComment, deleteComment,
  listTrash, restoreProject, restoreTask, purgeProjectForever, purgeTaskForever,
  listChecklistItems, addChecklistItem, updateChecklistItem, deleteChecklistItem,
  listTags, createTag, updateTag, deleteTag, setTaskTags, getTaskTags,
  getWealth, updateWealthEntries, addWealthTarget, updateWealthTarget, deleteWealthTarget, addMonthlyLogEntry, deleteMonthlyLogEntry,
  getGoogleDrive, setGoogleDrive,
  searchAll,
  getFullSnapshot,
};
