// StartLine app, part 9 of 12: The Journey game view, celebrations, achievements, project complete.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── JOURNEY VIEW ───────────────────────────────────────────────
// A playful, game-like progress view — a third stop on the Gantt page's own
// Gantt/Kanban/Journey toggle, one project at a time (picked from that
// page's existing project filter). One scene: a cartoon worker builds a
// house as tasks are completed — the house itself assembles in 4 real
// phases (foundation, walls, roof, finishing touches), not just a color
// change. Each task is still a numbered checkpoint on the scaffolding
// trail; a translucent "pace" figure advances at the rate the plan's own
// dates imply, so you can see whether you're ahead, level, or behind your
// own schedule — without ever using discouraging win/lose language, to
// stay consistent with the rest of the app.
let mountainState = null; // { projectId, project, tasks, canEdit }

// A small animated cartoon builder, drawn once as a reusable SVG fragment —
// the hammer arm swings on a loop (SMIL <animateTransform>, simplest way to
// rotate around a fixed local pivot without fighting CSS transform-origin
// on nested SVG groups). animated=false draws the same figure without the
// swing, used for the still, translucent "pace" ghost.
function workerSvgMarkup(animated) {
  const hammer = animated
    ? `<animateTransform attributeName="transform" type="rotate" values="-15 3 -8;40 3 -8;-15 3 -8" dur="0.6s" repeatCount="indefinite"/>`
    : '';
  const bob = animated
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -0.6;0 0" dur="1.2s" repeatCount="indefinite" additive="sum"/>`
    : '';
  return `
    <svg viewBox="-9 -20 18 23" width="30" height="38" style="overflow:visible">
      <g>
        ${bob}
        <ellipse cx="0" cy="1.6" rx="5" ry="1.1" fill="#00000022"/>
        <rect x="-3.2" y="-6" width="2.4" height="7.4" rx="1.1" fill="#2563EB"/>
        <rect x="0.8" y="-6" width="2.4" height="7.4" rx="1.1" fill="#2563EB"/>
        <rect x="-4.2" y="-13.5" width="8.4" height="8.3" rx="2.6" fill="#F59E0B"/>
        <rect x="-6.3" y="-12.6" width="2.2" height="5.4" rx="1" fill="#F59E0B"/>
        <circle cx="0" cy="-16" r="3.1" fill="#FBCFA0"/>
        <path d="M-3.3,-17.2 a3.3,3.3 0 0 1 6.6,0 z" fill="#FBBF24"/>
        <g>
          <rect x="3.3" y="-13.5" width="2.1" height="5.6" rx="1" fill="#F59E0B"/>
          <rect x="4" y="-18" width="4.4" height="1.7" rx="0.6" fill="#9CA3AF"/>
          ${hammer}
        </g>
      </g>
    </svg>`;
}

// ── JOURNEY ("Road to the Goal") ────────────────────────────────────
// A single scene — no stage picker. An avatar walks a winding road from
// the starting line to a bullseye target, one flag per completed task.
// All actual drawing (the road, the avatar, the flags, the target,
// particles) lives in the SVG built in frontend/js/journeyGame.js; this
// is just metadata for the status line.
const JOURNEY_META = { checkpointNoun: 'tasks', doneLabel: 'Reached the target', doneEmoji: '🎯' };

// Entry point from a project's own header button — jumps to the Gantt
// page, points its (shared) project filter at this project, and switches
// its view toggle to Journey, so the filter dropdown and the toggle itself
// both land in the state that produced this exact scene.
// The project page's 📊 Planner shortcut: the Planner already narrowed to
// this project, on whichever of its views (Gantt, Kanban or Journey) was
// used last, Gantt if none, so there's no trip through the sidebar and
// the filter, and one button covers all three.
function openPlannerFromProject(projectId) {
  let view = 'timeline';
  try { const last = localStorage.getItem('ganttPageView'); if (GANTT_PAGE_VIEWS.includes(last)) view = last; } catch { /* private mode etc */ }
  showPage('gantt');
  setGanttProjectFilter(projectId);
  setGanttPageView(view);
}

// Re-renders the Journey sub-view for whatever project is currently
// selected in the Gantt page's own filter — called by applyGanttPageView()
// whenever that toggle lands on 'journey', including every time the
// project filter changes while already there.
async function renderJourneyView() {
  const projectId = APP.ganttProjectFilter;
  const titleEl = document.getElementById('mountain-title');
  const statusEl = document.getElementById('mountain-status');
  const competitorSel = document.getElementById('journey-competitor-select');
  const resetBtn = document.getElementById('journey-reset-btn');
  if (!projectId) {
    titleEl.textContent = 'Journey';
    statusEl.textContent = 'Add a project to start its Journey.';
    JourneyGame.destroy(document.getElementById('mountain-scene'));
    document.getElementById('mountain-tasklist').innerHTML = '';
    dismissJourneyAchievement();
    if (competitorSel) competitorSel.classList.add('hidden');
    if (resetBtn) resetBtn.classList.add('hidden');
    const themeSel0 = document.getElementById('journey-theme-select');
    if (themeSel0) themeSel0.value = getJourneyStage();
    mountainState = null;
    loadDailyQuests().then(g => g && updateJourneyLevelBadge(g));
    return;
  }
  statusEl.textContent = 'Loading…';
  dismissJourneyAchievement();
  try {
    const [project, allProjects, allTasks, collaborators] = await Promise.all([
      API.getProject(projectId), API.getProjects(), API.getTasks(), API.getCollaborators(projectId).catch(() => []),
    ]);
    // The filter may have moved on to a different (or no) project while
    // this fetch was in flight — drop the now-stale response rather than
    // overwrite whatever's since become current.
    if (APP.ganttProjectFilter !== projectId) return;
    const tasks = tasksInProjectTree(projectId, allProjects, allTasks)
      .slice()
      .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999') || a.createdAt.localeCompare(b.createdAt));
    // Who's available to race: accepted collaborators other than yourself.
    // Picking one swaps the pace-ghost for their own progress on whatever
    // of these tasks is assigned to them, instead of the schedule's pace.
    const racers = collaborators.filter(c => c.joinedAt && c.userId !== APP.currentUserId);
    let competitor = 'schedule';
    try { competitor = localStorage.getItem('journeyCompetitor:' + projectId) || 'schedule'; } catch { /* private mode etc */ }
    if (competitor !== 'schedule' && !racers.some(r => r.userId === competitor)) competitor = 'schedule';
    mountainState = { projectId, project, tasks, canEdit: project.role === 'owner' || project.role === 'editor', racers, competitor };
    titleEl.innerHTML = `${emojiIcon(project.icon || '')} ${esc(project.title)}`;
    if (resetBtn) resetBtn.classList.toggle('hidden', !mountainState.canEdit);
    if (competitorSel) {
      if (racers.length) {
        competitorSel.classList.remove('hidden');
        competitorSel.innerHTML = `<option value="schedule">The Schedule</option>` + racers.map(r => `<option value="${r.userId}">${esc(r.name)}</option>`).join('');
        competitorSel.value = competitor;
      } else {
        competitorSel.classList.add('hidden');
      }
    }
    const themeSel = document.getElementById('journey-theme-select');
    if (themeSel) themeSel.value = getJourneyStage();
    renderMountainScene();
    renderMountainTaskList();
    loadDailyQuests().then(g => g && updateJourneyLevelBadge(g));
    // A race (Race a friend): the other players join you on the road.
    // In a team-up, Team up becomes Open team (or Open race): its page, with
    // the chat, the plan and who's doing what, as the Gantt and Kanban chips do.
    if (window.Race) Race.load(projectId).then(race => {
      const btn = document.getElementById('journey-race-btn');
      if (btn) {
        btn.classList.remove('hidden');
        btn.innerHTML = race ? `${icon(race.mode === 'race' ? 'flag' : 'users', 'tiny')}Open ${race.mode === 'race' ? 'race' : 'team'}` : `${icon('users', 'tiny')}Team up`;
        btn.title = race ? `Open ${race.title}: the chat, the plan and who's doing what` : 'Lead a squad, class, team or clients through this goal, or race friends';
        btn.onclick = race ? () => Race.openTeam(race.id) : () => Race.openCreate(mountainState && mountainState.projectId);
      }
      if (race) { competitorSel?.classList.add('hidden'); renderMountainScene(); }
    });
  } catch (e) {
    statusEl.textContent = '' + (e.message || 'Could not load this project');
  }
}

