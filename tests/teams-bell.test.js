const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const uniqueEmail = () => `race_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

// The notification bell for races and groups (a file of its own: each test
// server allows 30 sign-ups an hour).
async function goalWithTasks(cookie, titles) {
  const p = await (await call(cookie, 'POST', '/api/projects', { title: 'Run 5k', isGoal: true })).json();
  for (const title of titles) await call(cookie, 'POST', '/api/tasks', { projectId: p.id, title, status: 'Not Started', priority: 'Medium' });
  return p;
}
const tasksOf = async (cookie, projectId) => (await (await call(cookie, 'GET', '/api/tasks')).json()).filter(t => t.projectId === projectId);

test('the bell: steps waiting for the leader, a step sent back, help asked and offered, cheers', async () => {
  const coach = await signUp();
  const kid = await signUp();
  const pal = await signUp();
  const goal = await goalWithTasks(coach, ['Drill', 'Run']);
  const g = await (await call(coach, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(14), mode: 'together', organiserOnly: true, leaderRole: 'coach' })).json();
  const kidCopy = (await (await call(kid, 'POST', `/api/challenges/join/${g.joinToken}`, { displayName: 'Kai' })).json()).projectId;
  await call(pal, 'POST', `/api/challenges/join/${g.joinToken}`, { displayName: 'Mia' });
  for (const who of [coach, kid, pal]) await call(who, 'POST', '/api/notifications/read');
  const bell = async who => (await (await call(who, 'GET', '/api/notifications')).json()).teamActivity;

  const [drill, run] = await tasksOf(kid, kidCopy);
  await call(kid, 'PUT', `/api/tasks/${drill.id}`, { status: 'Completed' });
  const forCoach = await bell(coach);
  assert.ok(forCoach.some(a => a.kind === 'review' && /1 step waiting for your sign-off/.test(a.text)), JSON.stringify(forCoach));

  const color = (await (await call(coach, 'GET', `/api/challenges/${g.id}`)).json()).reviews[0].color;
  await call(coach, 'POST', `/api/challenges/${g.id}/review`, { color, taskId: drill.id, decision: 'reject', note: 'Show a video' });
  let forKid = await bell(kid);
  assert.ok(forKid.some(a => a.kind === 'sentback' && /sent back “Drill”: Show a video/.test(a.text)), JSON.stringify(forKid));

  const ob = await (await call(kid, 'POST', `/api/tasks/${run.id}/obstacles`, { name: 'Sore knee', count: 1 })).json();
  await call(kid, 'POST', `/api/challenges/${g.id}/help`, { obstacleId: ob.id });
  const forPal = await bell(pal);
  assert.ok(forPal.some(a => a.kind === 'help' && /Kai is stuck on “Sore knee”/.test(a.text)), JSON.stringify(forPal));
  const help = (await (await call(pal, 'GET', `/api/challenges/${g.id}/messages`)).json()).find(m => m.kind === 'help');
  await call(pal, 'POST', `/api/challenges/${g.id}/help/${help.id}/offer`);
  await call(pal, 'POST', `/api/challenges/${g.id}/cheer`, { color: (await (await call(pal, 'GET', `/api/challenges/${g.id}`)).json()).players.find(p => p.name === 'Kai').color, emoji: '🔥' });
  forKid = await bell(kid);
  assert.ok(forKid.some(a => a.kind === 'offer' && /Mia can help with “Sore knee”/.test(a.text)), JSON.stringify(forKid));
  assert.ok(forKid.some(a => a.kind === 'cheer' && /Mia cheered you on 🔥/.test(a.text)));
  // Read: the bell empties.
  await call(kid, 'POST', '/api/notifications/read');
  assert.equal((await bell(kid)).length, 0);
});
