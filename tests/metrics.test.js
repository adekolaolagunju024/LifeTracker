const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const dbFile = path.join(os.tmpdir(), `startline-metrics-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');
const raw = require('../backend/db/connection');
const metrics = require('../backend/metrics');

const DAY = 86400000;
const NOW = Date.parse('2026-10-11T12:00:00Z');
const ago = d => new Date(NOW - d * DAY).toISOString();
function user(joinedDaysAgo) {
  return db.createUser({ id: randomUUID(), email: `m_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: ago(joinedDaysAgo), acceptedTermsAt: ago(joinedDaysAgo) });
}
const event = (userId, name, daysAgo) => raw.prepare('INSERT INTO analytics_events (id, userId, event, createdAt) VALUES (?,?,?,?)').run(randomUUID(), userId, name, ago(daysAgo));
const goal = (userId, daysAgo) => raw.prepare('INSERT INTO projects (id, userId, title, createdAt) VALUES (?,?,?,?)').run(randomUUID(), userId, 'Goal', ago(daysAgo));

after(() => {
  raw.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
  delete process.env.ADMIN_EMAILS;
});

test('the first account is the owner unless ADMIN_EMAILS names someone', () => {
  const first = user(200);
  const other = user(100);
  assert.equal(metrics.isOwner(first.id), true);
  assert.equal(metrics.isOwner(other.id), false);
  process.env.ADMIN_EMAILS = ` ${other.email.toUpperCase()} , someone@else.com`;
  assert.equal(metrics.isOwner(other.id), true);
  assert.equal(metrics.isOwner(first.id), false);
  delete process.env.ADMIN_EMAILS;
});

test('funnel, activation and week-4 retention count the right people', () => {
  // A: joined 40 days ago, made a goal, finished a task on day 2, active in week 4.
  const a = user(40); goal(a.id, 39); event(a.id, 'task_completed', 38); event(a.id, 'active_day', 15);
  // B: joined 35 days ago, made a goal, never finished anything, gone.
  const b = user(35); goal(b.id, 35);
  // C: joined 3 days ago: too new for activation or week 4.
  const c = user(3); event(c.id, 'task_completed', 2);
  const m = metrics.buildMetrics(NOW);
  const step = name => m.funnel.find(s => s.step === name);
  assert.equal(step('Signed up').count, 3);
  assert.equal(step('Created a goal').count, 2);
  assert.equal(step('Finished a task').count, 2);
  assert.deepEqual([step('Still here in week 4').count, step('Still here in week 4').of], [1, 2]);
  assert.deepEqual(m.headline.activation, { rate: 50, of: 2 });
  assert.deepEqual(m.headline.week4, { rate: 50, of: 2 });
  assert.equal(m.weeks.length, 12);
  assert.equal(m.headline.active7, 1); // only C did anything this week
});

test('cohort cells are blank for weeks that have not happened', () => {
  const m = metrics.buildMetrics(NOW);
  const newest = m.cohorts[m.cohorts.length - 1];
  assert.ok(newest.weeks.every(v => v === null));
  assert.equal(m.cohorts.length, 8);
});

test('landing visits count people, not crawlers', () => {
  metrics.countPageView('landing', 'Mozilla/5.0 (iPhone)');
  metrics.countPageView('landing', 'Googlebot/2.1');
  metrics.countPageView('landing', 'HeadlessChrome');
  metrics.countPageView('landing', '');
  assert.equal(raw.prepare("SELECT SUM(views) AS n FROM page_views WHERE path = 'landing'").get().n, 1);
});

test('active days are recorded once per person per day', () => {
  const u = user(1);
  db.recordActiveDay(u.id); db.recordActiveDay(u.id);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE userId = ? AND event = 'active_day'").get(u.id).n, 1);
});
