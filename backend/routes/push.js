const express = require('express');
const router  = express.Router();
const db = require('../db/db');
const { getVapidPublicKey, sendPushToUser } = require('../push/webpush');

// GET /api/push/vapid-public-key — the frontend needs this to call
// pushManager.subscribe(); public by design, same as any VAPID public key.
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// POST /api/push/subscribe — { endpoint, keys: { p256dh, auth } }
router.post('/subscribe', (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
    db.addPushSubscription(req.session.userId, { endpoint, keys });
    res.status(201).json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/push/unsubscribe — { endpoint }
router.post('/unsubscribe', (req, res) => {
  db.removePushSubscription(req.session.userId, req.body.endpoint);
  res.json({ success: true });
});

// POST /api/push/test — lets Settings offer a "Send test notification"
// button, so turning this on comes with immediate confirmation it worked
// instead of silently waiting for the next real reminder.
router.post('/test', async (req, res) => {
  try {
    await sendPushToUser(req.session.userId, {
      title: '✅ Push reminders are working',
      body: "You'll get alerts like this for overdue and due-today tasks.",
    });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
