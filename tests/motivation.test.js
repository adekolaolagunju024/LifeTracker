const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const dbFile = path.join(os.tmpdir(), `wayrise-motivation-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');
const motivation = require('../backend/motivation');

const now = () => new Date().toISOString();
const user = () => db.createUser({ id: randomUUID(), email: `m_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: now(), acceptedTermsAt: now() });

after(() => {
  require('../backend/db/connection').close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
});

test('a new account starts empty, with everything switched on', () => {
  const m = motivation.get(user().id);
  assert.ok(motivation.isEmpty(m));
  assert.deepEqual(m.show, { dashboard: true, alarms: true, nudges: true, assistant: true });
  assert.equal(motivation.nudgeLine(m), '');
  assert.equal(motivation.forAssistant(m), '');
});

test('saving keeps only known fields, trims them and caps quotes at 12', () => {
  const u = user();
  const quotes = Array.from({ length: 20 }, (_, i) => ({ text: `  Quote ${i}  `, source: 'Book' }));
  const m = motivation.save(u.id, { why: '  For my family  ', becoming: 'x'.repeat(500), quotes, extra: 'ignored', mentor: { preset: 'nope', name: 'Mum', routine: 'Up at 6' } });
  assert.equal(m.why, 'For my family');
  assert.equal(m.becoming.length, 200);
  assert.equal(m.quotes.length, 12);
  assert.equal(m.quotes[0].text, 'Quote 0');
  assert.equal(m.mentor.preset, null);
  assert.equal(m.mentor.name, 'Mum');
  assert.equal(m.extra, undefined);
  // Saved per person.
  assert.ok(motivation.isEmpty(motivation.get(user().id)));
});

test('only web links are kept for the playlist', () => {
  const u = user();
  assert.equal(motivation.save(u.id, { playlist: { url: 'javascript:alert(1)' } }).playlist.url, '');
  assert.equal(motivation.save(u.id, { playlist: { url: 'not a link' } }).playlist.url, '');
  assert.equal(motivation.save(u.id, { playlist: { url: 'https://open.spotify.com/playlist/abc' } }).playlist.url, 'https://open.spotify.com/playlist/abc');
});

test('every starter quote has its source, and mentor types come with a routine', () => {
  for (const q of motivation.LIBRARY) {
    assert.ok(q.text && q.source && q.group, q.id);
  }
  assert.ok(motivation.LIBRARY.some(q => q.group === 'Bible') && motivation.LIBRARY.some(q => q.group === 'Quran'));
  for (const p of motivation.MENTORS) assert.ok(p.routine && p.says, p.id);
});

test('nudges and the assistant use what was saved, and respect the switches', () => {
  const u = user();
  let m = motivation.save(u.id, { why: 'To be a nurse', quotes: [{ text: 'Keep going', source: 'Me' }], mentor: { name: 'Coach', routine: 'Trains daily' } });
  assert.match(motivation.nudgeLine(m), /To be a nurse|Keep going/);
  const ctx = motivation.forAssistant(m);
  assert.match(ctx, /To be a nurse/);
  assert.match(ctx, /Coach, whose routine is: Trains daily/);
  assert.match(ctx, /"Keep going" \(Me\)/);
  m = motivation.save(u.id, { ...m, show: { nudges: false, assistant: false } });
  assert.equal(motivation.nudgeLine(m), '');
  assert.equal(motivation.forAssistant(m), '');
  assert.equal(m.show.dashboard, true);
});

test('deleting the account deletes their why', () => {
  const u = user();
  motivation.save(u.id, { why: 'Private' });
  db.deleteUser(u.id);
  assert.ok(motivation.isEmpty(motivation.get(u.id)));
});

test('music is a library of up to 12 playlists, the first plays by default', () => {
  const u = user();
  // An older single playlist joins the library.
  let m = motivation.save(u.id, { playlist: { url: 'https://open.spotify.com/playlist/old', label: 'Old focus' } });
  assert.deepEqual(m.playlists, [{ url: 'https://open.spotify.com/playlist/old', label: 'Old focus' }]);
  const many = Array.from({ length: 15 }, (_, i) => ({ url: `https://youtu.be/vid${i}abc`, label: `Mix ${i}` }));
  m = motivation.save(u.id, { playlists: [many[0], many[0], { url: 'javascript:x' }, ...many] });
  assert.equal(m.playlists.length, 12);
  assert.equal(m.playlists[0].label, 'Mix 0');
  assert.equal(new Set(m.playlists.map(p => p.url)).size, 12);
  assert.equal(m.playlist.url, m.playlists[0].url);
  assert.match(motivation.forAssistant(m), /Mix 0 \(default\)/);
});

test('people choose where their quotes come from', () => {
  const u = user();
  const m = motivation.save(u.id, { sources: ['Quran', 'Torah', 'Quran'] });
  assert.deepEqual(m.sources, ['Quran']);
  assert.deepEqual(motivation.SOURCES.sort(), ['Bible', 'Books and speeches', 'Quran']);
});

test('the interview draft only keeps what the person chose or said', () => {
  const said = ['I want to qualify as a nurse so my mum can retire', 'My faith is Islam', 'Coach Ade always says no excuses, just reps', 'https://open.spotify.com/playlist/abc is my playlist', 'My gran says small steps every day'];
  const d = motivation.draftFromInterview({
    sources: ['Quran'],
    why: 'So my mum can retire',
    shelfQuoteIds: ['quran-94-5', 'phil-4-13'],          // a Bible verse they didn't choose
    ownQuotes: [{ text: 'Small steps every day', source: 'My gran' }, { text: 'Invented wisdom', source: 'Someone' }],
    mentorName: 'Coach Ade', mentorSays: 'No excuses, just reps', mentorRoutine: 'Trains at 6',
    musicLinks: [{ url: 'https://open.spotify.com/playlist/abc', label: 'Mine' }, { url: 'https://open.spotify.com/playlist/made-up' }],
  }, said);
  assert.deepEqual(d.sources, ['Quran']);
  assert.deepEqual(d.quotes.map(q => q.source), ['Quran 94:5–6 (Sahih International)', 'My gran']);
  assert.equal(d.mentor.says, 'No excuses, just reps');
  assert.deepEqual(d.playlists.map(p => p.url), ['https://open.spotify.com/playlist/abc']);
  // Words a real person didn't say are dropped.
  assert.equal(motivation.draftFromInterview({ mentorName: 'Serena', mentorSays: 'Never give up' }, said).mentor.says, '');
  // No sources chosen, no scripture.
  assert.equal(motivation.draftFromInterview({ shelfQuoteIds: ['quran-94-5'] }, said).quotes.length, 0);
});
