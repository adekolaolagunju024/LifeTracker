const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');
const { sendChatMessageEmail } = require('../email/chatMail');

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

// GET /api/projects/chats — a WhatsApp-style inbox of every shared
// project's chat, most recently active first (registered before /:id so
// "chats" isn't captured as an id)
router.get('/chats', (req, res) => {
  res.json(db.listChatPreviews(req.session.userId));
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

// POST /api/projects/:id/duplicate — anyone with access can make their own
// independent copy (it doesn't touch the original or its sharing at all)
router.post('/:id/duplicate', (req, res) => {
  try {
    const copy = db.duplicateProject(req.session.userId, req.params.id);
    if (!copy) return res.status(404).json({ error: 'Project not found' });
    res.status(201).json(copy);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── SHARING (Google-Sheets-style: invite an existing account by email) ──

// GET /api/projects/:id/collaborators
router.get('/:id/collaborators', (req, res) => {
  if (!db.canAccessProject(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Project not found' });
  res.json(db.listCollaborators(req.params.id));
});

// POST /api/projects/:id/collaborators — { email, role: 'viewer'|'commenter'|'editor' }
router.post('/:id/collaborators', (req, res) => {
  try {
    const invite = db.inviteCollaborator(req.session.userId, req.params.id, req.body.email, req.body.role);
    res.status(201).json(invite);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/projects/:id/collaborators/:userId — { role } — owner-only
router.put('/:id/collaborators/:userId', (req, res) => {
  try {
    const changed = db.updateCollaboratorRole(req.session.userId, req.params.id, req.params.userId, req.body.role);
    if (!changed) return res.status(404).json({ error: 'Not a collaborator on this project' });
    res.json({ success: true });
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

// POST /api/projects/:id/leave — a collaborator removes themselves; the
// owner can't leave their own project
router.post('/:id/leave', (req, res) => {
  try {
    const left = db.leaveProject(req.session.userId, req.params.id);
    if (!left) return res.status(404).json({ error: 'You are not a collaborator on this project' });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── PROJECT CHAT (project-wide, polled for near-live updates) ──────

// GET /api/projects/:id/messages
router.get('/:id/messages', (req, res) => {
  const messages = db.listProjectMessages(req.session.userId, req.params.id);
  if (messages === null) return res.status(404).json({ error: 'Project not found' });
  res.json(messages);
});

// POST /api/projects/:id/messages — { text, attachmentId, alsoEmail, ccEmails, replyToId }
// alsoEmail is an explicit per-message opt-in, not a setting — most
// messages should just be a chat message, not an inbox notification.
router.post('/:id/messages', async (req, res) => {
  try {
    const message = db.addProjectMessage(req.session.userId, req.params.id, req.body.text, req.body.attachmentId, req.body.replyToId);
    let email = { sent: false };
    if (req.body.alsoEmail) {
      email = await sendChatMessageEmail(req.session.userId, req.params.id, message, req.body.ccEmails);
    }
    res.status(201).json({ ...message, email });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/projects/messages/:messageId — author or project owner
router.delete('/messages/:messageId', (req, res) => {
  const removed = db.deleteProjectMessage(req.session.userId, req.params.messageId);
  if (!removed) return res.status(404).json({ error: 'Message not found' });
  res.json({ success: true });
});

// ── PROJECT STATUS (WhatsApp-style, expires after 24h) ─────────────

// GET /api/projects/:id/statuses
router.get('/:id/statuses', (req, res) => {
  const statuses = db.listActiveStatuses(req.session.userId, req.params.id);
  if (statuses === null) return res.status(404).json({ error: 'Project not found' });
  res.json(statuses);
});

// POST /api/projects/:id/statuses — { text, attachmentId }
router.post('/:id/statuses', (req, res) => {
  try {
    const status = db.addStatus(req.session.userId, req.params.id, req.body.text, req.body.attachmentId);
    res.status(201).json(status);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/projects/statuses/:statusId — author or project owner
router.delete('/statuses/:statusId', (req, res) => {
  const removed = db.deleteStatus(req.session.userId, req.params.statusId);
  if (!removed) return res.status(404).json({ error: 'Status not found' });
  res.json({ success: true });
});

module.exports = router;
