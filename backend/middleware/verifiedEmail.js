const db = require('../db/db');

// Routes that email other people (project invites, invite-a-friend) wait
// until the sender has confirmed their own address, so a throwaway sign-up
// can't be used to send mail through Waypoint.
function requireVerifiedEmail(req, res, next) {
  if (db.isEmailVerified(req.session.userId)) return next();
  res.status(403).json({ error: 'Confirm your email first. We sent you a link when you signed up, and you can send a new one from the banner at the top.', code: 'email_unverified' });
}

module.exports = { requireVerifiedEmail };
