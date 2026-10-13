const crypto = require('crypto');
const conn = require('./db/connection');
const db = require('./db/db');

// ── CHALLENGES: RACE A FRIEND ───────────────────────────────────
// One goal, raced by several people, each on their own copy. Made from one
// of your goals: its tasks are snapshotted, and everyone who joins
// (the maker too) gets a fresh copy with every task to do and the due
// dates spread evenly up to the race's deadline. Progress counts against
// the snapshot's number of tasks, so deleting tasks from your copy never
// gets you there sooner. You finish when every task in your copy is done
// (and at least as many as the snapshot had); your finish time is when
// the last of them was ticked, so the winner is decided by the tasks
// themselves, not by who happened to open the app first.
//
// A stake is a promise in words ("loser buys dinner"), never money: Waypoint
// doesn't hold or move money between players.
conn.exec(`
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    title TEXT NOT NULL,
    icon TEXT,
    template TEXT NOT NULL,
    taskCount INTEGER NOT NULL,
    stake TEXT,
    startsAt TEXT NOT NULL,
    endsAt TEXT NOT NULL,
    joinToken TEXT NOT NULL UNIQUE,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS challenge_members (
    challengeId TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    userId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    displayName TEXT NOT NULL,
    color TEXT NOT NULL,
    joinedAt TEXT NOT NULL,
    PRIMARY KEY (challengeId, userId)
  );
  CREATE INDEX IF NOT EXISTS idx_challenge_members_project ON challenge_members(projectId);
`);

const MAX_PLAYERS = 30;
// Distinct, readable on every Journey world; the maker always gets the first.
const COLORS = ['#0A7E8C', '#E4572E', '#7C3AED', '#F59E0B', '#2563EB', '#DB2777', '#16A34A', '#0891B2', '#9333EA', '#CA8A04'];
const DAY = 86400000;

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const dateKey = ms => new Date(ms).toISOString().slice(0, 10);

function createChallenge(userId, { projectId, endsAt, stake, displayName }) {
  const top = db.topLevelProjectId(projectId);
  const project = db.getProjectById(userId, top);
  if (!project) throw Object.assign(new Error('Goal not found'), { status: 404 });
  const tree = new Set([top, ...db.listProjects(userId, { parentId: top }).map(p => p.id)]);
  const tasks = db.listTasks(userId).filter(t => tree.has(t.projectId))
    .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999') || (a.sortOrder || 0) - (b.sortOrder || 0));
  if (!tasks.length) throw Object.assign(new Error('Add some tasks to this goal first, so there is something to race'), { status: 400 });
  if (tasks.length > 200) throw Object.assign(new Error('That goal has too many tasks to race (200 at most)'), { status: 400 });
  const now = Date.now();
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end) || end < now + DAY / 2) throw Object.assign(new Error('Pick a finish date at least a day from now'), { status: 400 });
  if (end > now + 366 * DAY) throw Object.assign(new Error('Pick a finish date within a year'), { status: 400 });

  const template = { title: project.title, icon: project.icon || '🏁', color: project.color || '#0A7E8C', type: project.type || 'personal', tasks: tasks.map(t => ({ title: t.title, priority: t.priority || 'Medium', notes: t.notes || '' })) };
  const c = {
    id: crypto.randomUUID(), ownerId: userId, title: clean(project.title, 120), icon: template.icon,
    template: JSON.stringify(template), taskCount: tasks.length, stake: clean(stake, 140) || null,
    startsAt: new Date(now).toISOString(), endsAt: new Date(end).toISOString(),
    joinToken: crypto.randomBytes(16).toString('hex'), createdAt: new Date(now).toISOString(),
  };
  conn.prepare(`INSERT INTO challenges (id, ownerId, title, icon, template, taskCount, stake, startsAt, endsAt, joinToken, createdAt)
    VALUES (@id, @ownerId, @title, @icon, @template, @taskCount, @stake, @startsAt, @endsAt, @joinToken, @createdAt)`).run(c);
  addMember(c, userId, displayName);
  return c;
}

// A fresh copy of the goal for one player, with the due dates spread
// evenly from now to the deadline.
function addMember(c, userId, displayName) {
  const template = JSON.parse(c.template);
  const now = Date.now();
  const end = Date.parse(c.endsAt);
  const project = db.createProject(userId, {
    id: crypto.randomUUID(), title: `${template.title} · race`, description: c.stake ? `Race stake: ${c.stake}` : '',
    icon: template.icon, color: template.color, type: template.type, isGoal: true,
    startDate: dateKey(now), createdAt: new Date(now).toISOString(),
  });
  const n = template.tasks.length;
  template.tasks.forEach((t, i) => {
    db.createTask(userId, {
      id: crypto.randomUUID(), projectId: project.id, title: t.title, priority: t.priority, notes: t.notes,
      status: 'Not Started', startDate: dateKey(now + (end - now) * (i / n)), endDate: dateKey(now + (end - now) * ((i + 1) / n)),
      createdAt: new Date().toISOString(),
    });
  });
  const used = conn.prepare('SELECT color FROM challenge_members WHERE challengeId = ?').all(c.id).map(r => r.color);
  const color = COLORS.find(col => !used.includes(col)) || COLORS[used.length % COLORS.length];
  const name = clean(displayName, 24) || clean((db.getProfile(userId) || {}).name, 24) || 'Player';
  conn.prepare('INSERT INTO challenge_members (challengeId, userId, projectId, displayName, color, joinedAt) VALUES (?,?,?,?,?,?)')
    .run(c.id, userId, project.id, name, color, new Date().toISOString());
  return project;
}

