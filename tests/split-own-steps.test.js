const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Split the work: a teammate sees and works on their own steps only, and
// sees the whole plan (who has what) on the team board.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `own_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

test('a teammate sees only their own steps, works only on those, and still sees the whole plan', async () => {
  const lead = await signUp();
  const ana = await signUp();
  const ben = await signUp();
  const goal = await json(lead, 'POST', '/api/projects', { title: 'Garden makeover', isGoal: true });
  const ids = [];
  for (const t of ['Clear the beds', 'Buy plants', 'Plant them', 'Lay the path']) ids.push((await json(lead, 'POST', '/api/tasks', { projectId: goal.id, title: t, status: 'Not Started', priority: 'Medium' })).id);
  const team = await json(lead, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(21), mode: 'split', leaderRole: 'manager', displayName: 'Sam' });
  await call(ana, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ana' });
  await call(ben, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ben' });
  await call(ana, 'POST', `/api/challenges/${team.id}/claim`, { taskId: ids[0] });
  await call(ben, 'POST', `/api/challenges/${team.id}/claim`, { taskId: ids[1] });

  // Ana's lists hold her step only: not Ben's, not the unclaimed ones.
  const anaTasks = (await json(ana, 'GET', '/api/tasks')).filter(t => ids.includes(t.id));
  assert.deepEqual(anaTasks.map(t => t.title), ['Clear the beds']);
  assert.deepEqual((await json(ana, 'GET', `/api/tasks?projectId=${goal.id}`)).map(t => t.title), ['Clear the beds']);
  // The goal page knows it's a teammate's view (for the My steps / Whole plan switch).
  assert.equal((await json(ana, 'GET', `/api/projects/${goal.id}`)).splitTeamId, team.id);
  assert.equal((await json(lead, 'GET', `/api/projects/${goal.id}`)).splitTeamId, null);

  // She can't open, tick off, edit or remove anyone else's step, or an unclaimed one.
  assert.equal((await call(ana, 'GET', `/api/tasks/${ids[1]}`)).status, 404);
  assert.equal((await call(ana, 'PUT', `/api/tasks/${ids[1]}`, { status: 'Completed' })).status, 404);
  assert.equal((await call(ana, 'PUT', `/api/tasks/${ids[2]}`, { status: 'Completed' })).status, 404);
  assert.equal((await call(ana, 'POST', `/api/tasks/${ids[1]}/obstacles`, { name: 'Rain' })).status, 404);
  await call(ana, 'DELETE', `/api/tasks/${ids[1]}`);
  assert.equal((await json(lead, 'GET', `/api/tasks/${ids[1]}`)).id, ids[1], 'still there');

  // Her own step she works on; she can't hand it to someone else or delete it.
  assert.equal((await call(ana, 'PUT', `/api/tasks/${ids[0]}`, { status: 'In Progress' })).status, 200);
  assert.equal((await call(ana, 'PUT', `/api/tasks/${ids[0]}`, { assigneeId: null })).status, 400);
  assert.equal((await call(ana, 'DELETE', `/api/tasks/${ids[0]}`)).status, 400);

  // A step she adds is hers.
  const added = await json(ana, 'POST', '/api/tasks', { projectId: goal.id, title: 'Water the beds', status: 'Not Started', priority: 'Medium' });
  assert.ok(added.assigneeId, 'assigned');
  assert.ok((await json(ana, 'GET', `/api/tasks?projectId=${goal.id}`)).some(t => t.title === 'Water the beds'));

  // The whole plan is still hers to see: every step and who has it.
  const board = await json(ana, 'GET', `/api/challenges/${team.id}`);
  const who = Object.fromEntries(board.split.steps.map(s => [s.title, s.who ? s.who.name : null]));
  assert.equal(who['Clear the beds'], 'You');
  assert.equal(who['Buy plants'], 'Ben');
  assert.equal(who['Plant them'], null);

  // Taking an unclaimed step brings it into her list, ready to work on.
  await call(ana, 'POST', `/api/challenges/${team.id}/claim`, { taskId: ids[2] });
  assert.ok((await json(ana, 'GET', '/api/tasks')).some(t => t.id === ids[2]));
  assert.equal((await call(ana, 'PUT', `/api/tasks/${ids[2]}`, { status: 'Completed' })).status, 200);

  // The leader still sees and runs the whole goal.
  assert.equal((await json(lead, 'GET', `/api/tasks?projectId=${goal.id}`)).length, 5);
  assert.equal((await call(lead, 'PUT', `/api/tasks/${ids[1]}`, { priority: 'High' })).status, 200);
});
