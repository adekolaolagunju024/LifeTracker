const express = require('express');
const db = require('../db/db');

// A live calendar feed of your tasks, to subscribe to from Google Calendar,
// Outlook or Apple Calendar ("add calendar from URL"). Each task with a due
// date is an all-day event on that day. The link carries a private token
// instead of a sign-in (calendar apps can't sign in), so it can be reset
// from Settings if it's ever shared by mistake.
const APP_URL = () => process.env.APP_URL || '';

// RFC 5545 text: escape \ ; , and newlines, and fold lines at 75 octets.
const icsText = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = [];
  let rest = Buffer.from(line, 'utf8');
  while (rest.length > 75) {
    let cut = 75;
    while (cut > 0 && (rest[cut] & 0xC0) === 0x80) cut--; // don't split a UTF-8 character
    out.push(rest.subarray(0, cut).toString('utf8'));
    rest = Buffer.concat([Buffer.from(' '), rest.subarray(cut)]);
  }
  out.push(rest.toString('utf8'));
  return out.join('\r\n');
}
const ymd = iso => iso.slice(0, 10).replace(/-/g, '');
const nextDay = iso => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function buildCalendar(userId, baseUrl) {
  const projects = new Map(db.listProjects(userId).map(p => [p.id, p]));
  const tasks = db.listTasks(userId).filter(t => /^\d{4}-\d{2}-\d{2}/.test(t.endDate || ''));
  const now = stamp();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KolaWay//Tasks//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:KolaWay tasks', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const t of tasks) {
    const project = projects.get(t.projectId);
    const parent = project && project.parentId ? projects.get(project.parentId) : null;
    const where = [parent && parent.title, project && project.title].filter(Boolean).join(' › ');
    const done = t.status === 'Completed';
    const details = [`${where}`, `Status: ${t.status}`, `Priority: ${t.priority}`, t.notes ? `\n${t.notes}` : '', baseUrl ? `\nOpen in KolaWay: ${baseUrl}/app` : ''].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${t.id}@kolaway`, `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${ymd(t.endDate)}`, `DTEND;VALUE=DATE:${ymd(nextDay(t.endDate))}`,
      fold(`SUMMARY:${icsText(`${done ? '✓ ' : ''}${t.title}`)}`),
      fold(`DESCRIPTION:${icsText(details)}`),
      `STATUS:${done ? 'CONFIRMED' : 'TENTATIVE'}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// Public: GET /calendar/<token>.ics
const publicRouter = express.Router();
publicRouter.get('/:token.ics', (req, res) => {
  const userId = db.getUserIdByCalendarFeedToken(req.params.token);
  if (!userId) return res.status(404).type('text/plain').send('This calendar link has been reset or does not exist.');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.send(buildCalendar(userId, APP_URL() || `${req.protocol}://${req.get('host')}`));
});

// Signed in: GET /api/calendar/feed, POST /api/calendar/feed/reset
const apiRouter = express.Router();
const feedUrl = (req, token) => `${APP_URL() || `${req.protocol}://${req.get('host')}`}/calendar/${token}.ics`;
apiRouter.get('/feed', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: feedUrl(req, db.getCalendarFeedToken(req.session.userId)) });
});
apiRouter.post('/feed/reset', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: feedUrl(req, db.getCalendarFeedToken(req.session.userId, { reset: true })) });
});

module.exports = { publicRouter, apiRouter, buildCalendar };
