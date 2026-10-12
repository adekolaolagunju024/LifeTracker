const express = require('express');
const router = express.Router();
const dayPlan = require('../dayPlan');

// /api/day: today's timetable and the wake-up notification
// (backend/dayPlan.js). The signed-in person's own only.

// GET /api/day/plan/:date
router.get('/plan/:date', (req, res) => {
  try { res.json(dayPlan.get(req.session.userId, req.params.date) || { date: req.params.date, items: [] }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/day/plan/:date — { items: [{ taskId, start: "09:30", minutes }] }
router.put('/plan/:date', (req, res) => {
  try { res.json(dayPlan.save(req.session.userId, req.params.date, (req.body || {}).items)); } catch (e) { res.status(400).json({ error: e.message }); }
});

// GET/PUT /api/day/wake — { time: "07:00" | null, tz: "Europe/London" }
router.get('/wake', (req, res) => res.json(dayPlan.getWake(req.session.userId)));
router.put('/wake', (req, res) => {
  try { res.json(dayPlan.setWake(req.session.userId, (req.body || {}).time ?? null, (req.body || {}).tz)); } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
