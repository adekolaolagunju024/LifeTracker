const cron = require('node-cron');
const db = require('../db/db');
const { sendPushToUser } = require('./webpush');

// Local (not UTC) date key — same technique and same reason as the email
// digest: a task's due date is a plain "YYYY-MM-DD" string, and comparing
// it against a UTC-derived date can put a task in the wrong bucket by a
// day depending on the server's timezone offset.
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const FOCUS_WINDOW_START_HOUR = 9;
const FOCUS_WINDOW_END_HOUR = 18;
const FOCUS_NUDGE_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

// "Needs attention" is the same two buckets as the email digest minus
// "due tomorrow" (that's advance notice, not urgency) — overdue or due
// today, and not already done.
function getAttentionTasks(userId, todayKey) {
  const tasks = db.listTasks(userId);
  const overdue = [];
  const dueToday = [];
  tasks.forEach(t => {
    if (t.status === 'Completed' || !t.endDate) return;
    const dueKey = t.endDate.slice(0, 10);
    if (dueKey < todayKey) overdue.push(t);
    else if (dueKey === todayKey) dueToday.push(t);
  });
  return { overdue, dueToday };
}

// 1. "Went overdue" — fires once per task, right when it first crosses
// into overdue, not on every ~15-minute tick it stays that way (see
// overdueNotifiedAt, cleared automatically if the task's dates/status
// change in a way that could un-overdue it).
async function checkOverdueAlerts() {
  const todayKey = localDateKey(new Date());
  const nowIso = new Date().toISOString();
  for (const u of db.listUsersForPushReminders()) {
    try {
      const { overdue } = getAttentionTasks(u.userId, todayKey);
      for (const t of overdue) {
        if (t.overdueNotifiedAt) continue;
        await sendPushToUser(u.userId, { title: '🔴 Overdue: ' + t.title, body: `Was due ${t.endDate.slice(0, 10)}` });
        db.markTaskOverdueNotified(t.id, nowIso);
      }
    } catch (e) { console.error(`Overdue push check failed for ${u.userId}:`, e.message); }
  }
}

// 2. "Due today" — once a day, a single summary push rather than one per
// task, same "already handled today" guard as the email digest.
async function checkDueTodayDigest() {
  const todayKey = localDateKey(new Date());
  for (const u of db.listUsersForPushReminders()) {
    if (u.lastPushDigestSentDate === todayKey) continue;
    try {
      const { dueToday } = getAttentionTasks(u.userId, todayKey);
      if (dueToday.length) {
        const title = dueToday.length === 1 ? `📌 Due today: ${dueToday[0].title}` : `📌 ${dueToday.length} tasks due today`;
        const body = dueToday.slice(0, 3).map(t => t.title).join(', ') + (dueToday.length > 3 ? '…' : '');
        await sendPushToUser(u.userId, { title, body });
      }
      db.setLastPushDigestSentDate(u.userId, todayKey);
    } catch (e) { console.error(`Due-today push failed for ${u.userId}:`, e.message); }
  }
}

// 3. Recurring focus nudge — the anti-procrastination one: a periodic
// "you still have X open" during work hours, only while something's
// actually outstanding, spaced out rather than constant nagging.
async function checkFocusNudges() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < FOCUS_WINDOW_START_HOUR || hour >= FOCUS_WINDOW_END_HOUR) return;
  const todayKey = localDateKey(now);
  for (const u of db.listUsersForPushReminders()) {
    try {
      const lastNudge = u.lastFocusNudgeAt ? new Date(u.lastFocusNudgeAt).getTime() : 0;
      if (now.getTime() - lastNudge < FOCUS_NUDGE_INTERVAL_MS) continue;
      const { overdue, dueToday } = getAttentionTasks(u.userId, todayKey);
      const count = overdue.length + dueToday.length;
      if (!count) continue;
      await sendPushToUser(u.userId, {
        title: `⏰ Still open: ${count} ${count === 1 ? 'task needs' : 'tasks need'} attention today`,
        body: [...overdue, ...dueToday].slice(0, 3).map(t => t.title).join(', '),
      });
      db.setLastFocusNudgeAt(u.userId, now.toISOString());
    } catch (e) { console.error(`Focus nudge failed for ${u.userId}:`, e.message); }
  }
}

// Overdue alerts and focus nudges both want a frequent check (every 15
// min); the due-today summary only wants to fire once, near the start of
// the day. All three are no-ops for a user with push reminders off, and
// the whole scheduler is harmless with zero subscriptions — sendPushToUser
// just has nothing to send to.
function startPushReminderScheduler() {
  cron.schedule('*/15 * * * *', () => {
    checkOverdueAlerts().catch(e => console.error('Overdue check failed:', e.message));
    checkFocusNudges().catch(e => console.error('Focus nudge check failed:', e.message));
  });
  cron.schedule('0 8 * * *', () => {
    checkDueTodayDigest().catch(e => console.error('Due-today push failed:', e.message));
  });
}

module.exports = { startPushReminderScheduler, checkOverdueAlerts, checkDueTodayDigest, checkFocusNudges };
