const crypto = require('crypto');
const db = require('./db/connection');

// ── WAYRISE PRO (Stripe) ───────────────────────────────────────
// Free stays free: every feature works. Pro is a subscription that lifts
// the daily AI allowance tenfold (and is where future extras go). Payment
// happens on Stripe's own checkout page, so card details never reach us;
// Stripe tells us what happened through a signed webhook, which is the
// only thing that changes someone's plan.
//
// Settings (environment variables):
//   STRIPE_SECRET_KEY       sk_live_… or sk_test_…
//   STRIPE_WEBHOOK_SECRET   whsec_… (from the webhook endpoint in Stripe)
//   STRIPE_PRICE_MONTHLY    price_… for the monthly plan
//   STRIPE_PRICE_YEARLY     price_… for the yearly plan (optional)
//   APP_URL                 https://yourdomain.com (for the return links)

const API = 'https://api.stripe.com/v1';
const isConfigured = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_MONTHLY);

// Stripe's API takes form-encoded bodies with bracketed keys.
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? form(body).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Stripe error ${res.status}`);
  return data;
}

// ── Plans ──
const PRO_STATUSES = new Set(['active', 'trialing', 'past_due']); // past_due: Stripe is still retrying the card
function getPlan(userId) {
  const u = db.prepare('SELECT plan, planStatus, planRenewsAt, planCancelAtPeriodEnd, stripeCustomerId FROM users WHERE id = ?').get(userId) || {};
  return {
    plan: u.plan === 'pro' ? 'pro' : 'free',
    status: u.planStatus || null,
    renewsAt: u.planRenewsAt || null,
    cancelAtPeriodEnd: !!u.planCancelAtPeriodEnd,
    hasCustomer: !!u.stripeCustomerId,
  };
}
const isPro = userId => getPlan(userId).plan === 'pro';

// Applies a Stripe subscription to whoever it belongs to.
function applySubscription(sub) {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;
  let user = customer && db.prepare('SELECT id FROM users WHERE stripeCustomerId = ?').get(customer);
  if (!user && sub.metadata && sub.metadata.userId) user = db.prepare('SELECT id FROM users WHERE id = ?').get(sub.metadata.userId);
  if (!user) return null;
  const pro = PRO_STATUSES.has(sub.status);
  const periodEnd = sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end);
  db.prepare(`UPDATE users SET plan = ?, planStatus = ?, planRenewsAt = ?, planCancelAtPeriodEnd = ?, stripeSubscriptionId = ?, stripeCustomerId = COALESCE(stripeCustomerId, ?) WHERE id = ?`)
    .run(pro ? 'pro' : 'free', sub.status, periodEnd ? new Date(periodEnd * 1000).toISOString() : null, sub.cancel_at_period_end ? 1 : 0, sub.id, customer, user.id);
  return user.id;
}

// ── Webhook ──
// Checks Stripe's signature (HMAC-SHA256 of "timestamp.body" with the
// endpoint secret, within five minutes) before trusting anything.
function verifyWebhook(rawBody, header, secret = process.env.STRIPE_WEBHOOK_SECRET, now = Date.now()) {
  if (!secret || !header) throw new Error('Missing signature');
  const parts = Object.fromEntries(String(header).split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header).split(',').filter(p => p.trim().startsWith('v1=')).map(p => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) throw new Error('Bad signature header');
  if (Math.abs(now / 1000 - t) > 300) throw new Error('Signature too old');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error('Signature does not match');
  return JSON.parse(rawBody);
}

async function handleEvent(event) {
  const obj = event.data && event.data.object;
  if (!obj) return;
  if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
    // Link the customer to the person who checked out, then fetch the
    // subscription itself for its status and renewal date.
    if (obj.client_reference_id && obj.customer) {
      db.prepare('UPDATE users SET stripeCustomerId = ? WHERE id = ? AND (stripeCustomerId IS NULL OR stripeCustomerId = ?)').run(obj.customer, obj.client_reference_id, obj.customer);
    }
    if (obj.subscription) applySubscription(typeof obj.subscription === 'string' ? await stripe('GET', `/subscriptions/${obj.subscription}`) : obj.subscription);
  } else if (event.type.startsWith('customer.subscription.')) {
    applySubscription(obj);
  }
}

// ── Checkout and the billing portal ──
async function customerFor(userId) {
  const u = db.prepare('SELECT id, email, stripeCustomerId FROM users WHERE id = ?').get(userId);
  if (u.stripeCustomerId) return u.stripeCustomerId;
  const c = await stripe('POST', '/customers', { email: u.email, metadata: { userId: u.id } });
  db.prepare('UPDATE users SET stripeCustomerId = ? WHERE id = ?').run(c.id, u.id);
  return c.id;
}
async function createCheckout(userId, interval) {
  const price = interval === 'year' && process.env.STRIPE_PRICE_YEARLY ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY;
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const session = await stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: await customerFor(userId),
    client_reference_id: userId,
    line_items: { 0: { price, quantity: 1 } },
    allow_promotion_codes: 'true',
    subscription_data: { metadata: { userId } },
    success_url: `${appUrl}/app?billing=success`,
    cancel_url: `${appUrl}/app?billing=cancelled`,
  });
  return session.url;
}
async function createPortal(userId) {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const session = await stripe('POST', '/billing_portal/sessions', { customer: await customerFor(userId), return_url: `${appUrl}/app?billing=portal` });
  return session.url;
}

// The prices as Stripe has them, for the upgrade card (cached an hour).
let priceCache = { at: 0, value: null };
async function prices() {
  if (!isConfigured()) return null;
  if (priceCache.value && Date.now() - priceCache.at < 3600000) return priceCache.value;
  const get = async id => {
    if (!id) return null;
    const p = await stripe('GET', `/prices/${id}`);
    return { amount: p.unit_amount, currency: p.currency, interval: p.recurring && p.recurring.interval };
  };
  const value = { monthly: await get(process.env.STRIPE_PRICE_MONTHLY), yearly: await get(process.env.STRIPE_PRICE_YEARLY) };
  priceCache = { at: Date.now(), value };
  return value;
}

function countPro() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE plan = 'pro'").get().n;
}

module.exports = { isConfigured, getPlan, isPro, applySubscription, verifyWebhook, handleEvent, createCheckout, createPortal, prices, countPro, PRO_STATUSES };
