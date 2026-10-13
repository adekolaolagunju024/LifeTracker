// Waypoint app, part 5 of 12: Actions and the calendar.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── ACTIONS — a live feed, not a maintained list ──────────────────
// Nothing here is stored separately: it's computed fresh from real tasks
// across every project every time the page opens, so there's nothing to
// keep in sync by hand.
const PRI_BADGE = {
  High:   'bg-orange-100 text-orange-700',
  Medium: 'bg-yellow-100 text-yellow-700',
  Low:    'bg-green-100 text-green-700',
};

async function renderActions() {
  try {
    const [tasks, projects] = await Promise.all([API.getTasks(), API.getProjects()]);
    const projectById = Object.fromEntries(projects.map(p => [p.id, p]));

    // String-compared local date keys, not raw Date objects — endDate/
    // startDate are plain "YYYY-MM-DD" strings that new Date() parses as
    // UTC midnight, a different instant from local midnight in any
    // non-UTC timezone, which can put a task in the wrong bucket by a day.
    const todayKey = localDateKey(new Date());
    const weekAheadKey = localDateKey(new Date(Date.now() + 7 * 86400000));

    const overdue = [], dueThisWeek = [], startingThisWeek = [], highPriority = [], blocked = [];
    tasks.forEach(t => {
      if (t.status === 'Completed') return;
      // Blocked is its own lens too: anything with a blocker still standing
      // or a predecessor not finished yet, so what's stopping work is in
      // one place instead of discovered when you try to tick a task off.
      if (pendingFoes(t) || waitingOn(t).length) blocked.push(t);
      const dueKey = t.endDate ? t.endDate.slice(0, 10) : null;
      // Overdue/Due This Week/Starting This Week stay mutually exclusive with
      // each other, but High Priority is an independent lens, not a leftover
      // bucket — a task that's In Progress + High shows here even if it's
      // already flagged as due or starting soon above.
      if (dueKey && dueKey < todayKey) {
        overdue.push(t);
      } else if (dueKey && dueKey <= weekAheadKey) {
        dueThisWeek.push(t);
      } else {
        const startKey = t.startDate ? t.startDate.slice(0, 10) : null;
        if (startKey && startKey >= todayKey && startKey <= weekAheadKey) startingThisWeek.push(t);
      }
      if (t.status === 'In Progress' && t.priority === 'High') highPriority.push(t);
    });
    overdue.sort((a, b) => a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0);
    dueThisWeek.sort((a, b) => a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0);
    startingThisWeek.sort((a, b) => a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0);
    highPriority.sort((a, b) => a.title.localeCompare(b.title));
    blocked.sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'));

    document.getElementById('act-overdue').textContent  = overdue.length;
    document.getElementById('act-week').textContent     = dueThisWeek.length;
    document.getElementById('act-starting').textContent = startingThisWeek.length;
    document.getElementById('act-high').textContent     = highPriority.length;
    document.getElementById('act-blocked').textContent  = blocked.length;

    const row = (t, reason) => {
      const proj = projectById[t.projectId];
      const canEdit = proj && (proj.role === 'owner' || proj.role === 'editor');
      const stuck = pendingFoes(t) > 0;
      const waiting = waitingOn(t);
      return `
        <div class="flex items-start gap-3 px-5 py-4 border-b border-gray-100 hover:bg-gray-50 transition-all">
          <button type="button" class="w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${stuck ? 'border-red-200 bg-red-50 text-[10px] cursor-not-allowed' : 'border-gray-300 hover:border-teal hover:bg-teal/10'}"
            onclick="markActionDone('${t.id}')" title="${stuck ? 'Clear its blockers first' : 'Mark as completed'}" aria-label="${stuck ? 'Blocked: clear its blockers first' : 'Mark ' + esc(t.title) + ' as completed'}">${stuck ? icon('lock', 'tiny text-red-500') : ''}</button>
          <div class="flex-1 min-w-0">
            <h5 class="text-sm font-semibold text-navy cursor-pointer hover:text-teal truncate" onclick="openTaskDetail('${t.id}')">${esc(t.title)}</h5>
            <p class="text-xs text-gray-400 mt-0.5 truncate">${proj ? emojiIcon(proj.icon) + ' ' + esc(proj.title) : ''}${reason ? ' · ' + reason : ''}</p>
            ${waiting.length ? `<p class="text-xs font-semibold text-amber-700 mt-1">${icon('link', 'tiny mr-1')}Waiting on ${waiting.map(p => `"${esc(p.title)}"`).join(', ')}</p>` : ''}
            ${stuck ? `<p class="text-xs font-bold text-red-700 mt-1.5">${icon('blocker', 'tiny mr-1')}Blocked by:</p>${blockerChecklist(t, canEdit, 'board')}` : ''}
          </div>
          <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${PRI_BADGE[t.priority] || 'bg-gray-100 text-gray-500'}">${esc(t.priority)}</span>
            <span data-reminder-slot="${t.id}">${window.Reminders ? Reminders.chip(t.id) : ''}</span>
            ${window.Reminders && !Reminders.forTask(t.id) ? `<button type="button" onclick="Reminders.openSheet('${t.id}')" class="text-xs font-semibold text-gray-400 hover:text-teal" title="Ring me about this task at a set time" aria-label="Set a reminder for ${esc(t.title)}">${icon('alarm', 'mr-0.5')}Remind</button>` : ''}
          </div>
        </div>`;
    };

    // A section with nothing in it shrinks to a single quiet line, so the
    // lists that do need attention aren't pushed down the page.
    const section = (title, ic, items, reasonFn, emptyMsg) => items.length ? `
      <div class="mb-6">
        <div class="flex items-center gap-2 mb-3">
          <div class="w-1 h-4 bg-teal rounded-full"></div>
          <h3 class="text-sm font-bold text-navy-2 flex items-center gap-1.5">${ic} ${title} <span class="text-gray-400 font-semibold">${items.length}</span></h3>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          ${items.map(t => row(t, reasonFn(t))).join('')}
        </div>
      </div>` : `
      <div class="mb-2 flex items-center gap-2 px-4 py-2.5 bg-white/60 rounded-lg border border-dashed border-gray-200 text-xs text-gray-400">
        <span class="flex">${ic}</span><span class="font-semibold text-gray-500">${title}</span><span class="ml-auto">${emptyMsg}</span>
      </div>`;

    // Both sides parsed the same way (UTC midnight for the calendar date,
    // ignoring the local offset entirely) so the day count itself can't
    // drift a day off depending on timezone, even though it's built from
    // the same local-date keys used for bucketing above.
    const daysBetweenKeys = (fromKey, toKey) => Math.round((new Date(toKey + 'T00:00:00Z') - new Date(fromKey + 'T00:00:00Z')) / 86400000);

    if (!overdue.length && !dueThisWeek.length && !startingThisWeek.length && !highPriority.length && !blocked.length) {
      document.getElementById('action-list').innerHTML = `
        <div class="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
          <p class="mb-2 text-teal flex justify-center">${icon('party', 'w-9 h-9')}</p>
          <h3 class="text-base font-bold text-navy">You're all caught up</h3>
          <p class="text-sm text-gray-500 mt-1">Nothing overdue, nothing due or starting in the next 7 days, and no high-priority work in progress.</p>
        </div>`;
      return;
    }
    document.getElementById('action-list').innerHTML =
      section('Overdue', icon('overdue', 'text-red-600'), overdue, t => {
        const days = daysBetweenKeys(t.endDate.slice(0, 10), todayKey);
        return `${days} day${days === 1 ? '' : 's'} overdue`;
      }, 'Nothing overdue') +
      section('Blocked', icon('blocker', 'text-red-700'), blocked, t => {
        const n = pendingFoes(t);
        return n ? `${n} blocker${n === 1 ? '' : 's'} in the way` : 'Waiting on another task';
      }, 'Nothing blocked') +
      section('Due This Week', icon('clock', 'text-amber-600'), dueThisWeek, t => {
        const days = daysBetweenKeys(todayKey, t.endDate.slice(0, 10));
        return days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`;
      }, 'Nothing due this week') +
      section('Starting This Week', icon('start', 'text-teal'), startingThisWeek, t => {
        const days = daysBetweenKeys(todayKey, t.startDate.slice(0, 10));
        return days === 0 ? 'Starts today' : `Starts in ${days} day${days === 1 ? '' : 's'}`;
      }, 'Nothing starting this week') +
      section('High Priority — In Progress', icon('star', 'text-amber-500'), highPriority, () => '', 'No high-priority tasks in progress');

  } catch (e) { console.error('Actions error:', e); }
}

async function markActionDone(taskId) {
  try { await API.updateTask(taskId, { status: 'Completed' }); } catch (e) { taskErrorToast(e); return; }
  renderActions();
  showToast('✅ Marked as done');
}

// ── PLAN IT FOR ME ──────────────────────────────────────────────
// One assistant for everything: the ask goes into the same conversation,
// where the order it suggests can be acted on straight away.
function planActionsWithAssistant() {
  paletteAsk('Look at my open tasks and blockers and give me a short order to do them in today, with the next step for each.');
}

// ── CALENDAR ─────────────────────────────────────────────────────
// Month/Week/Year views of every task by due date, with drag-to-reschedule
// (same manual mouse+touch ghost-drag pattern as Kanban's drag-to-status,
// dropping onto a day cell instead of a status column).
const CALENDAR_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CALENDAR_MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function setCalendarViewMode(mode) {
  APP.calendarViewMode = mode;
  try { localStorage.setItem('calendarViewMode', mode); } catch { /* private mode etc */ }
  APP.calendarExpandedDays = new Set();
  renderCalendar();
}

function changeCalendarPeriod(delta) {
  const d = APP.calendarDate || new Date();
  if (APP.calendarViewMode === 'week') {
    APP.calendarDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * 7);
  } else if (APP.calendarViewMode === 'year') {
    APP.calendarDate = new Date(d.getFullYear() + delta, d.getMonth(), 1);
  } else {
    APP.calendarDate = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  }
  APP.calendarExpandedDays = new Set();
  renderCalendar();
}

function goToCalendarToday() {
  APP.calendarDate = new Date();
  APP.calendarExpandedDays = new Set();
  renderCalendar();
}

function setCalendarProjectFilter(id) {
  saveProjectFilter(id);
  renderCalendar();
}

function expandCalendarDay(dateKey) {
  APP.calendarExpandedDays.add(dateKey);
  renderCalendar();
}

// Jumps into Month view centered on a specific date — used by Year view's
// day cells, which are too small to show tasks directly.
function jumpToCalendarMonth(dateKey) {
  APP.calendarDate = new Date(dateKey);
  setCalendarViewMode('month');
}

// Opens the usual Add Task modal with the clicked day pre-filled as the
// due date, rather than building a separate calendar-specific form.
async function openAddTaskWithDueDate(dateKey) {
  await openAddTask(APP.calendarProjectFilter || undefined);
  document.getElementById('task-end').value = dateKey;
}

// Weeks start on Monday (UK, Europe and most of the world) unless the
// browser's locale is one where Sunday comes first.
const CALENDAR_WEEK_START = /^(en-(US|CA|PH)|pt-BR|ja|ko|zh-TW|he)/i.test(navigator.language || '') ? 0 : 1;
const CALENDAR_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOffset = d => (d.getDay() - CALENDAR_WEEK_START + 7) % 7;
function renderCalendarWeekdayHeader() {
  const head = document.getElementById('calendar-weekday-header');
  if (!head || head.dataset.start === String(CALENDAR_WEEK_START)) return;
  head.dataset.start = String(CALENDAR_WEEK_START);
  head.innerHTML = [0, 1, 2, 3, 4, 5, 6].map(i => `<div class="px-2 py-2 text-center text-xs font-bold text-gray-500">${CALENDAR_WEEKDAYS[(i + CALENDAR_WEEK_START) % 7]}</div>`).join('');
}

function buildCalendarMonthCells(year, month) {
  const pad = n => String(n).padStart(2, '0');
  renderCalendarWeekdayHeader();
  const startWeekday    = weekdayOffset(new Date(year, month, 1)); // days shown from the month before
  const daysInMonth     = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = startWeekday - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, dateKey: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, dateKey: `${year}-${pad(month + 1)}-${pad(d)}` });
  // Trailing/padding cells round the grid out to full weeks, and always to
  // 6 rows so the page doesn't jump height between a 4-week and 6-week month.
  while (cells.length < 42) cells.push({ day: cells.length - (startWeekday + daysInMonth) + 1, dateKey: null });
  return cells;
}

function buildCalendarWeekCells(anchorDate) {
  const pad = n => String(n).padStart(2, '0');
  const start = new Date(anchorDate);
  start.setDate(start.getDate() - weekdayOffset(start));
  renderCalendarWeekdayHeader();
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ day: d.getDate(), dateKey: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, monthAbbr: CALENDAR_MONTH_ABBR[d.getMonth()] });
  }
  return cells;
}

// Shared by Month and Week views — Year view's cells are too small for
// this (no pills, no drag) and get their own compact renderer below.
function renderCalendarDayCell(cell, byDate, todayKey, opts) {
  const { cap, minHeight, showMonthAbbr } = opts;
  const otherMonth = !cell.dateKey;
  const isToday = cell.dateKey === todayKey;
  const dayTasks = cell.dateKey ? (byDate[cell.dateKey] || []) : [];
  const expanded = cell.dateKey && APP.calendarExpandedDays.has(cell.dateKey);
  const visible = expanded ? dayTasks : dayTasks.slice(0, cap);
  const hiddenCount = dayTasks.length - visible.length;

  const pills = visible.map(t => {
    const overdue = t.status !== 'Completed' && cell.dateKey < todayKey;
    const color = PRIORITY_BORDER[t.priority] || '#D1D5DB';
    return `<div onmousedown="calendarTaskMouseDown(event,'${t.id}','${cell.dateKey}')" ontouchstart="calendarTaskMouseDown(event,'${t.id}','${cell.dateKey}')"
      onclick="event.stopPropagation(); openTaskDetail('${t.id}')" title="${esc(t.title)} — drag to reschedule"
      class="text-[10px] font-semibold px-1.5 py-0.5 rounded truncate cursor-grab active:cursor-grabbing ${t.status === 'Completed' ? 'line-through opacity-50' : ''}"
      style="background:${color}22;color:${overdue ? '#DC2626' : color}">${overdue ? icon('overdue', 'tiny mr-0.5') : ''}${esc(t.title)}</div>`;
  }).join('');
  const moreLink = hiddenCount > 0
    ? `<button onclick="event.stopPropagation(); expandCalendarDay('${cell.dateKey}')" class="text-[10px] text-teal font-semibold hover:underline">+${hiddenCount} more</button>`
    : '';
  const dayLabel = showMonthAbbr ? `${cell.monthAbbr} ${cell.day}` : cell.day;

  return `
    <div class="calendar-day-cell border-b border-r border-gray-100 p-1.5 ${otherMonth ? 'bg-gray-50/60' : ''} ${cell.dateKey ? 'cursor-pointer hover:bg-teal/5' : ''}"
      style="min-height:${minHeight}" data-date-key="${cell.dateKey || ''}"
      ${cell.dateKey ? `onclick="openAddTaskWithDueDate('${cell.dateKey}')" title="Add a task due this day"` : ''}>
      <p class="text-xs font-semibold mb-1 ${otherMonth ? 'text-gray-300' : isToday ? 'inline-flex items-center justify-center px-1.5 h-5 rounded-full bg-teal text-white' : 'text-gray-500'}">${dayLabel}</p>
      <div class="space-y-0.5">${pills}${moreLink}</div>
    </div>`;
}

// Phones: a task title can't fit in a seventh of the screen, so Month and
// Week show a dot per task (red when overdue, else the priority colour)
// and tapping a day lists its tasks under the grid (renderCalendarAgenda).
const calendarCompact = () => window.matchMedia('(max-width: 639px)').matches;
function renderCalendarDotCell(cell, byDate, todayKey, minHeight) {
  const otherMonth = !cell.dateKey;
  const isToday = cell.dateKey === todayKey;
  const selected = cell.dateKey && cell.dateKey === APP.calendarSelectedDay;
  const dayTasks = cell.dateKey ? (byDate[cell.dateKey] || []) : [];
  const dots = dayTasks.slice(0, 4).map(t => {
    const overdue = t.status !== 'Completed' && cell.dateKey < todayKey;
    const color = overdue ? '#DC2626' : (PRIORITY_BORDER[t.priority] || '#9CA3AF');
    return `<span class="w-1.5 h-1.5 rounded-full ${t.status === 'Completed' ? 'opacity-40' : ''}" style="background:${color}"></span>`;
  }).join('') + (dayTasks.length > 4 ? '<span class="text-[9px] leading-none text-gray-400 font-bold">+</span>' : '');
  return `
    <div class="calendar-day-cell border-b border-r border-gray-100 flex flex-col items-center pt-1.5 gap-1 ${otherMonth ? 'bg-gray-50/60' : 'cursor-pointer'} ${selected ? 'bg-teal/10' : ''}"
      style="min-height:${minHeight}" data-date-key="${cell.dateKey || ''}"
      ${cell.dateKey ? `onclick="selectCalendarDay('${cell.dateKey}')" aria-label="${cell.dateKey}: ${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'}"` : ''}>
      <span class="text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${otherMonth ? 'text-gray-300' : isToday ? 'bg-teal text-white' : selected ? 'text-teal ring-1 ring-teal' : 'text-gray-600'}">${cell.day}</span>
      <div class="flex flex-wrap justify-center gap-0.5 px-0.5">${dots}</div>
    </div>`;
}
function selectCalendarDay(dateKey) {
  APP.calendarSelectedDay = dateKey;
  renderCalendar();
}
function renderCalendarAgenda(byDate, todayKey, visibleKeys) {
  const box = document.getElementById('calendar-agenda');
  if (!box) return;
  // keep the picked day while it's on screen; otherwise today, else the
  // first day with something due, else the first day shown
  if (!visibleKeys.includes(APP.calendarSelectedDay)) {
    APP.calendarSelectedDay = visibleKeys.includes(todayKey) ? todayKey
      : visibleKeys.find(k => (byDate[k] || []).length) || visibleKeys[0];
  }
  const key = APP.calendarSelectedDay;
  const d = new Date(key + 'T00:00:00');
  const label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const items = byDate[key] || [];
  box.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-bold text-navy">${label}</h3>
      <button onclick="openAddTaskWithDueDate('${key}')" class="text-xs font-semibold text-teal bg-teal/10 hover:bg-teal/20 px-3 py-1.5 rounded-lg">+ Add task</button>
    </div>
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      ${items.length ? items.map(t => {
        const overdue = t.status !== 'Completed' && key < todayKey;
        return `
        <button onclick="openTaskDetail('${t.id}')" class="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 text-left hover:bg-gray-50">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${overdue ? '#DC2626' : (PRIORITY_BORDER[t.priority] || '#9CA3AF')}"></span>
          <span class="flex-1 min-w-0 text-sm font-semibold text-navy truncate ${t.status === 'Completed' ? 'line-through opacity-50' : ''}">${esc(t.title)}</span>
          <span class="text-[11px] font-semibold flex-shrink-0 ${overdue ? 'text-red-600' : 'text-gray-400'}">${overdue ? 'Overdue' : esc(t.status)}</span>
        </button>`;
      }).join('') : '<p class="px-4 py-6 text-center text-sm text-gray-400">Nothing due this day.</p>'}
    </div>`;
}
window.matchMedia('(max-width: 639px)').addEventListener('change', () => { if (APP.currentPage === 'calendar') renderCalendar(); });

// Compact read-only day cell for Year view's 12 mini-calendars — just a
// number and a dot if anything's due, since there's no room for titles.
function renderCalendarMiniCell(cell, byDate, todayKey) {
  const otherMonth = !cell.dateKey;
  const isToday = cell.dateKey === todayKey;
  const dayTasks = cell.dateKey ? (byDate[cell.dateKey] || []) : [];
  const hasOverdue = dayTasks.some(t => t.status !== 'Completed' && cell.dateKey < todayKey);
  const dot = dayTasks.length ? `<span class="block w-1 h-1 rounded-full mx-auto mt-0.5" style="background:${hasOverdue ? '#DC2626' : '#0A7E8C'}"></span>` : '';
  return `
    <div class="text-center py-1 ${cell.dateKey ? 'cursor-pointer hover:bg-teal/10 rounded' : ''}"
      ${cell.dateKey ? `onclick="jumpToCalendarMonth('${cell.dateKey}')" title="${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'} due"` : ''}>
      <span class="text-[10px] ${otherMonth ? 'text-gray-300' : isToday ? 'font-bold text-teal' : 'text-gray-600'}">${cell.day}</span>
      ${dot}
    </div>`;
}

async function loadCalendarData() {
  if (!APP.calendarDate) APP.calendarDate = new Date();
  if (!APP.calendarViewMode) {
    try { APP.calendarViewMode = localStorage.getItem('calendarViewMode') || 'month'; } catch { APP.calendarViewMode = 'month'; }
  }
  if (APP.calendarProjectFilter === undefined) APP.calendarProjectFilter = savedProjectFilter();
  if (!APP.calendarExpandedDays) APP.calendarExpandedDays = new Set();

  const [tasks, projects] = await Promise.all([API.getTasks(), API.getProjects()]);

  APP.calendarProjectFilter = validProjectFilter(APP.calendarProjectFilter, projects);
  document.getElementById('calendar-project-filter').innerHTML = projectOptionsHTML(projects, APP.calendarProjectFilter, 'All Projects');
  const allowedIds = projectScope(projects, APP.calendarProjectFilter);

  const byDate = {};
  tasks.filter(t => t.endDate && (!allowedIds || allowedIds.has(t.projectId))).forEach(t => {
    const key = t.endDate.slice(0, 10);
    (byDate[key] = byDate[key] || []).push(t);
  });
  return { byDate, todayKey: localDateKey(new Date()) };
}

async function renderCalendar() {
  if (window.PlannerKey) PlannerKey.paint('calendar');
  try {
    const { byDate, todayKey } = await loadCalendarData();
    document.querySelectorAll('.calendar-view-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === APP.calendarViewMode));

    const isYear = APP.calendarViewMode === 'year';
    document.getElementById('calendar-weekday-header').classList.toggle('hidden', isYear);
    document.getElementById('calendar-grid').classList.toggle('grid-cols-7', !isYear);
    document.getElementById('calendar-subtitle').textContent = isYear
      ? 'Every task with a due date. Click a day to jump into its month.'
      : 'Every task with a due date. Drag a task onto another day to reschedule it.';

    const compact = calendarCompact() && !isYear;
    document.getElementById('calendar-agenda').classList.toggle('hidden', !compact);
    if (APP.calendarViewMode === 'week') {
      const cells = buildCalendarWeekCells(APP.calendarDate);
      const first = cells[0], last = cells[6];
      document.getElementById('calendar-month-label').textContent =
        first.monthAbbr === last.monthAbbr ? `${first.monthAbbr} ${first.day}–${last.day}` : `${first.monthAbbr} ${first.day} – ${last.monthAbbr} ${last.day}`;
      document.getElementById('calendar-grid').innerHTML = cells
        .map(cell => compact ? renderCalendarDotCell(cell, byDate, todayKey, '64px') : renderCalendarDayCell(cell, byDate, todayKey, { cap: 8, minHeight: '220px', showMonthAbbr: true }))
        .join('');
      if (compact) renderCalendarAgenda(byDate, todayKey, cells.map(c => c.dateKey));

    } else if (APP.calendarViewMode === 'year') {
      const year = APP.calendarDate.getFullYear();
      document.getElementById('calendar-month-label').textContent = String(year);
      document.getElementById('calendar-grid').innerHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
          ${CALENDAR_MONTH_NAMES.map((name, m) => {
            const cells = buildCalendarMonthCells(year, m);
            return `
              <div class="border border-gray-100 rounded-lg p-2">
                <button onclick="jumpToCalendarMonth('${year}-${String(m + 1).padStart(2, '0')}-01')" class="text-xs font-bold text-navy hover:text-teal mb-1.5">${name}</button>
                <div class="grid grid-cols-7 gap-0.5">${cells.map(c => renderCalendarMiniCell(c, byDate, todayKey)).join('')}</div>
              </div>`;
          }).join('')}
        </div>`;

    } else {
      const year = APP.calendarDate.getFullYear();
      const month = APP.calendarDate.getMonth();
      document.getElementById('calendar-month-label').textContent = `${CALENDAR_MONTH_NAMES[month]} ${year}`;
      const cells = buildCalendarMonthCells(year, month);
      document.getElementById('calendar-grid').innerHTML = cells
        .map(cell => compact ? renderCalendarDotCell(cell, byDate, todayKey, '52px') : renderCalendarDayCell(cell, byDate, todayKey, { cap: 3, minHeight: '92px', showMonthAbbr: false }))
        .join('');
      if (compact) renderCalendarAgenda(byDate, todayKey, cells.filter(c => c.dateKey).map(c => c.dateKey));
    }
  } catch (e) { console.error('Calendar error:', e); }
}

// ── CALENDAR DRAG-TO-RESCHEDULE ──────────────────────────────────
// Same manual mouse+touch ghost-drag pattern as Kanban's drag-to-status —
// dropping a task pill onto a different day cell updates its due date.
let calendarDrag = null;

function calendarTaskMouseDown(e, taskId, currentDateKey) {
  e.preventDefault();
  e.stopPropagation(); // don't also trigger the day cell's "add task" onclick
  const pillEl = e.currentTarget;
  const rect = pillEl.getBoundingClientRect();
  const { x, y } = pointerXY(e);

  const ghost = pillEl.cloneNode(true);
  ghost.classList.add('calendar-task-ghost');
  ghost.removeAttribute('onmousedown');
  ghost.removeAttribute('ontouchstart');
  ghost.removeAttribute('onclick');
  ghost.style.position = 'fixed';
  ghost.style.width = rect.width + 'px';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.margin = '0';
  document.body.appendChild(ghost);

  calendarDrag = {
    taskId, currentDateKey, ghost, dropDateKey: null,
    grabDX: x - rect.left, grabDY: y - rect.top,
  };
  document.addEventListener('mousemove', calendarMouseMove);
  document.addEventListener('mouseup', calendarMouseUp);
  document.addEventListener('touchmove', calendarMouseMove, { passive: false });
  document.addEventListener('touchend', calendarMouseUp);
  document.addEventListener('touchcancel', calendarMouseUp);
}

function calendarMouseMove(e) {
  const d = calendarDrag;
  if (!d) return;
  if (e.cancelable) e.preventDefault();
  const { x, y } = pointerXY(e);
  d.ghost.style.left = (x - d.grabDX) + 'px';
  d.ghost.style.top = (y - d.grabDY) + 'px';

  document.querySelectorAll('.calendar-day-dragover').forEach(c => c.classList.remove('calendar-day-dragover'));
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest('.calendar-day-cell');
  d.dropDateKey = cell && cell.dataset.dateKey ? cell.dataset.dateKey : null;
  if (cell && d.dropDateKey) cell.classList.add('calendar-day-dragover');
}

async function calendarMouseUp() {
  document.removeEventListener('mousemove', calendarMouseMove);
  document.removeEventListener('mouseup', calendarMouseUp);
  document.removeEventListener('touchmove', calendarMouseMove);
  document.removeEventListener('touchend', calendarMouseUp);
  document.removeEventListener('touchcancel', calendarMouseUp);
  const d = calendarDrag;
  calendarDrag = null;
  if (!d) return;

  d.ghost.remove();
  document.querySelectorAll('.calendar-day-dragover').forEach(c => c.classList.remove('calendar-day-dragover'));

  if (d.dropDateKey && d.dropDateKey !== d.currentDateKey) {
    try {
      await API.updateTask(d.taskId, { endDate: d.dropDateKey });
      showToast('✅ Rescheduled to ' + d.dropDateKey);
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to reschedule'), 'error'); }
    renderCalendar();
  }
}
