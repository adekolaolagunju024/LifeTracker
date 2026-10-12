const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'owner_features@example.com';
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

async function signUp(email) {
  const res = await fetch(`${server.base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'testpass123', acceptTerms: true }) });
  return (res.headers.get('set-cookie') || '').split(';')[0];
}
const use = (cookie, feature) => fetch(`${server.base}/api/admin/feature`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ feature }) });

test('feature use is counted once a day per person, and only for known features', async () => {
  const owner = await signUp('owner_features@example.com');
  const a = await signUp(`fa_${Date.now()}@example.com`);
  for (let i = 0; i < 3; i++) assert.equal((await use(a, 'start_day')).status, 200);
  await use(owner, 'start_day');
  await use(a, 'music');
  await use(a, 'definitely_not_a_feature');

  const m = await (await fetch(`${server.base}/api/admin/metrics`, { headers: { Cookie: owner } })).json();
  const by = Object.fromEntries(m.features.map(f => [f.key, f]));
  assert.equal(by.start_day.people, 2, 'two people, however many times');
  assert.equal(by.music.people, 1);
  assert.equal(by.pledges.people, 0);
  assert.ok(!('definitely_not_a_feature' in by));
  assert.equal(m.features[0].key, 'start_day', 'most used first');
  assert.equal((await fetch(`${server.base}/api/admin/metrics`, { headers: { Cookie: a } })).status, 404, 'only the owner sees it');
});
