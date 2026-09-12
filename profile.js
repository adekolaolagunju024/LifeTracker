const express = require('express');
const router  = express.Router();
const { readDB, writeDB } = require('../db/db');

// GET /api/profile
router.get('/', (req, res) => {
  const db = readDB();
  res.json(db.profile);
});

// PUT /api/profile
router.put('/', (req, res) => {
  const db = readDB();
  db.profile = { ...db.profile, ...req.body };
  writeDB(db);
  res.json(db.profile);
});

module.exports = router;
