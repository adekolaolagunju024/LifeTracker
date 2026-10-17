const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// Split the work for a company: phase leads (backend/challenges.js
// setLead) see, hand out and sign off their phase's steps; with milestone
// sign-off only the marked steps wait for approval.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

test('phase leads run their phase, and only milestones wait for sign-off', async () => {
  const ceo = await signUp();
  const yuki = await signUp();
  const ana = await signUp();
  const tom = await signUp();
  const goal = await json(ceo, 'POST', '/api/projects', { title: 'Public launch', isGoal: true });
  const design = await json(ceo, 'POST', '/api/projects', { title: 'Design', parentId: goal.id });
  const eng = await json(ceo, 'POST', '/api/projects', { title: 'Engineering', parentId: goal.id });
  const add = async (projectId, title) => (await json(ceo, 'POST', '/api/tasks', { projectId, title, status: 'Not Started', priority: 'Medium' })).id;
  const kit = await add(design.id, 'Brand kit');
  const page = await add(design.id, 'Teams page');
  const signOff = await add(design.id, 'Design sign-off');
  const billing = await add(eng.id, 'Team billing');

  const team = await json(ceo, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(60), mode: 'split', leaderRole: 'manager', displayName: 'Ada', checks: 'milestones' });
  assert.equal(team.checks, 'milestones');
  for (const [who, name] of [[yuki, 'Yuki'], [ana, 'Ana'], [tom, 'Tom']]) await call(who, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: name });
  let board = await json(ceo, 'GET', `/api/challenges/${team.id}`);
  const color = name => board.players.find(p => p.name === name).color;

  // only the leader names leads; Yuki leads Design
  assert.equal((await call(yuki, 'POST', `/api/challenges/${team.id}/leads`, { projectId: design.id, color: color('Yuki') })).status, 403);
  assert.equal((await call(ceo, 'POST', `/api/challenges/${team.id}/leads`, { projectId: design.id, color: color('Yuki') })).status, 200);
  board = await json(ceo, 'GET', `/api/challenges/${team.id}`);
  assert.deepEqual(board.split.phases.map(p => [p.title, p.lead && p.lead.name]), [['Design', 'Yuki'], ['Engineering', null]]);

  // Yuki sees all of Design (not Engineering), hands steps out in it and marks a milestone
  const yukiTasks = (await json(yuki, 'GET', '/api/tasks')).map(t => t.title).sort();
  assert.deepEqual(yukiTasks, ['Brand kit', 'Design sign-off', 'Teams page']);
  assert.equal((await call(yuki, 'POST', `/api/challenges/${team.id}/assign`, { taskId: kit, color: color('Ana') })).status, 200);
  assert.equal((await call(yuki, 'POST', `/api/challenges/${team.id}/assign`, { taskId: billing, color: color('Ana') })).status, 403);
  assert.equal((await call(yuki, 'POST', `/api/challenges/${team.id}/assign`, { taskId: signOff, color: color('Yuki') })).status, 200);
  await call(yuki, 'POST', `/api/challenges/${team.id}/assign`, { taskId: page, color: color('Ana') });
  await call(ceo, 'POST', `/api/challenges/${team.id}/assign`, { taskId: billing, color: color('Tom') });
  assert.equal((await call(ana, 'POST', `/api/challenges/${team.id}/milestone`, { taskId: kit, on: true })).status, 403);
  assert.equal((await call(yuki, 'POST', `/api/challenges/${team.id}/milestone`, { taskId: kit, on: true })).status, 200);
  await call(ceo, 'POST', `/api/challenges/${team.id}/milestone`, { taskId: signOff, on: true });
  // Ana still sees only her own steps
  assert.deepEqual((await json(ana, 'GET', '/api/tasks')).map(t => t.title).sort(), ['Brand kit', 'Teams page']);

  // Ana ticks both: the ordinary step counts, the milestone waits for Yuki
  await call(ana, 'PUT', `/api/tasks/${kit}`, { status: 'Completed' });
  await call(ana, 'PUT', `/api/tasks/${page}`, { status: 'Completed' });
  let anaBoard = await json(ana, 'GET', `/api/challenges/${team.id}`);
  assert.equal(anaBoard.players.find(p => p.you).done, 1);
  assert.deepEqual(anaBoard.yourSteps.waiting.map(s => s.title), ['Brand kit']);
  const yukiBoard = await json(yuki, 'GET', `/api/challenges/${team.id}`);
  assert.deepEqual(yukiBoard.reviews.map(r => r.title), ['Brand kit']);
  assert.deepEqual(yukiBoard.leadOf, [design.id]);
  assert.deepEqual((await json(ceo, 'GET', `/api/challenges/${team.id}`)).reviews, [], 'the leader is not asked about a step its phase lead signs off');
  assert.equal((await call(ana, 'POST', `/api/challenges/${team.id}/review`, { color: color('Ana'), taskId: kit, decision: 'approve' })).status, 403);
  assert.equal((await call(yuki, 'POST', `/api/challenges/${team.id}/review`, { color: color('Ana'), taskId: kit, decision: 'approve' })).status, 200);
  anaBoard = await json(ana, 'GET', `/api/challenges/${team.id}`);
  assert.equal(anaBoard.players.find(p => p.you).done, 2);

  // Yuki's own milestone goes to the leader, not to herself
  await call(yuki, 'PUT', `/api/tasks/${signOff}`, { status: 'Completed' });
  assert.deepEqual((await json(yuki, 'GET', `/api/challenges/${team.id}`)).reviews, []);
  assert.equal((await call(yuki, 'POST', `/api/challenges/${team.id}/review`, { color: color('Yuki'), taskId: signOff, decision: 'approve' })).status, 404);
  assert.deepEqual((await json(ceo, 'GET', `/api/challenges/${team.id}`)).reviews.map(r => r.title), ['Design sign-off']);

  // the leader can change how steps are checked; nobody else can
  assert.equal((await call(yuki, 'POST', `/api/challenges/${team.id}/checks`, { checks: 'none' })).status, 403);
  assert.equal((await json(ceo, 'POST', `/api/challenges/${team.id}/checks`, { checks: 'none' })).checks, 'none');
  assert.equal((await json(yuki, 'GET', `/api/challenges/${team.id}`)).players.find(p => p.you).done, 1);
});

