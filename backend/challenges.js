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
  CREATE TABLE IF NOT EXISTS challenge_nudges (
    challengeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);
// Phase 2, classes and teams: "together" (everyone aims to finish; no
// winner) beside "race"; an organiser (a teacher) who runs it without a
// copy of their own; a short join code to read out in class; and how
// names show to everyone (names, first names, or animals).
for (const col of ["mode TEXT NOT NULL DEFAULT 'race'", 'organiserOnly INTEGER NOT NULL DEFAULT 0', 'joinCode TEXT', "nameMode TEXT NOT NULL DEFAULT 'names'", 'lastNudgeAt TEXT']) {
  try { conn.exec(`ALTER TABLE challenges ADD COLUMN ${col}`); } catch { /* already there */ }
}
conn.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_code ON challenges(joinCode) WHERE joinCode IS NOT NULL');

const MAX_PLAYERS = 30;      // a race
const MAX_TOGETHER = 60;     // a class or team
const maxFor = c => (c.mode === 'together' ? MAX_TOGETHER : MAX_PLAYERS);
// Easy to read out loud and type: no 0/O, 1/I/L.
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let i = 0; i < 20; i++) {
    const code = Array.from(crypto.randomBytes(6), b => CODE_ABC[b % CODE_ABC.length]).join('');
    if (!conn.prepare('SELECT 1 FROM challenges WHERE joinCode = ?').get(code)) return code;
  }
  throw new Error('Could not make a join code');
}
const ANIMALS = ['Fox', 'Otter', 'Panda', 'Hawk', 'Koala', 'Lynx', 'Puffin', 'Badger', 'Heron', 'Gecko', 'Bison', 'Lemur', 'Falcon', 'Hedgehog', 'Dolphin', 'Owl', 'Tiger', 'Zebra', 'Moose', 'Robin', 'Seal', 'Wolf', 'Yak', 'Camel', 'Raven', 'Llama', 'Beaver', 'Cheetah', 'Kiwi', 'Penguin'];
const ADJ = ['Swift', 'Brave', 'Calm', 'Bright', 'Bold', 'Clever', 'Keen', 'Lucky', 'Quick', 'Steady'];
const animalName = (cid, userId) => {
  const h = crypto.createHash('sha256').update(`${cid}:${userId}`).digest();
  return `${ADJ[h[0] % ADJ.length]} ${ANIMALS[h[1] % ANIMALS.length]}`;
};
// The name everyone else sees, by the organiser's choice.
function shownName(c, m) {
  if (c.nameMode === 'animals') return animalName(c.id, m.userId);
  if (c.nameMode === 'first') return m.displayName.split(' ')[0];
  return m.displayName;
}
// Distinct, readable on every Journey world; the maker always gets the first.
const COLORS = ['#0A7E8C', '#E4572E', '#7C3AED', '#F59E0B', '#2563EB', '#DB2777', '#16A34A', '#0891B2', '#9333EA', '#CA8A04'];
const DAY = 86400000;

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const dateKey = ms => new Date(ms).toISOString().slice(0, 10);

