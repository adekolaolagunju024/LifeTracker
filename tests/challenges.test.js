const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const uniqueEmail = () => `race_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

async function goalWithTasks(cookie, titles) {
  const p = await (await call(cookie, 'POST', '/api/projects', { title: 'Run 5k', isGoal: true })).json();
  for (const title of titles) await call(cookie, 'POST', '/api/tasks', { projectId: p.id, title, status: 'Not Started', priority: 'Medium' });
  return p;
}
const tasksOf = async (cookie, projectId) => (await (await call(cookie, 'GET', '/api/tasks')).json()).filter(t => t.projectId === projectId);
const finish = async (cookie, projectId) => { for (const t of await tasksOf(cookie, projectId)) await call(cookie, 'PUT', `/api/tasks/${t.id}`, { status: 'Completed' }); };

test('a race: make it, share the link, everyone gets their own copy, first to finish wins', async () => {
  const ana = await signUp();
  const ben = await signUp();
  const goal = await goalWithTasks(ana, ['Walk-run 20 min', 'Run 2k', 'Run 5k']);

  // Needs a sensible deadline, and the goal must have tasks.
  assert.equal((await call(ana, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(0.1) })).status, 400);
  const empty = await (await call(ana, 'POST', '/api/projects', { title: 'Empty' })).json();
  assert.equal((await call(ana, 'POST', '/api/challenges', { projectId: empty.id, endsAt: inDays(14) })).status, 400);

  const made = await call(ana, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(14), stake: 'Loser buys dinner', displayName: 'Ana' });
  assert.equal(made.status, 201);
  const race = await made.json();
  assert.equal(race.players.length, 1);
  assert.ok(race.joinToken);
  const anaCopy = race.players[0].projectId;
  assert.notEqual(anaCopy, goal.id, 'the maker races on a fresh copy too');
  assert.equal((await tasksOf(ana, anaCopy)).length, 3);
  assert.ok((await tasksOf(ana, anaCopy)).every(t => t.status === 'Not Started' && t.endDate));

  // The link's preview works signed out and shows no one's progress.
  const preview = await (await call(null, 'GET', `/api/race-preview/${race.joinToken}`)).json();
  assert.equal(preview.title, 'Run 5k');
  assert.equal(preview.stake, 'Loser buys dinner');
  assert.equal(preview.players, 1);
  assert.equal(preview.players.length, undefined);
  assert.equal((await call(null, 'GET', '/api/race-preview/nope')).status, 404);

  // Someone else can't read the race until they join.
  assert.equal((await call(ben, 'GET', `/api/challenges/${race.id}`)).status, 404);
  const joined = await call(ben, 'POST', `/api/challenges/join/${race.joinToken}`, { displayName: 'Ben' });
  assert.equal(joined.status, 201);
  const benCopy = (await joined.json()).projectId;
  assert.equal((await tasksOf(ben, benCopy)).length, 3);
  // Joining twice just returns the same copy.
  assert.equal((await (await call(ben, 'POST', `/api/challenges/join/${race.joinToken}`, {})).json()).projectId, benCopy);

  // Deleting tasks from your copy never gets you there sooner.
  const benTasks = await tasksOf(ben, benCopy);
  await call(ben, 'DELETE', `/api/tasks/${benTasks[2].id}`);
  await call(ben, 'PUT', `/api/tasks/${benTasks[0].id}`, { status: 'Completed' });
  await call(ben, 'PUT', `/api/tasks/${benTasks[1].id}`, { status: 'Completed' });
  let board = await (await call(ana, 'GET', `/api/challenges/${race.id}`)).json();
  const benRow = board.players.find(p => p.name === 'Ben');
  assert.equal(benRow.done, 2);
  assert.equal(benRow.finished, false, 'two of the three is not finished');
  assert.equal(board.winner, null);
  assert.equal(benRow.projectId, undefined, "another player's copy stays private");

  // Ana finishes all three: she wins, and is first on the board.
  await finish(ana, anaCopy);
  board = await (await call(ben, 'GET', `/api/challenges/${race.id}`)).json();
  assert.equal(board.winner.name, 'Ana');
  assert.equal(board.players[0].name, 'Ana');
  assert.equal(board.players[0].pace, 'finished');
  assert.ok(board.players.every(p => p.color));

  // The Journey finds the race from your copy.
  const forJourney = await (await call(ben, 'GET', `/api/challenges/for-project/${benCopy}`)).json();
  assert.equal(forJourney.id, race.id);
  assert.equal((await (await call(ben, 'GET', `/api/challenges/for-project/${goal.id}`)).json()), null);

  // Leaving takes you off the board.
  assert.equal((await call(ben, 'POST', `/api/challenges/${race.id}/leave`)).status, 200);
  board = await (await call(ana, 'GET', `/api/challenges/${race.id}`)).json();
  assert.deepEqual(board.players.map(p => p.name), ['Ana']);
  assert.equal((await (await call(ana, 'GET', '/api/challenges')).json()).length, 1);
});
