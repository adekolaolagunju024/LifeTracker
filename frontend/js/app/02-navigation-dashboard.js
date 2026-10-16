// Waypoint app, part 2 of 12: Navigation, the sidebar, the dashboard and the projects list.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── NAVIGATION ─────────────────────────────────────────────────
// A lightweight back button — there's no real browser routing here (one
// index.html, no history.pushState), so "back" is an in-app stack of
// wherever showPage() was called from, not actual browser history.
// Home means the dashboard on its own: everything open on top of a page
// closes (the task panel, dialogs and sheets, full-screen views, menus).
// Left alone: a focus session's small bar and the music bar (they sit to one
// side), the full-screen focus timer shrinks back to its bar and keeps
// counting, and a reminder that's ringing stays until it's answered.
function clearOverlays() {
  const run = fn => { try { fn(); } catch { /* that part isn't loaded */ } };
  const drop = id => document.getElementById(id)?.remove();
  run(() => closeTaskDetail());
  run(() => closeAssistant());
  run(() => document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')));
  run(() => closeWeeklyRecap());
  run(() => dismissProjectCompleteOverlay());
  run(() => closePalette());
  run(() => closeNotifications());
  run(() => closeGlobalSearch());
  run(() => closeGateCard());
  run(() => closeProjectDetailMenu());
  ['Race', 'Feedback', 'DayReport', 'Rewards', 'ProjectPicker', 'GoalMap'].forEach(m => run(() => window[m] && window[m].close()));
  run(() => window.DayRoad && DayRoad.closeFull());
  run(() => window.Jarvis && (Jarvis.fullClose(), Jarvis.closePlanner()));
  ['levelup-overlay', 'project-complete-race', 'status-menu', 'gantt-drag-tip', 'metric-tip'].forEach(drop);
}

function showPage(id, projectId = null, _skipHistory = false) {
  if (id === 'dashboard') clearOverlays();
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
  document.body.dataset.page = id; // lets CSS drop what the page already shows (the focus panel's road on the dashboard)
  if (id === 'actions' || id === 'calendar') API.trackFeature(id);
  // The dashboard and Actions already say what's late, so the banner never
  // shows there, and once you've seen either it stays away for the day.
  if (id === 'dashboard' || id === 'actions') {
    document.getElementById('digest-banner')?.classList.add('hidden');
    try { localStorage.setItem('digestDismissedDate', localDateKey(new Date())); } catch { /* private mode */ }
  }
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
    chats: 'Chats',         metrics: 'Metrics',
    why: 'Your why',        challenges: 'Teams',
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
  if (id === 'metrics' && window.Metrics) Metrics.render();
  if (id === 'why' && window.Why) Why.renderPage();
  if (id === 'challenges' && window.Race) Race.renderPage();

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
const STAGE_NAMES = { football: 'Football', castle: 'Castle', space: 'Space', construction: 'Construction', sprint: 'Sprint Track', mountain: 'Mountain' };
function dueLabel(endDate, todayKey) {
  if (!endDate) return { text: '', late: false };
  if (endDate < todayKey) {
    const late = Math.round((new Date(todayKey + 'T00:00:00') - new Date(endDate + 'T00:00:00')) / 86400000);
    return { text: late === 1 ? 'Yesterday' : `${late} days late`, late: true };
  }
  if (endDate === todayKey) return { text: 'Today', late: false };
  const days = Math.round((new Date(endDate + 'T00:00:00') - new Date(todayKey + 'T00:00:00')) / 86400000);
  if (days === 1) return { text: 'Tomorrow', late: false };
  if (days < 7) return { text: new Date(endDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' }), late: false };
  return { text: formatDateShort(endDate), late: false };
}
// Three ways to start a goal: plan it with the assistant, start from a
// template, or join someone's team with a code. Before the first one, a
// strip of the Journey stages it can become (tap one to pick it).
function firstGoalHTML(compact = false) {
  const ways = `<div class="first-goal-ways">
      <button type="button" class="first-way primary" onclick="openAssistant()">${icon('sparkles')}<span><b>Plan it with the assistant</b><small>Say what you want to finish. You get a plan with dated steps to approve.</small></span></button>
      <button type="button" class="first-way" onclick="openAddProject(); setProjectStartMode('template')">${icon('clipboard')}<span><b>Start from a template</b><small>A ready plan: a 5k, a new language, a job hunt, a move.</small></span></button>
      <button type="button" class="first-way" onclick="showPage('challenges')">${icon('users')}<span><b>Join a team</b><small>Got a code from a coach, teacher or friend? Join their goal.</small></span></button>
    </div>`;
  if (compact) return `<div class="first-goal">${ways}</div>`;
  const stages = (typeof JOURNEY_STAGES !== 'undefined' ? JOURNEY_STAGES : []).map(id => `<button type="button" class="first-stage" onclick="setJourneyPref('journeyTheme', '${id}'); setJourneyPref('journeyView', '2d'); showToast('${esc(STAGE_NAMES[id] || id)} it is. Your first goal will play there')">
      <img src="/showcase/stage-${id}.webp" alt="" loading="lazy"><span>${esc(STAGE_NAMES[id] || id)}</span></button>`).join('');
  return `<div class="first-goal">${ways}
    ${stages ? `<p class="first-stages-head">Every goal becomes a journey. Pick where yours plays:</p><div class="first-stages">${stages}</div>` : ''}</div>`;
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
    // A goal set up today hasn't had a chance to fall behind yet.
    const newToday = (f.p.createdAt || '').slice(0, 10) === localDateKey(new Date()) || new Date(f.p.createdAt).toDateString() === new Date().toDateString();
    const status = gap === null || (newToday && gap < 5) ? '' : gap >= 5 ? 'Ahead' : gap >= -5 ? 'On track' : gap >= -15 ? 'Slightly behind' : 'Behind';
    const next = f.open[0];
    const segCount = Math.min(f.tree.length, 12);
    const per = f.tree.length / segCount;
    const nextIndex = Math.floor(f.tree.indexOf(next) / per);
    const segs = Array.from({ length: segCount }, (_, i) => {
      const filled = Math.round((i + 1) * per) <= done;
      return `<span class="${filled ? 'done' : i === nextIndex ? 'next' : i === segCount - 1 ? 'end' : ''}"></span>`;
    }).join('');
    // With the game layer off (new accounts start that way) it's simply
    // the goal: no stage name, and Open plan instead of Play.
    const gameOn = !(typeof focusModeOn === 'function' && focusModeOn());
    // Blockers, not the game's enemy count (a blocker can field several).
    const foes = next ? (next.obstacles || []).filter(o => !o.resolved).length : 0;
    focus.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <p class="fc-kicker">${gameOn ? `${esc(STAGE_NAMES[getJourneyStage()] || 'Journey')} stage` : 'Your goal'}</p>
        ${status ? `<p class="fc-status ${gap < -5 ? 'behind' : ''}">${status}</p>` : ''}
      </div>
      <button type="button" onclick="showPage('project-detail','${f.p.id}')" class="fc-title">${emojiIcon(f.p.icon || '')} ${esc(f.p.title)}</button>
      <div class="focus-segs mt-3" style="grid-template-columns:repeat(${segCount},minmax(0,1fr))">${segs}</div>
      <div class="fc-foot flex items-center justify-between gap-3 flex-wrap">
        <p class="fc-sub">${pctDone}% · ${done} of ${f.tree.length} steps${foes ? ` · ${icon('blocker')} ${foes} ${foes === 1 ? 'blocker' : 'blockers'} ahead` : ''}</p>
        ${gameOn ? `<button type="button" onclick="playJourneyFor('${f.p.id}')" class="fc-play">${icon('play')}Play</button>`
          : `<button type="button" onclick="showPage('project-detail','${f.p.id}')" class="fc-play">${icon('list-checks')}Open plan</button>`}
      </div>
      <div id="dash-reward-line"></div>
      <div id="dash-quest-line"></div>`;
    if (typeof paintQuestLine === 'function') paintQuestLine();
    if (window.Rewards) Rewards.paintDashLine(f.p.id);
  }

  dashFocusData = { tasks, allProjects, todayKey };
  paintDashFocus();

  // This week against last week.
  const DAY = 86400000;
  const nowMs = now.getTime();
  const inRange = (t, from, to) => t.status === 'Completed' && t.completedAt && Date.parse(t.completedAt) >= from && Date.parse(t.completedAt) < to;
  const week = tasks.filter(t => inRange(t, nowMs - 7 * DAY, nowMs + 1)).length;
  const prev = tasks.filter(t => inRange(t, nowMs - 14 * DAY, nowMs - 7 * DAY)).length;
  document.getElementById('dash-week-done').textContent = `${week} task${week === 1 ? '' : 's'} done`;
  const trend = document.getElementById('dash-week-trend');
  trend.textContent = week > prev ? `Up ${week - prev} on last week` : week < prev ? `${prev - week} fewer than last week` : (week ? 'Level with last week' : 'A fresh week to start');
  trend.style.color = week >= prev ? '#1A7A4A' : '#9A4410';
}
// ── YOUR FOCUS ─────────────────────────────────────────────────
// What needs attention first (late, due today, blocked, waiting), each
// with its reason, then what's due next; three at most, with the rest a
// tap away. The counts above it open Actions, which has the full list.
// Two ways to narrow it: one goal at a time (Goal), and My day, today's
// tasks by part of the day. A task's part comes from its time in today's
// plan (Start my day), else a reminder set for today, else where you put
// it; the rest wait under Any time. Both choices stay on this device.
let dashFocusData = null;
const DAY_PARTS = [['morning', 'Morning', 'sunrise', 0, 'Morning'], ['afternoon', 'Afternoon', 'sun', 12 * 60, 'Afternoon'], ['evening', 'Evening & night', 'moon', 17 * 60, 'Evening']];
const partOfMinute = m => (m >= 17 * 60 ? 'evening' : m >= 12 * 60 ? 'afternoon' : 'morning');
const focusPref = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k) || '';
    if (v) localStorage.setItem(k, v); else localStorage.removeItem(k);
  } catch { /* private mode */ }
  return v;
};
// Where you put a task without a time: { date, parts: { taskId: part } }.
function dayPartPicks(todayKey) {
  try {
    const p = JSON.parse(localStorage.getItem('wp-dayparts') || 'null');
    return p && p.date === todayKey ? p.parts : {};
  } catch { return {}; }
}
function setDashFocusGoal(id) { focusPref('dashFocusGoal', id); paintDashFocus(); }
// My day is where it opens: what's planned for today. Focus is a tap away.
function setDashFocusView(v) { focusPref('dashFocusView', v === 'focus' ? 'focus' : ''); paintDashFocus(); }
function setTaskDayPart(taskId, part) {
  const todayKey = localDateKey(new Date());
  const parts = { ...dayPartPicks(todayKey) };
  if (part) parts[taskId] = part; else delete parts[taskId];
  try { localStorage.setItem('wp-dayparts', JSON.stringify({ date: todayKey, parts })); } catch { /* private mode */ }
  paintDashFocus();
}
// Today's plan loads after the dashboard draws; My day places its tasks
// once it's in.
document.addEventListener('dayroad:refresh', () => { if (focusPref('dashFocusView') !== 'focus') paintDashFocus(); });
function paintDashFocus() {
  if (!dashFocusData) return;
  const { tasks: allTasks, allProjects, todayKey } = dashFocusData;
  const byId = Object.fromEntries(allProjects.map(p => [p.id, p]));
  const rootOf = id => { let p = byId[id]; const seen = new Set(); while (p && p.parentId && byId[p.parentId] && !seen.has(p.id)) { seen.add(p.id); p = byId[p.parentId]; } return p ? p.id : id; };
  const openAll = allTasks.filter(t => t.status !== 'Completed');
  // Goal: only goals with something still to do; a saved one that's gone
  // (finished, deleted) falls back to all of them.
  const goals = allProjects.filter(p => !p.parentId && openAll.some(t => rootOf(t.projectId) === p.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  let goal = focusPref('dashFocusGoal');
  if (goal && !goals.some(g => g.id === goal)) goal = '';
  // With nothing open there's no day to lay out: the "what's next" card.
  const view = focusPref('dashFocusView') === 'focus' || !openAll.length ? 'focus' : 'day';
  const inGoal = t => !goal || rootOf(t.projectId) === goal;
  const tasks = allTasks.filter(inGoal);
  const open = openAll.filter(inGoal);

  const dueKey = t => (t.endDate || '').slice(0, 10);
  const blockersOf = t => (t.obstacles || []).filter(o => !o.resolved).length;
  const late = open.filter(t => dueKey(t) && dueKey(t) < todayKey);
  const today = open.filter(t => dueKey(t) === todayKey);
  const blocked = open.filter(t => blockersOf(t));
  const waitingTasks = open.filter(t => waitingOn(t).length);
  const countChips = [['late', late.length, 'overdue', 'overdue'], ['blocked', blocked.length, 'blocked', 'blocker'], ['today', today.length, 'due today', 'clock'], ['waiting', waitingTasks.length, 'waiting', 'waiting']]
    .filter(([, n]) => n)
    .map(([cls, n, label, ic]) => `<button type="button" class="focus-count ${cls}" onclick="showPage('actions')" aria-label="${n} ${label}. Open Actions">${icon(ic)}${n} ${label}</button>`);
  // Before the first goal there's nothing to focus on: three ways to start
  // one, and a look at the stages every goal becomes.
  const firstRun = !allTasks.length && !allProjects.length;
  document.getElementById('dash-upnext-title').textContent = firstRun ? 'Start your first goal' : view === 'day' ? 'My day' : 'Your focus';
  document.getElementById('dash-upnext-all').classList.toggle('hidden', firstRun || !allTasks.length);
  const tools = document.getElementById('dash-focus-tools');
  if (tools) {
    tools.classList.toggle('hidden', firstRun || !openAll.length);
    tools.innerHTML = firstRun || !openAll.length ? '' : `<div class="focus-views" role="group" aria-label="How to show your tasks">
        <button type="button" aria-pressed="${view === 'day'}" onclick="setDashFocusView('day')">${icon('sun', 'tiny')}My day</button>
        <button type="button" aria-pressed="${view === 'focus'}" onclick="setDashFocusView('focus')">${icon('target', 'tiny')}Focus</button>
      </div>
      ${goals.length > 1 ? `<label class="focus-goal ${goal ? 'on' : ''}">${icon('filter', 'tiny')}<select onchange="setDashFocusGoal(this.value)" aria-label="Show tasks from">
        <option value="">All goals</option>${goals.map(g => `<option value="${g.id}" ${g.id === goal ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select></label>` : ''}`;
  }
  document.getElementById('dash-attention-counts').innerHTML = !open.length || view === 'day' ? ''
    : countChips.length ? countChips.join('') : `<span class="focus-count clear">${icon('done')}Nothing late or blocked</span>`;

  const row = (t, time = null, partPick = null) => {
    const done = t.status === 'Completed';
    const due = dueLabel(t.endDate, todayKey);
    const n = blockersOf(t);
    const waiting = waitingOn(t);
    const stuck = !done && (n > 0 || waiting.length > 0);
    const proj = byId[t.projectId] || {};
    const canEdit = proj.role === 'owner' || proj.role === 'editor';
    const why = [];
    if (!done && n) why.push(`<span class="attention-why blocked">${icon('blocker')}${n} blocker${n === 1 ? '' : 's'}</span>`);
    if (!done && waiting.length) why.push(`<span class="attention-why waiting" title="Waiting on ${esc(waiting.map(p => p.title).join(', '))}">${icon('link')}Waiting</span>`);
    // In My day everything is today: a time if it has one, else only
    // lateness is worth saying.
    const side = time ? `<span class="flex-shrink-0 w-14 text-right text-xs font-extrabold text-teal tabular-nums">${esc(clockText(time))}</span>`
      : partPick !== null && !due.late ? ''
        : `<span class="flex-shrink-0 w-20 text-right text-xs font-semibold ${due.late ? 'text-red-600' : dueKey(t) === todayKey ? 'text-amber-700' : 'text-gray-500'}">${esc(due.text)}</span>`;
    const pick = partPick === null ? '' : `<select class="focus-part" onchange="setTaskDayPart('${t.id}', this.value)" aria-label="When today for ${esc(t.title)}" title="When today">
        <option value="">Any time</option>${DAY_PARTS.map(([k, , , , short]) => `<option value="${k}" ${k === partPick ? 'selected' : ''}>${short}</option>`).join('')}</select>`;
    return `<div class="flex items-center gap-3 min-h-[52px] border-b border-gray-100 last:border-0 ${done ? 'focus-done' : ''}">
      <input type="checkbox" class="w-5 h-5 accent-teal flex-shrink-0" ${done ? 'checked disabled' : `onchange="completeFromDashboard('${t.id}', this)"`} aria-label="${done ? `${esc(t.title)} is done` : `${stuck ? 'Blocked: ' : 'Mark '}${esc(t.title)}${stuck ? '' : ' done'}`}" ${!done && (stuck || !canEdit) ? `disabled title="${stuck ? 'Clear what is in the way first' : 'View-only'}"` : ''}>
      <button type="button" onclick="openTaskDetail('${t.id}')" class="flex-1 min-w-0 text-left">
        <span class="block text-sm font-semibold text-navy truncate hover:text-teal">${stuck ? icon('lock', 'mr-1 text-gray-400') : ''}${esc(t.title)}</span>
        <span class="block text-[11px] text-gray-500 truncate">${why.join('')}${esc(proj.title || '')}</span>
      </button>
      ${side}${pick}
      ${done ? '' : `<button type="button" class="attention-act" onclick="Reminders.openSheet('${t.id}')" title="Remind me" aria-label="Set a reminder for ${esc(t.title)}">${icon('alarm')}</button>`}
    </div>`;
  };
  const box = document.getElementById('dash-upnext');
  if (view === 'day' && !firstRun) { box.innerHTML = dayPartsHTML(tasks, open, todayKey, row); return; }

  const rank = t => (dueKey(t) && dueKey(t) < todayKey ? 0 : dueKey(t) === todayKey ? 1 : blockersOf(t) ? 2 : waitingOn(t).length ? 3 : 4);
  const focusList = [...open].sort((a, b) => rank(a) - rank(b) || (dueKey(a) || '9999').localeCompare(dueKey(b) || '9999') || (a.priority === 'High' ? -1 : b.priority === 'High' ? 1 : 0));
  const SHOW = 3;
  const more = focusList.length - SHOW;
  focusList.length = Math.min(focusList.length, SHOW);
  box.innerHTML = focusList.length ? focusList.map(t => row(t)).join('') + (more > 0 ? `<button type="button" class="focus-more" onclick="showPage('actions')">${more} more in Actions →</button>` : '')
    : firstRun ? firstGoalHTML()
      : goal ? `<p class="text-sm text-gray-500 pt-2 pb-3">Nothing left on this goal. <button type="button" class="text-teal font-bold hover:underline" onclick="setDashFocusGoal('')">Show all goals</button></p>`
        : `<p class="text-sm text-gray-500 pt-2 pb-3">Everything's done. What's next?</p>${firstGoalHTML(true)}`;
}
// My day: today's tasks (on today's plan, due today or late, in progress,
// or with a reminder today, plus the ones finished today) under Morning,
// Afternoon and Evening & night, the part you're in now marked and first
// to the eye. Parts with nothing in them stay out of the way.
function dayPartsHTML(tasks, open, todayKey, row) {
  const road = window.DayRoad && DayRoad.state ? DayRoad.state() : null;
  const planStart = Object.fromEntries(road ? road.items.map(i => [i.taskId, i.start]) : []);
  const toMin = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const reminderAt = id => {
    const r = window.Reminders && Reminders.forTask ? Reminders.forTask(id) : null;
    const d = r && new Date(r.remindAt);
    return d && localDateKey(d) === todayKey ? hhmm(d) : null;
  };
  const picks = dayPartPicks(todayKey);
  const dueKey = t => (t.endDate || '').slice(0, 10);
  const doneToday = t => t.status === 'Completed' && t.completedAt && localDateKey(new Date(t.completedAt)) === todayKey;
  const isToday = t => planStart[t.id] || reminderAt(t.id) || picks[t.id]
    || (t.status !== 'Completed' && ((dueKey(t) && dueKey(t) <= todayKey) || t.status === 'In Progress'))
    || (doneToday(t) && (dueKey(t) === todayKey || planStart[t.id]));
  const list = tasks.filter(isToday).map(t => {
    const time = planStart[t.id] || reminderAt(t.id) || null;
    return { t, time, part: time ? partOfMinute(toMin(time)) : picks[t.id] || 'any' };
  });
  if (!list.length) {
    return `<p class="text-sm text-gray-500 pt-2 pb-3">Nothing set for today${open.length ? '. Pick what to do and when with Start my day.' : '.'}</p>
      ${open.length ? `<button type="button" class="focus-more" onclick="Jarvis.startDay()">${icon('play', 'tiny')} Start my day →</button>` : ''}`;
  }
  const now = new Date();
  const nowPart = partOfMinute(now.getHours() * 60 + now.getMinutes());
  const sort = arr => arr.sort((a, b) => (a.t.status === 'Completed') - (b.t.status === 'Completed') || (a.time || '99').localeCompare(b.time || '99'));
  // Each part has the sky's colour at that time: a warm sunrise, a clear
  // afternoon, an indigo evening. The one you're in is marked Now; one
  // that's over with nothing left folds to a line.
  const order = ['morning', 'afternoon', 'evening'];
  const RANGE = { morning: 'Until 12 pm', afternoon: '12 to 5 pm', evening: 'From 5 pm', any: 'No set time' };
  const section = (key, label, ic) => {
    const items = sort(list.filter(x => x.part === key));
    if (!items.length && key !== nowPart) return '';
    const left = items.filter(x => x.t.status !== 'Completed').length;
    const over = order.indexOf(key) > -1 && order.indexOf(key) < order.indexOf(nowPart);
    const folded = over && !left;
    return `<section class="day-part part-${key} ${key === nowPart ? 'is-now' : ''} ${over ? 'is-over' : ''}" aria-label="${esc(label)}">
      <div class="day-part-head"><span class="day-part-ic">${icon(ic)}</span>
        <span class="day-part-name"><b>${esc(label)}</b><small>${RANGE[key]}</small></span>
        ${key === nowPart ? '<span class="day-part-now">Now</span>' : ''}
        <span class="day-part-n">${items.length ? (left ? `${left} to do` : `${icon('check', 'tiny')}All done`) : ''}</span></div>
      ${folded ? '' : items.length ? `<div class="day-part-list">${items.map(x => row(x.t, x.time, x.time ? null : (x.part === 'any' ? '' : x.part))).join('')}</div>` : '<p class="day-part-empty">Nothing here yet. Give a task a time with Start my day, or pick a part for it on its row.</p>'}
    </section>`;
  };
  return DAY_PARTS.map(([k, label, ic]) => section(k, label, ic)).join('') + section('any', 'Any time today', 'clock');
}

async function completeFromDashboard(taskId, checkbox) {
  const task = await API.getTask(taskId).catch(() => null);
  const gate = taskGateMessage(task, 'Completed');
  if (gate) { checkbox.checked = false; showGateCard(task, 'Completed'); return; }
  checkbox.disabled = true;
  try {
    await API.updateTask(taskId, { status: 'Completed' });
    checkbox.parentElement.classList.add('opacity-50', 'line-through');
    setTimeout(renderDashboard, 900);
  } catch (e) {
    checkbox.checked = false; checkbox.disabled = false;
    taskErrorToast(e, 'Could not complete that task', { taskId, status: 'Completed' });
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
        <span class="icon-badge" style="background:${proj.color}33">${emojiIcon(proj.icon)}</span>
        <span class="flex-1 text-left truncate">${esc(proj.title)}</span>${proj.locked ? `<span class="nav-lock" title="Unlocks after ${esc(proj.lockedBy.title)}" aria-label="Locked">${icon('lock')}</span>` : ''}
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
    if (g && pill) pill.innerHTML = `${emojiIcon(g.rank.icon)} Lv ${g.level} · ${esc(g.rank.name)}`;
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
    bonusLine.textContent = profile.bonusAiCredits ? `${profile.bonusAiCredits} bonus AI credits from invites` : '';
    bonusLine.classList.toggle('hidden', !profile.bonusAiCredits);

    // Momentum streak — consecutive days with >=1 completed task.
    document.getElementById('streak-badge').classList.toggle('hidden', !profile.currentStreak);
    document.getElementById('streak-count').textContent = profile.currentStreak || 0;
    renderDashboardBento(tasks, allProjects);
    if (typeof renderDashboardRecap === 'function') renderDashboardRecap();
    if (window.Why) Why.renderDashboard();
    if (window.Jarvis) Jarvis.renderBriefing();

    // Goals Progress hero — overall task completion across every project,
    // regardless of type; goals are goals, whether Career, Health, etc.
    const goalsPct = ProgressMath.progressPct(tasks);
    document.getElementById('hero-goals-pct').textContent    = goalsPct + '%';
    document.getElementById('hero-goals-sub').textContent    = `${done} of ${tasks.length} tasks complete`;
    document.getElementById('hero-goals-prog').style.width   = goalsPct + '%';
    document.getElementById('hero-goals-detail').textContent = `across ${projects.length} project${projects.length === 1 ? '' : 's'}`;

    // Projects and goals have their own page (All Projects); the dashboard
    // keeps to what to do now.


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
        'shared-by-me': "You haven't shared any of your projects yet — open one and choose Share.",
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
      const costLine = cost > 0 ? `<span>Est. ${money(cost)}</span>` : '';

      return `
        <div class="bg-white rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 p-5 project-card cursor-pointer"
          style="border-top: 4px solid ${proj.color}" role="link" tabindex="0" aria-label="Open ${esc(proj.title)}"
          onclick="showPage('project-detail','${proj.id}')" onkeydown="if(event.key==='Enter')showPage('project-detail','${proj.id}')">
          <div class="flex justify-between items-start mb-3">
            <span class="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style="background:${proj.color}1A">${emojiIcon(proj.icon)}</span>
            <div class="project-card-actions flex gap-1 opacity-0 transition-opacity">
              <button onclick="event.stopPropagation();editProject('${proj.id}')"
                class="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 text-sm" aria-label="Edit project">${icon('edit')}</button>
              ${proj.role === 'owner' ? `<button onclick="event.stopPropagation();deleteProjectConfirm('${proj.id}')"
                class="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 text-sm" aria-label="Delete project">${icon('trash')}</button>` : ''}
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <h3 class="font-bold text-navy text-base cursor-pointer hover:text-teal"
              onclick="showPage('project-detail','${proj.id}')">${esc(proj.title)}</h3>
            ${proj.role !== 'owner' && proj.ownerName ? `<span class="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full whitespace-nowrap">${icon('user', 'tiny mr-0.5')}${esc(proj.ownerName)}</span>` : ''}
            ${proj.role === 'owner' ? (proj.collaboratorCount > 0
                ? `<span class="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full whitespace-nowrap">${icon('users', 'tiny mr-0.5')}Shared with ${proj.collaboratorCount}</span>`
                : `<span class="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">${icon('lock', 'tiny mr-0.5')}Private</span>`) : ''}
          </div>
          <p class="text-gray-400 text-xs mb-4">${esc(proj.description || '')}</p>
          <div class="flex gap-2 mb-3 flex-wrap">${tagsHTML}</div>
          <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
            <div class="h-full rounded-full transition-all duration-500"
              style="width:${pp}%;background:${proj.color}"></div>
          </div>
          <div class="flex justify-between text-xs text-gray-400">
            <span>${pp}% complete</span>
            ${costLine}
          </div>
        </div>`;
    }).join('');

  } catch (e) { console.error('Projects error:', e); }
}
