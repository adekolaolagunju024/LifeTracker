const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');

// GET /api/actions
router.get('/', (req, res) => {
  res.json(db.listActions(req.session.userId));
});

// POST /api/actions
router.post('/', (req, res) => {
  const action = db.createAction(req.session.userId, {
    id: uuid(),
    done: false,
    createdAt: new Date().toISOString(),
    ...req.body,
  });
  res.status(201).json(action);
});

// PUT /api/actions/:id
router.put('/:id', (req, res) => {
  const action = db.updateActionById(req.session.userId, req.params.id, req.body);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  res.json(action);
});

// DELETE /api/actions/:id
router.delete('/:id', (req, res) => {
  db.deleteActionById(req.session.userId, req.params.id);
  res.json({ success: true });
});

module.exports = router;
