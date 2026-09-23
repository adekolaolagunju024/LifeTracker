const express = require('express');
const router  = express.Router();
const db = require('../db/db');

// GET /api/trash — soft-deleted projects and tasks, most recently deleted
// first. Also lazily purges anything past the 30-day retention window.
router.get('/', (req, res) => {
  res.json(db.listTrash(req.session.userId));
});

// POST /api/trash/projects/:id/restore
router.post('/projects/:id/restore', (req, res) => {
  const project = db.restoreProject(req.session.userId, req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found in Trash' });
  res.json(project);
});

// POST /api/trash/tasks/:id/restore
router.post('/tasks/:id/restore', (req, res) => {
  const task = db.restoreTask(req.session.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found in Trash' });
  res.json(task);
});

// DELETE /api/trash/projects/:id — permanent, no further undo
router.delete('/projects/:id', (req, res) => {
  db.purgeProjectForever(req.session.userId, req.params.id);
  res.json({ success: true });
});

// DELETE /api/trash/tasks/:id — permanent, no further undo
router.delete('/tasks/:id', (req, res) => {
  db.purgeTaskForever(req.session.userId, req.params.id);
  res.json({ success: true });
});

module.exports = router;
