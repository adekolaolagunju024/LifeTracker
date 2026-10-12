const conn = require('./db/connection');
const db = require('./db/db');

// ── TODAY'S PLAN ────────────────────────────────────────────────
// Start my day turns the tasks picked for today into a timetable: each
// has a start time ("09:30") and a length in minutes. Kept on the server,
// one per person per day, so the plan made last night is waiting in the
// morning, on any device, and the day's pace (and later the ghost and the
// evening report) can be worked out from it.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ITEMS = 20;

function clean(userId, items) {
  if (!Array.isArray(items)) throw new Error('items must be a list');
  if (items.length > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} tasks in a day`);
  const seen = new Set();
  return items.map(it => {
    const taskId = String((it && it.taskId) || '');
    if (!taskId || seen.has(taskId)) throw new Error('Each task can be in the plan once');
    seen.add(taskId);
    if (!db.getTaskById(userId, taskId)) throw new Error('Task not found');
    const start = String(it.start || '');
    if (!TIME.test(start)) throw new Error('A start time looks like 09:30');
    const minutes = Math.round(Number(it.minutes));
    if (!(minutes >= 5 && minutes <= 480)) throw new Error('A task takes between 5 minutes and 8 hours');
    return { taskId, start, minutes };
  }).sort((a, b) => a.start.localeCompare(b.start));
}

function get(userId, date) {
  if (!DATE.test(String(date))) throw new Error('A date looks like 2026-10-12');
  const row = conn.prepare('SELECT items, updatedAt FROM day_plans WHERE userId = ? AND date = ?').get(userId, date);
  if (!row) return null;
  // Tasks deleted since drop out quietly.
  const items = JSON.parse(row.items).filter(it => db.getTaskById(userId, it.taskId));
  return { date, items, updatedAt: row.updatedAt };
}

function save(userId, date, items) {
  if (!DATE.test(String(date))) throw new Error('A date looks like 2026-10-12');
  const list = clean(userId, items);
  const updatedAt = new Date().toISOString();
  if (!list.length) {
    conn.prepare('DELETE FROM day_plans WHERE userId = ? AND date = ?').run(userId, date);
    return { date, items: [], updatedAt };
  }
  conn.prepare(`INSERT INTO day_plans (userId, date, items, updatedAt) VALUES (?, ?, ?, ?)
    ON CONFLICT(userId, date) DO UPDATE SET items = excluded.items, updatedAt = excluded.updatedAt`)
    .run(userId, date, JSON.stringify(list), updatedAt);
  return { date, items: list, updatedAt };
}

// ── The wake-up notification ──
// A time ("07:00") and the person's time zone; null switches it off.
function getWake(userId) {
  const row = conn.prepare('SELECT wakeTime, wakeTz FROM profile WHERE userId = ?').get(userId) || {};
  return { time: row.wakeTime || null, tz: row.wakeTz || null };
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; }
}
function setWake(userId, time, tz) {
  if (time === null || time === '') {
    conn.prepare('UPDATE profile SET wakeTime = NULL WHERE userId = ?').run(userId);
    return getWake(userId);
  }
  if (!TIME.test(String(time))) throw new Error('A wake-up time looks like 07:00');
  if (!tz || !validTz(tz)) throw new Error('Unknown time zone');
  conn.prepare('UPDATE profile SET wakeTime = ?, wakeTz = ? WHERE userId = ?').run(time, tz, userId);
  return getWake(userId);
}

// The local date and "HH:MM" for a time zone at a moment.
function localNow(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Who should get the morning notification now: their wake time has come
// (within the last 15 minutes, so a slow tick or a restart doesn't skip
// it) and they haven't had today's yet.
function dueWakeUps(now = new Date()) {
  const rows = conn.prepare('SELECT userId, wakeTime, wakeTz, lastWakeSentDate FROM profile WHERE wakeTime IS NOT NULL AND wakeTz IS NOT NULL').all();
  const out = [];
  for (const r of rows) {
    if (!validTz(r.wakeTz)) continue;
    const local = localNow(r.wakeTz, now);
    if (r.lastWakeSentDate === local.date) continue;
    const mins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const late = mins(local.time) - mins(r.wakeTime);
    if (late >= 0 && late < 15) out.push({ userId: r.userId, date: local.date });
  }
  return out;
}
function markWakeSent(userId, date) {
  conn.prepare('UPDATE profile SET lastWakeSentDate = ? WHERE userId = ?').run(date, userId);
}

module.exports = { get, save, getWake, setWake, dueWakeUps, markWakeSent, localNow };
