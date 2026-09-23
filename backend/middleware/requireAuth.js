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
    const now = Date.now();
    if (!lastTouch.has(userId) || now - lastTouch.get(userId) > HEARTBEAT_INTERVAL_MS) {
      lastTouch.set(userId, now);
      db.touchLastActive(userId);
    }
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};
