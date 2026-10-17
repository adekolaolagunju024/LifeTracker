const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// A task's part of the day (tasks.dayPart): saved with the task, so My
// day, the week in Actions and the Kanban board all show it.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `dp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));

test('a task keeps its part of the day; only morning, afternoon or evening', async () => {
  const me = await signUp();
  const goal = await json(me, 'POST', '/api/projects', { title: 'Theory test', isGoal: true });
  const t = await json(me, 'POST', '/api/tasks', { projectId: goal.id, title: 'Road signs', status: 'Not Started', priority: 'High', dayPart: 'morning' });
  assert.equal(t.dayPart, 'morning');
  assert.equal((await json(me, 'PUT', `/api/tasks/${t.id}`, { dayPart: 'evening' })).dayPart, 'evening');
  // an unrelated edit leaves it alone
  assert.equal((await json(me, 'PUT', `/api/tasks/${t.id}`, { notes: 'Use the DVSA app' })).dayPart, 'evening');
  assert.equal((await json(me, 'PUT', `/api/tasks/${t.id}`, { dayPart: 'midnight' })).dayPart, null, 'anything else is any time');
  assert.equal((await json(me, 'PUT', `/api/tasks/${t.id}`, { dayPart: 'afternoon' })).dayPart, 'afternoon');
  assert.equal((await json(me, 'PUT', `/api/tasks/${t.id}`, { dayPart: null })).dayPart, null);
  const listed = (await json(me, 'GET', '/api/tasks')).find(x => x.id === t.id);
  assert.ok('dayPart' in listed);
  // and an import keeps it
  await call(me, 'POST', '/api/data/import', { projects: [{ id: 'g', title: 'Plan', isGoal: true }], tasks: [{ id: 'a', projectId: 'g', title: 'Mock test', status: 'Not Started', priority: 'Medium', dayPart: 'evening' }] });
  assert.equal((await json(me, 'GET', '/api/tasks')).find(x => x.title === 'Mock test').dayPart, 'evening');
});
