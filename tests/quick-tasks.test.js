const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');
const quickTask = require('../backend/quickTask');

// Quick tasks (backend/quickTask.js): things that come up in the day and
// aren't a goal go in an Everyday list, pinned in the day's plan at their time.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `qt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test('the words give the title, the day and the time', () => {
  const today = '2026-10-22'; // a Thursday
  const p = s => quickTask.parse(s, { today });
  assert.deepEqual(p('Meet Tom at the train station by 11am'), { title: 'Meet Tom at the train station', date: today, time: '11:00', dayPart: 'morning', fixed: true });
  assert.deepEqual(p('meet tom 11:30 tomorrow'), { title: 'Meet tom', date: '2026-10-23', time: '11:30', dayPart: 'morning', fixed: true });
  assert.deepEqual(p('Pick up parcel on Friday at 3pm'), { title: 'Pick up parcel', date: '2026-10-23', time: '15:00', dayPart: 'afternoon', fixed: true });
  assert.deepEqual(p('dentist monday 9.15am'), { title: 'Dentist', date: '2026-10-26', time: '09:15', dayPart: 'morning', fixed: true });
  assert.deepEqual(p('Call mum tonight'), { title: 'Call mum', date: today, time: null, dayPart: 'evening', fixed: false });
  assert.deepEqual(p('Buy a birthday card'), { title: 'Buy a birthday card', date: today, time: null, dayPart: null, fixed: false });
  assert.equal(p('lunch with Sam at noon').time, '12:00');
  assert.equal(p('gym 18:00').dayPart, 'evening');
  assert.equal(p('Thursday 7pm dinner').date, today, 'today counts as the coming Thursday');
  // 11:00 in London summer time (UTC+1, offset -60), 30 minutes before
  assert.equal(quickTask.reminderAt('2026-10-22', '11:00', 30, -60), '2026-10-22T09:30:00.000Z');
});

test('a quick task goes in the Everyday list, pinned in the plan, and the list is not a goal', async () => {
  const me = await signUp();
  const later = new Date(Date.now() + 2 * 86400000); // a day ahead, so the times are never in the past
  const date = keyOf(later);
  const preview = await json(me, 'POST', '/api/tasks/quick/parse', { text: 'Meet Tom at the station 11am', today: date });
  assert.deepEqual(preview, { title: 'Meet Tom at the station', date, time: '11:00', dayPart: 'morning', fixed: true });

  const made = await json(me, 'POST', '/api/tasks/quick', { text: 'Meet Tom at the station 11am', today: date, tzOffset: later.getTimezoneOffset(), remindBefore: 30, minutes: 45 });
  assert.equal(made.task.title, 'Meet Tom at the station');
  assert.equal(made.task.dayPart, 'morning');
  assert.equal(made.task.endDate.slice(0, 10), date);
  assert.equal(made.planned, true);
  assert.ok(made.reminderAt, 'a reminder 30 minutes before');

  const projects = await json(me, 'GET', '/api/projects');
  const list = projects.find(p => p.id === made.task.projectId);
  assert.equal(list.kind, 'everyday');
  assert.equal(list.isGoal, 0);
  const plan = await json(me, 'GET', `/api/day/plan/${date}`);
  assert.deepEqual(plan.items, [{ taskId: made.task.id, start: '11:00', minutes: 45, fixed: true }]);

  // a second one reuses the same list; one with no time isn't timetabled
  const card = await json(me, 'POST', '/api/tasks/quick', { text: 'Buy a birthday card', today: date });
  assert.equal(card.task.projectId, list.id);
  assert.equal(card.planned, false);
  assert.equal((await json(me, 'GET', '/api/projects')).filter(p => p.kind === 'everyday').length, 1);

  // the sheet's own time wins over the words
  const moved = await json(me, 'POST', '/api/tasks/quick', { text: 'Pick up parcel 3pm', today: date, time: '16:30' });
  assert.equal(moved.time, '16:30');
  assert.equal(moved.dayPart, 'afternoon');

  // empty words are refused; the Everyday list can't be teamed up on
  assert.equal((await call(me, 'POST', '/api/tasks/quick', { text: '  11am  ', today: date })).status, 400);
  const team = await call(me, 'POST', '/api/challenges', { projectId: list.id, endsAt: new Date(Date.now() + 7 * 86400000).toISOString(), mode: 'split' });
  assert.equal(team.status, 400);

  // and it can grow into a goal step
  const goal = await json(me, 'POST', '/api/projects', { title: 'Move house', isGoal: true });
  assert.equal((await call(me, 'PUT', `/api/tasks/${card.task.id}`, { projectId: goal.id })).status, 200);
});
