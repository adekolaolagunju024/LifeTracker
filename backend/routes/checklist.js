const express = require('express');
const router  = express.Router();
const db = require('../db/db');

// GET /api/checklist/:taskId — every item on a task's checklist
router.get('/:taskId', (req, res) => {
  const items = db.listChecklistItems(req.session.userId, req.params.taskId);
  if (items === null) return res.status(404).json({ error: 'Task not found' });
  res.json(items);
});

// POST /api/checklist/:taskId — add one item {title}
router.post('/:taskId', (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Item text is required' });
  try {
    const item = db.addChecklistItem(req.session.userId, req.params.taskId, title);
    if (!item) return res.status(404).json({ error: 'Task not found' });
    res.status(201).json(item);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/checklist/item/:id — update {title?, completed?}
router.put('/item/:id', (req, res) => {
  try {
    const item = db.updateChecklistItem(req.session.userId, req.params.id, req.body);
    if (!item) return res.status(404).json({ error: 'Checklist item not found' });
    res.json(item);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/checklist/item/:id
router.delete('/item/:id', (req, res) => {
  try {
    const ok = db.deleteChecklistItem(req.session.userId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Checklist item not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
