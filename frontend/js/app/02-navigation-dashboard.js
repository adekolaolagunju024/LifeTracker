// Waypoint app, part 2 of 12: Navigation, the sidebar, the dashboard and the projects list.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── NAVIGATION ─────────────────────────────────────────────────
// A lightweight back button — there's no real browser routing here (one
// index.html, no history.pushState), so "back" is an in-app stack of
// wherever showPage() was called from, not actual browser history.
function showPage(id, projectId = null, _skipHistory = false) {
  if (id !== 'gantt' && isJourneyFullscreen()) setJourneyFullscreen(false);
  if (!_skipHistory && APP.currentPage !== undefined) {
    const isSamePlace = APP.currentPage === id && APP.currentProjectId === projectId;
    if (!isSamePlace) {
      APP.navHistory = APP.navHistory || [];
      APP.navHistory.push({ page: APP.currentPage, projectId: APP.currentProjectId });
      if (APP.navHistory.length > 30) APP.navHistory.shift(); // cap — this is a nav trail, not an audit log
    }
  }

  APP.currentPage      = id;
  APP.currentProjectId = projectId;
  APP.filters          = { status: '', priority: '', search: '', tag: '' };
  closeMobileSidebar();
  if (APP.chatProjectId) closeProjectChat(); // stop polling — don't leave chat open on a page we navigated away from
  if (id !== 'gantt') JourneyGame.destroy(document.getElementById('mountain-scene')); // Journey only lives on the Gantt page — free its game loop elsewhere

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  syncBottomNav(id);

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
    gantt: 'Planner',       actions: 'Actions',
    settings: 'Settings',   calendar: 'Calendar',
    chats: 'Chats',
  };
  document.getElementById('topbar-title').textContent =
    projectId ? '' : (titles[id] || id);

  if (id === 'dashboard')      renderDashboard();
  if (id === 'projects')       renderProjects();
  if (id === 'project-detail') renderProjectDetail(projectId);
  if (id === 'gantt')          renderGantt();
  if (id === 'actions')        renderActions();
  if (id === 'settings')       renderSettings();
  if (id === 'calendar')       renderCalendar();
  if (id === 'chats')          renderChats();

  updateSidebar();
  updateBackButton();
}

function goBack() {
  if (!APP.navHistory || !APP.navHistory.length) return;
  const prev = APP.navHistory.pop();
  showPage(prev.page, prev.projectId, true);
}

function updateBackButton() {
  const btn = document.getElementById('topbar-back-btn');
  if (btn) btn.classList.toggle('hidden', !(APP.navHistory && APP.navHistory.length));
}

// The name to greet someone by: empty until they've actually given one
// (new accounts start with the placeholder "Your Name", which read as
// "Welcome back, Your" on the dashboard).
function profileName(profile) {
  const name = String((profile && profile.name) || '').trim();
  return name && name !== 'Your Name' ? name : '';
}

