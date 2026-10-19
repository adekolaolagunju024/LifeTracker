const express = require('express');
const router = express.Router();
const billing = require('../billing');
const teamBilling = require('../teamBilling');
const { sendTeamSeatEmail } = require('../email/teamSeat');

// GET /api/billing: this person's plan, and the prices when Stripe is set up.
router.get('/', async (req, res) => {
  let prices = null;
  try { prices = await billing.prices(); } catch (e) { console.error('Stripe prices:', e.message); }
  res.json({ configured: billing.isConfigured(), ...billing.getPlan(req.session.userId), prices, team: teamBilling.forUser(req.session.userId) });
});

// POST /api/billing/checkout { interval: 'month' | 'year' }: a Stripe
// Checkout page to subscribe. Payment details are entered there, never here.
router.post('/checkout', async (req, res) => {
  if (!billing.isConfigured()) return res.status(503).json({ error: 'Payments are not set up yet.' });
  if (billing.isPro(req.session.userId)) return res.status(400).json({ error: 'You already have Pro. Manage it from Billing.' });
  try { res.json({ url: await billing.createCheckout(req.session.userId, req.body && req.body.interval === 'year' ? 'year' : 'month') }); }
  catch (e) { console.error('Stripe checkout:', e.message); res.status(502).json({ error: 'Could not open the payment page. Try again in a moment.' }); }
});

// POST /api/billing/portal: Stripe's page to change card, switch plan,
// see invoices or cancel.
router.post('/portal', async (req, res) => {
  if (!billing.isConfigured()) return res.status(503).json({ error: 'Payments are not set up yet.' });
  if (!billing.getPlan(req.session.userId).hasCustomer) return res.status(400).json({ error: 'There is no billing to manage yet.' });
  try { res.json({ url: await billing.createPortal(req.session.userId) }); }
  catch (e) { console.error('Stripe portal:', e.message); res.status(502).json({ error: 'Could not open billing. Try again in a moment.' }); }
});

// ── Team plan ──
// Errors from teamBilling carry their own status; Stripe failures don't.
function teamError(res, e, what) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(`Stripe team ${what}:`, e.message);
  res.status(502).json({ error: 'Could not reach billing. Try again in a moment.' });
}
// The seat email is a courtesy: it never holds up adding the seat.
const notifySeat = req => info => {
  const link = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/app`;
  sendTeamSeatEmail({ ...info, link }).catch(e => console.error('Team seat email:', e.message));
};

// POST /api/billing/team/checkout { name, seats }: Stripe's page to buy the Team plan.
router.post('/team/checkout', async (req, res) => {
  const b = req.body || {};
  try { res.json({ url: await billing.teamCheckout(req.session.userId, { name: b.name, seats: b.seats }) }); }
  catch (e) { teamError(res, e, 'checkout'); }
});

// POST /api/billing/team/seats { email }: give someone a seat.
router.post('/team/seats', (req, res) => {
  try { res.json({ ...teamBilling.addSeat(req.session.userId, req.body && req.body.email, { notify: notifySeat(req) }), team: teamBilling.forUser(req.session.userId) }); }
  catch (e) { teamError(res, e, 'seat'); }
});

// DELETE /api/billing/team/seats/:email: take a seat back.
router.delete('/team/seats/:email', (req, res) => {
  try {
    if (!teamBilling.removeSeat(req.session.userId, req.params.email)) return res.status(404).json({ error: 'That person does not have a seat.' });
    res.json({ team: teamBilling.forUser(req.session.userId) });
  } catch (e) { teamError(res, e, 'seat'); }
});

// PUT /api/billing/team/size { seats }: more or fewer seats (Stripe prorates).
router.put('/team/size', async (req, res) => {
  try { await billing.teamSeatCount(req.session.userId, req.body && req.body.seats); res.json({ team: teamBilling.forUser(req.session.userId) }); }
  catch (e) { teamError(res, e, 'size'); }
});

// POST /api/billing/team/from-teamup { teamId }: seats for a Team up team you organise.
router.post('/team/from-teamup', (req, res) => {
  try { res.json({ ...teamBilling.addFromTeamUp(req.session.userId, req.body && req.body.teamId, { notify: notifySeat(req) }), team: teamBilling.forUser(req.session.userId) }); }
  catch (e) { teamError(res, e, 'from team up'); }
});

// POST /api/stripe/webhook: Stripe telling us a subscription changed.
// Mounted before the JSON parser (the signature covers the raw body) and
// before sign-in (Stripe calls it, not a person).
const webhook = [express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  let event;
  try { event = billing.verifyWebhook(req.body.toString('utf8'), req.get('stripe-signature')); }
  catch (e) { return res.status(400).send(`Webhook error: ${e.message}`); }
  try { await billing.handleEvent(event); res.json({ received: true }); }
  catch (e) { console.error('Stripe webhook:', e.message); res.status(500).json({ error: 'Could not process the event' }); }
}];

module.exports = { router, webhook };
