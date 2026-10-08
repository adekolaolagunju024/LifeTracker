// ── JOURNEY GAME (responsive SVG) ─────────────────────────────────
// "Road to the Goal": an avatar walks a winding road from the start to a
// bullseye target, one flag per completed task. Rendered as a single
// SVG with a fixed viewBox and preserveAspectRatio="xMidYMid meet" —
// every element (road, flags, avatar, target) is sized in viewBox units,
// so they all scale together and keep their proportions at any screen
// size, from a small phone to a large desktop monitor. No game engine,
// no CDN load: plain SVG + DOM, built and updated directly.
//
// Two road layouts — a wide one for landscape/tablet/desktop and a
// taller one for narrow/portrait phones — so the winding path always
// uses the screen's actual shape instead of shrinking into a thin
// strip. A ResizeObserver picks the layout and recalculates every
// flag/avatar position from the road path's real length whenever the
// container resizes, the same way the spec for this asks for it.
//
// app.js owns state (tasks, competitor, project) and calls
// JourneyGame.sync(container, state) whenever it changes; this module
// owns only building/updating the SVG and any animation.
const JourneyGame = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DONE_COLOR = '#10b981', NEXT_COLOR = '#fbbf24', PENDING_COLOR = '#cbd5e1';

  // ── THE TWO ROAD LAYOUTS — a short, wide viewBox for landscape/tablet/
  // desktop, and a tall, narrow one for portrait phones. Each is just a
  // handful of waypoints from the start to the target; the actual road
  // shape (and every flag's exact position) comes from the real SVG path
  // length at render time, not from these points directly.
  const LAYOUTS = {
    wide: { viewBox: '0 0 800 480', points: [{ x: 60, y: 420 }, { x: 320, y: 360 }, { x: 140, y: 240 }, { x: 420, y: 180 }, { x: 260, y: 90 }, { x: 560, y: 60 }] },
    tall: { viewBox: '0 0 420 760', points: [{ x: 70, y: 700 }, { x: 330, y: 600 }, { x: 90, y: 480 }, { x: 340, y: 380 }, { x: 100, y: 260 }, { x: 320, y: 160 }, { x: 180, y: 60 }] },
  };
  function pickLayout(container) {
    const w = container.clientWidth || 300, h = container.clientHeight || 300;
    return (w < 560 || h > w) ? LAYOUTS.tall : LAYOUTS.wide;
  }
  function pathD(points) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  }

  const PHASES = [
    { at: 0.14, label: 'First steps' },
    { at: 0.32, label: 'Finding your stride' },
    { at: 0.52, label: 'Halfway there' },
    { at: 0.72, label: 'Closing in' },
    { at: 0.90, label: 'Almost at the target' },
  ];

  function el(tag, attrs, children) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
    (children || []).forEach(c => e.appendChild(c));
    return e;
  }

  // Converts a point in the SVG's own viewBox coordinate space to real
  // page pixel coordinates — accounts for the viewBox scaling and
  // preserveAspectRatio automatically, so the app-wide confetti/balloon
  // canvases (which work in page pixels) land exactly on the checkpoint
  // regardless of how large or small the SVG is actually rendered.
  function screenPoint(svg, x, y) {
    const pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    const screenPt = pt.matrixTransform(svg.getScreenCTM());
    return { x: screenPt.x, y: screenPt.y };
  }

  // A simple flat walking figure — a circle head, a rounded body, two
  // legs — sized and colored in viewBox units so it scales with
  // everything else instead of needing its own fixed-pixel logic.
  function buildAvatar(fill) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 0, cy: 23, rx: 11, ry: 3, fill: '#000', opacity: 0.18 }));
    g.appendChild(el('rect', { x: -3.4, y: 10, width: 3.2, height: 13, rx: 1.4, fill: '#1f2937' }));
    g.appendChild(el('rect', { x: 0.2, y: 10, width: 3.2, height: 13, rx: 1.4, fill: '#111827' }));
    g.appendChild(el('rect', { x: -8, y: -6, width: 16, height: 17, rx: 5, fill }));
    g.appendChild(el('circle', { cx: 0, cy: -14, r: 6.4, fill: '#f6c89a' }));
    g.appendChild(el('path', { d: 'M -6.4 -16.5 A 6.4 6.4 0 0 1 6.4 -16.5 L 6.4 -18 A 7 5 0 0 0 -6.4 -18 Z', fill: '#4a2f1e' }));
    return g;
  }

  // The bullseye target marking the goal.
  function buildTarget(x, y) {
    const g = el('g', { transform: `translate(${x},${y})` });
    [[15, '#ef4444'], [10.5, '#ffffff'], [6.5, '#ef4444'], [2.6, '#ffffff']].forEach(([r, fill]) => {
      g.appendChild(el('circle', { cx: 0, cy: 0, r, fill, stroke: '#1f2937', 'stroke-width': 0.8 }));
    });
    return g;
  }

  // A checkpoint flag — the pole + pennant read as "flag" (matching the
  // reference image's own road markers); the pennant's fill carries the
  // done/next/pending color, with the task number inside it.
  function buildFlag(i, isDone, isNext, blocked, scale) {
    const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    g.appendChild(el('rect', { x: -0.9 * s, y: -26 * s, width: 1.8 * s, height: 26 * s, fill: '#6b7280', rx: 0.6 * s }));
    g.appendChild(el('path', {
      d: `M ${0.9 * s} ${-26 * s} L ${13 * s} ${-21 * s} L ${0.9 * s} ${-16 * s} Z`,
      fill: color, stroke: '#1f2937', 'stroke-width': 0.6 * s, 'stroke-linejoin': 'round',
    }));
    const label = el('text', {
      x: 5 * s, y: -20.6 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 7.4 * s, 'font-weight': 700, fill: isDone || isNext ? '#1f2937' : '#4b5563', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    g.appendChild(label);
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 2.4 * s, fill: '#6b7280' }));
    if (blocked) {
      const badge = el('text', { x: 13 * s, y: -28 * s, 'font-size': 8 * s, 'text-anchor': 'middle' });
      badge.textContent = '🚧';
      g.appendChild(badge);
    }
    return g;
  }

  let containers = new WeakMap(); // container -> { svg, ro, state, paused }

  function build(container) {
    container.innerHTML = '';
    const layout = pickLayout(container);
    const svg = el('svg', { viewBox: layout.viewBox, preserveAspectRatio: 'xMidYMid meet', width: '100%', height: '100%', style: 'display:block', role: 'img' });

    // An SVG <title> is the standard accessible name for role="img" — a
    // screen reader announces it instead of silently skipping a picture.
    // Kept up to date every sync() with the real numbers (see apply()).
    const title = el('title', {});
    svg.appendChild(title);

    // Background.
    svg.appendChild(el('rect', { x: 0, y: 0, width: 9999, height: 9999, fill: '#4a7fc4' }));

    // The road itself — a wide light base stroke, a dashed centerline on
    // top, round caps/joins so the winding turns look like a real road
    // rather than sharp angles.
    const d = pathD(layout.points);
    const roadBase = el('path', { d, fill: 'none', stroke: '#e8eef5', 'stroke-width': 34, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const roadLine = el('path', { d, fill: 'none', stroke: '#c7d2e0', 'stroke-width': 3, 'stroke-dasharray': '12 12', 'stroke-linecap': 'round' });
    svg.appendChild(roadBase);
    svg.appendChild(roadLine);

    const flagsLayer = el('g', { class: 'journey-flags' });
    const ghostLayer = el('g', { class: 'journey-ghost' });
    const avatarLayer = el('g', { class: 'journey-avatar-layer' });
    svg.appendChild(flagsLayer);
    svg.appendChild(ghostLayer);

    const targetLen = roadBase.getTotalLength();
    const targetPt = roadBase.getPointAtLength(targetLen);
    svg.appendChild(buildTarget(targetPt.x, targetPt.y));
    svg.appendChild(avatarLayer);

    container.appendChild(svg);

    const entry = { svg, title, roadBase, layoutKey: layout === LAYOUTS.tall ? 'tall' : 'wide', flagsLayer, ghostLayer, avatarLayer, lastState: null, lastDoneIds: new Set(), lastYouFrac: null, lastSummit: false };
    containers.set(container, entry);
    return entry;
  }

  function pointAtFrac(roadBase, frac) {
    const len = roadBase.getTotalLength();
    return roadBase.getPointAtLength(Math.max(0, Math.min(1, frac)) * len);
  }

  // No lower floor: a fixed minimum size is what caused flags to overlap
  // on large task lists (tested up to 150 tasks without a floor — see
  // the spacing simulation). Letting the scale keep shrinking with n
  // keeps every flag's footprint in step with how much of the road is
  // actually left for it.
  function checkpointScale(n) { return Math.min(1, 10 / Math.max(1, n)); }

  function apply(container, state) {
    let entry = containers.get(container);
    const desiredLayout = pickLayout(container) === LAYOUTS.tall ? 'tall' : 'wide';
    if (!entry || entry.layoutKey !== desiredLayout) entry = build(container);
    const { svg, title, roadBase, flagsLayer, ghostLayer, avatarLayer } = entry;

    const totalN = state.tasks.length;
    const doneN = state.tasks.filter(t => t.status === 'Completed').length;
    const pct = totalN ? Math.round((doneN / totalN) * 100) : 0;
    let phaseLabel = 'At the starting line';
    PHASES.forEach(p => { if (totalN && doneN / totalN > p.at) phaseLabel = p.label; });
    if (totalN && doneN === totalN) phaseLabel = 'Reached the target';
    title.textContent = totalN
      ? `Journey progress: ${pct} percent. ${doneN} of ${totalN} tasks completed. Current milestone: ${phaseLabel}.`
      : 'Journey not started — no tasks yet.';

    // Flags — one per task, placed at the real path length fraction so
    // they're evenly spaced along the actual curve, not the straight-line
    // waypoints.
    while (flagsLayer.firstChild) flagsLayer.removeChild(flagsLayer.firstChild);
    const n = state.tasks.length;
    const scale = checkpointScale(n);
    const doneCount = state.tasks.filter(t => t.status === 'Completed').length;
    const positions = [];
    state.tasks.forEach((t, i) => {
      const frac = n > 1 ? i / (n - 1) : 1;
      const pt = pointAtFrac(roadBase, frac);
      positions.push(pt);
      const isDone = t.status === 'Completed';
      const isNext = !isDone && i === doneCount;
      const g = buildFlag(i, isDone, isNext, t.latestUpdateIsBlocker, scale);
      g.setAttribute('transform', `translate(${pt.x},${pt.y})`);
      flagsLayer.appendChild(g);
    });

    // Celebrate any checkpoint newly done since the last sync, unless
    // Celebration Effects is off.
    const celebrate = state.celebrationsEnabled !== false;
    const nowDoneIds = new Set(state.tasks.filter(t => t.status === 'Completed').map(t => t.id));
    if (celebrate && window.fireScreenConfetti) {
      state.tasks.forEach((t, i) => {
        if (t.status === 'Completed' && !entry.lastDoneIds.has(t.id) && positions[i]) {
          const sp = screenPoint(svg, positions[i].x, positions[i].y);
          window.fireScreenConfetti(sp.x, sp.y, 24);
        }
      });
    }
    entry.lastDoneIds = nowDoneIds;

    // Ghost (pace/competitor marker) — a faded second avatar.
    while (ghostLayer.firstChild) ghostLayer.removeChild(ghostLayer.firstChild);
    if (state.ghost) {
      const gp = pointAtFrac(roadBase, state.ghost.frac);
      const g = buildAvatar('#94a3b8');
      g.setAttribute('transform', `translate(${gp.x},${gp.y}) scale(${scale})`);
      g.setAttribute('opacity', '0.55');
      ghostLayer.appendChild(g);
    }

    // Avatar — walks to its new spot; CSS handles the smooth glide (see
    // the .journey-avatar-layer transition in index.html's inline style
    // below), so no animation library is needed for this simple a move.
    if (!avatarLayer.firstChild) avatarLayer.appendChild(buildAvatar('#e25c3f'));
    const you = pointAtFrac(roadBase, state.youFrac);
    // Respect prefers-reduced-motion: the avatar still ends up in the
    // right place, it just snaps instead of gliding — progress stays
    // fully conveyed, the motion (the part some people asked their OS
    // to minimize) is what's removed.
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    avatarLayer.style.transition = (entry.lastYouFrac === null || reduceMotion) ? 'none' : 'transform 650ms ease-in-out';
    avatarLayer.setAttribute('transform', `translate(${you.x},${you.y}) scale(${scale})`);
    entry.lastYouFrac = state.youFrac;

    if (state.summitLit && !entry.lastSummit && celebrate) {
      const sp = screenPoint(svg, you.x, you.y - 10);
      if (window.fireScreenConfetti) { window.fireScreenConfetti(sp.x, sp.y, 70); window.fireScreenConfetti(sp.x - 60, sp.y, 50); window.fireScreenConfetti(sp.x + 60, sp.y, 50); }
      if (window.fireBalloons) window.fireBalloons(10);
    }
    entry.lastSummit = state.summitLit;

    entry.lastState = state;
  }

  function ensureResizeObserver(container) {
    if (container._journeyRO) return;
    const ro = new ResizeObserver(() => {
      const entry = containers.get(container);
      if (!entry || !entry.lastState) return;
      apply(container, entry.lastState);
    });
    ro.observe(container);
    container._journeyRO = ro;
  }

  return {
    buildPhaseLabel(frac) {
      if (frac >= 1) return 'Reached the target';
      let label = 'At the starting line';
      PHASES.forEach(p => { if (frac > p.at) label = p.label; });
      return label;
    },
    sync(container, state) {
      ensureResizeObserver(container);
      apply(container, state);
      return Promise.resolve();
    },
    pause() { /* CSS-driven, nothing to pause */ },
    resume() { /* CSS-driven, nothing to resume */ },
    destroy(container) {
      if (container) {
        if (container._journeyRO) { container._journeyRO.disconnect(); delete container._journeyRO; }
        containers.delete(container);
        container.innerHTML = '';
      }
    },
  };
})();