// Switching who you're racing — "The Schedule" (a computer pacer that
// sticks exactly to the plan's own dates) or a teammate, racing on their
// own assigned tasks in this same project. Remembered per project.
function setJourneyCompetitor(value) {
  if (!mountainState) return;
  mountainState.competitor = value;
  try { localStorage.setItem('journeyCompetitor:' + mountainState.projectId, value); } catch { /* private mode etc */ }
  renderMountainScene();
}

// Which stage the Journey scene draws itself in — Football, Castle,
// Ocean, Space, ... — and how: in 2D, or in 3D with a follow or overview
// camera. Two separate choices: the dropdown in the Journey header picks
// the stage, and the toggle on the scene itself (2D · Follow cam ·
// Overview) picks the view, the same toggle in 2D and 3D. Purely
// cosmetic, same mechanics either way (see journeyGame.js's THEMES), and
// one global preference rather than per-project. Road, Race, Ocean,
// Corporate, Life Path and Product Launch were retired to keep four stages
// done well; anyone who had one picked lands on Football. An
// older saved "football3d"-style choice splits into the stage and the 3D
// view.
const RETIRED_JOURNEY_THEMES = ['road', 'race', 'ocean', 'corporate', 'life', 'launch'];
const JOURNEY_STAGES = ['football', 'space', 'castle', 'construction', 'sprint', 'mountain'];
// Stages drawn in 2D only (no 3D world yet): the view toggle hides for them.
const JOURNEY_2D_ONLY = [];
const stageHas3D = stage => !JOURNEY_2D_ONLY.includes(stage);
function journeyPref(key) {
  try { return localStorage.getItem(key); } catch { return null; /* private mode etc */ }
}
function setJourneyPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode etc */ }
}
function getJourneyStage() {
  const saved = (journeyPref('journeyTheme') || 'football').replace(/3d$/, '');
  return JOURNEY_STAGES.includes(saved) && !RETIRED_JOURNEY_THEMES.includes(saved) ? saved : 'football';
}
function getJourneyView() {
  const view = journeyPref('journeyView');
  if (view === '2d' || view === '3d') return view;
  // first read since the split: keep whichever the old choice implied
  const implied = /3d$/.test(journeyPref('journeyTheme') || '') ? '3d' : '2d';
  setJourneyPref('journeyView', implied);
  return implied;
}
const getJourneyCam = () => (journeyPref('journeyCam') === 'overview' ? 'overview' : journeyPref('journeyCam') === 'follow' ? 'follow' : '');
function getJourneyTheme() { const s = getJourneyStage(); return s + (getJourneyView() === '3d' && stageHas3D(s) ? '3d' : ''); }
function setJourneyTheme(stage) {
  getJourneyView(); // settles the view before the old stage name is replaced
  setJourneyPref('journeyTheme', stage);
  if (mountainState) renderMountainScene();
}
function setJourneyView(view, cam) {
  if (cam) setJourneyPref('journeyCam', cam);
  setJourneyPref('journeyView', view);
  if (mountainState) renderMountainScene();
}
// The 3D stages' own toggles report back here: a camera change is just
// remembered, a click on 2D switches the view.
document.addEventListener('journeyview', e => {
  const { view, cam } = e.detail || {};
  if (cam) setJourneyPref('journeyCam', cam);
  if (view && view !== getJourneyView()) setJourneyView(view);
  else renderJourneyViewBar();
});
let journeyWebGL = null;
function journeyCanDo3D() {
  if (journeyWebGL === null) {
    try { const c = document.createElement('canvas'); journeyWebGL = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { journeyWebGL = false; }
  }
  return journeyWebGL;
}
// The view toggle (2D · Follow cam · Overview) sits in the Journey
// header next to the stage picker, not on the scene, so it never covers
// the road, the finish or a stage's own meters. One toggle for 2D and 3D:
// picking a camera from 2D switches to 3D with it; picking one while a 3D
// stage is showing just moves that stage's camera ('journeysetcam', see
// makeViewToggle in journey3dKit.js). Hidden where 3D can't run.
function renderJourneyViewBar() {
  const bar = document.getElementById('journey-view-bar');
  if (!bar) return;
  const can = journeyCanDo3D() && stageHas3D(getJourneyStage());
  bar.classList.toggle('hidden', !can);
  if (!can) return;
  const view = getJourneyView();
  const cam = getJourneyCam() || 'follow';
  const overview = getJourneyStage() === 'construction' ? 'Site view' : 'Overview';
  const btn = (key, label, title) => {
    const on = key === '2d' ? view === '2d' : view === '3d' && cam === key;
    return `<button type="button" aria-pressed="${on}" title="${title}" onclick="pickJourneyView('${key}')">${label}</button>`;
  };
  bar.innerHTML = btn('2d', '2D', 'Show the stage in 2D')
    + btn('follow', 'Follow<span class="hidden sm:inline"> cam</span>', '3D, with the camera following your character')
    + btn('overview', overview, '3D, looking over the whole stage');
}
function pickJourneyView(key) {
  if (key === '2d') { if (getJourneyView() !== '2d') setJourneyView('2d'); return; }
  if (getJourneyView() === '3d') {
    setJourneyPref('journeyCam', key);
    document.getElementById('mountain-scene').dispatchEvent(new CustomEvent('journeysetcam', { detail: { cam: key } }));
    renderJourneyViewBar();
  } else {
    setJourneyView('3d', key);
  }
}

// Resolves the current competitor to a progress fraction + display label —
// a teammate's own completion rate on whatever of these tasks is assigned
// to them, or (the default, and the fallback if they have none assigned
// here) the schedule's implied pace.
function competitorFraction() {
  const { tasks, racers, competitor } = mountainState;
  if (competitor && competitor !== 'schedule') {
    const racer = racers.find(r => r.userId === competitor);
    if (racer) {
      const theirs = tasks.filter(t => t.assigneeId === competitor);
      if (theirs.length) {
        const theirDone = theirs.filter(t => t.status === 'Completed').length;
        return { frac: theirDone / theirs.length, label: racer.name, isComputer: false };
      }
    }
  }
  return { frac: mountainExpectedFraction(), label: 'The Schedule', isComputer: true };
}

// Fullscreen for the Journey: the view is stretched over the whole page
// (body.journey-fs, see index.html) and the browser goes fullscreen on the
// page itself where the Fullscreen API exists. Fullscreening only the view
// element would hide everything outside it, including the Reset confirm
// dialog, toasts and the task details panel, so those buttons would seem
// to do nothing. Esc, the button again, or leaving the Journey all exit.
function isJourneyFullscreen() { return document.body.classList.contains('journey-fs'); }
function setJourneyFullscreen(on) {
  document.body.classList.toggle('journey-fs', on);
  const btn = document.getElementById('journey-fullscreen-btn');
  if (btn) btn.innerHTML = on ? `${icon('close')} Exit full screen` : `${icon('expand')} Full screen`;
  const root = document.documentElement;
  const native = document.fullscreenElement || document.webkitFullscreenElement;
  try {
    if (on && !native) {
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) { const p = req.call(root); if (p && p.catch) p.catch(() => {}); }
    } else if (!on && native) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); }
    }
  } catch { /* the page still fills the window without the API */ }
}
function toggleJourneyFullscreen() { setJourneyFullscreen(!isJourneyFullscreen()); }
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
  // Esc (or the browser's own exit) leaves native fullscreen: follow it.
  if (!(document.fullscreenElement || document.webkitFullscreenElement) && isJourneyFullscreen()) setJourneyFullscreen(false);
}));
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !isJourneyFullscreen()) return;
  // Esc closes an open dialog or panel first, then fullscreen.
  if (document.querySelector('.modal-overlay.open') || !document.getElementById('task-detail-panel')?.classList.contains('translate-x-full')) return;
  setJourneyFullscreen(false);
});

