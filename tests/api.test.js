const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const json = (body, cookie) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});
const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const uniqueEmail = () => `api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;

test('registration without accepting terms is rejected and creates no session', async () => {
  const res = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123' }));
  assert.equal(res.status, 400);
  assert.equal(sessionCookie(res), '');
});

test('registration with accepted terms succeeds and issues a session', async () => {
  const res = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  assert.equal(res.status, 201);
  assert.ok(sessionCookie(res).startsWith('connect.sid='));
});

test('signed-out visitors see the landing page at /', async () => {
  const html = await (await fetch(`${server.base}/`)).text();
  assert.match(html, /Turn a goal into a plan\s+<span class="text-teal">you'll actually finish/);
});

test('/app always serves the application shell', async () => {
  const html = await (await fetch(`${server.base}/app`)).text();
  assert.match(html, /id="auth-overlay"/);
});

test('signed-in users get the application at /', async () => {
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const html = await (await fetch(`${server.base}/`, { headers: { Cookie: sessionCookie(reg) } })).text();
  assert.match(html, /id="auth-overlay"/);
  assert.doesNotMatch(html, /Turn a goal into a plan,/);
});

for (const page of ['/landing.html', '/privacy.html', '/terms.html']) {
  test(`${page} is served`, async () => {
    const res = await fetch(`${server.base}${page}`);
    assert.equal(res.status, 200);
  });
}

test('unauthenticated API access is refused', async () => {
  const res = await fetch(`${server.base}/api/projects`);
  assert.equal(res.status, 401);
});

test('AI endpoints require a session', async () => {
  const res = await fetch(`${server.base}/api/ai/assistant`, json({ messages: [] }));
  assert.equal(res.status, 401);
});

test('justCompleted is true only the moment a task crosses into Completed', async () => {
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const cookie = sessionCookie(reg);
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Celebration check' }, cookie))).json();
  const task = await (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title: 'Task', status: 'Not Started', priority: 'Medium' }, cookie))).json();

  const put = (patch) => fetch(`${server.base}/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(patch) });

  const toProgress = await (await put({ status: 'In Progress' })).json();
  assert.equal(toProgress.justCompleted, false);

  const completed = await (await put({ status: 'Completed' })).json();
  assert.equal(completed.justCompleted, true);

  const editAgain = await (await put({ priority: 'High' })).json();
  assert.equal(editAgain.justCompleted, false, 'editing an already-completed task does not re-trigger it');
});

