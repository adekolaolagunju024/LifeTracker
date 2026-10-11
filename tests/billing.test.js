const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const dbFile = path.join(os.tmpdir(), `waypoint-billing-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');
const billing = require('../backend/billing');

const now = () => new Date().toISOString();
const user = () => db.createUser({ id: randomUUID(), email: `b_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: now(), acceptedTermsAt: now() });
const SECRET = 'whsec_test';
const sign = (body, t = Math.floor(Date.now() / 1000), secret = SECRET) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const conn = require('../backend/db/connection');

after(() => {
  conn.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
});

test('a webhook is only trusted with a valid, recent Stripe signature', () => {
  const body = JSON.stringify({ type: 'ping', data: { object: {} } });
  assert.equal(billing.verifyWebhook(body, sign(body), SECRET).type, 'ping');
  assert.throws(() => billing.verifyWebhook(body, sign(body, undefined, 'whsec_other'), SECRET), /does not match/);
  assert.throws(() => billing.verifyWebhook(body + ' ', sign(body), SECRET), /does not match/);
  assert.throws(() => billing.verifyWebhook(body, sign(body, Math.floor(Date.now() / 1000) - 3600), SECRET), /too old/);
  assert.throws(() => billing.verifyWebhook(body, '', SECRET), /Missing/);
});

test('checkout links the customer, and the subscription decides the plan', async () => {
  const u = user();
  assert.equal(billing.getPlan(u.id).plan, 'free');
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  await billing.handleEvent({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: u.id, customer: 'cus_1', subscription: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: end, cancel_at_period_end: false } } } });
  let p = billing.getPlan(u.id);
  assert.equal(p.plan, 'pro');
  assert.equal(p.status, 'active');
  assert.equal(new Date(p.renewsAt).getTime(), end * 1000);
  // Cancelling at period end keeps Pro until then.
  await billing.handleEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: end, cancel_at_period_end: true } } });
  p = billing.getPlan(u.id);
  assert.equal(p.plan, 'pro');
  assert.equal(p.cancelAtPeriodEnd, true);
  // A failing card keeps Pro while Stripe retries; ending it returns to Free.
  await billing.handleEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due' } } });
  assert.equal(billing.getPlan(u.id).plan, 'pro');
  await billing.handleEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } });
  assert.equal(billing.getPlan(u.id).plan, 'free');
});

test('an event for an unknown customer changes nobody', async () => {
  const u = user();
  await billing.handleEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_x', customer: 'cus_nobody', status: 'active' } } });
  assert.equal(billing.getPlan(u.id).plan, 'free');
});

test('Pro has ten times the daily AI allowance', () => {
  const free = user(), pro = user();
  conn.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").run(pro.id);
  let n = 0; while (db.consumeAiQuota(free.id) && n < 500) n++;
  let m = 0; while (db.consumeAiQuota(pro.id) && m < 500) m++;
  assert.equal(n, 15);
  assert.equal(m, 150);
});

test('without Stripe keys, nothing is for sale', () => {
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(billing.isConfigured(), false);
});
