const express = require('express');
const router  = express.Router();
const db = require('../db/db');

// GET /api/notifications — pending invites, tasks recently assigned to you,
// and project chat / task comment activity since you last checked. Safe to
// poll — doesn't mark anything read.
router.get('/', (req, res) => {
  res.json(db.getNotifications(req.session.userId));
});

// POST /api/notifications/read — call when the notification dropdown is
// opened, so chat/comment/assignment items clear next time. Pending
// invites aren't affected — they stay listed until accepted/declined.
router.post('/read', (req, res) => {
  db.markNotificationsRead(req.session.userId);
  res.json({ success: true });
});

module.exports = router;
