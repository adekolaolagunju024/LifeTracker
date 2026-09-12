const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const { readDB, writeDB } = require('../db/db');

// GET /api/projects
router.get('/', (req, res) => {
  const db = readDB();
  res.json(db.projects);
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  const db  = readDB();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// POST /api/projects
router.post('/', (req, res) => {
  const db = readDB();
  const project = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    ...req.body
  };
  db.projects.push(project);
  writeDB(db);
  res.status(201).json(project);
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  const db = readDB();
  const i  = db.projects.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Project not found' });
  db.projects[i] = { ...db.projects[i], ...req.body };
  writeDB(db);
  res.json(db.projects[i]);
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const db = readDB();
  db.projects = db.projects.filter(p => p.id !== req.params.id);
  db.tasks    = db.tasks.filter(t => t.projectId !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

module.exports = router;
