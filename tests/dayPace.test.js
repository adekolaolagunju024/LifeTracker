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
  assert.equal(r.pacer, 0);
});

test('on the task the plan expects, you are on plan', () => {
  const r = run([], '09:10');
  assert.equal(r.state, 'on');
  assert.equal(r.text, 'On plan');
  assert.ok(Math.abs(r.pacer - 1 / 3) < 0.01, 'the Pacer is a third of the way through the first task');
});

test('finishing early puts you ahead by the gap to the next start', () => {
  const r = run(['a'], '09:10');
  assert.equal(r.state, 'ahead');
  assert.equal(r.diff, 20);
  assert.equal(r.text, '20 min ahead of plan');
});

test('running over puts you behind plan by the overrun', () => {
  const r = run([], '09:50');
  assert.equal(r.state, 'behind');
  assert.equal(r.diff, 20);
  assert.equal(r.text, '20 min behind plan');
  const later = run(['a'], '11:00');
  assert.equal(later.state, 'behind');
  assert.equal(later.text, '30 min behind plan');
});

test('a few minutes either way still counts as level', () => {
  assert.equal(run([], '09:33').state, 'on');
  assert.equal(run(['a'], '09:27').state, 'on');
});

test('the order you finish in does not matter, only how many', () => {
  assert.equal(run(['c'], '09:10').state, 'ahead');
});

test('a finished plan says by how much you beat it', () => {
  assert.equal(run(['a', 'b', 'c'], '11:30', '10:15').text, 'Plan done 45 min early');
  assert.equal(run(['a', 'b', 'c'], '11:30', '10:58').text, "Today's plan is done");
});

test('lengths over an hour read naturally, and an empty plan is quiet', () => {
  assert.equal(DayPace.minutesText(75), '1 h 15');
  assert.equal(DayPace.minutesText(120), '2 h');
  assert.equal(DayPace.compute([], new Set(), 600).state, 'none');
});

test('the evening lines: the Pacer climbs over each slot, you step up at each finish', () => {
  const L = DayPace.lines(plan, { a: at('09:20'), b: at('10:40') }, at('12:00'));
  assert.equal(L.from, at('09:00'));
  assert.equal(L.done, 2);
  assert.deepEqual(L.pacer.slice(0, 3), [[at('09:00'), 0], [at('09:00'), 0], [at('09:30'), 1]]);
  assert.equal(DayPace.valueAt(L.pacer, at('10:00')), 1.5, 'halfway through the second slot');
  assert.equal(DayPace.valueAt(L.you, at('10:00')), 1, 'one task done by then');
  assert.equal(DayPace.valueAt(L.you, at('10:41')), 2);
  assert.deepEqual(L.tasks.map(t => t.diff), [10, -10, null], 'a: 10 min early, b: 10 min late, c: not done');
  assert.equal(L.to, at('12:00'), 'the window runs on to now, an hour after the plan ended');
});

test('a task finished before the day began counts from the start', () => {
  const L = DayPace.lines(plan, { a: at('07:00') }, at('09:05'));
  assert.equal(L.tasks[0].finished, at('09:00'));
  assert.equal(DayPace.valueAt(L.you, at('09:01')), 1);
});
