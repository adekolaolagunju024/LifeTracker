// Waypoint app, part 1 of 12: Shared state, helpers, colours, badges, task gates and menus.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ═══════════════════════════════════════════════════════════════
// APP.JS — Frontend UI Logic
// All rendering, interactions, modals, Gantt, charts
// Calls API object from api.js — never fetch() directly
// ═══════════════════════════════════════════════════════════════

// ── APP STATE ──────────────────────────────────────────────────
const APP = {
  currentPage: 'dashboard',
  currentProjectId: null,
  filters: { status: '', priority: '', search: '' },
  ganttStart: new Date('2026-05-01'),
  ganttEnd:   new Date('2027-05-31'),
  onboardingStep: 1,
  aiInsights: null,
};
const ONBOARDING_STEPS = 3;

// ── UTILS ──────────────────────────────────────────────────────
const fmt = (n, currency = '£') => currency + Math.round(n).toLocaleString();
// A cost in the currency chosen in Settings (default £).
const money = n => ((APP.profile && APP.profile.currency) || '£') + Number(n).toLocaleString();
const pct = (a, b) => b > 0 ? Math.min(Math.round((a / b) * 100), 100) : 0;
const esc = s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── PRIORITY / STATUS COLORS (Gantt, task table) ─────────────────
const PRIORITY_BORDER = { High: '#DC2626', Medium: '#F59E0B', Low: '#16A34A' };
function priorityBorderColor(p) { return PRIORITY_BORDER[p] || '#9CA3AF'; }
const STATUS_COLOR = { 'Completed': '#16A34A', 'In Progress': '#F97316', 'Not Started': '#9CA3AF' };
function statusColor(s) { return STATUS_COLOR[s] || '#9CA3AF'; }
function tintStyle(color) {
  const isDark = document.documentElement.classList.contains('dark');
  return isDark
    ? `background:${color}2E;border-color:${color}77;color:${color}`
    : `background:${color}17;border-color:${color}55;color:${color}`;
}
function shadeColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  // A leading emoji ("❌ Could not save") becomes the matching line icon.
  const { name, text } = iconFromMessage(msg, type === 'error' ? 'error' : 'done');
  t.innerHTML = `${icon(name)}<span></span>`;
  t.lastElementChild.textContent = text;
  t.classList.toggle('is-error', type === 'error');
  t.style.background = type === 'error' ? '#B03020' : '#0D1B2A';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// A toast with an Undo button, for actions that are easy to take back
// (deleting goes to Trash, so Undo just restores). Stays 8 seconds; a
// newer one replaces it.
let _undoTimer = null;
function showUndoToast(msg, undo, label = 'Undo') {
  let bar = document.getElementById('undo-toast');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'undo-toast';
    bar.setAttribute('role', 'status');
    bar.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-[1004] flex items-center gap-3 bg-navy text-white text-sm font-medium pl-4 pr-2 py-2 rounded-xl shadow-2xl max-w-[92vw]';
    document.body.appendChild(bar);
  }
  const { name, text } = iconFromMessage(msg, 'trash');
  bar.innerHTML = `${icon(name)}<span class="min-w-0 truncate"></span><button type="button" class="flex-shrink-0 bg-white/10 hover:bg-white/20 text-teal-300 font-bold text-xs uppercase tracking-wide px-3 py-1.5 rounded-lg"></button>`;
  bar.children[1].textContent = text;
  bar.lastElementChild.textContent = label;
  const hide = () => { clearTimeout(_undoTimer); bar.remove(); };
  bar.lastElementChild.onclick = async () => {
    hide();
    try { await undo(); if (label === 'Undo') showToast('↩️ Undone'); } catch (e) { showToast('❌ ' + (e.message || 'Could not undo'), 'error'); }
  };
  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(hide, 8000);
}
// The same bar with any action ("Start"), for a quick yes; ignoring it is
// the no. Stays 8 seconds, then goes.
function showActionToast(msg, label, action) {
  showUndoToast(msg, action, label);
}
// Re-renders whatever is showing tasks, after a delete or an undo.
function refreshTaskViews(projectId) {
  if (APP.currentPage === 'project-detail' && (projectId || APP.currentProjectId)) renderTaskTable(projectId || APP.currentProjectId);
  if (APP.currentPage === 'gantt') renderGantt();
  updateSidebar();
}

