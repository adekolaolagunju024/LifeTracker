const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

const sessionCookie = res => (res.headers.get('set-cookie') || '').split(';')[0];
const uniqueEmail = () => `race_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`;
const call = (cookie, method, path, body) => fetch(`${server.base}${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const signUp = async () => sessionCookie(await call(null, 'POST', '/api/auth/register', { email: uniqueEmail(), password: 'testpass123', acceptTerms: true }));
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();

async function goalWithTasks(cookie, titles) {
  const p = await (await call(cookie, 'POST', '/api/projects', { title: 'Run 5k', isGoal: true })).json();
  for (const title of titles) await call(cookie, 'POST', '/api/tasks', { projectId: p.id, title, status: 'Not Started', priority: 'Medium' });
  return p;
}
const tasksOf = async (cookie, projectId) => (await (await call(cookie, 'GET', '/api/tasks')).json()).filter(t => t.projectId === projectId);
const finish = async (cookie, projectId) => { for (const t of await tasksOf(cookie, projectId)) await call(cookie, 'PUT', `/api/tasks/${t.id}`, { status: 'Completed' }); };

test('a race: make it, share the link, everyone gets their own copy, first to finish wins', async () => {
  const ana = await signUp();
  const ben = await signUp();
  const goal = await goalWithTasks(ana, ['Walk-run 20 min', 'Run 2k', 'Run 5k']);

  // Needs a sensible deadline, and the goal must have tasks.
  assert.equal((await call(ana, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(0.1) })).status, 400);
  const empty = await (await call(ana, 'POST', '/api/projects', { title: 'Empty' })).json();
  assert.equal((await call(ana, 'POST', '/api/challenges', { projectId: empty.id, endsAt: inDays(14) })).status, 400);

  const made = await call(ana, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(14), stake: 'Loser buys dinner', displayName: 'Ana' });
  assert.equal(made.status, 201);
  const race = await made.json();
  assert.equal(race.players.length, 1);
  assert.ok(race.joinToken);
  const anaCopy = race.players[0].projectId;
  assert.equal(anaCopy, goal.id, 'the maker races on the goal they have, not a duplicate');
  const anaProjects = await (await call(ana, 'GET', '/api/projects')).json();
  assert.equal(anaProjects.filter(p => p.title.startsWith('Run 5k')).length, 1, 'no copy made for the maker');
  assert.equal((await tasksOf(ana, anaCopy)).length, 3);

  // The link's preview works signed out and shows no one's progress.
  const preview = await (await call(null, 'GET', `/api/race-preview/${race.joinToken}`)).json();
  assert.equal(preview.title, 'Run 5k');
  assert.equal(preview.stake, 'Loser buys dinner');
  assert.equal(preview.players, 1);
  assert.equal(preview.players.length, undefined);
  assert.equal((await call(null, 'GET', '/api/race-preview/nope')).status, 404);

  // Someone else can't read the race until they join.
  assert.equal((await call(ben, 'GET', `/api/challenges/${race.id}`)).status, 404);
  const joined = await call(ben, 'POST', `/api/challenges/join/${race.joinToken}`, { displayName: 'Ben' });
  assert.equal(joined.status, 201);
  const benCopy = (await joined.json()).projectId;
  assert.equal((await tasksOf(ben, benCopy)).length, 3);
  // Joining twice just returns the same copy.
  assert.equal((await (await call(ben, 'POST', `/api/challenges/join/${race.joinToken}`, {})).json()).projectId, benCopy);

  // Deleting tasks from your copy never gets you there sooner.
  const benTasks = await tasksOf(ben, benCopy);
  await call(ben, 'DELETE', `/api/tasks/${benTasks[2].id}`);
  await call(ben, 'PUT', `/api/tasks/${benTasks[0].id}`, { status: 'Completed' });
  await call(ben, 'PUT', `/api/tasks/${benTasks[1].id}`, { status: 'Completed' });
  let board = await (await call(ana, 'GET', `/api/challenges/${race.id}`)).json();
  const benRow = board.players.find(p => p.name === 'Ben');
  assert.equal(benRow.done, 2);
  assert.equal(benRow.finished, false, 'two of the three is not finished');
  assert.equal(board.winner, null);
  assert.equal(benRow.projectId, undefined, "another player's copy stays private");

  // Ana finishes all three: she wins, and is first on the board.
  await finish(ana, anaCopy);
  board = await (await call(ben, 'GET', `/api/challenges/${race.id}`)).json();
  assert.equal(board.winner.name, 'Ana');
  assert.equal(board.players[0].name, 'Ana');
  assert.equal(board.players[0].pace, 'finished');
  assert.ok(board.players.every(p => p.color));

  // The Journey finds the race from your copy.
  const forJourney = await (await call(ben, 'GET', `/api/challenges/for-project/${benCopy}`)).json();
  assert.equal(forJourney.id, race.id);
  assert.equal((await (await call(ben, 'GET', `/api/challenges/for-project/${goal.id}`)).json()), null);

  // Leaving takes you off the board.
  assert.equal((await call(ben, 'POST', `/api/challenges/${race.id}/leave`)).status, 200);
  board = await (await call(ana, 'GET', `/api/challenges/${race.id}`)).json();
  assert.deepEqual(board.players.map(p => p.name), ['Ana']);
  assert.equal((await (await call(ana, 'GET', '/api/challenges')).json()).length, 1);
});

test('a class: the teacher organises without a copy, students join by code, see each other as chosen, and get nudged', async () => {
  const teacher = await signUp();
  const [s1, s2] = [await signUp(), await signUp()];
  const goal = await goalWithTasks(teacher, ['Read chapter 1', 'Answer the questions', 'Write a summary', 'Peer review']);
  const made = await call(teacher, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), mode: 'together', organiserOnly: true, nameMode: 'animals' });
  assert.equal(made.status, 201);
  const cls = await made.json();
  assert.equal(cls.mode, 'together');
  assert.equal(cls.organiserOnly, true);
  assert.equal(cls.players.length, 0, 'the organiser has no copy');
  assert.match(cls.joinCode, /^[A-HJ-NP-Z2-9]{6}$/);

  // Students join with the code (any case, with spaces); the teacher can't join their own.
  const code = cls.joinCode.toLowerCase().replace(/(...)/, '$1 ');
  assert.equal((await call(null, 'GET', `/api/race-code/${cls.joinCode}`)).status, 401, 'a code preview needs signing in');
  assert.equal((await call(s1, 'POST', `/api/challenges/join-code/${encodeURIComponent(code)}`, { displayName: 'Amara Okafor' })).status, 201);
  assert.equal((await call(s2, 'POST', `/api/challenges/join-code/${cls.joinCode}`, { displayName: 'Ben Smith' })).status, 201);
  assert.equal((await call(teacher, 'POST', `/api/challenges/join-code/${cls.joinCode}`, {})).status, 400);
  assert.equal((await call(s1, 'POST', '/api/challenges/join-code/ZZZZZZ', {})).status, 404);

  // Amara does one step.
  const s1Copy = (await (await call(s1, 'GET', `/api/challenges/${cls.id}`)).json()).players.find(p => p.you).projectId;
  const t = (await tasksOf(s1, s1Copy))[0];
  await call(s1, 'PUT', `/api/tasks/${t.id}`, { status: 'Completed' });

  // The teacher sees real names, last step times and the group's progress; no winner.
  const forTeacher = await (await call(teacher, 'GET', `/api/challenges/${cls.id}`)).json();
  assert.deepEqual(forTeacher.players.map(p => p.name).sort(), ['Amara Okafor', 'Ben Smith']);
  assert.ok(forTeacher.players.find(p => p.name === 'Amara Okafor').lastStepAt);
  assert.equal(forTeacher.winner, null);
  assert.equal(forTeacher.group.players, 2);
  assert.equal(forTeacher.group.stepsPct, 13); // 1 of 8 steps
  assert.ok((await (await call(teacher, 'GET', '/api/challenges')).json()).some(c => c.id === cls.id), "it's in the organiser's list");

  // Students see themselves by name and classmates as animals, never last-step times.
  const forBen = await (await call(s2, 'GET', `/api/challenges/${cls.id}`)).json();
  assert.equal(forBen.players.find(p => p.you).name, 'Ben Smith');
  const other = forBen.players.find(p => !p.you);
  assert.match(other.name, /^\w+ \w+$/);
  assert.notEqual(other.name, 'Amara Okafor');
  assert.equal(other.lastStepAt, undefined);

  // Only the teacher can nudge, once per 12 hours; it reaches whoever's behind or hasn't started.
  assert.equal((await call(s1, 'POST', `/api/challenges/${cls.id}/remind`)).status, 403);
  const nudged = await (await call(teacher, 'POST', `/api/challenges/${cls.id}/remind`)).json();
  assert.ok(nudged.reminded >= 1);
  assert.equal((await call(teacher, 'POST', `/api/challenges/${cls.id}/remind`)).status, 429);
  const bell = await (await call(s2, 'GET', '/api/notifications')).json();
  assert.ok(bell.challengeNudges.some(n => n.challengeId === cls.id));
});

test('finishing places: 1st, 2nd and 3rd go by who ticked their last step first', async () => {
  const [a, b, c, d] = [await signUp(), await signUp(), await signUp(), await signUp()];
  const goal = await goalWithTasks(a, ['One', 'Two']);
  const race = await (await call(a, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), displayName: 'Ana' })).json();
  const copies = { a: race.players[0].projectId };
  for (const [k, who, name] of [['b', b, 'Ben'], ['c', c, 'Cleo'], ['d', d, 'Dev']]) {
    copies[k] = (await (await call(who, 'POST', `/api/challenges/join/${race.joinToken}`, { displayName: name })).json()).projectId;
  }
  // Cleo first, then Ana, then Ben; Dev doesn't finish.
  await finish(c, copies.c);
  await new Promise(r => setTimeout(r, 15));
  await finish(a, copies.a);
  await new Promise(r => setTimeout(r, 15));
  await finish(b, copies.b);
  const board = await (await call(d, 'GET', `/api/challenges/${race.id}`)).json();
  assert.deepEqual(board.players.map(p => [p.name, p.place || null]), [['Cleo', 1], ['Ana', 2], ['Ben', 3], ['Dev', null]]);
  assert.equal(board.winner.name, 'Cleo');
  assert.equal(board.yourPlace, null);
  assert.equal((await (await call(b, 'GET', `/api/challenges/${race.id}`)).json()).yourPlace, 3);
});

test('a group says who leads it: a coach, a trainer, a teacher…; races have no leader', async () => {
  const [coach, player] = [await signUp(), await signUp()];
  const goal = await goalWithTasks(coach, ['Run 3k', 'Gym session', 'Recovery day']);
  const squad = await (await call(coach, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), mode: 'together', organiserOnly: true, leaderRole: 'coach' })).json();
  assert.equal(squad.leaderRole, 'coach');
  const preview = await (await call(player, 'GET', `/api/race-code/${squad.joinCode}`)).json();
  assert.equal(preview.leaderRole, 'coach', 'the invite says who is asking');
  // An unknown role falls back to a team leader; a race has none.
  const odd = await (await call(coach, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), mode: 'together', leaderRole: 'emperor', displayName: 'Sam' })).json();
  assert.equal(odd.leaderRole, 'leader');
  const race = await (await call(coach, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), leaderRole: 'coach', displayName: 'Sam' })).json();
  assert.equal(race.leaderRole, null);
});

test("the maker's own goal is used, unless a race would start them ahead", async () => {
  const ana = await signUp();
  const goal = await goalWithTasks(ana, ['One', 'Two', 'Three']);
  // A group uses the leader's goal even with steps done.
  const t = (await tasksOf(ana, goal.id))[0];
  await call(ana, 'PUT', `/api/tasks/${t.id}`, { status: 'Completed' });
  const group = await (await call(ana, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), mode: 'together', displayName: 'Ana' })).json();
  assert.equal(group.players[0].projectId, goal.id);
  assert.equal(group.players[0].done, 1);
  // A race from a goal with a step already ticked starts Ana on a fresh copy.
  const other = await goalWithTasks(ana, ['A', 'B']);
  const first = (await tasksOf(ana, other.id))[0];
  await call(ana, 'PUT', `/api/tasks/${first.id}`, { status: 'Completed' });
  const race = await (await call(ana, 'POST', '/api/challenges', { projectId: other.id, endsAt: inDays(7), displayName: 'Ana' })).json();
  assert.notEqual(race.players[0].projectId, other.id);
  assert.equal(race.players[0].done, 0, 'everyone starts level');
  // A goal already in a group keeps its place there: a second one copies.
  const again = await (await call(ana, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), mode: 'together', displayName: 'Ana' })).json();
  assert.notEqual(again.players[0].projectId, goal.id);
});

test('a finished race can be cleared off your Teams list, and put back; a running one cannot', async () => {
  const [ana, ben] = [await signUp(), await signUp()];
  const goal = await goalWithTasks(ana, ['One', 'Two']);
  const race = await (await call(ana, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), displayName: 'Ana' })).json();
  const benCopy = (await (await call(ben, 'POST', `/api/challenges/join/${race.joinToken}`, { displayName: 'Ben' })).json()).projectId;
  assert.equal(race.doneForYou, false);
  assert.equal((await call(ben, 'POST', `/api/challenges/${race.id}/clear`)).status, 400, 'still running');
  await finish(ben, benCopy);
  const board = await (await call(ben, 'GET', `/api/challenges/${race.id}`)).json();
  assert.equal(board.doneForYou, true, 'Ben has finished');
  assert.equal((await call(ben, 'POST', `/api/challenges/${race.id}/clear`)).status, 200);
  assert.equal((await (await call(ben, 'GET', '/api/challenges')).json()).length, 0, 'off Ben’s list');
  assert.equal((await (await call(ana, 'GET', '/api/challenges')).json()).length, 1, 'still on Ana’s');
  assert.equal((await (await call(ana, 'GET', `/api/challenges/${race.id}`)).json()).players.length, 2, 'Ben still on the scoreboard');
  assert.equal((await call(ben, 'DELETE', `/api/challenges/${race.id}/clear`)).status, 200);
  assert.equal((await (await call(ben, 'GET', '/api/challenges')).json()).length, 1, 'back on Ben’s list');
  assert.equal((await call(await signUp(), 'POST', `/api/challenges/${race.id}/clear`)).status, 404, 'not theirs');
});

test('a race has its own chat: joins, halfway and finishes post themselves, cheers reach one player', async () => {
  const [ana, ben] = [await signUp(), await signUp()];
  const goal = await goalWithTasks(ana, ['One', 'Two']);
  const race = await (await call(ana, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), displayName: 'Ana' })).json();
  const benCopy = (await (await call(ben, 'POST', `/api/challenges/join/${race.joinToken}`, { displayName: 'Ben' })).json()).projectId;
  assert.equal((await call(ana, 'POST', `/api/challenges/${race.id}/messages`, { text: 'Loser buys dinner 😄' })).status, 201);
  assert.equal((await call(ana, 'POST', `/api/challenges/${race.id}/messages`, { text: '   ' })).status, 400);
  // Ben has two unread lines (his own join doesn't count): Ana's message... and sees it
  const benBoard = await (await call(ben, 'GET', `/api/challenges/${race.id}`)).json();
  assert.equal(benBoard.chat.unread, 1, 'Ana’s message (his own join line is his)');
  const tasks = await tasksOf(ben, benCopy);
  await call(ben, 'PUT', `/api/tasks/${tasks[0].id}`, { status: 'Completed' });
  await call(ben, 'GET', `/api/challenges/${race.id}`); // the scoreboard notices: halfway
  await finish(ben, benCopy);
  await call(ana, 'GET', `/api/challenges/${race.id}`); // finished, 1st
  const thread = await (await call(ana, 'GET', `/api/challenges/${race.id}/messages`)).json();
  assert.deepEqual(thread.map(m => [m.kind, m.kind === 'msg' ? m.author : m.text]), [['event', 'Ben joined'], ['msg', 'You'], ['event', 'Ben is halfway'], ['event', 'Ben finished 1st 🥇']]);
  assert.equal((await (await call(ana, 'GET', `/api/challenges/${race.id}`)).json()).chat.unread, 0, 'reading marks it read');
  // A cheer for Ben by his colour; Ben sees it once.
  const benColor = benBoard.players.find(p => p.you).color;
  assert.equal((await call(ana, 'POST', `/api/challenges/${race.id}/cheer`, { color: benColor, emoji: '🔥' })).status, 201);
  assert.equal((await call(ana, 'POST', `/api/challenges/${race.id}/cheer`, { color: race.players[0].color, emoji: '🔥' })).status, 400, 'not yourself');
  const seen = (await (await call(ben, 'GET', `/api/challenges/${race.id}`)).json()).chat.cheers;
  assert.deepEqual(seen.map(c => [c.from, c.emoji]), [['Ana', '🔥']]);
  await call(ben, 'POST', `/api/challenges/${race.id}/cheers-seen`);
  assert.equal((await (await call(ben, 'GET', `/api/challenges/${race.id}`)).json()).chat.cheers.length, 0);
  // Strangers can't read or write it.
  const eve = await signUp();
  assert.equal((await call(eve, 'GET', `/api/challenges/${race.id}/messages`)).status, 404);
  assert.equal((await call(eve, 'POST', `/api/challenges/${race.id}/messages`, { text: 'hi' })).status, 404);
});

test("the leader's reminder goes into the group's chat", async () => {
  const [coach, p1] = [await signUp(), await signUp()];
  const goal = await goalWithTasks(coach, ['Run', 'Gym']);
  const squad = await (await call(coach, 'POST', '/api/challenges', { projectId: goal.id, endsAt: inDays(7), mode: 'together', organiserOnly: true, leaderRole: 'coach' })).json();
  await call(p1, 'POST', `/api/challenges/join-code/${squad.joinCode}`, { displayName: 'Sam' });
  assert.equal((await call(coach, 'POST', `/api/challenges/${squad.id}/remind`)).status, 200);
  const thread = await (await call(p1, 'GET', `/api/challenges/${squad.id}/messages`)).json();
  const nudge = thread.find(m => m.kind === 'nudge');
  assert.ok(nudge && /^Coach /.test(nudge.author) && nudge.leader, 'from the coach, by role');
});
