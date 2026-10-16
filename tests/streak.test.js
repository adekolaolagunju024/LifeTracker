const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.tmpdir(), `wayrise-streak-${Date.now()}.sqlite`);
process.env.DB_PATH = dbPath;
const db = require('../backend/db/db');
const conn = require('../backend/db/connection');
after(() => { conn.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true }); });

const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return key(d); };

test('a streak counts while its last day is today or yesterday, and shows 0 once a day is missed', () => {
  const user = db.createUser({ id: 'su1', email: 'su1@example.com', passwordHash: 'x', createdAt: new Date().toISOString() });
  const set = (n, last) => conn.prepare('UPDATE profile SET currentStreak = ?, longestStreak = 9, lastStreakDate = ? WHERE userId = ?').run(n, last, user.id);

  set(5, daysAgo(0));
  assert.equal(db.getProfile(user.id).currentStreak, 5);
  set(5, daysAgo(1));
  assert.equal(db.getProfile(user.id).currentStreak, 5, 'still alive until today ends');
  set(5, daysAgo(2));
  assert.equal(db.getProfile(user.id).currentStreak, 0, 'a missed day ends it');
  assert.equal(db.getProfile(user.id).longestStreak, 9, 'the best streak is kept');

  // Finishing a task after the gap starts again at 1
  db.createProject(user.id, { id: 'sp1', title: 'Goal', createdAt: new Date().toISOString() });
  db.createTask(user.id, { id: 'st1', projectId: 'sp1', title: 'Step', status: 'Not Started', priority: 'Medium', createdAt: new Date().toISOString() });
  db.updateTaskById(user.id, 'st1', { status: 'Completed' });
  assert.equal(db.getProfile(user.id).currentStreak, 1);
});
