const express = require('express');
const router = express.Router();
const challenges = require('../challenges');

// Races between friends (backend/challenges.js). All signed in, except the
// preview of a join link, which is public so a link opened before signing
// up can say what it is (backend/server.js mounts that one before the
// sign-in gate).
const fail = (res, e) => res.status(e.status || 400).json({ error: e.message || 'Something went wrong' });

// GET /api/challenges : the races you're in
router.get('/', (req, res) => res.json(challenges.listMine(req.session.userId)));

// POST /api/challenges {projectId, endsAt, stake, displayName}
router.post('/', (req, res) => {
  try {
    const c = challenges.createChallenge(req.session.userId, req.body || {});
    res.status(201).json(challenges.get(c.id, req.session.userId));
  } catch (e) { fail(res, e); }
});

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
    const m = challenges.say(req.params.id, req.session.userId, (req.body || {}).text);
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

// POST /api/challenges/:id/leave
router.post('/:id/leave', (req, res) => {
  if (!challenges.leave(req.params.id, req.session.userId)) return res.status(404).json({ error: 'Race not found' });
  res.json({ success: true });
});

module.exports = router;