// How far through its own date range `tasks` "should" be right now, by
// wall-clock time — 0 at the earliest start date, 1 at the latest due
// date, null if there's nothing dated to anchor it to. Shared by
// Journey's own pace-vs-competitor read (mountainExpectedFraction) and
// the plain Gantt/Kanban stats strip below.
function expectedFractionForTasks(tasks, fallbackStart) {
  const dated = tasks.filter(t => t.endDate);
  if (!dated.length) return null;
  const starts = tasks.map(t => t.startDate).filter(Boolean).sort();
  const start = starts[0] || fallbackStart;
  if (!start) return null;
  const end = dated.map(t => t.endDate).sort().slice(-1)[0];
  const startMs = new Date(start).getTime(), endMs = new Date(end).getTime(), nowMs = Date.now();
  if (!(endMs > startMs)) return null;
  return Math.max(0, Math.min(1, (nowMs - startMs) / (endMs - startMs)));
}
function mountainExpectedFraction() {
  return expectedFractionForTasks(mountainState.tasks, mountainState.project.startDate || mountainState.project.createdAt.slice(0, 10));
}

// A compact stats strip above the quest log — percent complete, the
// same app-wide streak number shown on the Dashboard, and pace vs.
// whatever's being raced against (reusing the exact ahead/behind/even
// thresholds and emoji the status line below the scene already uses,
// so the two never disagree). Deliberately just these three — XP,
// levels, and achievements already live one tap away in the 🏆 Trophy
// Case, and duplicating them here would just be more clutter in a view
// with a long history of exactly that complaint.
function renderJourneyStats(done, total, youFrac, expectedFrac, competitor) {
  const wrap = document.getElementById('mountain-stats');
  // The numbers here weigh tasks by size (js/progressMath.js); the scene
  // itself still walks flag to flag. Against the schedule, the pace uses
  // the same weights; against a teammate, it stays task-for-task.
  if (total) {
    youFrac = ProgressMath.progressFraction(mountainState.tasks);
    if (competitor && competitor.isComputer) expectedFrac = ProgressMath.expectedFraction(mountainState.tasks, mountainState.project.startDate || (mountainState.project.createdAt || '').slice(0, 10));
  }
  const pct = total ? ProgressMath.progressPct(mountainState.tasks) : 0;
  const streak = (APP.profile && APP.profile.currentStreak) || 0;
  let paceIcon, paceValue, paceLabel;
  if (!total || expectedFrac === null) {
    paceIcon = '⏱️'; paceValue = '—'; paceLabel = 'Own pace';
  } else {
    const deltaPct = Math.round((youFrac - expectedFrac) * 100);
    if (youFrac > expectedFrac + 0.03) { paceIcon = '🏆'; paceValue = `+${deltaPct}%`; paceLabel = 'Ahead'; }
    else if (youFrac < expectedFrac - 0.03) { paceIcon = '⏳'; paceValue = `${Math.abs(deltaPct)}%`; paceLabel = 'Behind'; }
    else { paceIcon = '🤝'; paceValue = 'Even'; paceLabel = competitor ? competitor.label : 'Pace'; }
  }
  wrap.innerHTML = `
    <div class="journey-stat"><span class="journey-stat-value">${icon('goal')} ${pct}%</span><span class="journey-stat-label">Complete</span></div>
    <div class="journey-stat"><span class="journey-stat-value">${streak ? `${icon('flame')} ${streak}` : '—'}</span><span class="journey-stat-label">Day streak</span></div>
    <div class="journey-stat"><span class="journey-stat-value">${emojiIcon(paceIcon)} ${paceValue}</span><span class="journey-stat-label">${esc(paceLabel)}</span></div>
  `;
}

// Computes the current state and hands it to the SVG scene (see
// frontend/js/journeyGame.js) to actually draw and animate — this
// function only owns the derived numbers and the status-line text.
function renderMountainScene() {
  const { tasks } = mountainState;
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'Completed').length;
  const youFrac = total ? done / total : 0;
  const competitor = total ? competitorFraction() : null;
  const expectedFrac = competitor ? competitor.frac : null;
  const summitLit = total > 0 && done === total;

  const container = document.getElementById('mountain-scene');
  const theme = getJourneyTheme();
  // the camera a 3D stage starts with (its own toggle can change it)
  container.dataset.cam = getJourneyCam();
  renderJourneyViewBar();
  // The quest panel (stats strip + task list) is reskinned per theme
  // (see .journey-quest-panel.theme-* in index.html) so it reads as
  // part of that world instead of one fixed HUD style bolted onto all.
  document.getElementById('mountain-quest-panel').className = `journey-quest-panel flex flex-col theme-${theme}`;
  renderJourneyStats(done, total, youFrac, expectedFrac, competitor);
  JourneyGame.sync(container, {
    tasks, youFrac, summitLit, theme,
    // Null when there's nothing to actually pace against (no dates set, or
    // a teammate with none of these tasks assigned) — showing a ghost
    // frozen at the start forever would just read as a second character
    // standing around, not as "you're ahead/behind".
    // In a race the other players (and their pace labels) take the ghost's place.
    ghost: (competitor && competitor.frac !== null && !(window.Race && Race.current() && Race.current().players.length > 1)) ? { frac: competitor.frac, label: competitor.label, isComputer: competitor.isComputer } : null,
    // Everyone else in the race, if this goal is your copy in one.
    rivals: window.Race && Race.current() && Race.current().players.length > 1 ? Race.rivals() : null,
    youColor: window.Race && Race.youColor(),
    youBadge: window.Race && Race.youBadge(),
    celebrationsEnabled: celebrationsEnabled(),
    // Called once, by journeyGame.js/journey3d.js, right as the finish
    // celebration actually starts on screen (which may be well after
    // this sync() call returns, once the avatar's done walking/shooting)
    // — see toggleMountainTask() for why this replaced a fixed delay.
    onSummit: showMountainCelebration,
  });

  const statusEl = document.getElementById('mountain-status');
  const phase = JourneyGame.buildPhaseLabel(youFrac);
  const noun = JOURNEY_META.checkpointNoun;
  if (!total) {
    statusEl.textContent = 'Add tasks to this project to start the journey.';
  } else if (summitLit) {
    statusEl.textContent = `${JOURNEY_META.doneLabel}: every task done!`;
  } else if (expectedFrac === null) {
    statusEl.textContent = `${done} of ${total} ${noun} · ${phase} · no deadlines set, so just go at your own pace.`;
  } else if (youFrac > expectedFrac + 0.03) {
    statusEl.textContent = `${done} of ${total} ${noun} · ${phase} · you're ahead of ${competitor.label}!`;
  } else if (youFrac < expectedFrac - 0.03) {
    statusEl.textContent = `${done} of ${total} ${noun} · ${phase} · ${competitor.label} is a little ahead — keep going.`;
  } else {
    statusEl.textContent = `${done} of ${total} ${noun} · ${phase} · neck and neck with ${competitor.label}.`;
  }
}

