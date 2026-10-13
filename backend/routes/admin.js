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

// The safety systems the launch review asked for, on or off, so the owner
// can see at a glance what still needs setting up on the host.
function serviceStatus() {
  const fs = require('fs');
  const path = require('path');
  const backup = require('../backup');
  let lastBackup = backup.lastResult();
  if (!lastBackup) {
    // Since this process started there's been no run: the newest file says when.
    const files = fs.existsSync(backup.BACKUP_DIR) ? fs.readdirSync(backup.BACKUP_DIR).filter(f => /^lifetracker-.*\.sqlite$/.test(f)).sort() : [];
    const newest = files[files.length - 1];
    lastBackup = newest ? { at: fs.statSync(path.join(backup.BACKUP_DIR, newest)).mtime.toISOString(), ok: true, file: newest, offsite: null, fromDisk: true } : null;
  }
  return {
    dataVolume: !!process.env.DB_PATH,
    offsiteBackups: require('../offsite').isConfigured(),
    errorTracking: !!process.env.SENTRY_DSN,
    email: !!process.env.RESEND_API_KEY,
    payments: require('../billing').isConfigured(),
    lastBackup,
  };
}

// GET /api/admin/feedback: the latest problem reports, newest first.
router.get('/feedback', (req, res) => {
  if (!metrics.isOwner(req.session.userId)) return res.status(404).json({ error: 'Not found' });
  const db = require('../db/connection');
  res.json(db.prepare(`SELECT f.id, f.message, f.page, f.userAgent, f.createdAt, u.email FROM feedback f
    LEFT JOIN users u ON u.id = f.userId ORDER BY f.createdAt DESC LIMIT 50`).all());
});

// GET /api/admin/metrics
router.get('/metrics', (req, res) => {
  if (!metrics.isOwner(req.session.userId)) return res.status(404).json({ error: 'Not found' });
  try {
    res.json({ ...metrics.buildMetrics(), service: serviceStatus() });
  } catch (e) {
    console.error('Metrics error:', e.message);
    res.status(500).json({ error: 'Could not build the metrics' });
  }
});

module.exports = router;
