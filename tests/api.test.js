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
  assert.match(html, /Turns a vague goal into a plan/);
});

test('/app always serves the application shell', async () => {
  const html = await (await fetch(`${server.base}/app`)).text();
  assert.match(html, /id="auth-overlay"/);
});

test('signed-in users get the application at /', async () => {
  const reg = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const html = await (await fetch(`${server.base}/`, { headers: { Cookie: sessionCookie(reg) } })).text();
  assert.match(html, /id="auth-overlay"/);
  assert.doesNotMatch(html, /Turns a vague goal into a plan/);
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
  const res = await fetch(`${server.base}/api/ai/insights`, json({}));
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

test('a viewer cannot post a status update, but can still read them', async () => {
  const owner = await fetch(`${server.base}/api/auth/register`, json({ email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
  const ownerCookie = sessionCookie(owner);
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
