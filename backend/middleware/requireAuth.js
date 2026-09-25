const db = require('../db/db');

// In-memory throttle so an active user's heartbeat writes to the database
// at most once per ~20s, not on every single request (which would be a
// write per API call — cheap individually, but pointless volume at any
// real usage rate). Fine to lose this cache on a restart; it just means
// the next request re-touches immediately, no real cost.
const lastTouch = new Map();
const HEARTBEAT_INTERVAL_MS = 20 * 1000;

module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    const userId = req.session.userId;

    // A session can outlive the account it points to — the account was
    // deleted (self-service, or a direct DB operation) while this browser
    // still held a valid cookie, on this device or another one, possibly
    // for up to the cookie's full 30-day life. Without this check, every
    // route downstream assumes a real user/profile row exists and crashes
    // confusingly (e.g. reading .onboarded off an undefined profile)
    // instead of just asking them to log in again.
    if (!db.getUserById(userId)) {
      return req.session.destroy(() => res.status(401).json({ error: 'Not authenticated' }));
    }

    const now = Date.now();
    if (!lastTouch.has(userId) || now - lastTouch.get(userId) > HEARTBEAT_INTERVAL_MS) {
      lastTouch.set(userId, now);
      db.touchLastActive(userId);
    }
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};
