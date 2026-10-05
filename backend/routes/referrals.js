const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { sendReferralInvite } = require('../email/referral');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/referrals/me — this account's invite link and what it has earned
router.get('/me', (req, res) => {
  const userId = req.session.userId;
  const code = db.getReferralCode(userId);
  res.json({ link: `${APP_URL}/app?ref=${code}`, ...db.getReferralStats(userId) });
});

// POST /api/referrals/invite — emails one personal invite with the user's link
router.post('/invite', async (req, res) => {
  const userId = req.session.userId;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (email === db.getUserById(userId).email.toLowerCase()) return res.status(400).json({ error: "That's your own address" });
  if (db.invitesSentToday(userId) >= db.INVITES_PER_DAY) {
    return res.status(429).json({ error: "You've reached today's invite limit. Try again tomorrow." });
  }

  const code = db.getReferralCode(userId);
  try {
    await sendReferralInvite({
      toEmail: email,
      inviterName: db.getProfile(userId).name || 'A friend',
      link: `${APP_URL}/app?ref=${code}`,
    });
  } catch (e) {
    console.error('Referral invite failed:', e.message);
    return res.status(502).json({ error: e.message || 'The invite could not be sent' });
  }
  db.logEvent(userId, 'invite_sent');
  res.json({ success: true, invitesLeftToday: db.INVITES_PER_DAY - db.invitesSentToday(userId) });
});

module.exports = router;
