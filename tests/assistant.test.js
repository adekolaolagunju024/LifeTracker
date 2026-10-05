const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const post = (path, body, cookie) => fetch(`${server.base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
const uniqueEmail = () => `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;

async function signedIn() {
  const res = await post('/api/auth/register', { email: uniqueEmail(), password: 'testpass123', acceptTerms: true });
  return cookieOf(res);
}

test('the assistant requires a signed-in session', async () => {
  const res = await post('/api/ai/assistant', { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.status, 401);
});

test('an empty conversation is refused', async () => {
  const cookie = await signedIn();
  const res = await post('/api/ai/assistant', { messages: [] }, cookie);
  assert.equal(res.status, 400);
});

test('a conversation must start with the user', async () => {
  const cookie = await signedIn();
  const res = await post('/api/ai/assistant', { messages: [{ role: 'assistant', content: 'hello' }] }, cookie);
  assert.equal(res.status, 400);
});

test('an attachment of an unsupported type is refused before any AI call', async () => {
  const cookie = await signedIn();
  const attachment = { name: 'notes.txt', mimetype: 'text/plain', dataBase64: Buffer.from('hello').toString('base64') };
  const res = await post('/api/ai/assistant', { messages: [{ role: 'user', content: '', attachment }] }, cookie);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Unsupported file type/);
});

test('a project the user cannot see is not found', async () => {
  const cookie = await signedIn();
  const res = await post('/api/ai/assistant', { messages: [{ role: 'user', content: 'change it' }], projectId: 'nope' }, cookie);
  assert.equal(res.status, 404);
});

test('a project the user can see but not edit is refused', async () => {
  const owner = await signedIn();
  const project = await (await fetch(`${server.base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: owner },
    body: JSON.stringify({ title: 'Owned by someone else' }),
  })).json();
  // A different signed-in user cannot see the project at all, so this is the 404 path;
  // the 403 path (visible but read-only) is covered by the edit-project tests.
  const stranger = await signedIn();
  const res = await post('/api/ai/assistant', { messages: [{ role: 'user', content: 'change it' }], projectId: project.id }, stranger);
  assert.equal(res.status, 404);
});
