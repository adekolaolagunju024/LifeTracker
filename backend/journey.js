// ── JOURNEY GAMING ──────────────────────────────────────────────
// XP, levels, and achievements layered on top of real task completion.
// Computed in exactly one place — applyTaskCompletionRewards(), called
// from the PUT /api/tasks/:id hook the instant a task crosses into
// Completed (the same justCompleted signal that drives the screen-wide
// celebration) — never from a UI interaction, so none of this is
// click-farmable. The Journey view's hammer-tap is cosmetic only and
// never calls this.
const db = require('./db/db');

const XP_BY_PRIORITY = { High: 15, Medium: 10, Low: 6 };
const XP_DEFAULT = 10;

// Level N needs more XP than level N-1 — a gently increasing curve
// (level 2 at 80 total XP, level 3 at 240, level 4 at 480, ...) rather
// than a flat per-level cost, so early levels come quickly.
function levelThresholds(xp) {
  let level = 1, floor = 0, step = 80;
  while (xp >= floor + step) {
    floor += step;
    level += 1;
    step += 40;
  }
  return { level, floor, ceiling: floor + step };
}
function levelForXp(xp) {
  return levelThresholds(xp).level;
}

const JOURNEY_ACHIEVEMENTS = [
  { code: 'first_task', icon: '✅', name: 'First Step', desc: 'Complete your first task' },
  { code: 'ten_tasks', icon: '🔟', name: 'Getting Going', desc: 'Complete 10 tasks' },
  { code: 'fifty_tasks', icon: '🏅', name: 'Half Century', desc: 'Complete 50 tasks' },
  { code: 'hundred_tasks', icon: '💯', name: 'Centurion', desc: 'Complete 100 tasks' },
  { code: 'first_house', icon: '🏡', name: 'First House', desc: 'Finish every task in a project' },
  { code: 'streak_3', icon: '🔥', name: 'On a Roll', desc: 'Keep a 3-day streak' },
  { code: 'streak_7', icon: '🔥🔥', name: 'Week Warrior', desc: 'Keep a 7-day streak' },
];
const ACHIEVEMENTS_BY_CODE = Object.fromEntries(JOURNEY_ACHIEVEMENTS.map(a => [a.code, a]));

// Called once, synchronously, right after a task is confirmed Completed.
// Returns null if there's nothing to report (shouldn't happen when called
// correctly, but keeps the route simple either way).
function applyTaskCompletionRewards(userId, task) {
  const xpAwarded = XP_BY_PRIORITY[task.priority] || XP_DEFAULT;
  const before = db.getProfile(userId);
  const oldXp = before.journeyXp || 0;
  const newXp = db.addJourneyXp(userId, xpAwarded);
  const oldLevel = levelForXp(oldXp);
  const newLevel = levelForXp(newXp);
  const completedCount = db.bumpJourneyTasksCompleted(userId);

  const newlyGranted = [];
  const grant = code => { if (db.grantJourneyAchievement(userId, code)) newlyGranted.push(ACHIEVEMENTS_BY_CODE[code]); };

  if (completedCount >= 1) grant('first_task');
  if (completedCount >= 10) grant('ten_tasks');
  if (completedCount >= 50) grant('fifty_tasks');
  if (completedCount >= 100) grant('hundred_tasks');
  if (task.projectId && db.isProjectTreeComplete(task.projectId)) grant('first_house');
  const afterStreak = db.getProfile(userId).currentStreak || 0;
  if (afterStreak >= 3) grant('streak_3');
  if (afterStreak >= 7) grant('streak_7');

  return {
    xpAwarded, xp: newXp, level: newLevel, leveledUp: newLevel > oldLevel,
    levelProgress: levelThresholds(newXp),
    newAchievements: newlyGranted,
  };
}

module.exports = { XP_BY_PRIORITY, XP_DEFAULT, levelForXp, levelThresholds, JOURNEY_ACHIEVEMENTS, applyTaskCompletionRewards };
