const db = require('./db/connection');

// ── YOUR WHY ────────────────────────────────────────────────────
// The things that get a particular person moving when they'd rather not:
// why the goal matters, who they're becoming, someone they look up to and
// that person's routine, the quotes that speak to them (their own, or from
// the starter shelf below) and the music they work to. The app shows these
// at the moments people give up: the alarm, a stuck task, the dashboard,
// a nudge on the phone, and in the assistant's coaching.
//
// The starter shelf holds only quotes we can source exactly: scripture
// from public translations with the verse, and lines from books and
// speeches with where they were written or said. Popular quotes are often
// misattributed, so nothing goes in on the strength of the internet alone,
// and the assistant is told never to invent a quote or put words in a real
// person's mouth.

const LIBRARY = [
  { id: 'phil-4-13', group: 'Bible', text: 'I can do all things through Christ which strengtheneth me.', source: 'Philippians 4:13 (KJV)' },
  { id: 'gal-6-9', group: 'Bible', text: 'And let us not be weary in well doing: for in due season we shall reap, if we faint not.', source: 'Galatians 6:9 (KJV)' },
  { id: 'prov-16-3', group: 'Bible', text: 'Commit thy works unto the LORD, and thy thoughts shall be established.', source: 'Proverbs 16:3 (KJV)' },
  { id: 'prov-14-23', group: 'Bible', text: 'In all labour there is profit: but the talk of the lips tendeth only to penury.', source: 'Proverbs 14:23 (KJV)' },
  { id: 'isa-40-31', group: 'Bible', text: 'They shall run, and not be weary; and they shall walk, and not faint.', source: 'Isaiah 40:31 (KJV)' },
  { id: 'quran-94-5', group: 'Quran', text: 'For indeed, with hardship [will be] ease. Indeed, with hardship [will be] ease.', source: 'Quran 94:5–6 (Sahih International)' },
  { id: 'quran-13-11', group: 'Quran', text: 'Indeed, Allah will not change the condition of a people until they change what is in themselves.', source: 'Quran 13:11 (Sahih International)' },
  { id: 'quran-2-286', group: 'Quran', text: 'Allah does not charge a soul except [with that within] its capacity.', source: 'Quran 2:286 (Sahih International)' },
  { id: 'quran-53-39', group: 'Quran', text: 'And that there is not for man except that [good] for which he strives.', source: 'Quran 53:39 (Sahih International)' },
  { id: 'tao-64', group: 'Books and speeches', text: 'The journey of a thousand miles begins with a single step.', source: 'Lao Tzu, Tao Te Ching, chapter 64' },
  { id: 'aurelius-10-16', group: 'Books and speeches', text: 'Waste no more time arguing about what a good man should be. Be one.', source: 'Marcus Aurelius, Meditations, book 10' },
  { id: 'durant-habit', group: 'Books and speeches', text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', source: 'Will Durant, The Story of Philosophy (1926), on Aristotle' },
  { id: 'roosevelt-do', group: 'Books and speeches', text: 'Do what you can, with what you have, where you are.', source: 'Theodore Roosevelt, An Autobiography (1913)' },
  { id: 'mlk-keep-moving', group: 'Books and speeches', text: "If you can't fly then run, if you can't run then walk, if you can't walk then crawl, but whatever you do you have to keep moving forward.", source: 'Martin Luther King Jr., Spelman College, 1960' },
];

// Where people like their words from. Nobody is shown or offered quotes
// from a source they didn't choose.
const SOURCES = [...new Set(LIBRARY.map(q => q.group))];

// Mentors by type, for people who'd rather pick a kind of person than name
// someone. Each comes with the routine the app reminds them of.
const MENTORS = [
  { id: 'athlete', name: 'The athlete', routine: 'Trains at the same time every day, even when it rains. Counts small wins. Never misses twice.', says: "Get your shoes on. That's the whole job for the next two minutes." },
  { id: 'founder', name: 'The founder', routine: 'Picks the one task that moves things forward and does it first. Ships before it is perfect. Asks for help early.', says: 'Done beats perfect. Ship the first version today.' },
  { id: 'scholar', name: 'The scholar', routine: 'Works in focused blocks with the phone in another room. Reviews notes before sleep.', says: 'Phone away. Twenty-five minutes. Then you can rest.' },
  { id: 'carer', name: 'The carer', routine: 'Plans tomorrow the night before. Does the hardest thing first. Rests on purpose, not by accident.', says: "Do the hard one first. You'll feel lighter all day." },
  { id: 'creator', name: 'The creator', routine: 'Makes something every day, however small. Finishes before polishing. Shares the work.', says: 'Make the ugly first draft. You can fix it once it exists.' },
];

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeUrl = v => {
  const s = str(v, 500);
  if (!s) return '';
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; }
};