let _confirmCallback = null;
function confirmAction(msg, cb) {
  document.getElementById('confirm-message').textContent = msg;
  _confirmCallback = cb;
  openModal('modal-confirm');
}
function runConfirmedAction() {
  const cb = _confirmCallback;
  closeModal('modal-confirm');
  _confirmCallback = null;
  if (cb) cb();
}
function cancelConfirmAction() {
  closeModal('modal-confirm');
  _confirmCallback = null;
}

// ── THEME (dark mode) ─────────────────────────────────────────────
function applyThemeIcon() {
  const isDark = document.documentElement.classList.contains('dark');
  const iconEl = document.getElementById('theme-toggle-icon');
  const switchEl = document.getElementById('theme-switch');
  if (iconEl) iconEl.innerHTML = icon(isDark ? 'sun' : 'moon');
  if (switchEl) switchEl.classList.toggle('on', isDark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('lt-theme', isDark ? 'dark' : 'light');
  applyThemeIcon();
}

// ── STATUS & PRIORITY BADGES ───────────────────────────────────
function statusBadge(s) {
  const map = {
    'Completed':   'bg-green-100 text-green-700',
    'In Progress': 'bg-orange-100 text-orange-700',
    'Not Started': 'bg-gray-100 text-gray-500',
  };
  return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${map[s] || 'bg-gray-100 text-gray-500'}">${esc(s)}</span>`;
}

// A small initial-in-circle badge + first name — used anywhere a task row
// needs to show who it's assigned to without the space a full avatar image
// would need (there are no uploaded avatars, just initials).
function assigneeAvatar(name) {
  if (!name) return `<span class="text-xs text-gray-300">—</span>`;
  const initial = name.trim().charAt(0).toUpperCase();
  const firstName = name.trim().split(' ')[0];
  return `<span class="inline-flex items-center gap-1.5" title="${esc(name)}">
    <span class="w-5 h-5 rounded-full bg-teal/15 text-teal text-[10px] font-bold flex items-center justify-center flex-shrink-0">${esc(initial)}</span>
    <span class="text-xs text-gray-600 truncate">${esc(firstName)}</span>
  </span>`;
}

// Just the initial circle, no name text — for space-constrained spots like
// a Gantt row's frozen 200px title column, where the full assigneeAvatar
// wouldn't fit. The name is still there on hover via title.
function assigneeInitialBadge(name) {
  if (!name) return '';
  const initial = name.trim().charAt(0).toUpperCase();
  return `<span class="w-4 h-4 rounded-full bg-teal/15 text-teal text-[9px] font-bold flex items-center justify-center flex-shrink-0" title="Assigned to ${esc(name)}">${esc(initial)}</span>`;
}

function priorityBadge(p) {
  const map = {
    'High':   'bg-red-100 text-red-700',
    'Medium': 'bg-yellow-100 text-yellow-700',
    'Low':    'bg-green-100 text-green-700',
  };
  return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${map[p] || 'bg-gray-100 text-gray-500'}">${esc(p)}</span>`;
}

// Compact versions of the same info, for space-constrained spots (Gantt
// rows, Kanban cards) where the optional card-fields toggle (see
// getCardFields()) decides whether these show at all.
function miniPriorityBadge(p) {
  const map = { High: 'bg-red-100 text-red-700', Medium: 'bg-yellow-100 text-yellow-700', Low: 'bg-green-100 text-green-700' };
  return `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${map[p] || 'bg-gray-100 text-gray-500'}">${esc(p)}</span>`;
}
function miniCostBadge(cost) {
  if (!cost) return '';
  return `<span class="text-[9px] font-mono font-semibold text-green-600 flex-shrink-0">${money(cost)}</span>`;
}
function miniChecklistBadge(t) {
  if (!t.checklistTotal) return '';
  return `<span class="text-[9px] text-gray-400 flex-shrink-0">${icon('square-check')} ${t.checklistDone}/${t.checklistTotal}</span>`;
}
// The only signal that a task has any discussion on it at all was opening
// its detail panel — nothing on the row/card itself hinted a commenter had
// left something worth reading. A plain count badge, always shown (not
// gated behind the optional card-fields checkboxes), fixes that.
function commentCountBadge(t) {
  if (!t.commentCount) return '';
  return `<span class="text-[9px] text-gray-400 flex-shrink-0" title="${t.commentCount} comment${t.commentCount === 1 ? '' : 's'}">${icon('chat')} ${t.commentCount}</span>`;
}
// Same idea as the comment-count badge, but for the status-update log —
// shows the latest "why it's stuck" note as a tooltip right on the Table
// row, Kanban card and Gantt bar, so a teammate can see it without opening
// the task at all.
function statusUpdateBadge(t) {
  if (!t.latestUpdateText) return '';
  const snippet = t.latestUpdateText.length > 140 ? t.latestUpdateText.slice(0, 140) + '…' : t.latestUpdateText;
  const title = `${t.latestUpdateAuthor ? t.latestUpdateAuthor + ': ' : ''}${snippet}`;
  // A blocker gets a visually distinct red icon so a stuck task stands out
  // from an ordinary progress note without opening it.
  return t.latestUpdateIsBlocker
    ? `<span class="text-[9px] flex-shrink-0" title="Blocker: ${esc(title)}">${icon('blocker', 'tiny text-red-600')}</span>`
    : `<span class="text-[9px] text-gray-400 flex-shrink-0" title="${esc(title)}">${icon('file', 'tiny')}</span>`;
}
// Obstacles on a task (named, each with an enemy count) as a red ⚔️ badge
// on the table row, Gantt row and Kanban card, with the names in its
// tooltip; clicking it opens the task straight at its obstacle editor.
// Once the task is done its obstacles are beaten, so the badge goes away.
// Ticked-off (resolved) obstacles don't count; when every one is ticked off
// the badge turns green until the task itself is done.
function pendingFoes(t) {
  return (t.obstacles || []).reduce((a, o) => a + (o.resolved ? 0 : (o.count || 1)), 0);
}
function obstacleNames(t) {
  return (t.obstacles || []).map(o => `${o.resolved ? '✓ ' : ''}${o.name} ×${o.count}`).join(', ');
}
function obstacleBadge(t) {
  const obs = t.obstacles || [];
  if (!obs.length || t.status === 'Completed') return '';
  const n = pendingFoes(t);
  const names = obstacleNames(t);
  if (!n) return `<button type="button" data-obstacle-badge="${t.id}" onclick="event.stopPropagation(); openObstacles('${t.id}')" class="flex-shrink-0 text-[10px] font-bold text-green-700 bg-green-50 hover:bg-green-100 border border-green-100 rounded px-1 leading-4" title="All blockers cleared: ${esc(names)}" aria-label="All blockers cleared: ${esc(names)}">${icon('done', 'tiny')}</button>`;
  return `<button type="button" data-obstacle-badge="${t.id}" onclick="event.stopPropagation(); openObstacles('${t.id}')" class="flex-shrink-0 text-[10px] font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 rounded px-1 leading-4" title="Blockers: ${esc(names)}" aria-label="${n} blockers: ${esc(names)}">${icon('blocker', 'tiny')}${n}</button>`;
}
// A task's blockers as a little checklist right under it (Journey task
// list, Kanban cards, task table): tick one when it's sorted and the
// Journey knocks out just that blocker's enemies, without opening the task.
// variant 'quest' uses the Journey panel's own themed styles.
const blockerTasks = new Map(); // task id -> the task objects rendered with a checklist
function blockerChecklist(t, canEdit, variant) {
  // Cards and table rows list only what's still in the way; the ⚔️ badge
  // beside them opens the full list, cleared ones included.
  const obs = variant === 'quest' ? (t.obstacles || []) : (t.obstacles || []).filter(o => !o.resolved);
  if (!obs.length || t.status === 'Completed') return '';
  if (!blockerTasks.has(t.id)) blockerTasks.set(t.id, new Set());
  blockerTasks.get(t.id).add(t);
  const stop = `onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()"`;
  const rows = obs.map(o => `
      <label class="${variant === 'quest' ? `journey-blocker-row${o.resolved ? ' is-resolved' : ''}` : `flex items-center gap-1.5 text-xs ${o.resolved ? 'text-gray-400 line-through' : 'text-red-700'} ${canEdit ? 'cursor-pointer' : ''}`}" ${stop} title="${o.resolved ? 'Cleared. Untick if it is back in the way' : 'Tick when this blocker is cleared'}">
        <input type="checkbox" class="${variant === 'quest' ? 'journey-blocker-check' : 'w-3.5 h-3.5 accent-green-600'}" data-obstacle-id="${o.id}" ${o.resolved ? 'checked' : ''} ${canEdit ? '' : 'disabled'} onchange="tickBlocker('${t.id}', '${o.id}', this)" aria-label="${esc(o.name)} cleared">
        <span class="${variant === 'quest' ? 'journey-blocker-name' : 'truncate'}">${variant === 'quest' ? icon(o.resolved ? 'done' : 'blocker', 'tiny mr-1') : ''}${esc(o.name)}${(o.count || 1) > 1 ? ` ×${o.count}` : ''}</span>
      </label>`).join('');
  return `<div class="${variant === 'quest' ? 'journey-blocker-list' : 'mt-1.5 flex flex-col gap-0.5'}" data-blocker-list="${t.id}">${rows}</div>`;
}
async function tickBlocker(taskId, obstacleId, checkbox) {
  const resolved = checkbox.checked;
  checkbox.disabled = true;
  try {
    await API.updateObstacle(obstacleId, { resolved });
  } catch (e) {
    checkbox.checked = !resolved; checkbox.disabled = false;
    showToast('❌ ' + (e.message || 'Could not update that blocker'), 'error');
    return;
  }
  // Every cached copy of the task (board, table, Journey) takes the change.
  const copies = new Set(blockerTasks.get(taskId) || []);
  if (mountainState) mountainState.tasks.filter(x => x.id === taskId).forEach(x => copies.add(x));
  let name = '';
  copies.forEach(t => (t.obstacles || []).forEach(o => { if (o.id === obstacleId) { o.resolved = resolved; name = o.name; } }));
  const any = [...copies][0];
  if (any) {
    document.querySelectorAll(`[data-obstacle-badge="${taskId}"]`).forEach(b => {
      const html = obstacleBadge(any);
      if (html) b.outerHTML = html; else b.remove();
    });
    document.querySelectorAll(`[data-blocker-list="${taskId}"]`).forEach(list => {
      const quest = list.classList.contains('journey-blocker-list');
      if (!quest) list.outerHTML = blockerChecklist(any, true, 'board');
    });
  }
  if (mountainState && mountainState.tasks.some(x => x.id === taskId)) { renderMountainScene(); renderMountainTaskList(); }
  if (APP_currentDetailTaskId === taskId) refreshObstacles(taskId);
  if (APP.currentPage === 'actions') renderActions();
  if (typeof DayRoad !== 'undefined') DayRoad.render(); // today's road and its game scene
  if (resolved && name) showToast(`⚔️ "${name}" cleared!`);
}
// ── Task gates: a task can't start until its predecessors are done, and
// can't be completed while any blocker is pending (the server enforces
// both; these mirror it for instant feedback and for the UI hints).
function waitingOn(t) {
  return (t.predecessors || []).filter(p => p.status !== 'Completed');
}
// Each task carries a snapshot of its predecessors' status, taken when it
// was loaded. When a task changes here (ticked off on the Journey, moved on
// the Kanban, edited in its panel), refresh that snapshot on every loaded
// task waiting on it, so the 🔒 lifts at once instead of after a reload.
function syncPredecessorSnapshots(task) {
  if (!task || !task.id) return;
  [mountainState && mountainState.tasks, APP.ganttTasks].forEach(list => (list || []).forEach(x => (x.predecessors || []).forEach(p => {
    if (p.id !== task.id) return;
    if (task.status) p.status = task.status;
    if (task.title) p.title = task.title;
  })));
}
{
  const update = API.updateTask;
  API.updateTask = async (id, data) => {
    const saved = await update(id, data);
    syncPredecessorSnapshots(saved && saved.id ? saved : { id, ...data });
    return saved;
  };
}
// Blockers can be ticked off at any time: they clear when the world says
// so (the call back comes), not when work starts. When the last one on a
// task that hasn't started goes, offer to start it there and then.
{
  const update = API.updateObstacle;
  API.updateObstacle = async (id, changes) => {
    const result = await update(id, changes);
    if (changes && changes.resolved === true && result && result.taskId) offerStartWhenClear(result.taskId);
    return result;
  };
}
async function offerStartWhenClear(taskId) {
  let t;
  try { t = await API.getTask(taskId); } catch { return; }
  if (!t || t.status !== 'Not Started') return;
  if ((t.obstacles || []).some(o => !o.resolved) || waitingOn(t).length) return;
  showActionToast(`✅ All clear. Start "${t.title}" now?`, 'Start', async () => {
    try { await API.updateTask(taskId, { status: 'In Progress' }); } catch (e) { taskErrorToast(e, 'Could not start it'); return; }
    showToast(`▶️ "${t.title}" is under way`);
    refreshAfterStart(taskId);
  });
}
// Every loaded view takes the new status without a reload.
function refreshAfterStart(taskId) {
  (blockerTasks.get(taskId) || []).forEach(x => { x.status = 'In Progress'; });
  if (mountainState) mountainState.tasks.filter(x => x.id === taskId).forEach(x => { x.status = 'In Progress'; });
  if (mountainState && mountainState.tasks.some(x => x.id === taskId)) { renderMountainScene(); renderMountainTaskList(); }
  if (APP.currentPage === 'project-detail' && APP.currentProjectId) renderTaskTable(APP.currentProjectId);
  else if (APP.currentPage === 'gantt') renderGantt();
  else if (APP.currentPage === 'actions') renderActions();
  else if (APP.currentPage === 'dashboard') renderDashboard();
  if (APP_currentDetailTaskId === taskId) openTaskDetail(taskId);
  if (typeof DayRoad !== 'undefined') DayRoad.refresh();
  updateSidebar();
}
function taskGateMessage(t, nextStatus) {
  if (!t || nextStatus === 'Not Started') return '';
  const waiting = waitingOn(t);
  if (waiting.length) return `🔗 "${t.title}" is waiting on ${waiting.map(p => `"${p.title}"`).join(', ')}. Finish ${waiting.length === 1 ? 'it' : 'those'} first.`;
  const pending = (t.obstacles || []).filter(o => !o.resolved);
  if (nextStatus === 'Completed' && pending.length) return `⚔️ Clear the blockers on "${t.title}" first: ${pending.map(o => `"${o.name}"`).join(', ')}.`;
  return '';
}
function taskErrorToast(e, fallback) {
  const icon = e && e.code === 'BLOCKERS_PENDING' ? '⚔️ ' : e && e.code === 'WAITING_ON_PREDECESSORS' ? '🔗 ' : '❌ ';
  showToast(icon + ((e && e.message) || fallback), 'error');
}
// A small "waiting on" marker for task rows and cards.
function waitingBadge(t) {
  const waiting = t.status === 'Completed' ? [] : waitingOn(t);
  if (!waiting.length) return '';
  const names = waiting.map(p => p.title).join(', ');
  return `<button type="button" onclick="event.stopPropagation(); openTaskDetail('${t.id}')" class="flex-shrink-0 text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-100 rounded px-1 leading-4" title="Waiting on: ${esc(names)}" aria-label="Waiting on ${esc(names)}">${icon('link', 'tiny')}${waiting.length}</button>`;
}

// On hover, a quick way to add an obstacle to a task that has none yet.
function addObstacleButton(t, canEdit) {
  if (!canEdit || t.status === 'Completed' || (t.obstacles || []).length) return '';
  return `<button type="button" onclick="event.stopPropagation(); openObstacles('${t.id}')" class="flex-shrink-0 hidden group-hover:inline text-[10px] font-bold text-gray-400 hover:text-red-600 px-1" title="Add a blocker (something in the way of this task)" aria-label="Add a blocker">+${icon('blocker', 'tiny')}</button>`;
}
// Opens the task panel and puts the cursor in the "add obstacle" box.
async function openObstacles(taskId) {
  await openTaskDetail(taskId);
  const input = document.getElementById('td-obstacle-name');
  if (input) {
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!document.getElementById('td-obstacle-box').classList.contains('hidden')) input.focus({ preventScroll: true });
  }
}
// A numeric progress target (e.g. "20 mock tests") — a lower-friction
// alternative to a checklist for a repetitive goal made of identical
// units: one tap logs a unit instead of typing out 20 separate items.
// Full version (progress bar + count + "+1") for spots with room —
// the task table row, Kanban card, and task detail panel.
function taskProgressBarHTML(t) {
  if (!t.targetCount) return '';
  const pct = Math.min(100, Math.round((t.progressCount / t.targetCount) * 100));
  const label = `${t.progressCount}/${t.targetCount}${t.targetUnit ? ' ' + esc(t.targetUnit) : ''}`;
  return `<div class="flex items-center gap-1.5 mt-1" onclick="event.stopPropagation()">
    <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[100px]">
      <div class="h-full bg-teal rounded-full" style="width:${pct}%"></div>
    </div>
    <span class="text-[10px] text-gray-500 font-semibold whitespace-nowrap">${label}</span>
    ${t.status !== 'Completed' ? `<button onclick="bumpTaskProgressAction('${t.id}',1,'${t.projectId}')" class="text-[10px] font-bold bg-teal/10 hover:bg-teal/20 text-teal px-1.5 py-0.5 rounded flex-shrink-0" title="Log one">+1</button>` : ''}
  </div>`;
}
// Compact version for tight spots (Gantt row) — just the count, no bar.
function miniProgressBadge(t) {
  if (!t.targetCount) return '';
  return `<span class="text-[9px] text-gray-400 flex-shrink-0" title="Progress toward target">${t.progressCount}/${t.targetCount}</span>`;
}
// Larger version for the task detail side panel, matching its text sizing.
function taskProgressPanelHTML(t) {
  if (!t.targetCount) return '';
  const pct = Math.min(100, Math.round((t.progressCount / t.targetCount) * 100));
  const label = `${t.progressCount} / ${t.targetCount}${t.targetUnit ? ' ' + esc(t.targetUnit) : ''}`;
  return `
    <p class="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Progress</p>
    <div class="flex items-center gap-3">
      <div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div class="h-full bg-teal rounded-full" style="width:${pct}%"></div>
      </div>
      <span class="text-sm font-semibold text-navy whitespace-nowrap">${label}</span>
      ${t.status !== 'Completed' ? `<button onclick="bumpTaskProgressAction('${t.id}',1,'${t.projectId}')" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0">+1</button>` : ''}
    </div>`;
}
// Delayed / On Track / Done — derived from status + due date, not a stored
// field, so it's always consistent with the task/project's real data.
function miniScheduleBadge(t) {
  if (t.status === 'Completed') return `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-green-100 text-green-700">${icon('done')} Done</span>`;
  if (!t.endDate) return '';
  const delayed = t.endDate.slice(0, 10) < localDateKey(new Date());
  return delayed
    ? `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-red-100 text-red-700">${icon('overdue')} Delayed</span>`
    : `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-green-100 text-green-700">${icon('circle')} On Track</span>`;
}
// Same idea at the project level, for the Gantt group header row — a
// project is "delayed" if it has any incomplete task past its due date.
function miniProjectScheduleBadge(projectTasks) {
  const todayKey = localDateKey(new Date());
  const dated = projectTasks.filter(t => t.endDate);
  if (!dated.length) return '';
  const delayed = dated.some(t => t.status !== 'Completed' && t.endDate.slice(0, 10) < todayKey);
  return delayed
    ? `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-red-100 text-red-700">${icon('overdue')} Delayed</span>`
    : `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-green-100 text-green-700">${icon('circle')} On Track</span>`;
}
function miniTagBadges(tags) {
  if (!tags || !tags.length) return '';
  return tags.map(tag => `<span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0" style="background:${tag.color}22;color:${tag.color}">${esc(tag.label)}</span>`).join('');
}

