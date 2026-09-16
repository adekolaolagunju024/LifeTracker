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
  const icon = isDark ? '☀️' : '🌙';
  const iconEl = document.getElementById('theme-toggle-icon');
  const iconSettingsEl = document.getElementById('theme-toggle-icon-settings');
  const labelEl = document.getElementById('theme-toggle-label');
  if (iconEl) iconEl.textContent = icon;
  if (iconSettingsEl) iconSettingsEl.textContent = icon;
  if (labelEl) labelEl.textContent = isDark ? 'Dark mode' : 'Light mode';
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

// ── NAVIGATION ─────────────────────────────────────────────────
function showPage(id, projectId = null) {
  APP.currentPage      = id;
  APP.currentProjectId = projectId;
  APP.filters          = { status: '', priority: '', search: '' };
  closeMobileSidebar();

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pg = document.getElementById('page-' + (projectId ? 'project-detail' : id));
  if (pg) pg.classList.add('active');

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
    const [profile, wealth, projects] = await Promise.all([
      API.getProfile(),
      API.getWealth(),
      API.getProjects({ parentId: 'null' }),
    ]);

    const nw     = Object.values(wealth.entries || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const target = profile.targetNetWorth || 100000;
    const p      = pct(nw, target);
    const cur    = profile.currency || '£';

    document.getElementById('sidebar-name').textContent    = profile.name;
    document.getElementById('sidebar-tagline').textContent = profile.tagline;
    document.getElementById('sidebar-nw').textContent      = fmt(nw, cur);
    document.getElementById('sidebar-prog').style.width    = p + '%';
    document.getElementById('sidebar-sub').textContent     = fmt(nw, cur) + ' of ' + fmt(target, cur);

    // Rebuild project nav
    document.getElementById('project-nav').innerHTML = projects.map(proj => `
      <button class="nav-item w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white/55 text-sm font-medium hover:bg-white/10 hover:text-white transition-all ${APP.currentProjectId === proj.id ? 'active' : ''}"
        onclick="showPage('project-detail','${proj.id}')">
        <span class="text-base w-5 text-center">${proj.icon}</span>
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
    const projects       = allProjects.filter(p => !p.parentId); // top-level only, for the glance cards
    const careerProjects = projects.filter(p => p.type !== 'wealth');
    const hasCareer      = careerProjects.length > 0;
    const hasWealth      = projects.some(pr => pr.type === 'wealth');

    const done   = tasks.filter(t => t.status === 'Completed').length;
    const inprog = tasks.filter(t => t.status === 'In Progress').length;
    const nw     = Object.values(wealth.entries || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const target = profile.targetNetWorth || 100000;
    const p      = pct(nw, target);
    const cur    = profile.currency || '£';

    // Dashboard is dynamic: a hero/KPI for a project type only shows up once
    // a project of that type actually exists, and the survivor(s) reflow to
    // fill the row. Adding a new type later just needs its own toggle here.
    document.getElementById('kpi-nw-card').classList.toggle('hidden', !hasWealth);
    document.getElementById('kpi-grid').classList.toggle('md:grid-cols-4', hasWealth);
    document.getElementById('kpi-grid').classList.toggle('md:grid-cols-3', !hasWealth);

    document.getElementById('hero-nw-card').classList.toggle('hidden', !hasWealth);
    document.getElementById('hero-career-card').classList.toggle('hidden', !hasCareer);
    const soloHero = hasCareer !== hasWealth; // exactly one of the two is showing
    document.getElementById('hero-nw-card').classList.toggle('md:col-span-2', soloHero && hasWealth);
    document.getElementById('hero-career-card').classList.toggle('md:col-span-2', soloHero && hasCareer);

    // KPIs
    document.getElementById('kpi-total').textContent  = tasks.length;
    document.getElementById('kpi-done').textContent   = done;
    document.getElementById('kpi-inprog').textContent = inprog;
    document.getElementById('kpi-nw').textContent     = fmt(nw, cur);
    document.getElementById('hero-name').textContent  = profile.name.split(' ')[0];

    // Hero
    document.getElementById('hero-nw').textContent   = fmt(nw, cur);
    document.getElementById('hero-left').textContent = p + '% of your ' + fmt(target, cur) + ' target';
    document.getElementById('hero-prog').style.width = p + '%';
    document.getElementById('hero-pct').textContent  = p + '% complete';

    // Career Progress hero — overall task completion across all projects
    const careerPct = pct(done, tasks.length);
    document.getElementById('hero-career-pct').textContent    = careerPct + '%';
    document.getElementById('hero-career-sub').textContent    = `${done} of ${tasks.length} tasks complete`;
    document.getElementById('hero-career-prog').style.width   = careerPct + '%';
    document.getElementById('hero-career-detail').textContent = `across ${careerProjects.length} project${careerProjects.length === 1 ? '' : 's'}`;

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

    // Urgent tasks
    const urgent = tasks.filter(t => t.status === 'In Progress' && t.priority === 'High').slice(0, 6);
    document.getElementById('urgent-tasks').innerHTML = urgent.length
      ? urgent.map(t => {
          const proj = allProjects.find(p => p.id === t.projectId);
          return `<tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="px-4 py-3 text-lg">${proj?.icon || '📌'}</td>
            <td class="px-4 py-3 text-sm font-medium cursor-pointer hover:text-teal" onclick="openTaskDetail('${t.id}')">${esc(t.title)}</td>
            <td class="px-4 py-3 text-xs text-gray-500">${proj?.title || ''}</td>
            <td class="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">${t.endDate || '—'}</td>
            <td class="px-4 py-3">${statusBadge(t.status)}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400 text-sm">No urgent tasks right now 🎉</td></tr>`;

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
    const [tasks, project] = await Promise.all([
      API.getTasks({
        projectId,
        status:   APP.filters.status   || undefined,
        priority: APP.filters.priority || undefined,
        search:   APP.filters.search   || undefined,
      }),
      API.getProject(projectId),
    ]);
    const minStart = project.startDate || '';

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

    document.getElementById('task-table-body').innerHTML = tasks.length
      ? tasks.map(t => `
          <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="px-4 py-3 text-sm font-semibold max-w-xs cursor-pointer hover:text-teal border-l-4" style="border-left-color:${priorityBorderColor(t.priority)}" onclick="openTaskDetail('${t.id}')">${esc(t.title)}${t.recurrence && t.recurrence !== 'none' ? ` <span class="text-gray-400 font-normal text-xs" title="Repeats ${t.recurrence}">🔁</span>` : ''}</td>
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
      : `<tr><td colspan="7" class="px-4 py-10 text-center text-gray-400 text-sm">
          No tasks match your filters.
          <button onclick="clearFilters('${projectId}')" class="text-teal underline ml-1">Clear filters</button>
          or <button onclick="openAddTask('${projectId}')" class="text-teal underline">add a task</button>.
        </td></tr>`;

  } catch (e) { console.error('Task table error:', e); }
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
  renderTaskTable(projectId);
}

function clearFilters(projectId) {
  APP.filters = { status: '', priority: '', search: '' };
  ['filter-status','filter-priority','filter-search']
    .forEach(id => { document.getElementById(id).value = ''; });
  renderTaskTable(projectId);
}

// ── GANTT ───────────────────────────────────────────────────────
let ganttCollapsed = new Set();
let ganttGroupIds = []; // every group id currently rendered — kept up to date by renderGantt(), used by Collapse All
const GANTT_GRID_COLS = '200px 90px 85px 85px 70px 1fr';

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
  const btn = document.getElementById('gantt-export-img-btn');
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

    document.getElementById('gantt-legend').innerHTML = `
      <div class="flex gap-4 text-xs text-gray-500 flex-wrap mb-1.5">${groupLegend}</div>
      <div class="flex gap-4 text-xs text-gray-500 flex-wrap">
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm border-2" style="border-color:${PRIORITY_BORDER.High}"></span>High priority</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm border-2" style="border-color:${PRIORITY_BORDER.Medium}"></span>Medium</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-2 rounded-sm border-2" style="border-color:${PRIORITY_BORDER.Low}"></span>Low</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-2 h-2 bg-gray-400 rounded-sm" style="transform:rotate(45deg)"></span>Due date only</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-1.5 rounded-sm bg-gray-700"></span>Folder summary</span>
        <span class="flex items-center gap-1.5"><span class="inline-block w-0.5 h-3 bg-red-500 rounded"></span>Today</span>
      </div>`;

  } catch (e) { console.error('Gantt error:', e); }
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

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAhead = new Date(today); weekAhead.setDate(weekAhead.getDate() + 7);

    const overdue = [], dueThisWeek = [], highPriority = [];
    tasks.forEach(t => {
      if (t.status === 'Completed') return;
      const due = t.endDate ? new Date(t.endDate) : null;
      if (due && due < today)      { overdue.push(t);      return; }
      if (due && due <= weekAhead) { dueThisWeek.push(t);  return; }
      if (t.status === 'In Progress' && t.priority === 'High') { highPriority.push(t); return; }
    });
    overdue.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
    dueThisWeek.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
    highPriority.sort((a, b) => a.title.localeCompare(b.title));

    document.getElementById('act-overdue').textContent = overdue.length;
    document.getElementById('act-week').textContent    = dueThisWeek.length;
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

    document.getElementById('action-list').innerHTML =
      section('Overdue', '🔴', overdue, t => {
        const days = Math.round((today - new Date(t.endDate)) / 86400000);
        return `${days} day${days === 1 ? '' : 's'} overdue`;
      }, 'Nothing overdue 🎉') +
      section('Due This Week', '🟡', dueThisWeek, t => {
        const days = Math.round((new Date(t.endDate) - today) / 86400000);
        return days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`;
      }, 'Nothing due this week') +
      section('High Priority — In Progress', '⭐', highPriority, () => '', 'No other high-priority tasks in progress');

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
    renderSettingsDrive();
    API.getMe().then(me => { document.getElementById('account-email').textContent = me.email; }).catch(() => {});
  } catch (e) { console.error('Settings error:', e); }
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
    showToast('✅ All set up — welcome to LifeTracker!');
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
function openImportProject() {
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-error').classList.add('hidden');
  document.getElementById('import-step-upload').classList.remove('hidden');
  document.getElementById('import-upload-actions').classList.remove('hidden');
  document.getElementById('import-upload-actions').classList.add('flex');
  document.getElementById('import-step-preview').classList.add('hidden');
  document.getElementById('import-preview-actions').classList.add('hidden');
  document.getElementById('import-preview-actions').classList.remove('flex');
  openModal('modal-import');
}

async function analyzeImportFile() {
  const fileInput = document.getElementById('import-file-input');
  const errorEl = document.getElementById('import-error');
  errorEl.classList.add('hidden');
  const file = fileInput.files[0];
  if (!file) { errorEl.textContent = 'Choose a file first'; errorEl.classList.remove('hidden'); return; }

  const btn = document.getElementById('import-analyze-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Reading file with Claude… (~15-20s)`;

  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/ai/import-project', { method: 'POST', body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Import failed');

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
  } catch (e) {
    errorEl.textContent = e.message || 'Failed to read that file';
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
  confirmAction(`Delete "${p?.title}"? ${isSubfolder ? 'All its tasks' : 'All its sub-folders and tasks'} will also be deleted.`, async () => {
    await API.deleteProject(id);
    showToast('🗑️ ' + (isSubfolder ? 'Sub-folder' : 'Project') + ' deleted');
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
  await populateProjectSelect(t.projectId);
  openModal('modal-task');
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
    if (id) {
      const wasCompleted = (await API.getTask(id)).status === 'Completed';
      await API.updateTask(id, data);
      const justRecurred = !wasCompleted && data.status === 'Completed' && data.recurrence !== 'none';
      showToast(justRecurred ? '✅ Task completed — next occurrence scheduled' : '✅ Task updated');
    } else {
      await API.addTask(data);
      showToast('✅ Task added');
    }
    closeModal('modal-task');
    if (APP.currentProjectId) renderTaskTable(APP.currentProjectId);
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to save task'), 'error'); }
}

async function deleteTaskConfirm(id, projectId) {
  const t = await API.getTask(id);
  confirmAction(`Delete "${t?.title}"?`, async () => {
    await API.deleteTask(id);
    showToast('🗑️ Task deleted');
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
    a.download = 'lifetracker_backup_' + new Date().toISOString().slice(0, 10) + '.json';
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