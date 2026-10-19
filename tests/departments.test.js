const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Split the work by department (backend/challenges.js setSections,
// setDept): each person belongs to one, the board shows progress per
// department, and @Department in the chat reaches everyone in it.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `dept_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

test('departments: who is in which, progress per department, and @Department in the chat', async () => {
  const ceo = await signUp(), priya = await signUp(), liam = await signUp(), sofia = await signUp();
  const goal = await json(ceo, 'POST', '/api/projects', { title: 'Launch', isGoal: true });
  const design = await json(ceo, 'POST', '/api/projects', { title: '2. Design', parentId: goal.id });
  const eng = await json(ceo, 'POST', '/api/projects', { title: '3. Engineering', parentId: goal.id });
  const add = async (projectId, title) => (await json(ceo, 'POST', '/api/tasks', { projectId, title, status: 'Not Started', priority: 'Medium' })).id;
  const api = await add(eng.id, 'Team billing API');
  await add(eng.id, 'Seat emails');
  const kit = await add(design.id, 'Brand kit');

  const team = await json(ceo, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(30), mode: 'split', leaderRole: 'manager', displayName: 'Ada' });
  for (const [who, name] of [[priya, 'Priya'], [liam, 'Liam'], [sofia, 'Sofia']]) await call(who, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: name });
  let board = await json(ceo, 'GET', `/api/challenges/${team.id}`);
  const color = name => board.players.find(p => p.name === name).color;
  assert.equal(board.split.word, 'phases');

  // only the leader switches to departments or moves people
  assert.equal((await call(priya, 'POST', `/api/challenges/${team.id}/sections`, { word: 'departments' })).status, 403);
  assert.deepEqual(await json(ceo, 'POST', `/api/challenges/${team.id}/sections`, { word: 'departments' }), { word: 'departments' });
  assert.equal((await call(priya, 'POST', `/api/challenges/${team.id}/dept`, { color: color('Liam'), projectId: eng.id })).status, 403);

  // Priya leads Engineering, Liam has an Engineering step, Sofia is put in Design
  await call(ceo, 'POST', `/api/challenges/${team.id}/leads`, { projectId: eng.id, color: color('Priya') });
  await call(ceo, 'POST', `/api/challenges/${team.id}/assign`, { taskId: api, color: color('Liam') });
  assert.equal((await call(ceo, 'POST', `/api/challenges/${team.id}/dept`, { color: color('Sofia'), projectId: design.id })).status, 200);
  assert.equal((await call(ceo, 'POST', `/api/challenges/${team.id}/dept`, { color: color('Sofia'), projectId: goal.id })).status, 404);
  await call(ceo, 'PUT', `/api/tasks/${kit}`, { status: 'Completed' });

  board = await json(ceo, 'GET', `/api/challenges/${team.id}`);
  assert.equal(board.split.word, 'departments');
  const byName = Object.fromEntries(board.split.phases.map(p => [p.name, p]));
  assert.deepEqual(Object.keys(byName).sort(), ['Design', 'Engineering']);
  assert.deepEqual(byName.Engineering.people.map(p => p.name).sort(), ['Liam', 'Priya']);
  assert.deepEqual(byName.Design.people.map(p => p.name), ['Sofia']);
  assert.deepEqual([byName.Engineering.done, byName.Engineering.total, byName.Design.done, byName.Design.total], [0, 2, 1, 1]);
  assert.equal(board.split.contrib.find(m => m.name === 'Sofia').dept, design.id);

  // @Engineering reaches Priya and Liam, not Sofia
  assert.equal((await call(ceo, 'POST', `/api/challenges/${team.id}/messages`, { text: '@Engineering billing goes live Friday' })).status, 201);
  const mentioned = async who => ((await json(who, 'GET', '/api/notifications')).teamActivity || []).some(a => a.kind === 'mention');
  assert.equal(await mentioned(priya), true);
  assert.equal(await mentioned(liam), true);
  assert.equal(await mentioned(sofia), false);

  // back to automatic: Sofia has no steps and leads nothing, so she's in none
  await call(ceo, 'POST', `/api/challenges/${team.id}/dept`, { color: color('Sofia'), projectId: '' });
  board = await json(ceo, 'GET', `/api/challenges/${team.id}`);
  assert.equal(board.split.contrib.find(m => m.name === 'Sofia').dept, null);
});
