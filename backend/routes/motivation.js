const express = require('express');
const router = express.Router();
const motivation = require('../motivation');

// GET /api/motivation: this person's "Your why", plus the starter shelf
// of quotes and the mentor types to choose from.
router.get('/', (req, res) => {
  res.json({ motivation: motivation.get(req.session.userId), library: motivation.LIBRARY, mentors: motivation.MENTORS });
});

// PUT /api/motivation: replaces it (the body is cleaned, see motivation.js).
router.put('/', (req, res) => {
  res.json({ motivation: motivation.save(req.session.userId, req.body || {}) });
});

module.exports = router;
