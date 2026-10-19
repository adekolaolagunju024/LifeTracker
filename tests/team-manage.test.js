const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Managing a team (backend/challenges.js renameTeam, renameMember,
// removeMember, letBackIn): the person who set it up renames the team
// and anyone in it, and takes people off; removed people can't rejoin
// with the code until let back in.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `mg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

test('the leader renames the team and people, and removes someone, who cannot rejoin until let back in', async () => {
  const ada = await signUp(), liam = await signUp(), sofia = await signUp();
  const goal = await json(ada, 'POST', '/api/projects', { title: 'Launch', isGoal: true });
  const step = (await json(ada, 'POST', '/api/tasks', { projectId: goal.id, title: 'Pilot customers', status: 'Not Started', priority: 'Medium' })).id;
  const team = await json(ada, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(30), mode: 'split', leaderRole: 'manager', displayName: 'Ada' });
  for (const [who, name] of [[liam, 'Liam'], [sofia, 'Sofia']]) await call(who, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: name });
  let board = await json(ada, 'GET', `/api/challenges/${team.id}`);
  const color = name => board.players.find(p => p.name === name).color;

  // only the leader renames the team or other people
  assert.equal((await call(liam, 'PUT', `/api/challenges/${team.id}/title`, { title: 'Mine now' })).status, 403);
  assert.equal((await call(liam, 'PUT', `/api/challenges/${team.id}/members/name`, { color: color('Sofia'), name: 'Nope' })).status, 403);
  assert.deepEqual(await json(ada, 'PUT', `/api/challenges/${team.id}/title`, { title: '  Launch team  ' }), { title: 'Launch team' });
  assert.equal((await call(ada, 'PUT', `/api/challenges/${team.id}/title`, { title: '   ' })).status, 400);
  assert.deepEqual(await json(ada, 'PUT', `/api/challenges/${team.id}/members/name`, { color: color('Sofia'), name: 'Sofia Reyes' }), { name: 'Sofia Reyes' });
  // anyone renames themselves
  assert.deepEqual(await json(liam, 'PUT', `/api/challenges/${team.id}/members/name`, { name: 'Liam B' }), { name: 'Liam B' });
  board = await json(ada, 'GET', `/api/challenges/${team.id}`);
  assert.equal(board.title, 'Launch team');
  assert.deepEqual(board.players.map(p => p.name).sort(), ['Ada', 'Liam B', 'Sofia Reyes']);

  // Liam has a step; removing him frees it and stops sharing the goal
  await call(ada, 'POST', `/api/challenges/${team.id}/assign`, { taskId: step, color: color('Liam B') });
  assert.equal((await call(liam, 'POST', `/api/challenges/${team.id}/members/remove`, { color: color('Sofia Reyes') })).status, 403);
  assert.equal((await call(ada, 'POST', `/api/challenges/${team.id}/members/remove`, { color: color('Ada') })).status, 400);
  assert.deepEqual(await json(ada, 'POST', `/api/challenges/${team.id}/members/remove`, { color: color('Liam B') }), { removed: true, freed: 1 });
  board = await json(ada, 'GET', `/api/challenges/${team.id}`);
  assert.equal(board.players.some(p => p.name === 'Liam B'), false);
  assert.equal(board.split.steps.find(s => s.taskId === step).who, null);
  assert.equal((await call(liam, 'GET', `/api/challenges/${team.id}`)).status, 404);
  assert.equal((await json(liam, 'GET', '/api/projects')).some(p => p.id === goal.id), false);

  // he can't rejoin with the link until let back in
  assert.equal((await call(liam, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Liam' })).status, 403);
  const removed = await json(ada, 'GET', `/api/challenges/${team.id}/removed`);
  assert.deepEqual(removed.map(r => r.name), ['Liam B']);
  assert.equal((await call(liam, 'GET', `/api/challenges/${team.id}/removed`)).status, 404);
  assert.equal((await call(ada, 'POST', `/api/challenges/${team.id}/removed/${removed[0].ref}/back`)).status, 200);
  assert.equal((await call(liam, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Liam' })).status, 201);
});
