const express = require('express');
const router  = express.Router();
const db      = require('../db/db');

// GET /api/profile
router.get('/', (req, res) => {
  res.json(db.getProfile(req.session.userId));
});

// PUT /api/profile
router.put('/', (req, res) => {
  res.json(db.updateProfile(req.session.userId, req.body));
});

module.exports = router;