// ── MOBILE SIDEBAR ───────────────────────────────────────────────
function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebar-backdrop').classList.remove('hidden');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-backdrop').classList.add('hidden');
}

// ── FILE MENU ──────────────────────────────────────────────────
// A small dropdown for account/data-level actions (Settings, Export/Import,
// Log Out) that don't need their own permanent sidebar buttons or topbar
// real estate.
function toggleFileMenu(e) {
  e.stopPropagation();
  document.getElementById('file-menu').classList.toggle('hidden');
}

function closeFileMenu() {
  document.getElementById('file-menu').classList.add('hidden');
}

// Project Detail header: less-frequent actions (sub-folder, chat, edit,
// delete) tucked behind a "⋯" so the header isn't a wall of buttons —
// Add Task and Share stay directly visible since they're used the most.
function toggleProjectDetailMenu(e) {
  e.stopPropagation();
  document.getElementById('detail-more-menu').classList.toggle('hidden');
}

function closeProjectDetailMenu() {
  document.getElementById('detail-more-menu').classList.add('hidden');
}

// ── OPTIONAL CARD FIELDS (Gantt rows + Kanban cards) ──────────────
// Which extra fields show on a task's Gantt row / Kanban card — everyone's
// preference, persisted locally rather than per-project, same as
// kanbanSort/kanbanPriorityFilter below.
const CARD_FIELD_DEFAULTS = { assignee: true, priority: false, tags: true, checklist: true, cost: false, schedule: true };
function getCardFields() {
  if (APP.cardFields === undefined) {
    try {
      const saved = JSON.parse(localStorage.getItem('cardFields'));
      APP.cardFields = saved && typeof saved === 'object' ? { ...CARD_FIELD_DEFAULTS, ...saved } : { ...CARD_FIELD_DEFAULTS };
    } catch { APP.cardFields = { ...CARD_FIELD_DEFAULTS }; }
  }
  return APP.cardFields;
}
function toggleCardField(key) {
  const fields = getCardFields();
  fields[key] = !fields[key];
  try { localStorage.setItem('cardFields', JSON.stringify(fields)); } catch { /* private mode etc */ }
  renderGantt();
}
function syncFieldsMenuCheckboxes() {
  const fields = getCardFields();
  Object.keys(CARD_FIELD_DEFAULTS).forEach(key => {
    const cb = document.getElementById('field-toggle-' + key);
    if (cb) cb.checked = !!fields[key];
  });
}
function toggleGanttFieldsMenu(e) {
  e.stopPropagation();
  syncFieldsMenuCheckboxes();
  document.getElementById('gantt-fields-menu').classList.toggle('hidden');
}
function closeGanttFieldsMenu() {
  document.getElementById('gantt-fields-menu').classList.add('hidden');
}