test('status updates: posted, listed with a status snapshot, and deletable by their author', async () => {
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const cookie = sessionCookie(reg);
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Status update check' }, cookie))).json();
  const task = await (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title: 'Task', status: 'Not Started', priority: 'Medium' }, cookie))).json();

  const emptyList = await (await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(emptyList, []);

  const posted = await (await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, json({ text: 'Waiting on client feedback' }, cookie))).json();
  assert.equal(posted.text, 'Waiting on client feedback');
  assert.equal(posted.status, 'Not Started', 'snapshots the status at post time');

  const list = await (await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, { headers: { Cookie: cookie } })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, posted.id);

  const del = await fetch(`${server.base}/api/tasks/status-updates/${posted.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(del.status, 200);
  const afterDelete = await (await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(afterDelete, []);
});

// Signs up and confirms the email, as anyone sending invites must.
async function signUpVerified() {
  const email = uniqueEmail();
  const cookie = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email, password: 'testpass123', acceptTerms: true })));
  const token = await server.verifyTokenFor(email);
  assert.equal((await fetch(`${server.base}/api/auth/verify-email`, json({ token }))).status, 200);
  return cookie;
}

test('a viewer cannot post a status update, but can still read them', async () => {
  const ownerCookie = await signUpVerified();
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Viewer check' }, ownerCookie))).json();
  const task = await (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title: 'Task', status: 'In Progress', priority: 'Medium' }, ownerCookie))).json();

  const viewerEmail = uniqueEmail();
  const viewer = await fetch(`${server.base}/api/auth/register`, json({ email: viewerEmail, password: 'testpass123', acceptTerms: true }));
  const viewerCookie = sessionCookie(viewer);
  const invite = await (await fetch(`${server.base}/api/projects/${project.id}/collaborators`, json({ email: viewerEmail, role: 'viewer' }, ownerCookie))).json();
  await fetch(`${server.base}/api/projects/invites/${invite.id}/accept`, { method: 'POST', headers: { Cookie: viewerCookie } });

  const denied = await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, json({ text: 'Trying anyway' }, viewerCookie));
  assert.equal(denied.status, 400);

  const read = await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, { headers: { Cookie: viewerCookie } });
  assert.equal(read.status, 200);
});

test('a status update can be flagged as a blocker', async () => {
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const cookie = sessionCookie(reg);
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Blocker check' }, cookie))).json();
  const task = await (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title: 'Task', status: 'In Progress', priority: 'Medium' }, cookie))).json();

  const posted = await (await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, json({ text: 'Waiting on design assets', isBlocker: true }, cookie))).json();
  assert.equal(posted.isBlocker, true);

  const list = await (await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, { headers: { Cookie: cookie } })).json();
  assert.equal(list[0].isBlocker, true);

  const tableRow = await (await fetch(`${server.base}/api/tasks?projectId=${project.id}`, { headers: { Cookie: cookie } })).json();
  assert.equal(tableRow[0].latestUpdateIsBlocker, 1, 'the row-level badge data reflects the blocker flag too');

  const ordinary = await (await fetch(`${server.base}/api/tasks/${task.id}/status-updates`, json({ text: 'Just a note' }, cookie))).json();
  assert.equal(ordinary.isBlocker, false, 'isBlocker defaults to false when not passed');
});

test('obstacles can be added to a task, edited, listed with it, and removed', async () => {
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const cookie = sessionCookie(reg);
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Obstacle check' }, cookie))).json();
  const task = await (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title: 'Task', status: 'Not Started', priority: 'Medium' }, cookie))).json();
  const put = (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });

  const added = await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, json({ name: '  Supplier quote  ', count: 3 }, cookie));
  assert.equal(added.status, 201);
  const obstacle = await added.json();
  assert.deepEqual({ name: obstacle.name, count: obstacle.count }, { name: 'Supplier quote', count: 3 });

  const clamped = await (await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, json({ name: 'Too many', count: 40 }, cookie))).json();
  assert.equal(clamped.count, 5, 'the count is capped at 5');
  const unnamed = await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, json({ name: '   ', count: 2 }, cookie));
  assert.equal(unnamed.status, 400, 'an obstacle needs a name');

  const edited = await (await put(`${server.base}/api/tasks/obstacles/${obstacle.id}`, { count: 1, name: 'Quote signed off' })).json();
  assert.deepEqual({ name: edited.name, count: edited.count }, { name: 'Quote signed off', count: 1 });

  const rows = await (await fetch(`${server.base}/api/tasks?projectId=${project.id}`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(rows[0].obstacles.map(o => [o.name, o.count]), [['Quote signed off', 1], ['Too many', 5]], 'tasks carry their obstacles, oldest first');
  assert.equal(rows[0].obstacles[0].resolved, false, 'a new obstacle is pending');

  const ticked = await (await put(`${server.base}/api/tasks/obstacles/${obstacle.id}`, { resolved: true })).json();
  assert.deepEqual({ name: ticked.name, resolved: ticked.resolved }, { name: 'Quote signed off', resolved: true }, 'one obstacle can be ticked off on its own');
  assert.equal(ticked.taskId, task.id, 'it says which task it belongs to, so the app can offer to start that task');
  const afterTick = await (await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(afterTick.map(o => o.resolved), [true, false], 'the other obstacle stays pending');
  const unticked = await (await put(`${server.base}/api/tasks/obstacles/${obstacle.id}`, { resolved: false })).json();
  assert.equal(unticked.resolved, false, 'unticking brings it back');

  const del = await fetch(`${server.base}/api/tasks/obstacles/${obstacle.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(del.status, 200);
  const list = await (await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(list.map(o => o.name), ['Too many']);

  const stranger = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true })));
  const peek = await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, { headers: { Cookie: stranger } });
  assert.equal(peek.status, 404, "another account can't see this task's obstacles");
});

test("a task can't be completed while any of its blockers is still pending", async () => {
  const cookie = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true })));
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Gate check' }, cookie))).json();
  const task = await (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title: 'Open the shop', status: 'Not Started', priority: 'Medium' }, cookie))).json();
  const put = (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const a = await (await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, json({ name: 'Licence', count: 1 }, cookie))).json();
  const b = await (await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, json({ name: 'Signage', count: 1 }, cookie))).json();

  const started = await put(`${server.base}/api/tasks/${task.id}`, { status: 'In Progress' });
  assert.equal(started.status, 200, 'blockers only gate completion, not starting');
  await put(`${server.base}/api/tasks/obstacles/${a.id}`, { resolved: true });
  const refused = await put(`${server.base}/api/tasks/${task.id}`, { status: 'Completed' });
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.code, 'BLOCKERS_PENDING');
  assert.deepEqual(body.names, ['Signage'], 'the error names only the blockers still pending');

  await put(`${server.base}/api/tasks/obstacles/${b.id}`, { resolved: true });
  const done = await put(`${server.base}/api/tasks/${task.id}`, { status: 'Completed' });
  assert.equal(done.status, 200, 'with every blocker cleared it completes');
});

