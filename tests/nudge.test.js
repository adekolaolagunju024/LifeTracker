const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Waiting on someone else's step: you see who has it, and can nudge them.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async name => {
  const c = sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `nudge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
  await call(c, 'PUT', '/api/profile', { name });
  return c;
};
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

test("a step waiting on a teammate's step says who has it, and you can nudge them (not too often)", async () => {
  const lead = await signUp('Sam');
  const ana = await signUp('Ana');
  const ben = await signUp('Ben');
  const goal = await json(lead, 'POST', '/api/projects', { title: 'Kitchen refit', isGoal: true });
  const order = await json(lead, 'POST', '/api/tasks', { projectId: goal.id, title: 'Order units', status: 'Not Started', priority: 'Medium' });
  const fit = await json(lead, 'POST', '/api/tasks', { projectId: goal.id, title: 'Fit units', status: 'Not Started', priority: 'Medium' });
  await call(lead, 'PUT', `/api/tasks/${fit.id}/predecessors`, { predecessorIds: [order.id] });
  const team = await json(lead, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(21), mode: 'split', leaderRole: 'manager', displayName: 'Sam' });
  await call(ana, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ana' });
  await call(ben, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ben' });
  await call(ben, 'POST', `/api/challenges/${team.id}/claim`, { taskId: order.id });
  await call(ana, 'POST', `/api/challenges/${team.id}/claim`, { taskId: fit.id });

  // Ana can't start fitting, and sees it's Ben's step she's waiting on.
  const mine = await json(ana, 'GET', `/api/tasks/${fit.id}`);
  assert.equal(mine.predecessors[0].assigneeName, 'Ben');
  assert.equal((await call(ana, 'PUT', `/api/tasks/${fit.id}`, { status: 'Completed' })).status, 409);

  // She nudges him: a comment on his step, in his bell.
  const r = await call(ana, 'POST', `/api/tasks/${fit.id}/nudge`, { predecessorId: order.id });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).nudged, 'Ben');
  const comments = await json(ben, 'GET', `/api/tasks/${order.id}/comments`);
  assert.ok(comments.some(c => /^Nudge: I'm waiting on this so I can start “Fit units”/.test(c.text)), JSON.stringify(comments));
  const bell = await json(ben, 'GET', '/api/notifications');
  assert.ok(bell.commentActivity.some(a => a.taskId === order.id));

  // Not again straight away; and nothing to nudge once it's done.
  assert.equal((await call(ana, 'POST', `/api/tasks/${fit.id}/nudge`, { predecessorId: order.id })).status, 429);
  await call(ben, 'PUT', `/api/tasks/${order.id}`, { status: 'Completed' });
  assert.equal((await call(ana, 'POST', `/api/tasks/${fit.id}/nudge`, { predecessorId: order.id })).status, 400);
  // Only a step this one actually waits on.
  assert.equal((await call(ana, 'POST', `/api/tasks/${fit.id}/nudge`, { predecessorId: fit.id })).status, 404);
});
