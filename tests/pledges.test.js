const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

async function signUp() {
  const res = await fetch(`${server.base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`, password: 'testpass123', acceptTerms: true }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const api = async (method, path, body) => {
    const r = await fetch(`${server.base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  await api('PUT', '/profile', { name: 'Ada Lovelace', onboarded: true });
  return api;
}
async function goal(api, n = 2) {
  const p = (await api('POST', '/projects', { title: 'Run a marathon', isGoal: true })).body;
  const tasks = [];
  for (let i = 0; i < n; i++) tasks.push((await api('POST', '/tasks', { projectId: p.id, title: `Step ${i + 1}`, status: 'Not Started', priority: 'Medium' })).body);
  return { p, tasks };
}
const form = obj => new URLSearchParams(obj).toString();
const post = (path, obj) => fetch(`${server.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(obj), redirect: 'manual' });

test('someone pledges by link without an account; finishing the goal earns it; they mark it given', async () => {
  const api = await signUp();
  const { p, tasks } = await goal(api);
  const { link } = (await api('POST', '/pledges/link', { projectId: p.id })).body;
  const token = link.split('/p/')[1];

  const page = await (await fetch(`${server.base}/p/${token}`)).text();
  assert.match(page, /Run a marathon/);
  assert.match(page, /Ada is working on/);

  const res = await post(`/p/${token}`, { name: 'Mum', relation: 'parent', currency: 'GBP', amount: '50', reward: 'Dinner out', condition: 'finish', message: 'So proud of you', email: 'mum@example.com' });
  assert.equal(res.status, 303);
  const manage = res.headers.get('location');
  assert.match(manage, /^\/p\/m\/[\w-]+\?new=1$/);

  let mine = (await api('GET', `/pledges?projectId=${p.id}`)).body;
  assert.equal(mine.pledges.length, 1);
  assert.equal(mine.pledges[0].text, '£50 and Dinner out');
  assert.equal(mine.pledges[0].status, 'pledged');
  assert.equal(mine.pledges[0].email, undefined, "the owner never sees the pledger's email");
  assert.equal(mine.pledges[0].notified, true);

  // Not earned until every step is done
  const first = await api('PUT', `/tasks/${tasks[0].id}`, { status: 'Completed' });
  assert.equal(first.body.rewardsEarned, 0);
  const last = await api('PUT', `/tasks/${tasks[1].id}`, { status: 'Completed' });
  assert.equal(last.body.rewardsEarned, 1);
  mine = (await api('GET', `/pledges?projectId=${p.id}`)).body;
  assert.equal(mine.pledges[0].status, 'earned');

  const managePage = await (await fetch(`${server.base}${manage.split('?')[0]}`)).text();
  assert.match(managePage, /Earned! Time to give it/);
  const given = await post(`${manage.split('?')[0]}/given`, {});
  assert.equal(given.status, 303);
  mine = (await api('GET', `/pledges?projectId=${p.id}`)).body;
  assert.equal(mine.pledges[0].status, 'given');
});

test('a pledge needs a reward and a name, and the form says what is missing', async () => {
  const api = await signUp();
  const { p } = await goal(api);
  const token = (await api('POST', '/pledges/link', { projectId: p.id })).body.link.split('/p/')[1];
  const noReward = await post(`/p/${token}`, { name: 'Boss' });
  assert.equal(noReward.status, 400);
  assert.match(await noReward.text(), /Say what the reward is/);
  const noName = await post(`/p/${token}`, { reward: 'A day off' });
  assert.match(await noName.text(), /Add your name/);
  assert.equal((await api('GET', `/pledges?projectId=${p.id}`)).body.pledges.length, 0);
});

test('only the goal owner sees pledges; turning the link off stops new pledges', async () => {
  const owner = await signUp();
  const other = await signUp();
  const { p } = await goal(owner);
  assert.equal((await other('GET', `/pledges?projectId=${p.id}`)).status, 404);
  assert.equal((await other('POST', '/pledges/link', { projectId: p.id })).status, 404);
  const token = (await owner('POST', '/pledges/link', { projectId: p.id })).body.link.split('/p/')[1];
  await owner('DELETE', `/pledges/link/${p.id}`);
  assert.equal((await fetch(`${server.base}/p/${token}`)).status, 404);
  assert.equal((await post(`/p/${token}`, { name: 'X', reward: 'Y' })).status, 404);
  // The owner can still add one themselves, and remove it
  const mine = await owner('POST', '/pledges', { projectId: p.id, name: 'My manager', relation: 'boss', reward: 'A day off' });
  assert.equal(mine.status, 201);
  assert.equal(mine.body.source, 'owner');
  assert.equal((await other('DELETE', `/pledges/${mine.body.id}`)).status, 404);
  assert.equal((await owner('DELETE', `/pledges/${mine.body.id}`)).status, 200);
});