// Renders as a "quest log" styled to match the Journey scene above it
// (see .journey-quest-* in index.html) rather than a plain checklist —
// each row's badge uses the exact same done/next/pending color language
// as the scene's own checkpoints, and "next" is found the same way
// journeyGame.js finds it (first incomplete task by index), so the row
// that's glowing here is the same one glowing on the road.
// How many enemies stand before a task's flag: its named obstacles' counts,
// or one for an older "this is a blocker" status update.
function foeCount(t) {
  if ((t.obstacles || []).length) return pendingFoes(t);
  return t.latestUpdateIsBlocker ? 1 : 0;
}
function renderMountainTaskList() {
  const { tasks, canEdit } = mountainState;
  const wrap = document.getElementById('mountain-tasklist');
  if (!tasks.length) {
    wrap.innerHTML = '<p class="journey-quest-empty">No tasks on this journey yet.</p>';
    return;
  }
  const doneCount = tasks.filter(t => t.status === 'Completed').length;
  wrap.innerHTML = tasks.map((t, i) => {
    const isDone = t.status === 'Completed';
    const isNext = !isDone && i === doneCount;
    const badgeClass = isDone ? 'is-done' : isNext ? 'is-next' : 'is-pending';
    return `
    <label class="journey-quest-row ${isDone ? 'is-done' : ''} ${canEdit ? 'is-editable' : ''}">
      <input type="checkbox" class="journey-quest-checkbox" data-task-id="${t.id}" onchange="toggleMountainTask(this)" ${isDone ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
      <span class="journey-quest-badge ${badgeClass}">${isDone ? '✓' : i + 1}</span>
      <span class="journey-quest-title">${!isDone && waitingOn(t).length ? '<span title="Waiting on another task" aria-hidden="true">' + icon('lock') + ' </span>' : ''}${esc(t.title)}</span>
      ${!isDone && foeCount(t) ? `<span class="journey-quest-foes" title="${esc(obstacleNames(t) || 'Blocked')}">${icon('blocker')}${foeCount(t)}</span>` : ''}
      ${watchSlot(t.id)}
      ${t.endDate ? `<span class="journey-quest-date">${esc(formatDateShort(t.endDate.slice(0, 10)))}</span>` : ''}
      <button type="button" class="journey-quest-foe-btn" onclick="event.preventDefault(); event.stopPropagation(); openTaskDetail('${t.id}')" title="Obstacles and details" aria-label="Obstacles and details for ${esc(t.title)}">${icon('blocker')}</button>
    </label>${!isDone && waitingOn(t).length ? `<div class="journey-waiting">${icon('link')} Waiting on ${waitingOn(t).map(p => esc(p.title)).join(', ')}</div>` : ''}${blockerChecklist(t, canEdit, 'quest')}`;
  }).join('');
}

// The per-checkpoint confetti burst is no longer fired from here — the
// Phaser scene detects a newly-completed checkpoint itself (diffing this
// sync against the last one) and bursts at that exact spot, same as it
// detects the whole-project celebration. This just updates state and UI.
async function toggleMountainTask(checkbox) {
  const taskId = checkbox.dataset.taskId;
  const task = mountainState.tasks.find(t => t.id === taskId);
  const nowComplete = checkbox.checked;
  const gate = taskGateMessage(task, nowComplete ? 'Completed' : 'Not Started');
  if (gate) { checkbox.checked = !nowComplete; showGateCard(task, nowComplete ? 'Completed' : 'Not Started'); return; }
  checkbox.disabled = true;
  try {
    await API.updateTask(taskId, { status: nowComplete ? 'Completed' : 'Not Started' });
    task.status = nowComplete ? 'Completed' : 'Not Started';
    renderMountainScene();
    renderMountainTaskList();
    updateSidebar();
    if (nowComplete) {
      const total = mountainState.tasks.length;
      const done = mountainState.tasks.filter(x => x.status === 'Completed').length;
      // The "every task done" case shows the "Project Complete" modal
      // itself — but only once the scene's own celebration (the avatar
      // walking to the goal, football's shot/GOAL! moment) has actually
      // had a beat to play, via the onSummit callback passed into
      // JourneyGame.sync() below, not a fixed delay from right here.
      if (done !== total) showToast(`🎉 Nice! "${task.title}" done.`);
    }
  } catch (e) {
    checkbox.checked = !nowComplete;
    taskErrorToast(e, 'Could not update that task', { taskId, status: nowComplete ? 'Completed' : 'Not Started' });
  } finally {
    checkbox.disabled = !mountainState.canEdit;
  }
}

// Restarts the climb — sets every task on this Journey back to Not
// Started, same as unchecking each one from the task list, just all at
// once. A real, hard-to-reverse change to live task data, so it goes
// through the same confirm-modal pattern as a bulk delete rather than
// firing immediately on click. Ticked-off blockers are unticked too, so
// their enemies are back on the road for the fresh start.
function tickedBlockers(tasks) {
  return tasks.flatMap(t => (t.obstacles || []).filter(o => o.resolved));
}
function resetMessage(nTasks, nBlockers, title, verb) {
  return `${verb} All ${nTasks} task${nTasks === 1 ? '' : 's'} in "${title}" will be set back to Not Started`
    + (nBlockers ? ` and ${nBlockers} cleared blocker${nBlockers === 1 ? '' : 's'} will be unticked` : '') + `. This can't be undone.`;
}
function resetJourneyProgress() {
  if (!mountainState || !mountainState.canEdit) return;
  const toReset = mountainState.tasks.filter(t => t.status !== 'Not Started');
  const blockers = tickedBlockers(mountainState.tasks);
  if (!toReset.length && !blockers.length) { showToast('Already at the start — nothing to reset.'); return; }
  confirmAction(
    resetMessage(mountainState.tasks.length, blockers.length, mountainState.project.title, 'Restart this climb?'),
    async () => {
      try {
        await Promise.all([
          ...toReset.map(t => API.updateTask(t.id, { status: 'Not Started' })),
          ...blockers.map(o => API.updateObstacle(o.id, { resolved: false })),
        ]);
        toReset.forEach(t => { t.status = 'Not Started'; });
        blockers.forEach(o => { o.resolved = false; });
        renderMountainScene();
        renderMountainTaskList();
        updateSidebar();
        showToast('↺ Climb restarted — back to the bottom.');
      } catch (e) {
        showToast('❌ ' + (e.message || 'Could not reset this climb'), 'error');
      }
    },
  );
}

