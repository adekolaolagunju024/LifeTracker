const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');

// GET /api/projects?parentId=<id>|null
router.get('/', (req, res) => {
  res.json(db.listProjects(req.session.userId, req.query));
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  const project = db.getProjectById(req.session.userId, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// POST /api/projects
router.post('/', (req, res) => {
  try {
    const project = db.createProject(req.session.userId, {
      id: uuid(),
      createdAt: new Date().toISOString(),
      ...req.body,
    });
    res.status(201).json(project);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  try {
    const project = db.updateProjectById(req.session.userId, req.params.id, req.body);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  db.deleteProjectById(req.session.userId, req.params.id);
  res.json({ success: true });
});

module.exports = router;