test("a task waits for its predecessors before it can start or be completed", async () => {
  const cookie = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true })));
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Dependency check' }, cookie))).json();
  const mk = async title => (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title, status: 'Not Started', priority: 'Medium' }, cookie))).json();
  const theory = await mk('Theory test'), practical = await mk('Practical test'), lessons = await mk('Lessons');
  const put = (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });

  const linked = await (await put(`${server.base}/api/tasks/${practical.id}/predecessors`, { predecessorIds: [theory.id, lessons.id] })).json();
  assert.deepEqual(linked.predecessors.map(p => p.title), ['Theory test', 'Lessons']);

  const early = await put(`${server.base}/api/tasks/${practical.id}`, { status: 'In Progress' });
  assert.equal(early.status, 409);
  const body = await early.json();
  assert.equal(body.code, 'WAITING_ON_PREDECESSORS');
  assert.deepEqual(body.names, ['Theory test', 'Lessons']);

  await put(`${server.base}/api/tasks/${theory.id}`, { status: 'Completed' });
  const stillWaiting = await (await put(`${server.base}/api/tasks/${practical.id}`, { status: 'Completed' })).json();
  assert.deepEqual(stillWaiting.names, ['Lessons'], 'only the unfinished predecessor is still in the way');
  await put(`${server.base}/api/tasks/${lessons.id}`, { status: 'Completed' });
  assert.equal((await put(`${server.base}/api/tasks/${practical.id}`, { status: 'In Progress' })).status, 200);

  const loop = await put(`${server.base}/api/tasks/${theory.id}/predecessors`, { predecessorIds: [practical.id] });
  assert.equal(loop.status, 400, 'a loop of dependencies is refused');
  const self = await put(`${server.base}/api/tasks/${theory.id}/predecessors`, { predecessorIds: [theory.id] });
  assert.equal(self.status, 400, "a task can't depend on itself");
  const other = await (await fetch(`${server.base}/api/projects`, json({ title: 'Elsewhere' }, cookie))).json();
  const outsider = await (await fetch(`${server.base}/api/tasks`, json({ projectId: other.id, title: 'Other', status: 'Not Started', priority: 'Medium' }, cookie))).json();
  assert.equal((await put(`${server.base}/api/tasks/${theory.id}/predecessors`, { predecessorIds: [outsider.id] })).status, 400, 'predecessors come from the same project');

  const listed = await (await fetch(`${server.base}/api/tasks?projectId=${project.id}`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(listed.find(t => t.id === practical.id).predecessors.map(p => [p.title, p.status]), [['Theory test', 'Completed'], ['Lessons', 'Completed']]);
});

test('completing a task awards Journey XP and reports it on the response', async () => {
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const cookie = sessionCookie(reg);
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'XP check' }, cookie))).json();
  const task = await (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title: 'Task', status: 'Not Started', priority: 'High' }, cookie))).json();

  const before = await (await fetch(`${server.base}/api/journey-gaming/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(before.xp, 0);
  assert.equal(before.level, 1);
  assert.ok(before.achievements.every(a => !a.unlocked));

  const put = await fetch(`${server.base}/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ status: 'Completed' }) });
  const completed = await put.json();
  assert.equal(completed.journeyReward.xpAwarded, 15, 'High priority awards more XP than the default');
  assert.equal(completed.journeyReward.xp, 15);
  assert.deepEqual(completed.journeyReward.newAchievements.map(a => a.code), ['first_task', 'first_house'], 'finishing the only task also finishes the whole project');

  const after = await (await fetch(`${server.base}/api/journey-gaming/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(after.xp, 15);
  const firstTask = after.achievements.find(a => a.code === 'first_task');
  assert.equal(firstTask.unlocked, true);

  // Editing an already-completed task (not a fresh completion) awards nothing more.
  const editAgain = await (await fetch(`${server.base}/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ priority: 'Low' }) })).json();
  assert.equal(editAgain.journeyReward, null);
  const stillSame = await (await fetch(`${server.base}/api/journey-gaming/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(stillSame.xp, 15);
});

test('assistant conversations are saved, listed newest first, reopened, kept private and deletable', async () => {
  const me = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true })));
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Launch plan' }, me))).json();
  const put = (id, body, cookie = me) => fetch(`${server.base}/api/ai/conversations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });

  const first = await put('convo-aaaa-1111', { projectId: project.id, messages: [
    { role: 'user', content: 'Add a task to book the venue', attachment: { name: 'plan.pdf', dataBase64: 'AAAA' } },
    { role: 'assistant', content: 'Here are the changes I suggest.', kind: 'edits' },
    { role: 'system', content: 'ignored' },
  ] });
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.equal(saved.title, 'Add a task to book the venue');
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[0].attachmentName, 'plan.pdf');
  assert.equal(saved.messages[0].attachment, undefined, 'file contents are never stored');
  assert.equal(saved.messages[1].kind, 'edits');

  await put('convo-bbbb-2222', { messages: [{ role: 'user', content: 'Plan a marathon' }] });
  const list = await (await fetch(`${server.base}/api/ai/conversations`, { headers: { Cookie: me } })).json();
  assert.deepEqual(list.map(c => c.id), ['convo-bbbb-2222', 'convo-aaaa-1111']);
  assert.equal(list[1].projectTitle, 'Launch plan');
  assert.equal(list[1].count, 2);

  // continuing a chat updates it in place
  await put('convo-aaaa-1111', { projectId: project.id, messages: [...saved.messages, { role: 'user', content: 'And a caterer' }] });
  const reopened = await (await fetch(`${server.base}/api/ai/conversations/convo-aaaa-1111`, { headers: { Cookie: me } })).json();
  assert.equal(reopened.messages.length, 3);

  // someone else can neither read nor overwrite it
  const other = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true })));
  assert.equal((await fetch(`${server.base}/api/ai/conversations/convo-aaaa-1111`, { headers: { Cookie: other } })).status, 404);
  assert.equal((await put('convo-aaaa-1111', { messages: [{ role: 'user', content: 'mine now' }] }, other)).status, 404);
  assert.equal((await put('bad id!', { messages: [] })).status, 400);

  await fetch(`${server.base}/api/ai/conversations/convo-aaaa-1111`, { method: 'DELETE', headers: { Cookie: me } });
  const after = await (await fetch(`${server.base}/api/ai/conversations`, { headers: { Cookie: me } })).json();
  assert.deepEqual(after.map(c => c.id), ['convo-bbbb-2222']);
});

