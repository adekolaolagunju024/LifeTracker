const express = require('express');
const router  = express.Router();
const db = require('../db/db');

// GET /api/notifications — pending invites, tasks recently assigned to you,
// and project chat / task comment activity since you last checked. Safe to
// poll — doesn't mark anything read.
router.get('/', (req, res) => {
  const data = db.getNotifications(req.session.userId);
  // Reminders from the organiser of a class or team you're in.
  const since = db.getUserById(req.session.userId).notificationsCheckedAt || '1970-01-01T00:00:00.000Z';
  data.challengeNudges = require('../challenges').nudgesSince(req.session.userId, since);
  // Races and groups (help, offers, sign-off, cheers, finishes) and rewards.
  data.teamActivity = require('../challenges').activitySince(req.session.userId, since);
  data.rewardActivity = require('../pledges').activitySince(req.session.userId, since);
  res.json(data);
});

// POST /api/notifications/read — call when the notification dropdown is
// opened, so chat/comment/assignment items clear next time. Pending
// invites aren't affected — they stay listed until accepted/declined.
router.post('/read', (req, res) => {
  db.markNotificationsRead(req.session.userId);
  res.json({ success: true });
});

module.exports = router;
