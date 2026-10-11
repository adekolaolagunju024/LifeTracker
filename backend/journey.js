// ── JOURNEY GAMING ──────────────────────────────────────────────
// XP, levels, ranks, achievements and daily quests layered on top of real
// work. Everything is decided here on the server, from real events only:
// a task crossing into Completed (applyTaskCompletionRewards, from the
// PUT /api/tasks/:id hook) and a blocker being beaten for the first time
// (applyBlockerRewards, from PUT /api/tasks/obstacles/:id). Nothing a UI
// tap can trigger on its own, so none of it is click-farmable.
const db = require('./db/db');

const XP_BY_PRIORITY = { High: 15, Medium: 10, Low: 6 };
const XP_DEFAULT = 10;
const XP_EARLY_BONUS = 5;       // finishing before the due date
const XP_PER_BLOCKER = 5;       // per enemy, capped below
const XP_BLOCKER_CAP = 20;
const XP_QUEST_BONUS = 30;      // all of today's quests done

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

// A title that grows with the level, so a level means something to say
// out loud ("I'm a Trailblazer").
const RANKS = [
  { from: 1, name: 'Rookie', icon: '🌱' }, { from: 2, name: 'Explorer', icon: '🧭' }, { from: 3, name: 'Pathfinder', icon: '🥾' },
  { from: 4, name: 'Adventurer', icon: '🎒' }, { from: 5, name: 'Trailblazer', icon: '🔥' }, { from: 7, name: 'Champion', icon: '🏅' },
  { from: 10, name: 'Hero', icon: '🦸' }, { from: 13, name: 'Legend', icon: '👑' }, { from: 16, name: 'Mythic', icon: '🐉' },
];
function rankForLevel(level) {
  return [...RANKS].reverse().find(r => level >= r.from);
}

const JOURNEY_ACHIEVEMENTS = [
  { code: 'first_task', group: 'Tasks', icon: '✅', name: 'First Step', desc: 'Complete your first task' },
  { code: 'ten_tasks', group: 'Tasks', icon: '🔟', name: 'Getting Going', desc: 'Complete 10 tasks' },
  { code: 'fifty_tasks', group: 'Tasks', icon: '🏅', name: 'Half Century', desc: 'Complete 50 tasks' },
  { code: 'hundred_tasks', group: 'Tasks', icon: '💯', name: 'Centurion', desc: 'Complete 100 tasks' },
  { code: 'early_1', group: 'Tasks', icon: '⏰', name: 'Ahead of Time', desc: 'Finish a task before its due date' },
  { code: 'early_10', group: 'Tasks', icon: '🐦', name: 'Early Bird', desc: 'Finish 10 tasks before their due dates' },
  { code: 'chain', group: 'Tasks', icon: '🔗', name: 'Chain Reaction', desc: 'Finish a task that was waiting on another' },
  { code: 'blocker_1', group: 'Blockers', icon: '🥊', name: 'First Knockout', desc: 'Beat your first blocker' },
  { code: 'blocker_10', group: 'Blockers', icon: '⚔️', name: 'Blocker Buster', desc: 'Beat 10 blockers' },
  { code: 'blocker_50', group: 'Blockers', icon: '🛡️', name: 'Unstoppable', desc: 'Beat 50 blockers' },
  { code: 'first_house', group: 'Projects', icon: '🏡', name: 'First House', desc: 'Finish every task in a project' },
  { code: 'big_project', group: 'Projects', icon: '🏰', name: 'Master Builder', desc: 'Finish a project with 10 or more tasks' },
  { code: 'streak_3', group: 'Habits', icon: '🔥', name: 'On a Roll', desc: 'Keep a 3-day streak' },
  { code: 'streak_7', group: 'Habits', icon: '🔥🔥', name: 'Week Warrior', desc: 'Keep a 7-day streak' },
  { code: 'streak_14', group: 'Habits', icon: '🌟', name: 'Fortnight Force', desc: 'Keep a 14-day streak' },
  { code: 'streak_30', group: 'Habits', icon: '🏆', name: 'Habit Hero', desc: 'Keep a 30-day streak' },
  { code: 'comeback', group: 'Habits', icon: '💪', name: 'Comeback Kid', desc: 'Finish a task after three or more days away' },
  { code: 'quest_1', group: 'Quests', icon: '🎯', name: 'Quest Complete', desc: "Finish all of a day's quests" },
  { code: 'quest_7', group: 'Quests', icon: '🗺️', name: 'Questmaster', desc: 'Finish all the quests on 7 days' },
  { code: 'level_5', group: 'Levels', icon: '🔥', name: 'Trailblazer', desc: 'Reach level 5' },
  { code: 'level_10', group: 'Levels', icon: '🦸', name: 'Hero', desc: 'Reach level 10' },
];
const ACHIEVEMENTS_BY_CODE = Object.fromEntries(JOURNEY_ACHIEVEMENTS.map(a => [a.code, a]));

