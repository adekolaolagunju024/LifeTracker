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
// A stake is a promise in words ("loser buys dinner"), never money: KolaWay
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
// Split the work: one shared goal (goalId), each step assigned to someone.
try { conn.exec('ALTER TABLE challenges ADD COLUMN goalId TEXT'); } catch { /* already there */ }
for (const col of ["mode TEXT NOT NULL DEFAULT 'race'", 'organiserOnly INTEGER NOT NULL DEFAULT 0', 'joinCode TEXT', "nameMode TEXT NOT NULL DEFAULT 'names'", 'lastNudgeAt TEXT', 'leaderRole TEXT']) {
  try { conn.exec(`ALTER TABLE challenges ADD COLUMN ${col}`); } catch { /* already there */ }
}
// How a step is checked (proof and sign-off): 'none' trusts everyone,
// 'proof' wants a photo or a note for each step before it counts, and
// 'leader' wants the leader to approve each one. Proofs live here, one
// row per player per step: submitted, approved or sent back (rejected).
try { conn.exec("ALTER TABLE challenges ADD COLUMN checks TEXT NOT NULL DEFAULT 'none'"); } catch { /* already there */ }
try { conn.exec('ALTER TABLE challenge_members ADD COLUMN speedFlagged INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }
try { conn.exec('ALTER TABLE challenge_messages ADD COLUMN attachmentId TEXT'); } catch { /* already there */ }
// Asking for help on a blocker: a 'help' message points at the blocker
// (refId) and is closed when it's cleared; offers ('offer') point at the
// help message.
// A message about one task (a blocker, proof, a step handed over, or a
// message sent from a task) carries its taskId, so the chat can open it.
for (const col of ['refId TEXT', 'closedAt TEXT', 'taskId TEXT']) {
  try { conn.exec(`ALTER TABLE challenge_messages ADD COLUMN ${col}`); } catch { /* already there */ }
}
conn.exec(`
  CREATE TABLE IF NOT EXISTS challenge_steps (
    challengeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    taskId TEXT NOT NULL,
    proofText TEXT,
    attachmentId TEXT,
    status TEXT NOT NULL DEFAULT 'submitted',
    note TEXT,
    createdAt TEXT NOT NULL,
    decidedAt TEXT,
    PRIMARY KEY (challengeId, userId, taskId)
  );
`);
conn.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_code ON challenges(joinCode) WHERE joinCode IS NOT NULL');
// Split the work, for a company or a department: a phase (a sub-folder of
// the goal) can have a lead, who sees every step in it, hands them out and
// signs them off; and with 'milestones' sign-off only the steps marked as
// milestones wait for approval, the rest count when ticked.
// A split team can call its sections departments instead of phases
// (sections = 'departments'); then each person belongs to one (deptId,
// set by the leader, or else the section they lead or have most steps in),
// the scoreboard shows progress per department, and @Department in the
// chat reaches everyone in it.
try { conn.exec('ALTER TABLE challenges ADD COLUMN sections TEXT'); } catch { /* already there */ }
try { conn.exec('ALTER TABLE challenge_members ADD COLUMN deptId TEXT'); } catch { /* already there */ }
// Managing a team: people the leader has removed can't join again with
// the link or code until the leader lets them back in.
conn.exec(`
  CREATE TABLE IF NOT EXISTS challenge_removed (
    challengeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    displayName TEXT NOT NULL,
    removedAt TEXT NOT NULL,
    PRIMARY KEY (challengeId, userId)
  );
`);
conn.exec(`
  CREATE TABLE IF NOT EXISTS challenge_leads (
    challengeId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    userId TEXT NOT NULL,
    PRIMARY KEY (challengeId, projectId)
  );
  CREATE TABLE IF NOT EXISTS challenge_milestones (
    challengeId TEXT NOT NULL,
    taskId TEXT NOT NULL,
    PRIMARY KEY (challengeId, taskId)
  );
`);

// A group (no winner, a leader): a class or squad on copies ('together'),
// or a team splitting one shared goal between them ('split').
const isGroup = c => c && (c.mode === 'together' || c.mode === 'split');
const MAX_PLAYERS = 30;      // a race
const MAX_TOGETHER = 60;     // a class or team
const maxFor = c => (isGroup(c) ? MAX_TOGETHER : MAX_PLAYERS);
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
// A race has no leader to sign steps off, so it's trust or proof; a group
// can also have its leader approve each step (and does unless told not to).
// A split team can also sign off only the steps marked as milestones.
const checksFor = (mode, checks) => (mode === 'together' || mode === 'split'
  ? (['none', 'proof', 'leader'].includes(checks) || (mode === 'split' && checks === 'milestones') ? checks : mode === 'split' ? 'none' : 'leader')
  : (checks === 'proof' ? 'proof' : 'none'));
// Phase leads and milestones of a split team.
const leadsOf = c => conn.prepare('SELECT * FROM challenge_leads WHERE challengeId = ?').all(c.id);
const ledBy = (c, userId) => new Set(leadsOf(c).filter(l => l.userId === userId).map(l => l.projectId));
const milestonesOf = c => new Set(conn.prepare('SELECT taskId FROM challenge_milestones WHERE challengeId = ?').all(c.id).map(r => r.taskId));
// Whether this person runs this step: the leader, or the lead of its phase.
const manages = (c, userId, t, led = ledBy(c, userId)) => c.ownerId === userId || (!!t && led.has(t.projectId));
// Who signs a step off: the lead of its phase, unless it's the lead's own
// step (or there's no lead), then the leader.
function approverOf(c, t) {
  const lead = t && leadsOf(c).find(l => l.projectId === t.projectId);
  return lead && lead.userId !== t.assigneeId && memberRow(c.id, lead.userId) ? lead.userId : c.ownerId;
}
// A section's name to show and to @mention: "3. Engineering" is Engineering.
const sectionName = title => String(title || '').replace(/^\s*\d+\s*[.)\-:]\s*/, '').trim() || String(title || '');
const sectionsOf = c => (c.goalId ? conn.prepare('SELECT id, title FROM projects WHERE parentId = ? AND deletedAt IS NULL ORDER BY title').all(c.goalId) : []);
// Which section (phase or department) each person is in: the one the
// leader put them in, else the one they lead, else where most of their
// steps are. userId -> projectId.
function deptsOf(c, members, sections = sectionsOf(c)) {
  const ids = new Set(sections.map(x => x.id));
  const out = new Map();
  if (!ids.size) return out;
  const leads = leadsOf(c);
  const steps = conn.prepare(`SELECT t.assigneeId, t.projectId FROM tasks t JOIN projects p ON p.id = t.projectId
    WHERE p.parentId = ? AND t.deletedAt IS NULL AND p.deletedAt IS NULL AND t.assigneeId IS NOT NULL`).all(c.goalId);
  members.forEach(m => {
    if (m.deptId && ids.has(m.deptId)) return out.set(m.userId, m.deptId);
    const led = leads.find(l => l.userId === m.userId && ids.has(l.projectId));
    if (led) return out.set(m.userId, led.projectId);
    const count = new Map();
    steps.filter(t => t.assigneeId === m.userId).forEach(t => count.set(t.projectId, (count.get(t.projectId) || 0) + 1));
    const best = [...count].sort((a, b) => b[1] - a[1])[0];
    if (best) out.set(m.userId, best[0]);
  });
  return out;
}
function createChallenge(userId, { projectId, endsAt, stake, displayName, mode, organiserOnly, nameMode, leaderRole, checks }) {
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

  // One running team per goal: a second Team up on it would make another
  // team (and, for a race, another copy of the goal), which reads as a
  // duplicate everywhere. The existing one is the place to invite people.
  const running = conn.prepare(`SELECT c.id, c.title FROM challenge_members m JOIN challenges c ON c.id = m.challengeId
    WHERE m.projectId = ? AND c.endsAt > ? ORDER BY c.createdAt DESC LIMIT 1`).get(top, new Date(now).toISOString())
    || conn.prepare('SELECT id, title FROM challenges WHERE goalId = ? AND endsAt > ? ORDER BY createdAt DESC LIMIT 1').get(top, new Date(now).toISOString());
  if (running) throw Object.assign(new Error('This goal already has a team. Open it to invite people'), { status: 409, code: 'TEAM_EXISTS', teamId: running.id });
  const template = { title: project.title, icon: project.icon || '🏁', color: project.color || '#0A7E8C', type: project.type || 'personal', tasks: tasks.map(t => ({ title: t.title, priority: t.priority || 'Medium', notes: t.notes || '' })) };
  const c = {
    id: crypto.randomUUID(), ownerId: userId, title: clean(project.title, 120), icon: template.icon,
    template: JSON.stringify(template), taskCount: tasks.length, stake: clean(stake, 140) || null,
    startsAt: new Date(now).toISOString(), endsAt: new Date(end).toISOString(),
    joinToken: crypto.randomBytes(16).toString('hex'), createdAt: new Date(now).toISOString(),
    mode: ['together', 'split'].includes(mode) ? mode : 'race',
    organiserOnly: mode === 'together' && organiserOnly ? 1 : 0,
    goalId: mode === 'split' ? top : null,
    nameMode: ['names', 'first', 'animals'].includes(nameMode) ? nameMode : 'names',
    leaderRole: mode === 'together' || mode === 'split' ? (LEADER_ROLES.includes(leaderRole) ? leaderRole : 'leader') : null,
    joinCode: newCode(),
    checks: checksFor(mode, checks),
  };
  // The maker takes part on the goal they already have, not a duplicate of
  // it. Only a race where they've already ticked steps gets them a fresh
  // copy, so everyone starts level; and a goal already in another race or
  // group keeps its place there. (Checked before anything is saved, so a
  // refused team never lingers on anyone's list.)
  const started = tasks.some(t => t.status === 'Completed');
  const elsewhere = conn.prepare('SELECT 1 FROM challenge_members WHERE projectId = ?').get(top);
  // the whole team works on this goal itself; it can't already be someone's race
  if (c.mode === 'split' && elsewhere) throw Object.assign(new Error('That goal is already in a race or group. Pick another, or leave that one first'), { status: 400 });
  conn.prepare(`INSERT INTO challenges (id, ownerId, title, icon, template, taskCount, stake, startsAt, endsAt, joinToken, createdAt, mode, organiserOnly, nameMode, leaderRole, joinCode, checks, goalId)
    VALUES (@id, @ownerId, @title, @icon, @template, @taskCount, @stake, @startsAt, @endsAt, @joinToken, @createdAt, @mode, @organiserOnly, @nameMode, @leaderRole, @joinCode, @checks, @goalId)`).run(c);
  if (c.mode === 'split') {
    addMember(c, userId, displayName, top);
  } else if (!c.organiserOnly) addMember(c, userId, displayName, (c.mode === 'together' || !started) && !elsewhere ? top : null);
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
  return { id: c.id, title: c.title, icon: c.icon, stake: c.stake, endsAt: c.endsAt, taskCount: c.taskCount, owner, players, full: players >= maxFor(c), mode: c.mode, checks: c.checks || 'none', nameMode: c.nameMode, leaderRole: c.leaderRole || null, token: c.joinToken };
}

// The same, from the short code read out in class.
const previewByCode = code => { const c = byCode(code); return c ? preview(c.joinToken) : null; };
function join(token, userId, displayName) {
  const c = byToken(token);
  if (!c) throw Object.assign(new Error('That race link is not valid any more'), { status: 404 });
  const already = memberRow(c.id, userId);
  if (already) return { challenge: c, projectId: already.projectId, already: true };
  if (Date.parse(c.endsAt) < Date.now()) throw Object.assign(new Error('That race has already finished'), { status: 400 });
  if (conn.prepare('SELECT 1 FROM challenge_removed WHERE challengeId = ? AND userId = ?').get(c.id, userId)) throw Object.assign(new Error('The organiser has taken you off this team. Ask them to let you back in'), { status: 403 });
  const count = conn.prepare('SELECT COUNT(*) AS n FROM challenge_members WHERE challengeId = ?').get(c.id).n;
  if (count >= maxFor(c)) throw Object.assign(new Error(isGroup(c) ? 'That group is full' : 'That race is full'), { status: 400 });
  if (c.ownerId === userId && c.organiserOnly) throw Object.assign(new Error("You're organising this one, so you don't have a copy to race"), { status: 400 });
  if (c.mode === 'split') {
    const goal = conn.prepare('SELECT id FROM projects WHERE id = ? AND deletedAt IS NULL').get(c.goalId);
    if (!goal) throw Object.assign(new Error("That team's goal has been removed"), { status: 404 });
    // a teammate on the goal itself: it shows in their projects, shared with them
    const had = conn.prepare('SELECT * FROM project_collaborators WHERE projectId = ? AND userId = ?').get(goal.id, userId);
    if (!had) conn.prepare('INSERT INTO project_collaborators (id, projectId, userId, role, invitedAt, joinedAt) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), goal.id, userId, 'editor', new Date().toISOString(), new Date().toISOString());
    else if (!had.joinedAt || had.role === 'viewer' || had.role === 'commenter') conn.prepare("UPDATE project_collaborators SET joinedAt = COALESCE(joinedAt, ?), role = 'editor' WHERE id = ?").run(new Date().toISOString(), had.id);
    addMember(c, userId, displayName, goal.id);
    return { challenge: c, projectId: goal.id, already: false };
  }
  const project = addMember(c, userId, displayName);
  return { challenge: c, projectId: project.id, already: false };
}

// One player's progress, from the tasks in their copy (including any
// sub-folders they've added). Their copy deleted: they've left.
// With checks on, a ticked step only counts once it has its proof (and,
// where the leader signs off, once it's approved). Steps ticked before the
// race or group began (the maker's own goal) count as they are. The time
// a step counts from is when it was ticked or proven, whichever came
// later, never when the leader got round to approving it.
function progressOf(m, c) {
  const taskCount = c.mode === 'split' ? 0 : c.taskCount;
  const split = c.mode === 'split';
  // In a split goal, your part is the steps assigned to you.
  const rows = conn.prepare(`SELECT t.id, t.title, t.status, t.completedAt, t.projectId, t.assigneeId FROM tasks t JOIN projects p ON p.id = t.projectId
    WHERE (p.id = ? OR p.parentId = ?) AND t.deletedAt IS NULL AND p.deletedAt IS NULL${split ? ' AND t.assigneeId = ?' : ''}`).all(...[m.projectId, m.projectId, ...(split ? [m.userId] : [])]);
  const alive = conn.prepare('SELECT 1 FROM projects WHERE id = ? AND deletedAt IS NULL').get(m.projectId);
  const checks = c.checks || 'none';
  const proofs = checks === 'none' ? new Map()
    : new Map(conn.prepare('SELECT * FROM challenge_steps WHERE challengeId = ? AND userId = ?').all(c.id, m.userId).map(s => [s.taskId, s]));
  // the leader's own steps need no sign-off
  const selfLed = (checks === 'leader' || checks === 'milestones') && m.userId === c.ownerId;
  // with milestone sign-off, only the marked steps wait for it
  const marked = checks === 'milestones' ? milestonesOf(c) : null;
  const ticked = rows.filter(r => r.status === 'Completed');
  const done = [], needsProof = [], waiting = [], sentBack = [];
  ticked.forEach(r => {
    const s = proofs.get(r.id);
    if (checks === 'none' || selfLed || (marked && !marked.has(r.id)) || (r.completedAt && r.completedAt < c.startsAt)) done.push({ ...r, at: r.completedAt });
    else if (s && (s.status === 'approved' || (checks === 'proof' && s.status === 'submitted'))) {
      done.push({ ...r, at: checks === 'proof' ? [r.completedAt, s.createdAt].filter(Boolean).sort().pop() : r.completedAt });
    } else if (s && s.status === 'rejected') sentBack.push({ ...r, note: s.note || '' });
    // where the leader signs off, a ticked step waits for them (a proof is
    // a help, not a must); with proofs, it waits for one
    else if (checks === 'leader' || checks === 'milestones') waiting.push({ ...r, proof: s || null });
    else needsProof.push(r);
  });
  const finished = !!alive && rows.length > 0 && done.length === rows.length && done.length >= taskCount;
  const lastStepAt = done.map(r => r.at).filter(Boolean).sort().pop() || null;
  const finishedAt = finished ? lastStepAt : null;
  const total = split ? rows.length : taskCount;
  return {
    total, done: Math.min(done.length, total), frac: total ? Math.min(1, done.length / total) : 0, finished, finishedAt, lastStepAt, left: !alive,
    needsProof, waiting, sentBack, tickTimes: ticked.map(r => r.completedAt).filter(t => t && t >= c.startsAt).sort(),
  };
}

// Too quick to be true: three or more steps ticked inside a minute. Said
// once in a race's chat, so everyone can see it (and ask).
const SPEED_STEPS = 3, SPEED_MS = 60000;
function speedBurst(times) {
  let best = null;
  for (let i = 0, j = 0; j < times.length; j++) {
    while (Date.parse(times[j]) - Date.parse(times[i]) > SPEED_MS) i++;
    const n = j - i + 1;
    if (n >= SPEED_STEPS && (!best || n > best.n)) best = { n, secs: Math.max(1, Math.round((Date.parse(times[j]) - Date.parse(times[i])) / 1000)) };
  }
  return best;
}

// The scoreboard: every player, their progress and pace, in race order.
function standings(c, viewerId) {
  const members = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? ORDER BY joinedAt').all(c.id);
  const start = Date.parse(c.startsAt), end = Date.parse(c.endsAt), now = Date.now();
  const expected = Math.max(0, Math.min(1, (now - start) / ((end - start) || 1)));
  const organiser = c.ownerId === viewerId;
  const checks = c.checks || 'none';
  const progress = new Map();
  const players = members.map(m => {
    const p = progressOf(m, c);
    progress.set(m.userId, { m, p });
    const gap = p.frac - expected;
    const you = m.userId === viewerId;
    return {
      // The organiser (a teacher) always sees real names; everyone else as the organiser chose.
      userId: m.userId, name: you || organiser ? m.displayName : shownName(c, m), color: m.color, you, lead: m.userId === c.ownerId,
      done: p.done, total: p.total, frac: p.frac, finished: p.finished, finishedAt: p.finishedAt, joinedAt: m.joinedAt, left: p.left,
      pace: p.finished ? 'finished' : c.mode === 'split' && !p.total ? 'no steps yet' : gap >= 0.05 ? 'ahead' : gap >= -0.05 ? 'on pace' : 'behind',
      // steps ticked that don't count yet: waiting for proof or sign-off
      ...(checks !== 'none' ? { pending: p.needsProof.length + p.waiting.length + p.sentBack.length } : {}),
      // open requests for help on a blocker
      stuck: conn.prepare("SELECT COUNT(*) AS n FROM challenge_messages WHERE challengeId = ? AND userId = ? AND kind = 'help' AND closedAt IS NULL").get(c.id, m.userId).n,
      // The organiser sees when each person last ticked a step, to know who to check on.
      ...(organiser ? { lastStepAt: p.lastStepAt } : {}),
      ...(you ? { projectId: m.projectId } : {}),
    };
  }).filter(p => !p.left);
  players.sort((a, b) => (b.finished - a.finished) || (a.finished ? String(a.finishedAt).localeCompare(String(b.finishedAt)) : b.frac - a.frac));
  const together = isGroup(c);
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
  announce(c, members, players, progress);
  // Your own steps still to prove, waiting for sign-off, or sent back.
  const mine = progress.get(viewerId);
  const step = r => ({ taskId: r.id, title: r.title, ...(r.note !== undefined ? { note: r.note } : {}) });
  const yourSteps = checks !== 'none' && mine ? { needsProof: mine.p.needsProof.map(step), waiting: mine.p.waiting.map(step), sentBack: mine.p.sentBack.map(step) } : null;
  // For the leader: every proof waiting for a decision (or, with proofs
  // only, the newest to look over and send back if need be).
  const leads = c.mode === 'split' ? ledBy(c, viewerId) : new Set();
  const reviews = (organiser || leads.size) && checks !== 'none' ? reviewList(c, progress, viewerId) : undefined;
  const winner = !together && (players.find(p => p.finished) || null);
  const steps = players.reduce((a, p) => a + p.done, 0);
  const split = c.mode === 'split' ? splitBoard(c, members, viewerId, organiser) : null;
  const me = players.find(p => p.you);
  // Finished as far as you're concerned: time's up, you've finished, or
  // (when you only organise it) everyone has.
  const doneForYou = now > end || (me ? me.finished : players.length > 0 && players.every(p => p.finished));
  return {
    doneForYou,
    id: c.id, title: c.title, icon: c.icon, stake: c.stake, startsAt: c.startsAt, endsAt: c.endsAt, taskCount: c.taskCount,
    mode: c.mode, nameMode: c.nameMode, organiserOnly: !!c.organiserOnly, leaderRole: c.leaderRole || (isGroup(c) ? 'leader' : null),
    expected, over: now > end, winner: winner ? { name: winner.name, you: winner.you, finishedAt: winner.finishedAt } : null,
    yourPlace: (players.find(p => p.you) || {}).place || null,
    group: split
      ? { finished: players.filter(p => p.finished).length, players: players.length, stepsPct: split.total ? Math.round((split.done / split.total) * 100) : 0, behind: players.filter(p => p.pace === 'behind').length, goalDone: split.total > 0 && split.done === split.total }
      : { finished: players.filter(p => p.finished).length, players: players.length, stepsPct: players.length ? Math.round((steps / (players.length * c.taskCount)) * 100) : 0, behind: players.filter(p => p.pace === 'behind').length },
    split,
    owner: organiser, joinToken: c.joinToken, joinCode: c.joinCode,
    // Who runs it, as you see them: everyone can tell who to ask.
    leaderName: organiser ? 'You' : authorOf(c, c.ownerId, viewerId).name.replace(/^(Coach|Trainer|Teacher|Manager|Team leader|Organiser|Leader) /, ''),
    lastNudgeAt: organiser ? c.lastNudgeAt : undefined,
    chat: chatSummary(c.id, viewerId),
    checks, yourSteps, reviews,
    // phases this person leads (a split team), so they can run them
    leadOf: [...leads],
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
      AND NOT (c.mode = 'split' AND NOT EXISTS (SELECT 1 FROM challenge_members e WHERE e.challengeId = c.id))
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
function postMessage(cid, userId, text, kind = 'msg', toUserId = null, attachmentId = null, refId = null, taskId = null) {
  const m = { id: crypto.randomUUID(), challengeId: cid, userId, kind, text, toUserId, attachmentId, refId, taskId, createdAt: new Date().toISOString() };
  conn.prepare('INSERT INTO challenge_messages (id, challengeId, userId, kind, text, toUserId, attachmentId, refId, taskId, createdAt) VALUES (@id, @challengeId, @userId, @kind, @text, @toUserId, @attachmentId, @refId, @taskId, @createdAt)').run(m);
  return m;
}
const postEvent = (cid, text, userId = null) => postMessage(cid, userId, text, 'event');
// The app's own lines, once each: someone halfway, someone finished (with
// their place in a race). Checked whenever the scoreboard is worked out.
function announce(c, members, players, progress) {
  const byUser = new Map(members.map(m => [m.userId, m]));
  players.forEach(p => {
    const m = byUser.get(p.userId);
    if (!m) return;
    const name = shownName(c, m);
    if (!isGroup(c) && !m.speedFlagged) {
      const burst = speedBurst((progress.get(m.userId) || { p: { tickTimes: [] } }).p.tickTimes);
      if (burst) {
        conn.prepare('UPDATE challenge_members SET speedFlagged = 1 WHERE challengeId = ? AND userId = ?').run(c.id, m.userId);
        postEvent(c.id, `⚡ ${name} ticked ${burst.n} steps in ${burst.secs} second${burst.secs === 1 ? '' : 's'}. Quick work, or worth a question?`, m.userId);
      }
    }
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
  if (!userId) return { name: 'KolaWay', color: '#64748B' };
  const m = memberRow(c.id, userId);
  if (m) return { name: userId === viewerId ? 'You' : c.ownerId === viewerId ? m.displayName : shownName(c, m), color: m.color, leader: userId === c.ownerId && isGroup(c) };
  const prof = (db.getProfile(userId) || {}).name || 'The organiser';
  const ROLE = { coach: 'Coach', trainer: 'Trainer', teacher: 'Teacher', manager: 'Manager', leader: 'Team leader', organiser: 'Organiser' };
  return { name: userId === viewerId ? 'You' : isGroup(c) ? `${ROLE[c.leaderRole] || 'Leader'} ${prof}` : prof, color: '#0D1B2A', leader: true };
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
    // The task it's about: a link for whoever can open it (their own step),
    // else its name, which the team's plan shows anyway.
    const row = m.taskId ? conn.prepare('SELECT id, title, status FROM tasks WHERE id = ? AND deletedAt IS NULL').get(m.taskId) : null;
    const task = row ? { id: db.getTaskById(userId, row.id) ? row.id : null, title: row.title, done: row.status === 'Completed' } : null;
    const offered = m.kind === 'help' ? conn.prepare("SELECT COUNT(*) AS n FROM challenge_messages WHERE kind = 'offer' AND refId = ?").get(m.id).n : 0;
    const youOffered = m.kind === 'help' && !!conn.prepare("SELECT 1 FROM challenge_messages WHERE kind = 'offer' AND refId = ? AND userId = ?").get(m.id, userId);
    return {
      id: m.id, kind: m.kind, text: m.kind === 'cheer' ? describe(c, m, userId) : m.text, author: a.name, color: a.color, leader: !!a.leader, you: m.userId === userId, toYou: m.toUserId === userId, file: fileInfo(fileOf(m.attachmentId)), createdAt: m.createdAt,
      ...(task ? { task } : {}),
      ...(m.kind === 'help' ? { open: !m.closedAt, offers: offered, youOffered } : {}),
    };
  });
}
// A message: text and/or a photo or file you uploaded (to your own copy of
// the goal, as a proof photo is). Anyone @mentioned by name hears about it:
// a push now, and it's in their bell (activitySince).
function taskInReach(c, userId, taskId) {
  const own = db.getTaskById(userId, taskId);
  if (own) return own;
  const row = conn.prepare('SELECT id, projectId FROM tasks WHERE id = ? AND deletedAt IS NULL').get(taskId);
  return row && c.goalId && db.topLevelProjectId(row.projectId) === c.goalId ? row : null;
}
function say(id, userId, text, attachmentId = null, taskId = null) {
  const c = byId(id);
  if (!canChat(c, userId)) return null;
  const t = clean(text, 1000);
  let fileId = null;
  if (attachmentId) {
    const a = db.getAttachmentById(String(attachmentId));
    if (!a || a.uploaderId !== userId) throw Object.assign(new Error("That file isn't yours to share"), { status: 400 });
    fileId = a.id;
  }
  if (!t && !fileId) throw Object.assign(new Error('Write something first'), { status: 400 });
  // Sent from a task: one you can open, or a step of this team's goal
  // (the one you're waiting on, someone else's).
  const about = taskId ? taskInReach(c, userId, String(taskId)) : null;
  if (taskId && !about) throw Object.assign(new Error('That task was not found'), { status: 404 });
  const m = postMessage(c.id, userId, t, 'msg', null, fileId, null, about ? about.id : null);
  if (t.includes('@')) {
    const from = authorOf(c, userId, null).name;
    mentionedIn(c, t).filter(uid => uid !== userId).forEach(uid => pushTo(uid, { title: c.title, body: `${from} mentioned you: ${clean(t, 120)}`, url: '/app', tag: `mention-${c.id}` }));
  }
  return m;
}
// Who a message @mentions, by the names people see in this team (and the
// leader by name or by role).
function mentionNames(c) {
  const out = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ?').all(c.id)
    .map(m => ({ userId: m.userId, names: [...new Set([shownName(c, m), m.displayName])] }));
  if (!out.some(x => x.userId === c.ownerId)) {
    const prof = (db.getProfile(c.ownerId) || {}).name || '';
    const lead = authorOf(c, c.ownerId, null).name;
    out.push({ userId: c.ownerId, names: [prof, lead].filter(Boolean) });
  }
  return out;
}
// @Engineering (a phase or department of a split team) reaches everyone in
// it, and its lead.
function mentionedIn(c, text) {
  const low = String(text || '').toLowerCase();
  const has = n => n && low.includes(`@${n.toLowerCase()}`);
  const out = new Set(mentionNames(c).filter(x => x.names.some(has)).map(x => x.userId));
  if (c.mode === 'split' && low.includes('@')) {
    const sections = sectionsOf(c).filter(x => has(sectionName(x.title)) || has(x.title));
    if (sections.length) {
      const members = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ?').all(c.id);
      const depts = deptsOf(c, members);
      const leads = leadsOf(c);
      sections.forEach(x => {
        members.forEach(m => { if (depts.get(m.userId) === x.id) out.add(m.userId); });
        leads.filter(l => l.projectId === x.id).forEach(l => out.add(l.userId));
      });
    }
  }
  return [...out];
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

// ── For the week in review ──────────────────────────────────────────
// Races you finished (or that ended) in the last week with your place,
// the groups you lead or are in with how they're doing, and the cheers
// that came your way.
function weekFor(userId) {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const rows = conn.prepare(`SELECT DISTINCT c.* FROM challenges c LEFT JOIN challenge_members m ON m.challengeId = c.id
    WHERE (m.userId = ? OR c.ownerId = ?) AND c.endsAt > ?`).all(userId, userId, since);
  const races = [], groups = [];
  rows.forEach(c => {
    const s = standings(c, userId);
    const me = s.players.find(p => p.you);
    if (!isGroup(c)) {
      if (me && ((me.finished && me.finishedAt > since) || (s.over && Date.parse(c.endsAt) > Date.parse(since)))) {
        races.push({ id: c.id, title: c.title, icon: c.icon, place: me.place || null, players: s.players.length, finished: me.finished, done: me.done, total: me.total, stake: c.stake, winner: s.winner && !s.winner.you ? s.winner.name : null });
      }
    } else if (s.owner || me) {
      groups.push({ id: c.id, title: c.title, icon: c.icon, leader: s.owner, leaderRole: s.leaderRole, group: s.group,
        me: me ? { done: me.done, total: me.total, pace: me.finished ? 'finished' : me.pace } : null, over: s.over });
    }
  });
  const cheers = conn.prepare(`SELECT m.*, c.title FROM challenge_messages m JOIN challenges c ON c.id = m.challengeId
    WHERE m.kind = 'cheer' AND m.toUserId = ? AND m.createdAt > ? ORDER BY m.createdAt`).all(userId, since);
  const from = [...new Set(cheers.map(m => authorOf(byId(m.challengeId), m.userId, userId).name))];
  return {
    races: races.sort((a, b) => (a.place || 99) - (b.place || 99)).slice(0, 4),
    groups: groups.slice(0, 3),
    cheers: { count: cheers.length, emojis: cheers.map(m => m.text).slice(-8), from: from.slice(0, 3), more: Math.max(0, from.length - 3) },
  };
}

// ── For the notification bell ───────────────────────────────────────
// What's happened in your races and groups since you last looked, meant
// for you: someone stuck, an offer of help or a step sent back to you,
// steps signed off, cheers, finishes, and (for the leader) new proof or
// steps waiting for sign-off. Nudges have their own list (nudgesSince).
function activitySince(userId, since) {
  const mine = conn.prepare(`SELECT DISTINCT c.* FROM challenges c LEFT JOIN challenge_members m ON m.challengeId = c.id
    WHERE (m.userId = ? OR c.ownerId = ?) AND c.endsAt > ?`).all(userId, userId, new Date(Date.now() - 7 * DAY).toISOString());
  const out = [];
  const add = (c, kind, text, at) => out.push({ challengeId: c.id, title: c.title, icon: c.icon, kind, text, at });
  mine.forEach(c => {
    const name = uid => authorOf(c, uid, userId).name;
    const rows = conn.prepare(`SELECT * FROM challenge_messages WHERE challengeId = ? AND createdAt > ? AND (userId IS NULL OR userId != ?)
      AND kind IN ('help', 'offer', 'review', 'cheer', 'event', 'proof', 'msg') ORDER BY createdAt`).all(c.id, since, userId);
    const cheers = rows.filter(m => m.kind === 'cheer' && m.toUserId === userId);
    rows.forEach(m => {
      if (m.kind === 'help' && !m.closedAt) add(c, 'help', `${name(m.userId)} is stuck on “${(m.text.match(/“([^”]+)”/) || [])[1] || 'a blocker'}” and asked for help`, m.createdAt);
      else if (m.kind === 'offer' && m.toUserId === userId) add(c, 'offer', `${name(m.userId)} can help with “${(m.text.match(/“([^”]+)”/) || [])[1] || 'your blocker'}”`, m.createdAt);
      else if (m.kind === 'review' && m.toUserId === userId) add(c, 'sentback', `${name(m.userId)} ${m.text.replace(/ for [^:]+(?=:|$)/, '').replace(/^Sent/, 'sent')}`, m.createdAt);
      else if (m.kind === 'event' && /finished/.test(m.text) && m.userId) add(c, 'finish', m.text, m.createdAt);
      else if (m.kind === 'msg' && m.text.includes('@') && mentionedIn(c, m.text).includes(userId)) add(c, 'mention', `${name(m.userId)} mentioned you: “${clean(m.text, 80)}”`, m.createdAt);
    });
    if (cheers.length) add(c, 'cheer', `${[...new Set(cheers.map(m => name(m.userId)))].slice(0, 2).join(' and ')} cheered you on ${cheers.map(m => m.text).slice(0, 5).join('')}`, cheers[cheers.length - 1].createdAt);
    // Your steps the leader signed off.
    const ok = conn.prepare("SELECT COUNT(*) AS n, MAX(decidedAt) AS at FROM challenge_steps WHERE challengeId = ? AND userId = ? AND status = 'approved' AND decidedAt > ?").get(c.id, userId, since);
    if (ok.n && c.ownerId !== userId) add(c, 'approved', `${name(c.ownerId)} signed off ${ok.n} of your step${ok.n === 1 ? '' : 's'}`, ok.at);
    // For the leader: steps newly waiting for you.
    if ((c.ownerId === userId || (c.mode === 'split' && ledBy(c, userId).size)) && (c.checks || 'none') !== 'none') {
      const board = standings(c, userId);
      const fresh = (board.reviews || []).filter(r => r.tickedAt && r.tickedAt > since);
      if (fresh.length) add(c, 'review', c.checks !== 'proof' ? `${fresh.length} step${fresh.length === 1 ? '' : 's'} waiting for your sign-off` : `${fresh.length} new proof${fresh.length === 1 ? '' : 's'} to look over`, fresh[fresh.length - 1].tickedAt);
    }
  });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15);
}
// A push to one person, where they've turned push on.
function pushTo(userId, payload) {
  try {
    const { sendPushToUser } = require('./push/webpush');
    sendPushToUser(userId, payload).catch(() => {});
  } catch { /* push not set up */ }
}

// ── Asking for help on a blocker ────────────────────────────────────
// Stuck on a blocker in your copy? Ask the race or group: a 'help' line in
// the chat (one open request per blocker) that anyone can answer with
// "I can help", and that closes itself when the blocker is cleared.
function blockerIn(m, obstacleId) {
  return conn.prepare(`SELECT o.*, t.title AS taskTitle FROM task_obstacles o JOIN tasks t ON t.id = o.taskId JOIN projects p ON p.id = t.projectId
    WHERE o.id = ? AND (p.id = ? OR p.parentId = ?) AND t.deletedAt IS NULL AND p.deletedAt IS NULL`).get(String(obstacleId || ''), m.projectId, m.projectId);
}
function askHelp(id, userId, { obstacleId, note }) {
  const c = byId(id);
  const m = c && memberRow(c.id, userId);
  if (!m) return null;
  const o = blockerIn(m, obstacleId);
  if (!o) throw Object.assign(new Error('That blocker is not on a step in this one'), { status: 404 });
  if (o.resolvedAt) throw Object.assign(new Error("You've already cleared that one"), { status: 400 });
  if (conn.prepare("SELECT 1 FROM challenge_messages WHERE challengeId = ? AND kind = 'help' AND refId = ? AND closedAt IS NULL").get(c.id, o.id)) {
    throw Object.assign(new Error("You've already asked about this one. It's in the chat"), { status: 409 });
  }
  const why = clean(note, 300);
  const msg = postMessage(c.id, userId, `Stuck on “${clean(o.name, 120)}” in “${clean(o.taskTitle, 120)}”${why ? `: ${why}` : ''}`, 'help', null, null, o.id, o.taskId);
  // The leader hears about it straight away, where they've turned push on.
  if (c.ownerId !== userId) {
    try {
      const { sendPushToUser } = require('./push/webpush');
      sendPushToUser(c.ownerId, { title: c.title, body: `${m.displayName} is stuck on “${o.name}”`, url: '/app', tag: `help-${o.id}` }).catch(() => {});
    } catch { /* push not set up */ }
  }
  return msg;
}
function offerHelp(id, userId, messageId) {
  const c = byId(id);
  if (!canChat(c, userId)) return null;
  const h = conn.prepare("SELECT * FROM challenge_messages WHERE id = ? AND challengeId = ? AND kind = 'help'").get(String(messageId || ''), c.id);
  if (!h) throw Object.assign(new Error('That request has gone'), { status: 404 });
  if (h.closedAt) throw Object.assign(new Error("They've already got past it"), { status: 400 });
  if (h.userId === userId) throw Object.assign(new Error("That's your own request"), { status: 400 });
  if (conn.prepare("SELECT 1 FROM challenge_messages WHERE kind = 'offer' AND refId = ? AND userId = ?").get(h.id, userId)) {
    throw Object.assign(new Error("You've already offered. Say more in the chat"), { status: 409 });
  }
  const what = (h.text.match(/“([^”]+)”/) || [])[1] || 'that';
  pushTo(h.userId, { title: c.title, body: `${authorOf(c, userId, h.userId).name} can help with “${what}”`, url: '/app', tag: `offer-${h.id}` });
  return postMessage(c.id, userId, `I can help with “${what}”`, 'offer', h.userId, null, h.id);
}
// A blocker was cleared: close any help asked about it, and say so.
function helpCleared(userId, obstacleId) {
  const open = conn.prepare("SELECT * FROM challenge_messages WHERE kind = 'help' AND refId = ? AND userId = ? AND closedAt IS NULL").all(String(obstacleId), userId);
  open.forEach(h => {
    conn.prepare('UPDATE challenge_messages SET closedAt = ? WHERE id = ?').run(new Date().toISOString(), h.id);
    const c = byId(h.challengeId);
    const m = c && memberRow(c.id, userId);
    if (!m) return;
    const what = (h.text.match(/“([^”]+)”/) || [])[1] || 'a blocker';
    const helpers = conn.prepare("SELECT DISTINCT userId FROM challenge_messages WHERE kind = 'offer' AND refId = ?").all(h.id).map(r => r.userId);
    const names = helpers.map(u => memberRow(c.id, u)).filter(Boolean).map(x => shownName(c, x));
    postEvent(c.id, `✅ ${shownName(c, m)} got past “${what}”${names.length ? ` with help from ${names.join(' and ')}` : ''}`, userId);
  });
  return open.length;
}
// Where a step's blockers can be taken for help: the races and groups its
// goal is your copy in, and which blockers already have an open request.
function helpPlaces(userId, taskId) {
  const t = conn.prepare('SELECT t.id, t.projectId FROM tasks t WHERE t.id = ? AND t.deletedAt IS NULL').get(String(taskId || ''));
  if (!t) return { places: [], asked: [] };
  const rows = conn.prepare('SELECT * FROM challenge_members WHERE projectId = ? AND userId = ?').all(db.topLevelProjectId(t.projectId), userId);
  const places = rows.map(m => byId(m.challengeId)).filter(Boolean).map(c => ({ id: c.id, title: c.title, mode: c.mode, leaderRole: c.leaderRole || null }));
  const asked = conn.prepare(`SELECT DISTINCT m.refId FROM challenge_messages m JOIN task_obstacles o ON o.id = m.refId
    WHERE m.kind = 'help' AND m.userId = ? AND m.closedAt IS NULL AND o.taskId = ?`).all(userId, t.id).map(r => r.refId);
  return { places, asked };
}

// ── Proof and sign-off ──────────────────────────────────────────────
const fileOf = id => (id ? conn.prepare('SELECT id, mimetype, originalName FROM attachments WHERE id = ?').get(id) : null);
const fileInfo = f => (f ? { id: f.id, mimetype: f.mimetype, name: f.originalName } : null);
// What the leader has to look at: with sign-off, every ticked step that's
// waiting; with proofs, the proofs from the last week (to send one back).
// In a split team with phase leads, each waiting step goes to whoever
// signs it off (approverOf): its phase lead, or the leader.
function reviewList(c, progress, viewerId = c.ownerId) {
  const out = [];
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const split = c.mode === 'split';
  progress.forEach(({ m, p }) => {
    if (p.left || m.userId === c.ownerId) return;
    if (c.checks === 'leader' || c.checks === 'milestones') {
      p.waiting.filter(r => (split ? approverOf(c, r) : c.ownerId) === viewerId).forEach(r => out.push({ color: m.color, name: m.displayName, taskId: r.id, title: r.title, tickedAt: r.completedAt,
        proofText: r.proof ? r.proof.proofText || '' : '', file: fileInfo(fileOf(r.proof && r.proof.attachmentId)) }));
    } else if (viewerId === c.ownerId || split) {
      const led = viewerId === c.ownerId ? null : ledBy(c, viewerId);
      conn.prepare("SELECT s.*, t.title, t.projectId FROM challenge_steps s JOIN tasks t ON t.id = s.taskId WHERE s.challengeId = ? AND s.userId = ? AND s.status = 'submitted' AND s.createdAt > ? AND t.status = 'Completed' AND t.deletedAt IS NULL ORDER BY s.createdAt DESC")
        .all(c.id, m.userId, weekAgo).filter(s => !led || (led.has(s.projectId) && m.userId !== viewerId)).forEach(s => out.push({ color: m.color, name: m.displayName, taskId: s.taskId, title: s.title, tickedAt: s.createdAt,
          proofText: s.proofText || '', file: fileInfo(fileOf(s.attachmentId)) }));
    }
  });
  return out.sort((a, b) => String(a.tickedAt).localeCompare(String(b.tickedAt))).slice(0, 100);
}
// A step in this player's copy (or a sub-folder of it), or null.
function stepIn(m, taskId) {
  return conn.prepare(`SELECT t.* FROM tasks t JOIN projects p ON p.id = t.projectId
    WHERE t.id = ? AND (p.id = ? OR p.parentId = ?) AND t.deletedAt IS NULL AND p.deletedAt IS NULL`).get(String(taskId || ''), m.projectId, m.projectId);
}
// A player's proof for one ticked step: a note, a photo (or file) they've
// uploaded to their own copy, or both. It goes in the chat for everyone.
function submitProof(id, userId, { taskId, text, attachmentId }) {
  const c = byId(id);
  const m = c && memberRow(c.id, userId);
  if (!m) return null;
  if ((c.checks || 'none') === 'none') throw Object.assign(new Error("This one doesn't ask for proof"), { status: 400 });
  const t = stepIn(m, taskId);
  if (!t) throw Object.assign(new Error('That step is not in your copy'), { status: 404 });
  if (t.status !== 'Completed') throw Object.assign(new Error('Tick the step off first, then add your proof'), { status: 400 });
  const note = clean(text, 500);
  let file = null;
  if (attachmentId) {
    file = db.getAttachmentById(String(attachmentId));
    if (!file || file.projectId !== db.topLevelProjectId(m.projectId) || file.uploaderId !== userId) throw Object.assign(new Error('That photo was not found'), { status: 404 });
  }
  if (!note && !file) throw Object.assign(new Error('Add a photo or a few words to show it is done'), { status: 400 });
  const now = new Date().toISOString();
  conn.prepare(`INSERT INTO challenge_steps (challengeId, userId, taskId, proofText, attachmentId, status, note, createdAt, decidedAt) VALUES (?,?,?,?,?, 'submitted', NULL, ?, NULL)
    ON CONFLICT(challengeId, userId, taskId) DO UPDATE SET proofText = excluded.proofText, attachmentId = excluded.attachmentId, status = 'submitted', note = NULL, createdAt = excluded.createdAt, decidedAt = NULL`)
    .run(c.id, userId, t.id, note || null, file ? file.id : null, now);
  const signer = c.mode === 'split' ? approverOf(c, t) : c.ownerId;
  if ((c.checks === 'leader' || c.checks === 'milestones') && signer !== userId) pushTo(signer, { title: c.title, body: `${m.displayName} sent proof for “${clean(t.title, 80)}”. It's waiting for your sign-off`, url: '/app', tag: `proof-${c.id}` });
  return postMessage(c.id, userId, `Proof for “${clean(t.title, 120)}”${note ? `: ${note}` : ''}`, 'proof', null, file ? file.id : null, null, t.id);
}
// The leader approves a step (or every waiting step of one player, with
// taskId 'all') or sends it back with a note. Sending back goes in the
// chat, so the player sees why; approvals stay quiet.
function review(id, userId, { color, taskId, decision, note }) {
  const c = byId(id);
  if (!c) return null;
  const led = c.mode === 'split' ? ledBy(c, userId) : new Set();
  if (c.ownerId !== userId && !led.size) throw Object.assign(new Error('Only the leader can sign steps off'), { status: 403 });
  if ((c.checks || 'none') === 'none') throw Object.assign(new Error("This one doesn't ask for sign-off"), { status: 400 });
  const m = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND color = ?').get(c.id, String(color || ''));
  if (!m) throw Object.assign(new Error('That person has left'), { status: 404 });
  if (!['approve', 'reject'].includes(decision)) throw Object.assign(new Error('Approve or send back'), { status: 400 });
  const p = progressOf(m, c);
  const open = c.checks === 'leader' || c.checks === 'milestones' ? p.waiting : conn.prepare("SELECT taskId AS id FROM challenge_steps WHERE challengeId = ? AND userId = ? AND status = 'submitted'").all(c.id, m.userId);
  const ids = taskId === 'all' && decision === 'approve' ? open.map(r => r.id) : [String(taskId || '')];
  const now = new Date().toISOString();
  const why = clean(note, 300);
  let n = 0;
  ids.forEach(tid => {
    const t = stepIn(m, tid);
    if (!t || t.status !== 'Completed') return;
    // a phase lead decides on their phase's steps, never their own
    if (c.ownerId !== userId && (!led.has(t.projectId) || m.userId === userId)) return;
    conn.prepare(`INSERT INTO challenge_steps (challengeId, userId, taskId, status, note, createdAt, decidedAt) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(challengeId, userId, taskId) DO UPDATE SET status = excluded.status, note = excluded.note, decidedAt = excluded.decidedAt`)
      .run(c.id, m.userId, t.id, decision === 'approve' ? 'approved' : 'rejected', decision === 'reject' ? why || null : null, now, now);
    n++;
    if (decision === 'reject') {
      postMessage(c.id, userId, `Sent back “${clean(t.title, 120)}” for ${shownName(c, m)}${why ? `: ${why}` : ''}`, 'review', m.userId, null, null, t.id);
      pushTo(m.userId, { title: c.title, body: `Sent back: “${clean(t.title, 80)}”${why ? `. ${why}` : ''}`, url: '/app', tag: `review-${c.id}-${t.id}` });
    }
  });
  if (!n) throw Object.assign(new Error('That step is not ticked off any more'), { status: 404 });
  return n;
}
// A proof photo or file, for anyone in the race or group (and its leader).
function proofFile(id, userId, attachmentId) {
  const c = byId(id);
  if (!canChat(c, userId)) return null;
  const used = conn.prepare('SELECT 1 FROM challenge_steps WHERE challengeId = ? AND attachmentId = ?').get(c.id, String(attachmentId))
    || conn.prepare('SELECT 1 FROM challenge_messages WHERE challengeId = ? AND attachmentId = ?').get(c.id, String(attachmentId));
  return used ? db.getAttachmentById(String(attachmentId)) : null;
}
// Just ticked a step in a copy that asks for proof? Then say so, so the
// app can ask for it there and then.
function proofWantedFor(userId, task) {
  if (!task || task.status !== 'Completed') return null;
  const m = conn.prepare('SELECT * FROM challenge_members WHERE projectId = ? AND userId = ?').get(db.topLevelProjectId(task.projectId), userId);
  const c = m && byId(m.challengeId);
  if (!c || (c.checks || 'none') === 'none' || ((c.checks === 'leader' || c.checks === 'milestones') && c.ownerId === userId)) return null;
  if (c.checks === 'milestones' && !milestonesOf(c).has(task.id)) return null;
  return { id: c.id, title: c.title, checks: c.checks, leaderRole: c.leaderRole || null, taskId: task.id, taskTitle: task.title };
}

// ── Split the work ──────────────────────────────────────────────────
// One goal for the whole team: every step belongs to someone (or is
// unclaimed), and each person's share adds up to the finish.
function splitBoard(c, members, viewerId, organiser) {
  const byUser = new Map(members.map(m => [m.userId, m]));
  const rows = conn.prepare(`SELECT t.id, t.title, t.status, t.startDate, t.endDate, t.assigneeId, t.sortOrder, t.projectId FROM tasks t JOIN projects p ON p.id = t.projectId
    WHERE (p.id = ? OR p.parentId = ?) AND t.deletedAt IS NULL AND p.deletedAt IS NULL
    ORDER BY COALESCE(t.endDate, '9999'), t.sortOrder LIMIT 300`).all(c.goalId, c.goalId);
  const who = id => {
    const m = id && byUser.get(id);
    if (!m) return null;
    return { color: m.color, name: id === viewerId ? 'You' : organiser ? m.displayName : shownName(c, m), you: id === viewerId };
  };
  const led = ledBy(c, viewerId);
  const marked = milestonesOf(c);
  const steps = rows.map(t => ({ taskId: t.id, title: t.title, status: t.status, startDate: t.startDate || null, endDate: t.endDate || null, who: who(t.assigneeId), outside: !!t.assigneeId && !byUser.has(t.assigneeId),
    phaseId: t.projectId === c.goalId ? null : t.projectId, milestone: marked.has(t.id), manage: manages(c, viewerId, t, led) }));
  // The goal's phases or departments (its sub-folders), each with its
  // lead, its people and how far along its steps are.
  const leadRows = leadsOf(c);
  const sections = sectionsOf(c);
  const depts = deptsOf(c, members, sections);
  const phases = sections.map(p => {
    const l = leadRows.find(x => x.projectId === p.id);
    const mine = rows.filter(t => t.projectId === p.id);
    return { projectId: p.id, title: p.title, name: sectionName(p.title), lead: l ? who(l.userId) : null, yours: led.has(p.id),
      done: mine.filter(t => t.status === 'Completed').length, total: mine.length,
      people: members.filter(m => depts.get(m.userId) === p.id).map(m => who(m.userId)) };
  });
  // Which step waits on which, for the timeline's handoff arrows.
  const ids = new Set(rows.map(t => t.id));
  const links = rows.length ? conn.prepare(`SELECT taskId, predecessorId FROM task_dependencies WHERE taskId IN (${rows.map(() => '?').join(',')})`).all(...rows.map(t => t.id))
    .filter(d => ids.has(d.predecessorId)).map(d => ({ from: d.predecessorId, to: d.taskId })) : [];
  const contrib = members.map(m => ({ color: m.color, name: m.userId === viewerId ? 'You' : organiser ? m.displayName : shownName(c, m), dept: depts.get(m.userId) || null, done: rows.filter(t => t.assigneeId === m.userId && t.status === 'Completed').length, total: rows.filter(t => t.assigneeId === m.userId).length }));
  return {
    total: rows.length, done: rows.filter(t => t.status === 'Completed').length,
    unclaimed: rows.filter(t => !t.assigneeId && t.status !== 'Completed').length,
    steps, contrib, links, phases,
    word: c.sections === 'departments' ? 'departments' : 'phases',
  };
}
const splitOf = (id, userId) => {
  const c = byId(id);
  if (!c || c.mode !== 'split') return null;
  if (!(c.ownerId === userId || isMember(c.id, userId))) return null;
  return c;
};
const stepOfGoal = (c, taskId) => conn.prepare(`SELECT t.* FROM tasks t JOIN projects p ON p.id = t.projectId
  WHERE t.id = ? AND (p.id = ? OR p.parentId = ?) AND t.deletedAt IS NULL AND p.deletedAt IS NULL`).get(String(taskId || ''), c.goalId, c.goalId);
function setAssignee(c, t, userId) {
  conn.prepare('UPDATE tasks SET assigneeId = ?, assigneeAssignedAt = ? WHERE id = ?').run(userId, userId ? new Date().toISOString() : null, t.id);
}
// The leader gives a step to someone (by colour), or back to unclaimed ('').
function assignStep(id, userId, { taskId, color }) {
  const c = splitOf(id, userId);
  if (!c) return null;
  const t = stepOfGoal(c, taskId);
  if (!t) throw Object.assign(new Error('That step is not in this goal'), { status: 404 });
  if (!manages(c, userId, t)) throw Object.assign(new Error('Only the leader or the lead of its phase hands out steps. You can claim an unclaimed one'), { status: 403 });
  let m = null;
  if (color) {
    m = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND color = ?').get(c.id, String(color));
    if (!m) throw Object.assign(new Error('That person has left'), { status: 404 });
  }
  setAssignee(c, t, m ? m.userId : null);
  if (m && m.userId !== userId) {
    postMessage(c.id, userId, `“${clean(t.title, 120)}” is yours, ${shownName(c, m)}`, 'event', m.userId, null, null, t.id);
    pushTo(m.userId, { title: c.title, body: `You've been given “${clean(t.title, 80)}”`, url: '/app', tag: `assign-${t.id}` });
  }
  return true;
}
// Anyone in the team takes an unclaimed step.
function claimStep(id, userId, taskId) {
  const c = splitOf(id, userId);
  const m = c && memberRow(c.id, userId);
  if (!m) return null;
  const t = stepOfGoal(c, taskId);
  if (!t) throw Object.assign(new Error('That step is not in this goal'), { status: 404 });
  if (t.assigneeId && t.assigneeId !== userId) throw Object.assign(new Error('Someone has already got that one'), { status: 409 });
  if (t.status === 'Completed') throw Object.assign(new Error("That one's already done"), { status: 400 });
  setAssignee(c, t, userId);
  postEvent(c.id, `${shownName(c, m)} took “${clean(t.title, 120)}”`, userId);
  return true;
}
// The leader shares out every unclaimed step, in order of due date, to
// whoever has the fewest open steps (the leader too, if they're the only one).
function splitEvenly(id, userId) {
  const c = splitOf(id, userId);
  if (!c) return null;
  const led = ledBy(c, userId);
  if (c.ownerId !== userId && !led.size) throw Object.assign(new Error('Only the leader can share the steps out'), { status: 403 });
  const members = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? ORDER BY joinedAt').all(c.id);
  const others = members.filter(m => m.userId !== userId);
  const pool = others.length ? others : members;
  if (!pool.length) throw Object.assign(new Error('No one has joined yet. Share the link or the code first'), { status: 400 });
  const open = conn.prepare(`SELECT t.* FROM tasks t JOIN projects p ON p.id = t.projectId
    WHERE (p.id = ? OR p.parentId = ?) AND t.deletedAt IS NULL AND p.deletedAt IS NULL AND t.status != 'Completed'`).all(c.goalId, c.goalId);
  const load = new Map(pool.map(m => [m.userId, open.filter(t => t.assigneeId === m.userId).length]));
  // a phase lead shares out their own phases' steps
  const todo = open.filter(t => !t.assigneeId && manages(c, userId, t, led)).sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999') || (a.sortOrder || 0) - (b.sortOrder || 0));
  todo.forEach(t => {
    const next = pool.reduce((best, m) => (load.get(m.userId) < load.get(best.userId) ? m : best), pool[0]);
    setAssignee(c, t, next.userId);
    load.set(next.userId, load.get(next.userId) + 1);
  });
  if (todo.length) {
    postEvent(c.id, `The steps are shared out: ${pool.map(m => `${shownName(c, m)} ${load.get(m.userId)}`).join(', ')}`, userId);
    pool.forEach(m => { if (m.userId !== userId) pushTo(m.userId, { title: c.title, body: `You've got ${load.get(m.userId)} step${load.get(m.userId) === 1 ? '' : 's'} in “${c.title}”`, url: '/app', tag: `split-${c.id}` }); });
  }
  return todo.length;
}
// A step done in a shared goal: whoever was waiting on it hears it's their turn.
function splitHandoff(userId, task) {
  if (!task || task.status !== 'Completed') return 0;
  const goalId = db.topLevelProjectId(task.projectId);
  const c = conn.prepare("SELECT * FROM challenges WHERE mode = 'split' AND goalId = ?").get(goalId);
  if (!c) return 0;
  const next = conn.prepare(`SELECT t.* FROM task_dependencies d JOIN tasks t ON t.id = d.taskId
    WHERE d.predecessorId = ? AND t.deletedAt IS NULL AND t.status != 'Completed' AND t.assigneeId IS NOT NULL AND t.assigneeId != ?`).all(task.id, userId);
  const doneBy = memberRow(c.id, userId);
  let n = 0;
  next.forEach(t => {
    const waiting = conn.prepare(`SELECT COUNT(*) AS n FROM task_dependencies d JOIN tasks p ON p.id = d.predecessorId
      WHERE d.taskId = ? AND p.deletedAt IS NULL AND p.status != 'Completed'`).get(t.id).n;
    const m = memberRow(c.id, t.assigneeId);
    if (waiting || !m) return;
    postMessage(c.id, userId, `Your turn, ${shownName(c, m)}: “${clean(task.title, 100)}” is done, so “${clean(t.title, 100)}” can start`, 'event', m.userId, null, null, t.id);
    pushTo(m.userId, { title: c.title, body: `Your turn: ${doneBy ? shownName(c, doneBy) : 'someone'} finished “${clean(task.title, 60)}”, so “${clean(t.title, 60)}” can start`, url: '/app', tag: `turn-${t.id}` });
    n++;
  });
  return n;
}

// The leader makes someone (by colour) the lead of a phase, or clears it ('').
function setLead(id, userId, { projectId, color }) {
  const c = splitOf(id, userId);
  if (!c) return null;
  if (c.ownerId !== userId) throw Object.assign(new Error('Only the leader names phase leads'), { status: 403 });
  const phase = conn.prepare('SELECT * FROM projects WHERE id = ? AND parentId = ? AND deletedAt IS NULL').get(String(projectId || ''), c.goalId);
  if (!phase) throw Object.assign(new Error('That phase is not in this goal'), { status: 404 });
  if (!color) {
    conn.prepare('DELETE FROM challenge_leads WHERE challengeId = ? AND projectId = ?').run(c.id, phase.id);
    return true;
  }
  const m = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND color = ?').get(c.id, String(color));
  if (!m) throw Object.assign(new Error('That person has left'), { status: 404 });
  conn.prepare(`INSERT INTO challenge_leads (challengeId, projectId, userId) VALUES (?,?,?)
    ON CONFLICT(challengeId, projectId) DO UPDATE SET userId = excluded.userId`).run(c.id, phase.id, m.userId);
  if (m.userId !== userId) {
    postMessage(c.id, userId, `${shownName(c, m)} leads “${clean(phase.title, 100)}”`, 'event', m.userId);
    pushTo(m.userId, { title: c.title, body: `You lead “${clean(phase.title, 80)}”: you can see its steps, hand them out and sign them off`, url: '/app', tag: `lead-${phase.id}` });
  }
  return true;
}
// The leader calls the sections phases or departments.
function setSections(id, userId, word) {
  const c = splitOf(id, userId);
  if (!c) return null;
  if (c.ownerId !== userId) throw Object.assign(new Error('Only the leader can change this'), { status: 403 });
  const v = word === 'departments' ? 'departments' : null;
  conn.prepare('UPDATE challenges SET sections = ? WHERE id = ?').run(v, c.id);
  return v || 'phases';
}
// The leader puts someone (by colour) in a department, or back to
// automatic ('', from what they lead or the steps they have).
function setDept(id, userId, { color, projectId }) {
  const c = splitOf(id, userId);
  if (!c) return null;
  if (c.ownerId !== userId) throw Object.assign(new Error('Only the leader puts people in departments'), { status: 403 });
  const m = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND color = ?').get(c.id, String(color || ''));
  if (!m) throw Object.assign(new Error('That person has left'), { status: 404 });
  let dept = null;
  if (projectId) {
    dept = conn.prepare('SELECT * FROM projects WHERE id = ? AND parentId = ? AND deletedAt IS NULL').get(String(projectId), c.goalId);
    if (!dept) throw Object.assign(new Error('That department is not in this goal'), { status: 404 });
  }
  conn.prepare('UPDATE challenge_members SET deptId = ? WHERE challengeId = ? AND userId = ?').run(dept ? dept.id : null, c.id, m.userId);
  if (dept && m.userId !== userId) postMessage(c.id, userId, `${shownName(c, m)} is in ${sectionName(dept.title)}`, 'event', m.userId);
  return true;
}
// Mark a step as a milestone (or not): the leader, or the lead of its phase.
function setMilestone(id, userId, { taskId, on }) {
  const c = splitOf(id, userId);
  if (!c) return null;
  const t = stepOfGoal(c, taskId);
  if (!t) throw Object.assign(new Error('That step is not in this goal'), { status: 404 });
  if (!manages(c, userId, t)) throw Object.assign(new Error('Only the leader or the lead of its phase marks milestones'), { status: 403 });
  if (on) conn.prepare('INSERT OR IGNORE INTO challenge_milestones (challengeId, taskId) VALUES (?,?)').run(c.id, t.id);
  else conn.prepare('DELETE FROM challenge_milestones WHERE challengeId = ? AND taskId = ?').run(c.id, t.id);
  return true;
}
// The leader changes how a split team's steps are checked.
function setChecks(id, userId, checks) {
  const c = splitOf(id, userId);
  if (!c) return null;
  if (c.ownerId !== userId) throw Object.assign(new Error('Only the leader changes how steps are signed off'), { status: 403 });
  if (!['none', 'proof', 'leader', 'milestones'].includes(checks)) throw Object.assign(new Error('Pick how steps are checked'), { status: 400 });
  conn.prepare('UPDATE challenges SET checks = ? WHERE id = ?').run(checks, c.id);
  return checks;
}

// The person who set the team up ends it, for everyone: the team, its
// chat, sign-offs, leads and milestones go, and so does each teammate's
// access to a shared goal (their steps there go back to unassigned). The
// goal and every task stay the organiser's; in a race or a group each
// person keeps their own copy. Teammates hear it has ended.
function endTeam(id, userId) {
  const c = byId(id);
  if (!c || !(c.ownerId === userId || isMember(c.id, userId))) return null;
  if (c.ownerId !== userId) throw Object.assign(new Error('Only the person who set the team up can end it. You can leave it'), { status: 403 });
  const others = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND userId != ?').all(c.id, userId);
  conn.transaction(() => {
    if (c.mode === 'split' && c.goalId) {
      others.forEach(m => {
        conn.prepare(`UPDATE tasks SET assigneeId = NULL, assigneeAssignedAt = NULL WHERE assigneeId = ? AND deletedAt IS NULL
          AND projectId IN (SELECT id FROM projects WHERE id = ? OR parentId = ?)`).run(m.userId, c.goalId, c.goalId);
        conn.prepare('DELETE FROM project_collaborators WHERE projectId = ? AND userId = ?').run(c.goalId, m.userId);
      });
    }
    ['challenge_members', 'challenge_messages', 'challenge_reads', 'challenge_cleared', 'challenge_steps', 'challenge_leads', 'challenge_milestones', 'challenge_nudges', 'challenge_removed']
      .forEach(table => conn.prepare(`DELETE FROM ${table} WHERE challengeId = ?`).run(c.id));
    conn.prepare('DELETE FROM challenges WHERE id = ?').run(c.id);
  })();
  others.forEach(m => pushTo(m.userId, { title: c.title, body: c.mode === 'split' ? `The team on “${clean(c.title, 80)}” has ended` : `“${clean(c.title, 80)}” has ended. Your copy of the goal is still yours`, url: '/app', tag: `ended-${c.id}` }));
  return { ended: true, people: others.length };
}

// Leaving takes you off the road; your copy of the goal stays yours. In a
// split goal your open steps go back to unclaimed and the goal stops being
// shared with you (the leader can't leave their own goal).
function leave(id, userId) {
  const c = byId(id);
  if (c && c.mode === 'split') {
    if (c.ownerId === userId) throw Object.assign(new Error("It's your goal, so you can't leave it. Clear it once it's finished"), { status: 400 });
    const m = memberRow(c.id, userId);
    if (!m) return false;
    const freed = dropMember(c, m);
    postEvent(c.id, `${shownName(c, m)} left${freed ? `. ${freed} step${freed === 1 ? ' is' : 's are'} unclaimed again` : ''}`, null);
    return true;
  }
  return conn.prepare('DELETE FROM challenge_members WHERE challengeId = ? AND userId = ?').run(id, userId).changes > 0;
}
// Takes someone off a team. In a split goal their open steps go back to
// unclaimed, the goal stops being shared with them and they stop leading
// anything; in a race or group their own copy of the goal stays theirs.
// Returns how many steps were freed.
function dropMember(c, m) {
  let freed = 0;
  if (c.mode === 'split' && c.goalId) {
    freed = conn.prepare(`UPDATE tasks SET assigneeId = NULL, assigneeAssignedAt = NULL WHERE assigneeId = ? AND status != 'Completed' AND deletedAt IS NULL
      AND projectId IN (SELECT id FROM projects WHERE id = ? OR parentId = ?)`).run(m.userId, c.goalId, c.goalId).changes;
    conn.prepare('DELETE FROM project_collaborators WHERE projectId = ? AND userId = ?').run(c.goalId, m.userId);
    conn.prepare('DELETE FROM challenge_leads WHERE challengeId = ? AND userId = ?').run(c.id, m.userId);
  }
  conn.prepare('DELETE FROM challenge_members WHERE challengeId = ? AND userId = ?').run(c.id, m.userId);
  return freed;
}

// ── Managing a team (the person who set it up) ──
const ownedTeam = (id, userId) => {
  const c = byId(id);
  if (!c || !(c.ownerId === userId || isMember(c.id, userId))) return null;
  if (c.ownerId !== userId) throw Object.assign(new Error('Only the person who set the team up can manage it'), { status: 403 });
  return c;
};
const memberByColor = (c, color) => {
  const m = conn.prepare('SELECT * FROM challenge_members WHERE challengeId = ? AND color = ?').get(c.id, String(color || ''));
  if (!m) throw Object.assign(new Error('That person has left'), { status: 404 });
  return m;
};
// The team's name.
function renameTeam(id, userId, title) {
  const c = ownedTeam(id, userId);
  if (!c) return null;
  const t = clean(title, 80);
  if (!t) throw Object.assign(new Error('Give the team a name'), { status: 400 });
  if (t === c.title) return t;
  conn.prepare('UPDATE challenges SET title = ? WHERE id = ?').run(t, c.id);
  postEvent(c.id, `The team is now called “${t}”`, userId);
  return t;
}
// Someone's name in this team: the leader can change anyone's, everyone
// can change their own.
function renameMember(id, userId, { color, name }) {
  const c = byId(id);
  if (!c || !(c.ownerId === userId || isMember(c.id, userId))) return null;
  const m = color ? memberByColor(c, color) : memberRow(c.id, userId);
  if (!m) throw Object.assign(new Error("You're not on this team"), { status: 404 });
  if (m.userId !== userId && c.ownerId !== userId) throw Object.assign(new Error('Only the leader can change other people’s names'), { status: 403 });
  const n = clean(name, 40);
  if (!n) throw Object.assign(new Error('Names can’t be empty'), { status: 400 });
  if (n === m.displayName) return n;
  conn.prepare('UPDATE challenge_members SET displayName = ? WHERE challengeId = ? AND userId = ?').run(n, c.id, m.userId);
  if (c.nameMode !== 'animals') postEvent(c.id, `${shownName(c, m)} is now ${shownName(c, { ...m, displayName: n })}`, userId);
  return n;
}
// The leader takes someone off the team. They can't join again with the
// link or code until the leader lets them back in.
function removeMember(id, userId, color) {
  const c = ownedTeam(id, userId);
  if (!c) return null;
  const m = memberByColor(c, color);
  if (m.userId === userId) throw Object.assign(new Error(c.mode === 'split' ? "It's your goal, so you stay on the team" : 'To leave, use Leave instead'), { status: 400 });
  const freed = dropMember(c, m);
  conn.prepare(`INSERT INTO challenge_removed (challengeId, userId, displayName, removedAt) VALUES (?,?,?,?)
    ON CONFLICT(challengeId, userId) DO UPDATE SET displayName = excluded.displayName, removedAt = excluded.removedAt`).run(c.id, m.userId, m.displayName, new Date().toISOString());
  postEvent(c.id, `${shownName(c, m)} is no longer on the team${freed ? `. ${freed} step${freed === 1 ? ' is' : 's are'} unclaimed again` : ''}`, userId);
  pushTo(m.userId, { title: c.title, body: `You've been taken off “${clean(c.title, 80)}”${c.mode === 'split' ? '' : '. Your copy of the goal is still yours'}`, url: '/app', tag: `removed-${c.id}` });
  return { removed: true, freed };
}
// Who's been removed (for the leader), and letting someone back in.
function removedList(id, userId) {
  const c = ownedTeam(id, userId);
  if (!c) return null;
  return conn.prepare('SELECT userId, displayName, removedAt FROM challenge_removed WHERE challengeId = ? ORDER BY removedAt DESC').all(c.id)
    .map((r, i) => ({ ref: i, name: r.displayName, removedAt: r.removedAt }));
}
function letBackIn(id, userId, ref) {
  const c = ownedTeam(id, userId);
  if (!c) return null;
  const rows = conn.prepare('SELECT userId FROM challenge_removed WHERE challengeId = ? ORDER BY removedAt DESC').all(c.id);
  const r = rows[Number(ref)];
  if (!r) throw Object.assign(new Error('That person is not on the removed list'), { status: 404 });
  conn.prepare('DELETE FROM challenge_removed WHERE challengeId = ? AND userId = ?').run(c.id, r.userId);
  return true;
}

module.exports = { renameTeam, renameMember, removeMember, removedList, letBackIn, endTeam, setSections, setDept, setLead, setMilestone, setChecks, assignStep, claimStep, splitEvenly, splitHandoff, weekFor, activitySince, askHelp, offerHelp, helpCleared, helpPlaces, submitProof, review, proofFile, proofWantedFor, createChallenge, preview, previewByCode, join, get, forProject, listMine, clear, unclear, messages, say, cheer, cheersSeen, leave, remind, nudgesSince, MAX_PLAYERS, MAX_TOGETHER };
