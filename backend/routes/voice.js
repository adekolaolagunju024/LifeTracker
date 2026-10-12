const express = require('express');
const router = express.Router();
const voice = require('../voice');

// /api/voice: natural voices for the assistant (backend/voice.js).

// GET /api/voice — whether a natural voice is set up, and the voices
router.get('/', (req, res) => res.json(voice.info()));

// POST /api/voice/speak — { text, voice } → audio/mpeg
router.post('/speak', async (req, res) => {
  try {
    const audio = await voice.speak(req.session.userId, (req.body || {}).text, (req.body || {}).voice);
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' });
    res.send(audio);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not read that out' });
  }
});

module.exports = router;
