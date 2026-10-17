const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Import (backend/routes/data.js): a goal comes back as a goal, with its
// sub-folders, tasks and named blockers, and nothing touches the profile
// unless the file carries one.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));

test('import keeps goals and blockers, and round-trips an export', async () => {
  const me = await signUp();
  const res = await json(me, 'POST', '/api/data/import', {
    projects: [{ id: 'g', title: 'Public launch', isGoal: true }, { id: 'p1', parentId: 'g', title: 'Get ready' }],
    tasks: [
      { projectId: 'p1', title: 'Design sign-off', status: 'Not Started', priority: 'High', endDate: '2026-11-13', obstacles: [{ name: 'Brand kit not final', count: 2 }, { name: 'Old', resolved: true }, { name: '  ' }] },
      { projectId: 'g', title: 'Merge replays', status: 'Completed', priority: 'Medium' },
    ],
  });
  assert.deepEqual([res.projects, res.tasks], [2, 2]);
  const projects = await json(me, 'GET', '/api/projects');
  const goal = projects.find(p => p.title === 'Public launch');
  assert.ok(goal.isGoal, 'still a goal');
  const tasks = await json(me, 'GET', '/api/tasks');
  const signOff = tasks.find(t => t.title === 'Design sign-off');
  assert.deepEqual(signOff.obstacles.map(o => [o.name, o.count, o.resolved]), [['Brand kit not final', 2, false], ['Old', 1, true]]);

  // export that goal and bring it back: same shape again
  const snapshot = await json(me, 'GET', `/api/data/export/${goal.id}`);
  const again = await json(me, 'POST', '/api/data/import', snapshot);
  assert.deepEqual([again.projects, again.tasks], [2, 2]);
  const copies = (await json(me, 'GET', '/api/projects')).filter(p => p.title === 'Public launch');
  assert.equal(copies.length, 2);
  assert.ok(copies.every(p => p.isGoal));
  const blockers = (await json(me, 'GET', '/api/tasks')).filter(t => t.title === 'Design sign-off').map(t => t.obstacles.length);
  assert.deepEqual(blockers, [2, 2]);
});
