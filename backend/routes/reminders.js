const express = require('express');
const router  = express.Router();
const db = require('../db/db');

// Task reminders ("alarms"). Every route is the signed-in person's own
// reminders only; setting one checks they can see the task.

// GET /api/reminders — still to ring, or ringing and not yet answered.
router.get('/', (req, res) => {
  res.json(db.listReminders(req.session.userId));
});

// PUT /api/reminders/task/:taskId — { remindAt (ISO), nag }
router.put('/task/:taskId', (req, res) => {
  try {
    const reminder = db.setTaskReminder(req.session.userId, req.params.taskId, { remindAt: req.body.remindAt, nag: req.body.nag !== false });
    if (!reminder) return res.status(404).json({ error: 'Task not found' });
    res.json(reminder);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/reminders/task/:taskId
router.delete('/task/:taskId', (req, res) => {
  db.deleteTaskReminder(req.session.userId, req.params.taskId);
  res.json({ success: true });
});

// POST /api/reminders/:id/snooze — { minutes }
router.post('/:id/snooze', (req, res) => {
  const reminder = db.snoozeReminder(req.session.userId, req.params.id, req.body && req.body.minutes);
  if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
  res.json(reminder);
});

// POST /api/reminders/:id/ack — answered (started, done or dismissed):
// stop ringing.
router.post('/:id/ack', (req, res) => {
  if (!db.ackReminder(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Reminder not found' });
  res.json({ success: true });
});

module.exports = router;
