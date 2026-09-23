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
  nwChart: null,
  onboardingStep: 1,
  aiInsights: null,
};
const ONBOARDING_STEPS = 4;

// ── UTILS ──────────────────────────────────────────────────────
const fmt = (n, currency = '£') => currency + Math.round(n).toLocaleString();
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
  t.textContent = msg;
  t.style.background = type === 'error' ? '#B03020' : '#0D1B2A';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
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
  if (iconEl) iconEl.textContent = isDark ? '☀️' : '🌙';
  if (switchEl) switchEl.classList.toggle('on', isDark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('lt-theme', isDark ? 'dark' : 'light');
  applyThemeIcon();
  if (APP.currentPage === 'wealth') renderWealth(); // Chart.js needs a redraw for its own colors
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

function priorityBadge(p) {
  const map = {
    'High':   'bg-red-100 text-red-700',
    'Medium': 'bg-yellow-100 text-yellow-700',
    'Low':    'bg-green-100 text-green-700',
  };
  return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${map[p] || 'bg-gray-100 text-gray-500'}">${esc(p)}</span>`;
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

// Gantt toolbar: legend is collapsed by default (remembered next time) so
// reference info about colors/markers doesn't compete with the chart —
// "too busy" otherwise, especially with several projects each adding a
// color swatch. Export menu is a plain click-to-open dropdown, same
// pattern as the sidebar's File menu, merging what used to be two
// separate always-visible buttons (Print/PDF, Export Image) into one.
function toggleGanttLegend() {
  const el = document.getElementById('gantt-legend');
  const open = el.classList.toggle('hidden') === false;
  try { localStorage.setItem('ganttLegendOpen', open ? '1' : '0'); } catch { /* private mode etc */ }
}
function toggleGanttExportMenu(e) {
  e.stopPropagation();
  document.getElementById('gantt-export-menu').classList.toggle('hidden');
}
function closeGanttExportMenu() {
  document.getElementById('gantt-export-menu').classList.add('hidden');
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
        <span class="flex-shrink-0">${esc(p.icon || '📁')}</span><span class="truncate flex-1">${esc(p.title)}</span><span class="text-[10px] text-gray-400 uppercase flex-shrink-0">Project</span>
      </button>`).join('');
    const taskHTML = tasks.map(t => `
      <button onclick="closeGlobalSearch(); openTaskDetail('${t.id}')" class="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left">
        <span class="flex-shrink-0">📄</span><span class="truncate flex-1">${esc(t.title)}</span><span class="text-[10px] text-gray-400 uppercase flex-shrink-0">Task</span>
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
  const exportMenu = document.getElementById('gantt-export-menu');
  if (exportMenu && !exportMenu.classList.contains('hidden') && !exportMenu.contains(e.target)) {
    closeGanttExportMenu();
  }
  const searchWrap = document.getElementById('global-search-wrap');
  if (searchWrap && !searchWrap.contains(e.target)) {
    hideGlobalSearchResults();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeFileMenu(); closeGanttExportMenu(); hideGlobalSearchResults(); } });

// ── NAVIGATION ─────────────────────────────────────────────────
function showPage(id, projectId = null) {
  APP.currentPage      = id;
  APP.currentProjectId = projectId;
  APP.filters          = { status: '', priority: '', search: '', tag: '' };
  closeMobileSidebar();

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pg = document.getElementById('page-' + (projectId ? 'project-detail' : id));
  if (pg) pg.classList.add('active');

  // Static nav items (Dashboard/Chart/Actions/All Projects) never actually
  // got a persistent selected state before — only the dynamically-built
  // per-project links did. project-detail pages stay correctly highlighted
  // via that existing per-project logic (rebuilt below in updateSidebar()).
  if (!projectId) {
    const navBtn = document.querySelector(`.nav-item[data-page="${id}"]`);
    if (navBtn) navBtn.classList.add('active');
  }

  const titles = {
    dashboard: 'Dashboard', projects: 'All Projects',
    gantt: 'Gantt Chart',   wealth: 'Wealth Tracker',
    actions: 'Actions',     settings: 'Settings',
  };
  document.getElementById('topbar-title').textContent =
    projectId ? '' : (titles[id] || id);

  if (id === 'dashboard')      renderDashboard();
  if (id === 'projects')       renderProjects();
  if (id === 'project-detail') renderProjectDetail(projectId);
  if (id === 'gantt')          renderGantt();
  if (id === 'wealth')         renderWealth();
  if (id === 'actions')        renderActions();
  if (id === 'settings')       renderSettings();

  updateSidebar();
}

// ── SIDEBAR ────────────────────────────────────────────────────
async function updateSidebar() {
  try {
    const [profile, projects] = await Promise.all([
      API.getProfile(),
      API.getProjects({ parentId: 'null' }),
    ]);

    document.getElementById('sidebar-name').textContent    = profile.name;
    document.getElementById('sidebar-tagline').textContent = profile.tagline;

    // Rebuild project nav
    document.getElementById('project-nav').innerHTML = projects.map(proj => `
      <button class="nav-item w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-white/55 text-sm font-medium hover:bg-white/10 hover:text-white transition-all ${APP.currentProjectId === proj.id ? 'active' : ''}"
        onclick="showPage('project-detail','${proj.id}')">
        <span class="icon-badge" style="background:${proj.color}33">${proj.icon}</span>
        <span class="flex-1 text-left truncate">${esc(proj.title)}</span>
      </button>`).join('');

  } catch (e) { console.error('Sidebar error:', e); }
}

// Projects can have sub-folders (one level, parentId). For any place that
// shows a project "at a glance", its task count/completion should include
// tasks that live in its sub-folders too, not just tasks assigned to it
// directly.
function tasksInProjectTree(projectId, allProjects, allTasks) {
  const childIds = allProjects.filter(p => p.parentId === projectId).map(p => p.id);
  const ids = new Set([projectId, ...childIds]);
  return allTasks.filter(t => ids.has(t.projectId));
}

// ── DASHBOARD ──────────────────────────────────────────────────
function setDashboardProjectView(mode) {
  try { localStorage.setItem('dashboardProjectView', mode); } catch { /* private mode etc */ }
  renderDashboard();
}

async function renderDashboard() {
  try {
    const [tasks, allProjects, profile, wealth] = await Promise.all([
      API.getTasks(),
      API.getProjects(),
      API.getProfile(),
      API.getWealth(),
    ]);
    const projects = allProjects.filter(p => !p.parentId); // top-level only, for the glance cards

    const done   = tasks.filter(t => t.status === 'Completed').length;
    const inprog = tasks.filter(t => t.status === 'In Progress').length;
    // Still needed below for wealth-type projects' own card/table stats —
    // this is a general goal tracker, not a net-worth dashboard, so nothing
    // wealth-specific gets top-level KPI/hero billing anymore, but an
    // individual Wealth-type project still shows its own £ progress same as
    // any other project shows its own stats.
    const nw     = Object.values(wealth.entries || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const target = profile.targetNetWorth || 100000;
    const p      = pct(nw, target);
    const cur    = profile.currency || '£';

    // KPIs
    document.getElementById('kpi-total').textContent  = tasks.length;
    document.getElementById('kpi-done').textContent   = done;
    document.getElementById('kpi-inprog').textContent = inprog;
    document.getElementById('hero-name').textContent  = profile.name.split(' ')[0];

    // Goals Progress hero — overall task completion across every project,
    // regardless of type; goals are goals, whether Career, Wealth, Health, etc.
    const goalsPct = pct(done, tasks.length);
    document.getElementById('hero-goals-pct').textContent    = goalsPct + '%';
    document.getElementById('hero-goals-sub').textContent    = `${done} of ${tasks.length} tasks complete`;
    document.getElementById('hero-goals-prog').style.width   = goalsPct + '%';
    document.getElementById('hero-goals-detail').textContent = `across ${projects.length} project${projects.length === 1 ? '' : 's'}`;

    // Project stat cards / table — same underlying per-project stats, two renderings
    const todayKey = localDateKey(new Date());
    let cardsHTML = '', tableRowsHTML = '';
    projects.forEach(proj => {
      const isWealth = proj.type === 'wealth';
      const pts      = tasksInProjectTree(proj.id, allProjects, tasks);
      const pdone    = pts.filter(t => t.status === 'Completed').length;
      const overdue  = pts.filter(t => t.status !== 'Completed' && t.endDate && t.endDate.slice(0, 10) < todayKey).length;
      const pp       = isWealth ? p : pct(pdone, pts.length);
      const subLine  = isWealth ? `${fmt(nw, cur)} of ${fmt(target, cur)}` : `${pts.length} tasks · ${pdone} done`;
      const overdueBadge = overdue > 0 ? `<span class="flex-shrink-0 bg-red-50 text-red-600 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">🔴 ${overdue} overdue</span>` : '';

      cardsHTML += `
        <div class="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-all"
          onclick="showPage('project-detail','${proj.id}')">
          <div class="flex items-center gap-3 mb-3">
            <span class="text-2xl">${proj.icon}</span>
            <div class="flex-1 min-w-0">
              <p class="font-bold text-sm text-navy truncate">${esc(proj.title)}</p>
              <p class="text-xs text-gray-400">${subLine}</p>
            </div>
            ${overdueBadge}
          </div>
          <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500"
              style="width:${pp}%;background:${proj.color}"></div>
          </div>
          <p class="text-xs text-gray-400 mt-1.5 text-right">${pp}% complete</p>
        </div>`;

      tableRowsHTML += `
        <tr class="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onclick="showPage('project-detail','${proj.id}')">
          <td class="px-4 py-3 text-sm font-semibold text-navy whitespace-nowrap"><span class="mr-1.5">${proj.icon}</span>${esc(proj.title)}</td>
          <td class="px-4 py-3 text-xs text-gray-500">${pts.length}</td>
          <td class="px-4 py-3 text-xs text-gray-500">${pdone}</td>
          <td class="px-4 py-3 text-xs font-semibold ${overdue > 0 ? 'text-red-600' : 'text-gray-300'}">${overdue || '—'}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0"><div class="h-full rounded-full" style="width:${pp}%;background:${proj.color}"></div></div>
              <span class="text-xs text-gray-400 font-mono">${pp}%</span>
            </div>
          </td>
        </tr>`;
    });
    const emptyMsg = `<p class="text-center text-gray-400 text-sm py-8 col-span-full">No projects yet — <button onclick="openAddProject()" class="text-teal underline">create one</button>.</p>`;
    document.getElementById('project-stats').innerHTML = cardsHTML || emptyMsg;
    document.getElementById('project-stats-table-body').innerHTML = tableRowsHTML
      || `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400 text-sm">No projects yet.</td></tr>`;

    let dashView = 'cards';
    try { dashView = localStorage.getItem('dashboardProjectView') || 'cards'; } catch { /* private mode etc */ }
    document.getElementById('project-stats').classList.toggle('hidden', dashView !== 'cards');
    document.getElementById('project-stats-table-wrap').classList.toggle('hidden', dashView !== 'table');
    document.querySelectorAll('.dash-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === dashView));

    // Needs Attention teaser — same Overdue/High-priority definitions as the
    // Actions page, condensed to one line rather than a duplicate list.
    const overdueCount = tasks.filter(t => t.status !== 'Completed' && t.endDate && t.endDate.slice(0, 10) < todayKey).length;
    const highPriorityCount = tasks.filter(t => t.status === 'In Progress' && t.priority === 'High').length;
    const parts = [];
    if (overdueCount)       parts.push(`🔴 ${overdueCount} overdue`);
    if (highPriorityCount)  parts.push(`⭐ ${highPriorityCount} high-priority in progress`);
    document.getElementById('dash-attention-text').textContent = parts.length ? parts.join(' · ') : 'All caught up 🎉';

  } catch (e) { console.error('Dashboard error:', e); }
}

// ── PROJECTS LIST ───────────────────────────────────────────────
async function renderProjects() {
  try {
    const [allProjects, tasks, wealth, profile] = await Promise.all([
      API.getProjects(), API.getTasks(), API.getWealth(), API.getProfile(),
    ]);
    const projects = allProjects.filter(p => !p.parentId); // top-level only
    const cur = profile.currency || '£';

    document.getElementById('projects-grid').innerHTML = projects.map(proj => {
      const isWealth = proj.type === 'wealth';
      let pts = [], pdone = 0, pinp = 0, pp = 0, cost = 0, tagsHTML = '', costLine = '';

      if (isWealth) {
        const nw     = Object.values(wealth.entries || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
        const target = profile.targetNetWorth || 100000;
        pp = pct(nw, target);
        const catCount = Object.keys(wealth.targets || {}).length;
        pts   = tasksInProjectTree(proj.id, allProjects, tasks);
        pdone = pts.filter(t => t.status === 'Completed').length;
        tagsHTML = `<span class="bg-gray-100 text-gray-600 rounded-full px-2.5 py-0.5 text-xs font-semibold">${catCount} categories</span>
          <span class="bg-amber-50 text-amber-700 rounded-full px-2.5 py-0.5 text-xs font-semibold">${fmt(nw, cur)} saved</span>
          ${pts.length ? `<span class="bg-green-50 text-green-700 rounded-full px-2.5 py-0.5 text-xs font-semibold">${pdone}/${pts.length} tasks</span>` : ''}`;
        costLine = `<span>Target ${fmt(target, cur)}</span>`;
      } else {
        pts   = tasksInProjectTree(proj.id, allProjects, tasks);
        pdone = pts.filter(t => t.status === 'Completed').length;
        pinp  = pts.filter(t => t.status === 'In Progress').length;
        pp    = pct(pdone, pts.length);
        cost  = pts.reduce((s, t) => s + (t.cost || 0), 0);
        tagsHTML = `<span class="bg-gray-100 text-gray-600 rounded-full px-2.5 py-0.5 text-xs font-semibold">${pts.length} tasks</span>
          <span class="bg-green-50 text-green-700 rounded-full px-2.5 py-0.5 text-xs font-semibold">${pdone} done</span>
          <span class="bg-orange-50 text-orange-700 rounded-full px-2.5 py-0.5 text-xs font-semibold">${pinp} active</span>`;
        costLine = `<span>Est. £${cost.toLocaleString()}</span>`;
      }

      return `
        <div class="bg-white rounded-xl border border-gray-200 p-5 project-card"
          style="border-top: 4px solid ${proj.color}">
          <div class="flex justify-between items-start mb-3">
            <span class="text-3xl">${proj.icon}</span>
            <div class="project-card-actions flex gap-1 opacity-0 transition-opacity">
              <button onclick="event.stopPropagation();editProject('${proj.id}')"
                class="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 text-sm">✏️</button>
              <button onclick="event.stopPropagation();deleteProjectConfirm('${proj.id}')"
                class="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 text-sm">🗑️</button>
            </div>
          </div>
          <h3 class="font-bold text-navy text-base mb-1 cursor-pointer hover:text-teal"
            onclick="showPage('project-detail','${proj.id}')">${esc(proj.title)}</h3>
          <p class="text-gray-400 text-xs mb-4">${esc(proj.description || '')}</p>
          <div class="flex gap-2 mb-3 flex-wrap">${tagsHTML}</div>
          <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
            <div class="h-full rounded-full transition-all duration-500"
              style="width:${pp}%;background:${proj.color}"></div>
          </div>
          <div class="flex justify-between text-xs text-gray-400 mb-4">
            <span>${pp}% complete</span>
            ${costLine}
          </div>
          <button onclick="showPage('project-detail','${proj.id}')"
            class="w-full py-2 rounded-lg text-white text-xs font-semibold transition-all hover:opacity-90"
            style="background:${proj.color}">Open Project →</button>
        </div>`;
    }).join('');

  } catch (e) { console.error('Projects error:', e); }
}

// ── PROJECT DETAIL ──────────────────────────────────────────────
async function renderProjectDetail(projectId) {
  try {
    const [proj, children, allTasks] = await Promise.all([
      API.getProject(projectId),
      API.getProjects({ parentId: projectId }),
      API.getTasks(),
    ]);

    document.getElementById('detail-icon').textContent      = proj.icon;
    document.getElementById('detail-title').textContent     = proj.title;
    document.getElementById('detail-desc').textContent      = proj.description || '';
    document.getElementById('detail-color').style.background = proj.color;
    document.getElementById('topbar-title').textContent     = proj.title;

    // Wealth-type projects get real tasks too, just like Career projects —
    // the banner just points to the dedicated Wealth Tracker for the £
    // categories/monthly log/chart that don't fit the task model.
    const wealthBanner = document.getElementById('detail-wealth-banner');
    wealthBanner.classList.toggle('hidden', proj.type !== 'wealth');
    wealthBanner.classList.toggle('flex', proj.type === 'wealth');

    // Sub-folders can't themselves have sub-folders (one level of nesting only)
    document.getElementById('btn-new-subfolder').classList.toggle('hidden', !!proj.parentId);

    // Breadcrumb — only shown for a sub-folder (a project with a parent)
    const crumb = document.getElementById('detail-breadcrumb');
    if (proj.parentId) {
      const parent = await API.getProject(proj.parentId).catch(() => null);
      crumb.classList.remove('hidden');
      crumb.classList.add('flex');
      crumb.innerHTML = parent
        ? `<button class="hover:text-teal font-semibold" onclick="showPage('project-detail','${parent.id}')">${parent.icon} ${esc(parent.title)}</button><span>/</span><span class="text-gray-600 font-semibold">${esc(proj.title)}</span>`
        : '';
    } else {
      crumb.classList.add('hidden');
      crumb.classList.remove('flex');
    }

    // Sub-folders — only shown when this project actually has any
    const subSection = document.getElementById('detail-subfolders-section');
    if (children.length) {
      subSection.classList.remove('hidden');
      document.getElementById('detail-subfolders-grid').innerHTML = children.map(sub => {
        const pts = allTasks.filter(t => t.projectId === sub.id);
        const pdone = pts.filter(t => t.status === 'Completed').length;
        const pp = pct(pdone, pts.length);
        return `
          <div class="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-all project-card"
            style="border-top: 3px solid ${sub.color}" onclick="showPage('project-detail','${sub.id}')">
            <div class="flex items-center justify-between mb-2">
              <span class="text-2xl">${sub.icon}</span>
              <div class="project-card-actions flex gap-1 opacity-0 transition-opacity">
                <button onclick="event.stopPropagation();editProject('${sub.id}')" class="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 text-xs">✏️</button>
                <button onclick="event.stopPropagation();deleteProjectConfirm('${sub.id}')" class="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 text-xs">🗑️</button>
              </div>
            </div>
            <p class="font-bold text-sm text-navy mb-1">${esc(sub.title)}</p>
            <p class="text-xs text-gray-400 mb-2">${pts.length} tasks · ${pdone} done</p>
            <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div class="h-full rounded-full" style="width:${pp}%;background:${sub.color}"></div>
            </div>
          </div>`;
      }).join('');
    } else {
      subSection.classList.add('hidden');
    }

    renderTaskTable(projectId);

  } catch (e) { console.error('Project detail error:', e); }
}

async function renderTaskTable(projectId) {
  try {
    const [allTags, rawTasks, project] = await Promise.all([
      API.getTags(),
      API.getTasks({
        projectId,
        status:   APP.filters.status   || undefined,
        priority: APP.filters.priority || undefined,
        search:   APP.filters.search   || undefined,
      }),
      API.getProject(projectId),
    ]);
    const minStart = project.startDate || '';

    const tagFilterSel = document.getElementById('filter-tag');
    tagFilterSel.innerHTML = '<option value="">All Tags</option>' +
      allTags.map(tg => `<option value="${tg.id}" ${APP.filters.tag === tg.id ? 'selected' : ''}>${esc(tg.label)}</option>`).join('');

    // Tag isn't a query-string filter on the API (no clean way to pass a
    // tag id list through GET params the way status/priority do) — filter
    // client-side on the tags array the API already returns per task.
    const tasks = APP.filters.tag ? rawTasks.filter(t => (t.tags || []).some(tg => tg.id === APP.filters.tag)) : rawTasks;

    const done = tasks.filter(t => t.status === 'Completed').length;
    const inp  = tasks.filter(t => t.status === 'In Progress').length;
    const cost = tasks.reduce((s, t) => s + (t.cost || 0), 0);

    document.getElementById('detail-stats').innerHTML = `
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex-1">
        <p class="text-xs text-gray-400 font-semibold">Tasks</p>
        <p class="text-2xl font-black font-mono text-navy mt-1">${tasks.length}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex-1">
        <p class="text-xs text-gray-400 font-semibold">Done</p>
        <p class="text-2xl font-black font-mono text-green-600 mt-1">${done}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex-1">
        <p class="text-xs text-gray-400 font-semibold">Active</p>
        <p class="text-2xl font-black font-mono text-orange-500 mt-1">${inp}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex-1">
        <p class="text-xs text-gray-400 font-semibold">Est. Cost</p>
        <p class="text-2xl font-black font-mono text-yellow-600 mt-1">£${cost.toLocaleString()}</p>
      </div>`;

    document.getElementById('bulk-select-all').checked = false;
    clearBulkSelection();

    document.getElementById('task-table-body').innerHTML = tasks.length
      ? tasks.map(t => `
          <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="px-4 py-3"><input type="checkbox" class="bulk-task-checkbox" data-task-id="${t.id}" onchange="updateBulkActionsBar()"></td>
            <td class="px-4 py-3 text-sm font-semibold max-w-xs cursor-pointer hover:text-teal border-l-4" style="border-left-color:${priorityBorderColor(t.priority)}" onclick="openTaskDetail('${t.id}')">
              <div>${esc(t.title)}${t.recurrence && t.recurrence !== 'none' ? ` <span class="text-gray-400 font-normal text-xs" title="Repeats ${t.recurrence}">🔁</span>` : ''}${t.checklistTotal ? ` <span class="text-gray-400 font-normal text-xs" title="Checklist">☑️ ${t.checklistDone}/${t.checklistTotal}</span>` : ''}</div>
              ${(t.tags || []).length ? `<div class="flex flex-wrap gap-1 mt-1">${t.tags.map(tag => `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style="background:${tag.color}22;color:${tag.color}">${esc(tag.label)}</span>`).join('')}</div>` : ''}
            </td>
            <td class="px-4 py-3">
              <select class="rounded-lg px-2 py-1 text-xs font-semibold border focus:outline-none" style="${tintStyle(statusColor(t.status))}"
                onchange="updateTaskStatus('${t.id}', this.value, '${projectId}')">
                ${['Not Started','In Progress','Completed'].map(s =>
                  `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
            <td class="px-4 py-3">
              <select class="rounded-lg px-2 py-1 text-xs font-semibold border focus:outline-none" style="${tintStyle(priorityBorderColor(t.priority))}"
                onchange="updateTaskPriority('${t.id}', this.value, '${projectId}')">
                ${['High','Medium','Low'].map(p =>
                  `<option ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </td>
            <td class="px-4 py-3">
              <input type="date" value="${t.startDate || ''}" min="${minStart}" class="rounded-lg px-2 py-1 text-xs border border-gray-200 focus:outline-none focus:border-teal w-full"
                onchange="updateTaskStartDate('${t.id}', this.value, '${projectId}')">
            </td>
            <td class="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">${t.endDate || '—'}</td>
            <td class="px-4 py-3 text-xs font-mono font-semibold ${(t.cost || 0) > 0 ? 'text-green-600' : 'text-gray-300'}">
              ${(t.cost || 0) > 0 ? '£' + t.cost.toLocaleString() : '—'}
            </td>
            <td class="px-4 py-3">
              <div class="flex gap-1">
                <button onclick="addTaskToGoogleCalendar('${t.id}')" title="Add to Google Calendar"
                  class="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 text-sm opacity-60 hover:opacity-100">📅</button>
                <button onclick="editTask('${t.id}')"
                  class="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 text-sm opacity-60 hover:opacity-100">✏️</button>
                <button onclick="deleteTaskConfirm('${t.id}','${projectId}')"
                  class="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 text-sm opacity-60 hover:opacity-100">🗑️</button>
              </div>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="8" class="px-4 py-10 text-center text-gray-400 text-sm">
          No tasks match your filters.
          <button onclick="clearFilters('${projectId}')" class="text-teal underline ml-1">Clear filters</button>
          or <button onclick="openAddTask('${projectId}')" class="text-teal underline">add a task</button>.
        </td></tr>`;

  } catch (e) { console.error('Task table error:', e); }
}

// ── BULK TASK ACTIONS (project detail table) ────────────────────
function getSelectedTaskIds() {
  return [...document.querySelectorAll('.bulk-task-checkbox:checked')].map(cb => cb.dataset.taskId);
}

function toggleSelectAllTasks(checked) {
  document.querySelectorAll('.bulk-task-checkbox').forEach(cb => { cb.checked = checked; });
  updateBulkActionsBar();
}

function updateBulkActionsBar() {
  const ids = getSelectedTaskIds();
  const bar = document.getElementById('bulk-actions-bar');
  bar.classList.toggle('hidden', ids.length === 0);
  bar.classList.toggle('flex', ids.length > 0);
  document.getElementById('bulk-actions-count').textContent = `${ids.length} selected`;
  const allCbs = document.querySelectorAll('.bulk-task-checkbox');
  document.getElementById('bulk-select-all').checked = allCbs.length > 0 && ids.length === allCbs.length;
}

function clearBulkSelection() {
  document.querySelectorAll('.bulk-task-checkbox').forEach(cb => { cb.checked = false; });
  updateBulkActionsBar();
}

async function bulkSetStatus(status) {
  const ids = getSelectedTaskIds();
  if (!ids.length) return;
  try {
    await Promise.all(ids.map(id => API.updateTask(id, { status })));
    showToast(`✅ Updated ${ids.length} task${ids.length === 1 ? '' : 's'} to ${status}`);
    renderTaskTable(APP.currentProjectId);
    if (APP.currentPage === 'gantt') renderGantt();
  } catch (e) { showToast('❌ ' + (e.message || 'Bulk update failed'), 'error'); }
}

async function bulkSetPriority(priority) {
  const ids = getSelectedTaskIds();
  if (!ids.length) return;
  try {
    await Promise.all(ids.map(id => API.updateTask(id, { priority })));
    showToast(`✅ Set ${ids.length} task${ids.length === 1 ? '' : 's'} to ${priority} priority`);
    renderTaskTable(APP.currentProjectId);
    if (APP.currentPage === 'gantt') renderGantt();
  } catch (e) { showToast('❌ ' + (e.message || 'Bulk update failed'), 'error'); }
}

function bulkDeleteConfirm() {
  const ids = getSelectedTaskIds();
  if (!ids.length) return;
  confirmAction(`Move ${ids.length} task${ids.length === 1 ? '' : 's'} to Trash? You can restore them from Settings within 30 days.`, async () => {
    try {
      await Promise.all(ids.map(id => API.deleteTask(id)));
      showToast(`🗑️ Moved ${ids.length} task${ids.length === 1 ? '' : 's'} to Trash`);
      renderTaskTable(APP.currentProjectId);
      if (APP.currentPage === 'gantt') renderGantt();
      updateSidebar();
    } catch (e) { showToast('❌ ' + (e.message || 'Bulk delete failed'), 'error'); }
  });
}

async function updateTaskStatus(id, status, projectId) {
  const before = await API.getTask(id);
  await API.updateTask(id, { status });
  if (before.status !== 'Completed' && status === 'Completed' && before.recurrence && before.recurrence !== 'none') {
    showToast('✅ Completed — next occurrence scheduled');
  }
  renderTaskTable(projectId);
  updateSidebar();
}

async function updateTaskPriority(id, priority, projectId) {
  await API.updateTask(id, { priority });
  renderTaskTable(projectId);
}

async function updateGanttTaskDate(id, field, value) {
  try {
    await API.updateTask(id, { [field]: value });
    showToast('✅ ' + (field === 'startDate' ? 'Start' : 'Due') + ' date updated');
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
  }
  renderGantt(); // re-render either way so a rejected edit reverts to the saved value
}

async function updateGanttTaskStatus(id, status) {
  try {
    const before = await API.getTask(id);
    await API.updateTask(id, { status });
    if (before.status !== 'Completed' && status === 'Completed' && before.recurrence && before.recurrence !== 'none') {
      showToast('✅ Completed — next occurrence scheduled');
    } else {
      showToast('✅ Status updated');
    }
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
  }
  renderGantt();
}

async function updateTaskStartDate(id, startDate, projectId) {
  try {
    await API.updateTask(id, { startDate });
    showToast('✅ Start date updated');
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
  }
  renderTaskTable(projectId); // re-render either way so a rejected edit reverts to the saved value
}

function applyFilters(projectId) {
  APP.filters.status   = document.getElementById('filter-status').value;
  APP.filters.priority = document.getElementById('filter-priority').value;
  APP.filters.search   = document.getElementById('filter-search').value;
  APP.filters.tag      = document.getElementById('filter-tag').value;
  renderTaskTable(projectId);
}

function clearFilters(projectId) {
  APP.filters = { status: '', priority: '', search: '', tag: '' };
  ['filter-status','filter-priority','filter-search','filter-tag']
    .forEach(id => { document.getElementById(id).value = ''; });
  renderTaskTable(projectId);
}

// ── GANTT ───────────────────────────────────────────────────────
let ganttCollapsed = new Set();
let ganttGroupIds = []; // every group id currently rendered — kept up to date by renderGantt(), used by Collapse All
// Start/Due are 100px, not 85px, so a native date input can show the full
// "DD/MM/YYYY" — at 85px the year got clipped to 2 digits (e.g. "16/08/20"
// instead of "16/08/2026") by the column's overflow-hidden.
const GANTT_GRID_COLS = '200px 90px 100px 100px 70px 1fr';

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
function printGanttChart() {
  window.print();
}

async function exportGanttImage() {
  // The menu item that was clicked lives inside the dropdown, which closes
  // right away — show the loading state on the always-visible toolbar
  // button instead, so there's feedback during the ~10-15s render.
  const btn = document.getElementById('gantt-export-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Rendering… (~10-15s)`;
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
    btn.textContent = originalLabel;
  }
}

function formatDuration(startDate, endDate) {
  if (!startDate || !endDate) return '—';
  const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
  return days <= 0 ? '—' : (days === 1 ? '1 day' : `${days} days`);
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
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

async function renderGantt() {
  try {
    const [tasks, projects] = await Promise.all([API.getTasks(), API.getProjects()]);
    const projectById = Object.fromEntries(projects.map(p => [p.id, p]));
    if (!APP.ganttViewMode) APP.ganttViewMode = 'month';
    if (APP.ganttProjectFilter === undefined) APP.ganttProjectFilter = '';
    let pageView = 'timeline';
    try { pageView = localStorage.getItem('ganttPageView') || 'timeline'; } catch { /* private mode etc */ }
    applyGanttPageView(pageView);

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
      const topOption = `<option value="${top.id}">${top.icon} ${esc(top.title)}</option>`;
      if (!kids.length) return topOption;
      const kidOptions = kids.map(k => `<option value="${k.id}">${k.icon} ${esc(k.title)}</option>`).join('');
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
    const dated = dateSourceTasks
      .flatMap(t => [t.startDate, t.endDate])
      .filter(Boolean)
      .map(d => new Date(d))
      .filter(d => !isNaN(d));

    let start, end;
    if (dated.length) {
      const minD = new Date(Math.min(...dated));
      const maxD = new Date(Math.max(...dated));
      start = new Date(minD.getFullYear(), minD.getMonth() - 1, 1);
      end   = new Date(maxD.getFullYear(), maxD.getMonth() + 2, 0);
    } else {
      start = APP.ganttStart;
      end   = APP.ganttEnd;
    }
    const totalDays = Math.ceil((end - start) / 86400000);

    // Timeline header, divided according to the chosen zoom level
    const { widths: colWidths, labels: colLabels } = buildTimelineColumns(APP.ganttViewMode, start, end, totalDays);

    // Each column needs a minimum pixel width to keep its label readable —
    // week view especially can produce far more columns than fit at a fixed
    // table width, so the wrapper grows and the outer container scrolls.
    const minColPx = { week: 50, month: 70, year: 90 }[APP.ganttViewMode] || 70;
    const fixedColsPx = 200 + 90 + 85 + 85 + 70;
    const ganttWidthPx = (fixedColsPx + colLabels.length * minColPx) + 'px';
    document.getElementById('gantt-timeline-wrapper').style.minWidth = ganttWidthPx;
    document.getElementById('gantt-rows-wrapper').style.minWidth = ganttWidthPx;

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
        🚩 ${esc(p.title)} starts ${formatDateShort(p.startDate)}
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
    // group itself before its children), then the group's own title.
    const familyTitle = id => {
      const proj = projectById[id];
      if (!proj) return '';
      return proj.parentId ? (projectById[proj.parentId]?.title || '') : proj.title;
    };
    const groupRank = id => projectById[id]?.parentId ? 1 : 0;
    const groupProjectIds = Object.keys(byProject)
      .filter(id => !allowedGroupIds || allowedGroupIds.has(id))
      .sort((a, b) => {
        const family = familyTitle(a).localeCompare(familyTitle(b));
        if (family !== 0) return family;
        const rank = groupRank(a) - groupRank(b);
        if (rank !== 0) return rank;
        return (projectById[a]?.title || '').localeCompare(projectById[b]?.title || '');
      });
    ganttGroupIds = groupProjectIds;
    const allCollapsed = ganttGroupIds.length > 0 && ganttGroupIds.every(id => ganttCollapsed.has(id));
    document.getElementById('gantt-toggle-all-btn').textContent = allCollapsed ? 'Expand All' : 'Collapse All';

    let rowsHTML = '';
    groupProjectIds.forEach(groupId => {
      const pts = byProject[groupId];
      const groupProject = projectById[groupId];
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
            title="${esc(groupTitle)}: ${catStart} → ${catEnd} (drag to shift every task in this folder)"
            onmousedown="ganttSummaryMouseDown(event,'${groupId}')"></div>
          <div class="gantt-summary-cap" style="left:${gMin}%;border-top:7px solid ${dark}"></div>
          <div class="gantt-summary-cap" style="left:${gMax}%;border-top:7px solid ${dark}"></div>`;
      }

      const isCollapsed = ganttCollapsed.has(groupId);

      rowsHTML += `
        <div class="grid gantt-grid-row group border-b border-gray-200 gantt-cat-row" style="grid-template-columns:${GANTT_GRID_COLS}">
          <div class="gantt-sticky gantt-sticky-1 px-4 py-2 border-r border-gray-200 flex items-center gap-2 font-bold text-xs overflow-hidden">
            <span class="text-gray-400 text-[10px] flex-shrink-0 transition-transform cursor-pointer" style="${isCollapsed ? '' : 'transform:rotate(90deg)'}" onclick="toggleGanttGroup('${groupId}')" title="${isCollapsed ? 'Expand' : 'Collapse'}">▶</span>
            <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background:${color}"></span>
            <span class="truncate cursor-pointer hover:underline flex-1 min-w-0" style="color:${color}" onclick="editProject('${groupId}')" title="Edit this folder">${esc(groupProject?.icon || '')} ${esc(groupTitle)}</span>
            <button onclick="openAddTask('${groupId}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-teal px-1" title="Add task to this project">➕</button>
            <button onclick="deleteProjectConfirm('${groupId}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-red-500 px-1" title="Delete this project">🗑️</button>
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
              title="${esc(t.title)} [${t.priority} priority]: ${t.startDate} → ${t.endDate} (drag to move, edges to resize, click to edit)"
              onmousedown="ganttBarMouseDown(event,'${t.id}','move')">
              <span class="gantt-resize-handle" style="left:0" onmousedown="ganttBarMouseDown(event,'${t.id}','resize-left')"></span>
              <span class="gantt-bar-label">${esc(t.title)}</span>
              <span class="gantt-resize-handle" style="right:0" onmousedown="ganttBarMouseDown(event,'${t.id}','resize-right')"></span>
            </div>`;
        } else if (te) {
          const pctPos = posPct(te);
          marker = `<div class="gantt-milestone" style="left:${pctPos}%;background:${fillColor};border:2px solid ${borderColor}"
            title="${esc(t.title)} [${t.priority} priority]: due ${t.endDate} (drag to move, click to edit)"
            onmousedown="ganttBarMouseDown(event,'${t.id}','milestone')"></div>`;
        }

        rowsHTML += `
          <div class="grid gantt-grid-row group border-b border-gray-100 hover:bg-blue-50/40 bg-white ${i % 2 ? 'gantt-row-alt' : ''}" style="grid-template-columns:${GANTT_GRID_COLS};min-height:34px" data-task-id="${t.id}" data-group="${groupId}">
            <div class="gantt-sticky gantt-sticky-1 px-4 py-2 border-r border-gray-200 flex items-center gap-1 overflow-hidden">
              <span class="flex-shrink-0 hidden group-hover:inline cursor-grab text-gray-300 hover:text-gray-500 px-0.5" onmousedown="ganttRowMouseDown(event, '${t.id}', '${t.projectId}', '${groupId}')" title="Drag to reorder">⠿</span>
              <span class="flex-1 min-w-0 text-xs text-gray-600 hover:text-teal truncate cursor-pointer" onclick="editTask('${t.id}')" title="${esc(t.title)} (click to edit)">${esc(t.title)}</span>
              <button onclick="addTaskToGoogleCalendar('${t.id}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-gray-600 px-1" title="Add to Google Calendar">📅</button>
              <button onclick="deleteTaskConfirm('${t.id}', '${t.projectId}')" class="flex-shrink-0 hidden group-hover:inline text-gray-400 hover:text-red-500 px-1" title="Delete task">🗑️</button>
            </div>
            <div class="gantt-sticky gantt-sticky-2 px-1.5 py-1.5 border-r border-gray-200 flex items-center overflow-hidden">
              <select class="w-full rounded px-1 py-1 text-[10px] font-semibold border focus:outline-none" style="${tintStyle(statusColor(t.status))}"
                onclick="event.stopPropagation()" onchange="updateGanttTaskStatus('${t.id}', this.value)">
                ${['Not Started','In Progress','Completed'].map(s =>
                  `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="gantt-sticky gantt-sticky-3 px-1.5 py-1.5 border-r border-gray-200 flex items-center overflow-hidden">
              <input type="date" value="${t.startDate || ''}" min="${minStart}" class="w-full rounded px-1 py-1 text-[10px] border border-gray-200 focus:outline-none focus:border-teal"
                onchange="updateGanttTaskDate('${t.id}', 'startDate', this.value)">
            </div>
            <div class="gantt-sticky gantt-sticky-4 px-1.5 py-1.5 border-r border-gray-200 flex items-center overflow-hidden">
              <input type="date" value="${t.endDate || ''}" class="w-full rounded px-1 py-1 text-[10px] border border-gray-200 focus:outline-none focus:border-teal"
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

function setGanttPageView(mode) {
  try { localStorage.setItem('ganttPageView', mode); } catch { /* private mode etc */ }
  applyGanttPageView(mode);
}

function applyGanttPageView(mode) {
  document.querySelectorAll('#gantt-page-view-toggle .gantt-switch-btn').forEach(b => b.classList.toggle('active', b.dataset.pageview === mode));
  document.getElementById('gantt-switch-thumb').classList.toggle('kanban-active', mode === 'kanban');
  document.getElementById('gantt-timeline-view').classList.toggle('hidden', mode !== 'timeline');
  document.getElementById('gantt-kanban-view').classList.toggle('hidden', mode !== 'kanban');
  // Zoom level and Print/Export only make sense for the timeline.
  document.getElementById('gantt-view-toggle').classList.toggle('hidden', mode !== 'timeline');
  document.getElementById('gantt-export-actions').classList.toggle('hidden', mode !== 'timeline');

  document.getElementById('gantt-page-heading').textContent = mode === 'kanban' ? 'Kanban Board' : 'Gantt Chart';
  document.getElementById('gantt-page-subtitle').textContent = mode === 'kanban'
    ? 'Drag a card between columns to change its status.'
    : 'Visual timeline of all tasks across every project.';
  document.getElementById('topbar-title').textContent = mode === 'kanban' ? 'Kanban Board' : 'Gantt Chart';
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

  board.innerHTML = KANBAN_COLUMNS.map(status => {
    const colTasks = tasks.filter(t => t.status === status).sort(KANBAN_SORTS[APP.kanbanSort].fn);
    const cards = colTasks.map(t => {
      const proj = projectById[t.projectId];
      const borderColor = PRIORITY_BORDER[t.priority] || '#D1D5DB';
      const isOverdue = status !== 'Completed' && t.endDate && t.endDate.slice(0, 10) < localDateKey(new Date());
      return `
        <div class="kanban-card group bg-white rounded-lg border border-gray-200 p-3 mb-2" style="border-left:3px solid ${borderColor}"
          data-task-id="${t.id}" data-status="${status}"
          onmousedown="kanbanCardMouseDown(event, '${t.id}', '${status}')"
          ontouchstart="kanbanCardMouseDown(event, '${t.id}', '${status}')">
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <span class="text-sm font-semibold text-navy cursor-pointer hover:text-teal" onclick="editTask('${t.id}')">${esc(t.title)}</span>
            <div class="flex-shrink-0 hidden group-hover:flex gap-1">
              <button onclick="addTaskToGoogleCalendar('${t.id}')" class="text-gray-400 hover:text-gray-600 text-xs" title="Add to Google Calendar">📅</button>
              <button onclick="deleteTaskConfirm('${t.id}', '${t.projectId}')" class="text-gray-400 hover:text-red-500 text-xs" title="Delete task">🗑️</button>
            </div>
          </div>
          ${(t.tags || []).length ? `<div class="flex flex-wrap gap-1 mb-1.5">${t.tags.map(tag => `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style="background:${tag.color}22;color:${tag.color}">${esc(tag.label)}</span>`).join('')}</div>` : ''}
          <div class="flex items-center justify-between text-xs text-gray-400">
            <span class="truncate">${proj ? esc(proj.icon) + ' ' + esc(proj.title) : ''}${t.checklistTotal ? ` · ☑️ ${t.checklistDone}/${t.checklistTotal}` : ''}</span>
            ${t.endDate ? `<span class="flex-shrink-0 ml-2 ${isOverdue ? 'text-red-500 font-semibold' : ''}">${isOverdue ? '🔴 ' : ''}${formatDateShort(t.endDate)}</span>` : ''}
          </div>
        </div>`;
    }).join('') || `<p class="text-xs text-gray-400 text-center py-6">No tasks</p>`;

    return `
      <div class="bg-gray-50 rounded-xl p-3 kanban-column" data-status="${status}">
        <div class="flex items-center justify-between mb-3 px-1">
          <h4 class="text-xs font-bold uppercase tracking-wide" style="color:${KANBAN_COLUMN_COLOR[status]}">${status} (${colTasks.length})</h4>
          <button onclick="openAddTaskWithStatus('${status}')" class="text-gray-400 hover:text-teal text-sm px-1" title="Add task">➕</button>
        </div>
        <div class="kanban-column-body" data-status="${status}" style="min-height:60px">${cards}</div>
      </div>`;
  }).join('');
}

function openAddTaskWithStatus(status) {
  openAddTask(APP.ganttProjectFilter || undefined);
  document.getElementById('task-status').value = status;
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

function kanbanCardMouseDown(e, taskId, currentStatus) {
  if (e.target.closest('button')) return; // let the 📅/🗑️ buttons handle their own click
  e.preventDefault();
  const cardEl = e.currentTarget;
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

// ── WEALTH ──────────────────────────────────────────────────────
async function renderWealth() {
  try {
    const [wealth, profile, log] = await Promise.all([
      API.getWealth(),
      API.getProfile(),
      API.getMonthlyLog(),
    ]);

    const entries = wealth.entries || {};
    const targets = wealth.targets || {};
    const nw      = Object.values(entries).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const target  = profile.targetNetWorth || 100000;
    const p       = pct(nw, target);
    const cur     = profile.currency || '£';

    document.getElementById('wealth-total').textContent = fmt(nw, cur);
    document.getElementById('wealth-pct').textContent   = p + '%';
    document.getElementById('wealth-prog').style.width  = p + '%';
    document.getElementById('wealth-left').textContent  = fmt(Math.max(0, target - nw), cur) + ' to go';

    // Wealth cards
    document.getElementById('wealth-cards').innerHTML = Object.entries(targets).map(([key, wt]) => {
      const val = parseFloat(entries[key]) || 0;
      const pp  = pct(val, wt.target);
      return `
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <div class="flex items-center justify-between mb-3 gap-2">
            <h4 class="text-sm font-bold text-navy truncate">${esc(wt.label)}</h4>
            <div class="flex items-center gap-1 shrink-0">
              <button onclick="editWealthCat('${key}')" class="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 text-xs" title="Edit category">✏️</button>
              <button onclick="deleteWealthCatConfirm('${key}', '${esc(wt.label).replace(/'/g, "\\'")}')" class="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 text-xs" title="Delete category">🗑️</button>
            </div>
          </div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs text-gray-500 font-medium">Current (${cur})</label>
            <input type="number" min="0" placeholder="0" value="${val || ''}"
              class="w-32 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono font-semibold text-right focus:outline-none focus:border-teal"
              oninput="updateWealth('${key}', this.value)">
          </div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs text-gray-400">Target</span>
            <span class="text-xs font-mono font-bold text-green-600">${fmt(wt.target, cur)}</span>
          </div>
          <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-300"
              style="width:${pp}%;background:${pp >= 100 ? '#1A7A4A' : pp > 50 ? '#0A7E8C' : '#C49A00'}"></div>
          </div>
          <p class="text-xs text-gray-400 text-right mt-1">${pp}%</p>
        </div>`;
    }).join('');

    // Chart
    renderNWChart(log, cur);

    // Monthly log
    document.getElementById('monthly-log').innerHTML = log.length
      ? log.map(e => `
          <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">${esc(e.month || '')}</td>
            <td class="px-4 py-3 text-xs font-mono font-semibold">${fmt(e.income || 0, cur)}</td>
            <td class="px-4 py-3 text-xs font-mono font-semibold text-orange-600">${fmt(e.business || 0, cur)}</td>
            <td class="px-4 py-3 text-xs font-mono">${fmt(e.expenses || 0, cur)}</td>
            <td class="px-4 py-3 text-xs font-mono font-bold text-green-600">${fmt(e.saved || 0, cur)}</td>
            <td class="px-4 py-3 text-xs text-gray-400">${esc(e.notes || '')}</td>
            <td class="px-4 py-3">
              <button onclick="deleteLogEntry('${e.id}')"
                class="text-gray-300 hover:text-red-500 text-sm p-1 rounded hover:bg-red-50">🗑️</button>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400 text-sm">No entries yet. Log your first month above.</td></tr>`;

  } catch (e) { console.error('Wealth error:', e); }
}

async function updateWealth(key, value) {
  await API.updateWealthEntry({ [key]: parseFloat(value) || 0 });
  updateSidebar();

  // Update hero totals live
  const [wealth, profile] = await Promise.all([API.getWealth(), API.getProfile()]);
  const nw     = Object.values(wealth.entries || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const target = profile.targetNetWorth || 100000;
  const p      = pct(nw, target);
  const cur    = profile.currency || '£';
  document.getElementById('wealth-total').textContent = fmt(nw, cur);
  document.getElementById('wealth-pct').textContent   = p + '%';
  document.getElementById('wealth-prog').style.width  = p + '%';
  document.getElementById('wealth-left').textContent  = fmt(Math.max(0, target - nw), cur) + ' to go';
}

async function deleteLogEntry(id) {
  await API.deleteMonthlyEntry(id);
  renderWealth();
  showToast('🗑️ Entry deleted');
}

// ── NET WORTH CHART ─────────────────────────────────────────────
function renderNWChart(log, cur = '£') {
  const wrap = document.getElementById('nw-chart-wrap');
  if (!wrap) return;

  if (APP.nwChart) { APP.nwChart.destroy(); APP.nwChart = null; }

  if (!log.length) {
    wrap.innerHTML = `
      <div class="text-center py-10 text-gray-400 text-sm">
        <p class="text-2xl mb-2">📈</p>
        <p>No monthly data yet. Log your first month to see your chart.</p>
      </div>`;
    return;
  }

  wrap.innerHTML = '<canvas id="nw-chart" height="80"></canvas>';
  const canvas = document.getElementById('nw-chart');

  const sorted  = [...log].reverse();
  const labels  = sorted.map(e => e.month || '');
  const data    = sorted.map(e => parseFloat(e.saved) || 0);
  const running = data.reduce((acc, val, i) => {
    acc.push((acc[i - 1] || 0) + val); return acc;
  }, []);

  const isDark    = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#CBD5E1' : '#374151';
  const gridColor = isDark ? '#263449' : '#F3F4F6';

  APP.nwChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Monthly Saved',
          data,
          borderColor: '#0A7E8C',
          backgroundColor: 'rgba(10,126,140,0.08)',
          borderWidth: 2,
          pointBackgroundColor: '#0A7E8C',
          pointRadius: 4,
          tension: 0.4,
          fill: true,
        },
        {
          label: 'Running Total',
          data: running,
          borderColor: '#C49A00',
          backgroundColor: 'rgba(196,154,0,0.06)',
          borderWidth: 2,
          pointBackgroundColor: '#C49A00',
          pointRadius: 4,
          tension: 0.4,
          fill: true,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { color: textColor, font: { family: 'Inter', size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${cur}${Math.round(ctx.parsed.y).toLocaleString()}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => cur + Math.round(v).toLocaleString(),
            color: textColor,
            font: { family: 'JetBrains Mono', size: 11 }
          },
          grid: { color: gridColor }
        },
        x: {
          ticks: { color: textColor, font: { family: 'Inter', size: 11 } },
          grid: { display: false }
        }
      }
    }
  });
}

// ── ACTIONS — a live feed, not a maintained list ──────────────────
// Nothing here is stored separately: it's computed fresh from real tasks
// across every project (Career and Wealth alike) every time the page opens,
// so there's nothing to keep in sync by hand.
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

    const overdue = [], dueThisWeek = [], startingThisWeek = [], highPriority = [];
    tasks.forEach(t => {
      if (t.status === 'Completed') return;
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

    document.getElementById('act-overdue').textContent  = overdue.length;
    document.getElementById('act-week').textContent     = dueThisWeek.length;
    document.getElementById('act-starting').textContent = startingThisWeek.length;
    document.getElementById('act-high').textContent     = highPriority.length;

    const row = (t, reason) => {
      const proj = projectById[t.projectId];
      return `
        <div class="flex items-start gap-3 px-5 py-4 border-b border-gray-100 hover:bg-gray-50 transition-all">
          <div class="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0 mt-0.5 flex items-center justify-center cursor-pointer hover:border-teal hover:bg-teal/10"
            onclick="markActionDone('${t.id}')" title="Mark as completed"></div>
          <div class="flex-1 min-w-0">
            <h5 class="text-sm font-semibold text-navy cursor-pointer hover:text-teal truncate" onclick="editTask('${t.id}')">${esc(t.title)}</h5>
            <p class="text-xs text-gray-400 mt-0.5 truncate">${proj ? esc(proj.icon) + ' ' + esc(proj.title) : ''}${reason ? ' · ' + reason : ''}</p>
          </div>
          <span class="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${PRI_BADGE[t.priority] || 'bg-gray-100 text-gray-500'}">${esc(t.priority)}</span>
        </div>`;
    };

    const section = (title, icon, items, reasonFn, emptyMsg) => `
      <div class="mb-6">
        <div class="flex items-center gap-2 mb-3">
          <div class="w-1 h-4 bg-teal rounded-full"></div>
          <h3 class="text-sm font-bold text-navy-2">${icon} ${title}</h3>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          ${items.length ? items.map(t => row(t, reasonFn(t))).join('') : `<p class="px-5 py-8 text-center text-gray-400 text-sm">${emptyMsg}</p>`}
        </div>
      </div>`;

    // Both sides parsed the same way (UTC midnight for the calendar date,
    // ignoring the local offset entirely) so the day count itself can't
    // drift a day off depending on timezone, even though it's built from
    // the same local-date keys used for bucketing above.
    const daysBetweenKeys = (fromKey, toKey) => Math.round((new Date(toKey + 'T00:00:00Z') - new Date(fromKey + 'T00:00:00Z')) / 86400000);

    document.getElementById('action-list').innerHTML =
      section('Overdue', '🔴', overdue, t => {
        const days = daysBetweenKeys(t.endDate.slice(0, 10), todayKey);
        return `${days} day${days === 1 ? '' : 's'} overdue`;
      }, 'Nothing overdue 🎉') +
      section('Due This Week', '🟡', dueThisWeek, t => {
        const days = daysBetweenKeys(todayKey, t.endDate.slice(0, 10));
        return days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`;
      }, 'Nothing due this week') +
      section('Starting This Week', '🚀', startingThisWeek, t => {
        const days = daysBetweenKeys(todayKey, t.startDate.slice(0, 10));
        return days === 0 ? 'Starts today' : `Starts in ${days} day${days === 1 ? '' : 's'}`;
      }, 'Nothing starting this week') +
      section('High Priority — In Progress', '⭐', highPriority, () => '', 'No high-priority tasks in progress');

  } catch (e) { console.error('Actions error:', e); }
}

async function markActionDone(taskId) {
  await API.updateTask(taskId, { status: 'Completed' });
  renderActions();
  showToast('✅ Marked as done');
}

// ── AI INSIGHTS ─────────────────────────────────────────────────
async function loadAIInsights() {
  const btn  = document.getElementById('ai-insights-btn');
  const body = document.getElementById('ai-insights-body');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Thinking…`;
  body.classList.remove('hidden');
  body.innerHTML = `<p class="text-xs text-white/60 flex items-center gap-2"><span class="spinner"></span> Reading your open tasks and asking Claude to prioritize them — usually 15-20s…</p>`;
  try {
    const result = await API.getAIInsights();
    APP.aiInsights = result;
    renderAIInsights(result);
  } catch (e) {
    const notConfigured = (e.message || '').includes('not configured');
    body.innerHTML = `
      <div class="bg-white/10 rounded-lg p-4 text-xs text-white/70">
        <p class="font-semibold text-white mb-1">⚠️ ${esc(e.message || 'AI insights are unavailable')}</p>
        ${notConfigured ? `<p>Add an Anthropic API key to the server's <code class="bg-black/20 px-1 rounded">.env</code> file as <code class="bg-black/20 px-1 rounded">ANTHROPIC_API_KEY</code>, then restart the server.</p>` : ''}
      </div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze My Tasks';
  }
}

function renderAIInsights(result) {
  const body = document.getElementById('ai-insights-body');

  const priorityHTML = (result.priorityOrder || []).length ? `
    <ol class="space-y-2 mb-4">${result.priorityOrder.map((p, i) => `
      <li class="bg-white/10 rounded-lg p-3 flex items-start gap-3">
        <span class="text-white/40 font-mono text-xs mt-0.5">${i + 1}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold cursor-pointer hover:underline" onclick="editTask('${p.taskId}')">${esc(p.title)}</p>
          <p class="text-xs text-white/50 mt-0.5">${esc(p.project)}${p.dueDate ? ' · Due ' + esc(p.dueDate) : ''}</p>
          <p class="text-xs text-white/70 mt-1">${esc(p.reason)}</p>
        </div>
        <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/10 flex-shrink-0">${esc(p.priority)}</span>
      </li>`).join('')}</ol>` : '';

  const suggestionsHTML = (result.suggestedNextSteps || []).length ? `
    <div>
      <p class="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">Suggested Next Steps</p>
      <div class="space-y-2">
        ${result.suggestedNextSteps.map((s, i) => `
          <div class="bg-white/10 rounded-lg p-3 flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold">${esc(s.title)}</p>
              <p class="text-xs text-white/50 mt-0.5">${esc(s.projectTitle)} · ${esc(s.priority)} priority</p>
              <p class="text-xs text-white/70 mt-1">${esc(s.reason)}</p>
            </div>
            <button onclick="addSuggestedTask(${i})" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0">+ Add</button>
          </div>`).join('')}
      </div>
    </div>` : '';

  body.innerHTML = `<p class="text-sm text-white/80 mb-4">${esc(result.summary || '')}</p>${priorityHTML}${suggestionsHTML}`;
}

async function addSuggestedTask(i) {
  const s = APP.aiInsights?.suggestedNextSteps?.[i];
  if (!s) return;
  try {
    await API.addTask({ title: s.title, projectId: s.projectId, priority: s.priority, status: 'Not Started' });
    showToast('✅ Added: ' + s.title);
    renderActions();
  } catch (e) { showToast('❌ Failed to add task', 'error'); }
}

// ── SETTINGS ────────────────────────────────────────────────────
async function renderSettings() {
  try {
    const p = await API.getProfile();
    document.getElementById('set-name').value     = p.name;
    document.getElementById('set-tagline').value  = p.tagline;
    document.getElementById('set-currency').value = p.currency || '£';
    document.getElementById('set-target').value   = p.targetNetWorth;
    document.getElementById('set-date').value     = p.targetDate;
    setEmailDigestButton(p.emailDigestEnabled);
    renderSettingsDrive();
    renderTrash();
    API.getMe().then(me => { document.getElementById('account-email').textContent = me.email; }).catch(() => {});
  } catch (e) { console.error('Settings error:', e); }
}

// ── TRASH ────────────────────────────────────────────────────────
async function renderTrash() {
  const list = document.getElementById('trash-list');
  try {
    const [{ projects, tasks }, activeProjects] = await Promise.all([API.getTrash(), API.getProjects()]);
    if (!projects.length && !tasks.length) {
      list.innerHTML = `<p class="text-center text-gray-400 text-sm py-6">Trash is empty</p>`;
      return;
    }
    // A trashed task's own project might still be active (deleted solo) or
    // also sitting in Trash (deleted together) — look it up either way so
    // the row can show which project it came from.
    const projectById = Object.fromEntries([...projects, ...activeProjects].map(p => [p.id, p]));

    const daysLeft = deletedAt => Math.max(0, 30 - Math.floor((Date.now() - new Date(deletedAt)) / 86400000));
    const row = (icon, title, sub, deletedAt, onRestore, onPurge) => `
      <div class="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
        <span class="text-lg flex-shrink-0">${icon}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-navy truncate">${esc(title)}</p>
          <p class="text-xs text-gray-400 truncate">${sub} · purges in ${daysLeft(deletedAt)} day${daysLeft(deletedAt) === 1 ? '' : 's'}</p>
        </div>
        <button onclick="${onRestore}" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0">Restore</button>
        <button onclick="${onPurge}" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0">Delete Forever</button>
      </div>`;

    list.innerHTML =
      projects.map(p => row(p.icon || '📁', p.title, p.parentId ? 'Sub-folder' : 'Project', p.deletedAt,
        `restoreProjectFromTrash('${p.id}')`, `purgeProjectFromTrash('${p.id}','${esc(p.title)}')`)).join('') +
      tasks.map(t => {
        const proj = projectById[t.projectId];
        const sub = 'Task' + (proj ? ' · ' + esc(proj.title) : '');
        return row(proj?.icon || '📄', t.title, sub, t.deletedAt,
          `restoreTaskFromTrash('${t.id}')`, `purgeTaskFromTrash('${t.id}','${esc(t.title)}')`);
      }).join('');
  } catch (e) {
    console.error('Trash error:', e);
    list.innerHTML = `<p class="text-center text-red-400 text-sm py-6">Failed to load Trash</p>`;
  }
}

async function restoreProjectFromTrash(id) {
  try {
    await API.restoreProject(id);
    showToast('✅ Restored');
    renderTrash();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to restore'), 'error'); }
}

async function restoreTaskFromTrash(id) {
  try {
    await API.restoreTask(id);
    showToast('✅ Restored');
    renderTrash();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to restore'), 'error'); }
}

function purgeProjectFromTrash(id, title) {
  confirmAction(`Permanently delete "${title}" and everything in it? This cannot be undone.`, async () => {
    await API.purgeProjectForever(id);
    showToast('🗑️ Permanently deleted');
    renderTrash();
  });
}

function purgeTaskFromTrash(id, title) {
  confirmAction(`Permanently delete "${title}"? This cannot be undone.`, async () => {
    await API.purgeTaskForever(id);
    showToast('🗑️ Permanently deleted');
    renderTrash();
  });
}

async function saveSettings() {
  try {
    await API.updateProfile({
      name:           document.getElementById('set-name').value,
      tagline:        document.getElementById('set-tagline').value,
      currency:       document.getElementById('set-currency').value,
      targetNetWorth: parseFloat(document.getElementById('set-target').value) || 100000,
      targetDate:     document.getElementById('set-date').value,
    });
    updateSidebar();
    showToast('✅ Settings saved!');
  } catch (e) { showToast('❌ Failed to save', 'error'); }
}

function setEmailDigestButton(enabled) {
  const btn = document.getElementById('email-digest-btn');
  btn.classList.toggle('on', enabled);
  btn.dataset.enabled = enabled ? '1' : '0';
}

async function toggleEmailDigest() {
  const btn = document.getElementById('email-digest-btn');
  const next = btn.dataset.enabled !== '1';
  try {
    await API.updateProfile({ emailDigestEnabled: next });
    setEmailDigestButton(next);
    showToast(next ? '✅ Daily digest emails turned on' : 'Daily digest emails turned off');
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to update'), 'error'); }
}

// ── AUTH ────────────────────────────────────────────────────────
async function checkAuth() {
  const status = await API.getAuthStatus();
  if (!status.authenticated) {
    showAuthView('login');
    return false;
  }
  return true;
}

function showAuthView(view) {
  document.getElementById('auth-overlay').classList.add('open');
  document.getElementById('auth-view-login').classList.toggle('active', view === 'login');
  document.getElementById('auth-view-register').classList.toggle('active', view === 'register');
  document.getElementById('auth-view-forgot').classList.toggle('active', view === 'forgot');
  document.getElementById('auth-view-reset').classList.toggle('active', view === 'reset');
  API.getGoogleLoginStatus().then(status => {
    document.getElementById('google-login-btn').classList.toggle('hidden', !status.configured);
    document.getElementById('google-register-btn').classList.toggle('hidden', !status.configured);
  }).catch(() => {});
}

function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('open');
}

function showAuthError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.remove('hidden');
}

// Lets the browser's native password manager offer to save the credential
// (works even in an SPA with no full-page navigation) on browsers that
// support the Credential Management API — a no-op everywhere else.
function offerToSaveCredential(email, password) {
  if (!window.PasswordCredential) return;
  try {
    navigator.credentials.store(new PasswordCredential({ id: email, password, name: email }));
  } catch { /* best-effort only */ }
}

function handleAuthRegisterSubmit(event) {
  event.preventDefault();
  submitAuthRegister();
  return false;
}

function handleAuthLoginSubmit(event) {
  event.preventDefault();
  submitAuthLogin();
  return false;
}

async function submitAuthRegister() {
  const email    = document.getElementById('auth-register-email').value.trim();
  const password = document.getElementById('auth-register-password').value;
  const confirm  = document.getElementById('auth-register-confirm').value;
  if (password.length < 6) return showAuthError('auth-register-error', 'Password must be at least 6 characters');
  if (password !== confirm) return showAuthError('auth-register-error', 'Passwords do not match');
  try {
    await API.register(email, password);
    offerToSaveCredential(email, password);
    closeAuth();
    await afterAuth();
  } catch (e) { showAuthError('auth-register-error', e.message); }
}

async function submitAuthLogin() {
  const email    = document.getElementById('auth-login-email').value.trim();
  const password = document.getElementById('auth-login-password').value;
  const remember = document.getElementById('auth-login-remember').checked;
  try {
    await API.login(email, password, remember);
    offerToSaveCredential(email, password);
    closeAuth();
    await afterAuth();
  } catch (e) { showAuthError('auth-login-error', e.message); }
}

function handleAuthForgotSubmit(event) {
  event.preventDefault();
  submitAuthForgot();
  return false;
}

function handleAuthResetSubmit(event) {
  event.preventDefault();
  submitAuthReset();
  return false;
}

async function submitAuthForgot() {
  const email = document.getElementById('auth-forgot-email').value.trim();
  try {
    await API.forgotPassword(email);
    document.getElementById('auth-forgot-success').classList.remove('hidden');
  } catch {
    // Same response either way — this endpoint never reveals whether the email exists.
    document.getElementById('auth-forgot-success').classList.remove('hidden');
  }
}

let pendingResetToken = null;

async function submitAuthReset() {
  const password = document.getElementById('auth-reset-password').value;
  const confirm  = document.getElementById('auth-reset-confirm').value;
  if (password.length < 6) return showAuthError('auth-reset-error', 'Password must be at least 6 characters');
  if (password !== confirm) return showAuthError('auth-reset-error', 'Passwords do not match');
  try {
    await API.resetPassword(pendingResetToken, password);
    showToast('Password updated — log in with your new password.', 'success');
    // Drop the token from the URL so a refresh/back doesn't re-show the reset form.
    window.history.replaceState({}, '', window.location.pathname);
    showAuthView('login');
  } catch (e) { showAuthError('auth-reset-error', e.message); }
}

async function startGoogleLogin() {
  try {
    const status = await API.getGoogleLoginStatus();
    if (!status.configured) {
      showToast('Sign in with Google isn\'t configured on this server yet.', 'error');
      return;
    }
    window.location.href = '/api/auth/google';
  } catch {
    showToast('Sign in with Google isn\'t available right now.', 'error');
  }
}

async function afterAuth() {
  const showingOnboarding = await checkOnboarding();
  if (!showingOnboarding) await showPage('dashboard');
  checkDailyDigest();
}

// Proactive nudge: a dismissible banner on open if anything's overdue or due
// today. There's no email/push service configured (would need a paid
// provider), so "proactive" here means "surfaced the moment you open the
// app" rather than delivered to you outside it. Shows at most once per
// calendar day per browser (tracked in localStorage) so it doesn't nag on
// every page load.
// Local (not UTC) YYYY-MM-DD — endDate is stored as a plain date string, and
// new Date('2026-09-15') parses as UTC midnight, which is a different
// instant from local midnight in any non-UTC timezone. Comparing everything
// as local date strings instead of Date objects sidesteps that entirely.
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function checkDailyDigest() {
  try {
    const todayKey = localDateKey(new Date());
    let dismissedDay = null;
    try { dismissedDay = localStorage.getItem('digestDismissedDate'); } catch { /* private mode etc */ }
    if (dismissedDay === todayKey) return;

    const tasks = await API.getTasks();
    let overdueCount = 0, dueTodayCount = 0;
    tasks.forEach(t => {
      if (t.status === 'Completed' || !t.endDate) return;
      const dueKey = t.endDate.slice(0, 10);
      if (dueKey < todayKey) overdueCount++;
      else if (dueKey === todayKey) dueTodayCount++;
    });
    if (!overdueCount && !dueTodayCount) return;

    const parts = [];
    if (overdueCount) parts.push(`<strong>${overdueCount}</strong> task${overdueCount === 1 ? '' : 's'} overdue`);
    if (dueTodayCount) parts.push(`<strong>${dueTodayCount}</strong> due today`);
    document.getElementById('digest-banner-text').innerHTML =
      `${parts.join(' · ')}. <button onclick="showPage('actions')" class="underline font-semibold hover:no-underline">View in Actions →</button>`;
    document.getElementById('digest-banner').classList.remove('hidden');
  } catch (e) { console.error('Digest error:', e); }
}

function dismissDigestBanner() {
  document.getElementById('digest-banner').classList.add('hidden');
  try { localStorage.setItem('digestDismissedDate', localDateKey(new Date())); } catch { /* private mode etc */ }
}

async function logout() {
  await API.logout();
  window.location.reload();
}

async function submitChangePassword() {
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword     = document.getElementById('pw-new').value;
  if (newPassword.length < 6) return showToast('New password must be at least 6 characters', 'error');
  try {
    await API.changePassword(currentPassword, newPassword);
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value      = '';
    showToast('✅ Password changed');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}

function deleteAccountConfirm() {
  const password = document.getElementById('delete-account-password').value;
  if (!password) { showToast('Enter your password to confirm', 'error'); return; }
  confirmAction(
    'Permanently delete your account and everything in it? This cannot be undone.',
    async () => {
      try {
        await API.deleteAccount(password);
        window.location.reload();
      } catch (e) { showToast('❌ ' + (e.message || 'Failed to delete account'), 'error'); }
    }
  );
}

// ── ONBOARDING WIZARD ──────────────────────────────────────────
async function checkOnboarding() {
  const profile = await API.getProfile();
  if (!profile.onboarded) {
    startOnboarding();
    return true;
  }
  return false;
}

function startOnboarding() {
  APP.onboardingStep = 1;
  document.getElementById('onb-name').value     = '';
  document.getElementById('onb-tagline').value  = '';
  document.getElementById('onb-currency').value = '£';
  document.getElementById('onb-target').value   = '100000';
  document.getElementById('onb-date').value     = '';
  document.getElementById('onb-proj-title').value = '';
  document.getElementById('onb-proj-icon').value  = '📁';
  document.getElementById('onb-proj-color').value = '#0A7E8C';
  document.getElementById('onboarding-overlay').classList.add('open');
  renderOnboardingStep();
}

function renderOnboardingStep() {
  for (let i = 1; i <= ONBOARDING_STEPS; i++) {
    document.getElementById('onb-step-' + i).classList.toggle('active', i === APP.onboardingStep);
    const dot = document.getElementById('onb-dot-' + i);
    dot.classList.toggle('active', i === APP.onboardingStep);
    dot.classList.toggle('done', i < APP.onboardingStep);
  }
  document.getElementById('onb-back-btn').style.visibility = APP.onboardingStep === 1 ? 'hidden' : 'visible';
  document.getElementById('onb-next-btn').textContent = APP.onboardingStep === ONBOARDING_STEPS ? 'Finish' : 'Next';

  if (APP.onboardingStep === 4) renderOnboardingDriveStatus();
}

function onboardingBack() {
  if (APP.onboardingStep === 1) return;
  APP.onboardingStep--;
  renderOnboardingStep();
}

async function onboardingNext() {
  if (APP.onboardingStep < ONBOARDING_STEPS) {
    APP.onboardingStep++;
    renderOnboardingStep();
  } else {
    await finishOnboarding();
  }
}

async function skipOnboarding() {
  await API.updateProfile({ onboarded: true });
  await closeOnboarding();
  showToast('👋 Setup skipped — you can change anything in Settings');
}

async function finishOnboarding() {
  try {
    await API.updateProfile({
      name:           document.getElementById('onb-name').value.trim()     || 'Your Name',
      tagline:        document.getElementById('onb-tagline').value.trim()  || 'My Life & Wealth Tracker',
      currency:       document.getElementById('onb-currency').value.trim() || '£',
      targetNetWorth: parseFloat(document.getElementById('onb-target').value) || 100000,
      targetDate:     document.getElementById('onb-date').value,
      onboarded:      true,
    });

    const projTitle = document.getElementById('onb-proj-title').value.trim();
    if (projTitle) {
      await API.addProject({
        title:       projTitle,
        description: '',
        icon:        document.getElementById('onb-proj-icon').value.trim() || '📁',
        color:       document.getElementById('onb-proj-color').value,
      });
    }

    await closeOnboarding();
    showToast('✅ All set up — welcome to Waypoint!');
  } catch (e) {
    showToast('❌ Something went wrong finishing setup', 'error');
  }
}

async function closeOnboarding() {
  document.getElementById('onboarding-overlay').classList.remove('open');
  await showPage('dashboard');
}

async function rerunOnboarding() {
  await API.updateProfile({ onboarded: false });
  startOnboarding();
}

// ── GOOGLE DRIVE ────────────────────────────────────────────────
async function connectDrive() {
  window.location.href = API.connectDriveUrl();
}

async function renderOnboardingDriveStatus() {
  try {
    const status = await API.getDriveStatus();
    const textEl = document.getElementById('onb-drive-text');
    const btnEl  = document.getElementById('onb-drive-connect-btn');
    if (!status.configured) {
      textEl.textContent = 'Google Drive backup isn’t configured on this server yet. You can set it up later in Settings.';
      btnEl.style.display = 'none';
    } else if (status.connected) {
      textEl.textContent = '✅ Connected — your data can now be backed up to Drive any time.';
      btnEl.style.display = 'none';
    } else {
      textEl.textContent = 'Not connected yet.';
      btnEl.style.display = 'inline-block';
    }
  } catch (e) { console.error('Drive status error:', e); }
}

async function renderSettingsDrive() {
  try {
    const status = await API.getDriveStatus();
    const textEl    = document.getElementById('settings-drive-text');
    const subEl     = document.getElementById('settings-drive-sub');
    const actionsEl = document.getElementById('settings-drive-actions');
    const formatsEl = document.getElementById('settings-drive-formats');

    if (!status.configured) {
      textEl.textContent = 'Not configured on this server.';
      subEl.textContent  = 'Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI to the server .env file to enable this.';
      actionsEl.innerHTML = '';
      formatsEl.classList.add('hidden');
      return;
    }

    if (status.connected) {
      textEl.textContent = '✅ Connected to Google Drive';
      subEl.textContent  = status.lastBackupAt
        ? `Last backup: ${new Date(status.lastBackupAt).toLocaleString()}`
        : 'No backups yet — click "Backup Now" to create your first one.';
      actionsEl.innerHTML = `
        <button onclick="backupAs('json')" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-4 py-2 rounded-lg">☁️ Backup Now (JSON)</button>
        <button onclick="disconnectDriveConfirm()" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-semibold px-4 py-2 rounded-lg">Disconnect</button>`;
      formatsEl.classList.remove('hidden');
    } else {
      textEl.textContent = 'Not connected';
      subEl.textContent  = 'Connect your Google Drive to save backups of your data with one click.';
      actionsEl.innerHTML = `
        <button onclick="connectDrive()" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-4 py-2 rounded-lg">Connect Google Drive</button>`;
      formatsEl.classList.add('hidden');
    }
  } catch (e) { console.error('Settings Drive error:', e); }
}

const BACKUP_FNS = {
  json:   API => API.backupToDrive,
  sheets: API => API.backupToSheets,
  excel:  API => API.backupToExcel,
  pdf:    API => API.backupToPdf,
  image:  API => API.backupToImage,
};
const BACKUP_LABELS = { json: 'JSON backup', sheets: 'Google Sheet', excel: 'Excel workbook', pdf: 'PDF report', image: 'Image report' };

async function backupAs(format) {
  showToast(`⏳ Creating ${BACKUP_LABELS[format]}…`);
  try {
    const result = await BACKUP_FNS[format](API)();
    showToast(`✅ ${BACKUP_LABELS[format]} saved to Drive`);
    if (result.link) window.open(result.link, '_blank');
    renderSettingsDrive();
  } catch (e) { showToast(`❌ ${BACKUP_LABELS[format]} failed — ${e.message}`, 'error'); }
}

function disconnectDriveConfirm() {
  confirmAction('Disconnect Google Drive? You can reconnect any time.', async () => {
    await API.disconnectDrive();
    showToast('🔌 Google Drive disconnected');
    renderSettingsDrive();
  });
}

function handleDriveRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('drive')) return;
  if (params.get('drive') === 'connected') showToast('✅ Google Drive connected');
  if (params.get('drive') === 'error')     showToast('❌ Google Drive connection failed', 'error');
  window.history.replaceState({}, '', window.location.pathname);
}

function handleAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('auth')) return;
  if (params.get('auth') === 'error') showToast('❌ Google sign-in failed', 'error');
  window.history.replaceState({}, '', window.location.pathname);
}

// Left in the URL (not cleared) until the reset form is actually submitted,
// so a page reload while the reset view is open doesn't lose the token.
function handleResetTokenRedirect() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('resetToken');
  if (!token) return false;
  pendingResetToken = token;
  showAuthView('reset');
  return true;
}

// ── TASK DETAIL SIDE PANEL ───────────────────────────────────────
let APP_currentDetailTaskId = null;

async function openTaskDetail(id) {
  try {
    const t = await API.getTask(id);
    const proj = t.projectId ? await API.getProject(t.projectId).catch(() => null) : null;
    APP_currentDetailTaskId = id;

    document.getElementById('td-project-icon').textContent  = proj ? proj.icon : '';
    document.getElementById('td-project-title').textContent = proj ? proj.title : '';
    document.getElementById('td-title').textContent = t.title;
    document.getElementById('td-badges').innerHTML   = statusBadge(t.status) + priorityBadge(t.priority);
    document.getElementById('td-cost').textContent      = (t.cost || 0) > 0 ? '£' + t.cost.toLocaleString() : '—';
    document.getElementById('td-start').textContent     = t.startDate || '—';
    document.getElementById('td-end').textContent       = t.endDate || '—';
    document.getElementById('td-notes').textContent     = t.notes && t.notes.trim() ? t.notes : 'No notes for this task yet.';

    document.getElementById('task-detail-backdrop').classList.remove('hidden');
    document.getElementById('task-detail-panel').classList.remove('translate-x-full');
  } catch (e) { console.error('Task detail error:', e); }
}

function closeTaskDetail() {
  document.getElementById('task-detail-backdrop').classList.add('hidden');
  document.getElementById('task-detail-panel').classList.add('translate-x-full');
  APP_currentDetailTaskId = null;
}

function editTaskFromDetail() {
  const id = APP_currentDetailTaskId;
  closeTaskDetail();
  if (id) editTask(id);
}

// ── GOOGLE CALENDAR ──────────────────────────────────────────────
// Uses Google's public "render" link (no OAuth, no setup needed) — opens a
// pre-filled event that the user reviews and saves themselves, in contrast
// to the Drive integration which needs GOOGLE_CLIENT_ID/SECRET configured.
async function addTaskToGoogleCalendar(taskId) {
  if (!taskId) return;
  try {
    const t = await API.getTask(taskId);
    const start = t.startDate || t.endDate;
    const end   = t.endDate   || t.startDate;
    if (!start) { showToast('Set a start or due date on this task first', 'error'); return; }

    // Google Calendar's all-day "dates" range is start-inclusive, end-exclusive.
    const gcalStart = start.replace(/-/g, '');
    const gcalEnd   = addDaysToDateStr(end, 1).replace(/-/g, '');

    const details = [
      t.priority ? `Priority: ${t.priority}` : '',
      t.notes || '',
    ].filter(Boolean).join('\n');

    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE');
    url.searchParams.set('text', t.title);
    url.searchParams.set('dates', `${gcalStart}/${gcalEnd}`);
    if (details) url.searchParams.set('details', details);

    window.open(url.toString(), '_blank');
  } catch (e) {
    showToast('❌ Could not open Google Calendar', 'error');
  }
}

// ── MODALS ───────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// PROJECT MODAL
// ── IMPORT PROJECT FROM FILE (AI) ─────────────────────────────────
// Chat is the flagship way in — defaults to it rather than the file-upload
// tab, which used to be the default and buried chat as a secondary option
// one extra click away.
function openImportProject(method = 'chat') {
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-error').classList.add('hidden');
  document.getElementById('import-step-upload').classList.remove('hidden');
  document.getElementById('import-upload-actions').classList.remove('hidden');
  document.getElementById('import-upload-actions').classList.add('flex');
  document.getElementById('import-step-preview').classList.add('hidden');
  document.getElementById('import-preview-actions').classList.add('hidden');
  document.getElementById('import-preview-actions').classList.remove('flex');
  resetProjectChat();
  setImportMethod(method);
  openModal('modal-import');
}

function setImportMethod(method) {
  document.querySelectorAll('.import-method-btn').forEach(b => b.classList.toggle('active', b.dataset.method === method));
  document.getElementById('import-method-file').classList.toggle('hidden', method !== 'file');
  document.getElementById('import-method-chat').classList.toggle('hidden', method !== 'chat');
  document.getElementById('import-analyze-btn').classList.toggle('hidden', method === 'chat');
  document.getElementById('import-analyze-btn').textContent = 'Analyze File';
  document.getElementById('import-analyze-btn').dataset.method = method;
  document.getElementById('import-error').classList.add('hidden');
  if (method === 'chat') document.getElementById('chat-input').focus();
}

async function analyzeImportFile() {
  const fileInput = document.getElementById('import-file-input');
  const errorEl = document.getElementById('import-error');
  errorEl.classList.add('hidden');
  const file = fileInput.files[0];
  if (!file) { errorEl.textContent = 'Choose a file first'; errorEl.classList.remove('hidden'); return; }

  const formData = new FormData();
  formData.append('file', file);
  await runProjectProposal(() => fetch('/api/ai/import-project', { method: 'POST', body: formData }), 'Reading file with Claude… (~15-20s)', 'Failed to read that file');
}

// ── CREATE PROJECT VIA AI CHAT ────────────────────────────────────
// A real multi-turn conversation: the frontend keeps the whole history in
// APP.projectChat and resends it every turn (the /project-chat endpoint is
// stateless). Claude either replies with a normal chat message to keep
// asking questions, or calls propose_project once it has enough — which
// hands off to the exact same review/edit/create step as the file-upload
// and (former) single-shot goal flows.
function resetProjectChat() {
  APP.projectChat = [];
  const wrap = document.getElementById('chat-messages');
  wrap.innerHTML = '';
  document.getElementById('chat-input').value = '';
  addChatBubble('assistant', "Hi! What goal are you working towards? Tell me a bit about it and I'll help shape it into a project.");
}

function addChatBubble(role, text, pending) {
  const wrap = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'max-w-[85%] text-sm rounded-2xl px-3 py-2 whitespace-pre-wrap ' +
    (role === 'user' ? 'self-end bg-teal text-white rounded-br-sm' : 'self-start bg-gray-100 text-navy rounded-bl-sm');
  if (pending) el.classList.add('opacity-60');
  el.textContent = text;
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
  return el;
}

async function sendProjectChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const sendBtn = document.getElementById('chat-send-btn');
  APP.projectChat.push({ role: 'user', content: text });
  addChatBubble('user', text);
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;
  const typingEl = addChatBubble('assistant', 'Thinking…', true);

  try {
    const res = await fetch('/api/ai/project-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: APP.projectChat }),
    });
    const body = await res.json();
    typingEl.remove();
    if (!res.ok) throw new Error(body.error || 'Chat failed');

    if (body.type === 'proposal') {
      addChatBubble('assistant', "Here's a plan I've put together — review and edit it below ⬇");
      showImportPreview(body.proposal);
    } else {
      APP.projectChat.push({ role: 'assistant', content: body.message });
      addChatBubble('assistant', body.message);
    }
  } catch (e) {
    typingEl.remove();
    addChatBubble('assistant', '⚠️ ' + (e.message || 'Something went wrong — try again'));
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function showImportPreview(body) {
  document.getElementById('import-proj-icon').value  = body.icon || '📁';
  document.getElementById('import-proj-title').value = body.title || '';
  document.getElementById('import-proj-desc').value  = body.description || '';
  renderImportTasksList(body.tasks || []);

  document.getElementById('import-step-upload').classList.add('hidden');
  document.getElementById('import-upload-actions').classList.add('hidden');
  document.getElementById('import-upload-actions').classList.remove('flex');
  document.getElementById('import-step-preview').classList.remove('hidden');
  document.getElementById('import-preview-actions').classList.remove('hidden');
  document.getElementById('import-preview-actions').classList.add('flex');
}

async function runProjectProposal(doFetch, loadingLabel, failMessage) {
  const errorEl = document.getElementById('import-error');
  const btn = document.getElementById('import-analyze-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${loadingLabel}`;

  try {
    const res = await doFetch();
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || failMessage);
    showImportPreview(body);
  } catch (e) {
    errorEl.textContent = e.message || failMessage;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

const IMPORT_PRIORITIES = ['High', 'Medium', 'Low'];
const IMPORT_STATUSES   = ['Not Started', 'In Progress', 'Completed'];

function renderImportTasksList(tasks) {
  document.getElementById('import-task-count').textContent = tasks.length;
  document.getElementById('import-tasks-list').innerHTML = tasks.map((t, i) => `
    <div class="border border-gray-200 rounded-lg p-3" data-task-index="${i}">
      <div class="flex items-start gap-2 mb-2">
        <input type="text" class="import-task-title flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-teal" value="${esc(t.title || '')}">
        <button onclick="this.closest('[data-task-index]').remove(); updateImportTaskCount();" class="text-gray-300 hover:text-red-500 text-sm p-1.5 rounded hover:bg-red-50">🗑️</button>
      </div>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <select class="import-task-priority border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-teal">
          ${IMPORT_PRIORITIES.map(p => `<option ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <select class="import-task-status border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-teal">
          ${IMPORT_STATUSES.map(s => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input type="date" class="import-task-start border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-teal" value="${t.startDate || ''}">
        <input type="date" class="import-task-end border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-teal" value="${t.endDate || ''}">
      </div>
    </div>`).join('') || `<p class="text-xs text-gray-400 text-center py-4">No tasks found in that file — you can still create the project and add tasks manually.</p>`;
}

function updateImportTaskCount() {
  document.getElementById('import-task-count').textContent = document.querySelectorAll('#import-tasks-list [data-task-index]').length;
}

async function createImportedProject() {
  const title = document.getElementById('import-proj-title').value.trim();
  if (!title) { showToast('Project title is required', 'error'); return; }

  const btn = document.getElementById('import-create-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const proj = await API.addProject({
      title,
      icon: document.getElementById('import-proj-icon').value.trim() || '📁',
      description: document.getElementById('import-proj-desc').value.trim(),
    });

    const rows = document.querySelectorAll('#import-tasks-list [data-task-index]');
    for (const row of rows) {
      const taskTitle = row.querySelector('.import-task-title').value.trim();
      if (!taskTitle) continue;
      await API.addTask({
        projectId: proj.id,
        title: taskTitle,
        priority: row.querySelector('.import-task-priority').value,
        status: row.querySelector('.import-task-status').value,
        startDate: row.querySelector('.import-task-start').value,
        endDate: row.querySelector('.import-task-end').value,
      });
    }

    closeModal('modal-import');
    showToast(`✅ Created "${title}" with ${rows.length} task${rows.length === 1 ? '' : 's'}`);
    if (APP.currentProjectId) renderProjectDetail(APP.currentProjectId); else renderProjects();
    updateSidebar();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to create project'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function openAddProject() {
  document.getElementById('modal-project-title').textContent = 'New Project';
  document.getElementById('proj-id').value     = '';
  document.getElementById('proj-parent').value = '';
  document.getElementById('proj-title').value  = '';
  document.getElementById('proj-desc').value   = '';
  document.getElementById('proj-icon').value   = '📁';
  document.getElementById('proj-color').value  = '#0A7E8C';
  document.getElementById('proj-start').value  = '';
  document.getElementById('proj-type').value   = 'career';
  document.getElementById('proj-type-wrap').classList.remove('hidden');
  openModal('modal-project');
}

function openAddSubfolder(parentId) {
  document.getElementById('modal-project-title').textContent = 'New Sub-folder';
  document.getElementById('proj-id').value     = '';
  document.getElementById('proj-parent').value = parentId;
  document.getElementById('proj-title').value  = '';
  document.getElementById('proj-desc').value   = '';
  document.getElementById('proj-icon').value   = '📁';
  document.getElementById('proj-color').value  = '#0A7E8C';
  document.getElementById('proj-start').value  = '';
  document.getElementById('proj-type').value   = 'career';
  document.getElementById('proj-type-wrap').classList.add('hidden');
  openModal('modal-project');
}

async function editProject(id) {
  const p = await API.getProject(id);
  document.getElementById('modal-project-title').textContent = p.parentId ? 'Edit Sub-folder' : 'Edit Project';
  document.getElementById('proj-id').value     = id;
  document.getElementById('proj-parent').value = p.parentId || '';
  document.getElementById('proj-title').value  = p.title;
  document.getElementById('proj-desc').value   = p.description || '';
  document.getElementById('proj-icon').value   = p.icon;
  document.getElementById('proj-color').value  = p.color;
  document.getElementById('proj-start').value  = p.startDate || '';
  document.getElementById('proj-type').value   = p.type || 'career';
  document.getElementById('proj-type-wrap').classList.toggle('hidden', !!p.parentId);
  openModal('modal-project');
}

async function saveProject() {
  const id   = document.getElementById('proj-id').value;
  const data = {
    title:       document.getElementById('proj-title').value.trim(),
    description: document.getElementById('proj-desc').value.trim(),
    icon:        document.getElementById('proj-icon').value.trim() || '📁',
    color:       document.getElementById('proj-color').value,
    startDate:   document.getElementById('proj-start').value,
    parentId:    document.getElementById('proj-parent').value || null,
    type:        document.getElementById('proj-parent').value ? undefined : document.getElementById('proj-type').value,
  };
  if (!data.title) { showToast('Project title is required', 'error'); return; }
  try {
    if (id) { await API.updateProject(id, data); showToast('✅ Project updated'); }
    else    { await API.addProject(data);         showToast(data.parentId ? '✅ Sub-folder created' : '✅ Project created'); }
    closeModal('modal-project');
    if (APP.currentProjectId) renderProjectDetail(APP.currentProjectId);
    else renderProjects();
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to save project'), 'error'); }
}

async function deleteProjectConfirm(id) {
  const p = await API.getProject(id);
  const isSubfolder = !!p?.parentId;
  confirmAction(`Move "${p?.title}" to Trash? ${isSubfolder ? 'All its tasks' : 'All its sub-folders and tasks'} will go with it. You can restore it from Settings within 30 days.`, async () => {
    await API.deleteProject(id);
    showToast('🗑️ ' + (isSubfolder ? 'Sub-folder' : 'Project') + ' moved to Trash');
    if (APP.currentProjectId === id) {
      // Was viewing the thing we just deleted — go up to its parent, or the flat list if it was top-level.
      if (isSubfolder) await showPage('project-detail', p.parentId);
      else await showPage('projects');
    } else if (APP.currentProjectId) {
      renderProjectDetail(APP.currentProjectId); // deleted a sibling sub-folder while viewing its parent
    } else {
      renderProjects();
    }
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  });
}

// TASK MODAL
async function openAddTask(projectId) {
  document.getElementById('modal-task-title').textContent = 'New Task';
  document.getElementById('task-id').value         = '';
  document.getElementById('task-title-in').value   = '';
  document.getElementById('task-status').value     = 'Not Started';
  document.getElementById('task-priority').value   = 'High';
  document.getElementById('task-start').value      = '';
  document.getElementById('task-end').value        = '';
  document.getElementById('task-cost').value       = '';
  document.getElementById('task-notes').value      = '';
  document.getElementById('task-recurrence').value = 'none';
  document.getElementById('task-checklist-section').classList.add('hidden');
  APP.taskModalTagIds = [];
  await renderTaskTagPicker();
  await populateProjectSelect(projectId);
  openModal('modal-task');
}

async function editTask(id) {
  const t = await API.getTask(id);
  document.getElementById('modal-task-title').textContent = 'Edit Task';
  document.getElementById('task-id').value         = id;
  document.getElementById('task-title-in').value   = t.title;
  document.getElementById('task-status').value     = t.status;
  document.getElementById('task-priority').value   = t.priority;
  document.getElementById('task-start').value      = t.startDate || '';
  document.getElementById('task-end').value        = t.endDate || '';
  document.getElementById('task-cost').value       = t.cost || '';
  document.getElementById('task-notes').value      = t.notes || '';
  document.getElementById('task-recurrence').value = t.recurrence || 'none';
  document.getElementById('task-checklist-section').classList.remove('hidden');
  renderTaskChecklist(id);
  APP.taskModalTagIds = (t.tags || []).map(tag => tag.id);
  await renderTaskTagPicker();
  await populateProjectSelect(t.projectId);
  openModal('modal-task');
}

// ── TAGS (task modal picker) ────────────────────────────────────
async function renderTaskTagPicker() {
  const wrap = document.getElementById('task-tag-picker');
  try {
    const tags = await API.getTags();
    wrap.innerHTML = tags.length
      ? tags.map(tag => {
          const on = (APP.taskModalTagIds || []).includes(tag.id);
          return `<button type="button" onclick="toggleTaskModalTag('${tag.id}')"
            class="text-xs font-semibold px-2.5 py-1 rounded-full border transition-all"
            style="${on ? `background:${tag.color};border-color:${tag.color};color:#fff` : `background:transparent;border-color:${tag.color};color:${tag.color}`}">${esc(tag.label)}</button>`;
        }).join('')
      : `<p class="text-xs text-gray-400">No tags yet — create one below</p>`;
  } catch (e) { console.error('Tags error:', e); }
}

function toggleTaskModalTag(id) {
  APP.taskModalTagIds = APP.taskModalTagIds || [];
  const i = APP.taskModalTagIds.indexOf(id);
  if (i === -1) APP.taskModalTagIds.push(id); else APP.taskModalTagIds.splice(i, 1);
  renderTaskTagPicker();
}

async function createTagFromTaskModal() {
  const labelEl = document.getElementById('task-new-tag-label');
  const label = labelEl.value.trim();
  if (!label) return;
  const color = document.getElementById('task-new-tag-color').value;
  try {
    const tag = await API.addTag({ label, color });
    labelEl.value = '';
    APP.taskModalTagIds = APP.taskModalTagIds || [];
    APP.taskModalTagIds.push(tag.id);
    renderTaskTagPicker();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to create tag'), 'error'); }
}

// ── CHECKLIST (subtasks within a task) ──────────────────────────
async function renderTaskChecklist(taskId) {
  const wrap = document.getElementById('task-checklist-items');
  try {
    const items = await API.getChecklist(taskId);
    const done = items.filter(i => i.completed).length;
    document.getElementById('task-checklist-count').textContent = items.length ? `(${done}/${items.length})` : '';
    wrap.innerHTML = items.map(i => `
      <div class="flex items-center gap-2 group">
        <input type="checkbox" ${i.completed ? 'checked' : ''} onchange="toggleTaskChecklistItem('${i.id}', this.checked, '${taskId}')">
        <span class="flex-1 text-sm ${i.completed ? 'line-through text-gray-400' : 'text-navy'}">${esc(i.title)}</span>
        <button onclick="removeTaskChecklistItem('${i.id}', '${taskId}')" class="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 px-1">🗑️</button>
      </div>`).join('');
    refreshTaskListsAfterChecklistChange();
  } catch (e) { console.error('Checklist error:', e); }
}

async function addTaskChecklistItem() {
  const taskId = document.getElementById('task-id').value;
  const input = document.getElementById('task-checklist-input');
  const title = input.value.trim();
  if (!taskId || !title) return;
  await API.addChecklistItem(taskId, title);
  input.value = '';
  renderTaskChecklist(taskId);
}

async function toggleTaskChecklistItem(id, completed, taskId) {
  await API.updateChecklistItem(id, { completed });
  renderTaskChecklist(taskId);
}

async function removeTaskChecklistItem(id, taskId) {
  await API.deleteChecklistItem(id);
  renderTaskChecklist(taskId);
}

// The checklist badge shown on task rows/cards is only as fresh as the
// last full render — refresh whichever list is currently on screen after
// a checklist edit so the "n/m" count doesn't go stale while the modal's
// still open.
function refreshTaskListsAfterChecklistChange() {
  if (APP.currentPage === 'project-detail') renderTaskTable(APP.currentProjectId);
  if (APP.currentPage === 'gantt') renderGantt();
}

let _projectStartDates = {};

function onTaskProjectChange() {
  const projectId = document.getElementById('task-project').value;
  document.getElementById('task-start').min = _projectStartDates[projectId] || '';
}

// Projects can have one level of sub-folders — group the dropdown by
// top-level project, with its sub-folders nested under it, so a task can be
// assigned either straight to a project or to one of its sub-folders.
async function populateProjectSelect(selectedId) {
  const allProjects = await API.getProjects();
  _projectStartDates = Object.fromEntries(allProjects.map(p => [p.id, p.startDate || '']));
  document.getElementById('task-start').min = _projectStartDates[selectedId] || '';

  const topLevel = allProjects.filter(p => !p.parentId);
  const childrenOf = pid => allProjects.filter(p => p.parentId === pid);

  document.getElementById('task-project').innerHTML = topLevel.map(top => {
    const kids = childrenOf(top.id);
    const topOption = `<option value="${top.id}" ${top.id === selectedId ? 'selected' : ''}>${top.icon} ${esc(top.title)}</option>`;
    if (!kids.length) return topOption;
    const kidOptions = kids.map(k =>
      `<option value="${k.id}" ${k.id === selectedId ? 'selected' : ''}>${k.icon} ${esc(k.title)}</option>`
    ).join('');
    return `<optgroup label="${esc(top.title)}">${topOption}${kidOptions}</optgroup>`;
  }).join('');
}

async function saveTask() {
  const id = document.getElementById('task-id').value;

  const data = {
    projectId: document.getElementById('task-project').value,
    title:     document.getElementById('task-title-in').value.trim(),
    status:    document.getElementById('task-status').value,
    priority:  document.getElementById('task-priority').value,
    startDate: document.getElementById('task-start').value,
    endDate:   document.getElementById('task-end').value,
    cost:      parseFloat(document.getElementById('task-cost').value) || 0,
    notes:     document.getElementById('task-notes').value.trim(),
    recurrence: document.getElementById('task-recurrence').value,
  };
  if (!data.title)     { showToast('Task title is required', 'error'); return; }
  if (!data.projectId) { showToast('Please select a project', 'error'); return; }
  try {
    let taskId = id;
    if (id) {
      const wasCompleted = (await API.getTask(id)).status === 'Completed';
      await API.updateTask(id, data);
      const justRecurred = !wasCompleted && data.status === 'Completed' && data.recurrence !== 'none';
      showToast(justRecurred ? '✅ Task completed — next occurrence scheduled' : '✅ Task updated');
    } else {
      const created = await API.addTask(data);
      taskId = created.id;
      showToast('✅ Task added');
    }
    await API.setTaskTags(taskId, APP.taskModalTagIds || []);
    closeModal('modal-task');
    if (APP.currentProjectId) renderTaskTable(APP.currentProjectId);
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to save task'), 'error'); }
}

async function deleteTaskConfirm(id, projectId) {
  const t = await API.getTask(id);
  confirmAction(`Move "${t?.title}" to Trash? You can restore it from Settings within 30 days.`, async () => {
    await API.deleteTask(id);
    showToast('🗑️ Task moved to Trash');
    renderTaskTable(projectId);
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  });
}

// ACTION MODAL
// LOG MODAL
async function openAddLog() {
  const now = new Date();
  document.getElementById('log-month').value    = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  document.getElementById('log-income').value   = '';
  document.getElementById('log-business').value = '';
  document.getElementById('log-expenses').value = '';
  document.getElementById('log-saved').value    = '';
  document.getElementById('log-notes').value    = '';
  const profile = await API.getProfile();
  document.querySelectorAll('.log-currency').forEach(el => el.textContent = profile.currency || '£');
  openModal('modal-log');
}

async function saveLog() {
  const income   = parseFloat(document.getElementById('log-income').value)   || 0;
  const business = parseFloat(document.getElementById('log-business').value) || 0;
  const expenses = parseFloat(document.getElementById('log-expenses').value) || 0;
  const saved    = parseFloat(document.getElementById('log-saved').value)    || (income + business - expenses);
  try {
    await API.addMonthlyEntry({
      month: document.getElementById('log-month').value,
      income, business, expenses, saved,
      notes: document.getElementById('log-notes').value.trim(),
    });
    closeModal('modal-log');
    renderWealth();
    showToast('✅ Month logged');
  } catch (e) { showToast('❌ Failed to save entry', 'error'); }
}

// WEALTH CATEGORY MODAL
async function openAddWealthCat() {
  document.getElementById('wcat-key').value    = '';
  document.getElementById('wcat-label').value  = '';
  document.getElementById('wcat-target').value = '';
  document.getElementById('modal-wcat-title').textContent = 'Add Wealth Category';
  document.getElementById('wcat-save-btn').textContent    = 'Add Category';
  const profile = await API.getProfile();
  document.getElementById('wcat-target-currency').textContent = profile.currency || '£';
  openModal('modal-wcat');
}

async function editWealthCat(key) {
  const wealth = await API.getWealth();
  const wt = wealth.targets[key];
  if (!wt) return;
  document.getElementById('wcat-key').value    = key;
  document.getElementById('wcat-label').value  = wt.label;
  document.getElementById('wcat-target').value = wt.target;
  document.getElementById('modal-wcat-title').textContent = 'Edit Wealth Category';
  document.getElementById('wcat-save-btn').textContent    = 'Save Changes';
  const profile = await API.getProfile();
  document.getElementById('wcat-target-currency').textContent = profile.currency || '£';
  openModal('modal-wcat');
}

async function saveWealthCat() {
  const key    = document.getElementById('wcat-key').value;
  const label  = document.getElementById('wcat-label').value.trim();
  const target = parseFloat(document.getElementById('wcat-target').value) || 0;
  if (!label) { showToast('Label is required', 'error'); return; }
  try {
    if (key) {
      await API.updateWealthCategory(key, { label, target });
      showToast('✅ Category updated');
    } else {
      await API.addWealthCategory({ label, target });
      showToast('✅ Category added');
    }
    closeModal('modal-wcat');
    renderWealth();
  } catch (e) { showToast('❌ Failed to save category', 'error'); }
}

function deleteWealthCatConfirm(key, label) {
  confirmAction(`Delete "${label}"? Its logged value will be lost.`, async () => {
    await API.deleteWealthCategory(key);
    renderWealth();
    showToast('🗑️ Category deleted');
  });
}

// ── EXPORT / IMPORT ─────────────────────────────────────────────
async function exportData() {
  try {
    const [profile, projects, tasks, wealth] = await Promise.all([
      API.getProfile(), API.getProjects(), API.getTasks(), API.getWealth(),
    ]);
    const blob = new Blob(
      [JSON.stringify({ profile, projects, tasks, wealth }, null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'waypoint_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    showToast('✅ Data exported!');
  } catch (e) { showToast('❌ Export failed', 'error'); }
}

function importData() {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      let data;
      try { data = JSON.parse(ev.target.result); }
      catch { showToast('❌ Invalid file', 'error'); return; }

      const projCount = (data.projects || []).length;
      const taskCount = (data.tasks || []).length;
      confirmAction(
        `Import ${projCount} project${projCount === 1 ? '' : 's'} and ${taskCount} task${taskCount === 1 ? '' : 's'} from this file? This adds to what's already here — it won't replace or remove anything.`,
        () => runImportData(data)
      );
    };
    reader.readAsText(file);
  };
  input.click();
}

async function runImportData(data) {
  try {
    const result = await API.importData(data);
    showToast(`✅ Imported ${result.projects} project${result.projects === 1 ? '' : 's'}, ${result.tasks} task${result.tasks === 1 ? '' : 's'}`);
    if (APP.currentProjectId) renderProjectDetail(APP.currentProjectId);
    else await showPage(APP.currentPage);
    updateSidebar();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Import failed'), 'error');
  }
}

async function resetData() {
  confirmAction('Reset ALL data? This cannot be undone.', async () => {
    showToast('✅ Reset — restart your server to apply');
  });
}

// ── INIT ─────────────────────────────────────────────────────────
async function init() {
  document.getElementById('topbar-date').textContent =
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  applyThemeIcon();
  handleDriveRedirect();
  handleAuthRedirect();
  if (handleResetTokenRedirect()) return;
  const authed = await checkAuth();
  if (authed) await afterAuth();
}

document.addEventListener('DOMContentLoaded', init);