function createChallenge(userId, { projectId, endsAt, stake, displayName, mode, organiserOnly, nameMode }) {
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
    mode: mode === 'together' ? 'together' : 'race',
    organiserOnly: mode === 'together' && organiserOnly ? 1 : 0,
    nameMode: ['names', 'first', 'animals'].includes(nameMode) ? nameMode : 'names',
    joinCode: newCode(),
  };
  conn.prepare(`INSERT INTO challenges (id, ownerId, title, icon, template, taskCount, stake, startsAt, endsAt, joinToken, createdAt, mode, organiserOnly, nameMode, joinCode)
    VALUES (@id, @ownerId, @title, @icon, @template, @taskCount, @stake, @startsAt, @endsAt, @joinToken, @createdAt, @mode, @organiserOnly, @nameMode, @joinCode)`).run(c);
  if (!c.organiserOnly) addMember(c, userId, displayName);
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
const byCode = code => (code ? conn.prepare('SELECT * FROM challenges WHERE joinCode = ?').get(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')) : undefined);
const byId = id => conn.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
const memberRow = (cid, userId) => conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND userId = ?').get(cid, userId);

// What someone sees before joining: no players' progress, just the race.
function preview(token) {
  const c = byToken(token);
  if (!c) return null;
  const owner = (db.getProfile(c.ownerId) || {}).name || 'A friend';
  const players = conn.prepare('SELECT COUNT(*) AS n FROM challenge_members WHERE challengeId = ?').get(c.id).n;
  return { id: c.id, title: c.title, icon: c.icon, stake: c.stake, endsAt: c.endsAt, taskCount: c.taskCount, owner, players, full: players >= maxFor(c), mode: c.mode, nameMode: c.nameMode, token: c.joinToken };
}

// The same, from the short code read out in class.
const previewByCode = code => { const c = byCode(code); return c ? preview(c.joinToken) : null; };
function join(token, userId, displayName) {
  const c = byToken(token);
  if (!c) throw Object.assign(new Error('That race link is not valid any more'), { status: 404 });
  const already = memberRow(c.id, userId);
  if (already) return { challenge: c, projectId: already.projectId, already: true };
  if (Date.parse(c.endsAt) < Date.now()) throw Object.assign(new Error('That race has already finished'), { status: 400 });
  const count = conn.prepare('SELECT COUNT(*) AS n FROM challenge_members WHERE challengeId = ?').get(c.id).n;
  if (count >= maxFor(c)) throw Object.assign(new Error(c.mode === 'together' ? 'That group is full' : 'That race is full'), { status: 400 });
  if (c.ownerId === userId && c.organiserOnly) throw Object.assign(new Error("You're organising this one, so you don't have a copy to race"), { status: 400 });
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
  const lastStepAt = done.map(r => r.completedAt).filter(Boolean).sort().pop() || null;
  const finishedAt = finished ? lastStepAt : null;
  return { done: Math.min(done.length, taskCount), frac: Math.min(1, done.length / taskCount), finished, finishedAt, lastStepAt, left: !alive };
}

// The scoreboard: every player, their progress and pace, in race order.
function standings(c, viewerId) {
  const members = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? ORDER BY joinedAt').all(c.id);
  const start = Date.parse(c.startsAt), end = Date.parse(c.endsAt), now = Date.now();
  const expected = Math.max(0, Math.min(1, (now - start) / ((end - start) || 1)));
  const organiser = c.ownerId === viewerId;
  const players = members.map(m => {
    const p = progressOf(m, c.taskCount);
    const gap = p.frac - expected;
    const you = m.userId === viewerId;
    return {
      // The organiser (a teacher) always sees real names; everyone else as the organiser chose.
      userId: m.userId, name: you || organiser ? m.displayName : shownName(c, m), color: m.color, you,
      done: p.done, total: c.taskCount, frac: p.frac, finished: p.finished, finishedAt: p.finishedAt, left: p.left,
      pace: p.finished ? 'finished' : gap >= 0.05 ? 'ahead' : gap >= -0.05 ? 'on pace' : 'behind',
      // The organiser sees when each person last ticked a step, to know who to check on.
      ...(organiser ? { lastStepAt: p.lastStepAt } : {}),
      ...(you ? { projectId: m.projectId } : {}),
    };
  }).filter(p => !p.left);
  players.sort((a, b) => (b.finished - a.finished) || (a.finished ? String(a.finishedAt).localeCompare(String(b.finishedAt)) : b.frac - a.frac));
  const together = c.mode === 'together';
  const winner = !together && (players.find(p => p.finished) || null);
  const steps = players.reduce((a, p) => a + p.done, 0);
  return {
    id: c.id, title: c.title, icon: c.icon, stake: c.stake, startsAt: c.startsAt, endsAt: c.endsAt, taskCount: c.taskCount,
    mode: c.mode, nameMode: c.nameMode, organiserOnly: !!c.organiserOnly,
    expected, over: now > end, winner: winner ? { name: winner.name, you: winner.you, finishedAt: winner.finishedAt } : null,
    group: { finished: players.filter(p => p.finished).length, players: players.length, stepsPct: players.length ? Math.round((steps / (players.length * c.taskCount)) * 100) : 0, behind: players.filter(p => p.pace === 'behind').length },
    owner: organiser, joinToken: c.joinToken, joinCode: c.joinCode,
    lastNudgeAt: organiser ? c.lastNudgeAt : undefined,
    players,
  };
}

const isMember = (cid, userId) => !!memberRow(cid, userId);
function get(id, userId) {
  const c = byId(id);
  return c && (isMember(c.id, userId) || c.ownerId === userId) ? standings(c, userId) : null;
}
// The race a project is someone's copy for (for the Journey).
function forProject(projectId, userId) {
  const m = conn.prepare('SELECT * FROM challenge_members WHERE projectId = ? AND userId = ?').get(db.topLevelProjectId(projectId), userId);
  return m ? standings(byId(m.challengeId), userId) : null;
}
function listMine(userId) {
  return conn.prepare(`SELECT DISTINCT c.* FROM challenges c LEFT JOIN challenge_members m ON m.challengeId = c.id
    WHERE m.userId = ? OR c.ownerId = ? ORDER BY c.createdAt DESC`)
    .all(userId, userId).map(c => standings(c, userId)).filter(s => s.owner || s.players.some(p => p.you));
}

// The organiser nudges everyone who's behind (or hasn't started): a note
// in their bell, and a push where they've turned push on. Once every 12
// hours, so it stays a nudge.
const NUDGE_GAP = 12 * 3600000;
function remind(id, userId) {
  const c = byId(id);
  if (!c || c.ownerId !== userId) throw Object.assign(new Error('Only the organiser can send reminders'), { status: 403 });
  if (c.lastNudgeAt && Date.now() - Date.parse(c.lastNudgeAt) < NUDGE_GAP) {
    throw Object.assign(new Error('You sent a reminder recently. You can send another later today'), { status: 429 });
  }
  const board = standings(c, userId);
  const who = board.players.filter(p => !p.finished && (p.pace === 'behind' || p.done === 0) && p.userId !== userId);
  const now = new Date().toISOString();
  const text = `A nudge for ${c.title}: keep going, the finish is ${new Date(c.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const add = conn.prepare('INSERT INTO challenge_nudges (challengeId, userId, text, createdAt) VALUES (?,?,?,?)');
  who.forEach(p => add.run(c.id, p.userId, text, now));
  conn.prepare('UPDATE challenges SET lastNudgeAt = ? WHERE id = ?').run(now, c.id);
  try {
    const { sendPushToUser } = require('./push/webpush');
    who.forEach(p => sendPushToUser(p.userId, { title: c.title, body: text, url: '/app', tag: `nudge-${c.id}` }).catch(() => {}));
  } catch { /* push not set up */ }
  return who.length;
}
// Nudges since a time, for the notification bell.
function nudgesSince(userId, since) {
  return conn.prepare(`SELECT n.challengeId, n.text, n.createdAt, c.title FROM challenge_nudges n JOIN challenges c ON c.id = n.challengeId
    WHERE n.userId = ? AND n.createdAt > ? ORDER BY n.createdAt DESC LIMIT 10`).all(userId, since);
}
// Leaving takes you off the road; your copy of the goal stays yours.
function leave(id, userId) {
  return conn.prepare('DELETE FROM challenge_members WHERE challengeId = ? AND userId = ?').run(id, userId).changes > 0;
}

module.exports = { createChallenge, preview, previewByCode, join, get, forProject, listMine, leave, remind, nudgesSince, MAX_PLAYERS, MAX_TOGETHER };
