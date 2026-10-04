const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

// Must be set before the db module loads, so these tests run against a
// throwaway database rather than the developer's real one.
const dbFile = path.join(os.tmpdir(), `waypoint-db-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');
const Database = require('better-sqlite3');

const dateKey = daysAgo => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const now = () => new Date().toISOString();

function newUser() {
  return db.createUser({ id: randomUUID(), email: `db_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: now(), acceptedTermsAt: now() });
}
function newTask(userId, projectId, extra = {}) {
  return db.createTask(userId, { id: randomUUID(), projectId, title: 'Task', status: 'Not Started', priority: 'Medium', createdAt: now(), ...extra });
}
function setStreakDate(userId, isoDay) {
  const raw = new Database(dbFile);
  raw.prepare('UPDATE profile SET lastStreakDate = ? WHERE userId = ?').run(isoDay, userId);
  raw.close();
}

after(() => {
  require('../backend/db/connection').close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
});

test('first completion starts a streak of 1', () => {
  const user = newUser();
  const project = db.createProject(user.id, { id: randomUUID(), title: 'P', createdAt: now() });
  const task = newTask(user.id, project.id);
  db.updateTaskById(user.id, task.id, { status: 'Completed' });
  const profile = db.getProfile(user.id);
  assert.equal(profile.currentStreak, 1);
  assert.equal(profile.longestStreak, 1);
  assert.equal(profile.lastStreakDate, dateKey(0));
  assert.ok(db.getTaskById(user.id, task.id).completedAt);
});

test('a second completion on the same day does not double-count', () => {
  const user = newUser();
  const project = db.createProject(user.id, { id: randomUUID(), title: 'P', createdAt: now() });
  db.updateTaskById(user.id, newTask(user.id, project.id).id, { status: 'Completed' });
  db.updateTaskById(user.id, newTask(user.id, project.id).id, { status: 'Completed' });
  assert.equal(db.getProfile(user.id).currentStreak, 1);
});

test('completing the day after extends the streak', () => {
  const user = newUser();
  const project = db.createProject(user.id, { id: randomUUID(), title: 'P', createdAt: now() });
  db.updateTaskById(user.id, newTask(user.id, project.id).id, { status: 'Completed' });
  setStreakDate(user.id, dateKey(1));
  db.updateTaskById(user.id, newTask(user.id, project.id).id, { status: 'Completed' });
  assert.equal(db.getProfile(user.id).currentStreak, 2);
});

test('a gap resets the current streak but never lowers the longest', () => {
  const user = newUser();
  const project = db.createProject(user.id, { id: randomUUID(), title: 'P', createdAt: now() });
  db.updateTaskById(user.id, newTask(user.id, project.id).id, { status: 'Completed' });
  setStreakDate(user.id, dateKey(1));
  db.updateTaskById(user.id, newTask(user.id, project.id).id, { status: 'Completed' });
  setStreakDate(user.id, dateKey(5));
  db.updateTaskById(user.id, newTask(user.id, project.id).id, { status: 'Completed' });
  const profile = db.getProfile(user.id);
  assert.equal(profile.currentStreak, 1);
  assert.equal(profile.longestStreak, 2);
});

test('reopening a task clears its completedAt without touching the streak', () => {
  const user = newUser();
  const project = db.createProject(user.id, { id: randomUUID(), title: 'P', createdAt: now() });
  const task = newTask(user.id, project.id);
  db.updateTaskById(user.id, task.id, { status: 'Completed' });
  db.updateTaskById(user.id, task.id, { status: 'In Progress' });
  assert.equal(db.getTaskById(user.id, task.id).completedAt, null);
  assert.equal(db.getProfile(user.id).currentStreak, 1);
});

test('hasCompletedTaskToday reflects today only', () => {
  const user = newUser();
  assert.equal(db.hasCompletedTaskToday(user.id, dateKey(0)), false);
  const project = db.createProject(user.id, { id: randomUUID(), title: 'P', createdAt: now() });
  db.updateTaskById(user.id, newTask(user.id, project.id).id, { status: 'Completed' });
  assert.equal(db.hasCompletedTaskToday(user.id, dateKey(0)), true);
});

test('AI quota allows 15 calls per day then blocks', () => {
  const user = newUser();
  let allowed = 0;
  for (let i = 0; i < 16; i++) if (db.consumeAiQuota(user.id)) allowed++;
  assert.equal(allowed, 15);
  assert.equal(db.consumeAiQuota(user.id), false);
});

test('AI quota resets when the stored day is stale', () => {
  const user = newUser();
  const raw = new Database(dbFile);
  raw.prepare('UPDATE profile SET aiCallsToday = 15, aiCallsResetDate = ? WHERE userId = ?').run(dateKey(1), user.id);
  raw.close();
  assert.equal(db.consumeAiQuota(user.id), true);
});

test('goal task tree includes phase sub-projects but not unrelated projects', () => {
  const user = newUser();
  const goal = db.createProject(user.id, { id: randomUUID(), title: 'Goal', isGoal: true, createdAt: now() });
  const phase = db.createProject(user.id, { id: randomUUID(), title: 'Phase 1', parentId: goal.id, createdAt: now() });
  const other = db.createProject(user.id, { id: randomUUID(), title: 'Other', createdAt: now() });
  newTask(user.id, goal.id);
  newTask(user.id, phase.id);
  newTask(user.id, other.id);
  assert.equal(db.listTasksInProjectTree(user.id, goal.id).length, 2);
});

test('only opted-in goals are listed for weekly check-ins', () => {
  const user = newUser();
  const goal = db.createProject(user.id, { id: randomUUID(), title: 'Goal', isGoal: true, createdAt: now() });
  const listed = () => db.listGoalProjectsForCheckIn().some(g => g.projectId === goal.id);
  assert.equal(listed(), false);
  db.updateProfile(user.id, { aiCheckInsEnabled: true });
  assert.equal(listed(), true);
});

test('consent timestamp is stored when provided', () => {
  const user = newUser();
  assert.ok(db.getUserById(user.id).acceptedTermsAt);
});
