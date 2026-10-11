const express = require('express');
const router = express.Router();
const motivation = require('../motivation');
const musicSearch = require('../musicSearch');

// GET /api/motivation: this person's "Your why", plus the starter shelf
// of quotes and the mentor types to choose from.
router.get('/', (req, res) => {
  res.json({ motivation: motivation.get(req.session.userId), library: motivation.LIBRARY, sources: motivation.SOURCES, mentors: motivation.MENTORS, picks: musicSearch.PICKS });
});

// PUT /api/motivation: replaces it (the body is cleaned, see motivation.js).
router.put('/', (req, res) => {
  res.json({ motivation: motivation.save(req.session.userId, req.body || {}) });
});

// GET /api/motivation/music-search?q=: songs (and playlists, with Spotify
// keys) by name, so adding music doesn't mean copying links.
router.get('/music-search', async (req, res) => {
  try { res.json(await musicSearch.search(req.query.q)); } catch (e) { console.error('Music search:', e.message); res.status(502).json({ error: 'Music search is not available right now' }); }
});

module.exports = router;
