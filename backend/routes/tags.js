const express = require('express');
const router  = express.Router();
const db = require('../db/db');

// GET /api/tags
router.get('/', (req, res) => {
  res.json(db.listTags(req.session.userId));
});

// POST /api/tags — { label, color }
router.post('/', (req, res) => {
  try {
    const tag = db.createTag(req.session.userId, req.body);
    res.status(201).json(tag);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/tags/:id — { label?, color? }
router.put('/:id', (req, res) => {
  try {
    const tag = db.updateTag(req.session.userId, req.params.id, req.body);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    res.json(tag);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/tags/:id — also detaches it from every task that had it
router.delete('/:id', (req, res) => {
  db.deleteTag(req.session.userId, req.params.id);
  res.json({ success: true });
});

module.exports = router;
