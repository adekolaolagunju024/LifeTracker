// Waypoint app, part 4 of 12: The Planner: Gantt chart, Kanban board, dependency arrows, drag to move.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── GANTT ───────────────────────────────────────────────────────
let ganttCollapsed = new Set();
let ganttGroupIds = []; // every group id currently rendered — kept up to date by renderGantt(), used by Collapse All
// Start/Due are 100px, not 85px, so a native date input can show the full
// "DD/MM/YYYY" — at 85px the year got clipped to 2 digits (e.g. "16/08/20"
// instead of "16/08/2026") by the column's overflow-hidden.
// The 5 frozen columns are actual CSS variables (see #page-gantt in the
// stylesheet), not hardcoded pixels — this constant stays fixed, dragging
// a column only ever changes the variables' values, so every row that was
// already rendered picks up the new width for free, no re-render needed.
const GANTT_GRID_COLS = 'var(--gc1) var(--gc2) var(--gc3) var(--gc4) var(--gc5) 1fr';

// ── GANTT COLUMN RESIZE (Excel-style drag-to-widen) ─────────────
const GANTT_COL_MIN_WIDTH = 50;
const GANTT_COL_STORAGE_KEY = 'waypoint-gantt-col-widths';
const GANTT_COL_DEFAULTS = { 1: 200, 2: 90, 3: 100, 4: 100, 5: 70 };

function loadGanttColWidths() {
  let widths = { ...GANTT_COL_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(GANTT_COL_STORAGE_KEY) || '{}');
    widths = { ...widths, ...saved };
  } catch {}
  applyGanttColWidths(widths);
}

function applyGanttColWidths(widths) {
  const el = document.getElementById('page-gantt');
  if (!el) return;
  Object.keys(widths).forEach(i => el.style.setProperty(`--gc${i}`, widths[i] + 'px'));
}

function resetGanttColWidths() {
  try { localStorage.removeItem(GANTT_COL_STORAGE_KEY); } catch {}
  applyGanttColWidths(GANTT_COL_DEFAULTS);
  showToast('↔️ Column widths reset');
}

// Off by default — a compact single-line-per-task chart is still the
// common case, and forcing every row taller by default would be a bigger
// change than most people asked for. Print always wraps regardless (see
// the stylesheet's @media print rule), since there's no "widen the column
// to see the rest" on paper.
function loadGanttWrapText() {
  let on = false;
  try { on = localStorage.getItem('ganttWrapText') === '1'; } catch {}
  document.getElementById('page-gantt').classList.toggle('gantt-wrap-on', on);
  document.getElementById('field-toggle-wraptext').checked = on;
}
function toggleGanttWrapText() {
  const on = document.getElementById('field-toggle-wraptext').checked;
  document.getElementById('page-gantt').classList.toggle('gantt-wrap-on', on);
  try { localStorage.setItem('ganttWrapText', on ? '1' : '0'); } catch {}
}

// ── GANTT PRINT COLUMNS ("⋯ More" → Print columns) ──────────────
// Which of the 4 optional frozen columns actually appear in Print/PDF —
// Task/Project always prints. Screen view is untouched either way; the
// print-hide-* classes only do anything under @media print (see stylesheet).
const GANTT_PRINT_COL_DEFAULTS = { status: true, start: true, due: true, duration: true };
const GANTT_PRINT_COL_STORAGE_KEY = 'waypoint-gantt-print-columns';

function loadGanttPrintColumns() {
  let cols = { ...GANTT_PRINT_COL_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(GANTT_PRINT_COL_STORAGE_KEY) || '{}');
    cols = { ...cols, ...saved };
  } catch {}
  applyGanttPrintColumns(cols);
}
function applyGanttPrintColumns(cols) {
  const el = document.getElementById('page-gantt');
  Object.keys(GANTT_PRINT_COL_DEFAULTS).forEach(key => {
    el.classList.toggle(`print-hide-${key}`, !cols[key]);
    const cb = document.getElementById(`print-col-toggle-${key}`);
    if (cb) cb.checked = !!cols[key];
  });
}
function toggleGanttPrintColumn(key) {
  let cols = { ...GANTT_PRINT_COL_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(GANTT_PRINT_COL_STORAGE_KEY) || '{}');
    cols = { ...cols, ...saved };
  } catch {}
  cols[key] = !cols[key];
  try { localStorage.setItem(GANTT_PRINT_COL_STORAGE_KEY, JSON.stringify(cols)); } catch {}
  applyGanttPrintColumns(cols);
}

let _ganttColResize = null;
function ganttColResizeMouseDown(e, colIndex) {
  e.preventDefault();
  e.stopPropagation();
  const el = document.getElementById('page-gantt');
  const startWidth = parseFloat(getComputedStyle(el).getPropertyValue(`--gc${colIndex}`)) || GANTT_COL_DEFAULTS[colIndex];
  _ganttColResize = { colIndex, startX: e.clientX, startWidth };
  e.target.classList.add('gantt-col-resizing');
  document.addEventListener('mousemove', ganttColResizeMouseMove);
  document.addEventListener('mouseup', ganttColResizeMouseUp);
}
function ganttColResizeMouseMove(e) {
  if (!_ganttColResize) return;
  const { colIndex, startX, startWidth } = _ganttColResize;
  const newWidth = Math.max(GANTT_COL_MIN_WIDTH, startWidth + (e.clientX - startX));
  applyGanttColWidths({ [colIndex]: newWidth });
}
function ganttColResizeMouseUp() {
  if (!_ganttColResize) return;
  document.querySelectorAll('.gantt-col-resizing').forEach(el => el.classList.remove('gantt-col-resizing'));
  const el = document.getElementById('page-gantt');
  const widths = {};
  for (let i = 1; i <= 5; i++) widths[i] = parseFloat(getComputedStyle(el).getPropertyValue(`--gc${i}`)) || GANTT_COL_DEFAULTS[i];
  try { localStorage.setItem(GANTT_COL_STORAGE_KEY, JSON.stringify(widths)); } catch {}
  _ganttColResize = null;
  document.removeEventListener('mousemove', ganttColResizeMouseMove);
  document.removeEventListener('mouseup', ganttColResizeMouseUp);
}

function toggleGanttGroup(groupId) {
  if (ganttCollapsed.has(groupId)) ganttCollapsed.delete(groupId);
  else ganttCollapsed.add(groupId);
  renderGantt();
}

function toggleAllGantt() {
  const allCollapsed = ganttGroupIds.length > 0 && ganttGroupIds.every(id => ganttCollapsed.has(id));
  if (allCollapsed) ganttCollapsed.clear();
  else ganttGroupIds.forEach(id => ganttCollapsed.add(id));
  renderGantt();
}

function setGanttViewMode(mode) {
  APP.ganttViewMode = mode;
  renderGantt();
}

function setGanttProjectFilter(projectId) {
  APP.ganttProjectFilter = projectId;
  renderGantt();
}

// ── GANTT PRINT / IMAGE EXPORT ────────────────────────────────────
// Print reuses the exact chart already on screen via the browser's own
// print engine — the .gantt-exporting/@media print CSS just un-freezes the
// sticky columns and drops the scroll clipping so it flows at full size.
//
// Image export goes to the server instead of a client-side canvas library:
// html2canvas's manual DOM-to-canvas renderer clips flex-centered text
// inside this chart's CSS Grid rows (a known limitation), so a real
// headless browser screenshot of the live page is used for pixel-perfect
// output — see backend/reports/visual.js renderGanttImage().
// Trims the printed timeline to whatever's actually shown — no padded
// blank months meant for on-screen browsing room — whether or not a
// specific project is selected in the filter dropdown.
async function printGanttChart() {
  APP.ganttPrintMode = true;
  await renderGantt();
  window.print();
}
window.addEventListener('afterprint', () => {
  if (APP.ganttPrintMode) {
    APP.ganttPrintMode = false;
    renderGantt();
  }
});

