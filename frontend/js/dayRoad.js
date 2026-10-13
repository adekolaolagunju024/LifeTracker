/* global API, DayPace, showToast, clockText, taskErrorToast, taskGateMessage, showGateCard, refreshAfterStart, announceJourneyReward, Sfx, DayReport, blockerChecklist, celebrationsEnabled, closeTaskDetail, icon, esc, localDateKey, focusModeOn, getJourneyStage, getJourneyTheme, getJourneyView, setJourneyTheme, setJourneyView, journeyCanDo3D, JourneyGame, openTaskDetail, Jarvis */
// ── TODAY'S ROAD ────────────────────────────────────────────────
// Today's plan as a road: a stop for each task, You moving as you finish
// them, and the Pacer keeping to the timetable by the clock (the maths is
// js/dayPace.js). Drawn wherever an element asks for it with
// data-dayroad="panel" (the focus timer) or "card" (the dashboard's Today
// card), and full size from either. With the game off it's a plain
// progress strip; with it on, it takes the colours and character of your
// Journey world. It moves on its own every minute.
const DayRoad = (() => {
  let plan = null; let tasks = []; let loadedAt = 0; let loading = null;
  const CHAR = { football: 'volleyball', space: 'rocket', castle: 'castle', construction: 'construction' };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const game = () => !(typeof focusModeOn === 'function' && focusModeOn());
  const world = () => { try { return getJourneyStage(); } catch { return 'football'; } };

  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      const today = localDateKey(new Date());
      try {
        const [p, t] = await Promise.all([API.getDayPlan(today), API.getTasks()]);
        plan = p && p.items && p.items.length ? p : null;
        tasks = t || [];
        loadedAt = Date.now();
      } catch { /* offline: keep what we had */ }
      loading = null;
      render();
    })();
    return loading;
  }
  // Pace right now, or null with no plan today.
  function state() {
    if (!plan || plan.date !== localDateKey(new Date())) return null;
    const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
    const items = plan.items.filter(i => byId[i.taskId]);
    const done = new Set(items.filter(i => byId[i.taskId].status === 'Completed').map(i => i.taskId));
    const finished = items.map(i => byId[i.taskId].completedAt).filter(Boolean).map(s => new Date(s)).filter(d => localDateKey(d) === plan.date);
    const last = finished.length ? Math.max(...finished.map(d => d.getHours() * 60 + d.getMinutes())) : null;
    const r = DayPace.compute(items, done, nowMin(), last);
    r.items = items.map(i => ({ ...i, task: byId[i.taskId], done: done.has(i.taskId) }));
    r.next = r.items.find(i => !i.done) || null;
    return r;
  }

  const pct = (x, n) => Math.max(0, Math.min(100, (x / n) * 100));
  const blockersOf = t => (t.obstacles || []).filter(o => !o.resolved).length;
  // The strip: stops at the end of each task, You and the Pacer on it.
  function strip(r, big = false) {
    const g = game();
    const you = g ? icon(CHAR[world()] || 'footprints') : '';
    const stops = r.items.map((it, k) => `<span class="droad-stop ${it.done ? 'done' : ''} ${blockersOf(it.task) && !it.done ? 'blk' : ''}" style="left:${pct(k + 1, r.n)}%" title="${esc(`${clockText(it.start)} ${it.task.title}`)}">${big ? `<em>${esc(clockText(it.start, true))}</em>` : ''}</span>`).join('');
    const gx = pct(r.pacer, r.n); const yx = pct(r.done, r.n);
    return `<div class="droad-track ${g ? `world-${world()}` : 'plain'} ${big ? 'big' : ''}" role="img" aria-label="${esc(`${r.done} of ${r.n} tasks done. ${r.text}`)}">
      <i class="droad-fill" style="width:${yx}%"></i>${stops}
      <span class="droad-pacer" style="left:${gx}%" title="The Pacer: where your timetable says you'd be now">${icon('timer')}</span>
      <span class="droad-you" style="left:${yx}%" title="You">${you}</span>
    </div>`;
  }
  // Once the plan is done, or its time is up, the report on how it went
  // (js/dayReport.js) is offered beside Full view.
  const dayOver = r => r.state === 'done' || nowMin() >= r.planEnd;
  function line(r, mode) {
    const nx = r.next ? `Next: ${esc(clockText(r.next.start))} ${esc(r.next.task.title)}${window.TaskActions ? ` ${TaskActions.chip(r.next.task, 'is-inline')}` : ''}` : '';
    return `<div class="droad-line"><b class="droad-state ${r.state}">${esc(r.text)}</b>
      <span>${r.done} of ${r.n} done${nx && mode !== 'card' ? ` · ${nx}` : ''}</span>
      ${dayOver(r) ? `<button type="button" class="droad-full droad-report" onclick="DayReport.open()">${icon('chart-column')}<span>How today went</span></button>` : ''}
      <button type="button" class="droad-full" onclick="DayRoad.openFull()">${icon('maximize-2')}<span>Full view</span></button></div>`;
  }
  function render() {
    const r = state();
    document.querySelectorAll('[data-dayroad]').forEach(el => {
      const mode = el.dataset.dayroad;
      el.innerHTML = r ? `<div class="droad droad-${mode}">${strip(r)}${line(r, mode)}</div>` : '';
      el.classList.toggle('hidden', !r);
    });
    const full = document.getElementById('dayroad-full');
    if (full) paintFull(full, r, true);
    if (window.Jarvis && Jarvis.paceChanged) Jarvis.paceChanged(r);
  }

  // Full size, two ways to see it. Road: the strip big, then the day as a
  // list of stops. Game: today's plan played in your Journey world, 2D or
  // 3D (js/journeyGame.js draws it, as it does a project's Journey): each
  // task a stop on the road, its blockers the enemies in the way, and the
  // Pacer racing you to the finish. The last choice is remembered; with
  // the game layer on, Game is where it starts.
  const MODE_KEY = 'dayroadMode';
  let modeOverride = null; // 'game' while replaying a knockout, without changing the saved choice
  const fullMode = () => { if (modeOverride) return modeOverride; try { return localStorage.getItem(MODE_KEY) || (game() ? 'game' : 'road'); } catch { return 'road'; } };
  const STAGES = [['football', 'Football'], ['space', 'Space'], ['castle', 'Castle'], ['construction', 'Construction']];
  function openFull(mode = null) {
    API.trackFeature && API.trackFeature('journey');
    closeFull();
    modeOverride = mode;
    const el = document.createElement('div');
    el.id = 'dayroad-full';
    el.className = 'dayroad-overlay';
    el.addEventListener('click', e => { if (e.target === el) closeFull(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') closeFull(); });
    // Ticking a blocker in the list plays its knockout in the scene, so on
    // a small screen bring the scene back into view to see it.
    el.addEventListener('change', e => {
      if (!e.target.matches('[data-obstacle-id]') || !e.target.checked) return;
      const scene = document.getElementById('dayroad-scene');
      if (!scene) return;
      const box = scene.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) scene.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.body.appendChild(el);
    paintFull(el, state());
    el.querySelector('.dayroad-x')?.focus();
  }
  function setMode(m) {
    modeOverride = null;
    try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ }
    const el = document.getElementById('dayroad-full');
    if (el) paintFull(el, state());
  }
  function setWorld(stage) {
    if (typeof setJourneyTheme === 'function') setJourneyTheme(stage);
    const el = document.getElementById('dayroad-full');
    if (el) paintFull(el, state());
  }
  function setView(v) {
    if (typeof setJourneyView === 'function') setJourneyView(v);
    const el = document.getElementById('dayroad-full');
    if (el) paintFull(el, state());
  }
  const can3d = () => typeof journeyCanDo3D === 'function' && journeyCanDo3D();
  const theme = () => { try { return getJourneyTheme(); } catch { return 'football'; } };
  const view3d = () => { try { return getJourneyView() === '3d' && can3d(); } catch { return false; } };

  function summaryHTML(r) {
    return `<b class="droad-state ${r.state}">${esc(r.text)}</b> · ${r.done} of ${r.n} done · plan ends at ${clockText(fmt(r.planEnd))}`;
  }
  function listHTML(r) {
    return r.items.map((it, k) => {
      const b = blockersOf(it.task);
      const pacerHere = !it.done && Math.floor(r.pacer) === k && r.state !== 'before';
      return `<li class="${it.done ? 'done' : it === r.next ? 'next' : ''}">
        <span class="dayroad-time">${esc(clockText(it.start))}<small>${esc(DayPace.minutesText(it.minutes))}</small></span>
        <button type="button" class="dayroad-dot" role="checkbox" aria-checked="${it.done}" onclick="DayRoad.toggleDone('${it.taskId}')" aria-label="${esc(it.done ? `Reopen ${it.task.title}` : `Mark ${it.task.title} as done`)}" title="${it.done ? 'Done. Tap to reopen' : 'Tick when it’s done'}">
          <span class="dd-mark">${it.done ? icon('check') : it === r.next ? icon(game() ? (CHAR[world()] || 'footprints') : 'play') : ''}</span>${it.done ? '' : `<span class="dd-tick">${icon('check')}</span>`}</button>
        <div class="dayroad-main"><button type="button" class="dayroad-task" onclick="openTaskDetail('${it.taskId}')"><b>${esc(it.task.title)}</b>
          ${b && !it.done ? `<small class="blk">${icon('blocker', 'tiny')}${b} ${b === 1 ? 'blocker' : 'blockers'} in the way: tick one when it clears</small>`
            : it.done ? '<small>Done</small>'
              : (it.task.obstacles || []).length ? `<small class="clr">${icon('check', 'tiny')}All blockers cleared${it === r.next ? ' · you are here' : ''}</small>`
                : it === r.next ? '<small>You are here</small>' : ''}</button>
          ${!it.done && (it.task.obstacles || []).length && typeof blockerChecklist === 'function' ? blockerChecklist(it.task, true, 'board') : ''}
          ${window.TaskActions ? TaskActions.chip(it.task) : ''}</div>
        ${pacerHere ? `<span class="dayroad-pacerhere" title="Where the Pacer is now">${icon('timer')}</span>` : ''}
      </li>`;
    }).join('');
  }
  // The world scene: today's tasks in plan order, You by tasks done, the
  // Pacer by the clock. Each stop's blockers can be ticked in the list
  // under it (blockerChecklist, js/app/01-core.js); tickBlocker updates
  // these same task objects and calls render(), which syncs the scene.
  function syncScene(r) {
    const box = document.getElementById('dayroad-scene');
    if (!box || !r || typeof JourneyGame === 'undefined') return;
    JourneyGame.sync(box, {
      tasks: r.items.map(i => i.task),
      youFrac: r.n ? r.done / r.n : 0,
      summitLit: r.n > 0 && r.done === r.n,
      theme: theme(),
      ghost: r.state === 'before' ? null : { frac: r.n ? Math.min(1, r.pacer / r.n) : 0, label: 'The Pacer', isComputer: true },
      // On, so ticking a blocker off in the list below plays its knockout
      // (and the name popup) in the scene, as on a project's Journey.
      celebrationsEnabled: typeof celebrationsEnabled === 'function' ? celebrationsEnabled() : true,
      onSummit: () => {},
    });
  }
  function paintFull(el, r, update = false) {
    const mode = fullMode();
    // A minute's tick in Game: change the words and move the runners, but
    // keep the scene (rebuilding it would restart a 3D world every minute).
    if (update && mode === 'game' && r && document.getElementById('dayroad-scene')) {
      const sum = el.querySelector('.dayroad-sum'); if (sum) sum.innerHTML = summaryHTML(r);
      const list = el.querySelector('.dayroad-list'); if (list) list.innerHTML = listHTML(r);
      syncScene(r);
      return;
    }
    const scene = document.getElementById('dayroad-scene');
    if (scene && typeof JourneyGame !== 'undefined') JourneyGame.destroy(scene);
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const stage = world();
    const switcher = `<div class="dayroad-modes" role="group" aria-label="How to show today">
        <button type="button" aria-pressed="${mode === 'road'}" onclick="DayRoad.setMode('road')">${icon('list-checks', 'tiny')}Road</button>
        <button type="button" aria-pressed="${mode === 'game'}" onclick="DayRoad.setMode('game')">${icon('map', 'tiny')}Game</button>
      </div>`;
    const gameBody = r => `<div class="dayroad-gamebar">
        <label class="dayroad-world">${icon(CHAR[stage] || 'map', 'tiny')}<select onchange="DayRoad.setWorld(this.value)" aria-label="World">${STAGES.map(([k, n]) => `<option value="${k}" ${k === stage ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${can3d() ? `<div class="dayroad-dims" role="group" aria-label="2D or 3D"><button type="button" aria-pressed="${!view3d()}" onclick="DayRoad.setView('2d')">2D</button><button type="button" aria-pressed="${view3d()}" onclick="DayRoad.setView('3d')">3D</button></div>` : ''}
        <button type="button" class="dayroad-replay" id="dayroad-replay" onclick="DayRoad.replayDay()" title="Watch today again: every blocker cleared and task finished, in order">${replaying ? `${icon('pause', 'tiny')}Stop` : `${icon('play', 'tiny')}Replay my day`}</button>
        <span class="dayroad-legend"><i class="you">${icon(CHAR[stage] || 'footprints', 'tiny')}</i>You <i class="pacer">${icon('timer', 'tiny')}</i>The Pacer</span>
      </div>
      <div class="dayroad-scene-wrap world-${stage}"><div id="dayroad-scene" class="dayroad-scene" aria-label="Today's plan as a ${esc(stage)} world: ${r.done} of ${r.n} tasks done. ${esc(r.text)}" role="img"></div></div>`;
    el.innerHTML = `<div class="dayroad-sheet ${mode === 'game' ? 'is-game' : ''} ${game() ? `world-${stage}` : 'plain'}" role="dialog" aria-modal="true" aria-labelledby="dayroad-title">
      <div class="dayroad-head"><div><p class="dayroad-kicker">${esc(date)}</p><h3 id="dayroad-title">Today's road</h3></div>
        <div class="dayroad-headr">${r ? switcher : ''}<button type="button" class="dayroad-x" onclick="DayRoad.closeFull()" aria-label="Close">${icon('close')}</button></div></div>
      ${r ? `${mode === 'game' ? gameBody(r) : strip(r, true)}
      <p class="dayroad-sum">${summaryHTML(r)}</p>
      <ol class="dayroad-list">${listHTML(r)}</ol>
      <div class="dayroad-foot"><p class="dayroad-note">${icon('timer', 'tiny')} The Pacer keeps to the times you planned. Finish tasks to stay on plan or get ahead.</p>
        <button type="button" class="dayroad-reportbtn" onclick="DayRoad.closeFull(); DayReport.open()">${icon('chart-column', 'tiny')}${dayOver(r) ? 'How today went' : 'Today so far'}</button></div>`
    : `<p class="dayroad-empty">No plan for today yet.</p><button type="button" class="dayroad-go" onclick="DayRoad.closeFull(); Jarvis.startDay()">${icon('play')}Start my day</button>`}
    </div>`;
    if (r && mode === 'game') syncScene(r);
  }
  const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  function closeFull() {
    if (replaying) { replaying.stopped = true; replaying = null; }
    modeOverride = null;
    const scene = document.getElementById('dayroad-scene');
    if (scene && typeof JourneyGame !== 'undefined') JourneyGame.destroy(scene);
    document.getElementById('dayroad-full')?.remove();
  }

  // Tick a stop off right here. Blockers still in the way open the "not
  // yet" card (js/app/01-core.js) to clear them first; a done one unticks
  // back to Doing. The road, the scene and the other views follow.
  async function toggleDone(taskId) {
    const r = state();
    const it = r && r.items.find(i => i.taskId === taskId);
    if (!it || replaying) return;
    const title = it.task.title;
    if (it.done) {
      try { await API.updateTask(taskId, { status: 'In Progress' }); } catch (e) { taskErrorToast(e, 'Could not reopen it', { taskId, status: 'In Progress' }); return; }
      showToast(`↩️ “${title}” reopened`);
      refreshAfterStart(taskId, 'In Progress');
      return;
    }
    const t = await API.getTask(taskId).catch(() => it.task);
    if (taskGateMessage(t, 'Completed')) { showGateCard(t, 'Completed'); return; }
    try {
      const saved = await API.updateTask(taskId, { status: 'Completed' });
      if (saved && saved.journeyReward && typeof announceJourneyReward === 'function') announceJourneyReward(saved.journeyReward);
      else if (window.Sfx) Sfx.play('complete');
    } catch (e) { taskErrorToast(e, 'Could not finish it', { taskId, status: 'Completed' }); return; }
    showToast(`✅ “${title}” done`);
    refreshAfterStart(taskId, 'Completed');
  }

  // ── Watching it happen ──
  // Three replays in the Game view, all the same way: the scene opens
  // with the day as it was before, waits until it's drawn (a 3D world
  // needs its character loaded), then plays the changes one at a time,
  // each with a caption, so the character deals with them in front of you.
  //   · a blocker ticked somewhere else: its knockout (the Watch button)
  //   · a task finished somewhere else: the walk to its stop (Watch)
  //   · Replay my day: every blocker cleared and task finished today, in
  //     the order they happened, from the start to where you are now.
  const watchingGame = () => !!document.getElementById('dayroad-full') && fullMode() === 'game';
  const inPlan = taskId => { const r = state(); return !!r && r.items.some(i => i.taskId === taskId); };
  function canReplay(taskId) {
    const r = state();
    return game() && !watchingGame() && !!r && r.items.some(i => i.taskId === taskId && !i.done);
  }
  const canWatchFinish = taskId => game() && !watchingGame() && inPlan(taskId);
  const sceneReady = box => {
    const j = box && box._j3d;
    if (!j) return !!(box && box.querySelector('svg'));
    return !j._debug || !!(j._debug.state && j._debug.state.ready);
  };
  const wait = ms => new Promise(res => setTimeout(res, ms));
  let replaying = null; // { stopped }
  function caption(text) {
    const wrap = document.querySelector('#dayroad-full .dayroad-scene-wrap');
    if (!wrap) return;
    let c = wrap.querySelector('.dayroad-caption');
    if (!text) { if (c) c.remove(); return; }
    if (!c) { c = document.createElement('p'); c.className = 'dayroad-caption'; c.setAttribute('role', 'status'); wrap.appendChild(c); }
    c.textContent = text;
  }
  function paintReplayButton() {
    const b = document.getElementById('dayroad-replay');
    if (b) b.innerHTML = replaying ? `${icon('pause', 'tiny')}Stop` : `${icon('play', 'tiny')}Replay my day`;
  }
  // prepare() sets the day back to how it was and returns the steps to
  // play, [{ text, apply }], or null to call it off.
  async function play(prepare) {
    stopReplay();
    await refresh();
    const run = { stopped: false };
    replaying = run;
    const steps = prepare();
    if (!steps) { replaying = null; return; }
    if (typeof closeTaskDetail === 'function') closeTaskDetail(); // Watch is often pressed from the task panel
    if (!watchingGame()) openFull('game'); else render();
    paintReplayButton();
    const box = document.getElementById('dayroad-scene');
    for (let waited = 0; waited < 30000 && !sceneReady(box); waited += 250) await wait(250);
    await wait(700); // let the opening settle first
    const gap = box && box._j3d ? 3400 : 1700; // a 3D character takes longer to get there
    for (const s of steps) {
      if (run.stopped || !document.getElementById('dayroad-scene')) break;
      s.apply();
      caption(s.text);
      render();
      await wait(gap);
    }
    if (replaying !== run) return;
    replaying = null;
    if (steps.length > 1 && !run.stopped) caption('That brings you up to now');
    paintReplayButton();
    setTimeout(() => { if (!replaying) caption(''); }, 2500);
    await refresh(); // back to the real day
  }
  function stopReplay() {
    if (!replaying) return;
    replaying.stopped = true;
    replaying = null;
    caption('');
    paintReplayButton();
    refresh();
  }
  const clock = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · `; };

  function replayKnockout(taskId, obstacleId) {
    return play(() => {
      const t = tasks.find(x => x.id === taskId);
      const o = t && (t.obstacles || []).find(x => x.id === obstacleId);
      if (!o) return [];
      o.resolved = false;
      return [{ text: `Cleared “${o.name}”`, apply: () => { o.resolved = true; } }];
    });
  }
  function replayFinish(taskId) {
    return play(() => {
      const t = tasks.find(x => x.id === taskId);
      if (!t) return [];
      t.status = 'In Progress';
      return [{ text: `Finished “${t.title}”`, apply: () => { t.status = 'Completed'; } }];
    });
  }
  // Every blocker cleared and every task finished today on the plan, in
  // order: blockers by when they were ticked, tasks by when they were
  // done (a blocker with no time goes just before its task's finish).
  function replayDay() {
    if (replaying) { stopReplay(); return; }
    return play(() => {
      const r = state();
      if (!r) return null;
      const today = localDateKey(new Date());
      const events = [];
      r.items.forEach((it, k) => {
        const t = it.task;
        const doneAt = t.status === 'Completed' && t.completedAt ? Date.parse(t.completedAt) : null;
        (t.obstacles || []).filter(o => o.resolved).forEach(o => {
          const at = o.resolvedAt ? Date.parse(o.resolvedAt) : (doneAt != null ? doneAt - 1 : Infinity);
          events.push({ at, k, kind: 'blocker', t, o });
        });
        if (t.status === 'Completed') events.push({ at: doneAt != null ? doneAt : Infinity, k, kind: 'done', t });
      });
      if (!events.length) { if (typeof showToast === 'function') showToast("Nothing cleared or finished yet today. Replay once you've made a start."); return null; }
      events.sort((a, b) => a.at - b.at || a.k - b.k || (a.kind === 'blocker' ? -1 : 1));
      // Back to the start of the day.
      r.items.forEach(it => { it.task.status = 'Not Started'; (it.task.obstacles || []).forEach(o => { if (o.resolved) o.resolved = false; }); });
      const when = e => (e.at !== Infinity && localDateKey(new Date(e.at)) === today ? clock(new Date(e.at).toISOString()) : '');
      return events.map(e => ({
        text: e.kind === 'blocker' ? `${when(e)}Cleared “${e.o.name}”` : `${when(e)}Finished “${e.t.title}”`,
        apply: () => { if (e.kind === 'blocker') e.o.resolved = true; else e.t.status = 'Completed'; },
      }));
    });
  }

  // The Pacer moves every minute; tasks are re-read every few.
  setInterval(() => {
    if (replaying) return; // a replay owns the scene until it's done
    if (!document.querySelector('[data-dayroad]:not(:empty), #dayroad-full')) return;
    if (Date.now() - loadedAt > 4 * 60000) refresh(); else render();
  }, 60000);

  return { refresh, render, state, openFull, closeFull, setMode, setWorld, setView, canReplay, canWatchFinish, replayKnockout, replayFinish, replayDay, toggleDone };
})();
window.DayRoad = DayRoad;
