const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const challenges = require('../challenges');
const { UPLOAD_DIR } = require('../storage');

// Races between friends (backend/challenges.js). All signed in, except the
// preview of a join link, which is public so a link opened before signing
// up can say what it is (backend/server.js mounts that one before the
// sign-in gate).
const fail = (res, e) => res.status(e.status || 400).json({ error: e.message || 'Something went wrong', ...(e.code ? { code: e.code } : {}), ...(e.teamId ? { teamId: e.teamId } : {}) });

// GET /api/challenges : the races you're in
router.get('/', (req, res) => res.json(challenges.listMine(req.session.userId)));

// POST /api/challenges {projectId, endsAt, stake, displayName}
router.post('/', (req, res) => {
  try {
    const c = challenges.createChallenge(req.session.userId, req.body || {});
    res.status(201).json(challenges.get(c.id, req.session.userId));
  } catch (e) { fail(res, e); }
});

// GET /api/challenges/week : races, groups and cheers for the week in review
router.get('/week', (req, res) => res.json(challenges.weekFor(req.session.userId)));

// GET /api/challenges/help-places/:taskId : where this step's blockers can be taken for help
router.get('/help-places/:taskId', (req, res) => res.json(challenges.helpPlaces(req.session.userId, req.params.taskId)));

// GET /api/challenges/for-project/:projectId : the race this goal is your copy for
router.get('/for-project/:projectId', (req, res) => {
  res.json(challenges.forProject(req.params.projectId, req.session.userId));
});

// POST /api/challenges/join/:token {displayName}
router.post('/join/:token', (req, res) => {
  try {
    const r = challenges.join(req.params.token, req.session.userId, (req.body || {}).displayName);
    res.status(r.already ? 200 : 201).json({ projectId: r.projectId, already: r.already, race: challenges.get(r.challenge.id, req.session.userId) });
  } catch (e) { fail(res, e); }
});

// POST /api/challenges/join-code/:code {displayName} : the short class code
router.post('/join-code/:code', (req, res) => {
  const p = challenges.previewByCode(req.params.code);
  if (!p) return res.status(404).json({ error: "That code doesn't match a race or class. Check it and try again" });
  try {
    const r = challenges.join(p.token, req.session.userId, (req.body || {}).displayName);
    res.status(r.already ? 200 : 201).json({ projectId: r.projectId, already: r.already, race: challenges.get(r.challenge.id, req.session.userId) });
  } catch (e) { fail(res, e); }
});

// POST /api/challenges/:id/remind : the organiser nudges everyone behind
router.post('/:id/remind', (req, res) => {
  try { res.json({ reminded: challenges.remind(req.params.id, req.session.userId) }); } catch (e) { fail(res, e); }
});

// GET /api/challenges/:id
router.get('/:id', (req, res) => {
  const c = challenges.get(req.params.id, req.session.userId);
  if (!c) return res.status(404).json({ error: 'Race not found' });
  res.json(c);
});

