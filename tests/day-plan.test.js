const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const dbFile = path.join(os.tmpdir(), `wayrise-dayplan-test-${process.pid}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');
const dayPlan = require('../backend/dayPlan');
const conn = require('../backend/db/connection');

after(() => { conn.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true }); });

const now = () => new Date().toISOString();
const user = () => db.createUser({ id: randomUUID(), email: `p_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: now(), acceptedTermsAt: now() });
const project = u => db.createProject(u.id, { id: randomUUID(), title: 'Goal', createdAt: now() });
const task = (u, p) => db.createTask(u.id, { id: randomUUID(), projectId: p.id, title: 'Task', status: 'Not Started', priority: 'Medium', createdAt: now() });

test('a day plan is saved in time order and read back', () => {
  const u = user(); const p = project(u); const a = task(u, p); const b = task(u, p);
  dayPlan.save(u.id, '2026-10-12', [{ taskId: b.id, start: '11:00', minutes: 30 }, { taskId: a.id, start: '09:00', minutes: 45 }]);
  const plan = dayPlan.get(u.id, '2026-10-12');
  assert.deepEqual(plan.items.map(i => [i.start, i.minutes]), [['09:00', 45], ['11:00', 30]]);
  assert.equal(dayPlan.get(u.id, '2026-10-13'), null);
});

test("someone else's task, bad times and duplicates are refused", () => {
  const u = user(); const other = user(); const theirs = task(other, project(other)); const mine = task(u, project(u));
  assert.throws(() => dayPlan.save(u.id, '2026-10-12', [{ taskId: theirs.id, start: '09:00', minutes: 30 }]), /not found/);
  assert.throws(() => dayPlan.save(u.id, '2026-10-12', [{ taskId: mine.id, start: '9am', minutes: 30 }]), /start time/);
  assert.throws(() => dayPlan.save(u.id, '2026-10-12', [{ taskId: mine.id, start: '09:00', minutes: 2 }]), /5 minutes/);
  assert.throws(() => dayPlan.save(u.id, '2026-10-12', [{ taskId: mine.id, start: '09:00', minutes: 30 }, { taskId: mine.id, start: '10:00', minutes: 30 }]), /once/);
  assert.throws(() => dayPlan.get(u.id, 'today'), /date/);
});

test('the wake-up notification is due once, at the local wake time', () => {
  const u = user();
  dayPlan.setWake(u.id, '07:00', 'Europe/London');
  // 06:05 UTC on 12 Oct 2026 is 07:05 in London (summer time)
  const at = new Date('2026-10-12T06:05:00Z');
  assert.ok(dayPlan.dueWakeUps(at).some(w => w.userId === u.id && w.date === '2026-10-12'));
  assert.ok(!dayPlan.dueWakeUps(new Date('2026-10-12T05:50:00Z')).some(w => w.userId === u.id), 'not before');
  assert.ok(!dayPlan.dueWakeUps(new Date('2026-10-12T07:00:00Z')).some(w => w.userId === u.id), 'not an hour late');
  dayPlan.markWakeSent(u.id, '2026-10-12');
  assert.ok(!dayPlan.dueWakeUps(at).some(w => w.userId === u.id), 'only once a day');
  assert.throws(() => dayPlan.setWake(u.id, '07:00', 'Mars/Base'), /time zone/);
  dayPlan.setWake(u.id, null);
  assert.equal(dayPlan.getWake(u.id).time, null);
});