// The same reset, offered from the Gantt Chart and Kanban views' own
// shared header instead of Journey's — scoped to whatever single project
// the (shared) project filter currently points at, same as the stats
// strip above it. Self-contained rather than reading mountainState, since
// that's only populated while the Journey sub-view is actually mounted.
function resetGanttProjectProgress() {
  const projectId = APP.ganttProjectFilter;
  if (!projectId) return;
  Promise.all([API.getProject(projectId), API.getProjects(), API.getTasks()]).then(([project, allProjects, allTasks]) => {
    if (!(project.role === 'owner' || project.role === 'editor')) return;
    const tasks = tasksInProjectTree(projectId, allProjects, allTasks);
    const toReset = tasks.filter(t => t.status !== 'Not Started');
    const blockers = tickedBlockers(tasks);
    if (!toReset.length && !blockers.length) { showToast('Already at the start — nothing to reset.'); return; }
    confirmAction(
      resetMessage(tasks.length, blockers.length, project.title, 'Reset progress?'),
      async () => {
        try {
          await Promise.all([
            ...toReset.map(t => API.updateTask(t.id, { status: 'Not Started' })),
            ...blockers.map(o => API.updateObstacle(o.id, { resolved: false })),
          ]);
          renderGantt();
          updateSidebar();
          showToast('↺ Progress reset — back to the start.');
        } catch (e) {
          showToast('❌ ' + (e.message || 'Could not reset this project'), 'error');
        }
      },
    );
  }).catch(e => showToast('❌ ' + (e.message || 'Could not load this project'), 'error'));
}

// The modal text + the Journey scene's own big particle burst (fired
// automatically from renderMountainScene's sync once it detects every
// checkpoint just went done) — this only owns the DOM modal.
// Uses the same full-screen swipe-to-dismiss overlay the rest of the app
// shows for a whole-project completion, flavored with whatever the
// competitor race looked like — rather than its own separate small
// in-scene modal, so finishing a project reads the same way everywhere,
// not just inside Journey.
async function showMountainCelebration() {
  // onSummit now fires after a real delay (long enough for the scene's
  // own celebration to play) instead of a near-immediate one, so it's
  // worth guarding against the user having since left the Journey tab
  // or switched projects in that window.
  if (!mountainState || APP.ganttProjectFilter !== mountainState.projectId) return;
  // In a race (Race a friend) the message is your finishing place.
  if (window.Race && Race.current()) {
    const placed = await Race.finishMessage(mountainState.project.id);
    if (placed) { showJourneyAchievement(mountainState.project.title, { ...placed, projectId: mountainState.project.id }); return; }
  }
  const competitor = competitorFraction();
  const title = mountainState.project.title;
  let message;
  if (competitor.frac === null) message = `Every task in “${title}” is done. Take a moment with this one.`;
  else if (competitor.frac < 0.97) message = `You finished “${title}” before ${competitor.label}. You won the race.`;
  else message = `You finished “${title}”. However long it took, you made it.`;
  showJourneyAchievement(title, { message, heading: 'You reached the target!', emoji: '🏆', projectId: mountainState.project.id });
}

