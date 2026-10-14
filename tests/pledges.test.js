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
  assert.match(managePage, /Earned! Check and release it/);
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

test('a held gift stays hidden until the pledger checks and releases it; cash details reach only them; they share a thread', async () => {
  const api = await signUp();
  const { p, tasks } = await goal(api, 1);
  const token = (await api('POST', '/pledges/link', { projectId: p.id })).body.link.split('/p/')[1];

  // A gift link must be a web address.
  const bad = await post(`/p/${token}`, { name: 'Gran', reward: 'Cinema trip', giftLink: 'javascript:alert(1)' });
  assert.equal(bad.status, 400);

  const res = await post(`/p/${token}`, { name: 'Gran', relation: 'family', reward: 'Cinema trip', giftCode: 'ODEON-7F3K', giftLink: 'https://example.com/ticket', giftNote: 'Screen 3, Saturday' });
  const manage = res.headers.get('location').split('?')[0];
  const cash = await post(`/p/${token}`, { name: 'Uncle Tunde', relation: 'family', currency: 'GBP', amount: '30' });
  const cashManage = cash.headers.get('location').split('?')[0];

  let mine = (await api('GET', `/pledges?projectId=${p.id}`)).body.pledges;
  const gift = mine.find(x => x.name === 'Gran');
  const money = mine.find(x => x.name === 'Uncle Tunde');
  assert.equal(gift.held, true);
  assert.equal(gift.gift, null, 'the gift is hidden before release');
  assert.ok(!JSON.stringify(mine).includes('ODEON'), 'the code never reaches the owner early');

  // Not earned yet: no release, no pay-to.
  assert.equal((await api('PUT', `/pledges/${money.id}/pay-to`, { payTo: 'monzo.me/ada' })).status, 409);
  assert.equal((await api('POST', `/pledges/${gift.id}/ask-release`)).status, 400);
  // The pledger can't release before it's earned either.
  await post(`${manage}/given`, {});
  assert.equal((await api('GET', `/pledges?projectId=${p.id}`)).body.pledges.find(x => x.id === gift.id).status, 'pledged');

  await api('PUT', `/tasks/${tasks[0].id}`, { status: 'Completed' });

  // Cash: say how to send it; only the uncle's page shows it.
  assert.equal((await api('PUT', `/pledges/${money.id}/pay-to`, { payTo: 'https://monzo.me/ada' })).status, 200);
  assert.match(await (await fetch(`${server.base}${cashManage}`)).text(), /monzo\.me\/ada/);
  assert.doesNotMatch(await (await fetch(`${server.base}${manage}`)).text(), /monzo\.me\/ada/);

  // Ask Gran to release: a line in the thread; she replies; she sees the steps.
  assert.equal((await api('POST', `/pledges/${gift.id}/ask-release`)).status, 200);
  assert.equal((await api('POST', `/pledges/${gift.id}/ask-release`)).status, 400, 'once in a while, not repeatedly');
  await post(`${manage}/say`, { text: 'Well done! Enjoy the film' });
  const thread = (await api('GET', `/pledges/${gift.id}/messages`)).body;
  assert.equal(thread.length, 2);
  assert.equal(thread[0].fromOwner, true);
  assert.equal(thread[1].text, 'Well done! Enjoy the film');
  assert.equal((await api('POST', `/pledges/${gift.id}/messages`, { text: 'Thank you Gran!' })).status, 201);
  const page = await (await fetch(`${server.base}${manage}`)).text();
  assert.match(page, /Thank you Gran!/);
  assert.match(page, /Step 1/);
  assert.match(page, /Release the gift/);

  // Released: the gift shows, then the owner marks it received.
  await post(`${manage}/given`, {});
  mine = (await api('GET', `/pledges?projectId=${p.id}`)).body.pledges;
  const out = mine.find(x => x.id === gift.id);
  assert.equal(out.status, 'given');
  assert.deepEqual(out.gift, { code: 'ODEON-7F3K', link: 'https://example.com/ticket', note: 'Screen 3, Saturday' });
  assert.equal(out.receivedAt, null);
  await api('PUT', `/pledges/${gift.id}/received`);
  assert.ok((await api('GET', `/pledges?projectId=${p.id}`)).body.pledges.find(x => x.id === gift.id).receivedAt);

  // Another person's pledge thread is not yours.
  const other = await signUp();
  assert.equal((await other('GET', `/pledges/${gift.id}/messages`)).status, 404);
});

test('the bell tells the owner about a new pledge, an earned one, a release and a message', async () => {
  const api = await signUp();
  const { p, tasks } = await goal(api, 1);
  const token = (await api('POST', '/pledges/link', { projectId: p.id })).body.link.split('/p/')[1];
  await api('POST', '/notifications/read');
  const res = await post(`/p/${token}`, { name: 'Aunt Bisi', reward: 'Concert tickets', giftCode: 'TIX-42' });
  const manage = res.headers.get('location').split('?')[0];
  let bell = (await api('GET', '/notifications')).body.rewardActivity;
  assert.ok(bell.some(a => a.kind === 'pledged' && /Aunt Bisi pledged Concert tickets for “Run a marathon”/.test(a.text)));
  await api('PUT', `/tasks/${tasks[0].id}`, { status: 'Completed' });
  await post(`${manage}/say`, { text: 'Brilliant!' });
  await post(`${manage}/given`, {});
  bell = (await api('GET', '/notifications')).body.rewardActivity;
  assert.ok(bell.some(a => a.kind === 'earned'));
  assert.ok(bell.some(a => a.kind === 'released' && /Your gift is waiting/.test(a.text)));
  assert.ok(bell.some(a => a.kind === 'message' && /Aunt Bisi sent you a message/.test(a.text)));
});
