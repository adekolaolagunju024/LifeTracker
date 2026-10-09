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
    wide: { w: 800, h: 480, points: [{ x: 60, y: 420 }, { x: 320, y: 360 }, { x: 140, y: 240 }, { x: 420, y: 180 }, { x: 260, y: 90 }, { x: 560, y: 60 }] },
    tall: { w: 420, h: 760, points: [{ x: 70, y: 700 }, { x: 330, y: 600 }, { x: 90, y: 480 }, { x: 340, y: 380 }, { x: 100, y: 260 }, { x: 320, y: 160 }, { x: 180, y: 60 }] },
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

  // A regular n-pointed star path, centered at the origin — used for the
  // goal badge and its small sparkle accents.
  function starPath(outerR, innerR, points) {
    const step = Math.PI / points;
    let d = '';
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = i * step - Math.PI / 2;
      d += `${i === 0 ? 'M' : 'L'}${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)} `;
    }
    return d + 'Z';
  }

  let uid = 0; // per-build suffix so each SVG's <defs> ids never collide with a previous one

  function el(tag, attrs, children) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(k => { if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]); });
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

  // A cheerful, rounded "game mascot" figure — big head, simple face, a
  // soft ground shadow, built from plain shapes so it stays crisp at any
  // scale. The outline strokes + bright flat fills are what read as
  // "game art" rather than a technical diagram; the inner .journey-avatar-bob
  // group is what CSS's idle-bob animation (see index.html) moves, kept
  // separate from the ground shadow so the shadow stays planted.
  function buildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 0, cy: 24, rx: 12, ry: 3.2, fill: '#1f2937', opacity: 0.22 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    // Legs
    bob.appendChild(el('rect', { x: -6.6, y: 8, width: 5, height: 11, rx: 2.4, fill: '#3b4758', stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('rect', { x: 1.6, y: 8, width: 5, height: 11, rx: 2.4, fill: '#2f3947', stroke: '#1f2937', 'stroke-width': 1 }));
    // Arms (simple stub ellipses, tucked beside the body)
    bob.appendChild(el('ellipse', { cx: -9.5, cy: 1, rx: 3.4, ry: 5.4, fill, stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(18 -9.5 1)' }));
    bob.appendChild(el('ellipse', { cx: 9.5, cy: 1, rx: 3.4, ry: 5.4, fill, stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(-18 9.5 1)' }));
    // Body
    bob.appendChild(el('rect', { x: -9, y: -7, width: 18, height: 18, rx: 7, fill, stroke: '#1f2937', 'stroke-width': 1.2 }));
    // Head
    bob.appendChild(el('circle', { cx: 0, cy: -15.5, r: 8.4, fill: '#ffd9ae', stroke: '#1f2937', 'stroke-width': 1.2 }));
    // Hair
    bob.appendChild(el('path', { d: 'M -8.4 -17.5 A 8.4 8.4 0 0 1 8.4 -17.5 L 8.2 -20 A 9 6 0 0 0 -8.2 -20 Z', fill: '#4a2f1e', stroke: '#1f2937', 'stroke-width': 1 }));
    // Face — two round eyes and a smile, the cheapest way to make a
    // shape read as "friendly character" instead of "icon"
    bob.appendChild(el('circle', { cx: -3, cy: -15, r: 1.15, fill: '#1f2937' }));
    bob.appendChild(el('circle', { cx: 3, cy: -15, r: 1.15, fill: '#1f2937' }));
    bob.appendChild(el('path', { d: 'M -3.6 -11.8 Q 0 -9.4 3.6 -11.8', fill: 'none', stroke: '#1f2937', 'stroke-width': 1.1, 'stroke-linecap': 'round' }));
    bob.appendChild(el('ellipse', { cx: -5.6, cy: -12.4, rx: 1.6, ry: 1, fill: '#ff9d8a', opacity: 0.55 }));
    bob.appendChild(el('ellipse', { cx: 5.6, cy: -12.4, rx: 1.6, ry: 1, fill: '#ff9d8a', opacity: 0.55 }));
    g.appendChild(bob);
    return g;
  }

  // The goal marker — a shiny gold star badge (reads as "reward" to a kid
  // far more than a bullseye does), with a soft glow behind it and a
  // couple of small sparkle accents for polish.
  function buildTarget(x, y, starGradId, shadowFilterId) {
    const g = el('g', { transform: `translate(${x},${y})` });
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 27, fill: '#ffd54a', opacity: 0.28 }));
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 18.5, fill: '#ffffff', stroke: '#f3b429', 'stroke-width': 2.4 }));
    const star = el('path', {
      d: starPath(14, 6, 5), fill: `url(#${starGradId})`, stroke: '#b8780f', 'stroke-width': 1.3, 'stroke-linejoin': 'round',
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    });
    g.appendChild(star);
    [[-20, -16, 2.6], [21, -10, 1.8], [16, 16, 2.1]].forEach(([sx, sy, r]) => {
      g.appendChild(el('path', { d: starPath(r, r * 0.35, 4), transform: `translate(${sx},${sy})`, fill: '#ffffff', opacity: 0.85 }));
    });
    return g;
  }

  // A checkpoint flag — a warm wooden post + a rounded pennant, matching
  // the road's own toy-like palette. Done checkpoints get a bold check;
  // the current ("next") one gets a soft pulsing glow (see index.html's
  // .journey-next-glow) so a kid can see at a glance where to go next.
  function buildFlag(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 6 * s, cy: -20 * s, r: 15 * s, fill: NEXT_COLOR, opacity: 0.5 }));
    g.appendChild(el('rect', { x: -1.1 * s, y: -27 * s, width: 2.2 * s, height: 27 * s, fill: '#8b5e3c', stroke: '#5c3c22', 'stroke-width': 0.6 * s, rx: 0.8 * s }));
    g.appendChild(el('path', {
      d: `M ${1.1 * s} ${-27 * s} Q ${14 * s} ${-23.6 * s} ${13.5 * s} ${-20.4 * s} Q ${13 * s} ${-17.2 * s} ${1.1 * s} ${-15.4 * s} Z`,
      fill: color, stroke: '#1f2937', 'stroke-width': 0.7 * s, 'stroke-linejoin': 'round',
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    }));
    const label = el('text', {
      x: 6.4 * s, y: -20.6 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 7.6 * s, 'font-weight': 800, fill: isDone || isNext ? '#1f2937' : '#4b5563', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    g.appendChild(label);
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 2.6 * s, fill: '#f4a53b', stroke: '#8b5e3c', 'stroke-width': 0.6 * s }));
    if (blocked) {
      const badge = el('text', { x: 13 * s, y: -29 * s, 'font-size': 8 * s, 'text-anchor': 'middle' });
      badge.textContent = '🚧';
      g.appendChild(badge);
    }
    return g;
  }

  let containers = new WeakMap(); // container -> { svg, ro, state, paused }

  function build(container) {
    container.innerHTML = '';
    const layout = pickLayout(container);
    const id = ++uid; // scopes this build's <defs> ids so an older SVG's leftovers (if any) never bleed in
    const skyId = `journey-sky-${id}`, shadowId = `journey-shadow-${id}`, starId = `journey-star-${id}`;
    const svg = el('svg', { viewBox: `0 0 ${layout.w} ${layout.h}`, preserveAspectRatio: 'xMidYMid meet', width: '100%', height: '100%', style: 'display:block', role: 'img' });

    // An SVG <title> is the standard accessible name for role="img" — a
    // screen reader announces it instead of silently skipping a picture.
    // Kept up to date every sync() with the real numbers (see apply()).
    const title = el('title', {});
    svg.appendChild(title);

    // ── DEFS — a soft sky-to-sun-glow gradient for the backdrop, a warm
    // gold gradient for the goal star, and one drop-shadow filter reused
    // by the avatar/flags/star so every piece of "game art" sits above
    // the board with the same light, rather than looking pasted flat.
    const defs = el('defs', {}, [
      (() => {
        const grad = el('linearGradient', { id: skyId, x1: 0, y1: 0, x2: 0, y2: 1 });
        [[0, '#8fd3fb'], [55, '#c7e9fd'], [100, '#fff3da']].forEach(([off, color]) => grad.appendChild(el('stop', { offset: `${off}%`, 'stop-color': color })));
        return grad;
      })(),
      (() => {
        const grad = el('radialGradient', { id: starId, cx: '35%', cy: '30%', r: '75%' });
        [[0, '#fff2b8'], [55, '#ffcf3f'], [100, '#f5a623']].forEach(([off, color]) => grad.appendChild(el('stop', { offset: `${off}%`, 'stop-color': color })));
        return grad;
      })(),
      (() => {
        const filter = el('filter', { id: shadowId, x: '-60%', y: '-60%', width: '220%', height: '220%' });
        filter.appendChild(el('feDropShadow', { dx: 0, dy: 1.6, stdDeviation: 1.4, 'flood-color': '#1f2937', 'flood-opacity': 0.3 }));
        return filter;
      })(),
    ]);
    svg.appendChild(defs);

    // Backdrop — gradient sky, a friendly sun, and a couple of soft
    // clouds. Deliberately just these few touches (see this view's long
    // history of "too busy/cluttered" feedback) — enough to feel like a
    // game world, not a scene to compete with the road itself.
    svg.appendChild(el('rect', { x: 0, y: 0, width: layout.w, height: layout.h, fill: `url(#${skyId})` }));
    const sunCx = layout.w * 0.86, sunCy = layout.h * 0.12;
    svg.appendChild(el('circle', { cx: sunCx, cy: sunCy, r: layout.w * 0.09, fill: '#ffffff', opacity: 0.4 }));
    svg.appendChild(el('circle', { cx: sunCx, cy: sunCy, r: layout.w * 0.05, fill: '#ffd24a' }));
    [[0.12, 0.1, 1], [0.28, 0.07, 0.75]].forEach(([fx, fy, scale]) => {
      const cg = el('g', { transform: `translate(${layout.w * fx},${layout.h * fy}) scale(${scale})`, opacity: 0.8 });
      [[-14, 0, 11], [0, -4, 14], [15, 0, 10], [0, 5, 13]].forEach(([ex, ey, r]) => cg.appendChild(el('ellipse', { cx: ex, cy: ey, rx: r, ry: r * 0.7, fill: '#ffffff' })));
      svg.appendChild(cg);
    });

    // The road itself — a warm wooden-brown outline, a cream fill on top,
    // and a dashed orange centerline, round caps/joins throughout so the
    // winding turns look like a real toy path rather than sharp angles.
    const d = pathD(layout.points);
    const roadOutline = el('path', { d, fill: 'none', stroke: '#d8a862', 'stroke-width': 40, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const roadBase = el('path', { d, fill: 'none', stroke: '#fff6e4', 'stroke-width': 32, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const roadLine = el('path', { d, fill: 'none', stroke: '#f4a53b', 'stroke-width': 3.2, 'stroke-dasharray': '11 11', 'stroke-linecap': 'round' });
    svg.appendChild(roadOutline);
    svg.appendChild(roadBase);
    svg.appendChild(roadLine);

    const flagsLayer = el('g', { class: 'journey-flags' });
    const ghostLayer = el('g', { class: 'journey-ghost' });
    const avatarLayer = el('g', { class: 'journey-avatar-layer' });
    svg.appendChild(flagsLayer);
    svg.appendChild(ghostLayer);

    const targetLen = roadBase.getTotalLength();
    const targetPt = roadBase.getPointAtLength(targetLen);
    svg.appendChild(buildTarget(targetPt.x, targetPt.y, starId, shadowId));
    svg.appendChild(avatarLayer);

    container.appendChild(svg);

    const entry = {
      svg, title, roadBase, layoutKey: layout === LAYOUTS.tall ? 'tall' : 'wide', flagsLayer, ghostLayer, avatarLayer,
      shadowId, lastState: null, lastDoneIds: new Set(), lastYouFrac: null, lastSummit: false,
    };
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
    const { svg, title, roadBase, flagsLayer, ghostLayer, avatarLayer, shadowId } = entry;

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
    // Inset slightly from both ends — a flag placed at exactly frac 0 or 1
    // lands right under the avatar's starting pose or the goal star and
    // mostly disappears behind it, which reads as a mistake rather than
    // deliberate layering.
    state.tasks.forEach((t, i) => {
      const frac = n > 1 ? 0.06 + (i / (n - 1)) * 0.88 : 0.5;
      const pt = pointAtFrac(roadBase, frac);
      positions.push(pt);
      const isDone = t.status === 'Completed';
      const isNext = !isDone && i === doneCount;
      const g = buildFlag(i, isDone, isNext, t.latestUpdateIsBlocker, scale, shadowId);
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
    if (!avatarLayer.firstChild) avatarLayer.appendChild(buildAvatar('#ff6b5b', shadowId));
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