test('the leader and a phase lead delete steps from the team page, and can undo it', async () => {
  const ceo = await signUp();
  const lead = await signUp();
  const member = await signUp();
  const goal = await json(ceo, 'POST', '/api/projects', { title: 'Café', isGoal: true });
  const design = await json(ceo, 'POST', '/api/projects', { title: 'Design', parentId: goal.id });
  const build = await json(ceo, 'POST', '/api/projects', { title: 'Build', parentId: goal.id });
  const add = async (projectId, title) => (await json(ceo, 'POST', '/api/tasks', { projectId, title, status: 'Not Started', priority: 'Medium' })).id;
  const menu = await add(design.id, 'Menu');
  const sign = await add(design.id, 'Sign');
  const kitchen = await add(build.id, 'Kitchen');
  const team = await json(ceo, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(30), mode: 'split', displayName: 'Ada' });
  await call(lead, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Chi' });
  await call(member, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ben' });
  const board = await json(ceo, 'GET', `/api/challenges/${team.id}`);
  const color = name => board.players.find(p => p.name === name).color;
  await call(ceo, 'POST', `/api/challenges/${team.id}/leads`, { projectId: design.id, color: color('Chi') });
  await call(ceo, 'POST', `/api/challenges/${team.id}/assign`, { taskId: kitchen, color: color('Ben') });

  assert.equal((await call(member, 'DELETE', `/api/tasks/${kitchen}`)).status, 400, 'a teammate cannot');
  await call(lead, 'DELETE', `/api/tasks/${kitchen}`); // nor a lead outside their phase: Kitchen is still there below
  assert.equal((await call(lead, 'DELETE', `/api/tasks/${menu}`)).status, 200, 'a lead in their phase can');
  assert.equal((await call(lead, 'POST', `/api/trash/tasks/${menu}/restore`)).status, 200, 'and undo it');
  assert.equal((await call(ceo, 'DELETE', `/api/tasks/${sign}`)).status, 200, 'the leader can');
  const left = (await json(ceo, 'GET', `/api/challenges/${team.id}`)).split.steps.map(st => st.title).sort();
  assert.deepEqual(left, ['Kitchen', 'Menu']);
});
