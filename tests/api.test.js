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