// The phone tab bar's highlighted tab. The Journey is a view of the
// Planner (its toggle sits at the top), so Planner covers it.
function syncBottomNav(page) {
  document.querySelectorAll('#bottom-nav [data-tab]').forEach(b => {
    const on = b.dataset.tab === page;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

// ── DASHBOARD BENTO ────────────────────────────────────────────
// The top of the dashboard in the house style: a greeting, the focus goal
// as a navy card with its Journey stage (one segment per stop, the next
// stop outlined, the finish in pink) and a Play button, the next few
// tasks to tick off right here, and this week against last week.
const STAGE_NAMES = { football: 'Football', castle: 'Castle', ocean: 'Ocean', space: 'Space', corporate: 'Corporate', construction: 'Construction', life: 'Life Path', launch: 'Product Launch' };
function dueLabel(endDate, todayKey) {
  if (!endDate) return { text: '', late: false };
  if (endDate < todayKey) return { text: `${formatDateShort(endDate)} · late`, late: true };
  if (endDate === todayKey) return { text: 'Today', late: false };
  const days = Math.round((new Date(endDate + 'T00:00:00') - new Date(todayKey + 'T00:00:00')) / 86400000);
  if (days === 1) return { text: 'Tomorrow', late: false };
  if (days < 7) return { text: new Date(endDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' }), late: false };
  return { text: formatDateShort(endDate), late: false };
}
function renderDashboardBento(tasks, allProjects) {
  const now = new Date();
  const todayKey = localDateKey(now);
  const hour = now.getHours();
  document.getElementById('dash-date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('dash-greeting').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // Focus goal: the top-level project with the soonest open due date.
  const roots = allProjects.filter(p => !p.parentId);
  const candidates = roots.map(p => {
    const tree = tasksInProjectTree(p.id, allProjects, tasks).slice()
      .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999') || (a.createdAt || '').localeCompare(b.createdAt || ''));
    const open = tree.filter(t => t.status !== 'Completed');
    return { p, tree, open, soonest: open.map(t => t.endDate).filter(Boolean).sort()[0] || '9999' };
  }).filter(c => c.open.length).sort((a, b) => a.soonest.localeCompare(b.soonest));
  const focus = document.getElementById('dash-focus');
  const f = candidates[0];
  focus.classList.toggle('hidden', !f);
  if (f) {
    const done = f.tree.filter(t => t.status === 'Completed').length;
    const pctDone = ProgressMath.progressPct(f.tree);
    const expected = ProgressMath.expectedFraction(f.tree, f.p.startDate || (f.p.createdAt || '').slice(0, 10));
    const gap = expected === null ? null : pctDone - Math.round(expected * 100);
    const status = gap === null ? '' : gap >= 5 ? 'Ahead' : gap >= -5 ? 'On track' : gap >= -15 ? 'Slightly behind' : 'Behind';
    const next = f.open[0];
    const segCount = Math.min(f.tree.length, 12);
    const per = f.tree.length / segCount;
    const nextIndex = Math.floor(f.tree.indexOf(next) / per);
    const segs = Array.from({ length: segCount }, (_, i) => {
      const filled = Math.round((i + 1) * per) <= done;
      return `<span class="${filled ? 'done' : i === nextIndex ? 'next' : ''}"${i === segCount - 1 && !filled ? ' style="background:#FF8FB0"' : ''}></span>`;
    }).join('');
    const foes = next ? pendingFoes(next) : 0;
    focus.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] font-bold tracking-widest uppercase text-[#9FB3C8]">${esc(STAGE_NAMES[getJourneyStage()] || 'Journey')} stage</p>
        ${status ? `<p class="text-xs font-bold" style="color:${gap < -5 ? '#FDBA74' : '#5EEAD4'}">${status}</p>` : ''}
      </div>
      <button type="button" onclick="showPage('project-detail','${f.p.id}')" class="block text-left mt-2 text-xl font-extrabold text-white hover:underline">${esc(f.p.icon || '')} ${esc(f.p.title)}</button>
      <div class="focus-segs mt-3" style="grid-template-columns:repeat(${segCount},minmax(0,1fr))">${segs}</div>
      <div class="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <p class="text-sm text-[#C9D6E2] min-w-0">${pctDone}% · Next stop: ${esc(next.title)}${foes ? ` · ⚔️ ${foes} ${foes === 1 ? 'enemy' : 'enemies'}` : ''}</p>
        <div class="flex gap-2">
          <button type="button" onclick="openProgressReport('${f.p.id}')" class="text-sm font-bold text-white/80 hover:text-white px-3 min-h-[44px]">Report</button>
          <button type="button" onclick="playJourneyFor('${f.p.id}')" class="bg-[#5EEAD4] text-navy font-extrabold text-sm px-5 min-h-[44px] rounded-xl hover:brightness-105">▶ Play</button>
        </div>
      </div>`;
  }

  // Up next: the next few open tasks by due date, ticked off right here.
  const upnext = tasks.filter(t => t.status !== 'Completed')
    .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999') || (a.priority === 'High' ? -1 : 0)).slice(0, 5);
  const byId = Object.fromEntries(allProjects.map(p => [p.id, p]));
  document.getElementById('dash-upnext').innerHTML = upnext.length ? upnext.map(t => {
    const due = dueLabel(t.endDate, todayKey);
    const foes = pendingFoes(t);
    const waiting = waitingOn(t).length;
    return `<label class="flex items-center gap-3 min-h-[52px] border-b border-gray-100 last:border-0 cursor-pointer">
      <input type="checkbox" class="w-5 h-5 accent-teal flex-shrink-0" onchange="completeFromDashboard('${t.id}', this)" aria-label="Mark ${esc(t.title)} done" ${waiting ? 'disabled title="Waiting on another task"' : ''}>
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-semibold text-navy truncate">${waiting ? '🔒 ' : ''}${esc(t.title)}</span>
        <span class="block text-[11px] text-gray-500 truncate">${esc((byId[t.projectId] || {}).title || '')}</span>
      </span>
      ${foes ? `<span class="flex-shrink-0 text-[11px] font-extrabold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">⚔️ ${foes}</span>` : ''}
      <span class="flex-shrink-0 w-20 text-right text-xs font-semibold ${due.late ? 'text-red-600' : 'text-gray-500'}">${esc(due.text)}</span>
    </label>`;
  }).join('') : '<p class="text-sm text-gray-500 py-4">Nothing open. Plan your next goal with the assistant, or start from a template.</p>';

  // This week against last week.
  const DAY = 86400000;
  const nowMs = now.getTime();
  const inRange = (t, from, to) => t.status === 'Completed' && t.completedAt && Date.parse(t.completedAt) >= from && Date.parse(t.completedAt) < to;
  const week = tasks.filter(t => inRange(t, nowMs - 7 * DAY, nowMs + 1)).length;
  const prev = tasks.filter(t => inRange(t, nowMs - 14 * DAY, nowMs - 7 * DAY)).length;
  document.getElementById('dash-week-done').innerHTML = `${week} <span class="text-sm font-semibold text-gray-500">task${week === 1 ? '' : 's'} done</span>`;
  const trend = document.getElementById('dash-week-trend');
  trend.textContent = week > prev ? `Up ${week - prev} on last week` : week < prev ? `${prev - week} fewer than last week` : (week ? 'Level with last week' : 'A fresh week to start');
  trend.style.color = week >= prev ? '#1A7A4A' : '#9A4410';
}
async function completeFromDashboard(taskId, checkbox) {
  const task = await API.getTask(taskId).catch(() => null);
  const gate = taskGateMessage(task, 'Completed');
  if (gate) { checkbox.checked = false; showToast(gate, 'error'); return; }
  checkbox.disabled = true;
  try {
    await API.updateTask(taskId, { status: 'Completed' });
    checkbox.closest('label').classList.add('opacity-50', 'line-through');
    setTimeout(renderDashboard, 900);
  } catch (e) {
    checkbox.checked = false; checkbox.disabled = false;
    taskErrorToast(e, 'Could not complete that task');
  }
}
// The focus card's Play: straight into that project's Journey.
function playJourneyFor(projectId) {
  showPage('gantt');
  setGanttProjectFilter(projectId);
  setGanttPageView('journey');
}

// ── SIDEBAR ────────────────────────────────────────────────────
async function updateSidebar() {
  try {
    const [profile, projects] = await Promise.all([
      API.getProfile(),
      API.getProjects({ parentId: 'null' }),
    ]);
    APP.profile = profile; // kept fresh here since this runs on nearly every navigation — the cheapest reliable place for celebrationsEnabled() to read from

    document.getElementById('sidebar-name').textContent    = profileName(profile) || 'Welcome to Waypoint';
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
async function renderDashboard() {
  loadDailyQuests().then(g => {
    const pill = document.getElementById('dash-level-pill');
    if (g && pill) pill.textContent = `${g.rank.icon} Lv ${g.level} · ${g.rank.name}`;
  });
  try {
    const [tasks, allProjects, profile] = await Promise.all([
      API.getTasks(),
      API.getProjects(),
      API.getProfile(),
    ]);
    const projects = allProjects.filter(p => !p.parentId); // top-level only, for the glance cards

    const done   = tasks.filter(t => t.status === 'Completed').length;
    const inprog = tasks.filter(t => t.status === 'In Progress').length;

    // KPIs
    document.getElementById('kpi-total').textContent  = tasks.length;
    document.getElementById('kpi-done').textContent   = done;
    document.getElementById('kpi-inprog').textContent = inprog;
    document.getElementById('hero-name').textContent  = profileName(profile) ? `, ${profileName(profile).split(' ')[0]}` : '';

    const bonusLine = document.getElementById('bonus-credits-line');
    bonusLine.textContent = profile.bonusAiCredits ? `🎁 ${profile.bonusAiCredits} bonus AI credits from invites` : '';
    bonusLine.classList.toggle('hidden', !profile.bonusAiCredits);

    // Momentum streak — consecutive days with >=1 completed task.
    document.getElementById('streak-badge').classList.toggle('hidden', !profile.currentStreak);
    document.getElementById('streak-count').textContent = profile.currentStreak || 0;
    renderDashboardBento(tasks, allProjects);

    // Goals Progress hero — overall task completion across every project,
    // regardless of type; goals are goals, whether Career, Health, etc.
    const goalsPct = ProgressMath.progressPct(tasks);
    document.getElementById('hero-goals-pct').textContent    = goalsPct + '%';
    document.getElementById('hero-goals-sub').textContent    = `${done} of ${tasks.length} tasks complete`;
    document.getElementById('hero-goals-prog').style.width   = goalsPct + '%';
    document.getElementById('hero-goals-detail').textContent = `across ${projects.length} project${projects.length === 1 ? '' : 's'}`;

    // Project cards — a glance at the first few, not a full management
    // table (that's what All Projects is for); capped so this stays a
    // quick overview even for an account with a dozen projects.
    const todayKey = localDateKey(new Date());

    // Goals — AI-created roadmaps (isGoal), shown separately from ordinary
    // projects with progress, days remaining, and the next concrete thing
    // due, since a goal is meant to be finished, not just managed.
    const goalProjects = projects.filter(p => p.isGoal);
    document.getElementById('dashboard-goals-section').classList.toggle('hidden', !goalProjects.length);
    let goalsHTML = '';
    goalProjects.forEach(proj => {
      const gts = tasksInProjectTree(proj.id, allProjects, tasks);
      const gdone = gts.filter(t => t.status === 'Completed').length;
      const gp = ProgressMath.progressPct(gts);
      const dueDates = gts.map(t => t.endDate).filter(Boolean).sort();
      const latestDue = dueDates[dueDates.length - 1];
      let daysLine = '';
      if (latestDue) {
        const diffDays = Math.ceil((new Date(latestDue) - new Date(todayKey)) / 86400000);
        daysLine = diffDays >= 0 ? `${diffDays} day${diffDays === 1 ? '' : 's'} left` : `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} overdue`;
      }
      const nextTask = gts.filter(t => t.status !== 'Completed' && t.endDate).sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
      const milestoneLine = nextTask ? `Next: ${esc(nextTask.title)} (${nextTask.endDate.slice(0, 10)})` : (gts.length ? 'No dates set on remaining tasks' : 'No tasks yet');

      goalsHTML += `
        <div class="bg-white rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 p-4 cursor-pointer"
          onclick="showPage('project-detail','${proj.id}')">
          <div class="flex items-center gap-3 mb-3">
            <span class="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0" style="background:${proj.color}1A">${proj.icon}</span>
            <div class="flex-1 min-w-0">
              <p class="font-bold text-sm text-navy truncate">${esc(proj.title)}</p>
              <p class="text-xs text-gray-400">${gdone} of ${gts.length} tasks done${daysLine ? ' · ' + daysLine : ''}</p>
            </div>
          </div>
          <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500" style="width:${gp}%;background:${proj.color}"></div>
          </div>
          <p class="text-xs text-gray-400 mt-1.5">${milestoneLine}</p>
        </div>`;
    });
    document.getElementById('dashboard-goals-cards').innerHTML = goalsHTML;

    const DASHBOARD_PROJECT_LIMIT = 4;
    let cardsHTML = '';
    projects.slice(0, DASHBOARD_PROJECT_LIMIT).forEach(proj => {
      const pts      = tasksInProjectTree(proj.id, allProjects, tasks);
      const pdone    = pts.filter(t => t.status === 'Completed').length;
      const overdue  = pts.filter(t => t.status !== 'Completed' && t.endDate && t.endDate.slice(0, 10) < todayKey).length;
      const pp       = ProgressMath.progressPct(pts);
      const sharedSuffix = proj.role !== 'owner' && proj.ownerName ? ` · 👤 ${esc(proj.ownerName)}` : '';
      const subLine  = `${pts.length} tasks · ${pdone} done` + sharedSuffix;
      const overdueBadge = overdue > 0 ? `<span class="flex-shrink-0 bg-red-50 text-red-600 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">🔴 ${overdue} overdue</span>` : '';

      cardsHTML += `
        <div class="bg-white rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 p-4 cursor-pointer"
          onclick="showPage('project-detail','${proj.id}')">
          <div class="flex items-center gap-3 mb-3">
            <span class="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0" style="background:${proj.color}1A">${proj.icon}</span>
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
    });
    const emptyMsg = `<p class="text-center text-gray-400 text-sm py-8 col-span-full">No projects yet — <button onclick="openAddProject()" class="text-teal underline">create one</button>.</p>`;
    document.getElementById('project-stats').innerHTML = cardsHTML || emptyMsg;

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
// 'all' | 'mine' (owned, not shared with anyone) | 'shared-with-me'
// (someone else's project you've been invited onto) | 'shared-by-me'
// (yours, with at least one collaborator who's joined).
function setProjectsFilter(filter) {
  APP.projectsFilter = filter;
  renderProjects();
}

async function renderProjects() {
  try {
    const filter = APP.projectsFilter || 'all';
    document.querySelectorAll('#projects-filter-tabs .projects-filter-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    const [allProjects, tasks] = await Promise.all([
      API.getProjects(), API.getTasks(),
    ]);
    let projects = allProjects.filter(p => !p.parentId); // top-level only
    if (filter === 'mine')             projects = projects.filter(p => p.role === 'owner' && !p.collaboratorCount);
    else if (filter === 'shared-with-me') projects = projects.filter(p => p.role !== 'owner');
    else if (filter === 'shared-by-me')   projects = projects.filter(p => p.role === 'owner' && p.collaboratorCount > 0);

    if (!projects.length) {
      const emptyByFilter = {
        mine: 'No private projects — every project you own is currently shared.',
        'shared-with-me': "No one's shared a project with you yet.",
        'shared-by-me': "You haven't shared any of your projects yet — open one and hit 👥 Share.",
      };
      document.getElementById('projects-grid').innerHTML = `<p class="text-center text-gray-400 text-sm py-8 col-span-full">${emptyByFilter[filter] || 'No projects yet.'}</p>`;
      return;
    }

    document.getElementById('projects-grid').innerHTML = projects.map(proj => {
      const pts   = tasksInProjectTree(proj.id, allProjects, tasks);
      const pdone = pts.filter(t => t.status === 'Completed').length;
      const pinp  = pts.filter(t => t.status === 'In Progress').length;
      const pp    = ProgressMath.progressPct(pts);
      const cost  = pts.reduce((s, t) => s + (t.cost || 0), 0);
      const tagsHTML = `<span class="bg-gray-100 text-gray-600 rounded-full px-2.5 py-0.5 text-xs font-semibold">${pts.length} tasks</span>
        <span class="bg-green-50 text-green-700 rounded-full px-2.5 py-0.5 text-xs font-semibold">${pdone} done</span>
        <span class="bg-orange-50 text-orange-700 rounded-full px-2.5 py-0.5 text-xs font-semibold">${pinp} active</span>`;
      const costLine = `<span>Est. ${money(cost)}</span>`;

      return `
        <div class="bg-white rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 p-5 project-card"
          style="border-top: 4px solid ${proj.color}">
          <div class="flex justify-between items-start mb-3">
            <span class="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style="background:${proj.color}1A">${proj.icon}</span>
            <div class="project-card-actions flex gap-1 opacity-0 transition-opacity">
              <button onclick="event.stopPropagation();editProject('${proj.id}')"
                class="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 text-sm">✏️</button>
              ${proj.role === 'owner' ? `<button onclick="event.stopPropagation();deleteProjectConfirm('${proj.id}')"
                class="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 text-sm">🗑️</button>` : ''}
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <h3 class="font-bold text-navy text-base cursor-pointer hover:text-teal"
              onclick="showPage('project-detail','${proj.id}')">${esc(proj.title)}</h3>
            ${proj.role !== 'owner' && proj.ownerName ? `<span class="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full whitespace-nowrap">👤 ${esc(proj.ownerName)}</span>` : ''}
            ${proj.role === 'owner' ? (proj.collaboratorCount > 0
                ? `<span class="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full whitespace-nowrap">👥 Shared with ${proj.collaboratorCount}</span>`
                : `<span class="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">🔒 Private</span>`) : ''}
          </div>
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
