// ── QUICK TASKS ─────────────────────────────────────────────────
// Something that comes up in the day and isn't a goal ("meet Tom at the
// train station 11am"). It goes in the person's Everyday list (a project
// of kind 'everyday', kept out of goals, the Journey and teams), and when
// it has a time it's pinned at that time in the day's plan, so Start my
// day fits everything else around it.
//
// parse() reads the day and time out of the words and leaves the rest as
// the title. Dates are the person's own (the app sends its local "today").

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_RE = new RegExp(`\\b(?:on\\s+)?(today|tonight|tomorrow|tmrw|${WEEKDAYS.join('|')}|${WEEKDAYS.map(d => d.slice(0, 3)).join('|')})\\b`, 'i');
const PART_RE = /\b(?:this\s+)?(morning|afternoon|evening)\b/i;
const TIME_12 = /\b(?:at|by|for|@)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i;
const TIME_24 = /\b(?:at|by|for|@)?\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/;
const NOON_RE = /\b(?:at|by|for)?\s*(noon|midday|midnight)\b/i;

const pad = n => String(n).padStart(2, '0');
function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const weekdayOf = key => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const partOfTime = time => { const h = Number(time.slice(0, 2)); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };

function parse(text, { today }) {
  let rest = ` ${String(text || '').replace(/\s+/g, ' ').trim()} `;
  let date = today, time = null, dayPart = null;
  const cut = m => { rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length); };

  let m = rest.match(TIME_12);
  if (m) {
    let h = Number(m[1]) % 12;
    if (/^p/i.test(m[3])) h += 12;
    const min = Number(m[2] || 0);
    if (Number(m[1]) >= 1 && Number(m[1]) <= 12 && min < 60) { time = `${pad(h)}:${pad(min)}`; cut(m); }
  }
  if (!time && (m = rest.match(NOON_RE))) { time = m[1].toLowerCase() === 'midnight' ? '00:00' : '12:00'; cut(m); }
  if (!time && (m = rest.match(TIME_24))) { time = `${pad(Number(m[1]))}:${m[2]}`; cut(m); }

  if ((m = rest.match(DAY_RE))) {
    const w = m[1].toLowerCase();
    if (w === 'tomorrow' || w === 'tmrw') date = addDays(today, 1);
    else if (w === 'tonight') { dayPart = 'evening'; }
    else if (w !== 'today') {
      const target = WEEKDAYS.findIndex(d => d.startsWith(w.slice(0, 3)));
      date = addDays(today, (target - weekdayOf(today) + 7) % 7); // today counts as the coming one
    }
    cut(m);
  }
  if ((m = rest.match(PART_RE))) { dayPart = dayPart || m[1].toLowerCase(); cut(m); }
  if (time) dayPart = partOfTime(time);

  let title = rest.replace(/\s+([,.;!?])/g, '$1').replace(/\s+/g, ' ').trim()
    .replace(/^(?:at|by|on|for|-|,)\s+/i, '').replace(/\s+(?:at|by|on|for|-|,)$/i, '').trim();
  if (title) title = title[0].toUpperCase() + title.slice(1);
  return { title: title.slice(0, 200), date, time, dayPart, fixed: !!time };
}

// When a reminder X minutes before a local date and time falls, as an ISO
// moment. tzOffset is the app's Date#getTimezoneOffset() (minutes behind UTC).
function reminderAt(date, time, before, tzOffset) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) + (Number(tzOffset) || 0) * 60000 - before * 60000).toISOString();
}

module.exports = { parse, reminderAt, addDays };
