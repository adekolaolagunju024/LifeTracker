const express = require('express');
const router  = express.Router();
const db = require('../db/db');
const journey = require('../journey');

// GET /api/journey-gaming/me — XP, level, and every achievement with its
// unlocked state, for the Journey view's own header + trophy case.
router.get('/me', (req, res) => {
  const profile = db.getProfile(req.session.userId);
  const xp = profile.journeyXp || 0;
  const unlocked = new Set(db.listJourneyAchievements(req.session.userId).map(a => a.code));
  res.json({
    xp,
    level: journey.levelForXp(xp),
    levelProgress: journey.levelThresholds(xp),
    tasksCompleted: profile.journeyTasksCompleted || 0,
    achievements: journey.JOURNEY_ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlocked.has(a.code) })),
  });
});

module.exports = router;
