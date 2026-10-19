const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// The Chats badge in the menu counts team and race chat messages too
// (backend/challenges.js unreadChats), and drops once that chat is read.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `cb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));

test('unread team chat messages count towards the Chats badge until read', async () => {
  const ada = await signUp(), liam = await signUp();
  const goal = await json(ada, 'POST', '/api/projects', { title: 'Launch', isGoal: true });
  await json(ada, 'POST', '/api/tasks', { projectId: goal.id, title: 'Step one', status: 'Not Started', priority: 'Medium' });
  const team = await json(ada, 'POST', '/api/challenges', { projectId: goal.id, endsAt: new Date(Date.now() + 30 * 86400000).toISOString(), mode: 'split', leaderRole: 'manager', displayName: 'Ada' });
  await call(liam, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Liam' });
  await json(ada, 'GET', `/api/challenges/${team.id}/messages`); // Ada has read up to now (Liam joining)
  const unread = async who => (await json(who, 'GET', '/api/notifications')).teamChatUnread;
  assert.equal(await unread(ada), 0);

  await call(liam, 'POST', `/api/challenges/${team.id}/messages`, { text: 'Morning! Starting on step one' });
  await call(liam, 'POST', `/api/challenges/${team.id}/messages`, { text: 'Done by lunch' });
  assert.equal(await unread(ada), 2);
  assert.equal(await unread(liam), 0, "your own messages don't count");

  // opening the bell doesn't read a team chat; opening the chat does
  await call(ada, 'POST', '/api/notifications/read');
  assert.equal(await unread(ada), 2);
  await json(ada, 'GET', `/api/challenges/${team.id}/messages`);
  assert.equal(await unread(ada), 0);
});
