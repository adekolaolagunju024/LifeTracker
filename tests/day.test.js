const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const dbFile = path.join(os.tmpdir(), `kolaway-day-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');
const { buildDayContext, validateActions } = require('../backend/ai/day');

const now = () => new Date().toISOString();
const user = () => db.createUser({ id: randomUUID(), email: `d_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: now(), acceptedTermsAt: now() });
const project = (u, title) => db.createProject(u.id, { id: randomUUID(), title, createdAt: now() });
const task = (u, p, extra) => db.createTask(u.id, { id: randomUUID(), projectId: p.id, title: 'Task', status: 'Not Started', priority: 'Medium', createdAt: now(), ...extra });

after(() => {
  require('../backend/db/connection').close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
});

test('the day context lists what matters, most urgent first, with ids', () => {
  const u = user();
  const p = project(u, 'Bakery');
  task(u, p, { title: 'Later thing', endDate: '2099-01-01' });
  const late = task(u, p, { title: 'Late thing', endDate: '2026-10-01' });
  task(u, p, { title: 'Today thing', endDate: '2026-10-11' });
  task(u, p, { title: 'Done thing', endDate: '2026-10-11', status: 'Completed' });
  const day = buildDayContext(u.id, '2026-10-11');
  assert.ok(day.text.indexOf('Late thing') < day.text.indexOf('Today thing'));
  assert.match(day.text, new RegExp(`task id:${late.id}`));
  assert.match(day.text, /OVERDUE since 2026-10-01/);
  assert.doesNotMatch(day.text, /Done thing/);
  assert.doesNotMatch(day.text, /Later thing/);
  assert.match(day.text, new RegExp(`project id:${p.id}`));
});

test('actions only keep pages, projects and tasks the person can reach', () => {
  const u = user(), stranger = user();
  const p = project(u, 'Mine');
  const t = task(u, p, { title: 'Write CV' });
  const theirs = task(stranger, project(stranger, 'Theirs'), { title: 'Not yours' });
  const day = buildDayContext(u.id, '2026-10-11');
  const later = new Date(Date.now() + 3600000).toISOString();
  const out = validateActions(u.id, [
    { type: 'open_page', page: 'calendar' },
    { type: 'open_page', page: 'admin' },
    { type: 'open_project', projectId: p.id },
    { type: 'open_task', taskId: theirs.id },
    { type: 'start_focus', taskId: t.id, minutes: 500 },
    { type: 'complete_task', taskId: theirs.id },
    { type: 'complete_task', taskId: t.id },
    { type: 'set_reminder', taskId: t.id, at: later },
  ], day);
  assert.deepEqual(out.map(a => a.type), ['open_page', 'open_project', 'start_focus', 'complete_task', 'set_reminder']);
  assert.equal(out.find(a => a.type === 'start_focus').minutes, 90);
  assert.equal(out.find(a => a.type === 'complete_task').taskId, t.id);
});

test('reminders must be in the future, and viewers cannot change a shared project', () => {
  const owner = user(), viewer = user();
  const p = project(owner, 'Shared');
  const t = task(owner, p, { title: 'Shared task' });
  const inv = db.inviteCollaborator(owner.id, p.id, viewer.email, 'viewer');
  db.acceptInvite(viewer.id, inv.id);
  const day = buildDayContext(viewer.id, '2026-10-11');
  const out = validateActions(viewer.id, [
    { type: 'set_reminder', taskId: t.id, at: '2000-01-01T09:00:00Z' },
    { type: 'complete_task', taskId: t.id },
    { type: 'add_task', projectId: p.id, title: 'Sneaky' },
    { type: 'open_task', taskId: t.id },
  ], day);
  assert.deepEqual(out.map(a => a.type), ['open_task']);
});
