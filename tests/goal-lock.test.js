const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Locked goals (backend/db/db.js lockOf): a goal can wait on another goal,
// and its steps can't be ticked off until that one is finished.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `lock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const step = (c, projectId, title) => json(c, 'POST', '/api/tasks', { projectId, title, status: 'Not Started', priority: 'Medium' });

test('a locked goal waits on another: its steps stay open until that goal is done, then it unlocks', async () => {
  const me = await signUp();
  const first = await json(me, 'POST', '/api/projects', { title: 'Learn to swim', isGoal: true });
  const a = await step(me, first.id, 'Book lessons');
  const b = await step(me, first.id, 'Swim a length');
  const next = await json(me, 'POST', '/api/projects', { title: 'Triathlon', isGoal: true, unlockAfter: first.id });
  assert.equal(next.locked, true);
  assert.equal(next.lockedBy.id, first.id);
  const t = await step(me, next.id, 'Buy a bike');

  // Ticking a step off in the locked goal is refused.
  const refused = await call(me, 'PUT', `/api/tasks/${t.id}`, { status: 'Completed' });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, 'GOAL_LOCKED');

  // Finishing the first goal says what it opened.
  const half = await json(me, 'PUT', `/api/tasks/${a.id}`, { status: 'Completed' });
  assert.deepEqual(half.unlocked, []);
  const done = await json(me, 'PUT', `/api/tasks/${b.id}`, { status: 'Completed' });
  assert.deepEqual(done.unlocked.map(g => g.id), [next.id]);
  assert.equal((await json(me, 'GET', `/api/projects/${next.id}`)).locked, false);
  assert.equal((await call(me, 'PUT', `/api/tasks/${t.id}`, { status: 'Completed' })).status, 200);
});

test('locks are checked: no loops, not itself, top-level goals of the same owner, and Unlock now clears it', async () => {
  const me = await signUp();
  const other = await signUp();
  const g1 = await json(me, 'POST', '/api/projects', { title: 'One', isGoal: true });
  const g2 = await json(me, 'POST', '/api/projects', { title: 'Two', isGoal: true, unlockAfter: g1.id });
  const g3 = await json(me, 'POST', '/api/projects', { title: 'Three', isGoal: true, unlockAfter: g2.id });
  assert.equal(g3.lockedBy.id, g2.id);

  assert.equal((await call(me, 'PUT', `/api/projects/${g1.id}`, { unlockAfter: g3.id })).status, 400); // a loop
  assert.equal((await call(me, 'PUT', `/api/projects/${g1.id}`, { unlockAfter: g1.id })).status, 400); // itself
  const phase = await json(me, 'POST', '/api/projects', { title: 'Phase', parentId: g1.id });
  assert.equal((await call(me, 'PUT', `/api/projects/${g2.id}`, { unlockAfter: phase.id })).status, 400); // not a goal
  const theirs = await json(other, 'POST', '/api/projects', { title: 'Theirs', isGoal: true });
  assert.equal((await call(me, 'PUT', `/api/projects/${g2.id}`, { unlockAfter: theirs.id })).status, 400); // not mine

  const opened = await json(me, 'PUT', `/api/projects/${g3.id}`, { unlockAfter: null });
  assert.equal(opened.locked, false);
  assert.equal(opened.lockedBy, null);
});