test('pages and scripts carry protective headers, are gzipped, and send no CORS or X-Powered-By', async () => {
  const res = await fetch(`${server.base}/js/app/01-core.js`, { headers: { 'Accept-Encoding': 'gzip', Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('content-encoding'), 'gzip');
  const csp = res.headers.get('content-security-policy') || '';
  for (const rule of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'"]) assert.ok(csp.includes(rule), rule);
});

test('the app is written as ordered parts, and served as one cached, compressed bundle', async () => {
  // As written: the page lists the parts in numbered order.
  const source = require('fs').readFileSync(require('path').join(__dirname, '../frontend/index.html'), 'utf8');
  const parts = [...source.matchAll(/<script src="(js\/app\/[^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(parts.length >= 10);
  assert.deepEqual(parts, [...parts].sort(), 'parts load in numbered order');
  for (const part of parts) assert.equal((await fetch(`${server.base}/${part}`)).status, 200, part);

  // As served: one hashed script and one stylesheet, no inline CSS, and
  // the page itself is never cached.
  const res = await fetch(`${server.base}/app`, { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const html = await res.text();
  const js = [...html.matchAll(/<script src="(\/build\/app\.[0-9a-f]{12}\.js)"><\/script>/g)].map(m => m[1]);
  assert.equal(js.length, 1, 'one bundle');
  assert.ok(!/<script src="js\//.test(html), 'no separate app scripts');
  assert.ok(!/<style>/.test(html), 'no inline stylesheet');
  const css = html.match(/href="(\/build\/page\.[0-9a-f]{12}\.css)"/);
  assert.ok(css, 'the page stylesheet');

  const bundle = await fetch(`${server.base}${js[0]}`, { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get('cache-control'), /max-age=31536000, immutable/);
  assert.equal(bundle.headers.get('content-encoding'), 'br');
  const code = await bundle.text();
  // Top-level names survive minifying: the markup's onclick handlers call them.
  for (const name of ['function showPage', 'function openTaskDetail', 'Jarvis=', 'DayRoad=']) assert.ok(code.includes(name), name);
  assert.equal((await fetch(`${server.base}${css[1]}`)).status, 200);
  assert.equal((await fetch(`${server.base}/build/app.000000000000.js`)).status, 404);
});

test('passwords shorter than 8 characters are refused', async () => {
  const res = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'short12', acceptTerms: true }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /8 characters/);
});

test('signing in starts a fresh session id', async () => {
  const email = uniqueEmail();
  await fetch(`${server.base}/api/auth/register`, json({ email, password: 'testpass123', acceptTerms: true }));
  // a session that exists before sign-in (e.g. planted by someone else)
  const planted = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true })));
  const login = await fetch(`${server.base}/api/auth/login`, json({ email, password: 'testpass123' }, planted));
  assert.equal(login.status, 200);
  const fresh = sessionCookie(login);
  assert.ok(fresh.startsWith('connect.sid='));
  assert.notEqual(fresh, planted);
});

test('repeated failed sign-ins for one account are slowed down', async () => {
  const email = uniqueEmail();
  let last;
  for (let i = 0; i < 11; i++) last = await fetch(`${server.base}/api/auth/login`, json({ email, password: 'wrong-password' }));
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

test('forgot password answers the same for known and unknown emails', async () => {
  const email = uniqueEmail();
  await fetch(`${server.base}/api/auth/register`, json({ email, password: 'testpass123', acceptTerms: true }));
  const known = await fetch(`${server.base}/api/auth/forgot-password`, json({ email }));
  const unknown = await fetch(`${server.base}/api/auth/forgot-password`, json({ email: uniqueEmail() }));
  assert.equal(known.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
});

test('the landing page is filled in from product data: every stage, the latest news, no leftover markers', async () => {
  const product = require('../frontend/data/product.json');
  const html = await (await fetch(`${server.base}/`)).text();
  assert.doesNotMatch(html, /<!--@[a-z]+-->/);
  for (const stage of product.stages) assert.match(html, new RegExp(`/showcase/stage-${stage.id}\\.webp`));
  // escaped as the landing page escapes it (an apostrophe becomes &#39;)
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  assert.ok(html.includes(esc(product.whatsNew[0].title)));
  assert.equal(await (await fetch(`${server.base}/landing.html`)).text(), html);
});

test('every landing page screenshot is served, and nothing else under /showcase', async () => {
  const product = require('../frontend/data/product.json');
  const names = ['journey', 'phone', 'planner', 'project', 'assistant', ...product.stages.flatMap(s => (s.only2d ? [`stage-${s.id}`] : [`stage-${s.id}`, `stage-${s.id}-3d`]))];
  for (const name of names) {
    const res = await fetch(`${server.base}/showcase/${name}.webp`);
    assert.equal(res.status, 200, name);
    assert.equal(res.headers.get('content-type'), 'image/webp');
  }
  assert.equal((await fetch(`${server.base}/showcase/..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${server.base}/showcase/nope.webp`)).status, 404);
});

test("the landing page's stages match the Journey's stage picker", async () => {
  const product = require('../frontend/data/product.json');
  const html = require('fs').readFileSync(require('path').join(__dirname, '../frontend/index.html'), 'utf8');
  const select = html.slice(html.indexOf('id="journey-theme-select"'), html.indexOf('</select>', html.indexOf('id="journey-theme-select"')));
  const picker = [...select.matchAll(/<option value="([a-z]+)">/g)].map(m => m[1]);
  assert.deepEqual(product.stages.map(s => s.id), picker);
});

test('the feature tour plays on the landing page, and every app action it names exists', async () => {
  const product = require('../frontend/data/product.json');
  const { ICON_PATHS } = require('../frontend/js/icons.js');
  const html = await (await fetch(`${server.base}/`)).text();
  assert.ok(product.tour.length >= 4);
  for (const t of product.tour) {
    assert.ok(t.id && t.name && t.title && t.text && t.bg, `tour entry ${t.id} is complete`);
    assert.ok(ICON_PATHS[t.icon], `tour icon ${t.icon} exists`);
    assert.match(html, new RegExp(`id="tour-${t.id}"`));
  }
  // The app's newcomer slides only use actions recap.js knows how to run.
  const recap = require('fs').readFileSync(require('path').join(__dirname, '../frontend/js/recap.js'), 'utf8');
  const known = recap.slice(recap.indexOf('const TOUR_ACTIONS'), recap.indexOf('};', recap.indexOf('const TOUR_ACTIONS')));
  for (const t of product.tour.filter(x => x.action)) assert.match(known, new RegExp(`\\n  ${t.action}:`), `action ${t.action}`);
});

const signUp = async () => sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true })));
const authed = (cookie, method = 'GET', body) => ({ method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('templates are listed and one creates a whole dated plan with phases, targets and dependencies', async () => {
  const cookie = await signUp();
  const list = await (await fetch(`${server.base}/api/projects/templates`, authed(cookie))).json();
  assert.ok(list.length >= 6);
  const jobHunt = list.find(t => t.id === 'job-hunt');
  assert.ok(jobHunt.tasks > 0 && jobHunt.phases === 3);

  const res = await fetch(`${server.base}/api/projects/from-template`, authed(cookie, 'POST', { templateId: 'job-hunt', startDate: '2027-01-04' }));
  assert.equal(res.status, 201);
  const project = await res.json();
  assert.equal(project.title, 'Land a new job');
  assert.equal(project.startDate, '2027-01-04');
  const phases = await (await fetch(`${server.base}/api/projects?parentId=${project.id}`, authed(cookie))).json();
  assert.equal(phases.length, 3);
  const tasks = (await (await fetch(`${server.base}/api/tasks`, authed(cookie))).json()).filter(t => phases.some(p => p.id === t.projectId));
  assert.equal(tasks.length, jobHunt.tasks);
  const cv = tasks.find(t => t.title.startsWith('Update my CV'));
  assert.equal(cv.startDate, '2027-01-04');
  const apply = tasks.find(t => t.title === 'Send applications');
  assert.deepEqual([apply.targetCount, apply.targetUnit], [15, 'applications']);
  assert.deepEqual(apply.predecessors.map(p => p.id), [cv.id]);

  assert.equal((await fetch(`${server.base}/api/projects/from-template`, authed(cookie, 'POST', { templateId: 'nope' }))).status, 404);
});

test('the calendar feed lists due tasks for its token only, and resetting the link revokes the old one', async () => {
  const cookie = await signUp();
  const project = await (await fetch(`${server.base}/api/projects`, authed(cookie, 'POST', { title: 'Feed, test; project' }))).json();
  await fetch(`${server.base}/api/tasks`, authed(cookie, 'POST', { projectId: project.id, title: 'Book the venue, then confirm', endDate: '2027-03-05' }));
  await fetch(`${server.base}/api/tasks`, authed(cookie, 'POST', { projectId: project.id, title: 'No date yet' }));

  const { url } = await (await fetch(`${server.base}/api/calendar/feed`, authed(cookie))).json();
  const path = new URL(url).pathname;
  assert.match(path, /^\/calendar\/[A-Za-z0-9_-]{20,}\.ics$/);
  const feed = await fetch(`${server.base}${path}`);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type'), /text\/calendar/);
  const ics = await feed.text();
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270305\r\n/);
  assert.match(ics, /SUMMARY:Book the venue\\, then confirm/);
  assert.doesNotMatch(ics, /No date yet/);
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));

  const reset = await (await fetch(`${server.base}/api/calendar/feed/reset`, authed(cookie, 'POST'))).json();
  assert.notEqual(reset.url, url);
  assert.equal((await fetch(`${server.base}${path}`)).status, 404);
  assert.equal((await fetch(`${server.base}/api/calendar/feed`)).status, 401);
});

test('a progress report covers the plan, and its share link is live, read-only and revocable', async () => {
  const cookie = await signUp();
  const project = await (await fetch(`${server.base}/api/projects/from-template`, authed(cookie, 'POST', { templateId: 'event' }))).json();
  const data = await (await fetch(`${server.base}/api/reports/projects/${project.id}/progress`, authed(cookie))).json();
  assert.equal(data.project.title, 'Plan an event');
  assert.equal(data.phases.length, 3);
  assert.equal(data.total, data.phases.reduce((n, p) => n + p.total, 0));
  assert.ok(data.waiting.length > 0, 'template dependencies show as waiting tasks');
  assert.match(data.summary, /0% complete/);

  const html = await (await fetch(`${server.base}/api/reports/projects/${project.id}/progress.html`, authed(cookie))).text();
  assert.match(html, /Progress report/);
  assert.match(html, /Plan an event/);

  // other people can't read it, and there's no link until one is made
  const stranger = await signUp();
  assert.equal((await fetch(`${server.base}/api/reports/projects/${project.id}/progress.html`, authed(stranger))).status, 404);
  assert.equal((await (await fetch(`${server.base}/api/reports/projects/${project.id}/share`, authed(cookie))).json()).url, null);

  const { url } = await (await fetch(`${server.base}/api/reports/projects/${project.id}/share`, authed(cookie, 'POST'))).json();
  const path = new URL(url).pathname;
  assert.match(path, /^\/r\/[A-Za-z0-9_-]{20,}$/);
  const pub = await fetch(`${server.base}${path}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('x-robots-tag'), 'noindex');
  assert.match(await pub.text(), /updates itself whenever the plan changes/);

  await fetch(`${server.base}/api/reports/projects/${project.id}/share`, authed(cookie, 'DELETE'));
  assert.equal((await fetch(`${server.base}${path}`)).status, 404);
});

test('game rewards: early finishes earn a bonus, a blocker pays once, and daily quests track real progress', async () => {
  const cookie = await signUp();
  const project = await (await fetch(`${server.base}/api/projects`, authed(cookie, 'POST', { title: 'Game test' }))).json();
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const task = await (await fetch(`${server.base}/api/tasks`, authed(cookie, 'POST', { projectId: project.id, title: 'Early one', priority: 'Medium', endDate: future }))).json();
  const blocker = await (await fetch(`${server.base}/api/tasks/${task.id}/obstacles`, authed(cookie, 'POST', { name: 'Waiting on a reply', count: 2 }))).json();

  // a blocker pays XP the first time it's beaten, never again
  const beat = await (await fetch(`${server.base}/api/tasks/obstacles/${blocker.id}`, authed(cookie, 'PUT', { resolved: true }))).json();
  assert.equal(beat.journeyReward.xpAwarded >= 10, true);
  assert.ok(beat.journeyReward.newAchievements.some(a => a.code === 'blocker_1'));
  await fetch(`${server.base}/api/tasks/obstacles/${blocker.id}`, authed(cookie, 'PUT', { resolved: false }));
  const again = await (await fetch(`${server.base}/api/tasks/obstacles/${blocker.id}`, authed(cookie, 'PUT', { resolved: true }))).json();
  assert.equal(again.journeyReward, null);

  // finishing before the due date earns the early bonus and badge
  const done = await (await fetch(`${server.base}/api/tasks/${task.id}`, authed(cookie, 'PUT', { status: 'Completed' }))).json();
  assert.equal(done.journeyReward.early, true);
  assert.ok(done.journeyReward.xpAwarded >= 15);
  assert.ok(done.journeyReward.newAchievements.some(a => a.code === 'early_1'));
  assert.ok(done.journeyReward.rank && done.journeyReward.rank.name);

  const me = await (await fetch(`${server.base}/api/journey-gaming/me`, authed(cookie))).json();
  assert.equal(me.daily.quests.length, 3);
  assert.equal(me.daily.quests[0].code, 'finish1');
  assert.equal(me.daily.quests[0].done, true);
  assert.equal(me.blockersBeaten, 1);
  assert.ok(me.achievements.length >= 20);
  assert.equal(me.rank.name, 'Rookie');
});

test('inviting someone without an account holds the invite until they sign up with that email', async () => {
  const owner = await signUpVerified();
  const project = await (await fetch(`${server.base}/api/projects`, authed(owner, 'POST', { title: 'Shared plan' }))).json();
  const newcomer = uniqueEmail();

  const res = await fetch(`${server.base}/api/projects/${project.id}/collaborators`, authed(owner, 'POST', { email: newcomer, role: 'commenter' }));
  assert.equal(res.status, 201);
  const invite = await res.json();
  assert.equal(invite.pendingSignup, true);
  assert.match(invite.joinUrl, /\/app\?join=/);
  // a second invite to the same email is refused, and it shows in the list
  assert.equal((await fetch(`${server.base}/api/projects/${project.id}/collaborators`, authed(owner, 'POST', { email: newcomer, role: 'viewer' }))).status, 400);
  const people = await (await fetch(`${server.base}/api/projects/${project.id}/collaborators`, authed(owner))).json();
  assert.ok(people.some(p => p.email === newcomer && p.pendingSignup));
  assert.equal((await fetch(`${server.base}/api/projects/${project.id}/collaborators`, authed(owner, 'POST', { email: 'not-an-email', role: 'viewer' }))).status, 400);

  // signing up with that email brings the invite in, ready to accept
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: newcomer, password: 'testpass123', acceptTerms: true }));
  const cookie = sessionCookie(reg);
  const invites = await (await fetch(`${server.base}/api/projects/invites`, authed(cookie))).json();
  assert.ok(invites.some(i => i.projectId === project.id));
  const after = await (await fetch(`${server.base}/api/projects/${project.id}/collaborators`, authed(owner))).json();
  assert.ok(!after.some(p => p.pendingSignup));

  // an owner can cancel a waiting invite
  const other = uniqueEmail();
  await fetch(`${server.base}/api/projects/${project.id}/collaborators`, authed(owner, 'POST', { email: other, role: 'viewer' }));
  assert.equal((await fetch(`${server.base}/api/projects/${project.id}/email-invites`, authed(owner, 'DELETE', { email: other }))).status, 200);
  const final = await (await fetch(`${server.base}/api/projects/${project.id}/collaborators`, authed(owner))).json();
  assert.ok(!final.some(p => p.email === other));
});

test('two-step sign-in: set up, sign in with a code (no replays), recovery codes, and turn off', async () => {
  const twofactor = require('../backend/twofactor');
  const email = uniqueEmail();
  const cookie = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email, password: 'testpass123', acceptTerms: true })));
  const setup = await (await fetch(`${server.base}/api/auth/2fa/setup`, authed(cookie, 'POST'))).json();
  assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\/Waypoint/);
  assert.match(setup.qrSvg, /<svg/);
  assert.equal((await fetch(`${server.base}/api/auth/2fa/enable`, authed(cookie, 'POST', { code: '000000' }))).status, 400);
  const enabled = await (await fetch(`${server.base}/api/auth/2fa/enable`, authed(cookie, 'POST', { code: twofactor.codeForStep(setup.secret, twofactor.stepAt()) }))).json();
  assert.equal(enabled.recoveryCodes.length, 10);

  // the password alone no longer signs in
  const login = await fetch(`${server.base}/api/auth/login`, json({ email, password: 'testpass123' }));
  assert.deepEqual(await login.json(), { twoFactorRequired: true });
  const pending = sessionCookie(login);
  assert.equal((await fetch(`${server.base}/api/projects`, authed(pending))).status, 401);
  assert.equal((await fetch(`${server.base}/api/auth/2fa/verify`, authed(pending, 'POST', { code: '123456' }))).status, 401);
  // the code used to enable can't be replayed; a recovery code works once
  const replay = await fetch(`${server.base}/api/auth/2fa/verify`, authed(pending, 'POST', { code: twofactor.codeForStep(setup.secret, twofactor.stepAt()) }));
  assert.equal(replay.status, 401);
  const ok = await fetch(`${server.base}/api/auth/2fa/verify`, authed(pending, 'POST', { code: enabled.recoveryCodes[0] }));
  assert.equal(ok.status, 200);
  const signedIn = sessionCookie(ok);
  assert.equal((await fetch(`${server.base}/api/projects`, authed(signedIn))).status, 200);
  const status = await (await fetch(`${server.base}/api/auth/2fa/status`, authed(signedIn))).json();
  assert.deepEqual([status.enabled, status.recoveryCodesLeft], [true, 9]);

  const login2 = await fetch(`${server.base}/api/auth/login`, json({ email, password: 'testpass123' }));
  const reused = await fetch(`${server.base}/api/auth/2fa/verify`, authed(sessionCookie(login2), 'POST', { code: enabled.recoveryCodes[0] }));
  assert.equal(reused.status, 401, 'a recovery code works only once');

  // turning it off needs the password and a code
  assert.equal((await fetch(`${server.base}/api/auth/2fa/disable`, authed(signedIn, 'POST', { password: 'wrong', code: enabled.recoveryCodes[1] }))).status, 401);
  assert.equal((await fetch(`${server.base}/api/auth/2fa/disable`, authed(signedIn, 'POST', { password: 'testpass123', code: enabled.recoveryCodes[1] }))).status, 200);
  const plain = await (await fetch(`${server.base}/api/auth/login`, json({ email, password: 'testpass123' }))).json();
  assert.equal(plain.email, email);
});

test('a task can carry an action: kept clean, read back, and https-only for links', async () => {
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const cookie = sessionCookie(reg);
  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Actions' }, cookie))).json();
  const put = (id, body) => fetch(`${server.base}/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const created = await (await fetch(`${server.base}/api/tasks`, json({ projectId: project.id, title: 'Email the recruiter', status: 'Not Started', priority: 'Medium', action: { type: 'email', to: 'jo@nhs.net', subject: 'Band 5 role', junk: 'x' } }, cookie))).json();
  assert.deepEqual(created.action, { type: 'email', to: 'jo@nhs.net', subject: 'Band 5 role' }, 'unknown fields are dropped');
  const edited = await (await put(created.id, { action: { type: 'whatsapp', phone: '+44 7700 900123', body: 'Hi Tunde' } })).json();
  assert.equal(edited.action.type, 'whatsapp');
  const kept = await (await put(created.id, { notes: 'unrelated edit' })).json();
  assert.equal(kept.action.phone, '+44 7700 900123', 'an edit that does not mention the action keeps it');
  assert.equal((await put(created.id, { action: { type: 'link', url: 'javascript:alert(1)' } })).status, 400, 'links must be https');
  assert.equal((await put(created.id, { action: { type: 'teleport' } })).status, 400, 'unknown kinds are refused');
  const cleared = await (await put(created.id, { action: null })).json();
  assert.equal(cleared.action, null);
});

test('a new email sign-up confirms its address before it can invite anyone', async () => {
  const email = uniqueEmail();
  const cookie = sessionCookie(await fetch(`${server.base}/api/auth/register`, json({ email, password: 'testpass123', acceptTerms: true })));
  const me = async () => (await fetch(`${server.base}/api/auth/me`, { headers: { Cookie: cookie } })).json();
  assert.equal((await me()).emailVerified, false);

  const project = await (await fetch(`${server.base}/api/projects`, json({ title: 'Mine' }, cookie))).json();
  const blocked = await fetch(`${server.base}/api/projects/${project.id}/collaborators`, json({ email: uniqueEmail(), role: 'viewer' }, cookie));
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'email_unverified');

  // a resend makes a new link; the old one stops working
  const first = await server.verifyTokenFor(email);
  assert.equal((await fetch(`${server.base}/api/auth/resend-verification`, json({}, cookie))).status, 200);
  let second = first;
  for (let i = 0; i < 40 && second === first; i++) { await new Promise(r => setTimeout(r, 50)); second = await server.verifyTokenFor(email); }
  assert.notEqual(second, first);
  assert.equal((await fetch(`${server.base}/api/auth/verify-email`, json({ token: first }))).status, 400);
  assert.equal((await fetch(`${server.base}/api/auth/verify-email`, json({ token: second }))).status, 200);
  assert.equal((await me()).emailVerified, true);
  // used once only
  assert.equal((await fetch(`${server.base}/api/auth/verify-email`, json({ token: second }))).status, 400);

  const ok = await fetch(`${server.base}/api/projects/${project.id}/collaborators`, json({ email: uniqueEmail(), role: 'viewer' }, cookie));
  assert.equal(ok.status, 201);
});

test('a problem report is saved, needs some words, and only the owner can list them', async () => {
  const cookie = await signUp();
  const send = body => fetch(`${server.base}/api/feedback`, authed(cookie, 'POST', body));
  assert.equal((await send({ message: ' ' })).status, 400);
  assert.equal((await send({ message: 'x'.repeat(4001) })).status, 400);
  assert.equal((await send({ message: 'The road did not move when I ticked a task', page: 'dashboard /app' })).status, 201);
  // signed out: no
  assert.equal((await fetch(`${server.base}/api/feedback`, json({ message: 'hello there' }))).status, 401);
  // someone who isn't the owner can't read them
  assert.equal((await fetch(`${server.base}/api/admin/feedback`, authed(cookie))).status, 404);
});
