const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { readDB, writeDB } = require('../db/db');

// GET /api/tasks?projectId=&status=&priority=&category=&search=
router.get('/', (req, res) => {
  const db = readDB();
  let tasks = db.tasks;

  if (req.query.projectId) tasks = tasks.filter(t => t.projectId  === req.query.projectId);
  if (req.query.status)    tasks = tasks.filter(t => t.status     === req.query.status);
  if (req.query.priority)  tasks = tasks.filter(t => t.priority   === req.query.priority);
  if (req.query.category)  tasks = tasks.filter(t => t.category   === req.query.category);
  if (req.query.search)    tasks = tasks.filter(t => t.title.toLowerCase().includes(req.query.search.toLowerCase()));

  res.json(tasks);
});

// GET /api/tasks/:id
router.get('/:id', (req, res) => {
  const db   = readDB();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// POST /api/tasks
router.post('/', (req, res) => {
  const db   = readDB();
  const task = { id: uuid(), createdAt: new Date().toISOString(), ...req.body };
  db.tasks.push(task);
  writeDB(db);
  res.status(201).json(task);
});

// PUT /api/tasks/:id
router.put('/:id', (req, res) => {
  const db = readDB();
  const i  = db.tasks.findIndex(t => t.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Task not found' });
  db.tasks[i] = { ...db.tasks[i], ...req.body };
  writeDB(db);
  res.json(db.tasks[i]);
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  const db = readDB();
  db.tasks = db.tasks.filter(t => t.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

module.exports = router;