// POST /api/challenges/:id/clear : off your Teams list once it's finished;
// DELETE puts it back
router.post('/:id/clear', (req, res) => {
  try {
    if (!challenges.clear(req.params.id, req.session.userId)) return res.status(404).json({ error: 'Race not found' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});
router.delete('/:id/clear', (req, res) => {
  if (!challenges.unclear(req.params.id, req.session.userId)) return res.status(404).json({ error: 'Race not found' });
  res.json({ success: true });
});

// The race or group's chat: GET the thread (marks it read), POST a
// message {text}, POST a cheer {color, emoji} for one player, POST
// cheers-seen once the cheers to you have been shown.
router.get('/:id/messages', (req, res) => {
  const m = challenges.messages(req.params.id, req.session.userId);
  if (!m) return res.status(404).json({ error: 'Race not found' });
  res.json(m);
});
router.post('/:id/messages', (req, res) => {
  try {
    const m = challenges.say(req.params.id, req.session.userId, (req.body || {}).text, (req.body || {}).attachmentId, (req.body || {}).taskId);
    if (!m) return res.status(404).json({ error: 'Race not found' });
    res.status(201).json({ id: m.id });
  } catch (e) { fail(res, e); }
});
router.post('/:id/cheer', (req, res) => {
  try {
    const m = challenges.cheer(req.params.id, req.session.userId, (req.body || {}).color, (req.body || {}).emoji);
    if (!m) return res.status(404).json({ error: 'Race not found' });
    res.status(201).json({ id: m.id });
  } catch (e) { fail(res, e); }
});
router.post('/:id/cheers-seen', (req, res) => {
  if (!challenges.cheersSeen(req.params.id, req.session.userId)) return res.status(404).json({ error: 'Race not found' });
  res.json({ success: true });
});

// Proof and sign-off: POST a proof {taskId, text, attachmentId} for a step
// you've ticked (the photo uploaded to your copy first, via /api/uploads);
// the leader POSTs a review {color, taskId ('all' to approve them all),
// decision: approve|reject, note}; GET a proof's photo or file.
router.post('/:id/proof', (req, res) => {
  try {
    const m = challenges.submitProof(req.params.id, req.session.userId, req.body || {});
    if (!m) return res.status(404).json({ error: 'Race not found' });
    res.status(201).json({ id: m.id });
  } catch (e) { fail(res, e); }
});
router.post('/:id/review', (req, res) => {
  try {
    const n = challenges.review(req.params.id, req.session.userId, req.body || {});
    if (n === null) return res.status(404).json({ error: 'Race not found' });
    res.json({ decided: n });
  } catch (e) { fail(res, e); }
});
router.get('/:id/proof-file/:attachmentId', (req, res) => {
  const a = challenges.proofFile(req.params.id, req.session.userId, req.params.attachmentId);
  const filePath = a && path.join(UPLOAD_DIR, a.filename);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', a.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.originalName)}"`);
  res.sendFile(filePath);
});

// Help on a blocker: POST help {obstacleId, note}; POST help/:messageId/offer
router.post('/:id/help', (req, res) => {
  try {
    const m = challenges.askHelp(req.params.id, req.session.userId, req.body || {});
    if (!m) return res.status(404).json({ error: 'Race not found' });
    res.status(201).json({ id: m.id });
  } catch (e) { fail(res, e); }
});
router.post('/:id/help/:messageId/offer', (req, res) => {
  try {
    const m = challenges.offerHelp(req.params.id, req.session.userId, req.params.messageId);
    if (!m) return res.status(404).json({ error: 'Race not found' });
    res.status(201).json({ id: m.id });
  } catch (e) { fail(res, e); }
});

// Split the work: the leader assigns a step {taskId, color} (color '' to
// unclaim it) or shares out every unclaimed step; anyone claims one.
router.post('/:id/assign', (req, res) => {
  try {
    if (!challenges.assignStep(req.params.id, req.session.userId, req.body || {})) return res.status(404).json({ error: 'Team not found' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});
router.post('/:id/claim', (req, res) => {
  try {
    if (!challenges.claimStep(req.params.id, req.session.userId, (req.body || {}).taskId)) return res.status(404).json({ error: 'Team not found' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});
router.post('/:id/split-evenly', (req, res) => {
  try {
    const n = challenges.splitEvenly(req.params.id, req.session.userId);
    if (n === null) return res.status(404).json({ error: 'Team not found' });
    res.json({ assigned: n });
  } catch (e) { fail(res, e); }
});

// Phase leads {projectId, color} (color '' to clear), milestones
// {taskId, on} and how steps are signed off {checks}.
router.post('/:id/leads', (req, res) => {
  try {
    if (!challenges.setLead(req.params.id, req.session.userId, req.body || {})) return res.status(404).json({ error: 'Team not found' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});
// Phases or departments {word}, and someone's department {color, projectId}.
router.post('/:id/sections', (req, res) => {
  try {
    const word = challenges.setSections(req.params.id, req.session.userId, (req.body || {}).word);
    if (!word) return res.status(404).json({ error: 'Team not found' });
    res.json({ word });
  } catch (e) { fail(res, e); }
});
router.post('/:id/dept', (req, res) => {
  try {
    if (!challenges.setDept(req.params.id, req.session.userId, req.body || {})) return res.status(404).json({ error: 'Team not found' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});
router.post('/:id/milestone', (req, res) => {
  try {
    if (!challenges.setMilestone(req.params.id, req.session.userId, req.body || {})) return res.status(404).json({ error: 'Team not found' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});
router.post('/:id/checks', (req, res) => {
  try {
    const checks = challenges.setChecks(req.params.id, req.session.userId, (req.body || {}).checks);
    if (!checks) return res.status(404).json({ error: 'Team not found' });
    res.json({ checks });
  } catch (e) { fail(res, e); }
});

// DELETE /api/challenges/:id : the person who set it up ends it for everyone
router.delete('/:id', (req, res) => {
  try {
    const r = challenges.endTeam(req.params.id, req.session.userId);
    if (!r) return res.status(404).json({ error: 'Team not found' });
    res.json(r);
  } catch (e) { fail(res, e); }
});

// POST /api/challenges/:id/leave
router.post('/:id/leave', (req, res) => {
  try {
    if (!challenges.leave(req.params.id, req.session.userId)) return res.status(404).json({ error: 'Race not found' });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
