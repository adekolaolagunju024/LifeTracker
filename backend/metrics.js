const db = require('./db/connection');

// The owner's metrics page (Settings → hidden unless you're the owner;
// GET /api/admin/metrics). Counts only, never names or emails.
//
// "Active" on a day means the person used the app that day: an
// active_day event (recorded once a day by requireAuth), or anything else
// logged in analytics_events, or a task they finished. Weeks are rolling
// seven-day windows ending now, newest last.
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();

function activityRows() {
  // userId + timestamp of every sign of life we have.
  return db.prepare(`
    SELECT userId, createdAt AS at FROM analytics_events WHERE userId IS NOT NULL
    UNION ALL
    SELECT userId, completedAt AS at FROM tasks WHERE completedAt IS NOT NULL
  `).all();
}

function buildMetrics(now = Date.now()) {
  const users = db.prepare('SELECT id, createdAt FROM users').all()
    .map(u => ({ id: u.id, joined: new Date(u.createdAt).getTime() }))
    .filter(u => !Number.isNaN(u.joined));
  const joinedById = new Map(users.map(u => [u.id, u.joined]));

  // Per user: sorted activity times, first goal, first finished task.
  const activity = new Map();
  for (const r of activityRows()) {
    const t = new Date(r.at).getTime();
    if (Number.isNaN(t) || !joinedById.has(r.userId)) continue;
    if (!activity.has(r.userId)) activity.set(r.userId, []);
    activity.get(r.userId).push(t);
  }
  const firstGoal = new Map(db.prepare("SELECT userId, MIN(createdAt) AS at FROM projects WHERE parentId IS NULL GROUP BY userId").all()
    .map(r => [r.userId, new Date(r.at).getTime()]));
  const finishTimes = new Map();
  for (const r of db.prepare(`
    SELECT userId, createdAt AS at FROM analytics_events WHERE event = 'task_completed'
    UNION ALL SELECT userId, completedAt AS at FROM tasks WHERE completedAt IS NOT NULL
  `).all()) {
    const t = new Date(r.at).getTime();
    if (Number.isNaN(t)) continue;
    if (!finishTimes.has(r.userId)) finishTimes.set(r.userId, []);
    finishTimes.get(r.userId).push(t);
  }
  const activeBetween = (userId, from, to) => (activity.get(userId) || []).some(t => t >= from && t < to);

  // ── Weekly series (12 weeks) ──
  const WEEKS = 12;
  const weeks = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const end = now - i * 7 * DAY, start = end - 7 * DAY;
    const active = new Set();
    for (const [uid, times] of activity) if (times.some(t => t >= start && t < end)) active.add(uid);
    weeks.push({
      start: iso(start), end: iso(end),
      signups: users.filter(u => u.joined >= start && u.joined < end).length,
      active: active.size,
      tasksDone: [...finishTimes.values()].reduce((n, ts) => n + ts.filter(t => t >= start && t < end).length, 0),
    });
  }

  // ── Funnel: people who joined 1–90 days ago (old enough to have tried) ──
  const pool = users.filter(u => u.joined <= now - DAY && u.joined >= now - 90 * DAY);
  const madeGoal = pool.filter(u => firstGoal.has(u.id));
  const finished = pool.filter(u => (finishTimes.get(u.id) || []).length);
  const week2Pool = pool.filter(u => u.joined <= now - 14 * DAY);
  const week4Pool = pool.filter(u => u.joined <= now - 28 * DAY);
  const funnel = [
    { step: 'Signed up', count: pool.length, of: pool.length },
    { step: 'Created a goal', count: madeGoal.length, of: pool.length },
    { step: 'Finished a task', count: finished.length, of: pool.length },
    { step: 'Came back in week 2', count: week2Pool.filter(u => activeBetween(u.id, u.joined + 7 * DAY, u.joined + 14 * DAY)).length, of: week2Pool.length },
    { step: 'Still here in week 4', count: week4Pool.filter(u => activeBetween(u.id, u.joined + 21 * DAY, u.joined + 28 * DAY)).length, of: week4Pool.length },
  ];

  // ── Cohorts: people who joined in each of the last 8 weeks, and the share
  // active in each week after joining (null where that week hasn't happened).
  const cohorts = [];
  for (let i = 7; i >= 0; i--) {
    const end = now - i * 7 * DAY, start = end - 7 * DAY;
    const members = users.filter(u => u.joined >= start && u.joined < end);
    const weeksAfter = [];
    for (let w = 0; w < 8; w++) {
      const complete = members.length && members.every(u => u.joined + (w + 1) * 7 * DAY <= now);
      if (!members.length || !complete) { weeksAfter.push(null); continue; }
      const n = members.filter(u => activeBetween(u.id, u.joined + w * 7 * DAY, u.joined + (w + 1) * 7 * DAY)).length;
      weeksAfter.push(Math.round(n / members.length * 100));
    }
    cohorts.push({ start: iso(start), size: members.length, weeks: weeksAfter });
  }

  // ── Headline numbers ──
  const last7 = now - 7 * DAY, prev7 = now - 14 * DAY;
  const activeUsers = from => { const s = new Set(); for (const [uid, ts] of activity) if (ts.some(t => t >= from && t < now)) s.add(uid); return s.size; };
  const activationPool = users.filter(u => u.joined <= now - 7 * DAY && u.joined >= now - 90 * DAY);
  const activated = activationPool.filter(u => (finishTimes.get(u.id) || []).some(t => t - u.joined <= 7 * DAY)).length;
  const views = db.prepare("SELECT COALESCE(SUM(views), 0) AS n FROM page_views WHERE path = 'landing' AND day >= ?").get(iso(now - 30 * DAY).slice(0, 10)).n;
  const signups30 = users.filter(u => u.joined >= now - 30 * DAY).length;
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;
  const sinceWeek = iso(last7);

  return {
    generatedAt: iso(now),
    headline: {
      users: users.length,
      pro: require('./billing').isConfigured() || count("SELECT COUNT(*) AS n FROM users WHERE plan = 'pro'") ? count("SELECT COUNT(*) AS n FROM users WHERE plan = 'pro'") : null,
      signups7: users.filter(u => u.joined >= last7).length,
      signupsPrev7: users.filter(u => u.joined >= prev7 && u.joined < last7).length,
      active7: activeUsers(last7),
      active30: activeUsers(now - 30 * DAY),
      activation: { rate: activationPool.length ? Math.round(activated / activationPool.length * 100) : null, of: activationPool.length },
      week4: { rate: funnel[4].of ? Math.round(funnel[4].count / funnel[4].of * 100) : null, of: funnel[4].of },
      // Visits are only counted from the day this shipped, so until there
      // are enough of them (and more than sign-ups) there is no honest rate.
      landing: { views30: views, signups30, since: (db.prepare("SELECT MIN(day) AS d FROM page_views WHERE path = 'landing'").get() || {}).d || null,
        rate: views >= 20 && views >= signups30 ? Math.round(signups30 / views * 1000) / 10 : null },
    },
    weeks,
    funnel,
    cohorts,
    engagement: {
      goals7: count("SELECT COUNT(*) AS n FROM projects WHERE parentId IS NULL AND createdAt >= ?", sinceWeek),
      tasksDone7: weeks[weeks.length - 1].tasksDone,
      blockersBeaten7: count('SELECT COUNT(*) AS n FROM task_obstacles WHERE resolvedAt >= ?', sinceWeek),
      remindersSet7: count('SELECT COUNT(*) AS n FROM task_reminders WHERE createdAt >= ?', sinceWeek),
      alarmsAnswered7: count('SELECT COUNT(*) AS n FROM task_reminders WHERE ackAt >= ?', sinceWeek),
      aiCalls7: count("SELECT COUNT(*) AS n FROM analytics_events WHERE event IN ('ai_call', 'assistant_call') AND createdAt >= ?", sinceWeek),
      invites7: count("SELECT COUNT(*) AS n FROM analytics_events WHERE event = 'invite_sent' AND createdAt >= ?", sinceWeek),
    },
  };
}

// The owner: anyone listed in ADMIN_EMAILS, or, when that isn't set, the
// first account ever created on this server (whoever set it up).
function isOwner(userId) {
  if (!userId) return false;
  const list = String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length) {
    const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    return !!row && list.includes(String(row.email).toLowerCase());
  }
  const first = db.prepare('SELECT id FROM users ORDER BY createdAt ASC LIMIT 1').get();
  return !!first && first.id === userId;
}

// Landing-page visits per day: a count, nothing about the visitor. Crawlers
// and headless browsers (link previews, our own screenshot tool) skip it.
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|curl|wget/i;
function countPageView(path, userAgent) {
  if (!userAgent || BOT_RE.test(userAgent)) return;
  db.prepare(`INSERT INTO page_views (day, path, views) VALUES (?, ?, 1)
    ON CONFLICT(day, path) DO UPDATE SET views = views + 1`).run(new Date().toISOString().slice(0, 10), path);
}

module.exports = { buildMetrics, isOwner, countPageView };
