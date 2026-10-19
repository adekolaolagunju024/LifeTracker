const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Handing a team over (backend/challenges.js handOver): the new organiser
// gets every control; in Split the work the goal moves to them and the old
// organiser stays on as a teammate (working on their own steps) unless they leave.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `ho_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

async function splitTeam() {
  const ada = await signUp(), priya = await signUp(), liam = await signUp();
  const goal = await json(ada, 'POST', '/api/projects', { title: 'Launch', isGoal: true });
  const eng = await json(ada, 'POST', '/api/projects', { title: 'Engineering', parentId: goal.id });
  const step = (await json(ada, 'POST', '/api/tasks', { projectId: eng.id, title: 'Team billing', status: 'Not Started', priority: 'Medium' })).id;
  const team = await json(ada, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(30), mode: 'split', leaderRole: 'manager', displayName: 'Ada' });
  for (const [who, name] of [[priya, 'Priya'], [liam, 'Liam']]) await call(who, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: name });
  const board = await json(ada, 'GET', `/api/challenges/${team.id}`);
  const color = name => board.players.find(p => p.name === name).color;
  return { ada, priya, liam, goal, eng, step, team, color };
}

test('a split team handed over: Priya runs it and owns the goal, Ada stays on as a teammate', async () => {
  const { ada, priya, liam, goal, step, team, color } = await splitTeam();
  assert.equal((await call(liam, 'POST', `/api/challenges/${team.id}/hand-over`, { color: color('Liam') })).status, 403);
  assert.equal((await call(ada, 'POST', `/api/challenges/${team.id}/hand-over`, { color: color('Ada') })).status, 400);
  assert.deepEqual(await json(ada, 'POST', `/api/challenges/${team.id}/hand-over`, { color: color('Priya') }), { handedOver: true, stayed: true });

  // Priya has every control now, Ada none
  assert.equal((await json(priya, 'GET', `/api/challenges/${team.id}`)).owner, true);
  assert.equal((await call(priya, 'PUT', `/api/challenges/${team.id}/title`, { title: 'Launch team' })).status, 200);
  assert.equal((await call(ada, 'PUT', `/api/challenges/${team.id}/title`, { title: 'Mine' })).status, 403);
  assert.equal((await call(ada, 'POST', `/api/challenges/${team.id}/members/remove`, { color: color('Liam') })).status, 403);
  // the goal is Priya's; Ada is still on the team and can edit it
  const adaBoard = await json(ada, 'GET', `/api/challenges/${team.id}`);
  assert.equal(adaBoard.owner, false);
  assert.ok(adaBoard.players.some(p => p.you));
  // like any teammate she works on her own steps: not until it's hers
  assert.equal((await call(ada, 'PUT', `/api/tasks/${step}`, { title: 'Team billing v2' })).status, 404);
  assert.equal((await call(priya, 'POST', `/api/challenges/${team.id}/assign`, { taskId: step, color: color('Ada') })).status, 200);
  assert.equal((await call(ada, 'PUT', `/api/tasks/${step}`, { title: 'Team billing v2' })).status, 200);
  // and Priya can now end it, as its owner
  assert.equal((await call(ada, 'DELETE', `/api/challenges/${team.id}`)).status, 403);
  assert.equal((await call(priya, 'DELETE', `/api/challenges/${team.id}`)).status, 200);
  assert.ok((await json(priya, 'GET', '/api/projects')).some(p => p.id === goal.id), 'the goal stays with Priya');
});

test('handing over and leaving takes the old organiser off, goal and all', async () => {
  const { ada, priya, goal, team, color } = await splitTeam();
  assert.deepEqual(await json(ada, 'POST', `/api/challenges/${team.id}/hand-over`, { color: color('Priya'), leave: true }), { handedOver: true, stayed: false });
  assert.equal((await call(ada, 'GET', `/api/challenges/${team.id}`)).status, 404);
  assert.equal((await json(ada, 'GET', '/api/projects')).some(p => p.id === goal.id), false);
  assert.equal((await json(priya, 'GET', `/api/challenges/${team.id}`)).owner, true);
});

test('a race handed over moves only the organiser role', async () => {
  const ada = await signUp(), sam = await signUp();
  const goal = await json(ada, 'POST', '/api/projects', { title: '5k', isGoal: true });
  await json(ada, 'POST', '/api/tasks', { projectId: goal.id, title: 'Run 2k', status: 'Not Started', priority: 'Medium' });
  const race = await json(ada, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(14), displayName: 'Ada' });
  await call(sam, 'POST', `/api/challenges/join/${race.joinToken}`, { displayName: 'Sam' });
  const board = await json(ada, 'GET', `/api/challenges/${race.id}`);
  await json(ada, 'POST', `/api/challenges/${race.id}/hand-over`, { color: board.players.find(p => p.name === 'Sam').color });
  assert.equal((await json(sam, 'GET', `/api/challenges/${race.id}`)).owner, true);
  assert.equal((await json(ada, 'GET', `/api/challenges/${race.id}`)).owner, false);
  assert.ok((await json(ada, 'GET', '/api/projects')).some(p => p.id === goal.id), 'Ada keeps her own goal');
});
