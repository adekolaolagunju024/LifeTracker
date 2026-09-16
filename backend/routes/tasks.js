const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');

// GET /api/tasks?projectId=&status=&priority=&category=&search=
router.get('/', (req, res) => {
  res.json(db.listTasks(req.session.userId, req.query));
});

// GET /api/tasks/:id
router.get('/:id', (req, res) => {
  const task = db.getTaskById(req.session.userId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// POST /api/tasks
router.post('/', (req, res) => {
  try {
    const task = db.createTask(req.session.userId, {
      id: uuid(),
      createdAt: new Date().toISOString(),
      ...req.body,
    });
    res.status(201).json(task);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/tasks/reorder — persists a manual drag-to-reorder within one
// project. Must be registered before PUT /:id, or Express would match
// "reorder" as an :id.
router.put('/reorder', (req, res) => {
  const { projectId, taskIds } = req.body;
  if (!projectId || !Array.isArray(taskIds)) return res.status(400).json({ error: 'projectId and taskIds are required' });
  db.reorderTasks(req.session.userId, projectId, taskIds);
  res.json({ success: true });
});

// PUT /api/tasks/:id
router.put('/:id', (req, res) => {
  try {
    const task = db.updateTaskById(req.session.userId, req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  db.deleteTaskById(req.session.userId, req.params.id);
  res.json({ success: true });
});

module.exports = router;
