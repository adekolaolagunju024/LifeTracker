const { test } = require('node:test');
const assert = require('node:assert/strict');
const DayPace = require('../frontend/js/dayPace');

const plan = [
  { taskId: 'a', start: '09:00', minutes: 30 },
  { taskId: 'b', start: '09:30', minutes: 60 },
  { taskId: 'c', start: '10:30', minutes: 30 },
];
const at = t => DayPace.toMin(t);
const run = (done, now, last) => DayPace.compute(plan, new Set(done), at(now), last == null ? null : at(last));

test('before the first task starts, it says when', () => {
  const r = run([], '08:40');
  assert.equal(r.state, 'before');
  assert.equal(r.text, 'Starts at 09:00');
  assert.equal(r.ghost, 0);
});

test('on the task the plan expects, you are level with the ghost', () => {
  const r = run([], '09:10');
  assert.equal(r.state, 'on');
  assert.equal(r.text, 'Level with the ghost');
  assert.ok(Math.abs(r.ghost - 1 / 3) < 0.01, 'the ghost is a third of the way through the first task');
});

test('finishing early puts you ahead by the gap to the next start', () => {
  const r = run(['a'], '09:10');
  assert.equal(r.state, 'ahead');
  assert.equal(r.diff, 20);
  assert.equal(r.text, '20 min ahead of the ghost');
});

test('running over puts the ghost ahead by the overrun', () => {
  const r = run([], '09:50');
  assert.equal(r.state, 'behind');
  assert.equal(r.diff, 20);
  assert.equal(r.text, 'The ghost is 20 min ahead');
  const later = run(['a'], '11:00');
  assert.equal(later.state, 'behind');
  assert.equal(later.text, 'The ghost is 30 min ahead');
});

test('a few minutes either way still counts as level', () => {
  assert.equal(run([], '09:33').state, 'on');
  assert.equal(run(['a'], '09:27').state, 'on');
});

test('the order you finish in does not matter, only how many', () => {
  assert.equal(run(['c'], '09:10').state, 'ahead');
});

test('a finished plan says by how much you beat it', () => {
  assert.equal(run(['a', 'b', 'c'], '11:30', '10:15').text, 'Plan done, 45 min ahead of the ghost');
  assert.equal(run(['a', 'b', 'c'], '11:30', '10:58').text, "Today's plan is done");
});

test('lengths over an hour read naturally, and an empty plan is quiet', () => {
  assert.equal(DayPace.minutesText(75), '1 h 15');
  assert.equal(DayPace.minutesText(120), '2 h');
  assert.equal(DayPace.compute([], new Set(), 600).state, 'none');
});