const byToken = token => (token ? conn.prepare('SELECT * FROM challenges WHERE joinToken = ?').get(String(token)) : undefined);
const byId = id => conn.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
const memberRow = (cid, userId) => conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND userId = ?').get(cid, userId);

// What someone sees before joining: no players' progress, just the race.
function preview(token) {
  const c = byToken(token);
  if (!c) return null;
  const owner = (db.getProfile(c.ownerId) || {}).name || 'A friend';
  const players = conn.prepare('SELECT COUNT(*) AS n FROM challenge_members WHERE challengeId = ?').get(c.id).n;
  return { id: c.id, title: c.title, icon: c.icon, stake: c.stake, endsAt: c.endsAt, taskCount: c.taskCount, owner, players, full: players >= MAX_PLAYERS };
}

function join(token, userId, displayName) {
  const c = byToken(token);
  if (!c) throw Object.assign(new Error('That race link is not valid any more'), { status: 404 });
  const already = memberRow(c.id, userId);
  if (already) return { challenge: c, projectId: already.projectId, already: true };
  if (Date.parse(c.endsAt) < Date.now()) throw Object.assign(new Error('That race has already finished'), { status: 400 });
  const count = conn.prepare('SELECT COUNT(*) AS n FROM challenge_members WHERE challengeId = ?').get(c.id).n;
  if (count >= MAX_PLAYERS) throw Object.assign(new Error('That race is full'), { status: 400 });
  const project = addMember(c, userId, displayName);
  return { challenge: c, projectId: project.id, already: false };
}

// One player's progress, from the tasks in their copy (including any
// sub-folders they've added). Their copy deleted: they've left.
function progressOf(m, taskCount) {
  const rows = conn.prepare(`SELECT t.status, t.completedAt FROM tasks t JOIN projects p ON p.id = t.projectId
    WHERE (p.id = ? OR p.parentId = ?) AND t.deletedAt IS NULL AND p.deletedAt IS NULL`).all(m.projectId, m.projectId);
  const alive = conn.prepare('SELECT 1 FROM projects WHERE id = ? AND deletedAt IS NULL').get(m.projectId);
  const done = rows.filter(r => r.status === 'Completed');
  const finished = !!alive && rows.length > 0 && done.length === rows.length && done.length >= taskCount;
  const finishedAt = finished ? done.map(r => r.completedAt).filter(Boolean).sort().pop() || null : null;
  return { done: Math.min(done.length, taskCount), frac: Math.min(1, done.length / taskCount), finished, finishedAt, left: !alive };
}

// The scoreboard: every player, their progress and pace, in race order.
function standings(c, viewerId) {
  const members = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? ORDER BY joinedAt').all(c.id);
  const start = Date.parse(c.startsAt), end = Date.parse(c.endsAt), now = Date.now();
  const expected = Math.max(0, Math.min(1, (now - start) / ((end - start) || 1)));
  const players = members.map(m => {
    const p = progressOf(m, c.taskCount);
    const gap = p.frac - expected;
    return {
      userId: m.userId, name: m.displayName, color: m.color, you: m.userId === viewerId,
      done: p.done, total: c.taskCount, frac: p.frac, finished: p.finished, finishedAt: p.finishedAt, left: p.left,
      pace: p.finished ? 'finished' : gap >= 0.05 ? 'ahead' : gap >= -0.05 ? 'on pace' : 'behind',
      ...(m.userId === viewerId ? { projectId: m.projectId } : {}),
    };
  }).filter(p => !p.left);
  players.sort((a, b) => (b.finished - a.finished) || (a.finished ? String(a.finishedAt).localeCompare(String(b.finishedAt)) : b.frac - a.frac));
  const winner = players.find(p => p.finished) || null;
  return {
    id: c.id, title: c.title, icon: c.icon, stake: c.stake, startsAt: c.startsAt, endsAt: c.endsAt, taskCount: c.taskCount,
    expected, over: now > end, winner: winner && { name: winner.name, you: winner.you, finishedAt: winner.finishedAt },
    owner: c.ownerId === viewerId, ...(c.ownerId === viewerId || memberRow(c.id, viewerId) ? { joinToken: c.joinToken } : {}),
    players,
  };
}

const isMember = (cid, userId) => !!memberRow(cid, userId);
function get(id, userId) {
  const c = byId(id);
  return c && isMember(c.id, userId) ? standings(c, userId) : null;
}
// The race a project is someone's copy for (for the Journey).
function forProject(projectId, userId) {
  const m = conn.prepare('SELECT * FROM challenge_members WHERE projectId = ? AND userId = ?').get(db.topLevelProjectId(projectId), userId);
  return m ? standings(byId(m.challengeId), userId) : null;
}
function listMine(userId) {
  return conn.prepare(`SELECT c.* FROM challenges c JOIN challenge_members m ON m.challengeId = c.id WHERE m.userId = ? ORDER BY c.createdAt DESC`)
    .all(userId).map(c => standings(c, userId)).filter(s => s.players.some(p => p.you));
}
// Leaving takes you off the road; your copy of the goal stays yours.
function leave(id, userId) {
  return conn.prepare('DELETE FROM challenge_members WHERE challengeId = ? AND userId = ?').run(id, userId).changes > 0;
}

module.exports = { createChallenge, preview, join, get, forProject, listMine, leave, MAX_PLAYERS };
