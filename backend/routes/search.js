const express = require('express');
const router  = express.Router();
const db = require('../db/db');

// GET /api/search?q=... — projects and tasks whose title matches, for the
// topbar's global search. Requires at least 2 characters to avoid a
// firehose of near-everything on the first keystroke.
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ projects: [], tasks: [] });
  res.json(db.searchAll(req.session.userId, q));
});

module.exports = router;
