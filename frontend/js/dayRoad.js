/* global API, DayPace, icon, esc, localDateKey, focusModeOn, getJourneyStage, getJourneyTheme, getJourneyView, setJourneyTheme, setJourneyView, journeyCanDo3D, JourneyGame, openTaskDetail, Jarvis */
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
    const stops = r.items.map((it, k) => `<span class="droad-stop ${it.done ? 'done' : ''} ${blockersOf(it.task) && !it.done ? 'blk' : ''}" style="left:${pct(k + 1, r.n)}%" title="${esc(`${it.start} ${it.task.title}`)}">${big ? `<em>${esc(it.start)}</em>` : ''}</span>`).join('');
    const gx = pct(r.pacer, r.n); const yx = pct(r.done, r.n);
    return `<div class="droad-track ${g ? `world-${world()}` : 'plain'} ${big ? 'big' : ''}" role="img" aria-label="${esc(`${r.done} of ${r.n} tasks done. ${r.text}`)}">
      <i class="droad-fill" style="width:${yx}%"></i>${stops}
      <span class="droad-pacer" style="left:${gx}%" title="The Pacer: where your timetable says you'd be now">${icon('timer')}</span>
      <span class="droad-you" style="left:${yx}%" title="You">${you}</span>
    </div>`;
  }
  function line(r, mode) {
    const nx = r.next ? `Next: ${esc(r.next.start)} ${esc(r.next.task.title)}` : '';
    return `<div class="droad-line"><b class="droad-state ${r.state}">${esc(r.text)}</b>
      <span>${r.done} of ${r.n} done${nx && mode !== 'card' ? ` · ${nx}` : ''}</span>
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
  const fullMode = () => { try { return localStorage.getItem(MODE_KEY) || (game() ? 'game' : 'road'); } catch { return 'road'; } };
  const STAGES = [['football', 'Football'], ['space', 'Space'], ['castle', 'Castle'], ['construction', 'Construction']];
  function openFull() {
    API.trackFeature && API.trackFeature('journey');
    closeFull();
    const el = document.createElement('div');
    el.id = 'dayroad-full';
    el.className = 'dayroad-overlay';
    el.addEventListener('click', e => { if (e.target === el) closeFull(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') closeFull(); });
    document.body.appendChild(el);
    paintFull(el, state());
    el.querySelector('.dayroad-x')?.focus();
  }
  function setMode(m) {
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
    return `<b class="droad-state ${r.state}">${esc(r.text)}</b> · ${r.done} of ${r.n} done · plan ends at ${fmt(r.planEnd)}`;
  }
  function listHTML(r) {
    return r.items.map((it, k) => {
      const b = blockersOf(it.task);
      const pacerHere = !it.done && Math.floor(r.pacer) === k && r.state !== 'before';
      return `<li class="${it.done ? 'done' : it === r.next ? 'next' : ''}">
        <span class="dayroad-time">${esc(it.start)}<small>${esc(DayPace.minutesText(it.minutes))}</small></span>
        <span class="dayroad-dot">${it.done ? icon('check') : it === r.next ? icon(game() ? (CHAR[world()] || 'footprints') : 'play') : ''}</span>
        <button type="button" class="dayroad-task" onclick="openTaskDetail('${it.taskId}')"><b>${esc(it.task.title)}</b>
          ${b && !it.done ? `<small class="blk">${icon('blocker', 'tiny')}${b} ${b === 1 ? 'blocker' : 'blockers'} in the way</small>` : it.done ? '<small>Done</small>' : it === r.next ? '<small>You are here</small>' : ''}</button>
        ${pacerHere ? `<span class="dayroad-pacerhere" title="Where the Pacer is now">${icon('timer')}</span>` : ''}
      </li>`;
    }).join('');
  }
  // The world scene: today's tasks in plan order, You by tasks done, the
  // Pacer by the clock.
  function syncScene(r) {
    const box = document.getElementById('dayroad-scene');
    if (!box || !r || typeof JourneyGame === 'undefined') return;
    JourneyGame.sync(box, {
      tasks: r.items.map(i => i.task),
      youFrac: r.n ? r.done / r.n : 0,
      summitLit: r.n > 0 && r.done === r.n,
      theme: theme(),
      ghost: r.state === 'before' ? null : { frac: r.n ? Math.min(1, r.pacer / r.n) : 0, label: 'The Pacer', isComputer: true },
      celebrationsEnabled: false,
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
        <span class="dayroad-legend"><i class="you">${icon(CHAR[stage] || 'footprints', 'tiny')}</i>You <i class="pacer">${icon('timer', 'tiny')}</i>The Pacer</span>
      </div>
      <div class="dayroad-scene-wrap world-${stage}"><div id="dayroad-scene" class="dayroad-scene" aria-label="Today's plan as a ${esc(stage)} world: ${r.done} of ${r.n} tasks done. ${esc(r.text)}" role="img"></div></div>`;
    el.innerHTML = `<div class="dayroad-sheet ${mode === 'game' ? 'is-game' : ''} ${game() ? `world-${stage}` : 'plain'}" role="dialog" aria-modal="true" aria-labelledby="dayroad-title">
      <div class="dayroad-head"><div><p class="dayroad-kicker">${esc(date)}</p><h3 id="dayroad-title">Today's road</h3></div>
        <div class="dayroad-headr">${r ? switcher : ''}<button type="button" class="dayroad-x" onclick="DayRoad.closeFull()" aria-label="Close">${icon('close')}</button></div></div>
      ${r ? `${mode === 'game' ? gameBody(r) : strip(r, true)}
      <p class="dayroad-sum">${summaryHTML(r)}</p>
      <ol class="dayroad-list">${listHTML(r)}</ol>
      <p class="dayroad-note">${icon('timer', 'tiny')} The Pacer keeps to the times you planned. Finish tasks to stay on plan or get ahead.</p>`
    : `<p class="dayroad-empty">No plan for today yet.</p><button type="button" class="dayroad-go" onclick="DayRoad.closeFull(); Jarvis.startDay()">${icon('play')}Start my day</button>`}
    </div>`;
    if (r && mode === 'game') syncScene(r);
  }
  const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  function closeFull() {
    const scene = document.getElementById('dayroad-scene');
    if (scene && typeof JourneyGame !== 'undefined') JourneyGame.destroy(scene);
    document.getElementById('dayroad-full')?.remove();
  }

  // The Pacer moves every minute; tasks are re-read every few.
  setInterval(() => {
    if (!document.querySelector('[data-dayroad]:not(:empty), #dayroad-full')) return;
    if (Date.now() - loadedAt > 4 * 60000) refresh(); else render();
  }, 60000);

  return { refresh, render, state, openFull, closeFull, setMode, setWorld, setView };
})();
window.DayRoad = DayRoad;
