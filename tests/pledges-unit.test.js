const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Its own throwaway database, shared with the pledge code in this process.
const dbPath = path.join(os.tmpdir(), `wayrise-pledges-${Date.now()}.sqlite`);
process.env.DB_PATH = dbPath;
const db = require('../backend/db/db');
const conn = require('../backend/db/connection');
const pledges = require('../backend/pledges');
after(() => { conn.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true }); });

let n = 0;
function goalWithOneTask() {
  n++;
  const user = db.createUser({ id: `u${n}`, email: `u${n}@example.com`, passwordHash: 'x', createdAt: new Date().toISOString(), acceptedTermsAt: new Date().toISOString() });
  const p = db.createProject(user.id, { id: `p${n}`, title: 'Learn to swim', isGoal: true, createdAt: new Date().toISOString() });
  const t = db.createTask(user.id, { id: `t${n}`, projectId: p.id, title: 'Lessons', status: 'Not Started', priority: 'Medium', createdAt: new Date().toISOString() });
  return { user, p, t };
}

test('a finish-by date that passes first is missed', () => {
  const { p } = goalWithOneTask();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const pl = pledges.create(p.id, { name: 'Coach', reward: 'New goggles', condition: 'by_date', byDate: tomorrow });
  assert.equal(pl.status, 'pledged');
  conn.prepare('UPDATE pledges SET byDate = ? WHERE id = ?').run('2000-01-01', pl.id);
  pledges.refresh(p.id, { notify: false });
  assert.equal(pledges.get(pl.id).status, 'missed');
});

test('finished in time is earned; a withdrawn pledge stays withdrawn', () => {
  const { user, p, t } = goalWithOneTask();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const inTime = pledges.create(p.id, { name: 'Dad', amount: '20', currency: 'USD', condition: 'by_date', byDate: tomorrow });
  const gone = pledges.create(p.id, { name: 'Friend', reward: 'Pizza' });
  pledges.withdraw(gone.id);
  db.updateTaskById(user.id, t.id, { status: 'Completed' });
  const earned = pledges.refresh(p.id, { notify: false });
  assert.deepEqual(earned.map(x => x.id), [inTime.id]);
  assert.equal(pledges.get(gone.id).status, 'withdrawn');
  assert.equal(pledges.rewardText(inTime), 'US$20');
});

test('the form is cleaned: amounts, dates, emails and lengths', () => {
  assert.throws(() => pledges.clean({ name: 'A' }), /Say what the reward is/);
  assert.throws(() => pledges.clean({ name: 'A', amount: '0' }), /Enter an amount/);
  assert.throws(() => pledges.clean({ name: 'A', reward: 'x', condition: 'by_date', byDate: '2000-01-01' }), /already passed/);
  assert.throws(() => pledges.clean({ name: 'A', reward: 'x', email: 'not-an-email' }), /email/);
  const c = pledges.clean({ name: '  Mum  ', amount: '£1,250.50', currency: 'NGN', reward: 'x'.repeat(500), relation: 'hacker' });
  assert.equal(c.name, 'Mum');
  assert.equal(c.amount, 125050);
  assert.equal(c.reward.length, 140);
  assert.equal(c.relation, 'other');
});
