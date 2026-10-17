const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Ending a team (backend/challenges.js endTeam): only the person who set
// it up can, it goes for everyone, and the goal and its tasks stay theirs.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `end_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

test('the organiser ends a shared team: access goes, the goal and its tasks stay', async () => {
  const lead = await signUp();
  const ana = await signUp();
  const goal = await json(lead, 'POST', '/api/projects', { title: 'Summer fair', isGoal: true });
  const ids = [];
  for (const t of ['Book the field', 'Find stalls']) ids.push((await json(lead, 'POST', '/api/tasks', { projectId: goal.id, title: t, status: 'Not Started', priority: 'Medium' })).id);
  const team = await json(lead, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(20), mode: 'split', displayName: 'Ada' });
  await call(ana, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ana' });
  await call(ana, 'POST', `/api/challenges/${team.id}/claim`, { taskId: ids[0] });
  await call(ana, 'POST', `/api/challenges/${team.id}/messages`, { text: 'On it' });
  assert.ok((await json(ana, 'GET', '/api/projects')).some(p => p.id === goal.id));

  assert.equal((await call(ana, 'DELETE', `/api/challenges/${team.id}`)).status, 403, 'a teammate cannot end it');
  const r = await json(lead, 'DELETE', `/api/challenges/${team.id}`);
  assert.deepEqual(r, { ended: true, people: 1 });

  assert.equal((await call(lead, 'GET', `/api/challenges/${team.id}`)).status, 404);
  assert.deepEqual(await json(lead, 'GET', '/api/challenges'), []);
  assert.deepEqual(await json(ana, 'GET', '/api/challenges'), []);
  assert.ok(!(await json(ana, 'GET', '/api/projects')).some(p => p.id === goal.id), 'Ana no longer sees the goal');
  const tasks = (await json(lead, 'GET', '/api/tasks')).filter(t => t.projectId === goal.id);
  assert.equal(tasks.length, 2, 'every task is still there');
  assert.ok(tasks.every(t => !t.assigneeId), 'her step went back to unassigned');
  // the goal can be teamed up again
  assert.equal((await call(lead, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(20), mode: 'split', displayName: 'Ada' })).status, 201);
});

test('ending a race leaves everyone their own copy', async () => {
  const me = await signUp();
  const ben = await signUp();
  const goal = await json(me, 'POST', '/api/projects', { title: 'Run a 5K', isGoal: true });
  await call(me, 'POST', '/api/tasks', { projectId: goal.id, title: 'Run 3K', status: 'Not Started', priority: 'Medium' });
  const race = await json(me, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(10), mode: 'race', displayName: 'Ada' });
  await call(ben, 'POST', `/api/challenges/join/${race.joinToken}`, { displayName: 'Ben' });
  assert.equal((await call(me, 'DELETE', `/api/challenges/${race.id}`)).status, 200);
  assert.ok((await json(ben, 'GET', '/api/projects')).some(p => p.title.startsWith('Run a 5K')), 'Ben keeps his copy');
  assert.ok((await json(me, 'GET', '/api/projects')).some(p => p.id === goal.id));
});
