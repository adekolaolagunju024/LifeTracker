// Replays: a step finished or a blocker ticked off anywhere but the
// Journey (the task list, the board, the task panel, the assistant) can
// still be seen on the goal's own Journey world, in 2D or 3D.
//
// How much of that you get is one setting (Settings → Appearance), saved on
// this device:
//   play  a small player slides into the corner and plays the moment,
//         without blocking anything; swipe or close it away
//   ask   (the default) a toast offers "Watch"
//   off   nothing plays
// and a goal can override it (its ⋯ menu → Replays): "quiet" never plays,
// "always" always plays. Finishing a whole goal is the big one: with
// play it runs to the finish line before the "You did it" page comes up;
// otherwise that page carries a Watch button.
//
// Nothing here runs while the Journey for that goal, or the full Today's
// road, is on screen: the moment already plays there.
const Replays = (() => {
  const MODE_KEY = 'replayMode';
  const GOALS_KEY = 'replayGoals';
  const MODES = ['play', 'ask', 'off'];
  const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  function mode() { const m = read(MODE_KEY, 'ask'); return MODES.includes(m) ? m : 'ask'; }
  function setMode(m) {
    if (!MODES.includes(m)) return;
    write(MODE_KEY, m);
    paintSettings();
    if (typeof showToast === 'function') showToast(m === 'play' ? 'Replays will play in the corner' : m === 'ask' ? "You'll be offered a Watch button" : 'Replays are off');
  }
  function goalPrefs() { try { return JSON.parse(read(GOALS_KEY, '{}')) || {}; } catch { return {}; } }
  function goalMode(goalId) { return goalPrefs()[goalId] || ''; }
  function setGoalMode(goalId, m) {
    const p = goalPrefs();
    if (m === 'quiet' || m === 'always') p[goalId] = m; else delete p[goalId];
    write(GOALS_KEY, JSON.stringify(p));
  }
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // What happens for this goal: 'play', 'ask' or 'off'.
  function effective(goalId) {
    const g = goalMode(goalId);
    const m = g === 'quiet' ? 'off' : g === 'always' ? 'play' : mode();
    return m === 'play' && reducedMotion() ? 'ask' : m;
  }
  // The moment is already playing where you are.
  function sceneOnScreen(goalId) {
    if (document.getElementById('dayroad-scene')) return true;
    const view = document.getElementById('gantt-journey-view');
    const journey = APP.currentPage === 'gantt' && view && !view.classList.contains('hidden');
    return !!(journey && typeof mountainState !== 'undefined' && mountainState && mountainState.projectId === goalId);
  }

  // The goal a task sits in (its top-level project), its tasks in the
  // Journey's order, and whether every one is done.
  async function goalOf(projectId) {
    const [projects, tasks] = await Promise.all([API.getProjects(), API.getTasks()]);
    const byId = Object.fromEntries(projects.map(p => [p.id, p]));
    // a goal shared with you may not be in your own list: fetch up the tree
    const get = async id => byId[id] || (byId[id] = await API.getProject(id).catch(() => null));
    let top = await get(projectId);
    for (let guard = 0; top && top.parentId && guard < 20; guard++) top = (await get(top.parentId)) || { ...top, parentId: null };
    if (!top) return null;
    if (!projects.some(p => p.id === top.id)) projects.push(top);
    const tree = tasksInProjectTree(top.id, projects, tasks).slice()
      .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999') || (a.createdAt || '').localeCompare(b.createdAt || ''));
    return { id: top.id, title: top.title, tasks: tree, finished: tree.length > 0 && tree.every(t => t.status === 'Completed') };
  }

  // Ticks that land close together play as one clip, not a stack of toasts.
  const pending = new Map(); // goalId -> { goal, events: [{ kind, taskId, obstacleId, text }] }
  let flushTimer = null;
  function queue(goal, event) {
    const p = pending.get(goal.id) || { goal, events: [] };
    p.goal = goal; // the latest read of its tasks
    if (!p.events.some(e => e.kind === event.kind && e.taskId === event.taskId && e.obstacleId === event.obstacleId)) p.events.push(event);
    pending.set(goal.id, p);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 900);
  }
  function flush() {
    const batch = [...pending.values()];
    pending.clear();
    batch.forEach(({ goal, events }) => {
      const m = effective(goal.id);
      if (m === 'off' || sceneOnScreen(goal.id)) { finishUp(goal, false); return; }
      const finish = goal.finished && events.some(e => e.kind === 'done');
      if (m === 'play') { enqueuePlay(goal, events, { finish }); return; }
      // ask: a finished goal gets its Watch button on the "You did it" page
      if (finish || typeof showActionToast !== 'function') return;
      const label = events.length === 1 ? events[0].text : `${events.length} moments on “${goal.title}”`;
      showActionToast(label, [{ label: 'Watch', run: () => enqueuePlay(goal, events, { finish: false }) }], 'play');
    });
  }

  // A step done anywhere. Called from celebrateTaskCompletion with the
  // goal it already worked out; returns true when the replay will run to
  // the finish line itself, so the caller holds the "You did it" page
  // back until then (then() brings it up).
  function taskDone(task, goal, then) {
    if (!goal || !task) return false;
    const m = effective(goal.id);
    if (m === 'off' || sceneOnScreen(goal.id)) return false;
    queue(goal, { kind: 'done', taskId: task.id, text: `“${task.title}” done` });
    if (goal.finished && m === 'play') { finishHooks.set(goal.id, then); return true; }
    return false;
  }
  const finishHooks = new Map(); // goalId -> what to run once its finish has played
  async function blockerCleared(obstacle) {
    if (!obstacle || !obstacle.taskId) return;
    try {
      const t = await API.getTask(obstacle.taskId);
      if (!t || t.status === 'Completed') return;
      const goal = await goalOf(t.projectId);
      if (!goal || effective(goal.id) === 'off' || sceneOnScreen(goal.id)) return;
      queue(goal, { kind: 'blocker', taskId: t.id, obstacleId: obstacle.id, text: `Knocked out “${obstacle.name || 'a blocker'}”` });
    } catch { /* offline: nothing to show */ }
  }
  // The "You did it" page's Watch button.
  async function watchFinish(goalId) {
    try {
      const goal = await goalOf(goalId);
      if (!goal || !goal.tasks.length) return;
      const last = goal.tasks.reduce((a, b) => ((b.completedAt || '') > (a.completedAt || '') ? b : a));
      if (typeof dismissProjectCompleteOverlay === 'function') dismissProjectCompleteOverlay();
      enqueuePlay(goal, [{ kind: 'done', taskId: last.id, text: `“${last.title}” done` }], { finish: true, again: true });
    } catch { if (typeof showToast === 'function') showToast('Could not load that replay', 'error'); }
  }
  const offersWatch = goalId => effective(goalId) !== 'off';

  // ── The corner player ──
  let chain = Promise.resolve();
  let current = null; // { stopped, close }
  function enqueuePlay(goal, events, opts) { chain = chain.then(() => play(goal, events, opts)).catch(() => {}); return chain; }
  const wait = ms => new Promise(res => setTimeout(res, ms));
  const sceneReady = box => {
    const j = box && box._j3d;
    if (!j) return !!(box && box.querySelector('svg'));
    return !j._debug || !!(j._debug.state && j._debug.state.ready);
  };
  const STAGE_NAMES = { football: 'The Stadium', space: 'Deep Space', castle: 'The Castle', construction: 'The Build Site', sprint: 'Sprint Track', mountain: 'The Mountain' };

  async function play(goal, events, { finish = false, again = false } = {}) {
    if (typeof JourneyGame === 'undefined') return finishUp(goal, again);
    // Its own copy of the tasks, set back to just before these moments.
    const tasks = goal.tasks.map(t => ({ ...t, obstacles: (t.obstacles || []).map(o => ({ ...o })) }));
    const steps = events.map(e => {
      const t = tasks.find(x => x.id === e.taskId);
      if (!t) return null;
      if (e.kind === 'done') { t.status = 'In Progress'; return { e, apply: () => { t.status = 'Completed'; } }; }
      const o = (t.obstacles || []).find(x => x.id === e.obstacleId);
      if (!o) return null;
      o.resolved = false;
      return { e, apply: () => { o.resolved = true; } };
    }).filter(Boolean);
    if (!steps.length) return finishUp(goal, again);
    close(true);
    const stage = typeof getJourneyStage === 'function' ? getJourneyStage() : 'football';
    const el = document.createElement('div');
    el.id = 'replay-mini';
    el.className = 'replay-mini';
    el.dataset.world = stage;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Replay on “${goal.title}”`);
    el.innerHTML = `<div class="replay-mini-scene" id="replay-mini-scene" role="img" aria-label="${esc(`${goal.title} as a ${STAGE_NAMES[stage] || stage} world`)}"></div>
      <div class="replay-mini-bar">
        <div class="min-w-0"><p class="replay-mini-kicker">${icon('play', 'tiny')}${esc(STAGE_NAMES[stage] || 'Replay')} · ${esc(goal.title)}</p><p class="replay-mini-cap" role="status"></p></div>
        <button type="button" class="replay-mini-btn" data-act="open" title="Open the Journey" aria-label="Open this goal's Journey">${icon('maximize-2')}</button>
        <button type="button" class="replay-mini-btn" data-act="close" title="Close" aria-label="Close the replay">${icon('close')}</button>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const run = { stopped: false };
    let hovering = false;
    el.addEventListener('pointerenter', () => { hovering = true; });
    el.addEventListener('pointerleave', () => { hovering = false; });
    el.querySelector('[data-act="close"]').onclick = () => close();
    el.querySelector('[data-act="open"]').onclick = () => { close(); if (typeof playJourneyFor === 'function') playJourneyFor(goal.id); };
    swipeAway(el);
    current = { run, el, goalId: goal.id };
    const box = el.querySelector('#replay-mini-scene');
    const cap = text => { const c = el.querySelector('.replay-mini-cap'); if (c) c.textContent = text; };
    let summited = false;
    const sync = () => {
      const done = tasks.filter(t => t.status === 'Completed').length;
      box.dataset.cam = typeof getJourneyCam === 'function' ? getJourneyCam() : '';
      JourneyGame.sync(box, {
        tasks, youFrac: tasks.length ? done / tasks.length : 0, summitLit: tasks.length > 0 && done === tasks.length,
        theme: typeof getJourneyTheme === 'function' ? getJourneyTheme() : stage, ghost: null,
        celebrationsEnabled: typeof celebrationsEnabled === 'function' ? celebrationsEnabled() : true,
        onSummit: () => { summited = true; },
      });
    };
    cap('Setting the scene…');
    sync();
    for (let waited = 0; waited < 20000 && !run.stopped && !sceneReady(box); waited += 250) await wait(250);
    if (run.stopped) return finishUp(goal, again);
    await wait(600);
    const gap = box._j3d ? 3400 : 1800; // a 3D character takes longer to get there
    for (const s of steps) {
      if (run.stopped) break;
      s.apply();
      cap(s.e.text);
      sync();
      await wait(gap);
    }
    if (finish && !run.stopped) {
      cap('Heading for the finish…');
      for (let waited = 0; waited < 15000 && !run.stopped && !summited; waited += 250) await wait(250);
      if (!run.stopped) cap(`“${goal.title}”: you made it!`);
      await wait(2600);
    }
    // stays up while the pointer is on it, then goes
    for (let waited = 0; !run.stopped && (waited < 1800 || hovering) && waited < 20000; waited += 300) await wait(300);
    if (!run.stopped) close();
    return finishUp(goal, again);
  }
  function finishUp(goal, again) {
    const then = finishHooks.get(goal.id);
    finishHooks.delete(goal.id);
    if (then && !again) then();
  }
  function close(silent) {
    if (!current) return;
    const { run, el } = current;
    run.stopped = true;
    current = null;
    const box = el.querySelector('#replay-mini-scene');
    if (box && typeof JourneyGame !== 'undefined') JourneyGame.destroy(box);
    if (silent) { el.remove(); return; }
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  }
  // A flick down (or sideways) sends it away, as on a phone notification.
  function swipeAway(el) {
    let x0 = null, y0 = 0;
    el.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener('pointerup', e => {
      if (x0 == null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (dy > 50 || Math.abs(dx) > 80) close();
    });
  }

  // ── Settings and the goal's own choice ──
  function paintSettings() {
    const m = mode();
    document.querySelectorAll('[data-replay-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.replayMode === m)));
  }
  function openGoalSheet(goalId) {
    document.getElementById('replay-goal-sheet')?.remove();
    const cur = goalMode(goalId);
    const opt = (v, title, sub) => `<label class="replay-opt"><input type="radio" name="replay-goal" value="${v}" ${cur === v ? 'checked' : ''}><span><b>${title}</b><small>${sub}</small></span></label>`;
    const el = document.createElement('div');
    el.id = 'replay-goal-sheet';
    el.className = 'replay-sheet-overlay';
    el.innerHTML = `<div class="replay-sheet" role="dialog" aria-modal="true" aria-labelledby="replay-goal-title">
      <h3 id="replay-goal-title">${icon('clapperboard')}Replays for this goal</h3>
      <p class="replay-sheet-sub">When you tick off a step or a blocker on this goal outside its Journey.</p>
      ${opt('', 'Use my setting', `Now: ${mode() === 'play' ? 'play in the corner' : mode() === 'ask' ? 'offer a Watch button' : 'off'}. Change it in Settings → Appearance.`)}
      ${opt('always', 'Always play', 'Play every moment in the corner, even if replays are off elsewhere.')}
      ${opt('quiet', 'Quiet', 'Never play or offer replays for this goal. Good for work goals.')}
      <div class="replay-sheet-foot"><button type="button" class="replay-sheet-done">Done</button></div>
    </div>`;
    const shut = () => el.remove();
    el.addEventListener('click', e => { if (e.target === el) shut(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') shut(); });
    el.addEventListener('change', e => { if (e.target.name === 'replay-goal') setGoalMode(goalId, e.target.value); });
    document.body.appendChild(el);
    el.querySelector('.replay-sheet-done').onclick = shut;
    (el.querySelector('input:checked') || el.querySelector('input')).focus();
  }
  document.addEventListener('DOMContentLoaded', paintSettings);

  return { mode, setMode, goalMode, setGoalMode, effective, taskDone, blockerCleared, watchFinish, offersWatch, openGoalSheet, paintSettings, close, goalOf };
})();
window.Replays = Replays;