// ── DAILY QUESTS ──
// Three small goals a day: always "finish a task", plus two that rotate by
// date, so there's a fresh reason to open the app each day. Progress is
// read from what actually happened today; finishing all three pays a bonus
// once per day.
const QUEST_POOL = [
  { code: 'finish3', icon: '⚡', text: 'Finish 3 tasks', metric: 'done', target: 3 },
  { code: 'high1', icon: '🎯', text: 'Finish a High priority task', metric: 'high', target: 1 },
  { code: 'blocker1', icon: '⚔️', text: 'Beat a blocker', metric: 'blockers', target: 1 },
  { code: 'early1', icon: '⏰', text: 'Finish a task before its due date', metric: 'early', target: 1 },
];
function questsFor(userId, now = new Date()) {
  const todayKey = db.localDateKeyFromDate(now);
  const dayIndex = Math.floor(Date.parse(`${todayKey}T00:00:00Z`) / 86400000);
  const picks = [{ code: 'finish1', icon: '✅', text: 'Finish a task', metric: 'done', target: 1 }, QUEST_POOL[dayIndex % 4], QUEST_POOL[(dayIndex + 1) % 4]];
  const activity = db.questActivityToday(userId, todayKey);
  const quests = picks.map(q => ({ ...q, progress: Math.min(activity[q.metric], q.target), done: activity[q.metric] >= q.target }));
  return { todayKey, quests, allDone: quests.every(q => q.done), bonusXp: XP_QUEST_BONUS, bonusClaimed: db.getProfile(userId).lastQuestBonusDate === todayKey };
}

// Shared tail of every reward: quest bonus, level and level achievements,
// streak achievements, and the payload the app announces.
function finishReward(userId, xpAwarded, oldXp, newlyGranted, extra = {}) {
  const grant = code => { if (db.grantJourneyAchievement(userId, code)) newlyGranted.push(ACHIEVEMENTS_BY_CODE[code]); };
  let xp = oldXp + xpAwarded;
  let questBonus = 0;
  const q = questsFor(userId);
  if (q.allDone && db.claimQuestBonus(userId, q.todayKey)) {
    questBonus = XP_QUEST_BONUS;
    xp = db.addJourneyXp(userId, questBonus);
    const days = db.bumpJourneyCounter(userId, 'journeyQuestDays');
    grant('quest_1');
    if (days >= 7) grant('quest_7');
  }
  const oldLevel = levelForXp(oldXp);
  const level = levelForXp(xp);
  if (level >= 5) grant('level_5');
  if (level >= 10) grant('level_10');
  const streak = db.getProfile(userId).currentStreak || 0;
  if (streak >= 3) grant('streak_3');
  if (streak >= 7) grant('streak_7');
  if (streak >= 14) grant('streak_14');
  if (streak >= 30) grant('streak_30');
  return {
    xpAwarded: xpAwarded + questBonus, xp, level, leveledUp: level > oldLevel, rank: rankForLevel(level),
    rankChanged: rankForLevel(level).name !== rankForLevel(oldLevel).name,
    levelProgress: levelThresholds(xp), newAchievements: newlyGranted, questBonus, quests: questsFor(userId).quests, ...extra,
  };
}

// Called once, synchronously, right after a task is confirmed Completed.
function applyTaskCompletionRewards(userId, task) {
  const before = db.getProfile(userId);
  const oldXp = before.journeyXp || 0;
  const today = db.localDateKeyFromDate(new Date());
  const early = !!(task.endDate && today < task.endDate);
  const xpAwarded = (XP_BY_PRIORITY[task.priority] || XP_DEFAULT) + (early ? XP_EARLY_BONUS : 0);
  db.addJourneyXp(userId, xpAwarded);
  const completedCount = db.bumpJourneyTasksCompleted(userId);

  const newlyGranted = [];
  const grant = code => { if (db.grantJourneyAchievement(userId, code)) newlyGranted.push(ACHIEVEMENTS_BY_CODE[code]); };
  if (completedCount >= 1) grant('first_task');
  if (completedCount >= 10) grant('ten_tasks');
  if (completedCount >= 50) grant('fifty_tasks');
  if (completedCount >= 100) grant('hundred_tasks');
  if (early) {
    const earlyCount = db.bumpJourneyCounter(userId, 'journeyEarlyFinishes');
    grant('early_1');
    if (earlyCount >= 10) grant('early_10');
  }
  if ((task.predecessors || []).length) grant('chain');
  const last = db.lastCompletionBefore(userId, task.id);
  if (last && Date.now() - Date.parse(last) >= 3 * 86400000) grant('comeback');
  if (task.projectId && db.isProjectTreeComplete(task.projectId)) {
    grant('first_house');
    const project = db.getProjectById(userId, task.projectId);
    const rootId = project && project.parentId ? project.parentId : task.projectId;
    if (db.isProjectTreeComplete(rootId) && db.projectTreeTaskCount(rootId) >= 10) grant('big_project');
  }
  return finishReward(userId, xpAwarded, oldXp, newlyGranted, { early });
}

// Called when a blocker is ticked off; pays only the first time it's beaten.
function applyBlockerRewards(userId, obstacle) {
  if (!obstacle || !obstacle.resolved || !db.markObstacleRewarded(obstacle.id)) return null;
  const oldXp = db.getProfile(userId).journeyXp || 0;
  const xpAwarded = Math.min(XP_BLOCKER_CAP, XP_PER_BLOCKER * (obstacle.count || 1));
  db.addJourneyXp(userId, xpAwarded);
  const beaten = db.bumpJourneyCounter(userId, 'journeyBlockersBeaten');
  const newlyGranted = [];
  const grant = code => { if (db.grantJourneyAchievement(userId, code)) newlyGranted.push(ACHIEVEMENTS_BY_CODE[code]); };
  grant('blocker_1');
  if (beaten >= 10) grant('blocker_10');
  if (beaten >= 50) grant('blocker_50');
  return finishReward(userId, xpAwarded, oldXp, newlyGranted, { blocker: true });
}

module.exports = {
  XP_BY_PRIORITY, XP_DEFAULT, XP_QUEST_BONUS, levelForXp, levelThresholds, rankForLevel, RANKS,
  JOURNEY_ACHIEVEMENTS, applyTaskCompletionRewards, applyBlockerRewards, questsFor,
};
