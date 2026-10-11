const express = require('express');
const router = express.Router();
const billing = require('../billing');

// GET /api/billing: this person's plan, and the prices when Stripe is set up.
router.get('/', async (req, res) => {
  let prices = null;
  try { prices = await billing.prices(); } catch (e) { console.error('Stripe prices:', e.message); }
  res.json({ configured: billing.isConfigured(), ...billing.getPlan(req.session.userId), prices });
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
