// ── JOURNEY GAME (responsive SVG) ─────────────────────────────────
// An avatar walks a winding path from the start to a goal marker, one
// checkpoint per task. Rendered as a single SVG with a fixed viewBox and
// preserveAspectRatio="xMidYMid meet" — every element is sized in
// viewBox units, so they all scale together and keep their proportions
// at any screen size, from a small phone to a large desktop monitor.
// No game engine, no CDN load: plain SVG + DOM, built and updated
// directly.
//
// Four visual themes (Road/Space/Ocean/Race, see THEMES below) share
// one mechanic: the same two path layouts, the same real path-length
// positioning, the same resize handling, the same accessibility and
// reduced-motion behavior. Only the art each theme draws for the
// background, path, avatar, checkpoint, and goal differs — so picking
// a theme is purely cosmetic and never changes how progress works.
//
// Two road layouts — a wide one for landscape/tablet/desktop and a
// taller one for narrow/portrait phones — so the winding path always
// uses the screen's actual shape instead of shrinking into a thin
// strip. A ResizeObserver picks the layout and recalculates every
// checkpoint/avatar position from the path's real length whenever the
// container resizes.
//
// app.js owns state (tasks, competitor, project, theme) and calls
// JourneyGame.sync(container, state) whenever it changes; this module
// owns only building/updating the SVG and any animation.
const JourneyGame = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DONE_COLOR = '#10b981', NEXT_COLOR = '#fbbf24', PENDING_COLOR = '#cbd5e1';

  // ── THE TWO PATH LAYOUTS — a short, wide viewBox for landscape/tablet/
  // desktop, and a tall, narrow one for portrait phones. Each is just a
  // handful of waypoints from the start to the goal; the actual path
  // shape (and every checkpoint's exact position) comes from the real
  // SVG path length at render time, not from these points directly.
  // Shared by every theme, so the overlap-free spacing already verified
  // by simulation holds for all of them.
  const LAYOUTS = {
    wide: { w: 800, h: 480, points: [{ x: 60, y: 420 }, { x: 320, y: 360 }, { x: 140, y: 240 }, { x: 420, y: 180 }, { x: 260, y: 90 }, { x: 560, y: 60 }] },
    tall: { w: 420, h: 760, points: [{ x: 70, y: 700 }, { x: 330, y: 600 }, { x: 90, y: 480 }, { x: 340, y: 380 }, { x: 100, y: 260 }, { x: 320, y: 160 }, { x: 180, y: 60 }] },
  };
  function pickLayout(container) {
    const w = container.clientWidth || 300, h = container.clientHeight || 300;
    return (w < 560 || h > w) ? LAYOUTS.tall : LAYOUTS.wide;
  }
  // A Catmull-Rom-to-Bezier spline through every waypoint — a smooth,
  // winding curve instead of a straight-segment zigzag, while still
  // passing through each layout point exactly (so getPointAtLength-based
  // checkpoint positioning doesn't need to change at all).
  function pathD(points) {
    if (points.length < 3) return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    let d = `M${points[0].x},${points[0].y} `;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x},${p2.y} `;
    }
    return d.trim();
  }

  const PHASES = [
    { at: 0.14, label: 'First steps' },
    { at: 0.32, label: 'Finding your stride' },
    { at: 0.52, label: 'Halfway there' },
    { at: 0.72, label: 'Closing in' },
    { at: 0.90, label: 'Almost at the target' },
  ];

  // A regular n-pointed star path, centered at the origin — used by
  // several themes for their goal badge and sparkle accents.
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

  // Places up to `count` props wherever isClear() allows, keeps them a
  // minimum distance apart, then draws them back-to-front (sorted by y)
  // with a perspective scale — props higher up the scene are "farther"
  // and drawn smaller — so they layer and recede like real scenery.
  function scatterProps(layer, layout, isClear, rand, { count, margin, spacing, minScale = 0.55, minY = 0, draw }) {
    const placed = [];
    for (let tries = 0; tries < count * 12 && placed.length < count; tries++) {
      const x = rand() * layout.w, y = rand() * layout.h;
      if (y < minY || !isClear(x, y, margin)) continue;
      if (placed.some(p => Math.hypot(p.x - x, p.y - y) < spacing)) continue;
      placed.push({ x, y, v: rand() });
    }
    placed.sort((a, b) => a.y - b.y).forEach(p => {
      const s = minScale + (1 - minScale) * (p.y / layout.h);
      const g = el('g', { transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) scale(${s.toFixed(3)})` });
      draw(g, p.v);
      layer.appendChild(g);
    });
  }

  function grassTuft(g, color) {
    ['M -3 0 Q -4 -6 -6 -9', 'M 0 0 Q 0 -7 1 -11', 'M 3 0 Q 4 -6 7 -8'].forEach(d => {
      g.appendChild(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
    });
  }

  // A few soft cloud puffs — shared by the Road and Race themes, which
  // both want a plain daytime sky.
  function cloudGroup(svg, layout, specs) {
    specs.forEach(([fx, fy, scale]) => {
      const cg = el('g', { transform: `translate(${layout.w * fx},${layout.h * fy}) scale(${scale})`, opacity: 0.9 });
      cg.appendChild(el('ellipse', { cx: 1, cy: 8, rx: 26, ry: 6, fill: '#a9c4dc', opacity: 0.55 }));
      [[-14, 0, 11], [0, -4, 14], [15, 0, 10], [0, 5, 13]].forEach(([ex, ey, r]) => cg.appendChild(el('ellipse', { cx: ex, cy: ey, rx: r, ry: r * 0.7, fill: '#ffffff' })));
      cg.appendChild(el('ellipse', { cx: 0, cy: 7, rx: 22, ry: 3.4, fill: '#cfdeec', opacity: 0.8 }));
      svg.appendChild(cg);
    });
  }

  // ════════════════════════════════════════════════════════════════
  // THEME: ROAD — "Road to the Goal". A winding toy-like path through a
  // bright daytime sky, to a shiny gold star.
  // ════════════════════════════════════════════════════════════════
  function roadDecorate(svg, layout, glowId) {
    // Parallax hill silhouettes behind the path — two layers tinted
    // toward the sky's own horizon color (atmospheric perspective: the
    // farther layer is paler/cooler) so the scene reads as having real
    // depth instead of one flat painted backdrop.
    svg.appendChild(el('path', {
      d: `M 0 ${layout.h * 0.56} Q ${layout.w * 0.22} ${layout.h * 0.46} ${layout.w * 0.48} ${layout.h * 0.52} T ${layout.w} ${layout.h * 0.48} L ${layout.w} ${layout.h} L 0 ${layout.h} Z`,
      fill: '#bcd9ce', opacity: 0.5,
    }));
    svg.appendChild(el('path', {
      d: `M 0 ${layout.h * 0.74} Q ${layout.w * 0.3} ${layout.h * 0.66} ${layout.w * 0.55} ${layout.h * 0.7} T ${layout.w} ${layout.h * 0.68} L ${layout.w} ${layout.h} L 0 ${layout.h} Z`,
      fill: '#8fc9a8', opacity: 0.6,
    }));

    const sunCx = layout.w * 0.86, sunCy = layout.h * 0.12;
    svg.appendChild(el('circle', { cx: sunCx, cy: sunCy, r: layout.w * 0.1, fill: '#ffe49a', opacity: 0.6, filter: glowId ? `url(#${glowId})` : undefined }));
    svg.appendChild(el('circle', { cx: sunCx, cy: sunCy, r: layout.w * 0.05, fill: '#ffd24a' }));
    svg.appendChild(el('circle', { cx: sunCx - layout.w * 0.015, cy: sunCy - layout.w * 0.015, r: layout.w * 0.022, fill: '#fff6cf', opacity: 0.8 }));
    cloudGroup(svg, layout, [[0.12, 0.1, 1], [0.28, 0.07, 0.75]]);

    // A few distant birds gliding across — tiny, dark, and slow, so they
    // add life at the edge of attention without competing with the path.
    [[0.4, 0.1, 1, 0], [0.45, 0.13, 0.8, 1.2], [0.36, 0.14, 0.7, 2.1]].forEach(([fx, fy, s, delay]) => {
      const pos = el('g', { transform: `translate(${layout.w * fx},${layout.h * fy}) scale(${s})` });
      const b = el('g', { class: 'journey-bird', style: `animation-delay:${delay}s` });
      b.appendChild(el('path', { d: 'M -6 0 Q -3 -3 0 0 Q 3 -3 6 0', fill: 'none', stroke: '#3a4a5c', 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
      pos.appendChild(b);
      svg.appendChild(pos);
    });
  }

  // Road scenery — trees lit from the upper left (a dark side, a
  // highlight cap, a cast shadow), grass tufts, and small flower patches.
  function roadScatter(layer, layout, isClear, rand) {
    scatterProps(layer, layout, isClear, rand, {
      count: 9, margin: 22, spacing: 46, minY: layout.h * 0.6,
      draw(g, v) {
        g.appendChild(el('ellipse', { cx: 6, cy: 1, rx: 16, ry: 4.5, fill: '#0b1220', opacity: 0.2 }));
        g.appendChild(el('rect', { x: -2.4, y: -16, width: 4.8, height: 17, rx: 1.2, fill: '#7a4b2a' }));
        g.appendChild(el('rect', { x: 0.4, y: -16, width: 2, height: 17, fill: '#5c3820' }));
        if (v < 0.4) {
          // Pine: stacked tiers, each with its own shaded right half.
          [[-34, 11], [-26, 14], [-18, 17]].forEach(([ty, hw]) => {
            g.appendChild(el('path', { d: `M 0 ${ty - 12} L ${hw} ${ty + 4} L ${-hw} ${ty + 4} Z`, fill: '#2f7a46' }));
            g.appendChild(el('path', { d: `M 0 ${ty - 12} L ${hw} ${ty + 4} L 0 ${ty + 4} Z`, fill: '#235e36' }));
          });
        } else {
          // Broadleaf: overlapping canopy puffs, darker underneath.
          g.appendChild(el('circle', { cx: -8, cy: -20, r: 10, fill: '#2f6e39' }));
          g.appendChild(el('circle', { cx: 8, cy: -20, r: 10, fill: '#2a6234' }));
          g.appendChild(el('circle', { cx: 0, cy: -28, r: 13, fill: '#3f8f4a' }));
          g.appendChild(el('circle', { cx: -5, cy: -32, r: 7, fill: '#5fae5c', opacity: 0.85 }));
          g.appendChild(el('circle', { cx: -7, cy: -34, r: 2.8, fill: '#9bd88f', opacity: 0.7 }));
        }
      },
    });
    scatterProps(layer, layout, isClear, rand, {
      count: 22, margin: 4, spacing: 18, minY: layout.h * 0.58,
      draw(g) { grassTuft(g, '#4f9a4f'); },
    });
    const petal = ['#ff7a9a', '#ffd24a', '#ffffff', '#b78cff'];
    scatterProps(layer, layout, isClear, rand, {
      count: 12, margin: 4, spacing: 22, minY: layout.h * 0.62,
      draw(g, v) {
        const c = petal[Math.floor(v * petal.length)];
        [[-2.4, 0], [2.4, 0], [0, -2.4], [0, 2.4]].forEach(([px, py]) => g.appendChild(el('circle', { cx: px, cy: py - 3, r: 1.8, fill: c })));
        g.appendChild(el('circle', { cx: 0, cy: -3, r: 1.3, fill: '#f59e0b' }));
      },
    });
  }

  // A cheerful game mascot with an actual limb rig — each leg/arm is its
  // own group (journey-leg-front/back, journey-arm-front/back in
  // index.html) that swings from its own shoulder/hip pivot via CSS,
  // plus a flaring cape, giving it a real running gait instead of one
  // rigid silhouette bobbing up and down. The outer .journey-avatar-bob
  // group still carries the vertical bob and the shared drop-shadow
  // filter, same as before — the limbs animate inside it.
  function roadLimb(cls, fill, x, y, w, len, footRx, footRy, footFill) {
    const wrap = el('g', { transform: `translate(${x},${y})` });
    const swing = el('g', { class: cls });
    swing.appendChild(el('rect', { x: -w / 2, y: 0, width: w, height: len, rx: w / 2 - 0.1, fill, stroke: '#1f2937', 'stroke-width': 0.8 }));
    swing.appendChild(el('rect', { x: -w / 2, y: 0, width: w / 2.2, height: len, rx: w / 2 - 0.1, fill: '#ffffff', opacity: 0.18 }));
    swing.appendChild(el('ellipse', { cx: 0, cy: len + footRy - 0.6, rx: footRx, ry: footRy, fill: footFill, stroke: '#1f2937', 'stroke-width': 0.6 }));
    wrap.appendChild(swing);
    return wrap;
  }
  function roadBuildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 0, cy: 24, rx: 15, ry: 3.6, fill: '#1f2937', opacity: 0.25 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });

    bob.appendChild(el('path', {
      class: 'journey-cape', d: 'M -4,-8 C -17,-5 -19,8 -10,15 C -15,8 -12,-3 -4,-7 Z',
      fill: '#ff7a9a', stroke: '#8a2d4a', 'stroke-width': 0.8, opacity: 0.9,
    }));

    bob.appendChild(roadLimb('journey-leg-back', '#2f3947', -3.4, 9, 4.2, 10, 2.9, 1.7, '#2f3947'));
    bob.appendChild(roadLimb('journey-arm-back', fill, -7.4, -4, 3.8, 8.6, 2, 2, '#ffd9ae'));

    bob.appendChild(el('rect', { x: -8.6, y: -9, width: 17.2, height: 19, rx: 7.6, fill, stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('ellipse', { cx: -3.6, cy: -4, rx: 4.6, ry: 6.4, fill: '#ffffff', opacity: 0.22 }));
    bob.appendChild(el('path', { d: 'M -8.6 -2 Q 0 2 8.6 -2', fill: 'none', stroke: '#ffffff', 'stroke-width': 1, opacity: 0.3 }));

    bob.appendChild(roadLimb('journey-leg-front', '#374151', 3.4, 9, 4.2, 10, 2.9, 1.7, '#374151'));
    bob.appendChild(roadLimb('journey-arm-front', fill, 7.4, -4, 3.8, 8.6, 2, 2, '#ffd9ae'));

    const head = el('g', { transform: 'translate(0,-18.5)' });
    head.appendChild(el('circle', { cx: 0, cy: 0, r: 9.2, fill: '#ffd9ae', stroke: '#1f2937', 'stroke-width': 1 }));
    head.appendChild(el('ellipse', { cx: -3, cy: -3.4, rx: 4.4, ry: 3, fill: '#ffffff', opacity: 0.32 }));
    head.appendChild(el('path', { d: 'M -9 -3 A 9 9 0 0 1 9 -3 L 8.6 -6.5 A 9.6 6.4 0 0 0 -8.6 -6.5 Z', fill: '#4a2f1e' }));
    head.appendChild(el('path', { d: 'M -2 -8.6 Q 1 -11.6 4.2 -8.8', fill: 'none', stroke: '#4a2f1e', 'stroke-width': 1.7, 'stroke-linecap': 'round' }));
    head.appendChild(el('path', { d: 'M -5 -4.6 Q -3.2 -5.7 -1.2 -4.8', fill: 'none', stroke: '#3a2516', 'stroke-width': 0.9, 'stroke-linecap': 'round' }));
    head.appendChild(el('path', { d: 'M 1.2 -4.8 Q 3.2 -5.7 5 -4.6', fill: 'none', stroke: '#3a2516', 'stroke-width': 0.9, 'stroke-linecap': 'round' }));
    head.appendChild(el('ellipse', { cx: -3.1, cy: -1, rx: 2.1, ry: 2.5, fill: '#ffffff' }));
    head.appendChild(el('circle', { cx: -2.8, cy: -0.5, r: 1.3, fill: '#1f2937' }));
    head.appendChild(el('circle', { cx: -3.3, cy: -1.2, r: 0.55, fill: '#ffffff' }));
    head.appendChild(el('ellipse', { cx: 3.1, cy: -1, rx: 2.1, ry: 2.5, fill: '#ffffff' }));
    head.appendChild(el('circle', { cx: 3.4, cy: -0.5, r: 1.3, fill: '#1f2937' }));
    head.appendChild(el('circle', { cx: 2.9, cy: -1.2, r: 0.55, fill: '#ffffff' }));
    head.appendChild(el('path', { d: 'M -2.6 3.3 Q 0 5.2 2.6 3.3', fill: 'none', stroke: '#1f2937', 'stroke-width': 1.1, 'stroke-linecap': 'round' }));
    head.appendChild(el('ellipse', { cx: -5.8, cy: 1.7, rx: 1.75, ry: 1.15, fill: '#ff9d8a', opacity: 0.55 }));
    head.appendChild(el('ellipse', { cx: 5.8, cy: 1.7, rx: 1.75, ry: 1.15, fill: '#ff9d8a', opacity: 0.55 }));
    bob.appendChild(head);

    g.appendChild(bob);
    return g;
  }

  // The goal marker — a shiny gold star badge (reads as "reward" to a kid
  // far more than a bullseye does), with a soft glow behind it and a
  // couple of small sparkle accents for polish.
  function roadBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const g = el('g', { transform: `translate(${x},${y})` });
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 32, fill: '#ffd54a', opacity: 0.35, filter: glowId ? `url(#${glowId})` : undefined }));
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 27, fill: '#ffd54a', opacity: 0.28 }));
    const ring = el('g', { class: 'journey-ring-spin-rev', opacity: 0.9 });
    [0, 60, 120, 180, 240, 300].forEach(rot => {
      ring.appendChild(el('path', { d: 'M 0,-30 L 2.4,-25 L -2.4,-25 Z', transform: `rotate(${rot})`, fill: '#ffffff' }));
    });
    g.appendChild(ring);
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 18.5, fill: '#ffffff', stroke: '#f3b429', 'stroke-width': 2.4 }));
    const star = el('path', {
      d: starPath(14, 6, 5), fill: `url(#${gradId})`, stroke: '#b8780f', 'stroke-width': 1.3, 'stroke-linejoin': 'round',
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    });
    g.appendChild(star);
    g.appendChild(el('rect', { class: 'journey-shine', x: -2.5, y: -16, width: 5, height: 32, fill: '#ffffff', opacity: 0 }));
    [[-20, -16, 2.6], [21, -10, 1.8], [16, 16, 2.1]].forEach(([sx, sy, r]) => {
      g.appendChild(el('path', { d: starPath(r, r * 0.35, 4), transform: `translate(${sx},${sy})`, fill: '#ffffff', opacity: 0.85 }));
    });
    return g;
  }

  // A checkpoint flag — a warm wooden post + a rounded pennant. Done
  // checkpoints get a bold check; the current ("next") one gets a soft
  // pulsing glow (see index.html's .journey-next-glow) so a kid can see
  // at a glance where to go next.
  function roadBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
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
      // A real obstacle gate across the road, not just a status icon —
      // hazard-striped barrier arm between two posts, with a pulsing
      // warning glow and a small padlock, reading as "something to
      // clear" rather than a passive label.
      const ox = -26 * s, oy = -6 * s;
      g.appendChild(el('circle', { class: 'journey-blocked-glow', cx: ox, cy: oy, r: 20 * s, fill: '#ef4444', opacity: 0.45 }));
      const gate = el('g', { transform: `translate(${ox},${oy})` });
      gate.appendChild(el('rect', { x: -5 * s, y: -30 * s, width: 4 * s, height: 26 * s, rx: 1.4 * s, fill: '#6b4a2a', stroke: '#3f2a16', 'stroke-width': 0.8 * s }));
      gate.appendChild(el('rect', { x: 17 * s, y: -30 * s, width: 4 * s, height: 26 * s, rx: 1.4 * s, fill: '#6b4a2a', stroke: '#3f2a16', 'stroke-width': 0.8 * s }));
      const bar = el('g', { transform: 'rotate(-6)' });
      bar.appendChild(el('rect', { x: -10 * s, y: -26 * s, width: 34 * s, height: 8 * s, rx: 2.4 * s, fill: '#f97316', stroke: '#7c2d12', 'stroke-width': s }));
      [-10, 6, 22].forEach(sx => bar.appendChild(el('rect', { x: sx * s, y: -26 * s, width: 8 * s, height: 8 * s, fill: '#fff', opacity: 0.9 })));
      gate.appendChild(bar);
      const lock = el('g', { transform: `translate(${6 * s},${-40 * s})` });
      lock.appendChild(el('rect', { x: -5 * s, y: -1 * s, width: 10 * s, height: 8 * s, rx: 1.8 * s, fill: '#f4b400', stroke: '#7c5700', 'stroke-width': 0.9 * s }));
      lock.appendChild(el('path', { d: `M ${-2.6 * s} ${-1 * s} L ${-2.6 * s} ${-4.4 * s} A ${2.6 * s} ${2.6 * s} 0 0 1 ${2.6 * s} ${-4.4 * s} L ${2.6 * s} ${-1 * s}`, fill: 'none', stroke: '#7c5700', 'stroke-width': 1.3 * s }));
      gate.appendChild(lock);
      g.appendChild(gate);
    }
    return g;
  }

  // ════════════════════════════════════════════════════════════════
  // THEME: SPACE — "Mission to the Stars". A night sky, a flight trail,
  // a chibi astronaut, and a ringed planet to land on.
  // ════════════════════════════════════════════════════════════════
  const SPACE_STARS = [
    [0.06, 0.08, 1.4], [0.18, 0.22, 1], [0.34, 0.05, 1.6], [0.5, 0.15, 1], [0.63, 0.3, 1.3],
    [0.08, 0.42, 1], [0.22, 0.55, 1.5], [0.4, 0.6, 1], [0.58, 0.5, 1.2], [0.72, 0.62, 1],
    [0.1, 0.75, 1.3], [0.3, 0.85, 1], [0.52, 0.82, 1.5], [0.68, 0.9, 1],
  ];
  function spaceDecorate(svg, layout, glowId, glowLgId) {
    // Nebula clouds — big, heavily blurred color washes that give deep
    // space its depth and color variation instead of one flat gradient.
    [[0.2, 0.3, 0.32, 0.18, '#7c3aed', 0.35], [0.7, 0.55, 0.36, 0.2, '#db2777', 0.22], [0.45, 0.8, 0.4, 0.16, '#2563eb', 0.3]].forEach(([fx, fy, rx, ry, color, op]) => {
      svg.appendChild(el('ellipse', {
        cx: layout.w * fx, cy: layout.h * fy, rx: layout.w * rx, ry: layout.h * ry,
        fill: color, opacity: op, filter: glowLgId ? `url(#${glowLgId})` : undefined,
      }));
    });
    SPACE_STARS.forEach(([fx, fy, r], i) => {
      svg.appendChild(el('circle', {
        class: 'journey-star-twinkle', cx: layout.w * fx, cy: layout.h * fy, r,
        fill: '#ffffff', opacity: 0.55 + (r - 1) * 0.3, style: `animation-delay:${(i * 0.3 % 2.4).toFixed(1)}s`,
      }));
    });
    const pcx = layout.w * 0.86, pcy = layout.h * 0.14;
    svg.appendChild(el('circle', { cx: pcx, cy: pcy, r: layout.w * 0.045, fill: '#7c6bc4', opacity: 0.55 }));
    svg.appendChild(el('ellipse', { cx: pcx, cy: pcy, rx: layout.w * 0.065, ry: layout.w * 0.018, fill: 'none', stroke: '#a996e0', 'stroke-width': 1.6, opacity: 0.5, transform: `rotate(-14 ${pcx} ${pcy})` }));

    // A comet streaking across on a long, slow loop — a bright head with
    // a fading tail, drawn once and swept by the CSS animation rather
    // than redrawn, so it costs nothing extra per sync().
    const cometPos = el('g', { transform: `translate(${layout.w * 0.78},${layout.h * 0.1})` });
    const comet = el('g', { class: 'journey-comet' });
    cometPos.appendChild(comet);
    comet.appendChild(el('path', { d: 'M 0,0 L 50,-32', fill: 'none', stroke: '#cfe3ff', 'stroke-width': 2, opacity: 0.5, 'stroke-linecap': 'round' }));
    comet.appendChild(el('circle', { cx: 0, cy: 0, r: 2.6, fill: '#ffffff' }));
    svg.appendChild(cometPos);

    // Loose tumbling asteroid chunks drifting through the background.
    [[0.5, 0.18, 1, 7], [0.3, 0.32, 0.7, 5.5], [0.62, 0.45, 0.55, 4.5]].forEach(([fx, fy, scale, dur]) => {
      const pos = el('g', { transform: `translate(${layout.w * fx},${layout.h * fy}) scale(${scale})`, opacity: 0.6 });
      const g = el('g', { class: 'journey-asteroid', style: `animation-duration:${dur}s` });
      g.appendChild(el('path', { d: 'M -5 -2 L -2 -6 L 4 -5 L 6 0 L 3 5 L -4 4 L -6 1 Z', fill: '#5b5f78', stroke: '#2f3347', 'stroke-width': 0.6 }));
      pos.appendChild(g);
      svg.appendChild(pos);
    });
  }

  // Space scenery — faint distant galaxies and the odd drifting rock.
  function spaceScatter(layer, layout, isClear, rand, glowId) {
    scatterProps(layer, layout, isClear, rand, {
      count: 4, margin: 20, spacing: 90, minScale: 0.7,
      draw(g, v) {
        const tilt = Math.round(v * 60 - 30);
        g.appendChild(el('ellipse', { cx: 0, cy: 0, rx: 16, ry: 5, fill: '#c4b5fd', opacity: 0.45, transform: `rotate(${tilt})`, filter: glowId ? `url(#${glowId})` : undefined }));
        g.appendChild(el('ellipse', { cx: 0, cy: 0, rx: 9, ry: 2.4, fill: '#e9e3ff', opacity: 0.55, transform: `rotate(${tilt})` }));
        g.appendChild(el('circle', { cx: 0, cy: 0, r: 1.8, fill: '#ffffff' }));
      },
    });
    scatterProps(layer, layout, isClear, rand, {
      count: 6, margin: 10, spacing: 50,
      draw(g, v) {
        g.appendChild(el('path', { d: 'M -6 -2 L -2 -7 L 5 -6 L 7 0 L 3 6 L -5 5 L -7 1 Z', fill: '#5b5f78', stroke: '#2f3347', 'stroke-width': 0.6, transform: `rotate(${Math.round(v * 360)})` }));
        g.appendChild(el('circle', { cx: -1.5, cy: -2, r: 1.4, fill: '#3f4258' }));
        g.appendChild(el('path', { d: 'M -5 -3 L -2 -6 L 2 -5.5', fill: 'none', stroke: '#8e93ad', 'stroke-width': 0.8, 'stroke-linecap': 'round' }));
      },
    });
  }

  // A chibi astronaut — the passed-in "fill" tints the chest accent
  // stripe (red for the real avatar, grey for the pace ghost); the suit
  // itself stays white/silver so it still reads as "astronaut" either way.
  function spaceBuildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 0, cy: 24, rx: 12, ry: 3.2, fill: '#1f2937', opacity: 0.22 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    bob.appendChild(el('rect', { x: -6.6, y: 8, width: 5, height: 11, rx: 2.2, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('rect', { x: 1.6, y: 8, width: 5, height: 11, rx: 2.2, fill: '#dde4ee', stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('rect', { x: -7.4, y: 16.5, width: 6.6, height: 3.4, rx: 1.4, fill: '#374151' }));
    bob.appendChild(el('rect', { x: 0.8, y: 16.5, width: 6.6, height: 3.4, rx: 1.4, fill: '#374151' }));
    bob.appendChild(el('ellipse', { cx: -9.8, cy: 1, rx: 3.6, ry: 5.6, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(18 -9.8 1)' }));
    bob.appendChild(el('ellipse', { cx: 9.8, cy: 1, rx: 3.6, ry: 5.6, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(-18 9.8 1)' }));
    bob.appendChild(el('rect', { x: -9.4, y: -7.5, width: 18.8, height: 18.5, rx: 7, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1.2 }));
    bob.appendChild(el('rect', { x: -4.5, y: -2, width: 9, height: 5, rx: 1.6, fill }));
    bob.appendChild(el('circle', { cx: 0, cy: -15.5, r: 9.2, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1.2 }));
    bob.appendChild(el('circle', { cx: 0.6, cy: -15, r: 6.6, fill: '#1b2a5e' }));
    bob.appendChild(el('path', { d: 'M -4.4 -18.4 Q 0 -20.6 4.2 -18', fill: 'none', stroke: '#9fd8ff', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.8 }));
    bob.appendChild(el('rect', { x: -0.5, y: -24.6, width: 1, height: 4, fill: '#9aa5b1' }));
    bob.appendChild(el('circle', { cx: 0, cy: -24.8, r: 1.4, fill: '#e5e7eb', stroke: '#1f2937', 'stroke-width': 0.8 }));
    g.appendChild(bob);
    return g;
  }

  // The goal marker — a glowing ringed planet with a soft highlight and
  // a few sparkles, drawn with the ring behind the planet body so it
  // reads correctly without needing a true front/back arc split.
  function spaceBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const g = el('g', { transform: `translate(${x},${y})` });
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 32, fill: '#ffb84a', opacity: 0.3, filter: glowId ? `url(#${glowId})` : undefined }));
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 27, fill: '#ffb84a', opacity: 0.22 }));
    g.appendChild(el('ellipse', { cx: 0, cy: 0, rx: 24, ry: 7, fill: 'none', stroke: '#ffd98a', 'stroke-width': 2.6, opacity: 0.85, transform: 'rotate(-18)' }));
    const planet = el('circle', {
      cx: 0, cy: 0, r: 15, fill: `url(#${gradId})`, stroke: '#b8641a', 'stroke-width': 1.3,
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    });
    g.appendChild(planet);
    g.appendChild(el('ellipse', { cx: -4, cy: -5, rx: 5, ry: 2.6, fill: '#ffffff', opacity: 0.35 }));
    [[-21, -17, 2.4], [20, -12, 1.7], [15, 17, 2]].forEach(([sx, sy, r]) => {
      g.appendChild(el('path', { d: starPath(r, r * 0.35, 4), transform: `translate(${sx},${sy})`, fill: '#ffffff', opacity: 0.85 }));
    });
    return g;
  }

  // A checkpoint — a thin antenna post topped with a small glowing star,
  // colored by status the same way every other theme's checkpoint is.
  function spaceBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 0, cy: -20 * s, r: 14 * s, fill: NEXT_COLOR, opacity: 0.5 }));
    g.appendChild(el('rect', { x: -1 * s, y: -24 * s, width: 2 * s, height: 24 * s, fill: '#9aa5b1', stroke: '#4b5563', 'stroke-width': 0.6 * s, rx: 0.8 * s }));
    const star = el('path', {
      d: starPath(8 * s, 3.4 * s, 5), transform: `translate(0,${-26 * s})`, fill: color, stroke: '#1f2937', 'stroke-width': 0.6 * s, 'stroke-linejoin': 'round',
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    });
    g.appendChild(star);
    const label = el('text', {
      x: 0, y: -25.6 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 6.6 * s, 'font-weight': 800, fill: '#1f2937', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    g.appendChild(label);
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 2.6 * s, fill: '#9aa5b1', stroke: '#4b5563', 'stroke-width': 0.6 * s }));
    if (blocked) {
      const badge = el('text', { x: 11 * s, y: -27 * s, 'font-size': 8 * s, 'text-anchor': 'middle' });
      badge.textContent = '🚧';
      g.appendChild(badge);
    }
    return g;
  }

  // ════════════════════════════════════════════════════════════════
  // THEME: OCEAN — "Dive to the Treasure". A surface-to-depths sea, a
  // sandy trail, a swimming sea turtle, and a treasure chest.
  // ════════════════════════════════════════════════════════════════
  const OCEAN_BUBBLES = [[0.08, 0.15, 2.6], [0.14, 0.3, 1.6], [0.05, 0.5, 2], [0.2, 0.62, 1.4], [0.1, 0.78, 2.2], [0.46, 0.7, 1.8], [0.6, 0.85, 1.4]];
  function oceanDecorate(svg, layout, glowId, glowLgId) {
    // Sunlight shafts slanting down from the surface — soft-edged, faintly
    // shimmering wedges, the single strongest "you're underwater" cue.
    [[0.18, 0.08], [0.42, 0.06], [0.66, 0.09], [0.86, 0.07]].forEach(([fx, fw], i) => {
      const x = layout.w * fx, w = layout.w * fw;
      svg.appendChild(el('path', {
        class: 'journey-ray-shimmer', style: `animation-delay:${(i * 0.9).toFixed(1)}s`,
        d: `M ${x - w / 2} 0 L ${x + w / 2} 0 L ${x + w * 1.6} ${layout.h} L ${x + w * 0.2} ${layout.h} Z`,
        fill: '#ffffff', opacity: 0.12, filter: glowLgId ? `url(#${glowLgId})` : undefined,
      }));
    });
    // A dark depth haze toward the bottom, so the scene falls off into
    // deeper water rather than ending in a flat color.
    svg.appendChild(el('rect', { x: 0, y: layout.h * 0.7, width: layout.w, height: layout.h * 0.3, fill: '#0c3b66', opacity: 0.25, filter: glowLgId ? `url(#${glowLgId})` : undefined }));
    OCEAN_BUBBLES.forEach(([fx, fy, r], i) => {
      svg.appendChild(el('circle', {
        class: 'journey-bubble-rise', cx: layout.w * fx, cy: layout.h * fy, r,
        fill: '#ffffff', opacity: 0.4, stroke: '#ffffff', 'stroke-width': 0.6,
        style: `animation-delay:${(i * 0.7).toFixed(1)}s`,
      }));
    });

    function fish(fx, fy, scale, color, delay) {
      const pos = el('g', { transform: `translate(${layout.w * fx},${layout.h * fy})` });
      const wrap = el('g', { class: 'journey-fish-swim', style: `animation-delay:${delay}s` });
      pos.appendChild(wrap);
      const g = el('g', { transform: `scale(${scale})`, opacity: 0.9 });
      g.appendChild(el('path', { d: 'M -8 0 L 2 -5 L 2 5 Z', fill: color }));
      g.appendChild(el('ellipse', { cx: 6, cy: 0, rx: 8, ry: 5, fill: color, stroke: '#1f2937', 'stroke-width': 0.5, opacity: 0.95 }));
      g.appendChild(el('ellipse', { cx: 4, cy: -2.4, rx: 4, ry: 1.6, fill: '#ffffff', opacity: 0.3 }));
      g.appendChild(el('circle', { cx: 10.5, cy: -1, r: 1, fill: '#1f2937' }));
      wrap.appendChild(g);
      svg.appendChild(pos);
    }
    fish(0.82, 0.2, 0.9, '#ffb04a', 0);
    fish(0.9, 0.42, 0.7, '#ff8a65', 1.4);
    fish(0.74, 0.55, 0.6, '#5ec8e0', 0.6);
    fish(0.86, 0.68, 0.5, '#ffb04a', 2.1);

    // A patrolling reef shark in the far background — bigger, dimmer, and
    // slower than the fish so it reads as "out there" depth rather than
    // competing with the path for attention; it slowly sweeps right then
    // swims back left (the swim keyframe flips it with scaleX so it faces
    // the way it's moving).
    const sharkPos = el('g', { transform: `translate(${layout.w * 0.14},${layout.h * 0.28}) scale(1.3)`, opacity: 0.35 });
    const shark = el('g', { class: 'journey-shark-swim' });
    sharkPos.appendChild(shark);
    shark.appendChild(el('path', { d: 'M -16 0 L 2 -8 L 10 0 L 2 8 Z', fill: '#2f4f6b' }));
    shark.appendChild(el('path', { d: 'M 2 -8 L 6 -16 L 8 -6 Z', fill: '#2f4f6b' }));
    shark.appendChild(el('path', { d: 'M -8 6 L -4 13 L -2 6 Z', fill: '#2f4f6b' }));
    shark.appendChild(el('circle', { cx: 6, cy: -1, r: 1, fill: '#0f1b24' }));
    svg.appendChild(sharkPos);

    // Seaweed fronds swaying from the sea floor at the near corners.
    [[0.03, 0.97, 1], [0.94, 0.97, 0.8]].forEach(([fx, fy, scale], i) => {
      const g = el('g', { transform: `translate(${layout.w * fx},${layout.h * fy}) scale(${scale})` });
      [-1, 0, 1].forEach(off => {
        g.appendChild(el('path', {
          class: 'journey-seaweed', style: `animation-delay:${(i * 0.5 + off * 0.3).toFixed(1)}s`,
          d: `M ${off * 6} 0 Q ${off * 6 + 6} -14 ${off * 6 - 2} -26`,
          fill: 'none', stroke: '#2f9e6e', 'stroke-width': 3, 'stroke-linecap': 'round',
        }));
      });
      svg.appendChild(g);
    });
  }

  // Ocean scenery — branching coral, smooth sea-floor rocks, starfish.
  function oceanScatter(layer, layout, isClear, rand) {
    const coral = ['#ff7f8a', '#ff9f5a', '#c084fc'];
    scatterProps(layer, layout, isClear, rand, {
      count: 7, margin: 18, spacing: 50,
      draw(g, v) {
        const c = coral[Math.floor(v * coral.length)];
        g.appendChild(el('ellipse', { cx: 0, cy: 1, rx: 12, ry: 3, fill: '#0b1220', opacity: 0.18 }));
        ['M 0 0 Q -1 -10 -6 -18', 'M 0 0 Q 1 -12 2 -24', 'M 0 0 Q 3 -8 9 -15', 'M -3 -9 Q -8 -12 -10 -16', 'M 1.5 -14 Q 6 -18 7 -22'].forEach(d => {
          g.appendChild(el('path', { d, fill: 'none', stroke: c, 'stroke-width': 3.2, 'stroke-linecap': 'round' }));
        });
        g.appendChild(el('path', { d: 'M 0 0 Q 1 -12 2 -24', fill: 'none', stroke: '#ffffff', 'stroke-width': 0.9, 'stroke-linecap': 'round', opacity: 0.35, transform: 'translate(-1,0)' }));
      },
    });
    scatterProps(layer, layout, isClear, rand, {
      count: 8, margin: 10, spacing: 34,
      draw(g, v) {
        if (v < 0.6) {
          g.appendChild(el('ellipse', { cx: 0, cy: -3, rx: 9, ry: 5.5, fill: '#5f7482' }));
          g.appendChild(el('ellipse', { cx: -2, cy: -5, rx: 5, ry: 2.4, fill: '#8aa0ae', opacity: 0.8 }));
        } else {
          g.appendChild(el('path', { d: starPath(6.5, 2.6, 5), transform: 'translate(0,-4)', fill: '#ff8a4c', stroke: '#c2410c', 'stroke-width': 0.6 }));
          g.appendChild(el('circle', { cx: 0, cy: -4, r: 1.4, fill: '#ffd0a8' }));
        }
      },
    });
  }

  // A sea turtle — the passed-in "fill" is the shell color directly
  // (bright green for the real avatar, grey for the pace ghost).
  function oceanBuildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 0, cy: 15, rx: 13, ry: 3, fill: '#1f2937', opacity: 0.18 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    bob.appendChild(el('ellipse', { cx: -11, cy: 4, rx: 4.6, ry: 2.6, fill, stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(-20 -11 4)' }));
    bob.appendChild(el('ellipse', { cx: 11, cy: 4, rx: 4.6, ry: 2.6, fill, stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(20 11 4)' }));
    bob.appendChild(el('ellipse', { cx: -8, cy: 10, rx: 3.6, ry: 2.2, fill, stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(-10 -8 10)' }));
    bob.appendChild(el('ellipse', { cx: 8, cy: 10, rx: 3.6, ry: 2.2, fill, stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(10 8 10)' }));
    bob.appendChild(el('ellipse', { cx: 0, cy: 0, rx: 13.5, ry: 10.5, fill, stroke: '#1f2937', 'stroke-width': 1.3 }));
    bob.appendChild(el('path', { d: 'M -7 -3 L 0 -7 L 7 -3 L 4 4 L -4 4 Z', fill: 'none', stroke: '#1f2937', 'stroke-width': 0.8, opacity: 0.4 }));
    bob.appendChild(el('circle', { cx: 0, cy: -13, r: 5.6, fill: '#8fd4a0', stroke: '#1f2937', 'stroke-width': 1.1 }));
    bob.appendChild(el('circle', { cx: -2, cy: -14, r: 0.9, fill: '#1f2937' }));
    bob.appendChild(el('circle', { cx: 2, cy: -14, r: 0.9, fill: '#1f2937' }));
    bob.appendChild(el('path', { d: 'M -2.4 -11 Q 0 -9.6 2.4 -11', fill: 'none', stroke: '#1f2937', 'stroke-width': 0.9, 'stroke-linecap': 'round' }));
    g.appendChild(bob);
    return g;
  }

  // The goal marker — an open treasure chest with a gold trim band, a
  // latch, and a glowing gem peeking out, plus a couple of sparkles.
  function oceanBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const g = el('g', { transform: `translate(${x},${y})` });
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 30, fill: '#ffd54a', opacity: 0.3, filter: glowId ? `url(#${glowId})` : undefined }));
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 25, fill: '#ffd54a', opacity: 0.22 }));
    const chest = el('g', { filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    chest.appendChild(el('rect', { x: -15, y: -2, width: 30, height: 15, rx: 2.4, fill: '#8b5e3c', stroke: '#5c3c22', 'stroke-width': 1.3 }));
    chest.appendChild(el('path', { d: 'M -15 -2 Q -15 -14 0 -14 Q 15 -14 15 -2 Z', fill: '#a9774c', stroke: '#5c3c22', 'stroke-width': 1.3 }));
    chest.appendChild(el('rect', { x: -15, y: -2, width: 30, height: 3, fill: '#5c3c22' }));
    chest.appendChild(el('rect', { x: -2.6, y: -14, width: 5.2, height: 14, fill: `url(#${gradId})`, stroke: '#8b650f', 'stroke-width': 1 }));
    chest.appendChild(el('circle', { cx: 0, cy: -1, r: 3, fill: `url(#${gradId})`, stroke: '#8b650f', 'stroke-width': 1 }));
    g.appendChild(chest);
    g.appendChild(el('path', { d: starPath(5.4, 2.2, 4), transform: 'translate(0,-16)', fill: '#67e8f9', stroke: '#0e7490', 'stroke-width': 1 }));
    [[-17, -10, 2.2], [17, -6, 1.8], [12, 10, 2]].forEach(([sx, sy, r]) => {
      g.appendChild(el('path', { d: starPath(r, r * 0.35, 4), transform: `translate(${sx},${sy})`, fill: '#ffffff', opacity: 0.85 }));
    });
    return g;
  }

  // A checkpoint — a striped buoy floating just above the sea floor.
  function oceanBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 0, cy: -16 * s, r: 14 * s, fill: NEXT_COLOR, opacity: 0.5 }));
    g.appendChild(el('rect', { x: -0.9 * s, y: -9 * s, width: 1.8 * s, height: 9 * s, fill: '#5b7a8c', rx: 0.6 * s }));
    g.appendChild(el('ellipse', {
      cx: 0, cy: -16 * s, rx: 9 * s, ry: 8 * s, fill: '#ffffff', stroke: '#1f2937', 'stroke-width': 0.8 * s,
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    }));
    g.appendChild(el('rect', { x: -7 * s, y: -18.2 * s, width: 14 * s, height: 4.4 * s, rx: 1.4 * s, fill: color }));
    const label = el('text', {
      x: 0, y: -16.4 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 7.2 * s, 'font-weight': 800, fill: '#1f2937', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    g.appendChild(label);
    if (blocked) {
      const badge = el('text', { x: 11 * s, y: -24 * s, 'font-size': 8 * s, 'text-anchor': 'middle' });
      badge.textContent = '🚧';
      g.appendChild(badge);
    }
    return g;
  }

  // ════════════════════════════════════════════════════════════════
  // THEME: RACE — "Race to the Finish". An asphalt track under a bright
  // sky, a race car, traffic-cone checkpoints, and a trophy.
  // ════════════════════════════════════════════════════════════════
  function raceDecorate(svg, layout) {
    // A stadium infield seen from above — mown grass in alternating
    // light/dark stripes, the way real circuit and stadium turf is cut.
    const stripes = 9;
    for (let i = 0; i < stripes; i++) {
      svg.appendChild(el('rect', {
        x: (i / stripes) * layout.w, y: 0, width: layout.w / stripes + 1, height: layout.h,
        fill: i % 2 === 0 ? '#6fb865' : '#62a95a',
      }));
    }
    svg.appendChild(el('rect', { x: 0, y: 0, width: layout.w, height: layout.h, fill: '#ffffff', opacity: 0.06 }));

    // A cheering crowd in the grandstand along the top edge — rows of
    // small bobbing dots in varied colors, each on its own bob delay so
    // the stand reads as restless rather than uniformly ticking.
    const stand = el('g', { opacity: 0.55 });
    stand.appendChild(el('rect', { x: 0, y: 0, width: layout.w, height: layout.h * 0.07, fill: '#334155' }));
    const crowdColors = ['#f87171', '#fbbf24', '#60a5fa', '#34d399', '#f472b6'];
    for (let i = 0; i < 26; i++) {
      const cx = (i + 0.5) * (layout.w / 26);
      const cy = layout.h * 0.035 + (i % 2 === 0 ? 2 : -2);
      stand.appendChild(el('circle', {
        class: 'journey-crowd-bob', cx, cy, r: 3.4, fill: crowdColors[i % crowdColors.length],
        style: `animation-delay:${((i % 7) * 0.15).toFixed(2)}s`,
      }));
    }
    svg.appendChild(stand);
  }

  // Race scenery — stacked tire walls, red/white barrier blocks, grass.
  function raceScatter(layer, layout, isClear, rand) {
    scatterProps(layer, layout, isClear, rand, {
      count: 6, margin: 16, spacing: 52,
      draw(g, v) {
        g.appendChild(el('ellipse', { cx: 3, cy: 1, rx: 13, ry: 3.5, fill: '#0b1220', opacity: 0.2 }));
        if (v < 0.55) {
          [0, -5, -10].forEach(ty => {
            g.appendChild(el('ellipse', { cx: 0, cy: ty, rx: 8, ry: 3.4, fill: '#1f2937' }));
            g.appendChild(el('ellipse', { cx: 0, cy: ty - 0.6, rx: 3.6, ry: 1.4, fill: '#4b5563' }));
          });
          g.appendChild(el('ellipse', { cx: -3, cy: -11.5, rx: 3, ry: 0.9, fill: '#6b7280', opacity: 0.8 }));
        } else {
          g.appendChild(el('rect', { x: -12, y: -8, width: 24, height: 8, rx: 1.4, fill: '#ffffff', stroke: '#1f2937', 'stroke-width': 0.6 }));
          [-12, -4, 4].forEach(sx => g.appendChild(el('rect', { x: sx, y: -8, width: 4, height: 8, fill: '#ef4444' })));
          g.appendChild(el('rect', { x: -12, y: -8, width: 24, height: 2, fill: '#ffffff', opacity: 0.5 }));
        }
      },
    });
    scatterProps(layer, layout, isClear, rand, {
      count: 18, margin: 4, spacing: 20,
      draw(g) { grassTuft(g, '#3f8a3f'); },
    });
  }

  // A race car — the passed-in "fill" is the body color directly
  // (bright for the real avatar, grey for the pace ghost — grey reads
  // naturally as a pace car here).
  function raceBuildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 0, cy: 10, rx: 14, ry: 3.4, fill: '#1f2937', opacity: 0.22 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    bob.appendChild(el('circle', { cx: -8, cy: 8, r: 3.6, fill: '#1f2937' }));
    bob.appendChild(el('circle', { cx: -8, cy: 8, r: 1.4, fill: '#6b7280' }));
    bob.appendChild(el('circle', { cx: 8, cy: 8, r: 3.6, fill: '#1f2937' }));
    bob.appendChild(el('circle', { cx: 8, cy: 8, r: 1.4, fill: '#6b7280' }));
    bob.appendChild(el('rect', { x: -14, y: -2, width: 28, height: 11, rx: 4.4, fill, stroke: '#1f2937', 'stroke-width': 1.2 }));
    bob.appendChild(el('path', { d: 'M -8 -2 Q -6 -11 0 -11 Q 6 -11 8 -2 Z', fill: '#bae6fd', stroke: '#1f2937', 'stroke-width': 1.1 }));
    bob.appendChild(el('rect', { x: -3, y: -2, width: 6, height: 11, fill: '#ffffff', opacity: 0.85 }));
    bob.appendChild(el('rect', { x: -15.4, y: 1.4, width: 2.6, height: 4, rx: 1, fill: '#1f2937' }));
    bob.appendChild(el('rect', { x: 12.8, y: 1.4, width: 2.6, height: 4, rx: 1, fill: '#1f2937' }));
    g.appendChild(bob);

    // Speed lines trailing behind the car — three short dashes that
    // flash and retreat on a loop, selling motion even while the car
    // itself is only gliding between fixed points.
    const speed = el('g', { opacity: 0.8 });
    [[-18, -4, 0], [-20, 2, 0.12], [-17, 7, 0.22]].forEach(([sx, sy, delay]) => {
      speed.appendChild(el('rect', { class: 'journey-speedline', x: sx, y: sy, width: 8, height: 1.6, rx: 0.8, fill: '#e2e8f0', style: `animation-delay:${delay}s` }));
    });
    g.appendChild(speed);
    return g;
  }

  // The goal marker — a gold trophy cup with handles and a base, plus a
  // few sparkles, matching the "shiny reward" language the other themes
  // use for their own goal markers.
  function raceBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const g = el('g', { transform: `translate(${x},${y})` });
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 31, fill: '#ffd54a', opacity: 0.3, filter: glowId ? `url(#${glowId})` : undefined }));
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 26, fill: '#ffd54a', opacity: 0.22 }));
    const trophy = el('g', { filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    trophy.appendChild(el('path', { d: 'M -9 -16 Q -9 -4 0 -2 Q 9 -4 9 -16 Z', fill: `url(#${gradId})`, stroke: '#b8780f', 'stroke-width': 1.3, 'stroke-linejoin': 'round' }));
    trophy.appendChild(el('path', { d: 'M -9 -16 Q -15 -16 -15 -11 Q -15 -6 -9.5 -7', fill: 'none', stroke: '#b8780f', 'stroke-width': 1.6 }));
    trophy.appendChild(el('path', { d: 'M 9 -16 Q 15 -16 15 -11 Q 15 -6 9.5 -7', fill: 'none', stroke: '#b8780f', 'stroke-width': 1.6 }));
    trophy.appendChild(el('rect', { x: -1.6, y: -2, width: 3.2, height: 6, fill: '#f3b429' }));
    trophy.appendChild(el('path', { d: 'M -7 4 L 7 4 L 5 8 L -5 8 Z', fill: '#f3b429', stroke: '#b8780f', 'stroke-width': 1 }));
    g.appendChild(trophy);

    // A waving checkered flag planted beside the trophy — the classic
    // "race over" signal, flapping via a CSS skew on the flag only (the
    // pole stays rigid).
    const flagPole = el('g', { transform: 'translate(16,-6)' });
    flagPole.appendChild(el('rect', { x: -0.9, y: -22, width: 1.8, height: 22, fill: '#9aa5b1', stroke: '#4b5563', 'stroke-width': 0.5 }));
    const flagPos = el('g', { transform: 'translate(0.9,-22)' });
    const flag = el('g', { class: 'journey-flag-wave' });
    flagPos.appendChild(flag);
    const checker = el('g');
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        if ((r + c) % 2 === 0) checker.appendChild(el('rect', { x: c * 2.6, y: r * 2.2, width: 2.6, height: 2.2, fill: '#1f2937' }));
      }
    }
    flag.appendChild(el('rect', { x: 0, y: 0, width: 13, height: 8.8, fill: '#ffffff', stroke: '#1f2937', 'stroke-width': 0.5 }));
    flag.appendChild(checker);
    flagPole.appendChild(flagPos);
    g.appendChild(flagPole);

    [[-18, -14, 2.4], [18, -10, 1.8], [14, 10, 2]].forEach(([sx, sy, r]) => {
      g.appendChild(el('path', { d: starPath(r, r * 0.35, 4), transform: `translate(${sx},${sy})`, fill: '#ffffff', opacity: 0.85 }));
    });
    return g;
  }

  // A checkpoint — a traffic cone with a status-colored stripe band.
  function raceBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 0, cy: -11 * s, r: 14 * s, fill: NEXT_COLOR, opacity: 0.5 }));
    g.appendChild(el('ellipse', { cx: 0, cy: 1 * s, rx: 8 * s, ry: 2.4 * s, fill: '#1f2937', opacity: 0.7 }));
    const cone = el('path', {
      d: `M ${-2.6 * s} 0 L ${-7 * s} ${2 * s} L ${7 * s} ${2 * s} L ${2.6 * s} 0 L ${1.6 * s} ${-19 * s} L ${-1.6 * s} ${-19 * s} Z`,
      fill: '#f97316', stroke: '#1f2937', 'stroke-width': 0.6 * s, 'stroke-linejoin': 'round',
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    });
    g.appendChild(cone);
    g.appendChild(el('rect', { x: -2.2 * s, y: -13 * s, width: 4.4 * s, height: 3.6 * s, fill: color, stroke: '#1f2937', 'stroke-width': 0.4 * s }));
    const label = el('text', {
      x: 0, y: -6.6 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 6.4 * s, 'font-weight': 800, fill: '#ffffff', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    g.appendChild(label);
    if (blocked) {
      const badge = el('text', { x: 10 * s, y: -20 * s, 'font-size': 8 * s, 'text-anchor': 'middle' });
      badge.textContent = '🚧';
      g.appendChild(badge);
    }
    return g;
  }

  // ════════════════════════════════════════════════════════════════
  // THEME REGISTRY — picked by app.js (Settings-free: a small selector
  // right in the Journey header, see index.html's #journey-theme-select)
  // and passed in as state.theme on every sync() call.
  // ════════════════════════════════════════════════════════════════
  const THEMES = {
    road: {
      label: 'Road', avatarFill: '#ff6b5b',
      sky: [[0, '#4e8fd6'], [30, '#7fb8e8'], [58, '#bfe2f5'], [82, '#ffe4ae'], [100, '#ffcf8a']],
      goalGrad: [[0, '#fff2b8'], [55, '#ffcf3f'], [100, '#f5a623']],
      path: { outline: '#d8a862', fill: '#fff6e4', dash: '#f4a53b' },
      decorate: roadDecorate, scatter: roadScatter, buildAvatar: roadBuildAvatar, buildGoal: roadBuildGoal, buildCheckpoint: roadBuildCheckpoint,
    },
    space: {
      label: 'Space', avatarFill: '#ef4444',
      sky: [[0, '#0f0a2e'], [50, '#2a1760'], [100, '#4b2e83']],
      goalGrad: [[0, '#ffe7b0'], [45, '#ffb24a'], [100, '#e8762b']],
      path: { outline: '#3347a8', fill: '#dfe6ff', dash: '#7dd3fc' },
      decorate: spaceDecorate, scatter: spaceScatter, buildAvatar: spaceBuildAvatar, buildGoal: spaceBuildGoal, buildCheckpoint: spaceBuildCheckpoint,
    },
    ocean: {
      label: 'Ocean', avatarFill: '#4caf7d',
      sky: [[0, '#bdeeff'], [45, '#5ec8e0'], [100, '#1b6fa8']],
      goalGrad: [[0, '#fff2b8'], [55, '#ffcf3f'], [100, '#f5a623']],
      path: { outline: '#c9a46a', fill: '#f0e2c0', dash: '#2f9e6e' },
      decorate: oceanDecorate, scatter: oceanScatter, buildAvatar: oceanBuildAvatar, buildGoal: oceanBuildGoal, buildCheckpoint: oceanBuildCheckpoint,
    },
    race: {
      label: 'Race', avatarFill: '#ef4444',
      sky: [[0, '#334155'], [8, '#62a95a'], [100, '#6fb865']],
      goalGrad: [[0, '#fff2b8'], [55, '#ffcf3f'], [100, '#f5a623']],
      path: { outline: '#1f2937', fill: '#6b7280', dash: '#ffffff' },
      decorate: raceDecorate, scatter: raceScatter, buildAvatar: raceBuildAvatar, buildGoal: raceBuildGoal, buildCheckpoint: raceBuildCheckpoint,
    },
  };
  function resolveThemeKey(key) { return THEMES[key] ? key : 'road'; }
  function getTheme(key) { return THEMES[resolveThemeKey(key)]; }

  let containers = new WeakMap(); // container -> { svg, ro, state, paused }

  function build(container, themeKey) {
    const theme = getTheme(themeKey);
    container.innerHTML = '';
    // Match the wrapping panel's own background to this theme's sky so
    // there's no mismatched seam where the SVG letterboxes (its own
    // aspect ratio rarely matches the panel's exactly) — each theme has
    // a very different sky, so this has to be set per-theme, not once.
    if (container.parentElement) {
      container.parentElement.style.background = `linear-gradient(180deg, ${theme.sky.map(([off, color]) => `${color} ${off}%`).join(', ')})`;
    }
    const layout = pickLayout(container);
    const id = ++uid; // scopes this build's <defs> ids so an older SVG's leftovers (if any) never bleed in
    const skyId = `journey-sky-${id}`, shadowId = `journey-shadow-${id}`, goalGradId = `journey-goal-${id}`, glowId = `journey-glow-${id}`;
    const glowLgId = `journey-glowlg-${id}`, vignetteId = `journey-vignette-${id}`;
    const svg = el('svg', { viewBox: `0 0 ${layout.w} ${layout.h}`, preserveAspectRatio: 'xMidYMid meet', width: '100%', height: '100%', style: 'display:block', role: 'img' });

    // An SVG <title> is the standard accessible name for role="img" — a
    // screen reader announces it instead of silently skipping a picture.
    // Kept up to date every sync() with the real numbers (see apply()).
    const title = el('title', {});
    svg.appendChild(title);

    // ── DEFS — this theme's sky gradient, its goal marker's gradient,
    // and one shared drop-shadow filter reused by the avatar/checkpoints/
    // goal so every piece of "game art" sits above the scene with the
    // same light, rather than looking pasted flat.
    const defs = el('defs', {}, [
      (() => {
        const grad = el('linearGradient', { id: skyId, x1: 0, y1: 0, x2: 0, y2: 1 });
        theme.sky.forEach(([off, color]) => grad.appendChild(el('stop', { offset: `${off}%`, 'stop-color': color })));
        return grad;
      })(),
      (() => {
        const grad = el('radialGradient', { id: goalGradId, cx: '35%', cy: '30%', r: '75%' });
        theme.goalGrad.forEach(([off, color]) => grad.appendChild(el('stop', { offset: `${off}%`, 'stop-color': color })));
        return grad;
      })(),
      (() => {
        const filter = el('filter', { id: shadowId, x: '-60%', y: '-60%', width: '220%', height: '220%' });
        filter.appendChild(el('feDropShadow', { dx: 0, dy: 1.6, stdDeviation: 1.4, 'flood-color': '#1f2937', 'flood-opacity': 0.3 }));
        return filter;
      })(),
      (() => {
        // A soft blur for bloom — a bright shape (the sun, the goal's
        // outer glow) read as "lit" rather than "a flat circle" once its
        // edge is softened like this, the same trick real bloom
        // post-processing fakes with a blurred bright-pass layer.
        const filter = el('filter', { id: glowId, x: '-200%', y: '-200%', width: '500%', height: '500%' });
        filter.appendChild(el('feGaussianBlur', { stdDeviation: 6 }));
        return filter;
      })(),
      (() => {
        // A much wider blur for large atmospheric shapes (nebulae, haze,
        // light shafts) where the small bloom blur would still leave a
        // visible edge.
        const filter = el('filter', { id: glowLgId, x: '-100%', y: '-100%', width: '300%', height: '300%' });
        filter.appendChild(el('feGaussianBlur', { stdDeviation: 18 }));
        return filter;
      })(),
      (() => {
        // Cinematic vignette — darkens the corners so the eye settles on
        // the path, the same framing trick most polished games use.
        const grad = el('radialGradient', { id: vignetteId, cx: '50%', cy: '48%', r: '75%' });
        grad.appendChild(el('stop', { offset: '60%', 'stop-color': '#000000', 'stop-opacity': 0 }));
        grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': 0.32 }));
        return grad;
      })(),
    ]);
    svg.appendChild(defs);

    // Backdrop — this theme's sky gradient plus its own small set of
    // decorations. Deliberately just a few touches per theme (see this
    // view's long history of "too busy/cluttered" feedback) — enough to
    // feel like a game world, not a scene to compete with the path itself.
    svg.appendChild(el('rect', { x: 0, y: 0, width: layout.w, height: layout.h, fill: `url(#${skyId})` }));
    theme.decorate(svg, layout, glowId, glowLgId);

    // Scenery props (trees, coral, rocks, tire stacks...) go in their own
    // layer under the path; it's filled in below once the path exists, so
    // every prop can be checked against the path's real geometry and
    // kept clear of it.
    const sceneryLayer = el('g', { class: 'journey-scenery' });
    svg.appendChild(sceneryLayer);

    // The path itself — a soft ground shadow, a colored outline, a
    // lighter fill, a lit highlight along its upper edge, and a dashed
    // centerline, round caps/joins throughout. Colors come from the
    // theme; the shape (and therefore every checkpoint's exact position)
    // is identical across all four themes.
    const d = pathD(layout.points);
    const pathShadow = el('path', { d, fill: 'none', stroke: '#0b1220', 'stroke-width': 44, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.22, transform: 'translate(0,7)', filter: `url(#${glowId})` });
    const pathOutline = el('path', { d, fill: 'none', stroke: theme.path.outline, 'stroke-width': 40, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const pathBase = el('path', { d, fill: 'none', stroke: theme.path.fill, 'stroke-width': 32, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const pathSheen = el('path', { d, fill: 'none', stroke: '#ffffff', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.22, transform: 'translate(0,-5)' });
    const pathLine = el('path', { d, fill: 'none', stroke: theme.path.dash, 'stroke-width': 3.2, 'stroke-dasharray': '11 11', 'stroke-linecap': 'round' });
    svg.appendChild(pathShadow);
    svg.appendChild(pathOutline);
    svg.appendChild(pathBase);
    svg.appendChild(pathSheen);
    svg.appendChild(pathLine);

    // Sample the real path once so scenery can stay a safe distance from
    // it — props are placed by a seeded generator (stable across rebuilds,
    // so trees don't jump around on resize) and dropped if they'd land on
    // or near the road, the goal, or off-canvas.
    if (theme.scatter) {
      const total = pathBase.getTotalLength();
      const samples = [];
      for (let i = 0; i <= 80; i++) samples.push(pathBase.getPointAtLength((i / 80) * total));
      const isClear = (x, y, margin) => {
        if (x < 10 || y < 10 || x > layout.w - 10 || y > layout.h - 6) return false;
        for (const p of samples) { if (Math.hypot(p.x - x, p.y - y) < 24 + margin) return false; }
        const end = samples[samples.length - 1];
        return Math.hypot(end.x - x, end.y - y) > 52 + margin;
      };
      let seed = layout === LAYOUTS.tall ? 7919 : 104729;
      const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      theme.scatter(sceneryLayer, layout, isClear, rand, glowId);
    }

    const flagsLayer = el('g', { class: 'journey-flags' });
    const ghostLayer = el('g', { class: 'journey-ghost' });
    const avatarLayer = el('g', { class: 'journey-avatar-layer' });
    svg.appendChild(flagsLayer);
    svg.appendChild(ghostLayer);

    const goalLen = pathBase.getTotalLength();
    const goalPt = pathBase.getPointAtLength(goalLen);
    svg.appendChild(theme.buildGoal(goalPt.x, goalPt.y, goalGradId, shadowId, glowId));
    svg.appendChild(avatarLayer);
    svg.appendChild(el('rect', { x: 0, y: 0, width: layout.w, height: layout.h, fill: `url(#${vignetteId})`, 'pointer-events': 'none' }));

    container.appendChild(svg);

    const entry = {
      svg, title, roadBase: pathBase, layoutKey: layout === LAYOUTS.tall ? 'tall' : 'wide', themeKey: resolveThemeKey(themeKey),
      flagsLayer, ghostLayer, avatarLayer, shadowId, lastState: null, lastDoneIds: new Set(), lastYouFrac: null, lastSummit: false,
    };
    containers.set(container, entry);
    return entry;
  }

  function pointAtFrac(roadBase, frac) {
    const len = roadBase.getTotalLength();
    return roadBase.getPointAtLength(Math.max(0, Math.min(1, frac)) * len);
  }

  // No lower floor: a fixed minimum size is what caused checkpoints to
  // overlap on large task lists (tested up to 150 tasks without a floor
  // — see the spacing simulation). Letting the scale keep shrinking with
  // n keeps every checkpoint's footprint in step with how much of the
  // path is actually left for it.
  function checkpointScale(n) { return Math.min(1, 10 / Math.max(1, n)); }

  function apply(container, state) {
    const desiredLayout = pickLayout(container) === LAYOUTS.tall ? 'tall' : 'wide';
    const desiredTheme = resolveThemeKey(state.theme);
    let entry = containers.get(container);
    if (!entry || entry.layoutKey !== desiredLayout || entry.themeKey !== desiredTheme) {
      // Rebuilding (a resize across the layout breakpoint, or a theme
      // switch) throws away the old SVG — but carry over which tasks
      // were already celebrated, or the fresh entry's empty lastDoneIds
      // would read every already-done task as "newly done" and replay
      // confetti for all of them at once.
      const prevDoneIds = entry ? entry.lastDoneIds : new Set();
      const prevSummit = entry ? entry.lastSummit : false;
      entry = build(container, desiredTheme);
      entry.lastDoneIds = prevDoneIds;
      entry.lastSummit = prevSummit;
    }
    const theme = getTheme(desiredTheme);
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

    // Checkpoints — one per task, placed at the real path length fraction
    // so they're evenly spaced along the actual curve, not the
    // straight-line waypoints.
    while (flagsLayer.firstChild) flagsLayer.removeChild(flagsLayer.firstChild);
    const n = state.tasks.length;
    const scale = checkpointScale(n);
    const doneCount = state.tasks.filter(t => t.status === 'Completed').length;
    const positions = [];
    // Inset slightly from both ends — a checkpoint placed at exactly
    // frac 0 or 1 lands right under the avatar's starting pose or the
    // goal marker and mostly disappears behind it, which reads as a
    // mistake rather than deliberate layering.
    state.tasks.forEach((t, i) => {
      const frac = n > 1 ? 0.06 + (i / (n - 1)) * 0.88 : 0.5;
      const pt = pointAtFrac(roadBase, frac);
      positions.push(pt);
      const isDone = t.status === 'Completed';
      const isNext = !isDone && i === doneCount;
      const g = theme.buildCheckpoint(i, isDone, isNext, t.latestUpdateIsBlocker, scale, shadowId);
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

    // Ghost (pace/competitor marker) — a faded second avatar, same
    // theme shape as the real one.
    while (ghostLayer.firstChild) ghostLayer.removeChild(ghostLayer.firstChild);
    if (state.ghost) {
      const gp = pointAtFrac(roadBase, state.ghost.frac);
      const g = theme.buildAvatar('#94a3b8');
      g.setAttribute('transform', `translate(${gp.x},${gp.y}) scale(${scale})`);
      g.setAttribute('opacity', '0.55');
      ghostLayer.appendChild(g);
    }

    // Avatar — walks to its new spot; CSS handles the smooth glide (see
    // the .journey-avatar-layer transition in index.html's inline style
    // below), so no animation library is needed for this simple a move.
    if (!avatarLayer.firstChild) avatarLayer.appendChild(theme.buildAvatar(theme.avatarFill, shadowId));
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
