const { test } = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../frontend/js/progressMath');

const task = (startDate, endDate, status = 'Not Started', extra = {}) => ({ startDate, endDate, status, ...extra });

test('a long task counts for more than a short one', () => {
  const tasks = [
    task('2026-10-01', '2026-10-01', 'Completed'), // 1 day, done
    task('2026-10-02', '2026-10-20'),               // 19 days, not done
  ];
  assert.equal(PM.progressPct(tasks), 5); // 1 / 20, not 50%
});

test('target counts earn partial credit', () => {
  const tasks = [task('2026-10-01', '2026-10-10', 'In Progress', { targetCount: 20, progressCount: 10 })];
  assert.equal(PM.progressPct(tasks), 50);
});

test('undated tasks weigh the average of the dated ones', () => {
  const tasks = [task('2026-10-01', '2026-10-04', 'Completed'), task(null, null)];
  assert.equal(PM.progressPct(tasks), 50);
});

test('never shows 100% until every task is done', () => {
  const tasks = [task('2026-01-01', '2026-03-31', 'Completed'), task('2026-04-01', '2026-04-01')];
  assert.equal(PM.progressPct(tasks), 99);
  assert.equal(PM.progressPct([task('2026-01-01', '2026-01-02', 'Completed')]), 100);
  assert.equal(PM.progressPct([]), 0);
});

test('expected-by-now follows each task\'s own window, weighted', () => {
  const tasks = [task('2026-10-01', '2026-10-02'), task('2026-10-03', '2026-10-20')];
  const now = Date.parse('2026-10-05T12:00:00Z');
  const f = PM.expectedFraction(tasks, null, now);
  // The 2-day task is fully due (2/20); the 18-day one about 2.5/18 of the way.
  assert.ok(f > 0.2 && f < 0.25, `got ${f}`);
  assert.equal(PM.expectedFraction([task(null, null)], null, now), null);
  assert.equal(PM.expectedFraction(tasks, null, Date.parse('2026-12-01T00:00:00Z')), 1);
});
