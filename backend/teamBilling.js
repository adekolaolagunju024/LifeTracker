const crypto = require('crypto');
const db = require('./db/connection');

// ── KOLAWAY TEAM PLAN (Stripe) ─────────────────────────────────
// One subscription, one invoice, a number of seats. Whoever buys it (the
// team's billing owner) adds people to seats by email, or straight from a
// Team up team they organise; everyone on a seat has Pro while the
// subscription is active. The seat count is the subscription's quantity,
// so Stripe bills (and prorates) it. As with Pro, payment happens on
// Stripe's own page and only Stripe's signed webhook changes a status.
//
// Settings: STRIPE_PRICE_TEAM, price_… per seat per month (with the
// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET that Pro already uses).

db.exec(`
  CREATE TABLE IF NOT EXISTS billing_teams (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    name TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 0,
    status TEXT,
    stripeSubscriptionId TEXT,
    renewsAt TEXT,
    cancelAtPeriodEnd INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_billing_teams_owner ON billing_teams(ownerId);
  CREATE TABLE IF NOT EXISTS billing_seats (
    teamId TEXT NOT NULL,
    email TEXT NOT NULL,
    userId TEXT,
    addedAt TEXT NOT NULL,
    PRIMARY KEY (teamId, email)
  );
  CREATE INDEX IF NOT EXISTS idx_billing_seats_email ON billing_seats(email);
`);

const MIN_SEATS = 3, MAX_SEATS = 50;
const ACTIVE = new Set(['active', 'trialing', 'past_due']); // as Pro: past_due while Stripe retries the card
const isConfigured = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_TEAM);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cleanEmail = e => String(e || '').trim().toLowerCase().slice(0, 254);
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const userById = id => db.prepare('SELECT id, email FROM users WHERE id = ?').get(id);
const nameOf = id => ((db.prepare('SELECT name FROM profile WHERE userId = ?').get(id) || {}).name || '').trim();

// The team this person pays for (the newest, if they ever had more).
const ownedTeam = ownerId => db.prepare('SELECT * FROM billing_teams WHERE ownerId = ? ORDER BY createdAt DESC LIMIT 1').get(ownerId);
const seatsOf = teamId => db.prepare('SELECT * FROM billing_seats WHERE teamId = ? ORDER BY addedAt').all(teamId);
// An active team seat this person holds (by account, or by the email it was given to).
function seatFor(userId) {
  const u = userById(userId);
  if (!u) return null;
  const rows = db.prepare(`SELECT t.*, s.email AS seatEmail FROM billing_seats s JOIN billing_teams t ON t.id = s.teamId
    WHERE (s.userId = ? OR s.email = ?) ORDER BY t.createdAt DESC`).all(userId, cleanEmail(u.email));
  return rows.find(t => ACTIVE.has(t.status)) || null;
}
const hasTeamPro = userId => !!seatFor(userId);

// What the Plan card shows: the team you pay for (with its seats), or
// the team that gives you Pro.
function forUser(userId) {
  const own = ownedTeam(userId);
  const out = { configured: isConfigured(), minSeats: MIN_SEATS, maxSeats: MAX_SEATS };
  if (own) {
    const seats = seatsOf(own.id).map(s => {
      const u = s.userId ? userById(s.userId) : db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(s.email);
      return { email: s.email, name: u ? nameOf(u.id) || null : null, joined: !!u, you: !!u && u.id === userId };
    });
    out.owned = { id: own.id, name: own.name, seats: own.seats, used: seats.length, status: own.status || 'pending', active: ACTIVE.has(own.status), renewsAt: own.renewsAt, cancelAtPeriodEnd: !!own.cancelAtPeriodEnd, members: seats };
  }
  const seat = seatFor(userId);
  if (seat && seat.ownerId !== userId) out.member = { name: seat.name, ownerName: nameOf(seat.ownerId) || 'Your team' };
  return out;
}

// ── Buying it ──
async function startCheckout(userId, { name, seats } = {}, { stripe, customerFor }) {
  if (!isConfigured()) throw fail('The Team plan is not set up yet.', 503);
  const n = Number(seats);
  if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) throw fail(`Choose between ${MIN_SEATS} and ${MAX_SEATS} seats.`);
  const title = String(name || '').trim().slice(0, 60) || 'My team';
  const existing = ownedTeam(userId);
  if (existing && ACTIVE.has(existing.status)) throw fail('You already pay for a team. Change its seats or manage billing instead.');
  const u = userById(userId);
  const now = new Date().toISOString();
  // A team waiting for payment is reused, not duplicated, if they try again.
  const id = existing && !existing.stripeSubscriptionId ? existing.id : crypto.randomUUID();
  if (existing && existing.id === id) db.prepare('UPDATE billing_teams SET name = ?, seats = ? WHERE id = ?').run(title, n, id);
  else db.prepare("INSERT INTO billing_teams (id, ownerId, name, seats, status, createdAt) VALUES (?,?,?,?, 'pending', ?)").run(id, userId, title, n, now);
  // the buyer takes the first seat
  db.prepare('INSERT OR IGNORE INTO billing_seats (teamId, email, userId, addedAt) VALUES (?,?,?,?)').run(id, cleanEmail(u.email), userId, now);
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const meta = { kind: 'team', teamId: id, userId };
  const session = await stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: await customerFor(userId),
    client_reference_id: userId,
    line_items: { 0: { price: process.env.STRIPE_PRICE_TEAM, quantity: n } },
    allow_promotion_codes: 'true',
    metadata: meta,
    subscription_data: { metadata: meta },
    success_url: `${appUrl}/app?billing=team`,
    cancel_url: `${appUrl}/app?billing=cancelled`,
  });
  return session.url;
}

