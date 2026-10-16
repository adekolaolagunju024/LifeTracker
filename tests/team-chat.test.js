const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

// The team chat as a normal chat: photos and files, @mentions (in the
// person's bell), emojis.
let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const json = async (...a) => (await call(...a)).json();
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`, password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d30000000049454e44ae426082', 'hex');
const uploadTo = async (cookie, projectId) => {
  const form = new FormData();
  form.append('projectId', projectId);
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'plan.png');
  return (await fetch(`${server.base}/api/uploads`, { method: 'POST', headers: { Cookie: cookie }, body: form })).json();
};

test('team chat: share a photo, @mention someone (it lands in their bell), and emojis go through', async () => {
  const sam = await signUp();
  const ana = await signUp();
  const goal = await json(sam, 'POST', '/api/projects', { title: 'Kitchen refit', isGoal: true });
  await json(sam, 'POST', '/api/tasks', { projectId: goal.id, title: 'Measure up', status: 'Not Started', priority: 'Medium' });
  const team = await json(sam, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(14), mode: 'split', leaderRole: 'manager', displayName: 'Sam' });
  const joined = await json(ana, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ana' });

  // A photo, with no text needed.
  const photo = await uploadTo(ana, joined.projectId);
  assert.equal((await call(ana, 'POST', `/api/challenges/${team.id}/messages`, { attachmentId: photo.id })).status, 201);
  let msgs = await json(sam, 'GET', `/api/challenges/${team.id}/messages`);
  const shared = msgs.find(m => m.file && m.file.id === photo.id);
  assert.ok(shared, 'the photo is in the chat');
  assert.equal((await call(sam, 'GET', `/api/challenges/${team.id}/proof-file/${photo.id}`)).status, 200, 'and the team can open it');
  // Someone else's file can't be passed off as yours.
  assert.equal((await call(sam, 'POST', `/api/challenges/${team.id}/messages`, { attachmentId: photo.id })).status, 400);

  // An @mention, with an emoji: in Ana's bell.
  await call(ana, 'POST', '/api/notifications/read');
  await new Promise(r => setTimeout(r, 15));
  assert.equal((await call(sam, 'POST', `/api/challenges/${team.id}/messages`, { text: '@Ana great photo 🙌 can you order the units?' })).status, 201);
  msgs = await json(ana, 'GET', `/api/challenges/${team.id}/messages`);
  assert.ok(msgs.some(m => m.text === '@Ana great photo 🙌 can you order the units?'));
  const bell = (await json(ana, 'GET', '/api/notifications')).teamActivity || [];
  assert.ok(bell.some(a => a.kind === 'mention' && /mentioned you/.test(a.text)), JSON.stringify(bell));
  // An empty message still isn't one.
  assert.equal((await call(sam, 'POST', `/api/challenges/${team.id}/messages`, { text: '   ' })).status, 400);
});

test('team chat: everyone can see who leads, and a message about a task links to it for whoever can open it', async () => {
  const sam = await signUp();
  const ana = await signUp();
  const outsider = await signUp();
  const goal = await json(sam, 'POST', '/api/projects', { title: 'Wedding', isGoal: true });
  const venue = await json(sam, 'POST', '/api/tasks', { projectId: goal.id, title: 'Book the venue', status: 'Not Started', priority: 'Medium' });
  const invites = await json(sam, 'POST', '/api/tasks', { projectId: goal.id, title: 'Send invitations', status: 'Not Started', priority: 'Medium' });
  const team = await json(sam, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(14), mode: 'split', leaderRole: 'manager', displayName: 'Sam' });
  await json(ana, 'POST', `/api/challenges/join/${team.joinToken}`, { displayName: 'Ana' });

  // Ana sees who runs it, on the team and in the list.
  const seen = await json(ana, 'GET', `/api/challenges/${team.id}`);
  assert.equal(seen.leaderName, 'Sam');
  assert.ok(seen.players.some(p => p.lead && p.name === 'Sam'), 'the leader is marked among the players');
  assert.ok(!seen.players.find(p => p.you).lead);
  assert.equal((await json(sam, 'GET', `/api/challenges/${team.id}`)).leaderName, 'You');

  // Sam hands Ana a step: the line in the chat opens it for Ana.
  const anaColor = seen.players.find(p => p.you).color;
  assert.equal((await call(sam, 'POST', `/api/challenges/${team.id}/assign`, { taskId: invites.id, color: anaColor })).status, 200);
  let msgs = await json(ana, 'GET', `/api/challenges/${team.id}/messages`);
  const handed = msgs.find(m => m.task && m.task.title === 'Send invitations');
  assert.ok(handed, JSON.stringify(msgs));
  assert.equal(handed.task.id, invites.id, 'Ana can open her own step from the chat');
  // Sam's messages carry the leader mark.
  await call(sam, 'POST', `/api/challenges/${team.id}/messages`, { text: 'Thanks all' });
  msgs = await json(ana, 'GET', `/api/challenges/${team.id}/messages`);
  assert.ok(msgs.find(m => m.text === 'Thanks all').leader);

  // Ana asks about Sam's step (the one she waits on): it's linked, Sam can
  // open it, Ana sees its name only.
  await call(sam, 'POST', `/api/challenges/${team.id}/claim`, { taskId: venue.id });
  assert.equal((await call(ana, 'POST', `/api/challenges/${team.id}/messages`, { text: '@Sam how is the venue going?', taskId: venue.id })).status, 201);
  const forSam = (await json(sam, 'GET', `/api/challenges/${team.id}/messages`)).find(m => m.text === '@Sam how is the venue going?');
  assert.deepEqual(forSam.task, { id: venue.id, title: 'Book the venue', done: false });
  const forAna = (await json(ana, 'GET', `/api/challenges/${team.id}/messages`)).find(m => m.text === '@Sam how is the venue going?');
  assert.equal(forAna.task.id, null);
  assert.equal(forAna.task.title, 'Book the venue');
  // A task from outside the team can't be attached.
  const other = await json(outsider, 'POST', '/api/projects', { title: 'Mine', isGoal: true });
  const theirs = await json(outsider, 'POST', '/api/tasks', { projectId: other.id, title: 'Secret', status: 'Not Started', priority: 'Medium' });
  assert.equal((await call(ana, 'POST', `/api/challenges/${team.id}/messages`, { text: 'hi', taskId: theirs.id })).status, 404);
});
