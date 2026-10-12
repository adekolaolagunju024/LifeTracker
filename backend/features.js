const crypto = require('crypto');
const db = require('./db/connection');

// ── WHICH FEATURES PEOPLE USE ───────────────────────────────────
// So keep/cut decisions rest on use, not guesses. The app reports a
// feature the first time someone uses it each day; we store one row per
// person per feature per day (an analytics_events row named
// "feature:<key>"), and the owner's Metrics page shows, for the last 30
// days, how many of the active people used each one. Counts only.
const FEATURES = {
  start_day: 'Start my day',
  tour: 'Getting started slides',
  focus: 'Focus session',
  assistant: 'Assistant',
  listen: 'Listen (read aloud)',
  why: 'Your why page',
  why_coach: 'Your why coach chat',
  music: 'Music player',
  music_search: 'Music search',
  pledges: 'Reward pledges',
  journey: 'Journey',
  recap: 'This week (full screen)',
  report: 'Progress report',
  portfolio: 'Portfolio report',
  chat: 'Team chat message',
  reminder: 'Task reminder',
  palette: 'Command palette',
  trophies: 'Trophy case',
  actions: 'Actions page',
  calendar: 'Calendar page',
  planner: 'Planner (Gantt / Kanban)',
  backup: 'Backup or export',
};

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
function record(userId, feature) {
  if (!userId || !Object.prototype.hasOwnProperty.call(FEATURES, feature)) return false;
  const event = `feature:${feature}`;
  const seen = db.prepare('SELECT 1 FROM analytics_events WHERE userId = ? AND event = ? AND createdAt >= ? LIMIT 1').get(userId, event, `${dayKey()}T00:00:00`);
  if (seen) return false;
  db.prepare('INSERT INTO analytics_events (id, userId, event, createdAt) VALUES (?,?,?,?)').run(crypto.randomUUID(), userId, event, new Date().toISOString());
  return true;
}

// For each feature: how many people used it in the window, and what share
// of the people active in it that is. Most used first.
function usage(sinceIso, activeCount) {
  const rows = db.prepare("SELECT event, COUNT(DISTINCT userId) AS n FROM analytics_events WHERE event LIKE 'feature:%' AND createdAt >= ? GROUP BY event").all(sinceIso);
  const byKey = Object.fromEntries(rows.map(r => [r.event.slice(8), r.n]));
  return Object.entries(FEATURES)
    .map(([key, label]) => ({ key, label, people: byKey[key] || 0, share: activeCount ? Math.round((byKey[key] || 0) / activeCount * 100) : null }))
    .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label));
}

module.exports = { FEATURES, record, usage };
