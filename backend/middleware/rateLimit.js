// A small in-memory rate limiter for the sign-in endpoints, so a password
// can't be guessed by brute force and the reset email can't be used to
// flood someone's inbox. Counts live in this process only (one Railway
// instance), which is all these endpoints need; a restart clears them.
function rateLimit({ windowMs, max, key, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// An IPv4 address can arrive written as IPv6 ("::ffff:1.2.3.4"); count
// both forms as the same client.
const byIp = req => String(req.ip || 'unknown').replace(/^::ffff:/, '');
const byIpAndEmail = req => `${byIp(req)}|${String((req.body && req.body.email) || '').trim().toLowerCase()}`;

module.exports = { rateLimit, byIp, byIpAndEmail };
