const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { readDB, writeDB } = require('../db/db');

// GET /api/actions
router.get('/', (req, res) => {
  res.json(readDB().actions);
});

// POST /api/actions
router.post('/', (req, res) => {
  const db     = readDB();
  const action = { id: uuid(), done: false, createdAt: new Date().toISOString(), ...req.body };
  db.actions.push(action);
  writeDB(db);
  res.status(201).json(action);
});

// PUT /api/actions/:id — update or toggle done
router.put('/:id', (req, res) => {
  const db = readDB();
  const i  = db.actions.findIndex(a => a.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Action not found' });
  db.actions[i] = { ...db.actions[i], ...req.body };
  writeDB(db);
  res.json(db.actions[i]);
});

// DELETE /api/actions/:id
router.delete('/:id', (req, res) => {
  const db = readDB();
  db.actions = db.actions.filter(a => a.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

module.exports = router;
