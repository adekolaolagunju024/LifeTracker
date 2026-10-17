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

test('import brings tags, counted targets and what each task waits on', async () => {
  const me = await signUp();
  const res = await json(me, 'POST', '/api/data/import', {
    projects: [{ id: 'g', title: 'UK driving licence', isGoal: true }],
    tasks: [
      { id: 'a', projectId: 'g', title: 'Road signs: 20 practice tests', status: 'In Progress', priority: 'High', targetCount: 20, targetUnit: 'practice tests', progressCount: 3, tags: [{ label: 'Road signs', color: '#DC2626' }, 'Theory'] },
      { id: 'b', projectId: 'g', title: 'Read the Know your traffic signs book', status: 'Not Started', priority: 'Medium', tags: ['road signs'] },
      { id: 'c', projectId: 'g', title: 'Sit the theory test', status: 'Not Started', priority: 'High', predecessors: [{ id: 'a' }, 'b', 'missing'] },
    ],
  });
  assert.equal(res.tasks, 3);
  const tasks = await json(me, 'GET', '/api/tasks');
  const by = t => tasks.find(x => x.title.startsWith(t));
  const signs = by('Road signs');
  assert.deepEqual([signs.targetCount, signs.targetUnit, signs.progressCount], [20, 'practice tests', 3]);
  assert.deepEqual(signs.tags.map(t => t.label), ['Road signs', 'Theory']);
  assert.deepEqual(by('Read the').tags.map(t => t.label), ['Road signs'], 'same tag reused, whatever the case');
  assert.deepEqual(by('Sit the').predecessors.map(p => p.title).sort(), ['Read the Know your traffic signs book', 'Road signs: 20 practice tests']);
  // the counter works on an imported target
  const bumped = await json(me, 'POST', `/api/tasks/${signs.id}/progress`, { delta: 1 });
  assert.equal(bumped.progressCount, 4);
});

test('a counter reaching its target with a blocker still open keeps the count and waits', async () => {
  const me = await signUp();
  await json(me, 'POST', '/api/data/import', {
    projects: [{ id: 'g', title: 'Theory', isGoal: true }],
    tasks: [{ id: 'a', projectId: 'g', title: 'Road signs', status: 'In Progress', priority: 'High', targetCount: 2, targetUnit: 'tests', progressCount: 1, obstacles: [{ name: 'Mixing up signs' }] }],
  });
  const t = (await json(me, 'GET', '/api/tasks')).find(x => x.title === 'Road signs');
  const r = await call(me, 'POST', `/api/tasks/${t.id}/progress`, { delta: 1 });
  assert.equal(r.status, 200);
  const after = await r.json();
  assert.deepEqual([after.progressCount, after.status], [2, 'In Progress']);
});
