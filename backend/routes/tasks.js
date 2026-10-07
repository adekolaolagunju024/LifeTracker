const express = require('express');
const router  = express.Router();
const { v4: uuid } = require('uuid');
const db = require('../db/db');
const { notifyAssigned, notifyMentioned, notifyTaskComment } = require('../email/activity');

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
    // Fire-and-forget — the response already went out; a slow or failed
    // email (or Gmail just not being configured) shouldn't hold up or
    // fail the actual task creation.
    if (task.assigneeId && task.assigneeId !== req.session.userId) {
      const project = db.getProjectById(req.session.userId, task.projectId);
      const assignedByName = db.getProfile(req.session.userId).name;
      notifyAssigned(task.assigneeId, task, project?.title || '', assignedByName).catch(e => console.error('Assigned email failed:', e.message));
    }
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
    const before = db.getTaskById(req.session.userId, req.params.id);
    const task = db.updateTaskById(req.session.userId, req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    // Lets the client celebrate a completion without re-deriving it itself —
    // true only the moment a task crosses into Completed, not on every edit.
    const justCompleted = before && before.status !== 'Completed' && task.status === 'Completed';
    res.json({ ...task, justCompleted });
    const assigneeChanged = task.assigneeId && task.assigneeId !== before?.assigneeId;
    if (assigneeChanged && task.assigneeId !== req.session.userId) {
      const project = db.getProjectById(req.session.userId, task.projectId);
      const assignedByName = db.getProfile(req.session.userId).name;
      notifyAssigned(task.assigneeId, task, project?.title || '', assignedByName).catch(e => console.error('Assigned email failed:', e.message));
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  try {
    db.deleteTaskById(req.session.userId, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/tasks/:id/duplicate
router.post('/:id/duplicate', (req, res) => {
  try {
    const copy = db.duplicateTask(req.session.userId, req.params.id);
    if (!copy) return res.status(404).json({ error: 'Task not found' });
    res.status(201).json(copy);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/tasks/:id/progress — { delta: 1 } logs one unit toward a
// task's numeric target (or -1 to undo one); auto-completes at target
router.post('/:id/progress', (req, res) => {
  try {
    const task = db.bumpTaskProgress(req.session.userId, req.params.id, Number(req.body.delta) || 0);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/tasks/:id/tags — { tagIds: [...] }, replaces the task's whole tag set
router.put('/:id/tags', (req, res) => {
  try {
    const tags = db.setTaskTags(req.session.userId, req.params.id, req.body.tagIds);
    if (tags === null) return res.status(404).json({ error: 'Task not found' });
    res.json(tags);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/tasks/:id/comments
router.get('/:id/comments', (req, res) => {
  const comments = db.listComments(req.session.userId, req.params.id);
  if (comments === null) return res.status(404).json({ error: 'Task not found' });
  res.json(comments);
});

// POST /api/tasks/:id/comments — { text, attachmentId, replyToId }
router.post('/:id/comments', (req, res) => {
  try {
    const comment = db.addComment(req.session.userId, req.params.id, req.body.text, req.body.attachmentId, req.body.replyToId);
    if (!comment) return res.status(404).json({ error: 'Task not found' });
    res.status(201).json(comment);

    // Activity emails: anyone @mentioned gets the targeted email; everyone
    // else "following" the task (assignee, creator, prior commenters) gets
    // the generic one — never both, mentioning someone is more specific.
    const task = db.getTaskById(req.session.userId, req.params.id);
    if (task && comment.text) {
      const project = db.getProjectById(req.session.userId, task.projectId);
      const commenterName = db.getProfile(req.session.userId).name;
      const mentionedIds = new Set(db.extractMentionedUserIds(comment.text, task.projectId).filter(id => id !== req.session.userId));
      mentionedIds.forEach(userId => {
        notifyMentioned(userId, commenterName, comment.text, { taskTitle: task.title }).catch(e => console.error('Mention email failed:', e.message));
      });
      db.getTaskFollowers(task.id, req.session.userId).forEach(userId => {
        if (mentionedIds.has(userId)) return;
        notifyTaskComment(userId, commenterName, task, project?.title || '', comment.text).catch(e => console.error('Task comment email failed:', e.message));
      });
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/tasks/comments/:commentId — registered with a distinct
// prefix (not /:id/comments/:commentId) so there's no ambiguity with the
// routes above.
router.delete('/comments/:commentId', (req, res) => {
  const ok = db.deleteComment(req.session.userId, req.params.commentId);
  if (!ok) return res.status(404).json({ error: 'Comment not found' });
  res.json({ success: true });
});

module.exports = router;
