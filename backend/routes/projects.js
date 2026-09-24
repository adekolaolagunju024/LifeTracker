const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');

// ── INVITES (registered before /:id so "invites" isn't captured as an id) ──

// GET /api/projects/invites — pending invites for the current user
router.get('/invites', (req, res) => {
  res.json(db.listPendingInvites(req.session.userId));
});

// POST /api/projects/invites/:id/accept
router.post('/invites/:id/accept', (req, res) => {
  const invite = db.acceptInvite(req.session.userId, req.params.id);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  res.json(invite);
});

// POST /api/projects/invites/:id/decline
router.post('/invites/:id/decline', (req, res) => {
  db.declineInvite(req.session.userId, req.params.id);
  res.json({ success: true });
});

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

// DELETE /api/projects/:id — owner-only (db.deleteProjectById no-ops otherwise)
router.delete('/:id', (req, res) => {
  db.deleteProjectById(req.session.userId, req.params.id);
  res.json({ success: true });
});

// ── SHARING (Google-Sheets-style: invite an existing account by email) ──

// GET /api/projects/:id/collaborators
router.get('/:id/collaborators', (req, res) => {
  if (!db.canAccessProject(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Project not found' });
  res.json(db.listCollaborators(req.params.id));
});

// POST /api/projects/:id/collaborators — { email }
router.post('/:id/collaborators', (req, res) => {
  try {
    const invite = db.inviteCollaborator(req.session.userId, req.params.id, req.body.email);
    res.status(201).json(invite);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/projects/:id/collaborators/:userId
router.delete('/:id/collaborators/:userId', (req, res) => {
  try {
    const removed = db.removeCollaborator(req.session.userId, req.params.id, req.params.userId);
    if (!removed) return res.status(404).json({ error: 'Not a collaborator on this project' });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
