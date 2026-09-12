const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { readDB, writeDB } = require('../db/db');

// GET /api/wealth
router.get('/', (req, res) => {
  res.json(readDB().wealth);
});

// PUT /api/wealth/entries — update current values
router.put('/entries', (req, res) => {
  const db = readDB();
  db.wealth.entries = { ...db.wealth.entries, ...req.body };
  writeDB(db);
  res.json(db.wealth.entries);
});

// POST /api/wealth/targets — add a new wealth category
router.post('/targets', (req, res) => {
  const db  = readDB();
  const key = 'w_' + Date.now();
  db.wealth.targets[key] = { label: req.body.label, target: req.body.target || 0 };
  db.wealth.entries[key] = 0;
  writeDB(db);
  res.status(201).json({ key, ...db.wealth.targets[key] });
});

// GET /api/wealth/log — monthly income log
router.get('/log', (req, res) => {
  res.json(readDB().wealth.monthlyLog);
});

// POST /api/wealth/log — add a month entry
router.post('/log', (req, res) => {
  const db  = readDB();
  const entry = { id: uuid(), date: new Date().toISOString(), ...req.body };
  db.wealth.monthlyLog.unshift(entry);
  writeDB(db);
  res.status(201).json(entry);
});

// DELETE /api/wealth/log/:id
router.delete('/log/:id', (req, res) => {
  const db = readDB();
  db.wealth.monthlyLog = db.wealth.monthlyLog.filter(e => e.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

module.exports = router;
