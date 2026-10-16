const db = require('../db/db');

// A progress report for one project or goal: where it stands, whether it's
// on schedule, what each phase has done, what's coming and what's in the
// way. One standalone HTML page (inline styles, print-ready) serves the
// in-app preview, the PDF, printing and the public share link alike.

const DAY = 86400000;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const isoDay = d => d.toISOString().slice(0, 10);
const atNoon = iso => new Date(`${iso}T12:00:00Z`);
const longDate = iso => atNoon(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = iso => atNoon(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
// Progress weighs each task by its planned length, the same maths the app
// uses (frontend/js/progressMath.js), so a report never disagrees with it.
const ProgressMath = require('../../frontend/js/progressMath');

function scheduleFor(tasks, fallbackStart, today) {
  const ends = tasks.map(t => t.endDate).filter(Boolean).sort();
  const starts = tasks.map(t => t.startDate).filter(Boolean).sort();
  const start = starts[0] || fallbackStart || null;
  const end = ends[ends.length - 1] || null;
  if (!start || !end || end <= start) return { start, end, expected: null };
  return { start, end, expected: ProgressMath.expectedFraction(tasks, fallbackStart, atNoon(today).getTime()) };
}

function statusFor(pct, expected, done, total) {
  if (total && done === total) return { key: 'done', label: 'Complete' };
  if (expected === null) return { key: 'none', label: 'No schedule yet' };
  const gap = pct - Math.round(expected * 100);
  if (gap >= 5) return { key: 'ahead', label: 'Ahead of schedule', gap };
  if (gap >= -5) return { key: 'ontrack', label: 'On track', gap };
  if (gap >= -15) return { key: 'slightly', label: 'Slightly behind', gap };
  return { key: 'behind', label: 'Behind schedule', gap };
}

// Progress over time: where the plan actually stood on each day (tasks
// counted done from the day they were finished, weighted as everywhere
// else) against where its schedule said it should be. Up to ~40 points
// from the plan's start to its end (or today, if later); the actual line
// stops at today.
function historyFor(tasks, start, end, today) {
  if (!tasks.length || !start) return null;
  const last = [end, today].filter(Boolean).sort().pop();
  if (!last || last <= start) return null;
  const days = Math.round((atNoon(last) - atNoon(start)) / DAY);
  const step = Math.max(1, Math.ceil(days / 40));
  const dates = [];
  for (let i = 0; i <= days; i += step) dates.push(isoDay(new Date(atNoon(start).getTime() + i * DAY)));
  if (dates[dates.length - 1] !== last) dates.push(last);
  if (today > start && today < last && !dates.includes(today)) { dates.push(today); dates.sort(); }
  const doneBy = d => tasks.map(t => ({ ...t, status: t.status === 'Completed' && (t.completedAt || t.updatedAt || '').slice(0, 10) <= d ? 'Completed' : 'Not Started', targetCount: 0 }));
  return dates.map(d => ({
    date: d,
    actual: d > today ? null : d === today ? ProgressMath.progressPct(tasks) : ProgressMath.progressPct(doneBy(d)),
    // By the end of that day, the same as the actual line.
    planned: (() => { const f = ProgressMath.expectedFraction(tasks, start, atNoon(d).getTime() + DAY / 2); return f === null ? null : Math.round(f * 100); })(),
  }));
}

// Everything the report shows, from the point of view of `viewerId`.
function buildProgressReport(viewerId, projectId, now = new Date()) {
  const project = db.getProjectById(viewerId, projectId);
  if (!project) return null;
  const today = isoDay(now);
  const children = project.parentId ? [] : db.listProjects(viewerId, { parentId: project.id });
  const groups = [project, ...children];
  const ids = new Set(groups.map(p => p.id));
  const tasks = db.listTasks(viewerId).filter(t => ids.has(t.projectId));
  const done = tasks.filter(t => t.status === 'Completed');
  const pct = ProgressMath.progressPct(tasks);
  const sched = scheduleFor(tasks, project.startDate || (project.createdAt || '').slice(0, 10), today);
  const status = statusFor(pct, sched.expected, done.length, tasks.length);

  // Forecast: the pace of the last 14 days, carried forward.
  const recentCut = now.getTime() - 14 * DAY;
  const recent = done.filter(t => t.completedAt && Date.parse(t.completedAt) >= recentCut);
  const remaining = tasks.length - done.length;
  let forecast = null;
  if (remaining === 0 && tasks.length) forecast = { kind: 'done' };
  else if (recent.length) forecast = { kind: 'date', date: isoDay(new Date(now.getTime() + Math.ceil(remaining / (recent.length / 14)) * DAY)) };

  const overdue = tasks.filter(t => t.status !== 'Completed' && t.endDate && t.endDate < today).sort((a, b) => a.endDate.localeCompare(b.endDate));
  const soonCut = isoDay(new Date(now.getTime() + 14 * DAY));
  const upcoming = tasks.filter(t => t.status !== 'Completed' && t.endDate && t.endDate >= today && t.endDate <= soonCut).sort((a, b) => a.endDate.localeCompare(b.endDate));
  const blockers = tasks.filter(t => t.status !== 'Completed').flatMap(t => (t.obstacles || []).filter(o => !o.resolved).map(o => ({ ...o, taskTitle: t.title })));
  const cleared = tasks.flatMap(t => (t.obstacles || []).filter(o => o.resolved)).length;
  const waiting = tasks.filter(t => t.status !== 'Completed' && (t.predecessors || []).some(p => p.status !== 'Completed'))
    .map(t => ({ title: t.title, on: t.predecessors.filter(p => p.status !== 'Completed').map(p => p.title) }));

  const phases = groups.map(g => {
    const own = tasks.filter(t => t.projectId === g.id);
    if (!own.length && g.id === project.id) return null;
    const d = own.filter(t => t.status === 'Completed').length;
    const s = scheduleFor(own, null, today);
    const p = ProgressMath.progressPct(own);
    return { title: g.id === project.id ? 'General' : g.title, icon: g.icon || '📁', total: own.length, done: d, pct: p, start: s.start, end: s.end, status: statusFor(p, s.expected, d, own.length) };
  }).filter(Boolean);

  const summary = [];
  if (!tasks.length) summary.push('This plan has no tasks yet.');
  else {
    summary.push(`${project.title} is ${pct}% complete, with ${done.length} of ${tasks.length} tasks done.`);
    if (status.key === 'done') summary.push('Every task is finished.');
    else if (sched.expected !== null) summary.push(`By now the schedule expected about ${Math.round(sched.expected * 100)}%, so it is ${status.label.toLowerCase()}.`);
    if (recent.length) summary.push(`${recent.length} task${recent.length === 1 ? ' was' : 's were'} finished in the last two weeks.`);
    if (forecast && forecast.kind === 'date') summary.push(`At that pace it will finish around ${longDate(forecast.date)}${sched.end ? (forecast.date > sched.end ? `, after the planned ${longDate(sched.end)}` : `, before the planned ${longDate(sched.end)}`) : ''}.`);
    if (overdue.length) summary.push(`${overdue.length} task${overdue.length === 1 ? ' is' : 's are'} overdue.`);
    if (blockers.length) summary.push(`${blockers.length} blocker${blockers.length === 1 ? '' : 's'} still stand${blockers.length === 1 ? 's' : ''} in the way.`);
  }

  return {
    project: { id: project.id, title: project.title, icon: project.icon || '📁', description: project.description || '', ownerName: project.ownerName && project.ownerName !== 'Your Name' ? project.ownerName : '', isPhase: !!project.parentId },
    generatedAt: now.toISOString(), today, total: tasks.length, done: done.length, pct,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    schedule: { start: sched.start, end: sched.end, expectedPct: sched.expected === null ? null : Math.round(sched.expected * 100), daysLeft: sched.end ? Math.ceil((atNoon(sched.end) - atNoon(today)) / DAY) : null },
    status, forecast, phases, summary: summary.join(' '),
    history: historyFor(tasks, sched.start, sched.end, today),
    recent: recent.sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 8).map(t => ({ title: t.title, date: t.completedAt.slice(0, 10) })),
    upcoming: upcoming.slice(0, 8).map(t => ({ title: t.title, date: t.endDate, status: t.status })),
    overdue: overdue.slice(0, 8).map(t => ({ title: t.title, date: t.endDate })),
    blockers: blockers.slice(0, 10).map(o => ({ name: o.name, count: o.count, taskTitle: o.taskTitle })), blockersCleared: cleared,
    waiting: waiting.slice(0, 8),
    // Photos and files pinned to the report. A phase's report shows those
    // about its own tasks (or about no task in particular).
    media: (db.listReportMedia(viewerId, project.id) || [])
      .filter(m => !project.parentId || !m.taskId || tasks.some(t => t.id === m.taskId)),
  };
}

// Photos and files, as a gallery: images shown (when mediaSrc gives them
// a source), other files listed by name. Shared by the project and the
// portfolio report.
const MEDIA_KIND = { progress: ['Progress', '#0A7E8C'], blocker: ['Blocker', '#B03020'], info: ['Info', '#6B7280'] };
const { icon, emojiIcon } = require('../../frontend/js/icons.js');

const MEDIA_CSS = `.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
  .media figure{margin:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;background:#fff;break-inside:avoid}
  .media img{display:block;width:100%;height:170px;object-fit:cover;background:#F3F4F6}
  .media figcaption{padding:10px 12px;font-size:13px;line-height:1.45}
  .media .kind{display:inline-block;font-size:11px;font-weight:800;color:#fff;border-radius:999px;padding:1px 8px;margin-right:6px}
  .media .sub{display:block;color:#6B7280;font-size:12px;margin-top:2px}
  .files li a{color:#0A7E8C;text-decoration:none;font-weight:700}`;
function renderMediaSection(media, mediaSrc, { showProject = false } = {}) {
  if (!media || !media.length) return '';
  const label = m => { const [k, c] = MEDIA_KIND[m.kind] || MEDIA_KIND.info; return `<span class="kind" style="background:${c}">${k}</span>`; };
  const sub = m => [showProject && m.projectTitle, m.taskTitle && `Task: ${m.taskTitle}`, m.addedByName, shortDate(m.createdAt.slice(0, 10))].filter(Boolean).map(esc).join(' · ');
  const images = [], files = [];
  media.forEach(m => {
    const src = mediaSrc ? mediaSrc(m) : null;
    if (src && /^image\//.test(m.mimetype)) images.push(`<figure><img src="${esc(src)}" alt="${esc(m.caption || m.originalName)}" loading="lazy"><figcaption>${label(m)}${esc(m.caption || m.originalName)}<span class="sub">${sub(m)}</span></figcaption></figure>`);
    else files.push(`<li><span>${label(m)}${icon('paperclip')}${src ? `<a href="${esc(src)}" target="_blank" rel="noopener">${esc(m.originalName)}</a>` : esc(m.originalName)}${m.caption ? ` · ${esc(m.caption)}` : ''}</span><em>${sub(m)}</em></li>`);
  });
  return `<section><h2>Photos and files</h2>${images.length ? `<div class="media">${images.join('')}</div>` : ''}${files.length ? `<ul class="files" style="margin-top:${images.length ? 14 : 0}px">${files.join('')}</ul>` : ''}</section>`;
}

const STATUS_COLOURS = { done: '#1A7A4A', ahead: '#0A7E8C', ontrack: '#1A7A4A', slightly: '#C0642A', behind: '#B03020', none: '#6B7280' };

function renderProgressReportHtml(r, { live = false, appUrl = '', mediaSrc = null } = {}) {
  const colour = STATUS_COLOURS[r.status.key];
  const ring = (() => {
    const c = 2 * Math.PI * 52;
    return `<svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${r.pct}% complete"><circle cx="60" cy="60" r="52" fill="none" stroke="#E5E7EB" stroke-width="12"/><circle cx="60" cy="60" r="52" fill="none" stroke="${colour}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * r.pct / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/><text x="60" y="68" text-anchor="middle" font-size="26" font-weight="800" fill="#0D1B2A">${r.pct}%</text></svg>`;
  })();
  const tile = (n, label) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`;
  const list = (items, empty, fn) => items.length ? `<ul>${items.map(fn).join('')}</ul>` : `<p class="empty">${empty}</p>`;

  // Timeline: each phase as a bar across the plan's dates, with today marked.
  let timeline = '';
  const { start, end } = r.schedule;
  if (start && end && end > start) {
    const span = atNoon(end) - atNoon(start);
    const at = iso => Math.max(0, Math.min(100, ((atNoon(iso) - atNoon(start)) / span) * 100));
    const todayAt = at(r.today);
    timeline = `<section><h2>Timeline</h2><div class="timeline"><div class="tl-scale"><span>${shortDate(start)}</span><span>${shortDate(end)}</span></div>
      ${r.phases.filter(p => p.start && p.end).map(p => `<div class="tl-row"><span class="tl-name">${emojiIcon(p.icon)} ${esc(p.title)}</span><div class="tl-track"><div class="tl-bar" style="left:${at(p.start)}%;width:${Math.max(1.5, at(p.end) - at(p.start))}%"><i style="width:${p.pct}%"></i></div></div></div>`).join('')}
      <div class="tl-today" style="left:calc(160px + (100% - 160px) * ${todayAt / 100})"><span>Today</span></div></div></section>`;
  }

  // Progress over time: actual (solid blue) against the schedule (dashed
  // orange), 0–100%, with a hover readout. Blue/orange is a validated,
  // colour-blind-safe pair; the dash and the direct labels mean colour is
  // never the only cue, and the same numbers are in a table underneath.
  let history = '';
  const H = r.history;
  if (H && H.length > 1) {
    const W = 800, Hh = 240, m = { l: 40, r: 70, t: 14, b: 28 };
    const t0 = atNoon(H[0].date).getTime(), t1 = atNoon(H[H.length - 1].date).getTime();
    const x = d => m.l + ((atNoon(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r);
    const y = v => Hh - m.b - (v / 100) * (Hh - m.t - m.b);
    const line = key => H.filter(p => p[key] !== null).map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    const lastOf = key => [...H].reverse().find(p => p[key] !== null);
    const la = lastOf('actual'), lp = lastOf('planned');
    let ya = la ? y(la.actual) : 0, yp = lp ? y(lp.planned) : 0;
    if (la && lp && Math.abs(ya - yp) < 14) { if (ya <= yp) { ya -= 7; yp += 7; } else { ya += 7; yp -= 7; } }
    const grid = [0, 25, 50, 75, 100].map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#EEF0F3"/><text x="${m.l - 8}" y="${y(v) + 4}" font-size="11" fill="#8A93A0" text-anchor="end">${v}%</text>`).join('');
    const ticks = [0, Math.floor((H.length - 1) / 2), H.length - 1].map((i, k) => `<text x="${x(H[i].date)}" y="${Hh - 8}" font-size="11" fill="#8A93A0" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${esc(shortDate(H[i].date))}</text>`).join('');
    const todayX = r.today > H[0].date && r.today < H[H.length - 1].date ? x(r.today) : null;
    const data = esc(JSON.stringify(H.map(p => [x(p.date), shortDate(p.date), p.actual, p.planned])));
    history = `<section><h2>Progress over time</h2>
<div class="hist-legend"><span><i class="a"></i>Actual</span><span><i class="p"></i>Planned</span></div>
<div class="hist" data-points="${data}" data-w="${W}"><svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="${esc(`Progress over time: ${la ? la.actual : 0}% done by ${shortDate(la ? la.date : r.today)}, against ${lp ? lp.planned : 0}% planned by ${shortDate(lp ? lp.date : r.today)}.`)}">
${grid}${ticks}
${todayX !== null ? `<line x1="${todayX}" x2="${todayX}" y1="${m.t}" y2="${Hh - m.b}" stroke="#CBD2DA" stroke-dasharray="2 3"/><text x="${todayX + 4}" y="${m.t + 8}" font-size="11" fill="#8A93A0">Today</text>` : ''}
${lp ? `<path d="${line('planned')}" fill="none" stroke="#eb6834" stroke-width="2" stroke-dasharray="6 4"/>` : ''}
${la ? `<path d="${line('actual')}" fill="none" stroke="#2a78d6" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${x(la.date)}" cy="${y(la.actual)}" r="4.5" fill="#2a78d6" stroke="#fff" stroke-width="2"/>` : ''}
${la ? `<text x="${x(la.date) + 8}" y="${ya + 4}" font-size="12" font-weight="800" fill="#374151">${la.actual}% actual</text>` : ''}
${lp ? `<text x="${x(lp.date) + 8}" y="${yp + 4}" font-size="12" font-weight="800" fill="#374151">${lp.planned}% plan</text>` : ''}
<line class="hist-x" x1="-10" x2="-10" y1="${m.t}" y2="${Hh - m.b}" stroke="#9CA3AF"/>
</svg><div class="hist-tip" hidden></div></div>
<details class="hist-table"><summary>Show as a table</summary><table><thead><tr><th>Date</th><th>Actual</th><th>Planned</th></tr></thead><tbody>${H.map(p => `<tr><td>${esc(shortDate(p.date))}</td><td>${p.actual === null ? '—' : `${p.actual}%`}</td><td>${p.planned === null ? '—' : `${p.planned}%`}</td></tr>`).join('')}</tbody></table></details>
<script>(function(){var box=document.currentScript.previousElementSibling.previousElementSibling;var pts=JSON.parse(box.dataset.points),W=+box.dataset.w,svg=box.querySelector('svg'),tip=box.querySelector('.hist-tip'),ln=box.querySelector('.hist-x');
function mv(e){var r=svg.getBoundingClientRect(),cx=(e.touches?e.touches[0].clientX:e.clientX)-r.left,vx=cx*W/r.width,b=pts[0];pts.forEach(function(p){if(Math.abs(p[0]-vx)<Math.abs(b[0]-vx))b=p});ln.setAttribute('x1',b[0]);ln.setAttribute('x2',b[0]);tip.hidden=false;tip.innerHTML='<b>'+b[1]+'</b><span>Actual '+(b[2]===null?'—':b[2]+'%')+'</span><span>Planned '+(b[3]===null?'—':b[3]+'%')+'</span>';tip.style.left=Math.min(b[0]*r.width/W+10,r.width-130)+'px'}
function lv(){tip.hidden=true;ln.setAttribute('x1',-10);ln.setAttribute('x2',-10)}
svg.addEventListener('pointermove',mv);svg.addEventListener('pointerleave',lv);svg.addEventListener('touchmove',mv,{passive:true});svg.addEventListener('touchend',lv)})();</script></section>`;
  }

  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(r.project.title)} · Progress report</title>
<style>
.ic{width:1em;height:1em;display:inline-block;vertical-align:-.14em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-right:.2em}
  *{box-sizing:border-box} body{margin:0;background:#F3F4F6;font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1F2937;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:880px;margin:24px auto;background:#fff;border-radius:20px;box-shadow:0 10px 40px rgba(13,27,42,.08);overflow:hidden}
  header{background:linear-gradient(135deg,#0D1B2A,#0A7E8C);color:#fff;padding:28px 36px}
  .brand{font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.75}
  h1{margin:10px 0 4px;font-size:30px;line-height:1.15;font-weight:900}
  .meta{font-size:13px;opacity:.8}
  .pill{display:inline-block;margin-top:14px;padding:6px 14px;border-radius:999px;font-size:13px;font-weight:800;background:#fff;color:${colour}}
  main{padding:28px 36px 36px}
  .hero{display:flex;gap:28px;align-items:center;flex-wrap:wrap}
  .tiles{flex:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
  .tile{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:14px;padding:14px 16px}.tile b{display:block;font-size:26px;font-weight:900;color:#0D1B2A}.tile span{font-size:12px;color:#6B7280;font-weight:600}
  .summary{margin:22px 0 4px;padding:16px 18px;border-left:4px solid ${colour};background:#F9FAFB;border-radius:0 12px 12px 0;line-height:1.6;font-size:15px}
  section{margin-top:28px} h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#0A7E8C;margin:0 0 12px;font-weight:800}
  table{width:100%;border-collapse:collapse;font-size:14px} th{text-align:left;font-size:12px;color:#6B7280;font-weight:700;padding:8px 6px;border-bottom:1px solid #E5E7EB} td{padding:10px 6px;border-bottom:1px solid #F3F4F6;vertical-align:middle}
  .bar{height:8px;background:#E5E7EB;border-radius:8px;overflow:hidden;min-width:90px}.bar i{display:block;height:100%;background:#0A7E8C;border-radius:8px}
  .st{font-size:12px;font-weight:700;white-space:nowrap}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px} @media (max-width:640px){.grid2{grid-template-columns:1fr} header,main{padding-left:20px;padding-right:20px} .page{margin:0;border-radius:0}}
  ul{list-style:none;margin:0;padding:0} li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #F3F4F6;font-size:14px} li span{min-width:0} li em{font-style:normal;color:#6B7280;white-space:nowrap;font-size:13px}
  .empty{color:#9CA3AF;font-size:14px;margin:0}
  .timeline{position:relative;padding-top:4px}.tl-scale{display:flex;justify-content:space-between;margin-left:160px;font-size:12px;color:#6B7280;margin-bottom:6px}
  .tl-row{display:flex;align-items:center;gap:0;margin:6px 0}.tl-name{width:160px;flex-shrink:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:10px}
  .tl-track{position:relative;flex:1;height:18px;background:#F3F4F6;border-radius:6px}.tl-bar{position:absolute;top:0;bottom:0;background:#CDEDEF;border-radius:6px;overflow:hidden}.tl-bar i{display:block;height:100%;background:#0A7E8C}
  .tl-today{position:absolute;top:18px;bottom:0;border-left:2px dashed #B03020}.tl-today span{position:absolute;top:-18px;left:4px;font-size:11px;font-weight:700;color:#B03020}
  .hist{position:relative}.hist svg{display:block;touch-action:pan-y}.hist-legend{display:flex;gap:16px;font-size:12px;font-weight:700;color:#374151;margin:-4px 0 6px}.hist-legend i{display:inline-block;width:18px;border-top:2.5px solid #2a78d6;vertical-align:middle;margin-right:6px}.hist-legend i.p{border-top:2px dashed #eb6834}
  .hist-tip[hidden]{display:none}.hist-tip{position:absolute;top:8px;min-width:120px;background:#0D1B2A;color:#fff;border-radius:10px;padding:7px 10px;font-size:12px;display:flex;flex-direction:column;gap:2px;pointer-events:none}
  .hist-table{margin-top:8px;font-size:13px}.hist-table summary{cursor:pointer;color:#0A7E8C;font-weight:700;font-size:12px}.hist-table table{margin-top:8px}
  @media print{.hist-table,.hist-tip{display:none}}
  footer{padding:16px 36px;border-top:1px solid #F3F4F6;font-size:12px;color:#9CA3AF;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  footer a{color:#0A7E8C;text-decoration:none;font-weight:700}
  ${MEDIA_CSS}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0} section{break-inside:avoid}}
</style></head><body><div class="page">
<header><div class="brand">Wayrise · Progress report</div><h1>${emojiIcon(r.project.icon)} ${esc(r.project.title)}</h1>
<div class="meta">${r.project.ownerName ? `Owner: ${esc(r.project.ownerName)} · ` : ''}${live ? 'Live report, updated' : 'Generated'} ${esc(longDate(r.today))}${r.schedule.start && r.schedule.end ? ` · Plan: ${esc(shortDate(r.schedule.start))} – ${esc(longDate(r.schedule.end))}` : ''}</div>
<span class="pill">${esc(r.status.label)}${r.status.gap !== undefined && r.status.key !== 'ontrack' ? ` (${r.status.gap > 0 ? '+' : ''}${r.status.gap} pts)` : ''}</span></header>
<main>
<div class="hero">${ring}<div class="tiles">${tile(`${r.done}/${r.total}`, 'tasks done')}${tile(r.inProgress, 'in progress')}${tile(r.overdue.length, 'overdue')}${tile(r.schedule.daysLeft === null ? '—' : r.schedule.daysLeft < 0 ? `${-r.schedule.daysLeft} late` : r.schedule.daysLeft, r.schedule.daysLeft !== null && r.schedule.daysLeft < 0 ? 'days past plan' : 'days left')}${tile(r.forecast ? (r.forecast.kind === 'done' ? 'Done' : esc(shortDate(r.forecast.date))) : '—', 'forecast finish')}</div></div>
${r.project.description ? `<p class="meta" style="color:#6B7280;margin-top:16px">${esc(r.project.description)}</p>` : ''}
<p class="summary">${esc(r.summary)}</p>
${r.phases.length ? `<section><h2>Phases</h2><table><thead><tr><th>Phase</th><th>Done</th><th style="width:30%">Progress</th><th>Dates</th><th>Status</th></tr></thead><tbody>
${r.phases.map(p => `<tr><td><b>${emojiIcon(p.icon)} ${esc(p.title)}</b></td><td>${p.done}/${p.total}</td><td><div class="bar"><i style="width:${p.pct}%"></i></div></td><td style="white-space:nowrap;color:#6B7280">${p.start && p.end ? `${esc(shortDate(p.start))} – ${esc(shortDate(p.end))}` : '—'}</td><td class="st" style="color:${STATUS_COLOURS[p.status.key]}">${esc(p.status.label)}</td></tr>`).join('')}
</tbody></table></section>` : ''}
${history}
${timeline}
<div class="grid2">
<section><h2>Recently completed</h2>${list(r.recent, 'Nothing finished in the last two weeks.', t => `<li><span>${icon('done')}${esc(t.title)}</span><em>${esc(shortDate(t.date))}</em></li>`)}</section>
<section><h2>Coming up (next 2 weeks)</h2>${list(r.upcoming, 'Nothing due in the next two weeks.', t => `<li><span>${icon(t.status === 'In Progress' ? 'circle-dot' : 'circle')}${esc(t.title)}</span><em>${esc(shortDate(t.date))}</em></li>`)}</section>
<section><h2>Overdue</h2>${list(r.overdue, 'Nothing overdue.', t => `<li><span>${icon('overdue')}${esc(t.title)}</span><em>due ${esc(shortDate(t.date))}</em></li>`)}</section>
<section><h2>Blockers (${r.blockers.length} open, ${r.blockersCleared} cleared)</h2>${list(r.blockers, 'Nothing in the way.', o => `<li><span>${icon('blocker')}${esc(o.name)}${o.count > 1 ? ` ×${o.count}` : ''}</span><em>${esc(o.taskTitle)}</em></li>`)}</section>
</div>
${r.waiting.length ? `<section><h2>Waiting on other tasks</h2><ul>${r.waiting.map(w => `<li><span>${icon('link')}${esc(w.title)}</span><em>after ${esc(w.on.join(', '))}</em></li>`).join('')}</ul></section>` : ''}
${renderMediaSection(r.media, mediaSrc)}
</main>
<footer><span>${live ? 'This page updates itself whenever the plan changes.' : `Generated ${esc(new Date(r.generatedAt).toUTCString())}`}</span><span>Made with ${appUrl ? `<a href="${esc(appUrl)}">Wayrise</a>` : 'Wayrise'}</span></footer>
</div></body></html>`;
}

module.exports = { buildProgressReport, renderProgressReportHtml, renderMediaSection, MEDIA_CSS, STATUS_COLOURS, esc, shortDate, longDate };