// Keeps only what we expect, at sensible lengths, so the JSON can't grow
// without bound or carry anything we'd later render unescaped.
function clean(input = {}) {
  const m = input.mentor || {};
  const preset = MENTORS.find(x => x.id === m.preset);
  const quotes = (Array.isArray(input.quotes) ? input.quotes : [])
    .map(q => ({ text: str(q && q.text, 300), source: str(q && q.source, 120) }))
    .filter(q => q.text)
    .slice(0, 12);
  const show = input.show || {};
  // Their music library, like a music app's: up to 12 saved playlists or
  // tracks, the first being the one that plays by default. An older single
  // playlist (before the library) joins the list.
  const seen = new Set();
  const playlists = [...(Array.isArray(input.playlists) ? input.playlists : []), input.playlist || {}]
    .map(p => ({ url: safeUrl(p && p.url), label: str(p && p.label, 60) }))
    .filter(p => p.url && !seen.has(p.url) && seen.add(p.url))
    .slice(0, 12);
  return {
    sources: (Array.isArray(input.sources) ? input.sources : []).filter(g => SOURCES.includes(g)).filter((g, i, a) => a.indexOf(g) === i),
    why: str(input.why, 300),
    becoming: str(input.becoming, 200),
    mentor: { preset: preset ? preset.id : null, name: str(m.name, 80), routine: str(m.routine, 400), says: str(m.says, 200) },
    quotes,
    playlists,
    playlist: playlists[0] || { url: '', label: '' }, // the default one
    show: {
      dashboard: show.dashboard !== false,
      alarms: show.alarms !== false,
      nudges: show.nudges !== false,
      assistant: show.assistant !== false,
    },
  };
}

function get(userId) {
  const row = db.prepare('SELECT data, updatedAt FROM motivation WHERE userId = ?').get(userId);
  let data = {};
  try { data = row ? JSON.parse(row.data) : {}; } catch { data = {}; }
  return { ...clean(data), updatedAt: row ? row.updatedAt : null };
}

function save(userId, input) {
  const data = clean(input);
  db.prepare(`INSERT INTO motivation (userId, data, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`)
    .run(userId, JSON.stringify(data), new Date().toISOString());
  return get(userId);
}

function isEmpty(m) {
  return !m.why && !m.becoming && !m.mentor.name && !m.quotes.length && !m.playlist.url;
}

// Today's quote: the same one all day, a different one tomorrow.
function quoteOfTheDay(m, date = new Date()) {
  if (!m.quotes.length) return null;
  const day = Math.floor(date.getTime() / 86400000);
  return m.quotes[day % m.quotes.length];
}

// The interview's draft, kept honest: shelf quotes only from the sources
// the person chose, their own quotes and a real mentor's words only if they
// said them, and only music links they pasted.
function draftFromInterview(d = {}, userMessages = []) {
  const said = userMessages.map(t => String(t).toLowerCase()).join('\n');
  const theirs = s => !!s && said.includes(String(s).toLowerCase().trim().replace(/[.!?]+$/, ''));
  const preset = MENTORS.find(p => p.id === d.mentorPreset);
  const sources = (Array.isArray(d.sources) ? d.sources : []).filter(g => SOURCES.includes(g));
  return clean({
    sources,
    why: d.why,
    becoming: d.becoming,
    mentor: preset
      ? { preset: preset.id, name: preset.name, routine: d.mentorRoutine || preset.routine, says: d.mentorSays || preset.says }
      : { preset: null, name: d.mentorName, routine: d.mentorRoutine, says: theirs(d.mentorSays) ? d.mentorSays : '' },
    quotes: [
      ...(Array.isArray(d.shelfQuoteIds) ? d.shelfQuoteIds : []).map(id => LIBRARY.find(q => q.id === id)).filter(q => q && sources.includes(q.group)).map(q => ({ text: q.text, source: q.source })),
      ...(Array.isArray(d.ownQuotes) ? d.ownQuotes : []).filter(q => q && theirs(q.text)),
    ],
    playlists: (Array.isArray(d.musicLinks) ? d.musicLinks : []).filter(l => l && l.url && said.includes(String(l.url).toLowerCase())),
  });
}

// One short line for a phone nudge, from whatever the person filled in.
function nudgeLine(m, date = new Date()) {
  if (!m.show.nudges || isEmpty(m)) return '';
  const q = quoteOfTheDay(m, date);
  if (m.why && (!q || Math.floor(date.getTime() / 86400000) % 2 === 0)) return `Remember why: ${m.why}`;
  if (q) return `“${q.text}”${q.source ? ` (${q.source})` : ''}`;
  if (m.becoming) return `You're becoming ${m.becoming}`;
  return '';
}

// What the assistant is told, when the person allows it.
function forAssistant(m) {
  if (!m.show.assistant || isEmpty(m)) return '';
  const lines = [];
  if (m.why) lines.push(`Why their goals matter to them: ${m.why}`);
  if (m.becoming) lines.push(`Who they are becoming: ${m.becoming}`);
  if (m.mentor.name) lines.push(`Someone they look up to: ${m.mentor.name}${m.mentor.routine ? `, whose routine is: ${m.mentor.routine}` : ''}`);
  if (m.playlists.length) lines.push(`Their saved music (they can ask you to play any of it by name): ${m.playlists.map((p, i) => `${p.label || 'Untitled'}${i === 0 ? ' (default)' : ''}`).join(', ')}`);
  if (m.quotes.length) lines.push(`Quotes they chose to be reminded of: ${m.quotes.slice(0, 5).map(q => `"${q.text}"${q.source ? ` (${q.source})` : ''}`).join('; ')}`);
  return lines.join('\n');
}

module.exports = { LIBRARY, SOURCES, MENTORS, clean, draftFromInterview, get, save, isEmpty, quoteOfTheDay, nudgeLine, forAssistant };
