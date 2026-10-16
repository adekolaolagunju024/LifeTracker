const db = require('../db/db');
const ProgressMath = require('../../frontend/js/progressMath');
const { icon, emojiIcon } = require('../../frontend/js/icons.js');
const { buildProgressReport, renderMediaSection, MEDIA_CSS, STATUS_COLOURS, esc, shortDate, longDate } = require('./progress');

// A portfolio report for a board or team meeting: every project the viewer
// can see (or the ones they pick) on one page. Where things stand overall,
// project by project, what needs a decision, what's coming up, recent wins
// and the photos and files people pinned. Built from each project's own
// progress report, so the two never disagree.

const STATUS_ORDER = ['behind', 'slightly', 'ontrack', 'ahead', 'none', 'done'];

function buildPortfolioReport(viewerId, projectIds = null, now = new Date()) {
  const all = db.listProjects(viewerId, { parentId: 'null' });
  const chosen = projectIds && projectIds.length ? all.filter(p => projectIds.includes(p.id)) : all;
  const reports = chosen.map(p => buildProgressReport(viewerId, p.id, now)).filter(Boolean);
  const ids = new Set(reports.map(r => r.project.id));
  const tree = new Set(db.listProjects(viewerId).filter(p => ids.has(p.id) || ids.has(p.parentId)).map(p => p.id));
  const tasks = db.listTasks(viewerId).filter(t => tree.has(t.projectId));
  const counts = Object.fromEntries(STATUS_ORDER.map(k => [k, 0]));
  reports.forEach(r => { counts[r.status.key] = (counts[r.status.key] || 0) + 1; });

  const projects = reports
    .map(r => ({
      id: r.project.id, title: r.project.title, icon: r.project.icon, ownerName: r.project.ownerName,
      pct: r.pct, done: r.done, total: r.total, status: r.status, end: r.schedule.end, forecast: r.forecast,
      overdue: r.overdue.length, blockers: r.blockers.length, summary: r.summary,
    }))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status.key) - STATUS_ORDER.indexOf(b.status.key) || a.title.localeCompare(b.title));

  // Needs a decision: projects behind, with overdue work, or blocked.
  const attention = reports
    .filter(r => ['behind', 'slightly'].includes(r.status.key) || r.overdue.length || r.blockers.length)
    .map(r => ({
      title: r.project.title, icon: r.project.icon, status: r.status,
      reasons: [
        ['behind', 'slightly'].includes(r.status.key) ? r.status.label.toLowerCase() : '',
        r.overdue.length ? `${r.overdue.length} overdue` : '',
        r.blockers.length ? `${r.blockers.length} blocker${r.blockers.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean),
      blockers: r.blockers.slice(0, 4), overdueItems: r.overdue.slice(0, 3),
    }));
  const withProject = (r, items) => items.map(i => ({ ...i, projectTitle: r.project.title }));
  const upcoming = reports.flatMap(r => withProject(r, r.upcoming)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  const recent = reports.flatMap(r => withProject(r, r.recent)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const media = reports.flatMap(r => withProject(r, r.media || [])).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);

  return {
    generatedAt: now.toISOString(), today: now.toISOString().slice(0, 10),
    projectCount: reports.length, selected: !!(projectIds && projectIds.length),
    pct: ProgressMath.progressPct(tasks), total: tasks.length, done: tasks.filter(t => t.status === 'Completed').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    overdue: reports.reduce((n, r) => n + r.overdue.length, 0),
    blockers: reports.reduce((n, r) => n + r.blockers.length, 0),
    counts, projects, attention, upcoming, recent, media,
  };
}

const STATUS_SHORT = { behind: 'Behind', slightly: 'Slightly behind', ontrack: 'On track', ahead: 'Ahead', none: 'No schedule', done: 'Complete' };

function renderPortfolioHtml(r, { appUrl = '', mediaSrc = null, title = '' } = {}) {
  const heading = title || (r.selected ? 'Selected projects' : 'All projects');
  const tile = (n, label) => `<div class="tile"><b>${n}</b><span>${label}</span></div>`;
  const list = (items, empty, fn) => items.length ? `<ul>${items.map(fn).join('')}</ul>` : `<p class="empty">${empty}</p>`;
  // Status mix: one stacked bar, each status a labelled segment.
  const mix = STATUS_ORDER.filter(k => r.counts[k]).map(k => `<span class="seg" style="flex:${r.counts[k]};background:${STATUS_COLOURS[k]}" title="${STATUS_SHORT[k]}: ${r.counts[k]}"></span>`).join('');
  const legend = STATUS_ORDER.filter(k => r.counts[k]).map(k => `<span><i style="background:${STATUS_COLOURS[k]}"></i>${STATUS_SHORT[k]} <b>${r.counts[k]}</b></span>`).join('');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(heading)} · Portfolio report</title>
<style>
.ic{width:1em;height:1em;display:inline-block;vertical-align:-.14em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-right:.2em}
  *{box-sizing:border-box} body{margin:0;background:#F3F4F6;font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1F2937;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:960px;margin:24px auto;background:#fff;border-radius:20px;box-shadow:0 10px 40px rgba(13,27,42,.08);overflow:hidden}
  header{background:linear-gradient(135deg,#0D1B2A,#0A7E8C);color:#fff;padding:28px 36px}
  .brand{font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.75}
  h1{margin:10px 0 4px;font-size:30px;line-height:1.15;font-weight:900} .meta{font-size:13px;opacity:.85}
  main{padding:28px 36px 36px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px}
  .tile{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:14px;padding:14px 16px}.tile b{display:block;font-size:26px;font-weight:900;color:#0D1B2A}.tile span{font-size:12px;color:#6B7280;font-weight:600}
  .mix{display:flex;gap:2px;height:14px;border-radius:7px;overflow:hidden;margin:20px 0 8px}.mix .seg{display:block}
  .legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:#374151}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
  section{margin-top:28px} h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#0A7E8C;margin:0 0 12px;font-weight:800}
  table{width:100%;border-collapse:collapse;font-size:14px} th{text-align:left;font-size:12px;color:#6B7280;font-weight:700;padding:8px 6px;border-bottom:1px solid #E5E7EB} td{padding:10px 6px;border-bottom:1px solid #F3F4F6;vertical-align:middle}
  .bar{height:8px;background:#E5E7EB;border-radius:8px;overflow:hidden;min-width:80px}.bar i{display:block;height:100%;background:#0A7E8C;border-radius:8px}
  .st{font-size:12px;font-weight:800;white-space:nowrap}
  .card{border:1px solid #F3D1CC;background:#FFF8F7;border-radius:14px;padding:14px 16px;margin-bottom:10px;break-inside:avoid}
  .card b{color:#0D1B2A} .card .why{color:#B03020;font-weight:700;font-size:13px} .card ul{margin-top:6px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px} @media (max-width:700px){.grid2{grid-template-columns:1fr} header,main{padding-left:20px;padding-right:20px} .page{margin:0;border-radius:0} .wide{display:none}}
  ul{list-style:none;margin:0;padding:0} li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #F3F4F6;font-size:14px} li span{min-width:0} li em{font-style:normal;color:#6B7280;white-space:nowrap;font-size:13px}
  .empty{color:#9CA3AF;font-size:14px;margin:0}
  footer{padding:16px 36px;border-top:1px solid #F3F4F6;font-size:12px;color:#9CA3AF;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap} footer a{color:#0A7E8C;text-decoration:none;font-weight:700}
  ${MEDIA_CSS}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0} section,tr{break-inside:avoid}}
</style></head><body><div class="page">
<header><div class="brand">KolaWay · Portfolio report</div><h1>${esc(heading)}</h1>
<div class="meta">${r.projectCount} project${r.projectCount === 1 ? '' : 's'} · Generated ${esc(longDate(r.today))}</div></header>
<main>
<div class="tiles">${tile(`${r.pct}%`, 'overall complete')}${tile(`${r.done}/${r.total}`, 'tasks done')}${tile(r.inProgress, 'in progress')}${tile(r.counts.behind + r.counts.slightly, 'projects behind')}${tile(r.overdue, 'tasks overdue')}${tile(r.blockers, 'open blockers')}</div>
${mix ? `<div class="mix" role="img" aria-label="Project status mix">${mix}</div><div class="legend">${legend}</div>` : ''}
<section><h2>Projects</h2>${r.projects.length ? `<table><thead><tr><th>Project</th><th style="width:22%">Progress</th><th>Status</th><th class="wide">Plan end</th><th class="wide">Forecast</th><th>Overdue</th><th>Blockers</th></tr></thead><tbody>
${r.projects.map(p => `<tr><td><b>${emojiIcon(p.icon)} ${esc(p.title)}</b>${p.ownerName ? `<div style="font-size:12px;color:#6B7280">${esc(p.ownerName)}</div>` : ''}</td>
<td><div style="display:flex;align-items:center;gap:8px"><div class="bar" style="flex:1"><i style="width:${p.pct}%"></i></div><b style="font-size:13px">${p.pct}%</b></div><div style="font-size:12px;color:#6B7280">${p.done}/${p.total} tasks</div></td>
<td class="st" style="color:${STATUS_COLOURS[p.status.key]}">${esc(p.status.label)}</td>
<td class="wide" style="white-space:nowrap;color:#6B7280">${p.end ? esc(shortDate(p.end)) : '—'}</td>
<td class="wide" style="white-space:nowrap;color:#6B7280">${p.forecast ? (p.forecast.kind === 'done' ? 'Done' : esc(shortDate(p.forecast.date))) : '—'}</td>
<td style="font-weight:700;color:${p.overdue ? '#B03020' : '#6B7280'}">${p.overdue}</td><td style="font-weight:700;color:${p.blockers ? '#B03020' : '#6B7280'}">${p.blockers}</td></tr>`).join('')}
</tbody></table>` : '<p class="empty">No projects to report on yet.</p>'}</section>
<section><h2>Needs a decision</h2>${r.attention.length ? r.attention.map(a => `<div class="card"><b>${emojiIcon(a.icon)} ${esc(a.title)}</b> <span class="why">· ${esc(a.reasons.join(' · '))}</span>
${a.blockers.length || a.overdueItems.length ? `<ul>${a.blockers.map(o => `<li><span>${icon('blocker')}${esc(o.name)}</span><em>${esc(o.taskTitle)}</em></li>`).join('')}${a.overdueItems.map(t => `<li><span>${icon('overdue')}${esc(t.title)}</span><em>due ${esc(shortDate(t.date))}</em></li>`).join('')}</ul>` : ''}</div>`).join('') : '<p class="empty">Nothing needs a decision: every project is on track and unblocked. 🎉</p>'}</section>
<div class="grid2">
<section><h2>Coming up (next 2 weeks)</h2>${list(r.upcoming, 'Nothing due in the next two weeks.', t => `<li><span>${icon(t.status === 'In Progress' ? 'circle-dot' : 'circle')}${esc(t.title)}<br><small style="color:#6B7280">${esc(t.projectTitle)}</small></span><em>${esc(shortDate(t.date))}</em></li>`)}</section>
<section><h2>Recent wins</h2>${list(r.recent, 'Nothing finished in the last two weeks.', t => `<li><span>${icon('done')}${esc(t.title)}<br><small style="color:#6B7280">${esc(t.projectTitle)}</small></span><em>${esc(shortDate(t.date))}</em></li>`)}</section>
</div>
${renderMediaSection(r.media, mediaSrc, { showProject: true })}
</main>
<footer><span>Generated ${esc(new Date(r.generatedAt).toUTCString())}</span><span>Made with ${appUrl ? `<a href="${esc(appUrl)}">KolaWay</a>` : 'KolaWay'}</span></footer>
</div></body></html>`;
}

module.exports = { buildPortfolioReport, renderPortfolioHtml };