// ── SCREEN-WIDE CELEBRATIONS ──────────────────────────────────
// Fires from anywhere a task is completed — the task table, Kanban, Gantt,
// task detail, bulk actions, the assistant — not just inside Journey view.
// Journey view already celebrates at the checkpoint itself, so this layer
// steps aside while that's the one on screen rather than doubling up.
// A shared particle pool and a single render loop — calling this again
// while an earlier burst is still falling *adds* to the same pool instead
// of starting a second independent clearRect+redraw loop. Two (or three,
// for the whole-project moment's staggered triple burst) competing loops
// each clearing the whole canvas every frame made every other loop's
// particles flicker/disappear — visible stutter that read as "slow",
// not actually a performance problem so much as loops fighting each other.
let _confettiParticles = [];
let _confettiRunning = false;
function fireScreenConfetti(originX, originY, count) {
  const canvas = document.getElementById('global-confetti');
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  const colors = ['#0A7E8C', '#F59E0B', '#EF4444', '#22C55E', '#3B82F6', '#EC4899', '#A855F7'];
  for (let i = 0; i < count; i++) {
    _confettiParticles.push({
      x: originX, y: originY,
      vx: (Math.random() - 0.5) * 11,
      vy: -(Math.random() * 11 + 4),
      size: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      vrot: (Math.random() - 0.5) * 24,
      life: 1,
    });
  }
  if (_confettiRunning) return;
  _confettiRunning = true;
  const ctx = canvas.getContext('2d');
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _confettiParticles = _confettiParticles.filter(p => {
      p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.rot += p.vrot; p.life -= 0.009;
      if (p.life <= 0) return false;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
      return true;
    });
    if (_confettiParticles.length) {
      requestAnimationFrame(tick);
    } else {
      _confettiRunning = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  tick();
}

// A handful of bursts spread across the top of the screen, for the bigger,
// whole-project moment.
function fireBigScreenConfetti() {
  const w = window.innerWidth;
  [0.2, 0.5, 0.8].forEach((xFrac, i) => {
    setTimeout(() => fireScreenConfetti(w * xFrac, window.innerHeight * 0.18, 90), i * 180);
  });
}

// Balloons rising from the bottom of the screen — the opposite physics
// from confetti (up and gentle instead of down and fast), reserved for the
// bigger whole-project moment. Its own canvas (see index.html) so its
// clear-and-redraw loop doesn't fight confetti's independent one if both
// are animating at the same time. Same shared-pool fix as confetti above:
// finishing a second project while the first's balloons are still rising
// (they take several seconds) used to start a second independent
// clearRect loop that fought the first one every frame.
let _balloonParticles = [];
let _balloonsRunning = false;
function fireBalloons(count) {
  const canvas = document.getElementById('global-balloons');
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  const colors = ['#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#EC4899', '#A855F7', '#0A7E8C'];
  for (let i = 0; i < count; i++) {
    _balloonParticles.push({
      x: Math.random() * canvas.width,
      y: canvas.height + Math.random() * 300,
      vy: -(Math.random() * 1.3 + 1.1),
      sway: Math.random() * 1.6 + 0.6,
      swayFreq: Math.random() * 0.02 + 0.015,
      phase: Math.random() * Math.PI * 2,
      size: Math.random() * 12 + 20,
      color: colors[Math.floor(Math.random() * colors.length)],
      t: 0,
    });
  }
  if (_balloonsRunning) return;
  _balloonsRunning = true;
  const ctx = canvas.getContext('2d');
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _balloonParticles = _balloonParticles.filter(b => {
      b.t += 1;
      b.y += b.vy;
      b.x += Math.sin(b.t * b.swayFreq + b.phase) * b.sway * 0.1;
      if (b.y <= -60) return false;
      const fadeTop = canvas.height * 0.12; // fade out as it nears the top
      const alpha = b.y < fadeTop ? Math.max(0, b.y / fadeTop) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = b.color;
      // Balloon body
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.size * 0.42, b.size * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      // Knot
      ctx.beginPath();
      ctx.moveTo(b.x - 3, b.y + b.size * 0.48);
      ctx.lineTo(b.x + 3, b.y + b.size * 0.48);
      ctx.lineTo(b.x, b.y + b.size * 0.58);
      ctx.closePath();
      ctx.fill();
      // String
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.size * 0.58);
      ctx.lineTo(b.x + Math.sin(b.t * 0.05) * 3, b.y + b.size * 0.58 + 18);
      ctx.stroke();
      ctx.restore();
      return true;
    });
    if (_balloonParticles.length) {
      requestAnimationFrame(tick);
    } else {
      _balloonsRunning = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  tick();
}

// ── JOURNEY ACHIEVEMENT (corner card) ───────────────────────────
// Journey's own "you reached the target" notice: the scene behind it
// (avatar at the goal, confetti, balloons) *is* the celebration, so this
// just confirms it from a corner instead of a full-screen sheet that
// would cover that up. Slides in, auto-dismisses, or closed with its ×.
// A short line of what it took (tasks, days, against the deadline) and
// any rewards just earned fill in once they've loaded. It stays a while,
// with a bar showing how long, and holds still while you're on it.
const JA_MS = 12000;
let _jaDismissTimer = null;
let _jaLeft = JA_MS;
let _jaStarted = 0;
function showJourneyAchievement(title, { message, heading, emoji, projectId = null } = {}) {
  if (!celebrationsEnabled()) return;
  const banner = document.getElementById('journey-achieve-banner');
  if (!banner) return;
  document.getElementById('journey-achieve-emoji').innerHTML = emojiIcon(emoji || '🏆');
  document.getElementById('journey-achieve-heading').textContent = heading || 'You reached the target!';
  document.getElementById('journey-achieve-message').textContent = message || `Every task in “${title}” is done. Incredible work.`;
  ['journey-achieve-stats', 'journey-achieve-reward'].forEach(id => document.getElementById(id).classList.add('hidden'));
  banner.classList.remove('counting', 'paused');
  void banner.offsetWidth; // restart the countdown bar
  banner.style.setProperty('--ja-ms', `${JA_MS}ms`);
  banner.classList.add('show', 'counting');
  clearTimeout(_jaDismissTimer);
  _jaLeft = JA_MS; _jaStarted = Date.now();
  _jaDismissTimer = setTimeout(dismissJourneyAchievement, JA_MS);
  if (projectId) fillJourneyAchievement(projectId);
}
async function fillJourneyAchievement(projectId) {
  try {
    const [allProjects, allTasks] = await Promise.all([API.getProjects(), API.getTasks()]);
    const project = allProjects.find(p => p.id === projectId);
    const tree = tasksInProjectTree(projectId, allProjects, allTasks);
    const DAY = 86400000;
    const starts = tree.map(t => t.startDate).filter(Boolean).sort();
    const days = Math.max(1, Math.ceil((Date.now() - Date.parse((project && project.startDate) || starts[0] || (project && project.createdAt) || Date.now())) / DAY));
    const due = tree.map(t => (t.endDate || '').slice(0, 10)).filter(Boolean).sort().pop();
    const diff = due ? Math.round((Date.parse(`${due}T23:59:59`) - Date.now()) / DAY) : null;
    const bits = [`<b>${tree.length}</b> ${tree.length === 1 ? 'task' : 'tasks'}`, `<b>${days}</b> ${days === 1 ? 'day' : 'days'}`];
    if (diff !== null) bits.push(diff > 0 ? `<b>${diff}</b> ${diff === 1 ? 'day' : 'days'} early` : diff === 0 ? '<b>right on time</b>' : `<b>${-diff}</b> ${-diff === 1 ? 'day' : 'days'} over`);
    const stats = document.getElementById('journey-achieve-stats');
    stats.innerHTML = bits.join(' · ');
    stats.classList.remove('hidden');
  } catch { /* the card stands without the numbers */ }
  try {
    const { pledges } = await API.getPledges(projectId);
    const earned = pledges.filter(p => p.status === 'earned');
    if (earned.length) {
      const el = document.getElementById('journey-achieve-reward');
      el.innerHTML = `${icon('gift')}<span>You've earned ${esc(earned[0].text)} from ${esc(earned[0].name)}${earned.length > 1 ? ` and ${earned.length - 1} more` : ''}</span>`;
      el.classList.remove('hidden');
    }
  } catch { /* not the owner, or offline */ }
}
function pauseJourneyAchievement(pause) {
  const banner = document.getElementById('journey-achieve-banner');
  if (!banner || !banner.classList.contains('show')) return;
  if (pause && !banner.classList.contains('paused')) {
    clearTimeout(_jaDismissTimer);
    _jaLeft = Math.max(1500, _jaLeft - (Date.now() - _jaStarted));
    banner.classList.add('paused');
  } else if (!pause && banner.classList.contains('paused')) {
    banner.classList.remove('paused');
    _jaStarted = Date.now();
    _jaDismissTimer = setTimeout(dismissJourneyAchievement, _jaLeft);
  }
}
function dismissJourneyAchievement() {
  clearTimeout(_jaDismissTimer);
  const banner = document.getElementById('journey-achieve-banner');
  if (banner) banner.classList.remove('show', 'counting', 'paused');
}
function planNextAfterTarget() {
  const title = mountainState && mountainState.project && mountainState.project.title;
  paletteAsk(title ? `I just finished "${title}". Help me plan what's next.` : 'I just finished a goal. Help me plan what is next.');
}

// ── PROJECT COMPLETE OVERLAY ────────────────────────────────────
// A full-screen, swipe-to-dismiss congratulations page for finishing a
// whole project. Slides up into view on its own; swipe (or drag with a
// mouse) it back down to dismiss, tap outside, press Escape, or just wait
// — it dismisses itself after a while too. Respects Celebration Effects
// in Settings, same as the confetti/balloons it's shown alongside.
let _pcDismissTimer = null;
let _pcData = null;
// Finishing a whole goal is the biggest moment in the app, so this stays
// until it's closed and says what was actually done: tasks, blockers
// beaten, how long it took and how that compares with the deadline, and
// the person's own why from Your why. Then share it, see the report, or
// plan what's next with the assistant.
async function showProjectCompleteOverlay(title, { projectId = null, message, heading, emoji } = {}) {
  if (!celebrationsEnabled()) return;
  const overlay = document.getElementById('project-complete-overlay');
  const sheet = document.getElementById('project-complete-sheet');
  _pcData = { title, projectId, stats: null };
  document.getElementById('project-complete-heading').textContent = heading || 'You did it.';
  document.getElementById('project-complete-title').textContent = title || '';
  document.getElementById('project-complete-emoji').innerHTML = emojiIcon(emoji || '🏆');
  document.getElementById('project-complete-message').textContent = message || 'Every task, done. Take a moment with this one.';
  document.getElementById('project-complete-stats').innerHTML = '';
  document.getElementById('project-complete-why').classList.add('hidden');
  document.getElementById('project-complete-report').classList.toggle('hidden', !projectId);
  sheet.style.transition = 'none';
  sheet.style.transform = 'translateY(100%)';
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sheet.style.transition = 'transform 0.35s cubic-bezier(0.16,1,0.3,1)';
    sheet.style.transform = 'translateY(0)';
  }));
  clearTimeout(_pcDismissTimer);
  document.addEventListener('keydown', _pcEscHandler);
  setTimeout(() => overlay.querySelector('.pc-primary')?.focus(), 400);
  fillProjectCompleteStats(projectId);
  if (window.Rewards) Rewards.fillCelebration(projectId);
  if (window.Race && projectId) Race.fillCelebration(projectId); // your place, if this goal was a race
}
async function fillProjectCompleteStats(projectId) {
  try {
    const [allProjects, allTasks, why] = await Promise.all([API.getProjects(), API.getTasks(), window.Why ? Why.load().then(() => Why.get()).catch(() => null) : null]);
    const stats = [];
    if (projectId) {
      const project = allProjects.find(p => p.id === projectId);
      const tree = tasksInProjectTree(projectId, allProjects, allTasks);
      const DAY = 86400000;
      const beaten = tree.reduce((n, t) => n + (t.obstacles || []).filter(o => o.resolved).reduce((m, o) => m + (o.count || 1), 0), 0);
      const starts = tree.map(t => t.startDate).filter(Boolean).sort();
      const startMs = Date.parse((project && project.startDate) || starts[0] || (project && project.createdAt) || Date.now());
      const days = Math.max(1, Math.ceil((Date.now() - startMs) / DAY));
      const ends = tree.map(t => (t.endDate || '').slice(0, 10)).filter(Boolean).sort();
      const due = ends[ends.length - 1];
      const diff = due ? Math.round((Date.parse(`${due}T23:59:59`) - Date.now()) / DAY) : null;
      stats.push({ n: tree.length, label: tree.length === 1 ? 'task done' : 'tasks done' });
      if (beaten) stats.push({ n: beaten, label: beaten === 1 ? 'blocker beaten' : 'blockers beaten' });
      stats.push({ n: days, label: days === 1 ? 'day' : 'days' });
      if (diff !== null) stats.push(diff > 0 ? { n: diff, label: diff === 1 ? 'day early' : 'days early', good: true } : diff === 0 ? { n: '✓', label: 'right on time', good: true } : { n: -diff, label: -diff === 1 ? 'day over' : 'days over' });
      _pcData.stats = stats;
    }
    if (!_pcData || _pcData.projectId !== projectId) return;
    document.getElementById('project-complete-stats').innerHTML = stats.map(x => `<div class="${x.good ? 'good' : ''}"><b>${esc(String(x.n))}</b><span>${esc(x.label)}</span></div>`).join('');
    const whyEl = document.getElementById('project-complete-why');
    if (why && why.why) {
      whyEl.innerHTML = `You said you were doing this <b>${esc(why.why.replace(/^(so |to |because )/i, m => m.toLowerCase()))}</b>. You just did.`;
      whyEl.classList.remove('hidden');
    } else if (why && why.becoming) {
      whyEl.innerHTML = `You're becoming <b>${esc(why.becoming)}</b>. This is what that looks like.`;
      whyEl.classList.remove('hidden');
    }
  } catch { /* the celebration still stands without the numbers */ }
}
function planNextAfterComplete() {
  const title = _pcData && _pcData.title;
  dismissProjectCompleteOverlay();
  paletteAsk(title ? `I just finished "${title}". Help me plan what's next.` : 'I just finished a goal. Help me plan what is next.');
}
function reportFromComplete() {
  const id = _pcData && _pcData.projectId;
  dismissProjectCompleteOverlay();
  if (id) openProgressReport(id);
}
// A picture of the moment for WhatsApp, Instagram and friends.
async function shareProjectComplete() {
  if (!_pcData) return;
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 1350);
  bg.addColorStop(0, '#12485A'); bg.addColorStop(0.55, '#0D1B2A'); bg.addColorStop(1, '#0B1220');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
  const font = (w, sz) => `${w} ${sz}px Inter, system-ui, -apple-system, Segoe UI, sans-serif`;
  const glow = g.createRadialGradient(540, 330, 20, 540, 330, 170);
  glow.addColorStop(0, '#FDE68A'); glow.addColorStop(0.6, '#F59E0B'); glow.addColorStop(1, 'rgba(245,158,11,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(540, 330, 170, 0, Math.PI * 2); g.fill();
  g.textAlign = 'center';
  g.fillStyle = '#FCD34D'; g.font = font(800, 34); g.fillText('GOAL COMPLETE', 540, 600);
  g.fillStyle = '#fff'; g.font = font(900, 96); g.fillText('I did it.', 540, 710);
  g.fillStyle = '#C9D6E2'; g.font = font(700, 46);
  const t = _pcData.title || '';
  g.fillText(t.length > 34 ? t.slice(0, 33) + '…' : t, 540, 790);
  (_pcData.stats || []).slice(0, 4).forEach((x, i, arr) => {
    const w = 900 / arr.length, cx = 90 + w * i + w / 2;
    g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(cx - w / 2 + 10, 880, w - 20, 200, 28); g.fill();
    g.fillStyle = x.good ? '#5EEAD4' : '#fff'; g.font = font(900, 80); g.fillText(String(x.n), cx, 985);
    g.fillStyle = '#9FB3C8'; g.font = font(600, 30); g.fillText(x.label, cx, 1040);
  });
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = font(700, 32); g.fillText(location.host, 540, 1270);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'goal-complete.png', { type: 'image/png' });
  const text = `I just finished "${_pcData.title}" with StartLine.`;
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('🖼️ Saved the picture. Share it anywhere');
}
function _pcEscHandler(e) {
  if (e.key === 'Escape') dismissProjectCompleteOverlay();
}
function dismissProjectCompleteOverlay() {
  const overlay = document.getElementById('project-complete-overlay');
  const sheet = document.getElementById('project-complete-sheet');
  if (overlay.classList.contains('hidden')) return;
  clearTimeout(_pcDismissTimer);
  document.removeEventListener('keydown', _pcEscHandler);
  sheet.style.transition = 'transform 0.25s ease-in';
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }, 250);
}
// Swipe-down (or mouse-drag-down) to dismiss, via Pointer Events so touch
// and mouse behave the same way. Wired once at script load — the sheet is
// static markup, always present in the DOM.
(function initProjectCompleteSwipe() {
  const sheet = document.getElementById('project-complete-sheet');
  if (!sheet) return;
  let startY = null, dragging = false;
  sheet.addEventListener('pointerdown', (e) => {
    // A press on a button or link is a tap, not the start of a swipe:
    // capturing the pointer here would take the click away from it (the
    // Close, Share and Report buttons did nothing).
    if (e.target.closest('button, a, input, textarea, select, [role="button"]')) return;
    startY = e.clientY;
    dragging = true;
    sheet.style.transition = 'none';
    try { sheet.setPointerCapture(e.pointerId); } catch { /* unsupported in some test environments */ }
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!dragging || startY === null) return;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = startY !== null && e.clientY != null ? Math.max(0, e.clientY - startY) : 0;
    startY = null;
    if (dy > 90) {
      dismissProjectCompleteOverlay();
    } else {
      sheet.style.transition = 'transform 0.2s ease-out';
      sheet.style.transform = 'translateY(0)';
    }
  };
  sheet.addEventListener('pointerup', endDrag);
  sheet.addEventListener('pointercancel', endDrag);
})();