async function exportGanttImage() {
  // The menu item that was clicked lives inside the dropdown, which closes
  // right away — show the loading state on the always-visible toolbar
  // button instead, so there's feedback during the ~10-15s render.
  const btn = document.getElementById('gantt-fields-btn');
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Rendering…`;
  try {
    const res = await fetch('/api/reports/gantt-image');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Export failed');
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gantt-chart_' + new Date().toISOString().slice(0, 10) + '.png';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('✅ Image exported');
  } catch (e) {
    console.error('Gantt image export error:', e);
    showToast('❌ ' + (e.message || 'Failed to export image'), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

function formatDuration(startDate, endDate) {
  if (!startDate || !endDate) return '—';
  const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
  return days <= 0 ? '—' : (days === 1 ? '1 day' : `${days} days`);
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  // A bare "2026-10-03" is read as local midnight, not UTC, so the day
  // doesn't slip back one west of Greenwich.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr + 'T00:00:00') : new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

// Builds the header columns for the timeline area under the chosen zoom
// level. Bar/milestone positions are always computed from raw day offsets
// (see posPct below), so switching view mode only changes how the header
// and gridlines are divided up — never the underlying date math.
function buildTimelineColumns(mode, start, end, totalDays) {
  const cols = [];
  if (mode === 'week') {
    let cur = new Date(start);
    while (cur < end) {
      const next = new Date(cur); next.setDate(next.getDate() + 7);
      const segEnd = next > end ? end : next;
      const days = Math.max(1, Math.round((segEnd - cur) / 86400000));
      cols.push({ days, label: cur.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) });
      cur = next;
    }
  } else if (mode === 'year') {
    let y = start.getFullYear();
    while (y <= end.getFullYear()) {
      const yStart = y === start.getFullYear() ? start : new Date(y, 0, 1);
      const yEndCandidate = new Date(y, 11, 31);
      const yEnd = yEndCandidate < end ? yEndCandidate : end;
      const days = Math.max(1, Math.round((yEnd - yStart) / 86400000) + 1);
      cols.push({ days, label: String(y) });
      y++;
    }
  } else {
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
      cols.push({ days: daysInMonth, label: cur.toLocaleString('default', { month: 'short' }) + " '" + String(cur.getFullYear()).slice(2) });
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  return { widths: cols.map(c => (c.days / totalDays) * 100), labels: cols.map(c => c.label) };
}

// The same three numbers Journey's own stats strip shows (percent
// complete, day streak, pace vs. schedule), reused here for whatever
// the Gantt/Kanban project filter currently shows — all tasks, or one
// project's tree. Plain white-card styling matching the rest of this
// page, not Journey's themed game-HUD look; hidden automatically while
// Journey mode is active (see applyGanttPageView()) since that view
// already shows its own better-integrated version of the same data.
function renderGanttStats(tasks, project) {
  const wrap = document.getElementById('gantt-stats-strip');
  if (!wrap) return;
  const total = tasks.length;
  const pct = ProgressMath.progressPct(tasks);
  const streak = (APP.profile && APP.profile.currentStreak) || 0;
  const fallbackStart = project && (project.startDate || (project.createdAt && project.createdAt.slice(0, 10)));
  const expectedFrac = total ? ProgressMath.expectedFraction(tasks, fallbackStart) : null;
  const youFrac = ProgressMath.progressFraction(tasks);
  let paceIcon, paceValue, paceLabel;
  if (!total || expectedFrac === null) {
    paceIcon = '⏱️'; paceValue = '—'; paceLabel = 'Own pace';
  } else {
    const deltaPct = Math.round((youFrac - expectedFrac) * 100);
    if (youFrac > expectedFrac + 0.03) { paceIcon = '🏆'; paceValue = `+${deltaPct}%`; paceLabel = 'Ahead'; }
    else if (youFrac < expectedFrac - 0.03) { paceIcon = '⏳'; paceValue = `${Math.abs(deltaPct)}%`; paceLabel = 'Behind'; }
    else { paceIcon = '🤝'; paceValue = 'Even'; paceLabel = 'On pace'; }
  }
  const stat = (value, label) => `
    <div class="flex flex-col sm:flex-row items-start sm:items-baseline gap-0 sm:gap-1.5">
      <span class="text-base font-black text-navy whitespace-nowrap">${value}</span>
      <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">${esc(label)}</span>
    </div>`;
  wrap.innerHTML = [
    stat(`${icon('goal')} ${pct}%`, 'Complete'),
    stat(streak ? `${icon('flame')} ${streak}` : '—', 'Day streak'),
    stat(`${emojiIcon(paceIcon)} ${paceValue}`, paceLabel),
  ].join('<div class="w-px self-stretch bg-gray-100"></div>');
}

async function renderGantt() {
  try {
    const [tasks, projects] = await Promise.all([API.getTasks(), API.getProjects()]);
    const projectById = Object.fromEntries(projects.map(p => [p.id, p]));
    const cardFields = getCardFields();
    if (!APP.ganttViewMode) APP.ganttViewMode = 'month';
    if (APP.ganttProjectFilter === undefined) APP.ganttProjectFilter = '';
    let pageView = 'timeline';
    try { pageView = localStorage.getItem('ganttPageView') || 'timeline'; } catch { /* private mode etc */ }
    applyGanttPageView(pageView);
    loadGanttColWidths();
    loadGanttWrapText();
    loadGanttPrintColumns();

    let legendOpen = false;
    try { legendOpen = localStorage.getItem('ganttLegendOpen') === '1'; } catch { /* private mode etc */ }
    document.getElementById('gantt-legend').classList.toggle('hidden', !legendOpen);

    document.querySelectorAll('.gantt-view-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === APP.ganttViewMode));

    // Project filter dropdown — top-level projects grouped with their
    // sub-folders, same hierarchy shown when assigning a task to a project.
    const filterTopLevel = projects.filter(p => !p.parentId);
    const filterChildrenOf = pid => projects.filter(p => p.parentId === pid);
    const filterSel = document.getElementById('gantt-project-filter');
    filterSel.innerHTML = '<option value="">All Projects</option>' + filterTopLevel.map(top => {
      const kids = filterChildrenOf(top.id);
      const topOption = `<option value="${top.id}">${esc(top.title)}</option>`;
      if (!kids.length) return topOption;
      const kidOptions = kids.map(k => `<option value="${k.id}">${esc(k.title)}</option>`).join('');
      return `<optgroup label="${esc(top.title)}">${topOption}${kidOptions}</optgroup>`;
    }).join('');
    filterSel.value = APP.ganttProjectFilter;
    // Filter pointed at a project that's since been deleted — fall back to "All Projects"
    // instead of silently filtering every remaining task out of the chart.
    if (filterSel.value !== APP.ganttProjectFilter) APP.ganttProjectFilter = filterSel.value;

    // Which groups the filter allows through — selecting a top-level project
    // includes its sub-folders too, so you still see every task in that tree.
    const allowedGroupIds = APP.ganttProjectFilter
      ? new Set([APP.ganttProjectFilter, ...filterChildrenOf(APP.ganttProjectFilter).map(p => p.id)])
      : null;

    // Date range: span the actual task dates (with a month of padding either
    // side) so nothing gets cut off, falling back to a default window when
    // no task has any date yet. Narrows to just the filtered project's tasks
    // when a filter is active, so the chart zooms to what's actually shown.
    const dateSourceTasks = allowedGroupIds
      ? tasks.filter(t => allowedGroupIds.has(t.projectId))
      : tasks;
    renderGanttStats(dateSourceTasks, APP.ganttProjectFilter ? projectById[APP.ganttProjectFilter] : null);
    const resetBtn = document.getElementById('gantt-reset-btn');
    if (resetBtn) {
      const filterProject = APP.ganttProjectFilter ? projectById[APP.ganttProjectFilter] : null;
      resetBtn.classList.toggle('hidden', !filterProject || !(filterProject.role === 'owner' || filterProject.role === 'editor'));
    }
    const dated = dateSourceTasks
      .flatMap(t => [t.startDate, t.endDate])
      .filter(Boolean)
      .map(d => new Date(d))
      .filter(d => !isNaN(d));

    let start, end;
    if (APP.ganttPrintMode) {
      // Printing: show exactly the timeline being printed, not padded with
      // extra months of blank chart meant for on-screen browsing room.
      // Works whether or not a specific project is selected in the filter
      // — with one, its own start date anchors the left edge (a task can
      // never start earlier than its project — enforced on save); without
      // one, it's just the tightest span of whatever tasks are shown.
      const filterProject = APP.ganttProjectFilter ? projectById[APP.ganttProjectFilter] : null;
      const projStart = filterProject && filterProject.startDate ? new Date(filterProject.startDate) : null;
      if (dated.length) {
        start = (projStart && !isNaN(projStart)) ? projStart : new Date(Math.min(...dated));
        end   = new Date(Math.max(...dated));
        if (end < start) end = start;
      } else if (projStart && !isNaN(projStart)) {
        start = projStart;
        end   = projStart;
      } else {
        start = APP.ganttStart;
        end   = APP.ganttEnd;
      }
    } else if (dated.length) {
      const minD = new Date(Math.min(...dated));
      const maxD = new Date(Math.max(...dated));
      start = new Date(minD.getFullYear(), minD.getMonth() - 1, 1);
      end   = new Date(maxD.getFullYear(), maxD.getMonth() + 2, 0);
    } else {
      start = APP.ganttStart;
      end   = APP.ganttEnd;
    }
    // A single-day project with no task range yet would otherwise divide
    // every bar/column position by zero days.
    if (end <= start) end = new Date(start.getTime() + 86400000);
    const totalDays = Math.ceil((end - start) / 86400000);

    // Timeline header, divided according to the chosen zoom level
    const { widths: colWidths, labels: colLabels } = buildTimelineColumns(APP.ganttViewMode, start, end, totalDays);

    if (APP.ganttPrintMode) {
      // Print always fits the page width — no forced minimum, so the
      // percentage-based date columns shrink to fit instead of overflowing
      // past the page edge and getting cut off. The screen view's "keep
      // columns readable, let the container scroll instead" behavior below
      // only makes sense when there's actually a scrollbar to reach for.
      document.getElementById('gantt-timeline-wrapper').style.minWidth = '';
      document.getElementById('gantt-rows-wrapper').style.minWidth = '';
    } else {
      // Each column needs a minimum pixel width to keep its label readable —
      // week view especially can produce far more columns than fit at a fixed
      // table width, so the wrapper grows and the outer container scrolls.
      const minColPx = { week: 50, month: 70, year: 90 }[APP.ganttViewMode] || 70;
      const fixedColsPx = 200 + 90 + 85 + 85 + 70;
      const ganttWidthPx = (fixedColsPx + colLabels.length * minColPx) + 'px';
      document.getElementById('gantt-timeline-wrapper').style.minWidth = ganttWidthPx;
      document.getElementById('gantt-rows-wrapper').style.minWidth = ganttWidthPx;
    }

    document.getElementById('gantt-months').innerHTML = colLabels.map((label, i) => `
      <div class="text-xs font-semibold text-gray-500 py-2.5 border-r border-gray-200 text-center flex-shrink-0 truncate" style="width:${colWidths[i]}%">
        ${label}
      </div>`).join('');

    // Vertical gridlines at each column boundary, reused in every row so the
    // columns actually line up with the header above them.
    let acc = 0;
    const gridlines = colWidths.slice(0, -1).map(w => {
      acc += w;
      return `<div class="gantt-gridline" style="left:${acc}%"></div>`;
    }).join('');

    // Today line (only if "today" actually falls inside the visible range)
    const today = new Date();
    const todayLine = (today >= start && today <= end)
      ? `<div class="today-line" style="left:${Math.max(0, Math.min(100, ((today - start) / 86400000 / totalDays) * 100))}%"></div>`
      : '';

    const posPct = d => Math.max(0, Math.min(100, ((d - start) / 86400000 / totalDays) * 100));

    // Project start marker — a dashed green line (repeated per row, same
    // technique as the today line) for every project that has one set,
    // plus a badge above the table so it's visible without scrolling down.
    const projectsWithStart = projects.filter(p => p.startDate && (!allowedGroupIds || allowedGroupIds.has(p.id)));
    const projectStartLines = projectsWithStart
      .map(p => new Date(p.startDate))
      .filter(d => d >= start && d <= end)
      .map(d => `<div class="project-start-line" style="left:${posPct(d)}%"></div>`)
      .join('');

    document.getElementById('gantt-project-badges').innerHTML = projectsWithStart.map(p => `
      <span class="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 cursor-pointer" onclick="editProject('${p.id}')" title="Edit project">
        ${icon('goal')} ${esc(p.title)} starts ${formatDateShort(p.startDate)}
      </span>`).join('');

    // Group rows by the task's actual project (which may be a top-level
    // project or one of its sub-folders) — MS Project style: a summary bar
    // spanning the group's full date range, with individual task
    // bars/milestones beneath it. Because the group IS a real, editable
    // project now, clicking its name opens that project's own edit modal.
    const byProject = {};
    tasks.forEach(t => { (byProject[t.projectId] = byProject[t.projectId] || []).push(t); });
    // Sort so a project's sub-folders stay grouped immediately beneath it —
    // by family (the top-level project's title), then rank (the top-level
    // group itself before its children), then by when each phase starts,
    // so Phase 1 always sits above Phase 2 like a timeline should (by name
    // alone, "Build" came before "Research" and "Phase 10" before
    // "Phase 2").
    const familyTitle = id => {
      const proj = projectById[id];
      if (!proj) return '';
      return proj.parentId ? (projectById[proj.parentId]?.title || '') : proj.title;
    };
    const groupRank = id => projectById[id]?.parentId ? 1 : 0;
    // A phase's earliest date: its first task's start (or due date if it
    // has no start), else the phase's own start date; undated phases last.
    const groupStart = id => byProject[id]
      .map(t => (t.startDate || t.endDate || '').slice(0, 10))
      .filter(Boolean)
      .sort()[0] || projectById[id]?.startDate || '9999';
    const groupProjectIds = Object.keys(byProject)
      .filter(id => !allowedGroupIds || allowedGroupIds.has(id))
      .sort((a, b) => {
        const family = familyTitle(a).localeCompare(familyTitle(b));
        if (family !== 0) return family;
        const rank = groupRank(a) - groupRank(b);
        if (rank !== 0) return rank;
        const begins = groupStart(a).localeCompare(groupStart(b));
        if (begins !== 0) return begins;
        const made = (projectById[a]?.createdAt || '').localeCompare(projectById[b]?.createdAt || '');
        if (made !== 0) return made;
        return (projectById[a]?.title || '').localeCompare(projectById[b]?.title || '', undefined, { numeric: true });
      });
    ganttGroupIds = groupProjectIds;
    const allCollapsed = ganttGroupIds.length > 0 && ganttGroupIds.every(id => ganttCollapsed.has(id));
    document.getElementById('gantt-toggle-all-btn').textContent = allCollapsed ? 'Expand All' : 'Collapse All';

    let rowsHTML = '';
    groupProjectIds.forEach(groupId => {
      const pts = byProject[groupId];
      const groupProject = projectById[groupId];
      const canEditGroup = groupProject && (groupProject.role === 'owner' || groupProject.role === 'editor');
      const color = groupProject?.color || '#6B7280';
      const groupTitle = groupProject?.title || 'Unknown project';
      const done  = pts.filter(t => t.status === 'Completed').length;

      const catDates = pts.flatMap(t => [t.startDate, t.endDate]).filter(Boolean).map(d => new Date(d)).filter(d => !isNaN(d));
      let summaryBar = '', catStart = '', catEnd = '';
      if (catDates.length) {
        const minDate = new Date(Math.min(...catDates));
        const maxDate = new Date(Math.max(...catDates));
        catStart = minDate.toISOString().slice(0, 10);
        catEnd   = maxDate.toISOString().slice(0, 10);
        const gMin = posPct(minDate);
        const gMax = posPct(maxDate);
        const dark = shadeColor(color, -40);
        summaryBar = `
          <div class="gantt-summary-bar" style="left:${gMin}%;width:${Math.max(0.6, gMax - gMin)}%;background:${dark}"
            title="${esc(groupTitle)}: ${catStart} → ${catEnd}${canEditGroup ? ' (drag to shift every task in this folder)' : ''}"
            ${canEditGroup ? `onmousedown="ganttSummaryMouseDown(event,'${groupId}')"` : ''}></div>
          <div class="gantt-summary-cap" style="left:${gMin}%;border-top:7px solid ${dark}"></div>
          <div class="gantt-summary-cap" style="left:${gMax}%;border-top:7px solid ${dark}"></div>`;
      }

      const isCollapsed = ganttCollapsed.has(groupId);

      rowsHTML += `
        <div class="grid gantt-grid-row group border-b border-gray-200 gantt-cat-row" style="grid-template-columns:${GANTT_GRID_COLS}">
          <div class="gantt-sticky gantt-sticky-1 px-4 py-2 border-r border-gray-200 flex items-center gap-2 font-bold text-xs overflow-hidden">
            <span class="gantt-keep text-gray-400 text-[10px] flex-shrink-0 transition-transform cursor-pointer" style="${isCollapsed ? '' : 'transform:rotate(90deg)'}" onclick="toggleGanttGroup('${groupId}')" title="${isCollapsed ? 'Expand' : 'Collapse'}">▶</span>
            <span class="gantt-keep w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background:${color}"></span>
            <span class="gantt-title-text truncate cursor-pointer hover:underline flex-1 min-w-0" style="color:${color}" onclick="showPage('project-detail','${groupId}')" title="Open this project">${emojiIcon(groupProject?.icon || '')} ${esc(groupTitle)}</span>
            ${cardFields.schedule ? miniProjectScheduleBadge(pts) : ''}
            ${canEditGroup ? `
            <button onclick="event.stopPropagation();editProject('${groupId}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-gray-600 px-1" title="Edit project details">${icon('edit')}</button>
            <button onclick="openAddTask('${groupId}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-teal px-1" title="Add task to this project">${icon('plus')}</button>
            <button onclick="deleteProjectConfirm('${groupId}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-red-500 px-1" title="Delete this project">${icon('trash')}</button>` : ''}
          </div>
          <div class="gantt-sticky gantt-sticky-2 px-3 py-2 border-r border-gray-200 flex items-center text-[10px] text-gray-400 font-semibold">${done}/${pts.length}</div>
          <div class="gantt-sticky gantt-sticky-3 px-3 py-2 border-r border-gray-200 flex items-center text-[10px] text-gray-400 whitespace-nowrap overflow-hidden">${formatDateShort(catStart)}</div>
          <div class="gantt-sticky gantt-sticky-4 px-3 py-2 border-r border-gray-200 flex items-center text-[10px] text-gray-400 whitespace-nowrap overflow-hidden">${formatDateShort(catEnd)}</div>
          <div class="gantt-sticky gantt-sticky-5 px-3 py-2 border-r border-gray-200 flex items-center text-[10px] text-gray-400 whitespace-nowrap overflow-hidden">${formatDuration(catStart, catEnd)}</div>
          <div class="gantt-bar-area h-8">${gridlines}${summaryBar}${todayLine}${projectStartLines}</div>
        </div>`;

      if (isCollapsed) return;

      pts.forEach((t, i) => {
        const ts = t.startDate ? new Date(t.startDate) : null;
        const te = t.endDate   ? new Date(t.endDate)   : null;
        const borderColor = priorityBorderColor(t.priority);
        const fillColor   = t.status === 'Completed' ? shadeColor(color, 40) : color;
        const minStart = groupProject ? (groupProject.startDate || '') : '';

        let marker = '';
        if (ts && te) {
          const barLeft  = Math.max(0, ((ts - start) / 86400000 / totalDays) * 100);
          const barWidth = Math.max(0.8, Math.min(100 - barLeft, ((te - ts) / 86400000 / totalDays) * 100 + 0.5));
          marker = `
            <div class="gantt-bar" style="left:${barLeft}%;width:${barWidth}%;background:${fillColor};border:2px solid ${borderColor}"
              title="${esc(t.title)} [${t.priority} priority]: ${t.startDate} → ${t.endDate}${canEditGroup ? ' (drag to move, edges to resize, click to edit)' : ''}"
              ${canEditGroup ? `onmousedown="ganttBarMouseDown(event,'${t.id}','move')"` : ''}>
              ${canEditGroup ? `<span class="gantt-resize-handle" style="left:0" onmousedown="ganttBarMouseDown(event,'${t.id}','resize-left')"></span>` : ''}
              <span class="gantt-bar-label">${pendingFoes(t) && t.status !== 'Completed' ? `${icon('blocker', 'tiny')}${pendingFoes(t)} ` : ''}${esc(t.title)}</span>
              ${canEditGroup ? `<span class="gantt-resize-handle" style="right:0" onmousedown="ganttBarMouseDown(event,'${t.id}','resize-right')"></span>` : ''}
            </div>`;
        } else if (te) {
          const pctPos = posPct(te);
          marker = `<div class="gantt-milestone" style="left:${pctPos}%;background:${fillColor};border:2px solid ${borderColor}"
            title="${esc(t.title)} [${t.priority} priority]: due ${t.endDate}${canEditGroup ? ' (drag to move, click to edit)' : ''}"
            ${canEditGroup ? `onmousedown="ganttBarMouseDown(event,'${t.id}','milestone')"` : ''}></div>`;
        }

        rowsHTML += `
          <div class="grid gantt-grid-row group border-b border-gray-100 hover:bg-blue-50/40 bg-white ${i % 2 ? 'gantt-row-alt' : ''}" style="grid-template-columns:${GANTT_GRID_COLS};min-height:34px" data-task-id="${t.id}" data-group="${groupId}">
            <div class="gantt-sticky gantt-sticky-1 px-4 py-2 border-r border-gray-200 flex items-center gap-1 overflow-hidden">
              ${canEditGroup ? `<span class="flex-shrink-0 hidden group-hover:inline cursor-grab text-gray-300 hover:text-gray-500 px-0.5" onmousedown="ganttRowMouseDown(event, '${t.id}', '${t.projectId}', '${groupId}')" title="Drag to reorder">⠿</span>` : ''}
              <span class="gantt-status-dot gantt-keep" style="background:${statusColor(t.status)}" title="${t.status}" aria-label="${t.status}"></span>
              <span class="gantt-title-text flex-1 min-w-[6rem] text-xs text-gray-600 hover:text-teal truncate cursor-pointer" onclick="${canEditGroup ? `editTask('${t.id}')` : `openTaskDetail('${t.id}')`}" title="${esc(t.title)} (click to ${canEditGroup ? 'edit' : 'view'})">${esc(t.title)}</span>
              ${cardFields.priority ? miniPriorityBadge(t.priority) : ''}
              ${cardFields.tags ? miniTagBadges(t.tags) : ''}
              ${cardFields.checklist ? miniChecklistBadge(t) : ''}
              ${cardFields.cost ? miniCostBadge(t.cost) : ''}
              ${cardFields.schedule ? miniScheduleBadge(t) : ''}
              ${cardFields.assignee ? assigneeInitialBadge(t.assigneeName) : ''}
              ${commentCountBadge(t)}
              ${statusUpdateBadge(t)}
              ${obstacleBadge(t)}
              ${waitingBadge(t)}
              ${addObstacleButton(t, canEditGroup)}
              ${miniProgressBadge(t)}
              ${t.targetCount && t.status !== 'Completed' && canEditGroup ? `<button onclick="event.stopPropagation();bumpTaskProgressAction('${t.id}',1,'${t.projectId}')" class="flex-shrink-0 text-[10px] font-bold bg-teal/10 hover:bg-teal/20 text-teal px-1 rounded" title="Log one">+1</button>` : ''}
              <button onclick="addTaskToGoogleCalendar('${t.id}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-gray-600 px-1" title="Add to Google Calendar">${icon('calendar')}</button>
              ${canEditGroup ? `<button onclick="duplicateTaskAction('${t.id}', '${t.projectId}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-gray-600 px-1" title="Duplicate">⧉</button>
              <button onclick="deleteTaskConfirm('${t.id}', '${t.projectId}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-red-500 px-1" title="Delete task">${icon('trash')}</button>` : ''}
            </div>
            <div class="gantt-sticky gantt-sticky-2 px-1.5 py-1.5 border-r border-gray-200 flex items-center overflow-hidden">
              ${statusChipHTML(t, canEditGroup)}
            </div>
            <div class="gantt-sticky gantt-sticky-3 px-1.5 py-1.5 border-r border-gray-200 flex items-center overflow-hidden">
              <input type="date" value="${t.startDate || ''}" min="${minStart}" class="w-full rounded px-1 py-1 text-[10px] border border-gray-200 focus:outline-none focus:border-teal" ${canEditGroup ? '' : 'disabled'}
                onchange="updateGanttTaskDate('${t.id}', 'startDate', this.value)">
            </div>
            <div class="gantt-sticky gantt-sticky-4 px-1.5 py-1.5 border-r border-gray-200 flex items-center overflow-hidden">
              <input type="date" value="${t.endDate || ''}" class="w-full rounded px-1 py-1 text-[10px] border border-gray-200 focus:outline-none focus:border-teal" ${canEditGroup ? '' : 'disabled'}
                onchange="updateGanttTaskDate('${t.id}', 'endDate', this.value)">
            </div>
            <div class="gantt-sticky gantt-sticky-5 px-3 py-2 border-r border-gray-200 flex items-center text-[10px] text-gray-400 whitespace-nowrap overflow-hidden">${formatDuration(t.startDate, t.endDate)}</div>
            <div class="gantt-bar-area">${gridlines}${todayLine}${projectStartLines}${marker}</div>
          </div>`;
      });
    });

    document.getElementById('gantt-rows').innerHTML = rowsHTML
      || `<div class="p-10 text-center text-gray-400 text-sm">${APP.ganttProjectFilter ? 'No tasks in this project yet.' : 'No tasks yet.'}</div>`;
    document.getElementById('gantt-rows').dataset.totalDays = totalDays;
    APP.ganttTasks = tasks;
    requestAnimationFrame(drawGanttDependencies);
    requestAnimationFrame(scrollGanttToToday);

    const groupLegend = groupProjectIds
      .map(id => projectById[id])
      .filter(Boolean)
      .map(p => `<span class="flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${p.color}"></span>${esc(p.title)}</span>`)
      .join('');

    document.getElementById('gantt-legend-content').innerHTML = `
      <div class="flex gap-4 text-xs text-gray-500 flex-wrap mb-1.5">${groupLegend}</div>
      <div class="flex gap-4 text-xs text-gray-500 flex-wrap">
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm border-2" style="border-color:${PRIORITY_BORDER.High}"></span>High priority</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm border-2" style="border-color:${PRIORITY_BORDER.Medium}"></span>Medium</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm border-2" style="border-color:${PRIORITY_BORDER.Low}"></span>Low</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-2 h-2 bg-gray-400 rounded-sm" style="transform:rotate(45deg)"></span>Due date only</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-1.5 rounded-sm bg-gray-700"></span>Folder summary</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-0.5 h-3 bg-red-500 rounded"></span>Today</span>
      </div>`;

    renderKanbanBoard(dateSourceTasks, projectById);
  } catch (e) { console.error('Gantt error:', e); }
}

// ── KANBAN VIEW ────────────────────────────────────────────────
// A second, drag-to-change-status view of the same Gantt page — reuses
// whatever renderGantt() already fetched (respecting the current project
// filter) instead of a second round-trip to the API.
const KANBAN_COLUMNS = ['Not Started', 'In Progress', 'Completed'];
const KANBAN_COLUMN_COLOR = { 'Not Started': '#6B7280', 'In Progress': '#C0642A', 'Completed': '#1A7A4A' };

// Switching tabs is also the one moment the destination tab needs to be
// guaranteed fresh — e.g. completing a task from Journey's checklist, then
// clicking over to Kanban, should show it in the Done column, not whatever
// was last drawn there. Timeline and Kanban share one re-fetch (renderGantt
// already redraws both, and calls applyGanttPageView itself); Journey
// already re-fetches on its own inside renderJourneyView, so a direct
// applyGanttPageView is enough there — calling the heavier renderGantt
// would just redraw Timeline/Kanban pointlessly while they're hidden.
function setGanttPageView(mode) {
  setTimeout(() => syncBottomNav(APP.currentPage || 'gantt'), 0);
  try { localStorage.setItem('ganttPageView', mode); } catch { /* private mode etc */ }
  if (mode === 'journey') applyGanttPageView(mode);
  else renderGantt();
}

const GANTT_PAGE_VIEWS = ['timeline', 'kanban', 'journey']; // left-to-right order of the toggle's 3 stops

function applyGanttPageView(mode) {
  if (!GANTT_PAGE_VIEWS.includes(mode)) mode = 'timeline';
  document.querySelectorAll('#gantt-page-view-toggle .gantt-switch-btn').forEach(b => b.classList.toggle('active', b.dataset.pageview === mode));
  const thumb = document.getElementById('gantt-switch-thumb');
  thumb.style.transform = `translateX(${GANTT_PAGE_VIEWS.indexOf(mode) * 100}%)`;
  document.getElementById('gantt-timeline-view').classList.toggle('hidden', mode !== 'timeline');
  document.getElementById('gantt-kanban-view').classList.toggle('hidden', mode !== 'kanban');
  document.getElementById('gantt-journey-view').classList.toggle('hidden', mode !== 'journey');
  if (mode !== 'journey' && isJourneyFullscreen()) setJourneyFullscreen(false);
  // Journey shows its own themed version of these same numbers (and its
  // own Reset button) inside its game panel — these plain ones would be
  // mismatched duplicates there. Only hidden here, never shown: whether
  // it belongs on screen for Timeline/Kanban depends on edit permission,
  // which renderGantt()'s own pass (always the caller, except for this
  // direct journey switch) works out right after this runs.
  document.getElementById('gantt-stats-strip').classList.toggle('hidden', mode === 'journey');
  if (mode === 'journey') document.getElementById('gantt-reset-btn').classList.add('hidden');
  // Zoom level and Print/Export only make sense for the timeline.
  document.getElementById('gantt-view-toggle').classList.toggle('hidden', mode !== 'timeline');
  document.getElementById('gantt-view-toggle-menu').classList.toggle('hidden', mode !== 'timeline');
  document.getElementById('gantt-export-actions').classList.toggle('hidden', mode !== 'timeline');

  const heading = { timeline: 'Gantt Chart', kanban: 'Kanban Board', journey: 'Journey' }[mode];
  const subtitle = {
    timeline: 'Visual timeline of all tasks across every project.',
    kanban: 'Drag a card between columns to change its status.',
    journey: 'Watch one project\'s progress as a game-like trail — pick it from the filter above.',
  }[mode];
  document.getElementById('gantt-page-heading').textContent = heading;
  document.getElementById('gantt-page-subtitle').textContent = subtitle;
  document.getElementById('topbar-title').textContent = 'Planner';

  if (mode === 'journey') { JourneyGame.resume(); renderJourneyView(); } else { JourneyGame.pause(); }
}

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

// Overdue/started, then today, then this week, then everything else — same
// buckets as the Actions feed and the daily digest, just used to sort
// Kanban cards instead of splitting them into labeled sections. Answers
// "what do I actually need to do (or start) today or this week" at a
// glance, which a flat chronological sort doesn't (a date 3 years out
// still sorts "correctly" but tells you nothing about urgency). Shared by
// both the "Due Soon" and "Starting Soon" sorts — same logic, different
// date field.
function soonRank(t, field) {
  const dateStr = t[field];
  if (!dateStr) return 3;
  const todayKey = localDateKey(new Date());
  const weekAheadKey = localDateKey(new Date(Date.now() + 7 * 86400000));
  const key = dateStr.slice(0, 10);
  if (key < todayKey) return 0;      // overdue (or already should have started)
  if (key === todayKey) return 1;    // today
  if (key <= weekAheadKey) return 2; // this week
  return 3;                          // later
}

function soonCompare(field) {
  return (a, b) => {
    const rankDiff = soonRank(a, field) - soonRank(b, field);
    if (rankDiff !== 0) return rankDiff;
    const av = a[field] || '9999', bv = b[field] || '9999';
    return av < bv ? -1 : av > bv ? 1 : 0;
  };
}

const KANBAN_SORTS = {
  manual:   { label: 'Recently Added', fn: (a, b) => 0 }, // API order (createdAt ASC) — leave as-is
  priority: { label: 'Priority',       fn: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] },
  due:      { label: 'Due Soon',       fn: soonCompare('endDate') },
  start:    { label: 'Starting Soon',  fn: soonCompare('startDate') },
};

function setKanbanSort(sort) {
  APP.kanbanSort = sort;
  try { localStorage.setItem('kanbanSort', sort); } catch { /* private mode etc */ }
  renderGantt();
}

function setKanbanPriorityFilter(priority) {
  APP.kanbanPriorityFilter = priority;
  try { localStorage.setItem('kanbanPriorityFilter', priority); } catch { /* private mode etc */ }
  renderGantt();
}

function renderKanbanBoard(tasks, projectById) {
  const board = document.getElementById('kanban-board');
  if (!board) return;
  const cardFields = getCardFields();

  if (APP.kanbanSort === undefined) {
    try { APP.kanbanSort = localStorage.getItem('kanbanSort') || 'due'; } catch { APP.kanbanSort = 'due'; }
  }
  if (APP.kanbanPriorityFilter === undefined) {
    try { APP.kanbanPriorityFilter = localStorage.getItem('kanbanPriorityFilter') || ''; } catch { APP.kanbanPriorityFilter = ''; }
  }
  const sortSel = document.getElementById('kanban-sort');
  if (sortSel) sortSel.value = APP.kanbanSort;
  const prioritySel = document.getElementById('kanban-priority-filter');
  if (prioritySel) prioritySel.value = APP.kanbanPriorityFilter;

  if (APP.kanbanPriorityFilter) tasks = tasks.filter(t => t.priority === APP.kanbanPriorityFilter);

  const ICON = {
    cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    dup: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  };
  board.innerHTML = KANBAN_COLUMNS.map(status => {
    const colTasks = tasks.filter(t => t.status === status).sort(KANBAN_SORTS[APP.kanbanSort].fn);
    const cards = colTasks.map(t => {
      const proj = projectById[t.projectId];
      const canEdit = proj && (proj.role === 'owner' || proj.role === 'editor');
      const isOverdue = status !== 'Completed' && t.endDate && t.endDate.slice(0, 10) < localDateKey(new Date());
      // Moving a card by touch: a plain menu, so no long-press-and-drag
      // across columns that sit off screen on a phone.
      const move = canEdit ? `<button type="button" class="kanban-move" aria-haspopup="menu" aria-label="Move ${esc(t.title)} to another column" onclick="event.stopPropagation(); openChipMenu(this, 'status', '${t.id}', '${status}', 'kanban')">Move to… ▾</button>` : '';
      return `
        <div class="kanban-card group" data-task-id="${t.id}" data-status="${status}"
          ${canEdit ? `onmousedown="kanbanCardMouseDown(event, '${t.id}', '${status}')" ontouchstart="kanbanCardMouseDown(event, '${t.id}', '${status}')"` : ''}>
          <div class="flex items-start justify-between gap-2">
            <span class="kanban-card-title" role="button" tabindex="0" onclick="${canEdit ? `editTask('${t.id}')` : `openTaskDetail('${t.id}')`}" onkeydown="if(event.key==='Enter')this.click()">${esc(t.title)}</span>
            <div class="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
              ${cardFields.priority ? `<span class="kanban-prio" title="${esc(t.priority)} priority"><i style="background:${priorityBorderColor(t.priority)}"></i>${esc(t.priority)}</span>` : ''}
              ${cardFields.assignee ? assigneeInitialBadge(t.assigneeName) : ''}
            </div>
          </div>
          ${cardFields.tags && (t.tags || []).length ? `<div class="flex flex-wrap gap-1 mt-1.5">${miniTagBadges(t.tags)}</div>` : ''}
          <div class="kanban-card-foot">
            <span class="truncate flex items-center gap-1.5 min-w-0">${proj ? `<span class="truncate">${emojiIcon(proj.icon)} ${esc(proj.title)}</span>` : ''}${cardFields.checklist ? miniChecklistBadge(t) : ''}${cardFields.cost ? miniCostBadge(t.cost) : ''}${cardFields.schedule ? miniScheduleBadge(t) : ''}${commentCountBadge(t)}${statusUpdateBadge(t)}${obstacleBadge(t)}${waitingBadge(t)}<span data-reminder-slot="${t.id}">${window.Reminders ? Reminders.chip(t.id) : ''}</span></span>
            ${t.endDate ? `<span class="kanban-due ${isOverdue ? 'is-overdue' : ''}" title="${isOverdue ? 'Overdue' : 'Due'}">${formatDateShort(t.endDate)}</span>` : ''}
          </div>
          ${blockerChecklist(t, canEdit, 'board')}
          ${taskProgressBarHTML(t)}
          <div class="kanban-actions">
            ${status !== 'Completed' ? `<button type="button" class="kanban-act" onclick="Reminders.openSheet('${t.id}')" title="Remind me (rings like an alarm)" aria-label="Set a reminder">${ICON.bell}</button>` : ''}
            <button type="button" class="kanban-act" onclick="addTaskToGoogleCalendar('${t.id}')" title="Add to Google Calendar" aria-label="Add to Google Calendar">${ICON.cal}</button>
            ${canEdit ? `<button type="button" class="kanban-act" onclick="duplicateTaskAction('${t.id}', '${t.projectId}')" title="Duplicate" aria-label="Duplicate task">${ICON.dup}</button>
            <button type="button" class="kanban-act danger" onclick="deleteTaskConfirm('${t.id}', '${t.projectId}')" title="Delete task" aria-label="Delete task">${ICON.del}</button>
            ${status !== 'Completed' && !(t.obstacles || []).length ? `<button type="button" class="kanban-act" onclick="openObstacles('${t.id}')" title="Add a blocker (something in the way)" aria-label="Add a blocker">${icon('blocker')}</button>` : ''}` : ''}
            ${move}
          </div>
        </div>`;
    }).join('') || '<p class="kanban-empty">No tasks yet. Drag one here or tap +</p>';

    return `
      <section class="kanban-column" data-status="${status}" aria-label="${status}, ${colTasks.length} task${colTasks.length === 1 ? '' : 's'}">
        <div class="kanban-col-head">
          <span class="kanban-col-dot" style="background:${KANBAN_COLUMN_COLOR[status]}"></span>
          <h4>${status}</h4>
          <span class="kanban-col-count">${colTasks.length}</span>
          <button type="button" onclick="openAddTaskWithStatus('${status}')" class="kanban-col-add" title="Add a task to ${status}" aria-label="Add a task to ${status}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
        </div>
        <div class="kanban-column-body" data-status="${status}">${cards}</div>
      </section>`;
  }).join('');
}

async function openAddTaskWithStatus(status) {
  await openAddTask(APP.ganttProjectFilter || undefined);
  document.getElementById('task-status').value = status;
  syncSegs(document.getElementById('modal-task'));
}

// Manual drag-to-change-status, mouse- and touch-based like the rest of
// the Gantt chart's drag interactions (row reorder, bar move/resize)
// rather than the HTML5 Drag and Drop API, for the same "drop indicator"
// feel throughout — and so it actually works on a phone/tablet (including
// the Android app), where mouse events never fire at all.
let kanbanDrag = null;

// Mouse and touch events carry coordinates differently — normalize once
// here rather than branching in every handler below.
function pointerXY(e) {
  if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

// Touch needs to tell "scrolling the column" apart from "dragging this
// card" — both start as a finger landing on the card. Mouse doesn't have
// that ambiguity (scrolling is the wheel/scrollbar, unrelated to
// mousedown), so only touch gets the hold-before-drag treatment: a short
// hold with the finger basically still starts the drag, while an ordinary
// scroll swipe cancels it and falls through to the browser's native scroll.
const KANBAN_TOUCH_HOLD_MS = 300;
const KANBAN_TOUCH_CANCEL_PX = 10;
let kanbanTouchHoldTimer = null;

function kanbanCardMouseDown(e, taskId, currentStatus) {
  if (e.target.closest('button, select, input, label')) return; // actions, the Move menu and blocker ticks handle their own taps

  if (e.type === 'touchstart') {
    const cardEl = e.currentTarget;
    const { x: startX, y: startY } = pointerXY(e);
    const cancel = () => {
      clearTimeout(kanbanTouchHoldTimer);
      kanbanTouchHoldTimer = null;
      cardEl.removeEventListener('touchmove', onEarlyMove);
      cardEl.removeEventListener('touchend', cancel);
      cardEl.removeEventListener('touchcancel', cancel);
    };
    const onEarlyMove = (ev) => {
      const { x, y } = pointerXY(ev);
      if (Math.hypot(x - startX, y - startY) > KANBAN_TOUCH_CANCEL_PX) cancel(); // moved enough to be a scroll, not a hold
    };
    cardEl.addEventListener('touchmove', onEarlyMove, { passive: true });
    cardEl.addEventListener('touchend', cancel);
    cardEl.addEventListener('touchcancel', cancel);
    kanbanTouchHoldTimer = setTimeout(() => { cancel(); startKanbanDrag(e, cardEl, taskId, currentStatus); }, KANBAN_TOUCH_HOLD_MS);
    return; // no preventDefault yet — let the page scroll normally until/unless the hold fires
  }

  startKanbanDrag(e, e.currentTarget, taskId, currentStatus);
}

function startKanbanDrag(e, cardEl, taskId, currentStatus) {
  e.preventDefault();
  const rect = cardEl.getBoundingClientRect();
  const { x, y } = pointerXY(e);

  // A floating clone that tracks the cursor exactly, so the card visibly
  // "lifts and follows" rather than just fading in place while an
  // invisible drag happens underneath. pointer-events:none keeps it out of
  // elementFromPoint's way for drop-target detection.
  const ghost = cardEl.cloneNode(true);
  ghost.classList.add('kanban-card-ghost');
  ghost.classList.remove('group');
  // Purely a visual copy — strip anything that would make code elsewhere
  // (or a test) mistake it for the real, interactive card.
  ghost.removeAttribute('data-task-id');
  ghost.removeAttribute('onmousedown');
  ghost.removeAttribute('ontouchstart');
  ghost.style.position = 'fixed';
  ghost.style.width = rect.width + 'px';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.margin = '0';
  document.body.appendChild(ghost);

  kanbanDrag = {
    taskId, currentStatus, cardEl, ghost, dropStatus: null,
    grabDX: x - rect.left, grabDY: y - rect.top,
  };
  cardEl.classList.add('kanban-card-dragging');
  document.addEventListener('mousemove', kanbanMouseMove);
  document.addEventListener('mouseup', kanbanMouseUp);
  document.addEventListener('touchmove', kanbanMouseMove, { passive: false });
  document.addEventListener('touchend', kanbanMouseUp);
  document.addEventListener('touchcancel', kanbanMouseUp);
}

function kanbanMouseMove(e) {
  const d = kanbanDrag;
  if (!d) return;
  if (e.cancelable) e.preventDefault(); // stop the page from scrolling while dragging a card on touch
  const { x, y } = pointerXY(e);
  d.ghost.style.left = (x - d.grabDX) + 'px';
  d.ghost.style.top = (y - d.grabDY) + 'px';

  document.querySelectorAll('.kanban-column-dragover').forEach(c => c.classList.remove('kanban-column-dragover'));
  const el = document.elementFromPoint(x, y); // pointer-events:none on the ghost keeps it out of this
  const column = el && el.closest('.kanban-column');
  d.dropStatus = column ? column.dataset.status : null;
  if (column) column.classList.add('kanban-column-dragover');
  // On a phone the columns swipe sideways: holding a card near either
  // edge scrolls the next column into view.
  const board = document.getElementById('kanban-board');
  if (board && board.scrollWidth > board.clientWidth) {
    const r = board.getBoundingClientRect();
    if (x > r.right - 40) board.scrollLeft += 12;
    else if (x < r.left + 40) board.scrollLeft -= 12;
  }
}

async function kanbanMouseUp() {
  document.removeEventListener('mousemove', kanbanMouseMove);
  document.removeEventListener('mouseup', kanbanMouseUp);
  document.removeEventListener('touchmove', kanbanMouseMove);
  document.removeEventListener('touchend', kanbanMouseUp);
  document.removeEventListener('touchcancel', kanbanMouseUp);
  const d = kanbanDrag;
  kanbanDrag = null;
  if (!d) return;

  d.ghost.remove();
  d.cardEl.classList.remove('kanban-card-dragging');
  document.querySelectorAll('.kanban-column-dragover').forEach(c => c.classList.remove('kanban-column-dragover'));

  if (d.dropStatus && d.dropStatus !== d.currentStatus) {
    await updateGanttTaskStatus(d.taskId, d.dropStatus); // already re-renders Gantt (and, in turn, Kanban) on completion
  }
}

// The chart opens on today rather than on the first month, so on a
// narrow screen the bars that matter are in view without a long swipe.
// Only on a fresh chart: a re-render after an edit keeps your place.
function scrollGanttToToday() {
  const pane = document.getElementById('gantt-rows-scroll');
  const line = pane && pane.querySelector('.today-line');
  if (!line || pane.scrollLeft > 0) return;
  const area = line.parentElement;
  const offset = line.getBoundingClientRect().left - area.getBoundingClientRect().left;
  pane.scrollLeft = Math.max(0, offset - Math.min(80, area.clientWidth * 0.15));
}

// ── STATUS CHIPS ────────────────────────────────────────────────
// A task's status as a coloured chip with a text label and icon (so it
// never relies on colour alone). Tapping it opens a three-way menu right
// there, one tap to change instead of a native dropdown each time.
const STATUS_CHIP = {
  'Not Started': { icon: '○', label: 'To do', cls: 'is-todo' },
  'In Progress': { icon: '◐', label: 'Doing', cls: 'is-doing' },
  'Completed':   { icon: '✓', label: 'Done',  cls: 'is-done' },
};
const PRIORITY_CHIP = {
  High:   { icon: '●', label: 'High',   cls: 'is-high' },
  Medium: { icon: '●', label: 'Medium', cls: 'is-medium' },
  Low:    { icon: '●', label: 'Low',    cls: 'is-low' },
};
const CHIP_SETS = { status: STATUS_CHIP, priority: PRIORITY_CHIP };
// ctx says where the chip lives, so the change goes through the right
// page's updater: '' or 'kanban' (Planner) or a project id (project table).
function chipHTML(kind, t, canEdit, ctx = '') {
  const current = kind === 'status' ? t.status : t.priority;
  const c = CHIP_SETS[kind][current] || Object.values(CHIP_SETS[kind])[0];
  const word = kind === 'status' ? 'Status' : 'Priority';
  return `<button type="button" class="status-chip ${c.cls}" ${canEdit ? `onclick="event.stopPropagation(); openChipMenu(this, '${kind}', '${t.id}', '${current}', '${ctx}')" aria-haspopup="menu"` : 'disabled'}
    title="${current}${canEdit ? ' (tap to change)' : ''}" aria-label="${word}: ${current}${canEdit ? '. Change ' + word.toLowerCase() : ''}"><span aria-hidden="true">${emojiIcon(c.icon)}</span>${c.label}</button>`;
}
function statusChipHTML(t, canEdit, ctx = '') { return chipHTML('status', t, canEdit, ctx); }
function priorityChipHTML(t, canEdit, ctx = '') { return chipHTML('priority', t, canEdit, ctx); }
function closeStatusMenu() { document.getElementById('status-menu')?.remove(); }
function openStatusMenu(btn, taskId, current, ctx = '') { openChipMenu(btn, 'status', taskId, current, ctx); }
function openChipMenu(btn, kind, taskId, current, ctx = '') {
  closeStatusMenu();
  const menu = document.createElement('div');
  menu.id = 'status-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', kind === 'status' ? 'Change status' : 'Change priority');
  menu.innerHTML = Object.entries(CHIP_SETS[kind]).map(([value, c]) =>
    `<button type="button" role="menuitemradio" aria-checked="${value === current}" class="status-chip ${c.cls} ${value === current ? 'is-current' : ''}" data-value="${value}"><span aria-hidden="true">${emojiIcon(c.icon)}</span>${value}</button>`).join('');
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const top = r.bottom + menu.offsetHeight + 8 > innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4;
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left)) + 'px';
  menu.addEventListener('click', e => {
    const pick = e.target.closest('[data-value]');
    if (!pick) return;
    closeStatusMenu();
    const v = pick.dataset.value;
    if (v === current) return;
    if (kind === 'priority') updateTaskPriority(taskId, v, ctx);
    else if (ctx && ctx !== 'kanban') updateTaskStatus(taskId, v, ctx);
    else updateGanttTaskStatus(taskId, v);
  });
  menu.querySelector('[aria-checked="true"]')?.focus();
  setTimeout(() => document.addEventListener('click', closeStatusMenu, { once: true }), 0);
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeStatusMenu(); btn.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      e.preventDefault();
    }
  });
}
window.addEventListener('scroll', closeStatusMenu, true);

// ── GANTT DEPENDENCY ARROWS ───────────────────────────────────────
// Finish-to-start arrows, MS Project style: from the end of each
// predecessor's bar to the start of the task that waits on it, drawn on an
// SVG layer behind the bars. Red while the predecessor isn't done yet.
function drawGanttDependencies() {
  const rows = document.getElementById('gantt-rows');
  if (!rows) return;
  rows.querySelectorAll('.gantt-dep-layer').forEach(l => l.remove());
  const tasks = (APP.ganttTasks || []).filter(t => (t.predecessors || []).length);
  if (!tasks.length) return;
  const box = rows.getBoundingClientRect();
  const markerOf = id => {
    const row = rows.querySelector(`.gantt-grid-row[data-task-id="${id}"]`);
    return row && row.querySelector('.gantt-bar, .gantt-milestone');
  };
  const paths = [];
  tasks.forEach(t => t.predecessors.forEach(p => {
    const a = markerOf(p.id), b = markerOf(t.id);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x1 = ra.right - box.left, y1 = ra.top + ra.height / 2 - box.top;
    const x2 = rb.left - box.left, y2 = rb.top + rb.height / 2 - box.top;
    const out = x1 + 8, back = x2 - 8;
    const midY = y2 > y1 ? rb.top - box.top - 4 : rb.bottom - box.top + 4;
    const d = back >= out
      ? `M ${x1} ${y1} H ${out} V ${y2} H ${x2 - 1}`
      : `M ${x1} ${y1} H ${out} V ${midY} H ${back} V ${y2} H ${x2 - 1}`;
    paths.push(`<path d="${d}" class="${p.status === 'Completed' ? 'gantt-dep-done' : 'gantt-dep-waiting'}" marker-end="url(#gantt-dep-arrow-${p.status === 'Completed' ? 'done' : 'waiting'})"><title>${esc(p.title)} → ${esc(t.title)}</title></path>`);
  }));
  if (!paths.length) return;
  rows.insertAdjacentHTML('beforeend', `<svg class="gantt-dep-layer" width="${rows.scrollWidth}" height="${rows.scrollHeight}" aria-hidden="true">
    <defs>
      <marker id="gantt-dep-arrow-done" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#64748b"/></marker>
      <marker id="gantt-dep-arrow-waiting" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#f59e0b"/></marker>
    </defs>${paths.join('')}</svg>`);
}
window.addEventListener('resize', () => { if (APP.currentPage === 'gantt') requestAnimationFrame(drawGanttDependencies); });

// ── GANTT DRAG-TO-MOVE / RESIZE ───────────────────────────────────
let ganttDrag = null;

function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function ganttBarMouseDown(e, taskId, mode) {
  e.preventDefault();
  e.stopPropagation();
  const totalDays = parseFloat(document.getElementById('gantt-rows').dataset.totalDays);
  const barEl  = mode === 'milestone' ? e.currentTarget : e.currentTarget.closest('.gantt-bar');
  const areaEl = barEl.closest('.gantt-bar-area');

  ganttDrag = {
    taskId, mode, totalDays,
    startX: e.clientX,
    moved: 0,
    areaWidth: areaEl.getBoundingClientRect().width,
    origLeftPct: parseFloat(barEl.style.left),
    origWidthPct: mode === 'milestone' ? 0 : parseFloat(barEl.style.width),
    barEl,
  };
  document.addEventListener('mousemove', ganttMouseMove);
  document.addEventListener('mouseup', ganttMouseUp);
}

// Dragging a folder's summary bar shifts every task directly in that
// project by the same number of days — a bulk move, since most imported
// goals only have a due date and the individual diamonds are small,
// fiddly targets.
function ganttSummaryMouseDown(e, groupId) {
  e.preventDefault();
  e.stopPropagation();
  const totalDays = parseFloat(document.getElementById('gantt-rows').dataset.totalDays);
  const barEl  = e.currentTarget;
  const areaEl = barEl.closest('.gantt-bar-area');
  const capEls = [...areaEl.querySelectorAll('.gantt-summary-cap')];

  ganttDrag = {
    mode: 'summary', groupId, totalDays,
    startX: e.clientX,
    moved: 0,
    areaWidth: areaEl.getBoundingClientRect().width,
    origLeftPct: parseFloat(barEl.style.left),
    barEl,
    capEls,
    capOrigLeft: capEls.map(el => parseFloat(el.style.left)),
  };
  document.addEventListener('mousemove', ganttMouseMove);
  document.addEventListener('mouseup', ganttMouseUp);
}

function ganttMouseMove(e) {
  if (!ganttDrag) return;
  const d = ganttDrag;
  const deltaX = e.clientX - d.startX;
  d.moved = Math.max(d.moved, Math.abs(deltaX));
  const deltaPct   = (deltaX / d.areaWidth) * 100;
  const minWidthPct = 100 / d.totalDays;

  if (d.mode === 'move' || d.mode === 'milestone') {
    d.barEl.style.left = (d.origLeftPct + deltaPct) + '%';
  } else if (d.mode === 'resize-left') {
    const maxLeft = d.origLeftPct + d.origWidthPct - minWidthPct;
    const newLeft = Math.min(maxLeft, d.origLeftPct + deltaPct);
    d.barEl.style.left  = newLeft + '%';
    d.barEl.style.width = (d.origWidthPct - (newLeft - d.origLeftPct)) + '%';
  } else if (d.mode === 'resize-right') {
    d.barEl.style.width = Math.max(minWidthPct, d.origWidthPct + deltaPct) + '%';
  } else if (d.mode === 'summary') {
    d.barEl.style.left = (d.origLeftPct + deltaPct) + '%';
    d.capEls.forEach((el, i) => { el.style.left = (d.capOrigLeft[i] + deltaPct) + '%'; });
  }
}

async function ganttMouseUp(e) {
  document.removeEventListener('mousemove', ganttMouseMove);
  document.removeEventListener('mouseup', ganttMouseUp);
  if (!ganttDrag) return;
  const d = ganttDrag;
  ganttDrag = null;

  // Negligible movement means this was a click, not a drag — edit instead
  // (a summary bar has no single task to edit, so a plain click does nothing).
  if (d.moved < 4) { if (d.mode !== 'summary') editTask(d.taskId); return; }

  const deltaDays = Math.round(((e.clientX - d.startX) / d.areaWidth) * d.totalDays);
  if (deltaDays === 0) { renderGantt(); return; }

  if (d.mode === 'summary') {
    try {
      const allTasks = await API.getTasks();
      const groupTasks = allTasks.filter(t => t.projectId === d.groupId);
      let lastError = null;
      for (const t of groupTasks) {
        const patch = {};
        if (t.startDate) patch.startDate = addDaysToDateStr(t.startDate, deltaDays);
        if (t.endDate)   patch.endDate   = addDaysToDateStr(t.endDate, deltaDays);
        if (!Object.keys(patch).length) continue;
        try { await API.updateTask(t.id, patch); } catch (err) { lastError = err.message; }
      }
      if (lastError) showToast('❌ ' + lastError, 'error');
      else showToast(`✅ Shifted ${groupTasks.length} task${groupTasks.length === 1 ? '' : 's'}`);
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    }
    renderGantt();
    return;
  }

  try {
    const task = await API.getTask(d.taskId);
    const patch = {};
    if (d.mode === 'move') {
      patch.startDate = addDaysToDateStr(task.startDate, deltaDays);
      patch.endDate   = addDaysToDateStr(task.endDate, deltaDays);
    } else if (d.mode === 'resize-left') {
      patch.startDate = addDaysToDateStr(task.startDate, deltaDays);
    } else if (d.mode === 'resize-right') {
      patch.endDate = addDaysToDateStr(task.endDate, deltaDays);
    } else if (d.mode === 'milestone') {
      patch.endDate = addDaysToDateStr(task.endDate, deltaDays);
    }
    await API.updateTask(d.taskId, patch);
    showToast('✅ Dates updated');
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
  renderGantt();
}

// Manual drag-to-reorder of task rows within one project group. Kept
// separate from ganttDrag above since it moves whole DOM rows by index
// rather than repositioning a bar by percentage — different enough
// mechanics that sharing one state object would just add branching.
let ganttRowDrag = null;

function ganttRowMouseDown(e, taskId, projectId, groupId) {
  e.preventDefault();
  e.stopPropagation();
  const rowEl = e.currentTarget.closest('.gantt-grid-row');
  ganttRowDrag = { taskId, projectId, groupId, rowEl, dropTarget: null, dropPos: null };
  rowEl.classList.add('gantt-row-dragging');
  document.addEventListener('mousemove', ganttRowMouseMove);
  document.addEventListener('mouseup', ganttRowMouseUp);
}

function ganttRowMouseMove(e) {
  const d = ganttRowDrag;
  if (!d) return;
  document.querySelectorAll('.gantt-drop-above, .gantt-drop-below').forEach(r => r.classList.remove('gantt-drop-above', 'gantt-drop-below'));

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const targetRow = el && el.closest(`.gantt-grid-row[data-group="${d.groupId}"][data-task-id]`);
  if (!targetRow || targetRow === d.rowEl) { d.dropTarget = null; return; }

  const rect = targetRow.getBoundingClientRect();
  const isAbove = e.clientY < rect.top + rect.height / 2;
  targetRow.classList.add(isAbove ? 'gantt-drop-above' : 'gantt-drop-below');
  d.dropTarget = targetRow;
  d.dropPos = isAbove ? 'above' : 'below';
}

async function ganttRowMouseUp() {
  document.removeEventListener('mousemove', ganttRowMouseMove);
  document.removeEventListener('mouseup', ganttRowMouseUp);
  const d = ganttRowDrag;
  ganttRowDrag = null;
  if (!d) return;

  d.rowEl.classList.remove('gantt-row-dragging');
  document.querySelectorAll('.gantt-drop-above, .gantt-drop-below').forEach(r => r.classList.remove('gantt-drop-above', 'gantt-drop-below'));
  if (!d.dropTarget) return; // dropped outside any row in the same group — leave order unchanged

  if (d.dropPos === 'above') d.dropTarget.parentNode.insertBefore(d.rowEl, d.dropTarget);
  else d.dropTarget.parentNode.insertBefore(d.rowEl, d.dropTarget.nextSibling);

  const orderedIds = [...document.querySelectorAll(`.gantt-grid-row[data-group="${d.groupId}"][data-task-id]`)].map(r => r.dataset.taskId);
  try {
    await API.reorderTasks(d.projectId, orderedIds);
  } catch (err) {
    showToast('❌ ' + (err.message || 'Failed to save new order'), 'error');
  }
  renderGantt();
}
