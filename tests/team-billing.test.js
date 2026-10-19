const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const dbFile = path.join(os.tmpdir(), `kolaway-team-billing-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.STRIPE_SECRET_KEY = 'sk_test_team';
process.env.STRIPE_PRICE_TEAM = 'price_team';
const db = require('../backend/db/db');
const billing = require('../backend/billing');
const teamBilling = require('../backend/teamBilling');
require('../backend/challenges'); // its tables, for seating a Team up team
const conn = require('../backend/db/connection');

after(() => {
  conn.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
});

const now = () => new Date().toISOString();
const user = (email = `t_${randomUUID()}@example.com`) => db.createUser({ id: randomUUID(), email, passwordHash: 'x', createdAt: now(), acceptedTermsAt: now() });
// A stand-in for Stripe that records what it was asked.
function fakeStripe() {
  const calls = [];
  const stripe = async (method, p, body) => {
    calls.push({ method, path: p, body });
    if (p === '/checkout/sessions') return { url: 'https://checkout.stripe.test/s' };
    if (method === 'GET' && p.startsWith('/subscriptions/')) return { id: p.split('/')[2], items: { data: [{ id: 'si_1', quantity: 3 }] } };
    return {};
  };
  return { stripe, calls, customerFor: async () => 'cus_team' };
}
const end = () => Math.floor(Date.now() / 1000) + 30 * 86400;
// Buys a team and has Stripe confirm it, as the webhook would.
async function activeTeam(owner, seats = 3) {
  const f = fakeStripe();
  await teamBilling.startCheckout(owner.id, { name: 'Launch team', seats }, f);
  const teamId = f.calls[0].body.metadata.teamId;
  await billing.handleEvent({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: owner.id, customer: 'cus_team', metadata: { kind: 'team', teamId, userId: owner.id },
    subscription: { id: `sub_${teamId}`, customer: 'cus_team', status: 'active', current_period_end: end(), items: { data: [{ id: 'si_1', quantity: seats }] } } } } });
  return { teamId, subId: `sub_${teamId}` };
}

test('checkout asks Stripe for one subscription with a seat per person', async () => {
  const owner = user();
  const f = fakeStripe();
  const url = await teamBilling.startCheckout(owner.id, { name: 'Design', seats: 7 }, f);
  assert.equal(url, 'https://checkout.stripe.test/s');
  const body = f.calls[0].body;
  assert.equal(body.line_items[0].price, 'price_team');
  assert.equal(body.line_items[0].quantity, 7);
  assert.equal(body.subscription_data.metadata.kind, 'team');
  // until Stripe confirms payment, nobody has Pro
  assert.equal(billing.getPlan(owner.id).plan, 'free');
  assert.equal(teamBilling.forUser(owner.id).owned.status, 'pending');
  // trying again reuses the waiting team instead of making another
  await teamBilling.startCheckout(owner.id, { name: 'Design', seats: 4 }, f);
  assert.equal(f.calls[1].body.metadata.teamId, body.metadata.teamId);
  for (const seats of [2, 51, 'x', 3.5]) await assert.rejects(teamBilling.startCheckout(owner.id, { seats }, f), /between 3 and 50/);
});

test("a paid team gives its seats Pro without touching the owner's personal plan", async () => {
  const owner = user();
  const { subId } = await activeTeam(owner);
  const u = conn.prepare('SELECT plan, stripeSubscriptionId FROM users WHERE id = ?').get(owner.id);
  assert.notEqual(u.plan, 'pro');
  assert.equal(u.stripeSubscriptionId, null);
  assert.deepEqual([billing.getPlan(owner.id).plan, billing.getPlan(owner.id).via], ['pro', 'team']);
  // later subscription events find the team by its id
  await billing.handleEvent({ type: 'customer.subscription.updated', data: { object: { id: subId, customer: 'cus_team', status: 'active', current_period_end: end(), items: { data: [{ id: 'si_1', quantity: 5 }] } } } });
  assert.equal(teamBilling.forUser(owner.id).owned.seats, 5);
  assert.notEqual(conn.prepare('SELECT plan FROM users WHERE id = ?').get(owner.id).plan, 'pro');
  await assert.rejects(teamBilling.startCheckout(owner.id, { seats: 3 }, fakeStripe()), /already pay for a team/);
});

test('seats give Pro and the Pro AI allowance, and taking one back ends it', async () => {
  const owner = user(), mate = user(), later = `Later_${randomUUID()}@Example.com`;
  await activeTeam(owner);
  assert.equal(billing.isPro(mate.id), false);
  const sent = [];
  assert.equal(teamBilling.addSeat(owner.id, mate.email, { notify: m => sent.push(m) }).added, true);
  assert.equal(sent[0].hasAccount, true);
  assert.equal(billing.isPro(mate.id), true);
  assert.equal(teamBilling.forUser(mate.id).member.name, 'Launch team');
  // the Pro allowance (150) rather than the free one (15)
  for (let i = 0; i < 20; i++) assert.equal(db.consumeAiQuota(mate.id), true);
  // a seat for someone without an account waits for them to sign up
  teamBilling.addSeat(owner.id, later);
  const newcomer = user(later.toLowerCase());
  assert.equal(billing.isPro(newcomer.id), true);
  assert.throws(() => teamBilling.addSeat(owner.id, `x_${randomUUID()}@example.com`), /All 3 seats are taken/);
  assert.equal(teamBilling.addSeat(owner.id, mate.email).added, false);
  assert.throws(() => teamBilling.addSeat(owner.id, 'not an email'), /email address/);
  assert.throws(() => teamBilling.removeSeat(owner.id, owner.email), /keep your own seat/);
  assert.equal(teamBilling.removeSeat(owner.id, mate.email), true);
  assert.equal(billing.isPro(mate.id), false);
});

test('changing the seat count updates Stripe, but never below the seats in use', async () => {
  const owner = user();
  const { subId } = await activeTeam(owner);
  teamBilling.addSeat(owner.id, `a_${randomUUID()}@example.com`);
  teamBilling.addSeat(owner.id, `b_${randomUUID()}@example.com`);
  const f = fakeStripe();
  assert.equal(await teamBilling.setSeatCount(owner.id, 6, f), 6);
  const post = f.calls.find(c => c.method === 'POST');
  assert.equal(post.path, `/subscriptions/${subId}`);
  assert.deepEqual(post.body.items[0], { id: 'si_1', quantity: 6 });
  assert.equal(teamBilling.forUser(owner.id).owned.seats, 6);
  await assert.rejects(teamBilling.setSeatCount(owner.id, 60, f), /between 3 and 50/);
  teamBilling.addSeat(owner.id, `c_${randomUUID()}@example.com`);
  await assert.rejects(teamBilling.setSeatCount(owner.id, 3, f), /4 seats are in use/);
});

test('a Team up team you organise can be seated in one go', async () => {
  const owner = user(), a = user(), b = user(), c = user(), outsider = user();
  await activeTeam(owner);
  const cid = randomUUID();
  conn.prepare("INSERT INTO challenges (id, ownerId, title, template, taskCount, startsAt, endsAt, joinToken, createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(cid, owner.id, 'Engineering', 'x', 1, now(), now(), randomUUID(), now());
  [a, b, c].forEach((m, i) => conn.prepare('INSERT INTO challenge_members (challengeId, userId, projectId, displayName, color, joinedAt) VALUES (?,?,?,?,?,?)').run(cid, m.id, randomUUID(), 'M', '#000', `2026-01-0${i + 1}T00:00:00Z`));
  assert.throws(() => teamBilling.addFromTeamUp(outsider.id, cid), /do not pay for a team/);
  const r = teamBilling.addFromTeamUp(owner.id, cid);
  assert.deepEqual(r, { added: 2, full: 1, people: 3 }); // the owner holds the third seat, so the last to join misses out
  assert.equal(billing.isPro(a.id) && billing.isPro(b.id), true);
  assert.equal(billing.isPro(c.id), false);
});

test('a cancelled team subscription ends Pro for everyone on it', async () => {
  const owner = user(), mate = user();
  const { subId } = await activeTeam(owner);
  teamBilling.addSeat(owner.id, mate.email);
  await billing.handleEvent({ type: 'customer.subscription.deleted', data: { object: { id: subId, customer: 'cus_team', status: 'canceled', items: { data: [{ id: 'si_1', quantity: 3 }] } } } });
  assert.equal(billing.isPro(mate.id), false);
  assert.equal(billing.isPro(owner.id), false);
  assert.throws(() => teamBilling.addSeat(owner.id, `z_${randomUUID()}@example.com`), /not active/);
});
