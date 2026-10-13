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

// GET /api/challenges/:id
router.get('/:id', (req, res) => {
  const c = challenges.get(req.params.id, req.session.userId);
  if (!c) return res.status(404).json({ error: 'Race not found' });
  res.json(c);
});

// POST /api/challenges/:id/leave
router.post('/:id/leave', (req, res) => {
  if (!challenges.leave(req.params.id, req.session.userId)) return res.status(404).json({ error: 'Race not found' });
  res.json({ success: true });
});

module.exports = router;
