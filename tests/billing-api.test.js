const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// The real server, with a webhook secret but no Stripe keys.
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_api_test';
delete process.env.STRIPE_SECRET_KEY;
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sign = body => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', 'whsec_api_test').update(`${t}.${body}`).digest('hex')}`; };
async function signUp() {
  const res = await fetch(`${server.base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `bill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`, password: 'testpass123', acceptTerms: true }) });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const me = await (await fetch(`${server.base}/api/auth/me`, { headers: { Cookie: cookie } })).json();
  return { cookie, id: me.id };
}

test('a signed Stripe webhook upgrades the person who checked out', async () => {
  const { cookie, id } = await signUp();
  let plan = await (await fetch(`${server.base}/api/billing`, { headers: { Cookie: cookie } })).json();
  assert.equal(plan.plan, 'free');
  assert.equal(plan.configured, false);
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: id, customer: 'cus_api', subscription: { id: 'sub_api', customer: 'cus_api', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30 } } } });
  const res = await fetch(`${server.base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(body) }, body });
  assert.equal(res.status, 200);
  plan = await (await fetch(`${server.base}/api/billing`, { headers: { Cookie: cookie } })).json();
  assert.equal(plan.plan, 'pro');
});

test('an unsigned or tampered webhook is refused and changes nothing', async () => {
  const { cookie, id } = await signUp();
  const body = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_evil', customer: 'cus_evil', status: 'active', metadata: { userId: id } } } });
  const unsigned = await fetch(`${server.base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(unsigned.status, 400);
  const tampered = await fetch(`${server.base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign('{}') }, body });
  assert.equal(tampered.status, 400);
  const plan = await (await fetch(`${server.base}/api/billing`, { headers: { Cookie: cookie } })).json();
  assert.equal(plan.plan, 'free');
});

test('without Stripe keys, checkout says payments are not set up', async () => {
  const { cookie } = await signUp();
  const res = await fetch(`${server.base}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ interval: 'month' }) });
  assert.equal(res.status, 503);
});