// A Stripe subscription for a team: its status, seat count and renewal.
const isTeamSubscription = sub => !!sub && ((sub.metadata && sub.metadata.kind === 'team')
  || !!(sub.id && db.prepare('SELECT 1 FROM billing_teams WHERE stripeSubscriptionId = ?').get(sub.id)));
function applySubscription(sub) {
  const team = (sub.metadata && sub.metadata.teamId && db.prepare('SELECT * FROM billing_teams WHERE id = ?').get(sub.metadata.teamId))
    || (sub.id && db.prepare('SELECT * FROM billing_teams WHERE stripeSubscriptionId = ?').get(sub.id));
  if (!team) return null;
  const item = sub.items && sub.items.data && sub.items.data[0];
  const seats = item && Number.isInteger(item.quantity) ? item.quantity : sub.quantity || team.seats;
  const periodEnd = sub.current_period_end || (item && item.current_period_end);
  db.prepare('UPDATE billing_teams SET status = ?, seats = ?, stripeSubscriptionId = ?, renewsAt = ?, cancelAtPeriodEnd = ? WHERE id = ?')
    .run(sub.status || team.status, seats, sub.id || team.stripeSubscriptionId, periodEnd ? new Date(periodEnd * 1000).toISOString() : team.renewsAt, sub.cancel_at_period_end ? 1 : 0, team.id);
  return team.id;
}

// ── Seats ──
function activeOwned(ownerId) {
  const t = ownedTeam(ownerId);
  if (!t) throw fail('You do not pay for a team yet.', 404);
  if (!ACTIVE.has(t.status)) throw fail('Your Team plan is not active. Finish payment or manage billing first.');
  return t;
}
function addSeat(ownerId, email, { notify } = {}) {
  const t = activeOwned(ownerId);
  const e = cleanEmail(email);
  if (!validEmail(e)) throw fail('That does not look like an email address.');
  if (db.prepare('SELECT 1 FROM billing_seats WHERE teamId = ? AND email = ?').get(t.id, e)) return { added: false, reason: 'already' };
  if (seatsOf(t.id).length >= t.seats) throw fail(`All ${t.seats} seats are taken. Add seats first.`);
  const u = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(e);
  db.prepare('INSERT INTO billing_seats (teamId, email, userId, addedAt) VALUES (?,?,?,?)').run(t.id, e, u ? u.id : null, new Date().toISOString());
  if (notify) notify({ toEmail: e, teamName: t.name, ownerName: nameOf(ownerId) || 'Your team', hasAccount: !!u });
  return { added: true };
}
function removeSeat(ownerId, email) {
  const t = ownedTeam(ownerId);
  if (!t) throw fail('You do not pay for a team yet.', 404);
  const e = cleanEmail(email);
  if (e === cleanEmail(userById(ownerId).email)) throw fail('You keep your own seat while you pay for the team.');
  return db.prepare('DELETE FROM billing_seats WHERE teamId = ? AND email = ?').run(t.id, e).changes > 0;
}
// More or fewer seats: the subscription's quantity, prorated by Stripe.
async function setSeatCount(ownerId, seats, { stripe }) {
  const t = activeOwned(ownerId);
  const n = Number(seats);
  if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) throw fail(`Choose between ${MIN_SEATS} and ${MAX_SEATS} seats.`);
  const used = seatsOf(t.id).length;
  if (n < used) throw fail(`${used} seats are in use. Remove people first, then lower the count.`);
  if (n === t.seats) return n;
  const sub = await stripe('GET', `/subscriptions/${t.stripeSubscriptionId}`);
  const item = sub.items && sub.items.data && sub.items.data[0];
  if (!item) throw fail('Could not find the subscription to change.', 502);
  await stripe('POST', `/subscriptions/${t.stripeSubscriptionId}`, { items: { 0: { id: item.id, quantity: n } }, proration_behavior: 'create_prorations' });
  db.prepare('UPDATE billing_teams SET seats = ? WHERE id = ?').run(n, t.id);
  return n;
}
// Everyone in a Team up team you organise, onto seats (as far as they go).
function addFromTeamUp(ownerId, challengeId, opts) {
  activeOwned(ownerId);
  const c = db.prepare('SELECT * FROM challenges WHERE id = ? AND ownerId = ?').get(String(challengeId || ''), ownerId);
  if (!c) throw fail('Pick a team you organise.', 404);
  const emails = db.prepare('SELECT u.email FROM challenge_members m JOIN users u ON u.id = m.userId WHERE m.challengeId = ? ORDER BY m.joinedAt').all(c.id).map(r => r.email);
  let added = 0, full = 0;
  for (const e of emails) {
    try { if (addSeat(ownerId, e, opts).added) added++; } catch (err) { if (/seats are taken/.test(err.message)) full++; else throw err; }
  }
  return { added, full, people: emails.length };
}

module.exports = { isConfigured, MIN_SEATS, MAX_SEATS, forUser, hasTeamPro, startCheckout, isTeamSubscription, applySubscription, addSeat, removeSeat, setSeatCount, addFromTeamUp };
