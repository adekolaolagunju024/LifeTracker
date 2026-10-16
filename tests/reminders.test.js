const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

// A throwaway database, set before the db module loads.
const dbFile = path.join(os.tmpdir(), `kolaway-reminders-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');
const { checkTaskReminders } = require('../backend/push/scheduler');

const now = () => new Date().toISOString();
const inMinutes = m => new Date(Date.now() + m * 60000).toISOString();
function setup() {
  const user = db.createUser({ id: randomUUID(), email: `rem_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: now(), acceptedTermsAt: now() });
  const project = db.createProject(user.id, { id: randomUUID(), title: 'P', createdAt: now() });
  const task = db.createTask(user.id, { id: randomUUID(), projectId: project.id, title: 'Write the CV', status: 'Not Started', priority: 'Medium', createdAt: now() });
  return { user, project, task };
}
const ringing = id => db.listRemindersToRing(new Date(Date.now() + 1000)).filter(r => r.id === id);

after(() => {
  require('../backend/db/connection').close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
});

test('a reminder is set, listed, and replaced rather than duplicated', () => {
  const { user, task } = setup();
  const first = db.setTaskReminder(user.id, task.id, { remindAt: inMinutes(30) });
  assert.equal(first.taskTitle, 'Write the CV');
  assert.equal(first.nag, true);
  const second = db.setTaskReminder(user.id, task.id, { remindAt: inMinutes(60), nag: false });
  assert.equal(second.id, first.id);
  assert.equal(second.nag, false);
  assert.equal(db.listReminders(user.id).length, 1);
});

test('a time in the past or an invalid time is refused', () => {
  const { user, task } = setup();
  assert.throws(() => db.setTaskReminder(user.id, task.id, { remindAt: inMinutes(-10) }), /already passed/);
  assert.throws(() => db.setTaskReminder(user.id, task.id, { remindAt: 'soon' }), /valid date/);
});

test('someone who cannot see the task cannot set a reminder on it', () => {
  const { task } = setup();
  const stranger = setup().user;
  assert.equal(db.setTaskReminder(stranger.id, task.id, { remindAt: inMinutes(5) }), null);
});

test('a due reminder rings once, then nags every 5 minutes up to 4 rings', async () => {
  const { user, task } = setup();
  const r = db.setTaskReminder(user.id, task.id, { remindAt: inMinutes(0.5) });
  assert.equal(ringing(r.id).length, 0, 'not due yet');
  const later = new Date(Date.now() + 31000);
  await checkTaskReminders(later);
  assert.equal(db.getReminder(user.id, r.id).fireCount, 1);
  await checkTaskReminders(new Date(later.getTime() + 60000));
  assert.equal(db.getReminder(user.id, r.id).fireCount, 1, 'no repeat within 5 minutes');
  for (let i = 1; i <= 5; i++) await checkTaskReminders(new Date(later.getTime() + i * 5 * 60000 + 1000));
  assert.equal(db.getReminder(user.id, r.id).fireCount, 4, 'stops after the first ring and three repeats');
});

test('without nag it rings only once', async () => {
  const { user, task } = setup();
  const r = db.setTaskReminder(user.id, task.id, { remindAt: inMinutes(0.01), nag: false });
  const t0 = new Date(Date.now() + 2000);
  await checkTaskReminders(t0);
  await checkTaskReminders(new Date(t0.getTime() + 6 * 60000));
  assert.equal(db.getReminder(user.id, r.id).fireCount, 1);
});

test('answering stops it ringing; snoozing moves it and starts over', () => {
  const { user, task } = setup();
  const r = db.setTaskReminder(user.id, task.id, { remindAt: inMinutes(0.01) });
  db.markReminderRung(r.id);
  const snoozed = db.snoozeReminder(user.id, r.id, 10);
  assert.equal(snoozed.fireCount, 0);
  assert.ok(new Date(snoozed.remindAt).getTime() > Date.now() + 9 * 60000);
  assert.ok(db.ackReminder(user.id, r.id));
  assert.equal(db.listReminders(user.id).length, 0);
  assert.equal(db.listRemindersToRing(new Date(Date.now() + 3600000)).filter(x => x.id === r.id).length, 0);
});

test('a finished task never rings, and its blockers ride along when it does', () => {
  const { user, task } = setup();
  db.addObstacle(user.id, task.id, { name: 'Laptop broken', count: 1 });
  const r = db.setTaskReminder(user.id, task.id, { remindAt: inMinutes(0.01) });
  assert.deepEqual(ringing(r.id)[0].pendingBlockers, ['Laptop broken']);
  const other = setup();
  const r2 = db.setTaskReminder(other.user.id, other.task.id, { remindAt: inMinutes(0.01) });
  db.updateTaskById(other.user.id, other.task.id, { status: 'Completed' });
  assert.equal(ringing(r2.id).length, 0);
});

test('another person cannot snooze, answer or remove your reminder', () => {
  const { user, task } = setup();
  const stranger = setup().user;
  const r = db.setTaskReminder(user.id, task.id, { remindAt: inMinutes(5) });
  assert.equal(db.snoozeReminder(stranger.id, r.id, 10), null);
  assert.equal(db.ackReminder(stranger.id, r.id), false);
  assert.equal(db.deleteTaskReminder(stranger.id, task.id), false);
  assert.equal(db.listReminders(user.id).length, 1);
});