async function celebrateTaskCompletion(task) {
  Sfx.play('complete');
  // XP/level-up/achievement toasts matter regardless of which view is open
  // — they're not Journey-view-local the way the confetti below is.
  announceJourneyReward(task.journeyReward);

  // Journey view (a sub-view of the Gantt page) celebrates locally at its
  // own checkpoint — stand aside rather than double up when it's the one
  // currently on screen.
  const journeyOnScreen = APP.currentPage === 'gantt' && !document.getElementById('gantt-journey-view').classList.contains('hidden');
  if (journeyOnScreen) return;
  if (celebrationsEnabled()) fireScreenConfetti(window.innerWidth / 2, window.innerHeight * 0.15, 60);
  showToast(`🎉 "${task.title}" complete!`);

  // A task finishing off every task in its project gets a bigger moment.
  try {
    const project = await API.getProject(task.projectId);
    const topId = project.parentId || project.id;
    const [allProjects, allTasks] = await Promise.all([API.getProjects(), API.getTasks()]);
    const tree = tasksInProjectTree(topId, allProjects, allTasks);
    if (tree.length && tree.every(t => t.status === 'Completed')) {
      const top = project.parentId ? await API.getProject(topId) : project;
      setTimeout(() => {
        if (celebrationsEnabled()) {
          fireBigScreenConfetti();
          fireBalloons(14);
          showProjectCompleteOverlay(top.title, { projectId: top.id });
        }
        showToast(`🏆 Project complete: "${top.title}"! Incredible work.`);
      }, 400);
    }
  } catch {
    // Non-critical: the per-task celebration already happened either way.
  }
}