// Topbar global search — debounced live search across projects and tasks
// by title. Sits outside any single page's render function since the
// topbar is shared across every page.
let globalSearchDebounce = null;
function onGlobalSearchInput(value) {
  const q = value.trim();
  const resultsEl = document.getElementById('global-search-results');
  if (globalSearchDebounce) clearTimeout(globalSearchDebounce);
  if (q.length < 2) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; return; }
  globalSearchDebounce = setTimeout(() => runGlobalSearch(q), 200);
}

async function runGlobalSearch(q) {
  const resultsEl = document.getElementById('global-search-results');
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    const { projects, tasks } = await res.json();
    // The input may have changed (or been cleared) while this was in
    // flight — never clobber a newer/empty query with a stale response.
    if (document.getElementById('global-search-input').value.trim() !== q) return;

    if (!projects.length && !tasks.length) {
      resultsEl.innerHTML = `<p class="px-4 py-3 text-xs text-gray-400 text-center">No matches for "${esc(q)}"</p>`;
      resultsEl.classList.remove('hidden');
      return;
    }
    const projHTML = projects.map(p => `
      <button onclick="closeGlobalSearch(); showPage('project-detail','${p.id}')" class="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left">
        <span class="flex-shrink-0">${emojiIcon(p.icon || '📁')}</span><span class="truncate flex-1">${esc(p.title)}</span><span class="text-[10px] text-gray-400 uppercase flex-shrink-0">Project</span>
      </button>`).join('');
    const taskHTML = tasks.map(t => `
      <button onclick="closeGlobalSearch(); openTaskDetail('${t.id}')" class="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left">
        <span class="flex-shrink-0">${icon('file')}</span><span class="truncate flex-1">${esc(t.title)}</span><span class="text-[10px] text-gray-400 uppercase flex-shrink-0">Task</span>
      </button>`).join('');
    resultsEl.innerHTML = projHTML + taskHTML;
    resultsEl.classList.remove('hidden');
  } catch (e) { console.error('Search error:', e); }
}

