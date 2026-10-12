const express = require('express');
const router  = express.Router();
const metrics = require('../metrics');

// The owner's metrics (backend/metrics.js). Everyone else gets a 404, so
// the page's existence isn't advertised.

// POST /api/admin/feature {feature}: the app saying someone used a
// feature (once a day each; see backend/features.js). Anyone signed in.
router.post('/feature', (req, res) => {
  require('../features').record(req.session.userId, String((req.body || {}).feature || ''));
  res.json({ ok: true });
});

// GET /api/admin/me — whether to show the Metrics link
router.get('/me', (req, res) => {
  res.json({ owner: metrics.isOwner(req.session.userId) });
});

// GET /api/admin/metrics
router.get('/metrics', (req, res) => {
  if (!metrics.isOwner(req.session.userId)) return res.status(404).json({ error: 'Not found' });
  try {
    res.json(metrics.buildMetrics());
  } catch (e) {
    console.error('Metrics error:', e.message);
    res.status(500).json({ error: 'Could not build the metrics' });
  }
});

module.exports = router;
