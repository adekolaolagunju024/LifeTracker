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
  -- The race or group's own chat: messages, the app's own lines when
  -- someone joins, gets halfway or finishes ('event'), cheers ('cheer',
  -- to one player) and the leader's reminders ('nudge').
  CREATE TABLE IF NOT EXISTS challenge_messages (
    id TEXT PRIMARY KEY,
    challengeId TEXT NOT NULL,
    userId TEXT,
    kind TEXT NOT NULL DEFAULT 'msg',
    text TEXT NOT NULL,
    toUserId TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_challenge_messages ON challenge_messages(challengeId, createdAt);
  -- How far each person has read their race's chat, and seen their cheers.
  CREATE TABLE IF NOT EXISTS challenge_reads (
    challengeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    readAt TEXT,
    cheersSeenAt TEXT,
    PRIMARY KEY (challengeId, userId)
  );
  -- Finished races and groups someone has cleared off their Teams list.
  -- Only their list: everyone else's scoreboard keeps them.
  CREATE TABLE IF NOT EXISTS challenge_cleared (
    challengeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    clearedAt TEXT NOT NULL,
    PRIMARY KEY (challengeId, userId)
  );
`);
// Phase 2, classes and teams: "together" (everyone aims to finish; no
// winner) beside "race"; an organiser (a teacher) who runs it without a
// copy of their own; a short join code to read out in class; and how
// names show to everyone (names, first names, or animals). A group says
// who leads it (a coach, trainer, teacher, manager…), which sets its words.
for (const col of ['halfAnnounced INTEGER NOT NULL DEFAULT 0', 'finishAnnounced INTEGER NOT NULL DEFAULT 0']) {
  try { conn.exec(`ALTER TABLE challenge_members ADD COLUMN ${col}`); } catch { /* already there */ }
}
for (const col of ["mode TEXT NOT NULL DEFAULT 'race'", 'organiserOnly INTEGER NOT NULL DEFAULT 0', 'joinCode TEXT', "nameMode TEXT NOT NULL DEFAULT 'names'", 'lastNudgeAt TEXT', 'leaderRole TEXT']) {
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

const LEADER_ROLES = ['coach', 'trainer', 'teacher', 'manager', 'leader', 'organiser'];
function createChallenge(userId, { projectId, endsAt, stake, displayName, mode, organiserOnly, nameMode, leaderRole }) {
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
    leaderRole: mode === 'together' ? (LEADER_ROLES.includes(leaderRole) ? leaderRole : 'leader') : null,
    joinCode: newCode(),
  };
  conn.prepare(`INSERT INTO challenges (id, ownerId, title, icon, template, taskCount, stake, startsAt, endsAt, joinToken, createdAt, mode, organiserOnly, nameMode, leaderRole, joinCode)
    VALUES (@id, @ownerId, @title, @icon, @template, @taskCount, @stake, @startsAt, @endsAt, @joinToken, @createdAt, @mode, @organiserOnly, @nameMode, @leaderRole, @joinCode)`).run(c);
  // The maker takes part on the goal they already have, not a duplicate of
  // it. Only a race where they've already ticked steps gets them a fresh
  // copy, so everyone starts level; and a goal already in another race or
  // group keeps its place there.
  const started = tasks.some(t => t.status === 'Completed');
  const elsewhere = conn.prepare('SELECT 1 FROM challenge_members WHERE projectId = ?').get(top);
  if (!c.organiserOnly) addMember(c, userId, displayName, (c.mode === 'together' || !started) && !elsewhere ? top : null);
  return c;
}

// A fresh copy of the goal for one player, with the due dates spread
// evenly from now to the deadline; or, for the maker, their own goal.
function addMember(c, userId, displayName, ownProjectId = null) {
  const template = JSON.parse(c.template);
  const now = Date.now();
  const end = Date.parse(c.endsAt);
  const project = ownProjectId ? { id: ownProjectId } : db.createProject(userId, {
    id: crypto.randomUUID(), title: `${template.title} · race`, description: c.stake ? `Race stake: ${c.stake}` : '',
    icon: template.icon, color: template.color, type: template.type, isGoal: true,
    startDate: dateKey(now), createdAt: new Date(now).toISOString(),
  });
  const n = template.tasks.length;
  if (!ownProjectId) template.tasks.forEach((t, i) => {
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
  if (userId !== c.ownerId) postEvent(c.id, `${shownName(c, { userId, displayName: name })} joined`, userId);
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
  return { id: c.id, title: c.title, icon: c.icon, stake: c.stake, endsAt: c.endsAt, taskCount: c.taskCount, owner, players, full: players >= maxFor(c), mode: c.mode, nameMode: c.nameMode, leaderRole: c.leaderRole || null, token: c.joinToken };
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
      done: p.done, total: c.taskCount, frac: p.frac, finished: p.finished, finishedAt: p.finishedAt, joinedAt: m.joinedAt, left: p.left,
      pace: p.finished ? 'finished' : gap >= 0.05 ? 'ahead' : gap >= -0.05 ? 'on pace' : 'behind',
      // The organiser sees when each person last ticked a step, to know who to check on.
      ...(organiser ? { lastStepAt: p.lastStepAt } : {}),
      ...(you ? { projectId: m.projectId } : {}),
    };
  }).filter(p => !p.left);
  players.sort((a, b) => (b.finished - a.finished) || (a.finished ? String(a.finishedAt).localeCompare(String(b.finishedAt)) : b.frac - a.frac));
  const together = c.mode === 'together';
  // Finishing places in a race: 1st, 2nd, 3rd... by when each player
  // ticked their last step (the same moment shares a place). A class or
  // team isn't a competition, so no places there.
  if (!together) {
    let place = 0, prevAt = null;
    players.filter(p => p.finished).forEach((p, i) => {
      if (p.finishedAt !== prevAt) place = i + 1;
      prevAt = p.finishedAt;
      p.place = place;
    });
  }
  announce(c, members, players);
  const winner = !together && (players.find(p => p.finished) || null);
  const steps = players.reduce((a, p) => a + p.done, 0);
  const me = players.find(p => p.you);
  // Finished as far as you're concerned: time's up, you've finished, or
  // (when you only organise it) everyone has.
  const doneForYou = now > end || (me ? me.finished : players.length > 0 && players.every(p => p.finished));
  return {
    doneForYou,
    id: c.id, title: c.title, icon: c.icon, stake: c.stake, startsAt: c.startsAt, endsAt: c.endsAt, taskCount: c.taskCount,
    mode: c.mode, nameMode: c.nameMode, organiserOnly: !!c.organiserOnly, leaderRole: c.leaderRole || (c.mode === 'together' ? 'leader' : null),
    expected, over: now > end, winner: winner ? { name: winner.name, you: winner.you, finishedAt: winner.finishedAt } : null,
    yourPlace: (players.find(p => p.you) || {}).place || null,
    group: { finished: players.filter(p => p.finished).length, players: players.length, stepsPct: players.length ? Math.round((steps / (players.length * c.taskCount)) * 100) : 0, behind: players.filter(p => p.pace === 'behind').length },
    owner: organiser, joinToken: c.joinToken, joinCode: c.joinCode,
    lastNudgeAt: organiser ? c.lastNudgeAt : undefined,
    chat: chatSummary(c.id, viewerId),
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
    WHERE (m.userId = ? OR c.ownerId = ?)
      AND NOT EXISTS (SELECT 1 FROM challenge_cleared x WHERE x.challengeId = c.id AND x.userId = ?)
    ORDER BY c.createdAt DESC`)
    .all(userId, userId, userId).map(c => standings(c, userId)).filter(s => s.owner || s.players.some(p => p.you));
}
// Clearing a finished one off your list (and putting it back). One still
// running can't be cleared: leave it instead.
function clear(id, userId) {
  const s = get(id, userId);
  if (!s) return null;
  if (!s.doneForYou) throw Object.assign(new Error("It's still running. Leave it instead, or clear it once it's finished"), { status: 400 });
  conn.prepare('INSERT OR IGNORE INTO challenge_cleared (challengeId, userId, clearedAt) VALUES (?,?,?)').run(id, userId, new Date().toISOString());
  return true;
}
function unclear(id, userId) {
  if (!get(id, userId)) return null;
  conn.prepare('DELETE FROM challenge_cleared WHERE challengeId = ? AND userId = ?').run(id, userId);
  return true;
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
  postMessage(c.id, userId, `Keep going, everyone: the finish is ${new Date(c.endsAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}.`, 'nudge');
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
// ── The race or group's chat ──────────────────────────────────────────
const ord = n => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
function postMessage(cid, userId, text, kind = 'msg', toUserId = null) {
  const m = { id: crypto.randomUUID(), challengeId: cid, userId, kind, text, toUserId, createdAt: new Date().toISOString() };
  conn.prepare('INSERT INTO challenge_messages (id, challengeId, userId, kind, text, toUserId, createdAt) VALUES (@id, @challengeId, @userId, @kind, @text, @toUserId, @createdAt)').run(m);
  return m;
}
const postEvent = (cid, text, userId = null) => postMessage(cid, userId, text, 'event');
// The app's own lines, once each: someone halfway, someone finished (with
// their place in a race). Checked whenever the scoreboard is worked out.
function announce(c, members, players) {
  const byUser = new Map(members.map(m => [m.userId, m]));
  players.forEach(p => {
    const m = byUser.get(p.userId);
    if (!m) return;
    const name = shownName(c, m);
    if (p.finished && !m.finishAnnounced) {
      conn.prepare('UPDATE challenge_members SET finishAnnounced = 1, halfAnnounced = 1 WHERE challengeId = ? AND userId = ?').run(c.id, m.userId);
      postEvent(c.id, p.place ? `${name} finished ${ord(p.place)}${p.place <= 3 ? ` ${['', '🥇', '🥈', '🥉'][p.place]}` : ''}` : `${name} finished 🏁`, m.userId);
    } else if (!p.finished && p.frac >= 0.5 && !m.halfAnnounced) {
      conn.prepare('UPDATE challenge_members SET halfAnnounced = 1 WHERE challengeId = ? AND userId = ?').run(c.id, m.userId);
      postEvent(c.id, `${name} is halfway`, m.userId);
    }
  });
}
// Who wrote it, as this viewer should see it: a player by their shown
// name (real names for the organiser), the leader by role and name.
function authorOf(c, userId, viewerId) {
  if (!userId) return { name: 'Waypoint', color: '#64748B' };
  const m = memberRow(c.id, userId);
  if (m) return { name: userId === viewerId ? 'You' : c.ownerId === viewerId ? m.displayName : shownName(c, m), color: m.color };
  const prof = (db.getProfile(userId) || {}).name || 'The organiser';
  const ROLE = { coach: 'Coach', trainer: 'Trainer', teacher: 'Teacher', manager: 'Manager', leader: 'Team leader', organiser: 'Organiser' };
  return { name: userId === viewerId ? 'You' : c.mode === 'together' ? `${ROLE[c.leaderRole] || 'Leader'} ${prof}` : prof, color: '#0D1B2A', leader: true };
}
const readRow = (cid, userId) => conn.prepare('SELECT * FROM challenge_reads WHERE challengeId = ? AND userId = ?').get(cid, userId) || {};
// For the scoreboard: unread count, the last line, cheers you haven't seen.
function chatSummary(cid, viewerId) {
  const r = readRow(cid, viewerId);
  const unread = conn.prepare("SELECT COUNT(*) AS n FROM challenge_messages WHERE challengeId = ? AND createdAt > ? AND (userId IS NULL OR userId != ?)").get(cid, r.readAt || '', viewerId).n;
  const last = conn.prepare('SELECT * FROM challenge_messages WHERE challengeId = ? ORDER BY createdAt DESC LIMIT 1').get(cid);
  const cheers = conn.prepare("SELECT * FROM challenge_messages WHERE challengeId = ? AND kind = 'cheer' AND toUserId = ? AND createdAt > ? ORDER BY createdAt").all(cid, viewerId, r.cheersSeenAt || '');
  const c = byId(cid);
  return {
    unread,
    last: last ? { text: describe(c, last, viewerId), createdAt: last.createdAt, kind: last.kind } : null,
    cheers: cheers.map(m => ({ from: authorOf(c, m.userId, viewerId).name, emoji: m.text, at: m.createdAt })),
  };
}
function describe(c, m, viewerId) {
  if (m.kind === 'cheer') {
    const to = m.toUserId === viewerId ? 'you' : authorOf(c, m.toUserId, viewerId).name;
    return `${authorOf(c, m.userId, viewerId).name} cheered ${to} ${m.text}`;
  }
  if (m.kind === 'event') return m.text;
  return `${authorOf(c, m.userId, viewerId).name}: ${m.text}`;
}
const canChat = (c, userId) => !!c && (c.ownerId === userId || isMember(c.id, userId));
// The thread (the last 200 lines), marking it read.
function messages(id, userId) {
  const c = byId(id);
  if (!canChat(c, userId)) return null;
  const rows = conn.prepare('SELECT * FROM (SELECT * FROM challenge_messages WHERE challengeId = ? ORDER BY createdAt DESC LIMIT 200) ORDER BY createdAt').all(c.id);
  const now = new Date().toISOString();
  conn.prepare('INSERT INTO challenge_reads (challengeId, userId, readAt) VALUES (?,?,?) ON CONFLICT(challengeId, userId) DO UPDATE SET readAt = excluded.readAt').run(c.id, userId, now);
  return rows.map(m => {
    const a = authorOf(c, m.userId, userId);
    return { id: m.id, kind: m.kind, text: m.kind === 'cheer' ? describe(c, m, userId) : m.text, author: a.name, color: a.color, leader: !!a.leader, you: m.userId === userId, createdAt: m.createdAt };
  });
}
function say(id, userId, text) {
  const c = byId(id);
  if (!canChat(c, userId)) return null;
  const t = clean(text, 1000);
  if (!t) throw Object.assign(new Error('Write something first'), { status: 400 });
  return postMessage(c.id, userId, t, 'msg');
}
// A cheer for one player, picked by their colour (no ids leave the server).
const CHEERS = ['👏', '🔥', '💪', '🚀', '🎉'];
function cheer(id, userId, color, emoji) {
  const c = byId(id);
  if (!canChat(c, userId)) return null;
  const to = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND color = ?').get(c.id, String(color || ''));
  if (!to) throw Object.assign(new Error('That player has left'), { status: 404 });
  if (to.userId === userId) throw Object.assign(new Error("You can't cheer yourself on. Try a friend"), { status: 400 });
  const recent = conn.prepare("SELECT COUNT(*) AS n FROM challenge_messages WHERE challengeId = ? AND userId = ? AND kind = 'cheer' AND createdAt > ?").get(c.id, userId, new Date(Date.now() - 60000).toISOString()).n;
  if (recent >= 6) throw Object.assign(new Error('Easy there. Give the cheers a minute'), { status: 429 });
  return postMessage(c.id, userId, CHEERS.includes(emoji) ? emoji : '👏', 'cheer', to.userId);
}
function cheersSeen(id, userId) {
  const c = byId(id);
  if (!canChat(c, userId)) return null;
  conn.prepare('INSERT INTO challenge_reads (challengeId, userId, cheersSeenAt) VALUES (?,?,?) ON CONFLICT(challengeId, userId) DO UPDATE SET cheersSeenAt = excluded.cheersSeenAt').run(c.id, userId, new Date().toISOString());
  return true;
}

// Leaving takes you off the road; your copy of the goal stays yours.
function leave(id, userId) {
  return conn.prepare('DELETE FROM challenge_members WHERE challengeId = ? AND userId = ?').run(id, userId).changes > 0;
}

module.exports = { createChallenge, preview, previewByCode, join, get, forProject, listMine, clear, unclear, messages, say, cheer, cheersSeen, leave, remind, nudgesSince, MAX_PLAYERS, MAX_TOGETHER };