// Used after picking a result — clears the query too, so reopening the
// search starts fresh rather than re-showing the same results.
function closeGlobalSearch() {
  hideGlobalSearchResults();
  document.getElementById('global-search-input').value = '';
}
// Used for dismissal (outside click, Escape) — just collapses the dropdown,
// keeping whatever was typed so refocusing the input shows it again.
function hideGlobalSearchResults() {
  document.getElementById('global-search-results').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('file-menu');
  const btn  = document.getElementById('file-menu-btn');
  if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
    closeFileMenu();
  }
  const fieldsMenu = document.getElementById('gantt-fields-menu');
  const fieldsBtn  = document.getElementById('gantt-fields-btn');
  if (fieldsMenu && !fieldsMenu.classList.contains('hidden') && !fieldsMenu.contains(e.target) && !fieldsBtn.contains(e.target)) {
    closeGanttFieldsMenu();
  }
  const detailMenu = document.getElementById('detail-more-menu');
  const detailBtn  = document.getElementById('detail-more-btn');
  if (detailMenu && !detailMenu.classList.contains('hidden') && !detailMenu.contains(e.target) && !detailBtn.contains(e.target)) {
    closeProjectDetailMenu();
  }
  const searchWrap = document.getElementById('global-search-wrap');
  if (searchWrap && !searchWrap.contains(e.target)) {
    hideGlobalSearchResults();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeFileMenu(); closeGanttFieldsMenu(); closeProjectDetailMenu(); closeNotifications(); hideGlobalSearchResults(); } });