// Journey gaming toasts — XP, a level-up, any newly unlocked achievements.
// Fires from the same reward payload the backend already computed (see
// backend/journey.js), so there's nothing to re-derive client-side.
function announceJourneyReward(reward) {
  if (!reward) return;
  // Focus mode: the rewards still count, quietly, with no announcements.
  if (focusModeOn()) { updateJourneyLevelBadge({ level: reward.level, rank: reward.rank }); if (reward.quests) renderDailyQuests(reward.quests); return; }
  floatXp(reward.xpAwarded - (reward.questBonus || 0), reward.early ? 'early finish bonus' : reward.blocker ? 'blocker beaten' : '');
  let delay = 700;
  if (reward.questBonus) {
    setTimeout(() => { Sfx.play('quest'); floatXp(reward.questBonus, "all today's quests"); showToast(`🎯 All of today's quests done! +${reward.questBonus} XP`); }, delay);
    delay += 900;
  }
  if (reward.leveledUp) { setTimeout(() => showLevelUp(reward), delay); delay += 1600; }
  (reward.newAchievements || []).forEach((a, i) => {
    setTimeout(() => { Sfx.play('achievement'); showToast(`🏆 Achievement unlocked: ${a.name}`); }, delay + i * 1100);
  });
  updateJourneyLevelBadge({ level: reward.level, rank: reward.rank });
  if (reward.quests) renderDailyQuests(reward.quests);
}

function updateJourneyLevelBadge(g) {
  const badge = document.getElementById('journey-level-badge');
  if (!badge || !g) return;
  badge.innerHTML = `${emojiIcon(g.rank ? g.rank.icon : '⭐')} Lv.${g.level}`;
  if (g.rank) badge.title = `${g.rank.name}, level ${g.level}. Open the Trophy Case`;
  badge.classList.remove('hidden');
  badge.classList.add('flex');
}

async function openJourneyTrophyCase() {
  API.trackFeature('trophies');
  openModal('modal-journey-trophy');
  try {
    const g = await API.getJourneyGaming();
    document.getElementById('trophy-level-text').innerHTML = `${emojiIcon(g.rank.icon)} ${esc(g.rank.name)} · Level ${g.level}`;
    document.getElementById('trophy-stats').textContent = `${g.tasksCompleted} task${g.tasksCompleted === 1 ? '' : 's'} done · ${g.blockersBeaten} blocker${g.blockersBeaten === 1 ? '' : 's'} beaten · ${g.questDays} quest day${g.questDays === 1 ? '' : 's'} · ${g.achievements.filter(a => a.unlocked).length}/${g.achievements.length} achievements`;
    document.getElementById('trophy-quests').innerHTML = g.daily.quests.map(q => `
      <div class="quest-chip ${q.done ? 'is-done' : ''}"><span class="quest-icon">${emojiIcon(q.done ? '✅' : q.icon)}</span>
        <span class="min-w-0"><span class="block truncate font-semibold">${esc(q.text)}</span><span class="quest-bar"><i style="width:${Math.round(q.progress / q.target * 100)}%"></i></span></span>
        <span class="quest-count">${q.progress}/${q.target}</span></div>`).join('') + `<p class="text-[11px] text-gray-400 mt-1">${g.daily.allDone ? `Done for today. +${g.daily.bonusXp} XP earned.` : `Finish all three today for +${g.daily.bonusXp} XP. New quests every day.`}</p>`;
    renderDailyQuests(g.daily.quests, g.daily);
    const { floor, ceiling } = g.levelProgress;
    const pct = ceiling > floor ? Math.round(((g.xp - floor) / (ceiling - floor)) * 100) : 100;
    document.getElementById('trophy-xp-bar').style.width = pct + '%';
    document.getElementById('trophy-xp-text').textContent = `${g.xp - floor} / ${ceiling - floor} XP to Level ${g.level + 1}`;
    const groups = [...new Set(g.achievements.map(a => a.group || 'More'))];
    document.getElementById('trophy-achievements').innerHTML = groups.map(group => `
      <p class="col-span-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2">${esc(group)}</p>
      ${g.achievements.filter(a => (a.group || 'More') === group).map(a => `
      <div class="flex flex-col items-center text-center p-3 rounded-xl border ${a.unlocked ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50 opacity-50'}">
        <span class="text-2xl mb-1">${emojiIcon(a.unlocked ? a.icon : '🔒')}</span>
        <span class="text-xs font-bold text-navy">${esc(a.name)}</span>
        <span class="text-[10px] text-gray-400 mt-0.5">${esc(a.desc)}</span>
      </div>`).join('')}`).join('');
    updateJourneyLevelBadge(g);
  } catch (e) { console.error('Journey gaming error:', e); }
}

// Purely cosmetic — a small spark wherever you tap the build scene. Real
// progress (XP, the house itself) only ever comes from actually completing
// a task below, never from clicking here, so this can't be farmed.
// Wrapping the one shared API call means every place in the app that
// completes a task gets this for free, with nothing to change at any of
// those call sites.
const _updateTaskRaw = API.updateTask;
API.updateTask = async function (id, patch) {
  const result = await _updateTaskRaw(id, patch);
  if (result && result.justCompleted) celebrateTaskCompletion(result);
  return result;
};

function openAddProject() {
  fillProjectForm({}, 'new');
  document.getElementById('proj-invite-emails').value = '';
  document.getElementById('proj-ai-text').value = '';
  renderProjectTemplates();
  openModal('modal-project');
  setProjectStartMode('blank');
}

// Settings → "Your tasks in your calendar": the private subscription link
// (backend/routes/calendar.js), with one-tap adds for Google and for the
// webcal: apps (Apple Calendar, Outlook).
function showCalendarFeed(url) {
  document.getElementById('calendar-feed-url').value = url;
  const webcal = url.replace(/^https?:/, 'webcal:');
  document.getElementById('calendar-feed-webcal').href = webcal;
  document.getElementById('calendar-feed-google').href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
}
async function loadCalendarFeed() {
  try { showCalendarFeed((await API.getCalendarFeed()).url); } catch { /* the card just stays empty */ }
}
async function copyCalendarFeed() {
  const url = document.getElementById('calendar-feed-url').value;
  if (!url) return;
  try { await navigator.clipboard.writeText(url); showToast('📋 Link copied. Paste it into your calendar app'); }
  catch { document.getElementById('calendar-feed-url').select(); showToast('Select the link and copy it'); }
}
function resetCalendarFeed() {
  confirmAction('Reset your calendar link? Calendars subscribed to the old link will stop updating until you add the new one.', async () => {
    try { showCalendarFeed((await API.resetCalendarFeed()).url); showToast('🔄 New calendar link ready'); }
    catch (e) { showToast('❌ ' + (e.message || 'Could not reset the link'), 'error'); }
  });
}

// Invites whoever was listed under "Invite people" in New Project to the
// project just created. Returns a short note for the toast.
async function inviteFromNewProject(projectId) {
  const emails = [...new Set(document.getElementById('proj-invite-emails').value.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean))];
  if (!emails.length) return '';
  const role = document.getElementById('proj-invite-role').value;
  const results = await Promise.all(emails.map(email => API.inviteCollaborator(projectId, email, role).then(r => ({ ok: true, r }), e => ({ ok: false, email, e }))));
  const ok = results.filter(x => x.ok).length;
  const failed = results.filter(x => !x.ok);
  if (failed.length) setTimeout(() => showToast(`⚠️ Couldn't invite ${failed.map(f => f.email).join(', ')}: ${failed[0].e.message || 'error'}`, 'error'), 3000);
  return ok ? ` Invited ${ok} ${ok === 1 ? 'person' : 'people'}.` : '';
}
