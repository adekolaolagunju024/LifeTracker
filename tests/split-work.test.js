const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Split the work (backend/challenges.js): one shared goal, each step
// belongs to someone, and each person's share adds up to the finish.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `split_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

test('split the work: teammates join the goal itself, steps are assigned, claimed or shared out, and progress is per person', async () => {
  const lead = await signUp();
  const ana = await signUp();
  const ben = await signUp();
  const goal = await json(lead, 'POST', '/api/projects', { title: 'Kitchen refit', isGoal: true });
  const ids = [];
  for (const t of ['Measure up', 'Order units', 'Fit units', 'Tile splashback']) ids.push((await json(lead, 'POST', '/api/tasks', { projectId: goal.id, title: t, status: 'Not Started', priority: 'Medium' })).id);
  // Fitting waits on ordering.
  await call(lead, 'PUT', `/api/tasks/${ids[2]}/predecessors`, { predecessorIds: [ids[1]] });

  const team = await json(lead, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(21), mode: 'split', leaderRole: 'manager', displayName: 'Sam' });
  assert.equal(team.mode, 'split');
  assert.equal(team.checks, 'none');
  assert.equal(team.split.total, 4);
  assert.equal(team.split.unclaimed, 4);
  // The timeline's handover arrows: fitting waits on ordering.
  assert.deepEqual(team.split.links, [{ from: ids[1], to: ids[2] }]);

  // Joining gives no copy: the goal itself, shared with them.
  const joined = await json(ana, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ana' });
  assert.equal(joined.projectId, goal.id);
  await call(ben, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ben' });
  const anaProjects = await json(ana, 'GET', '/api/projects');
  assert.ok(anaProjects.some(p => p.id === goal.id), 'the shared goal is in their projects');
  assert.equal(anaProjects.filter(p => p.title.startsWith('Kitchen refit')).length, 1, 'and no copy');

  // Ana claims one; Ben can't take it off her; only the leader assigns.
  assert.equal((await call(ana, 'POST', `/api/challenges/${team.id}/claim`, { taskId: ids[0] })).status, 200);
  assert.equal((await call(ben, 'POST', `/api/challenges/${team.id}/claim`, { taskId: ids[0] })).status, 409);
  let board = await json(lead, 'GET', `/api/challenges/${team.id}`);
  const color = name => board.players.find(p => p.name === name).color;
  assert.equal((await call(ben, 'POST', `/api/challenges/${team.id}/assign`, { taskId: ids[1], color: color('Ben') })).status, 403);
  assert.equal((await call(lead, 'POST', `/api/challenges/${team.id}/assign`, { taskId: ids[1], color: color('Ana') })).status, 200);

  // Share out the rest: Ben gets both (he has none), the leader none.
  assert.equal((await json(lead, 'POST', `/api/challenges/${team.id}/split-evenly`)).assigned, 2);
  board = await json(lead, 'GET', `/api/challenges/${team.id}`);
  assert.equal(board.split.unclaimed, 0);
  const owner = Object.fromEntries(board.split.steps.map(s => [s.title, s.who && s.who.name]));
  assert.deepEqual(owner, { 'Measure up': 'Ana', 'Order units': 'Ana', 'Fit units': 'Ben', 'Tile splashback': 'Ben' });
  assert.equal(board.players.find(p => p.name === 'Ana').total, 2);
  assert.equal(board.players.find(p => p.name === 'Sam').pace, 'no steps yet');

  // Ana finishes ordering: Ben hears it's his turn for fitting.
  await call(ana, 'PUT', `/api/tasks/${ids[0]}`, { status: 'Completed' });
  await call(ana, 'PUT', `/api/tasks/${ids[1]}`, { status: 'Completed' });
  const chat = await json(ben, 'GET', `/api/challenges/${team.id}/messages`);
  assert.ok(chat.some(m => m.toYou && /Your turn, Ben: “Order units” is done, so “Fit units” can start/.test(m.text)), JSON.stringify(chat.map(m => m.text)));
  board = await json(ana, 'GET', `/api/challenges/${team.id}`);
  const me = board.players.find(p => p.you);
  assert.equal(me.finished, true);
  assert.equal(board.group.stepsPct, 50);
  assert.equal(board.group.goalDone, false);

  // Ben leaves: his open steps are unclaimed again and the goal is no longer shared with him.
  await call(ben, 'POST', `/api/challenges/${team.id}/leave`);
  board = await json(lead, 'GET', `/api/challenges/${team.id}`);
  assert.equal(board.split.unclaimed, 2);
  assert.ok(!(await json(ben, 'GET', '/api/projects')).some(p => p.id === goal.id));
  // The leader can't leave their own goal.
  assert.equal((await call(lead, 'POST', `/api/challenges/${team.id}/leave`)).status, 400);
});
