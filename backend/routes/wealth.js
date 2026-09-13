const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');

// GET /api/wealth
router.get('/', (req, res) => {
  res.json(db.getWealth(req.session.userId));
});

// PUT /api/wealth/entries
router.put('/entries', (req, res) => {
  res.json(db.updateWealthEntries(req.session.userId, req.body));
});

// POST /api/wealth/targets
router.post('/targets', (req, res) => {
  const key = 'w_' + Date.now();
  db.addWealthTarget(req.session.userId, key, req.body.label, req.body.target || 0);
  res.status(201).json({ key, label: req.body.label, target: req.body.target || 0 });
});

// GET /api/wealth/log
router.get('/log', (req, res) => {
  res.json(db.getWealth(req.session.userId).monthlyLog);
});

// POST /api/wealth/log
router.post('/log', (req, res) => {
  const entry = db.addMonthlyLogEntry(req.session.userId, {
    id: uuid(),
    date: new Date().toISOString(),
    ...req.body,
  });
  res.status(201).json(entry);
});

// DELETE /api/wealth/log/:id
router.delete('/log/:id', (req, res) => {
  db.deleteMonthlyLogEntry(req.session.userId, req.params.id);
  res.json({ success: true });
});

module.exports = router;
