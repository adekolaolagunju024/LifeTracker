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

  // A soft white gloss gradient and a dark core-shadow gradient — both
  // purely tonal (no theme color in them), so unlike the sky/goal
  // gradients they use one fixed id reused by every build rather than a
  // per-build uid suffix. A duplicate id across multiple SVGs in the
  // same document is harmless here since every copy has identical
  // stops. Together they're the cheapest way to make a flat-filled
  // shape read as lit-from-above and rounded instead of a flat cutout.
  const GLOSS_ID = 'journey-gloss', GLOSS = `url(#${GLOSS_ID})`;
  const SHADE_ID = 'journey-shade', SHADE = `url(#${SHADE_ID})`;

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
  function scatterProps(layer, layout, isClear, rand, { count, margin, spacing, minScale = 0.55, minY = 0, sway = false, draw }) {
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
      // Swaying props animate an inner group, never the positioned one —
      // a CSS transform would replace the translate/scale attribute.
      const inner = sway ? el('g', { class: 'journey-sway', style: `animation-delay:${(-p.v * 4).toFixed(2)}s` }) : g;
      if (sway) g.appendChild(inner);
      draw(inner, p.v);
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
      const pos = el('g', { transform: `translate(${layout.w * fx},${layout.h * fy}) scale(${scale})`, opacity: 0.9 });
      const cg = el('g', { class: 'journey-cloud-drift', style: `animation-delay:${(-fx * 20).toFixed(1)}s` });
      pos.appendChild(cg);
      cg.appendChild(el('ellipse', { cx: 1, cy: 8, rx: 26, ry: 6, fill: '#a9c4dc', opacity: 0.55 }));
      [[-14, 0, 11], [0, -4, 14], [15, 0, 10], [0, 5, 13]].forEach(([ex, ey, r]) => cg.appendChild(el('ellipse', { cx: ex, cy: ey, rx: r, ry: r * 0.7, fill: '#ffffff' })));
      cg.appendChild(el('ellipse', { cx: 0, cy: 7, rx: 22, ry: 3.4, fill: '#cfdeec', opacity: 0.8 }));
      svg.appendChild(pos);
    });
  }

  // A small cluster of shimmering sparkle accents — shared by every
  // theme's goal marker, each on its own delay so they twinkle
  // independently rather than in lockstep. Each sparkle's position
  // lives on an un-animated outer <g>; the CSS animation (see index.
  // html's .journey-sparkle) targets the inner shape, which carries no
  // transform attribute of its own — keeping a position set via
  // attribute and a transform animated via CSS on the same element
  // would have the CSS one silently win and the sparkle jump to the
  // origin for the animation's duration.
  function sparkles(positions) {
    const g = el('g', { class: 'journey-sparkles' });
    positions.forEach(([sx, sy, r], i) => {
      const outer = el('g', { transform: `translate(${sx},${sy})` });
      outer.appendChild(el('path', {
        d: starPath(r, r * 0.35, 4), fill: '#ffffff', opacity: 0.85,
        class: 'journey-sparkle', style: `animation-delay:${(i * 0.35).toFixed(2)}s`,
      }));
      g.appendChild(outer);
    });
    return g;
  }

  // One limb of an avatar's rig — each leg/arm is its own group
  // (journey-leg-front/back, journey-arm-front/back in index.html) that
  // swings from its own shoulder/hip pivot via CSS, giving the avatar a
  // real running gait. The outer .journey-avatar-bob group carries the
  // vertical bob and the shared drop-shadow filter.
  function avatarLimb(cls, fill, x, y, w, len, footRx, footRy, footFill) {
    const wrap = el('g', { transform: `translate(${x},${y})` });
    const swing = el('g', { class: cls });
    swing.appendChild(el('rect', { x: -w / 2, y: 0, width: w, height: len, rx: w / 2 - 0.1, fill, stroke: '#1f2937', 'stroke-width': 0.8 }));
    swing.appendChild(el('rect', { x: -w / 2, y: 0, width: w / 2.2, height: len, rx: w / 2 - 0.1, fill: '#ffffff', opacity: 0.18 }));
    swing.appendChild(el('ellipse', { cx: 0, cy: len + footRy - 0.6, rx: footRx, ry: footRy, fill: footFill, stroke: '#1f2937', 'stroke-width': 0.6 }));
    wrap.appendChild(swing);
    return wrap;
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
    // Each leg + its boot sole travel together as one group, so the CSS
    // walk-cycle rotation (see index.html) swings the whole leg unit
    // from the hip instead of just the upper leg sliding away from a
    // fixed boot.
    const legL = el('g', { class: 'journey-leg journey-leg-l' });
    legL.appendChild(el('rect', { x: -6.6, y: 8, width: 5, height: 11, rx: 2.2, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1 }));
    legL.appendChild(el('rect', { x: -7.4, y: 16.5, width: 6.6, height: 3.4, rx: 1.4, fill: '#374151' }));
    bob.appendChild(legL);
    const legR = el('g', { class: 'journey-leg journey-leg-r' });
    legR.appendChild(el('rect', { x: 1.6, y: 8, width: 5, height: 11, rx: 2.2, fill: '#dde4ee', stroke: '#1f2937', 'stroke-width': 1 }));
    legR.appendChild(el('rect', { x: 0.8, y: 16.5, width: 6.6, height: 3.4, rx: 1.4, fill: '#374151' }));
    bob.appendChild(legR);
    bob.appendChild(el('ellipse', { cx: -9.8, cy: 1, rx: 3.6, ry: 5.6, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(18 -9.8 1)' }));
    bob.appendChild(el('ellipse', { cx: 9.8, cy: 1, rx: 3.6, ry: 5.6, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1, transform: 'rotate(-18 9.8 1)' }));
    bob.appendChild(el('rect', { x: -9.4, y: -7.5, width: 18.8, height: 18.5, rx: 7, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1.2 }));
    bob.appendChild(el('ellipse', { cx: -2, cy: -4.5, rx: 6.5, ry: 3.6, fill: GLOSS }));
    bob.appendChild(el('ellipse', { cx: 2, cy: 6, rx: 7, ry: 4.2, fill: SHADE }));
    bob.appendChild(el('rect', { x: -4.5, y: -2, width: 9, height: 5, rx: 1.6, fill }));
    // A collar ring where the helmet seals to the suit — the kind of
    // functional detail a real spacesuit actually has.
    bob.appendChild(el('ellipse', { cx: 0, cy: -8.5, rx: 6.6, ry: 2.4, fill: '#c7cedb', stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('circle', { cx: 0, cy: -15.5, r: 9.2, fill: '#eef2f7', stroke: '#1f2937', 'stroke-width': 1.2 }));
    bob.appendChild(el('circle', { cx: 0.6, cy: -15, r: 6.6, fill: '#1b2a5e' }));
    bob.appendChild(el('path', { d: 'M -4.4 -18.4 Q 0 -20.6 4.2 -18', fill: 'none', stroke: '#9fd8ff', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.8 }));
    bob.appendChild(el('ellipse', { cx: 1.5, cy: -8.5, rx: 6.5, ry: 2.2, fill: SHADE }));
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
    g.appendChild(el('ellipse', { cx: 4, cy: 7, rx: 6, ry: 3.6, fill: SHADE }));
    g.appendChild(sparkles([[-21, -17, 2.4], [20, -12, 1.7], [15, 17, 2]]));
    // Shown once every task is done (see .journey-quest-done): the mission
    // flag planted on top of the planet.
    const flagPos = el('g', { transform: 'translate(2,-14)' });
    const planted = el('g', { class: 'journey-planted-flag' });
    planted.appendChild(el('rect', { x: -0.7, y: -20, width: 1.4, height: 20, fill: '#e5e7eb', stroke: '#6b7280', 'stroke-width': 0.4 }));
    planted.appendChild(el('path', { d: 'M 0.7 -20 L 15 -16.5 L 0.7 -13 Z', fill: '#0d9488', stroke: '#064e3b', 'stroke-width': 0.6 }));
    planted.appendChild(el('path', { d: starPath(2.2, 0.9, 5), transform: 'translate(5,-16.5)', fill: '#fbbf24' }));
    flagPos.appendChild(planted);
    g.appendChild(flagPos);
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
    g.appendChild(el('path', { d: `M ${-3.2 * s} ${-29 * s} L ${-1 * s} ${-26.4 * s}`, fill: 'none', stroke: GLOSS, 'stroke-width': 1.4 * s, 'stroke-linecap': 'round', opacity: 0.8 }));
    const label = el('text', {
      x: 0, y: -25.6 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 6.6 * s, 'font-weight': 800, fill: '#1f2937', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    g.appendChild(label);
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 2.6 * s, fill: '#9aa5b1', stroke: '#4b5563', 'stroke-width': 0.6 * s }));
    if (blocked) g.appendChild(drawFoes(blocked, s, SPACE_FOES));
    return g;
  }

  // ════════════════════════════════════════════════════════════════
  // THEME: FOOTBALL — "Road to the Final". A floodlit, striped pitch with
  // real markings, a footballer dribbling up the pitch, corner-flag
  // checkpoints, a defensive wall for blockers, and the goal net.
  // ════════════════════════════════════════════════════════════════
  function footballDecorate(svg, layout, glowId, glowLgId) {
    const { w, h } = layout;
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      svg.appendChild(el('rect', { x: 0, y: (i / bands) * h, width: w, height: h / bands + 1, fill: i % 2 === 0 ? '#4caf50' : '#43a047' }));
    }

    // Pitch markings — touchline, halfway line, centre circle and spot,
    // and a penalty area + six-yard box + penalty arc at each end, the top
    // one centred on the goal and the bottom one on the kick-off point.
    const line = { fill: 'none', stroke: '#ffffff', 'stroke-width': 2, opacity: 0.7 };
    const inset = 14;
    svg.appendChild(el('rect', { x: inset, y: inset + h * 0.06, width: w - inset * 2, height: h - inset * 2 - h * 0.06, ...line }));
    svg.appendChild(el('line', { x1: inset, y1: h * 0.53, x2: w - inset, y2: h * 0.53, ...line }));
    const cr = Math.min(w, h) * 0.11;
    svg.appendChild(el('circle', { cx: w / 2, cy: h * 0.53, r: cr, ...line }));
    svg.appendChild(el('circle', { cx: w / 2, cy: h * 0.53, r: 2.4, fill: '#ffffff', opacity: 0.75 }));
    const goalPt = layout.points[layout.points.length - 1], startPt = layout.points[0];
    const boxW = Math.min(w * 0.42, 220), boxH = h * 0.14, sixW = boxW * 0.45, sixH = boxH * 0.4;
    const topY = inset + h * 0.06, botY = h - inset;
    const clampX = x => Math.max(inset + boxW / 2, Math.min(w - inset - boxW / 2, x));
    const gx = clampX(goalPt.x), sx = clampX(startPt.x);
    svg.appendChild(el('rect', { x: gx - boxW / 2, y: topY, width: boxW, height: boxH, ...line }));
    svg.appendChild(el('rect', { x: gx - sixW / 2, y: topY, width: sixW, height: sixH, ...line }));
    svg.appendChild(el('path', { d: `M ${gx - boxW * 0.2} ${topY + boxH} A ${boxW * 0.22} ${boxW * 0.22} 0 0 0 ${gx + boxW * 0.2} ${topY + boxH}`, ...line }));
    svg.appendChild(el('rect', { x: sx - boxW / 2, y: botY - boxH, width: boxW, height: boxH, ...line }));
    svg.appendChild(el('rect', { x: sx - sixW / 2, y: botY - sixH, width: sixW, height: sixH, ...line }));

    // Floodlights at the two top corners — a pylon, a lamp bank, and a
    // big blurred spill of light onto the pitch.
    [[0.06, 1], [0.94, -1]].forEach(([fx, dir]) => {
      const x = w * fx, y = h * 0.1;
      svg.appendChild(el('ellipse', { cx: x + dir * w * 0.12, cy: h * 0.28, rx: w * 0.16, ry: h * 0.2, fill: '#fffbe0', opacity: 0.16, filter: glowLgId ? `url(#${glowLgId})` : undefined }));
      svg.appendChild(el('rect', { x: x - 1.5, y, width: 3, height: h * 0.1, fill: '#9aa5b1' }));
      svg.appendChild(el('rect', { x: x - 10, y: y - 6, width: 20, height: 9, rx: 1.5, fill: '#334155', stroke: '#1f2937', 'stroke-width': 0.6 }));
      for (let i = 0; i < 4; i++) svg.appendChild(el('circle', { cx: x - 7 + i * 4.6, cy: y - 1.6, r: 1.6, fill: '#fffbe0' }));
      svg.appendChild(el('circle', { cx: x, cy: y - 2, r: 14, fill: '#fff7c2', opacity: 0.5, filter: glowId ? `url(#${glowId})` : undefined }));
    });

    // The crowd in the stand along the top — home and away colours,
    // each fan bobbing on its own beat.
    svg.appendChild(el('rect', { x: 0, y: 0, width: w, height: h * 0.06, fill: '#1e293b' }));
    const kit = ['#e53935', '#ffffff', '#1e88e5', '#fdd835', '#e53935'];
    const fans = Math.round(w / 22);
    for (let i = 0; i < fans; i++) {
      svg.appendChild(el('circle', {
        class: 'journey-crowd-bob', cx: (i + 0.5) * (w / fans), cy: h * 0.03 + (i % 2 ? 2 : -2), r: 3.2,
        fill: kit[i % kit.length], style: `animation-delay:${((i % 9) * 0.13).toFixed(2)}s`,
      }));
    }

    // Corner flags at the four pitch corners.
    [[inset, topY], [w - inset, topY], [inset, botY], [w - inset, botY]].forEach(([x, y]) => {
      const pole = el('g', { transform: `translate(${x},${y})` });
      pole.appendChild(el('rect', { x: -0.8, y: -14, width: 1.6, height: 14, fill: '#f8fafc' }));
      const pos = el('g', { transform: 'translate(0.8,-14)' });
      const flag = el('g', { class: 'journey-flag-wave' });
      flag.appendChild(el('path', { d: 'M 0 0 L 9 2.5 L 0 5 Z', fill: '#fdd835', stroke: '#b45309', 'stroke-width': 0.4 }));
      pos.appendChild(flag);
      pole.appendChild(pos);
      svg.appendChild(pole);
    });
  }

  // Pitch scenery — a few spare training balls and cones on the grass.
  function footballScatter(layer, layout, isClear, rand) {
    scatterProps(layer, layout, isClear, rand, {
      count: 6, margin: 10, spacing: 60, minY: layout.h * 0.12,
      draw(g, v) {
        g.appendChild(el('ellipse', { cx: 2, cy: 1, rx: 6, ry: 2, fill: '#0b1220', opacity: 0.25 }));
        if (v < 0.5) {
          footballBall(g, 0, -4, 4.5);
        } else {
          g.appendChild(el('path', { d: 'M -5 0 L -1.6 -9 L 1.6 -9 L 5 0 Z', fill: '#ff9800', stroke: '#9a3412', 'stroke-width': 0.5 }));
          g.appendChild(el('rect', { x: -2.4, y: -6, width: 4.8, height: 1.6, fill: '#ffffff', opacity: 0.85 }));
        }
      },
    });
  }

  // A football — white with dark panels and a highlight, so it reads
  // as a ball rather than a white dot even at small sizes.
  function footballBall(g, cx, cy, r) {
    g.appendChild(el('circle', { cx, cy, r, fill: '#ffffff', stroke: '#1f2937', 'stroke-width': r * 0.12 }));
    g.appendChild(el('path', { d: starPath(r * 0.42, r * 0.3, 5), transform: `translate(${cx},${cy})`, fill: '#1f2937' }));
    [[-0.72, -0.5], [0.72, -0.5], [0.5, 0.75], [-0.5, 0.75]].forEach(([dx, dy]) => {
      g.appendChild(el('circle', { cx: cx + dx * r, cy: cy + dy * r, r: r * 0.18, fill: '#1f2937' }));
    });
    g.appendChild(el('ellipse', { cx: cx - r * 0.35, cy: cy - r * 0.4, rx: r * 0.35, ry: r * 0.22, fill: '#ffffff', opacity: 0.8 }));
  }

  // A footballer in kit — same limb rig as the Road runner (arms/legs
  // swing from their own pivots), with the passed-in "fill" as the shirt
  // colour, white socks, boots, shorts, a shirt number, and a ball at
  // their feet that spins as they dribble.
  function footballBuildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 2, cy: 24, rx: 17, ry: 3.6, fill: '#0b1220', opacity: 0.28 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });

    bob.appendChild(avatarLimb('journey-leg-back', '#f1f5f9', -3.4, 9, 4.2, 10, 3.2, 1.8, '#111827'));
    bob.appendChild(avatarLimb('journey-arm-back', fill, -7.4, -4, 3.8, 8.6, 2, 2, '#ffd9ae'));

    bob.appendChild(el('rect', { x: -8.6, y: -9, width: 17.2, height: 15, rx: 6.5, fill, stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('rect', { x: -8.2, y: 3, width: 16.4, height: 7.5, rx: 2.5, fill: '#1f2937' }));
    bob.appendChild(el('ellipse', { cx: -3.6, cy: -4, rx: 4.2, ry: 5, fill: '#ffffff', opacity: 0.2 }));
    bob.appendChild(el('path', { d: 'M -3 -9 L 0 -5.5 L 3 -9', fill: 'none', stroke: '#ffffff', 'stroke-width': 1.1, opacity: 0.85 }));
    const num = el('text', { class: 'journey-unflip', x: 0, y: -0.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 6.5, 'font-weight': 800, fill: '#ffffff', 'font-family': 'Arial, sans-serif' });
    num.textContent = '10';
    bob.appendChild(num);

    bob.appendChild(avatarLimb('journey-leg-front', '#f8fafc', 3.4, 9, 4.2, 10, 3.2, 1.8, '#111827'));
    bob.appendChild(avatarLimb('journey-arm-front', fill, 7.4, -4, 3.8, 8.6, 2, 2, '#ffd9ae'));

    const head = el('g', { transform: 'translate(0,-17.5)' });
    head.appendChild(el('circle', { cx: 0, cy: 0, r: 8.6, fill: '#ffd9ae', stroke: '#1f2937', 'stroke-width': 1 }));
    head.appendChild(el('path', { d: 'M -8.6 -2 Q -9 -10 0 -10 Q 9 -10 8.6 -2 Q 6 -6 0 -6.5 Q -6 -6 -8.6 -2 Z', fill: '#2b1a10' }));
    head.appendChild(el('ellipse', { cx: -3, cy: -2.6, rx: 3.6, ry: 2.2, fill: '#ffffff', opacity: 0.25 }));
    [[-3, 0.5], [3, 0.5]].forEach(([ex, ey]) => {
      head.appendChild(el('ellipse', { cx: ex, cy: ey, rx: 1.7, ry: 2.1, fill: '#ffffff' }));
      head.appendChild(el('circle', { cx: ex + 0.3, cy: ey + 0.4, r: 1.1, fill: '#1f2937' }));
    });
    head.appendChild(el('path', { d: 'M -2.4 4.2 Q 0 6 2.4 4.2', fill: 'none', stroke: '#1f2937', 'stroke-width': 1, 'stroke-linecap': 'round' }));
    bob.appendChild(head);
    g.appendChild(bob);

    const ballPos = el('g', { class: 'journey-feet-ball', transform: 'translate(10,19.5)' });
    const ball = el('g', { class: 'journey-ball-dribble' });
    footballBall(ball, 0, 0, 4.2);
    ballPos.appendChild(ball);
    g.appendChild(ballPos);
    return g;
  }

  // The goal — posts and crossbar, a meshed net drawn with depth (the
  // back frame sits higher, i.e. farther away), a ball tucked in the net,
  // and the net gently rippling.
  function footballBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const g = el('g', { transform: `translate(${x},${y})` });
    g.appendChild(el('circle', { cx: 0, cy: -6, r: 34, fill: '#fff7c2', opacity: 0.3, filter: glowId ? `url(#${glowId})` : undefined }));
    g.appendChild(el('ellipse', { cx: 0, cy: 5, rx: 28, ry: 4, fill: '#0b1220', opacity: 0.22 }));
    const net = el('g', { class: 'journey-net-ripple' });
    net.appendChild(el('path', { d: 'M -24 4 L -24 -20 L -18 -28 L 18 -28 L 24 -20 L 24 4 Z', fill: '#ffffff', opacity: 0.18 }));
    for (let i = -20; i <= 20; i += 4) net.appendChild(el('line', { x1: i, y1: 4, x2: i * 0.75, y2: -28, stroke: '#ffffff', 'stroke-width': 0.5, opacity: 0.6 }));
    for (let j = 0; j <= 7; j++) {
      const yy = 4 - j * 4.6, k = 1 - (j / 7) * 0.25;
      net.appendChild(el('line', { x1: -24 * k, y1: yy, x2: 24 * k, y2: yy, stroke: '#ffffff', 'stroke-width': 0.5, opacity: 0.55 }));
    }
    g.appendChild(net);
    // Hidden until the goal is actually scored (see footballCelebrateFinish).
    const netBall = el('g', { class: 'journey-goal-ball', style: 'display:none' });
    footballBall(netBall, 6, -6, 4.4);
    g.appendChild(netBall);
    const frame = el('g', { filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    frame.appendChild(el('path', { d: 'M -24 4 L -24 -20 L 24 -20 L 24 4', fill: 'none', stroke: '#cbd5e1', 'stroke-width': 3.6, 'stroke-linejoin': 'round', transform: 'translate(0.8,0.8)' }));
    frame.appendChild(el('path', { d: 'M -24 4 L -24 -20 L 24 -20 L 24 4', fill: 'none', stroke: '#ffffff', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
    frame.appendChild(el('path', { d: 'M -24 -20 L -18 -28 L 18 -28 L 24 -20', fill: 'none', stroke: '#e2e8f0', 'stroke-width': 1.4 }));
    g.appendChild(frame);
    [[-30, -26, 2.4], [30, -18, 1.8], [26, 10, 2]].forEach(([sx, sy, r], i) => {
      g.appendChild(el('path', { class: `journey-sparkle d${i}`, d: starPath(r, r * 0.35, 4), transform: `translate(${sx},${sy})`, fill: '#ffffff', opacity: 0.9 }));
    });
    return g;
  }

  // A checkpoint — a red/white striped corner-flag post with a
  // status-coloured flag; a blocked one gets a defensive wall in front
  // of it to get past, with a warning glow.
  function footballBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 5 * s, cy: -20 * s, r: 15 * s, fill: NEXT_COLOR, opacity: 0.5 }));
    g.appendChild(el('ellipse', { cx: 2 * s, cy: 0.5 * s, rx: 6 * s, ry: 1.8 * s, fill: '#0b1220', opacity: 0.25 }));
    for (let k = 0; k < 5; k++) {
      g.appendChild(el('rect', { x: -1.1 * s, y: (-27 + k * 5.4) * s, width: 2.2 * s, height: 5.4 * s, fill: k % 2 ? '#ffffff' : '#e53935' }));
    }
    const pos = el('g', { transform: `translate(${1.1 * s},${-27 * s})` });
    const flag = el('g', { class: 'journey-flag-wave' });
    flag.appendChild(el('path', {
      d: `M 0 0 L ${14 * s} ${4.2 * s} L 0 ${8.4 * s} Z`, fill: color, stroke: '#1f2937', 'stroke-width': 0.6 * s, 'stroke-linejoin': 'round',
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    }));
    const label = el('text', {
      x: 4.6 * s, y: 4.4 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 6.4 * s, 'font-weight': 800, fill: '#1f2937', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    flag.appendChild(label);
    pos.appendChild(flag);
    g.appendChild(pos);
    if (blocked) g.appendChild(drawFoes(blocked, s, FOOTBALL_FOES));
    return g;
  }

  // The football finish: the player, standing at the last flag, kicks the
  // ball — it arcs (and spins) into the goal, the net bulges, a "GOAL!"
  // banner pops, the crowd jumps up, and the usual confetti follows.
  function footballCelebrateFinish(entry, from, scale, burst) {
    const { svg, avatarLayer, goalPt } = entry;
    const av = avatarLayer.firstChild;
    if (av) av.classList.add('journey-kick');
    setTimeout(() => {
      if (!svg.isConnected) return;
      if (av) av.classList.remove('journey-kick');
      const feet = avatarLayer.querySelector('.journey-feet-ball');
      if (feet) feet.style.display = 'none';
      const dir = entry.facing || 1;
      const sx = from.x + 10 * scale * dir, sy = from.y + 19.5 * scale;
      const ex = goalPt.x + 6, ey = goalPt.y - 6;
      const cx = (sx + ex) / 2, cy = Math.min(sy, ey) - 45;
      const ball = el('g');
      footballBall(ball, 0, 0, 4.4);
      svg.insertBefore(ball, entry.vignette);
      const t0 = performance.now(), dur = 650;
      const step = now => {
        if (!svg.isConnected) return;
        const t = Math.min(1, (now - t0) / dur);
        const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex;
        const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ey;
        const k = scale + (1 - scale) * t;
        ball.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${Math.round(t * 720)}) scale(${k.toFixed(3)})`);
        if (t < 1) { requestAnimationFrame(step); return; }
        ball.remove();
        entry.shotPending = false;
        const netBall = svg.querySelector('.journey-goal-ball');
        if (netBall) netBall.style.display = '';
        const net = svg.querySelector('.journey-net-ripple');
        if (net) { net.classList.add('journey-net-bulge'); setTimeout(() => net.classList.remove('journey-net-bulge'), 900); }
        // Above the goal unless that would land in the stand, then below.
        const ty = goalPt.y > 90 ? goalPt.y - 46 : goalPt.y + 44;
        const txt = el('text', {
          class: 'journey-goal-pop', x: goalPt.x, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': 28, 'font-weight': 900, 'font-family': '"Arial Black", Arial, sans-serif',
          fill: '#ffffff', stroke: '#c62828', 'stroke-width': 2.4, 'paint-order': 'stroke', 'letter-spacing': 1,
        });
        txt.textContent = 'GOAL!';
        svg.insertBefore(txt, entry.vignette);
        setTimeout(() => txt.remove(), 2700);
        svg.classList.add('journey-cheer');
        setTimeout(() => svg.classList.remove('journey-cheer'), 3200);
        burst();
      };
      requestAnimationFrame(step);
    }, 280);
  }

  // Pops a big title over the goal and sets off a few firework bursts —
  // shared by the Ocean and Space finishes.
  function finishFlourish(entry, text, fill, edge, colors) {
    const { svg, goalPt } = entry;
    const ty = goalPt.y > 90 ? goalPt.y - 60 : goalPt.y + 56;
    const txt = el('text', {
      class: 'journey-goal-pop', x: goalPt.x, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 24, 'font-weight': 900, 'font-family': '"Arial Black", Arial, sans-serif',
      fill, stroke: edge, 'stroke-width': 2.4, 'paint-order': 'stroke', 'letter-spacing': 1,
    });
    txt.textContent = text;
    svg.insertBefore(txt, entry.vignette);
    setTimeout(() => txt.remove(), 2700);
    [[-34, -40], [32, -48], [0, -60]].forEach(([fx, fy], k) => {
      const pos = el('g', { transform: `translate(${goalPt.x + fx},${Math.max(14, goalPt.y + fy)})` });
      const fw = el('g', { class: 'journey-firework', style: `animation-delay:${k * 0.35}s` });
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        fw.appendChild(el('line', { x1: Math.cos(ang) * 3, y1: Math.sin(ang) * 3, x2: Math.cos(ang) * 12, y2: Math.sin(ang) * 12, stroke: colors[k % colors.length], 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
      }
      pos.appendChild(fw);
      svg.insertBefore(pos, entry.vignette);
      setTimeout(() => pos.remove(), 2400);
    });
  }

  // The space finish: the astronaut plants the mission flag on the planet.
  function spaceCelebrateFinish(entry, from, scale, burst) {
    entry.shotPending = false;
    entry.svg.classList.add('journey-quest-done');
    const flag = entry.svg.querySelector('.journey-planted-flag');
    if (flag) { flag.classList.remove('journey-flag-rise'); flag.getBBox(); flag.classList.add('journey-flag-rise'); }
    finishFlourish(entry, 'MISSION COMPLETE!', '#bfe9ff', '#1b2a6b', ['#fde68a', '#a5f3fc', '#f0abfc']);
    burst();
  }

  // A small padlock — shared "this is blocked" marker on every theme's
  // obstacle so the meaning stays consistent across stages.
  function lockIcon(x, y, s) {
    const lock = el('g', { transform: `translate(${x},${y})` });
    lock.appendChild(el('rect', { x: -5 * s, y: -1 * s, width: 10 * s, height: 8 * s, rx: 1.8 * s, fill: '#f4b400', stroke: '#7c5700', 'stroke-width': 0.9 * s }));
    lock.appendChild(el('path', { d: `M ${-2.6 * s} ${-1 * s} L ${-2.6 * s} ${-4.4 * s} A ${2.6 * s} ${2.6 * s} 0 0 1 ${2.6 * s} ${-4.4 * s} L ${2.6 * s} ${-1 * s}`, fill: 'none', stroke: '#7c5700', 'stroke-width': 1.3 * s }));
    return lock;
  }

  // ════════════════════════════════════════════════════════════════
  // THEME: CASTLE — "Knight's Quest". A knight marches a cobbled road
  // through a golden-hour valley to a castle; giant frogs squat on the
  // road at blocked tasks, and a dragon guards the gate where the
  // princess waits. The last task slays the dragon and opens the gate.
  // ════════════════════════════════════════════════════════════════
  function castleDecorate(svg, layout, glowId, glowLgId) {
    const { w, h } = layout;
    const sunX = w * 0.84, sunY = h * 0.13;
    svg.appendChild(el('circle', { cx: sunX, cy: sunY, r: w * 0.14, fill: '#ffcf87', opacity: 0.45, filter: glowLgId ? `url(#${glowLgId})` : undefined }));
    svg.appendChild(el('circle', { cx: sunX, cy: sunY, r: w * 0.045, fill: '#ffe7b0' }));
    // Far mountains, hazy violet with snow caps.
    const peaks = [[0, 0.24], [0.1, 0.12], [0.2, 0.2], [0.32, 0.08], [0.45, 0.19], [0.58, 0.1], [0.7, 0.2], [0.82, 0.11], [0.93, 0.19], [1, 0.15]];
    svg.appendChild(el('path', { d: `M 0 ${h * 0.3} ` + peaks.map(([fx, fy]) => `L ${w * fx} ${h * fy}`).join(' ') + ` L ${w} ${h * 0.3} Z`, fill: '#9d92bd', opacity: 0.6 }));
    peaks.forEach(([fx, fy], i) => {
      if (i === 0 || i === peaks.length - 1 || fy > 0.15) return;
      const x = w * fx, y = h * fy;
      svg.appendChild(el('path', { d: `M ${x} ${y} L ${x + 14} ${y + 12} L ${x + 5} ${y + 9} L ${x} ${y + 13} L ${x - 6} ${y + 9} L ${x - 14} ${y + 12} Z`, fill: '#f6f2ff', opacity: 0.85 }));
    });
    cloudGroup(svg, layout, [[0.14, 0.08, 0.9], [0.5, 0.05, 0.7]]);
    // Rolling meadow: a far hill band, then the valley floor.
    svg.appendChild(el('path', { d: `M 0 ${h * 0.26} Q ${w * 0.22} ${h * 0.19} ${w * 0.48} ${h * 0.24} T ${w} ${h * 0.21} L ${w} ${h} L 0 ${h} Z`, fill: '#86b552' }));
    svg.appendChild(el('path', { d: `M 0 ${h * 0.4} Q ${w * 0.3} ${h * 0.33} ${w * 0.6} ${h * 0.39} T ${w} ${h * 0.36} L ${w} ${h} L 0 ${h} Z`, fill: '#6fa847' }));
    svg.appendChild(el('path', { d: `M 0 ${h * 0.62} Q ${w * 0.35} ${h * 0.55} ${w * 0.7} ${h * 0.61} T ${w} ${h * 0.58} L ${w} ${h} L 0 ${h} Z`, fill: '#5f9a3d' }));
    // A river winding across the valley; the road crosses it on its way up.
    const ry = [h * 0.66, h * 0.52, h * 0.58, h * 0.46];
    const river = `M ${-20} ${ry[0]} C ${w * 0.3} ${ry[1]} ${w * 0.6} ${ry[2]} ${w + 20} ${ry[3]}`;
    svg.appendChild(el('path', { d: river, fill: 'none', stroke: '#c8b27a', 'stroke-width': 34, 'stroke-linecap': 'round', opacity: 0.85 }));
    svg.appendChild(el('path', { d: river, fill: 'none', stroke: '#3f86b6', 'stroke-width': 24, 'stroke-linecap': 'round' }));
    svg.appendChild(el('path', { class: 'journey-river-flow', d: river, fill: 'none', stroke: '#a9dcf3', 'stroke-width': 2.4, 'stroke-dasharray': '10 26', 'stroke-linecap': 'round', opacity: 0.8 }));
    [[0.3, 0.07, 1, 0], [0.34, 0.1, 0.8, 1.3], [0.27, 0.11, 0.7, 2.4]].forEach(([fx, fy, s, delay]) => {
      const pos = el('g', { transform: `translate(${w * fx},${h * fy}) scale(${s})` });
      const b = el('g', { class: 'journey-bird', style: `animation-delay:${delay}s` });
      b.appendChild(el('path', { d: 'M -6 0 Q -3 -3 0 0 Q 3 -3 6 0', fill: 'none', stroke: '#3a3550', 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
      pos.appendChild(b);
      svg.appendChild(pos);
    });
  }

  // A forest of pines and round oaks, with wildflowers by the road.
  function castleScatter(layer, layout, isClear, rand) {
    scatterProps(layer, layout, isClear, rand, {
      count: 14, margin: 20, spacing: 40, minY: layout.h * 0.3, sway: true,
      draw(g, v) {
        g.appendChild(el('ellipse', { cx: 6, cy: 1, rx: 15, ry: 4, fill: '#0b1220', opacity: 0.2 }));
        g.appendChild(el('rect', { x: -2.2, y: -14, width: 4.4, height: 15, rx: 1.2, fill: '#6b4a2e' }));
        if (v < 0.6) {
          [[-36, 10], [-27, 13], [-18, 16]].forEach(([ty, hw]) => {
            g.appendChild(el('path', { d: `M 0 ${ty - 13} L ${hw} ${ty + 4} L ${-hw} ${ty + 4} Z`, fill: '#2f6b3a' }));
            g.appendChild(el('path', { d: `M 0 ${ty - 13} L ${hw} ${ty + 4} L 0 ${ty + 4} Z`, fill: '#24552e' }));
          });
        } else {
          g.appendChild(el('circle', { cx: -7, cy: -19, r: 9, fill: '#4f8a36' }));
          g.appendChild(el('circle', { cx: 7, cy: -19, r: 9, fill: '#457a2f' }));
          g.appendChild(el('circle', { cx: 0, cy: -27, r: 12, fill: '#6aa548' }));
          g.appendChild(el('circle', { cx: -4, cy: -31, r: 5, fill: '#8fbf55', opacity: 0.85 }));
        }
      },
    });
    const petal = ['#ffffff', '#ffe066', '#ff8fb1', '#b59bff'];
    scatterProps(layer, layout, isClear, rand, {
      count: 14, margin: 4, spacing: 20, minY: layout.h * 0.4,
      draw(g, v) {
        const c = petal[Math.floor(v * petal.length)];
        [[-2.2, 0], [2.2, 0], [0, -2.2], [0, 2.2]].forEach(([px, py]) => g.appendChild(el('circle', { cx: px, cy: py - 3, r: 1.6, fill: c })));
        g.appendChild(el('circle', { cx: 0, cy: -3, r: 1.1, fill: '#f59e0b' }));
      },
    });
    scatterProps(layer, layout, isClear, rand, {
      count: 16, margin: 4, spacing: 18, minY: layout.h * 0.42, sway: true,
      draw(g) { grassTuft(g, '#4e8a35'); },
    });
  }

  // The knight — the same limb rig as the Road runner, in steel armour
  // with a plumed helmet, a tabard and cape in the passed-in colour, a
  // shield on the back arm and a sword in the front hand (so the sword
  // swings with the arm, and the finishing slash is the arm's own swing).
  function castleBuildAvatar(fill, shadowFilterId) {
    const steel = '#b8c2cf', steelDark = '#7d8796';
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 1, cy: 24, rx: 16, ry: 3.6, fill: '#1f2937', opacity: 0.28 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    bob.appendChild(el('path', {
      class: 'journey-cape', d: 'M -5,-9 C -18,-5 -20,10 -11,17 C -15,9 -12,-3 -5,-7 Z',
      fill, stroke: '#4a0f14', 'stroke-width': 0.8, opacity: 0.95,
    }));
    bob.appendChild(avatarLimb('journey-leg-back', steelDark, -3.4, 9, 4.4, 10, 3.2, 1.9, '#4b5563'));
    const armBack = avatarLimb('journey-arm-back', steel, -7.6, -4, 4, 8.6, 2.2, 2.2, steelDark);
    // heater shield, red and gold
    armBack.firstChild.appendChild(el('path', { d: 'M -6 3 L 4 3 L 4 10 Q 4 16 -1 19 Q -6 16 -6 10 Z', fill: '#b3202c', stroke: '#5a1016', 'stroke-width': 0.9 }));
    armBack.firstChild.appendChild(el('path', { d: 'M -1 3.5 L -1 18.4 M -5.6 9 L 3.6 9', stroke: '#e7b443', 'stroke-width': 1.4 }));
    bob.appendChild(armBack);
    bob.appendChild(el('rect', { x: -8.6, y: -9, width: 17.2, height: 19, rx: 6.5, fill: steel, stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('path', { d: 'M -6 -8 L 6 -8 L 5 9 L -5 9 Z', fill }));
    bob.appendChild(el('path', { d: 'M -2.4 -5 L 2.4 -5 M 0 -7.4 L 0 -2.6', stroke: '#e7b443', 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
    bob.appendChild(el('rect', { x: -8.4, y: 3.2, width: 16.8, height: 2.4, fill: '#6b4a2e' }));
    bob.appendChild(el('ellipse', { cx: -3.6, cy: -4, rx: 3.6, ry: 5.6, fill: '#ffffff', opacity: 0.2 }));
    bob.appendChild(avatarLimb('journey-leg-front', steel, 3.4, 9, 4.4, 10, 3.2, 1.9, '#4b5563'));
    const armFront = avatarLimb('journey-arm-front', steel, 7.6, -4, 4, 8.6, 2.2, 2.2, steelDark);
    const sword = el('g', { transform: 'translate(0,9.4) rotate(-150)' });
    sword.appendChild(el('rect', { x: -0.9, y: -3.6, width: 1.8, height: 4.6, rx: 0.6, fill: '#6b4a2e' }));
    sword.appendChild(el('rect', { x: -3.6, y: 0.6, width: 7.2, height: 1.6, rx: 0.6, fill: '#e7b443', stroke: '#8a5a12', 'stroke-width': 0.4 }));
    sword.appendChild(el('path', { d: 'M -1.2 2.2 L 1.2 2.2 L 1.2 16 L 0 18.6 L -1.2 16 Z', fill: '#eef2f7', stroke: '#64748b', 'stroke-width': 0.5 }));
    sword.appendChild(el('path', { d: 'M 0 3 L 0 16.4', stroke: '#ffffff', 'stroke-width': 0.6, opacity: 0.8 }));
    armFront.firstChild.appendChild(sword);
    bob.appendChild(armFront);
    // helmet over the head, face showing through the open visor
    const head = el('g', { transform: 'translate(0,-18)' });
    head.appendChild(el('circle', { cx: 0, cy: 0, r: 9.2, fill: steel, stroke: '#1f2937', 'stroke-width': 1 }));
    head.appendChild(el('rect', { x: -6, y: -3.4, width: 12, height: 8.4, rx: 3, fill: '#ffd9ae', stroke: '#1f2937', 'stroke-width': 0.6 }));
    [[-2.6, 0.4], [2.6, 0.4]].forEach(([ex, ey]) => {
      head.appendChild(el('ellipse', { cx: ex, cy: ey, rx: 1.5, ry: 1.9, fill: '#ffffff' }));
      head.appendChild(el('circle', { cx: ex + 0.3, cy: ey + 0.3, r: 1, fill: '#1f2937' }));
    });
    head.appendChild(el('path', { d: 'M -1.8 3.4 Q 0 4.6 1.8 3.4', fill: 'none', stroke: '#1f2937', 'stroke-width': 0.9, 'stroke-linecap': 'round' }));
    head.appendChild(el('path', { d: 'M -7 -4 L 7 -4', stroke: steelDark, 'stroke-width': 1.6 }));
    head.appendChild(el('ellipse', { cx: -3.4, cy: -6, rx: 3.6, ry: 2, fill: '#ffffff', opacity: 0.35 }));
    head.appendChild(el('path', { d: 'M -1 -9 C 2 -16 10 -16 13 -10 C 9 -12 5 -11 2 -8.6 Z', fill: fill, stroke: '#4a0f14', 'stroke-width': 0.7 }));
    bob.appendChild(head);
    g.appendChild(bob);
    return g;
  }

  // A small princess figure, used behind the gate bars and, once free, beside the gate.
  function castlePrincess(cls, waving) {
    const p = el('g', { class: cls });
    p.appendChild(el('path', { d: 'M -5 0 L 5 0 L 2.2 -9 L -2.2 -9 Z', fill: '#f48fb1', stroke: '#9d2f5a', 'stroke-width': 0.5 }));
    p.appendChild(el('circle', { cx: 0, cy: -11.6, r: 3, fill: '#ffd9ae', stroke: '#1f2937', 'stroke-width': 0.4 }));
    p.appendChild(el('path', { d: 'M -3.2 -11.4 Q -3.4 -15.4 0 -15 Q 3.4 -15.4 3.2 -11.4 Q 2 -13.6 0 -13.6 Q -2 -13.6 -3.2 -11.4 Z', fill: '#3b2416' }));
    p.appendChild(el('path', { d: 'M -2.4 -14.6 L -2.4 -17 L -1.2 -15.6 L 0 -17.4 L 1.2 -15.6 L 2.4 -17 L 2.4 -14.6 Z', fill: '#f2c14e' }));
    const arm = el('g', { transform: 'translate(2.4,-8)' });
    arm.appendChild(el('path', { class: waving ? 'journey-princess-wave' : undefined, d: 'M 0 0 L 4 -5', stroke: '#ffd9ae', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
    p.appendChild(arm);
    return p;
  }

  // The castle at the end of the road: towers, battlements, banners and
  // a portcullis with the princess behind it, and the dragon in front.
  function castleBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const stone = '#c9c1af', stoneDark = '#8f8776', line = '#5f584b';
    const g = el('g', { transform: `translate(${x},${y})` });
    g.appendChild(el('circle', { cx: 0, cy: -20, r: 44, fill: '#ffd27a', opacity: 0.3, filter: glowId ? `url(#${glowId})` : undefined }));
    g.appendChild(el('ellipse', { cx: 0, cy: 4, rx: 52, ry: 9, fill: '#557f35' }));
    const body = el('g', { filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    // keep and its roof
    body.appendChild(el('rect', { x: -9, y: -44, width: 18, height: 22, fill: stoneDark, stroke: line, 'stroke-width': 0.8 }));
    body.appendChild(el('path', { d: 'M -11 -44 L 0 -54 L 11 -44 Z', fill: '#9b2f2f', stroke: '#5a1a1a', 'stroke-width': 0.7 }));
    // curtain wall with battlements
    body.appendChild(el('rect', { x: -32, y: -26, width: 64, height: 28, fill: stone, stroke: line, 'stroke-width': 0.9 }));
    for (let k = -31; k <= 27; k += 6.4) body.appendChild(el('rect', { x: k, y: -30, width: 3.6, height: 4.2, fill: stone, stroke: line, 'stroke-width': 0.6 }));
    for (let r = 0; r < 4; r++) body.appendChild(el('path', { d: `M -32 ${-20 + r * 6} L 32 ${-20 + r * 6}`, stroke: stoneDark, 'stroke-width': 0.5, opacity: 0.6 }));
    // towers with conical roofs and pennants
    [[-36, 1], [36, -1]].forEach(([tx, dir]) => {
      body.appendChild(el('rect', { x: tx - 7, y: -40, width: 14, height: 42, fill: stone, stroke: line, 'stroke-width': 0.9 }));
      body.appendChild(el('rect', { x: tx - 7, y: -40, width: 5, height: 42, fill: '#ffffff', opacity: 0.18 }));
      body.appendChild(el('path', { d: `M ${tx - 9} -40 L ${tx} -51 L ${tx + 9} -40 Z`, fill: '#33518f', stroke: '#1d2f57', 'stroke-width': 0.7 }));
      body.appendChild(el('rect', { x: tx - 1.4, y: -31, width: 2.8, height: 5, rx: 1.2, fill: '#ffb347' }));
      const pole = el('g', { transform: `translate(${tx},-51)` });
      pole.appendChild(el('rect', { x: -0.5, y: -4.5, width: 1, height: 4.5, fill: '#3b3b3b' }));
      const pos = el('g', { transform: 'translate(0.5,-4.5)' });
      const flag = el('g', { class: 'journey-flag-wave' });
      flag.appendChild(el('path', { d: `M 0 0 L ${8 * dir || 8} 1.8 L 0 3.6 Z`, fill: '#b3202c' }));
      pos.appendChild(flag); pole.appendChild(pos); body.appendChild(pole);
    });
    // banners either side of the gate
    [-20, 20].forEach(bx => {
      body.appendChild(el('path', { d: `M ${bx - 3.4} -22 L ${bx + 3.4} -22 L ${bx + 3.4} -9 L ${bx} -11.4 L ${bx - 3.4} -9 Z`, fill: '#b3202c', stroke: '#e7b443', 'stroke-width': 0.6 }));
    });
    g.appendChild(body);
    // gate: a dark arch, the captive princess, and a portcullis that lifts
    const clipId = `${gradId}-gate`;
    g.appendChild(el('defs', {}, [el('clipPath', { id: clipId }, [el('path', { d: 'M -8 2 L -8 -8 A 8 8 0 0 1 8 -8 L 8 2 Z' })])]));
    g.appendChild(el('path', { d: 'M -8 2 L -8 -8 A 8 8 0 0 1 8 -8 L 8 2 Z', fill: '#2a2320' }));
    const inside = el('g', { 'clip-path': `url(#${clipId})` });
    const captive = el('g', { transform: 'translate(0,1)' });
    captive.appendChild(castlePrincess('journey-princess-captive', true));
    inside.appendChild(captive);
    const gate = el('g', { class: 'journey-portcullis' });
    for (let k = -6; k <= 6; k += 3) gate.appendChild(el('rect', { x: k - 0.5, y: -16, width: 1, height: 18, fill: '#3a3a40' }));
    for (let j = -12; j <= 0; j += 4) gate.appendChild(el('rect', { x: -8, y: j, width: 16, height: 0.9, fill: '#3a3a40' }));
    inside.appendChild(gate);
    g.appendChild(inside);
    g.appendChild(el('path', { d: 'M -9.5 2 L -9.5 -8 A 9.5 9.5 0 0 1 9.5 -8 L 9.5 2', fill: 'none', stroke: '#e5dfd2', 'stroke-width': 1.6 }));
    const free = el('g', { transform: 'translate(15,3)' });
    free.appendChild(castlePrincess('journey-princess-free', true));
    g.appendChild(free);
    // the dragon, crouched in front of the gate and facing down the road
    const dpos = el('g', { transform: 'translate(-20,10)' });
    const dragon = el('g', { class: 'journey-dragon' });
    const breathe = el('g', { class: 'journey-dragon-breathe' });
    const wingBack = el('g', { class: 'journey-dragon-wing' });
    wingBack.appendChild(el('path', { d: 'M 2 -14 L 18 -34 L 16 -24 L 22 -26 L 16 -16 L 20 -16 L 8 -10 Z', fill: '#7d1d2a', stroke: '#4a0f14', 'stroke-width': 0.7 }));
    breathe.appendChild(wingBack);
    breathe.appendChild(el('path', { d: 'M 10 -6 C 22 -6 26 -2 30 -8 C 30 -2 26 4 12 2 Z', fill: '#8e1c26', stroke: '#4a0f14', 'stroke-width': 0.6 }));
    breathe.appendChild(el('path', { d: 'M 28 -9 L 33 -10 L 30 -5 Z', fill: '#6e1420' }));
    breathe.appendChild(el('ellipse', { cx: 2, cy: -8, rx: 13, ry: 9, fill: '#b3262a', stroke: '#4a0f14', 'stroke-width': 0.8 }));
    breathe.appendChild(el('ellipse', { cx: -1, cy: -5.5, rx: 8, ry: 5.4, fill: '#e0a84a' }));
    [[-7, 1], [8, 1]].forEach(([lx]) => breathe.appendChild(el('rect', { x: lx - 2.4, y: -3, width: 4.8, height: 4.4, rx: 1.6, fill: '#8e1c26', stroke: '#4a0f14', 'stroke-width': 0.5 })));
    breathe.appendChild(el('path', { d: 'M -6 -14 C -10 -20 -12 -24 -10 -28 L -4 -27 C -6 -22 -2 -18 2 -15 Z', fill: '#b3262a', stroke: '#4a0f14', 'stroke-width': 0.7 }));
    const head = el('g', { transform: 'translate(-10,-29)' });
    head.appendChild(el('path', { d: 'M 3 -4 L 6 -10 L 4 -3 Z M -1 -4 L 0 -10 L 1.4 -3.6 Z', fill: '#efe3c2' }));
    head.appendChild(el('ellipse', { cx: 0, cy: 0, rx: 6, ry: 4.6, fill: '#b3262a', stroke: '#4a0f14', 'stroke-width': 0.7 }));
    head.appendChild(el('path', { d: 'M -4 -2 L -12 0 L -11.4 3 L -3 3.4 Z', fill: '#b3262a', stroke: '#4a0f14', 'stroke-width': 0.6 }));
    head.appendChild(el('circle', { cx: -1, cy: -1.4, r: 1.5, fill: '#ffd23f' }));
    head.appendChild(el('rect', { x: -1.3, y: -2.6, width: 0.6, height: 2.4, fill: '#111' }));
    head.appendChild(el('path', { d: 'M -10 3 L -9.2 4.6 L -8.4 3 M -7.4 3.2 L -6.6 4.8 L -5.8 3.2', fill: '#ffffff' }));
    const fire = el('g', { transform: 'translate(-12,1.5)' });
    fire.appendChild(el('path', { class: 'journey-dragon-fire', d: 'M 0 0 C -6 -5 -14 -3 -20 -7 C -16 -2 -18 2 -22 4 C -14 4 -8 6 0 1 Z', fill: '#ff9a2e', stroke: '#ffd23f', 'stroke-width': 0.8 }));
    head.appendChild(fire);
    breathe.appendChild(head);
    const wingFront = el('g', { class: 'journey-dragon-wing d1' });
    wingFront.appendChild(el('path', { d: 'M 4 -12 L 24 -26 L 20 -18 L 27 -17 L 18 -10 L 21 -8 L 8 -6 Z', fill: '#9c2531', stroke: '#4a0f14', 'stroke-width': 0.7 }));
    breathe.appendChild(wingFront);
    dragon.appendChild(breathe);
    dpos.appendChild(dragon);
    g.appendChild(dpos);
    return g;
  }

  // A checkpoint — a wooden banner pole topped with a fire basket that
  // lights once the task is done; a blocked one has a giant frog in front
  // of it (croaking, with a crown) that the knight has to get past.
  function castleBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const color = isDone ? '#b3202c' : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 5 * s, cy: -20 * s, r: 15 * s, fill: NEXT_COLOR, opacity: 0.5 }));
    g.appendChild(el('ellipse', { cx: 2 * s, cy: 0.5 * s, rx: 6 * s, ry: 1.8 * s, fill: '#0b1220', opacity: 0.25 }));
    g.appendChild(el('rect', { x: -1.1 * s, y: -30 * s, width: 2.2 * s, height: 30 * s, rx: 0.8 * s, fill: '#6b4a2e', stroke: '#3f2a16', 'stroke-width': 0.5 * s }));
    // fire basket
    g.appendChild(el('path', { d: `M ${-4 * s} ${-33 * s} L ${4 * s} ${-33 * s} L ${2.4 * s} ${-29.6 * s} L ${-2.4 * s} ${-29.6 * s} Z`, fill: '#2d2d33' }));
    if (isDone) {
      const fpos = el('g', { transform: `translate(0,${-33 * s})` });
      fpos.appendChild(el('circle', { cx: 0, cy: -3 * s, r: 7 * s, fill: '#ffb347', opacity: 0.35 }));
      const flame = el('g', { class: 'journey-flame' });
      flame.appendChild(el('path', { d: `M ${-3.2 * s} 0 Q ${-3.6 * s} ${-4.6 * s} 0 ${-9 * s} Q ${3.6 * s} ${-4.6 * s} ${3.2 * s} 0 Z`, fill: '#ff8a2a' }));
      flame.appendChild(el('path', { d: `M ${-1.6 * s} 0 Q ${-1.8 * s} ${-2.8 * s} 0 ${-5.4 * s} Q ${1.8 * s} ${-2.8 * s} ${1.6 * s} 0 Z`, fill: '#ffe08a' }));
      fpos.appendChild(flame);
      g.appendChild(fpos);
    }
    const pos = el('g', { transform: `translate(${1.1 * s},${-26 * s})` });
    const flag = el('g', { class: 'journey-flag-wave' });
    flag.appendChild(el('path', {
      d: `M 0 0 L ${13 * s} 0 L ${13 * s} ${9 * s} L ${10.4 * s} ${7 * s} L ${7.8 * s} ${9 * s} L 0 ${9 * s} Z`, fill: color, stroke: '#1f2937', 'stroke-width': 0.6 * s, 'stroke-linejoin': 'round',
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    }));
    const label = el('text', {
      x: 5.6 * s, y: 4.6 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 6.4 * s, 'font-weight': 800, fill: isDone ? '#ffffff' : '#1f2937', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    flag.appendChild(label);
    pos.appendChild(flag);
    g.appendChild(pos);
    if (blocked) g.appendChild(drawFoes(blocked, s, CASTLE_FOES));
    return g;
  }

  // The castle finish: from the last banner the knight swings his sword,
  // the dragon flashes and falls, the portcullis lifts, the princess steps
  // out to wave, "QUEST COMPLETE!" pops, and fireworks burst over the towers.
  function castleCelebrateFinish(entry, from, scale, burst) {
    const { svg, avatarLayer, goalPt } = entry;
    const av = avatarLayer.firstChild;
    const dragon = svg.querySelector('.journey-dragon');
    if (av) av.classList.add('journey-slash');
    setTimeout(() => {
      if (!svg.isConnected) return;
      if (av) av.classList.remove('journey-slash');
      if (dragon) dragon.classList.add('journey-dragon-hit');
      const slash = el('path', {
        class: 'journey-slash-arc', d: `M ${goalPt.x - 40} ${goalPt.y - 8} Q ${goalPt.x - 20} ${goalPt.y - 30} ${goalPt.x - 2} ${goalPt.y - 14}`,
        fill: 'none', stroke: '#ffffff', 'stroke-width': 3, 'stroke-linecap': 'round',
      });
      svg.insertBefore(slash, entry.vignette);
      setTimeout(() => slash.remove(), 500);
    }, 260);
    setTimeout(() => { if (svg.isConnected && dragon) dragon.classList.add('journey-dragon-fall'); }, 700);
    setTimeout(() => {
      if (!svg.isConnected) return;
      if (dragon) dragon.classList.remove('journey-dragon-hit', 'journey-dragon-fall');
      entry.shotPending = false;
      svg.classList.add('journey-quest-done');
      const ty = goalPt.y > 90 ? goalPt.y - 70 : goalPt.y + 52;
      const txt = el('text', {
        class: 'journey-goal-pop', x: goalPt.x, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': 24, 'font-weight': 900, 'font-family': 'Georgia, "Times New Roman", serif',
        fill: '#ffe39a', stroke: '#6b3a07', 'stroke-width': 2.4, 'paint-order': 'stroke', 'letter-spacing': 1,
      });
      txt.textContent = 'QUEST COMPLETE!';
      svg.insertBefore(txt, entry.vignette);
      setTimeout(() => txt.remove(), 2700);
      // three fireworks over the castle, one after another
      [[-30, -48, '#ffd23f'], [28, -56, '#ff5d8f'], [0, -66, '#6ec6ff']].forEach(([fx, fy, c], k) => {
        const pos = el('g', { transform: `translate(${goalPt.x + fx},${Math.max(14, goalPt.y + fy)})` });
        const fw = el('g', { class: 'journey-firework', style: `animation-delay:${k * 0.35}s` });
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2;
          fw.appendChild(el('line', { x1: Math.cos(ang) * 3, y1: Math.sin(ang) * 3, x2: Math.cos(ang) * 12, y2: Math.sin(ang) * 12, stroke: c, 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
        }
        pos.appendChild(fw);
        svg.insertBefore(pos, entry.vignette);
        setTimeout(() => pos.remove(), 2400);
      });
      burst();
    }, 1500);
  }

  // ════════════════════════════════════════════════════════════════
  // Shared by the people themes (Corporate, Construction, Life Path): a
  // round cartoon head — face, cheeks, a smile — with a choice of hair.
  // ════════════════════════════════════════════════════════════════
  function cartoonHead({ skin = '#ffd9ae', hair = '#4a2f1e', style = 'short', r = 9.2 } = {}) {
    const head = el('g');
    if (style === 'long') head.appendChild(el('path', { d: `M ${-r - 0.6} -1 Q ${-r - 1.4} ${r + 3} ${-r + 2} ${r + 4} L ${r - 2} ${r + 4} Q ${r + 1.4} ${r + 3} ${r + 0.6} -1 Z`, fill: hair }));
    head.appendChild(el('circle', { cx: 0, cy: 0, r, fill: skin, stroke: '#1f2937', 'stroke-width': 1 }));
    head.appendChild(el('ellipse', { cx: -3, cy: -3.4, rx: 4.4, ry: 3, fill: '#ffffff', opacity: 0.3 }));
    if (style === 'short' || style === 'long') {
      head.appendChild(el('path', { d: `M ${-r} -2.6 A ${r} ${r} 0 0 1 ${r} -2.6 L ${r - 0.4} -6.2 A ${r + 0.4} ${r * 0.7} 0 0 0 ${-r + 0.4} -6.2 Z`, fill: hair }));
      head.appendChild(el('path', { d: 'M -6 -6.6 Q -1 -12.4 6.4 -6.4 Q 1 -8.6 -6 -6.6 Z', fill: hair }));
    } else if (style === 'bun') {
      head.appendChild(el('path', { d: `M ${-r} -2.6 A ${r} ${r} 0 0 1 ${r} -2.6 L ${r - 0.4} -6.2 A ${r + 0.4} ${r * 0.7} 0 0 0 ${-r + 0.4} -6.2 Z`, fill: hair }));
      head.appendChild(el('circle', { cx: 0, cy: -r - 1.6, r: 3.4, fill: hair }));
    }
    [[-3.1, 1], [3.1, -1]].forEach(([ex]) => {
      head.appendChild(el('ellipse', { cx: ex, cy: -1, rx: 2, ry: 2.4, fill: '#ffffff' }));
      head.appendChild(el('circle', { cx: ex + 0.3, cy: -0.5, r: 1.25, fill: '#1f2937' }));
      head.appendChild(el('circle', { cx: ex - 0.2, cy: -1.2, r: 0.5, fill: '#ffffff' }));
    });
    head.appendChild(el('path', { d: 'M -2.6 3.3 Q 0 5.2 2.6 3.3', fill: 'none', stroke: '#1f2937', 'stroke-width': 1.1, 'stroke-linecap': 'round' }));
    head.appendChild(el('ellipse', { cx: -5.8, cy: 1.7, rx: 1.75, ry: 1.15, fill: '#ff9d8a', opacity: 0.55 }));
    head.appendChild(el('ellipse', { cx: 5.8, cy: 1.7, rx: 1.75, ry: 1.15, fill: '#ff9d8a', opacity: 0.55 }));
    return head;
  }
  // A small "pseudo-random" value from an index — scenery that has to look
  // irregular (a skyline) but be identical on every redraw.
  const hash01 = i => { const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };
  // Paper confetti for the business finishes: sheets that flutter down.
  function paperRain(entry, cx, cy, n = 18) {
    const { svg } = entry;
    const gp = el('g');
    svg.insertBefore(gp, entry.vignette);
    const sheets = Array.from({ length: n }, (_, k) => {
      const r = el('rect', { x: -3, y: -4, width: 6, height: 8, rx: 0.6, fill: k % 3 ? '#ffffff' : '#fde68a', stroke: '#94a3b8', 'stroke-width': 0.5 });
      gp.appendChild(r);
      return { r, x: cx + (hash01(k) - 0.5) * 120, y: cy - 60 - hash01(k + 9) * 40, sp: 30 + hash01(k + 3) * 30, ph: hash01(k + 5) * 6 };
    });
    const t0 = performance.now();
    const step = now => {
      if (!svg.isConnected) return;
      const t = (now - t0) / 1000;
      sheets.forEach(s => {
        const x = s.x + Math.sin(t * 3 + s.ph) * 10, y = s.y + s.sp * t;
        s.r.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(Math.sin(t * 4 + s.ph) * 40).toFixed(0)})`);
        s.r.setAttribute('opacity', Math.max(0, 1 - t / 2.4).toFixed(2));
      });
      if (t < 2.4) requestAnimationFrame(step); else gp.remove();
    };
    requestAnimationFrame(step);
  }

  // ════════════════════════════════════════════════════════════════
  // THEME: CONSTRUCTION — "The Build Site". A builder in a hard hat and
  // hi-vis walks a dirt haul road past site signboards to the plot,
  // where the building rises phase by phase as tasks get done (unbuilt
  // phases show as a faint blueprint). Blockers are barriers and cones,
  // permit-pending signs, storm clouds, broken-down trucks and rubble.
  // ════════════════════════════════════════════════════════════════
  function constructionDecorate(svg, layout, glowId, glowLgId) {
    const { w, h } = layout;
    svg.appendChild(el('circle', { cx: w * 0.86, cy: h * 0.09, r: w * 0.1, fill: '#fff4cf', opacity: 0.45, filter: glowLgId ? `url(#${glowLgId})` : undefined }));
    svg.appendChild(el('circle', { cx: w * 0.86, cy: h * 0.09, r: w * 0.032, fill: '#fff7dd' }));
    cloudGroup(svg, layout, [[0.2, 0.07, 0.75], [0.55, 0.1, 0.6]]);
    // a hazy city beyond the site
    let x = -6;
    for (let k = 0; x < w + 6; k++) {
      const bw = w * (0.04 + hash01(k + 70) * 0.05), bh = h * (0.04 + hash01(k + 90) * 0.1);
      svg.appendChild(el('rect', { x, y: h * 0.27 - bh, width: bw, height: bh + 2, fill: '#b9c6d4', opacity: 0.7 }));
      x += bw + 2;
    }
    // the site: packed earth, gravel, tyre tracks
    svg.appendChild(el('rect', { x: 0, y: h * 0.26, width: w, height: h * 0.74, fill: '#d2b48c' }));
    svg.appendChild(el('path', { d: `M 0 ${h * 0.34} Q ${w * 0.3} ${h * 0.3} ${w * 0.6} ${h * 0.35} T ${w} ${h * 0.32} L ${w} ${h} L 0 ${h} Z`, fill: '#c9a67a' }));
    for (let k = 0; k < 140; k++) {
      svg.appendChild(el('circle', { cx: hash01(k + 300) * w, cy: h * 0.3 + hash01(k + 500) * h * 0.7, r: 0.8 + hash01(k + 700) * 1.4, fill: k % 3 ? '#a98b62' : '#e2cba4', opacity: 0.7 }));
    }
    [[0.05, 0.95, 0.4, 0.6, 0.9, 0.5], [0.2, 0.98, 0.6, 0.7, 0.98, 0.62]].forEach(([x1, y1, cx, cy, x2, y2]) => {
      [-4, 4].forEach(off => svg.appendChild(el('path', { d: `M ${w * x1 + off} ${h * y1} Q ${w * cx + off} ${h * cy} ${w * x2 + off} ${h * y2}`, fill: 'none', stroke: '#a7865d', 'stroke-width': 3, 'stroke-dasharray': '5 3', opacity: 0.45 })));
    });
    svg.appendChild(el('ellipse', { cx: w * 0.3, cy: h * 0.78, rx: 26, ry: 7, fill: '#8fb7cf', opacity: 0.7 }));
    // the site hoarding along the back, with a safety banner
    svg.appendChild(el('rect', { x: 0, y: h * 0.255, width: w, height: h * 0.04, fill: '#e5e7eb', stroke: '#9ca3af', 'stroke-width': 0.8 }));
    for (let px = 0; px < w; px += 36) svg.appendChild(el('rect', { x: px, y: h * 0.255, width: 2, height: h * 0.04, fill: '#9ca3af' }));
    const banner = el('g', { transform: `translate(${w * 0.2},${h * 0.275})` });
    banner.appendChild(el('rect', { x: -32, y: -6, width: 64, height: 12, rx: 1.5, fill: '#facc15', stroke: '#111827', 'stroke-width': 0.8 }));
    const bt = el('text', { x: 0, y: 3.5, 'text-anchor': 'middle', 'font-size': 7.4, 'font-weight': 900, fill: '#111827', 'font-family': 'Arial, sans-serif' });
    bt.textContent = 'SAFETY FIRST';
    banner.appendChild(bt);
    svg.appendChild(banner);
  }

  // Cones, brick pallets, pipe stacks, sand piles and drums around the site.
  function constructionScatter(layer, layout, isClear, rand) {
    scatterProps(layer, layout, isClear, rand, {
      count: 14, margin: 16, spacing: 34, minY: layout.h * 0.32,
      draw(g, v) {
        g.appendChild(el('ellipse', { cx: 3, cy: 1, rx: 12, ry: 3, fill: '#0b1220', opacity: 0.16 }));
        if (v < 0.25) {
          g.appendChild(el('path', { d: 'M -4 0 L 0 -12 L 4 0 Z', fill: '#f97316', stroke: '#9a3412', 'stroke-width': 0.6 }));
          g.appendChild(el('path', { d: 'M -2.4 -5 L 2.4 -5', stroke: '#ffffff', 'stroke-width': 1.6 }));
          g.appendChild(el('rect', { x: -5.5, y: -1, width: 11, height: 1.6, fill: '#9a3412' }));
        } else if (v < 0.45) {
          g.appendChild(el('rect', { x: -9, y: -2, width: 18, height: 2.4, fill: '#a16207' }));
          for (let r = 0; r < 3; r++) for (let c = 0; c < 4 - (r % 2); c++) g.appendChild(el('rect', { x: -8 + c * 4.2 + (r % 2) * 2, y: -5 - r * 3, width: 3.8, height: 2.6, fill: '#b45309', stroke: '#7c2d12', 'stroke-width': 0.4 }));
        } else if (v < 0.65) {
          [[-6, -2.4], [0, -2.4], [6, -2.4], [-3, -7], [3, -7], [0, -11.6]].forEach(([cx, cy]) => {
            g.appendChild(el('circle', { cx, cy, r: 2.6, fill: '#94a3b8', stroke: '#475569', 'stroke-width': 0.6 }));
            g.appendChild(el('circle', { cx, cy, r: 1.3, fill: '#334155' }));
          });
        } else if (v < 0.82) {
          g.appendChild(el('path', { d: 'M -12 0 Q -4 -12 2 -11 Q 9 -10 13 0 Z', fill: '#e6c88f' }));
          g.appendChild(el('path', { d: 'M -6 -6 Q -2 -10 2 -9', fill: 'none', stroke: '#f6e2b8', 'stroke-width': 1.4 }));
        } else {
          g.appendChild(el('rect', { x: -4, y: -11, width: 8, height: 11, rx: 1, fill: '#2563eb', stroke: '#1e3a8a', 'stroke-width': 0.6 }));
          [-8, -4].forEach(by => g.appendChild(el('rect', { x: -4, y: by, width: 8, height: 0.8, fill: '#1e3a8a' })));
        }
      },
    });
  }

  // A builder in a hard hat and hi-vis vest, a hammer in the front hand.
  function constructionBuildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 0, cy: 24, rx: 15, ry: 3.6, fill: '#1f2937', opacity: 0.25 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    bob.appendChild(avatarLimb('journey-leg-back', '#1e40af', -3.4, 9, 4.2, 10, 3.6, 1.9, '#78350f'));
    bob.appendChild(avatarLimb('journey-arm-back', '#2563eb', -7.4, -4, 3.8, 8.6, 2, 2, '#ffd9ae'));
    bob.appendChild(el('rect', { x: -8.6, y: -9, width: 17.2, height: 19, rx: 6, fill: '#2563eb', stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('path', { d: 'M -8.4 -6 Q -8.6 -9 -5 -9 L -2 -9 L -2 10 L -6 10 Q -8.6 10 -8.4 7 Z M 8.4 -6 Q 8.6 -9 5 -9 L 2 -9 L 2 10 L 6 10 Q 8.6 10 8.4 7 Z', fill }));
    [1, 5].forEach(sy => bob.appendChild(el('path', { d: `M -8.4 ${sy} L -2 ${sy} M 2 ${sy} L 8.4 ${sy}`, stroke: '#e5e7eb', 'stroke-width': 1.4 })));
    bob.appendChild(el('rect', { x: -8.4, y: 7.4, width: 16.8, height: 2.2, fill: '#78350f' }));
    bob.appendChild(avatarLimb('journey-leg-front', '#1d4ed8', 3.4, 9, 4.2, 10, 3.6, 1.9, '#78350f'));
    const armFront = avatarLimb('journey-arm-front', '#2563eb', 7.4, -4, 3.8, 8.6, 2, 2, '#ffd9ae');
    const hammer = el('g', { transform: 'translate(0,9.6) rotate(-120)' });
    hammer.appendChild(el('rect', { x: -0.8, y: -2, width: 1.6, height: 12, rx: 0.6, fill: '#a16207' }));
    hammer.appendChild(el('rect', { x: -3.4, y: 9, width: 6.8, height: 3, rx: 0.6, fill: '#6b7280', stroke: '#374151', 'stroke-width': 0.5 }));
    armFront.firstChild.appendChild(hammer);
    bob.appendChild(armFront);
    const head = cartoonHead({ hair: '#5b3a22' });
    head.appendChild(el('path', { d: 'M -10 -4 A 10 9.6 0 0 1 10 -4 Z', fill: '#facc15', stroke: '#a16207', 'stroke-width': 0.9 }));
    head.appendChild(el('rect', { x: -12, y: -4.6, width: 24, height: 2.4, rx: 1.2, fill: '#eab308', stroke: '#a16207', 'stroke-width': 0.7 }));
    head.appendChild(el('path', { d: 'M -1.4 -13 L 1.4 -13 L 1.4 -4.6 L -1.4 -4.6 Z', fill: '#fde047' }));
    head.setAttribute('transform', 'translate(0,-18.5)');
    bob.appendChild(head);
    g.appendChild(bob);
    return g;
  }

  // The plot: a foundation slab with the building's phases on it (frame,
  // floors, walls, roof), each a faint blueprint until enough tasks are
  // done (see constructionUpdateGoal), and a tower crane holding the final
  // beam for the topping-out.
  function constructionBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const g = el('g', { class: 'journey-build', transform: `translate(${x},${y + 6}) scale(0.62)` });
    g.appendChild(el('circle', { cx: 0, cy: -28, r: 48, fill: '#ffe08a', opacity: 0.24, filter: glowId ? `url(#${glowId})` : undefined }));
    g.appendChild(el('ellipse', { cx: 0, cy: 3, rx: 44, ry: 7, fill: '#a98b62' }));
    const body = el('g', { filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    body.appendChild(el('rect', { x: -28, y: -4, width: 56, height: 6, fill: '#9ca3af', stroke: '#4b5563', 'stroke-width': 0.8 }));
    const phase = at => { const p = el('g', { class: 'journey-build-phase', 'data-at': at }); body.appendChild(p); return p; };
    const steel = '#64748b', brick = '#c2410c', slab = '#cbd5e1';
    // frame: ground and first floor columns and slabs
    const p1 = phase(0.2);
    [-24, -8, 8, 24].forEach(cx => p1.appendChild(el('rect', { x: cx - 1.4, y: -18, width: 2.8, height: 14, fill: steel })));
    p1.appendChild(el('rect', { x: -27, y: -20, width: 54, height: 3, fill: slab, stroke: '#64748b', 'stroke-width': 0.6 }));
    const p2 = phase(0.4);
    [-24, -8, 8, 24].forEach(cx => p2.appendChild(el('rect', { x: cx - 1.4, y: -34, width: 2.8, height: 14, fill: steel })));
    p2.appendChild(el('rect', { x: -27, y: -36, width: 54, height: 3, fill: slab, stroke: '#64748b', 'stroke-width': 0.6 }));
    // walls with windows on the first two floors
    const walls = (p, top) => {
      [[-22.6, -9.4], [-6.6, 6.6], [9.4, 22.6]].forEach(([a, b]) => {
        p.appendChild(el('rect', { x: a, y: top, width: b - a, height: 13, fill: brick }));
        p.appendChild(el('rect', { x: a + 2.6, y: top + 3, width: b - a - 5.2, height: 6.4, fill: '#bfdbfe', stroke: '#e5e7eb', 'stroke-width': 0.8, class: 'journey-build-window' }));
      });
    };
    const p3 = phase(0.6);
    walls(p3, -17); walls(p3, -33);
    p3.appendChild(el('rect', { x: -5, y: -15, width: 10, height: 11, fill: '#1f2937' }));
    // top floor
    const p4 = phase(0.8);
    [-24, -8, 8, 24].forEach(cx => p4.appendChild(el('rect', { x: cx - 1.4, y: -50, width: 2.8, height: 14, fill: steel })));
    walls(p4, -49);
    // roof and parapet
    const p5 = phase(1);
    p5.appendChild(el('rect', { x: -28, y: -54, width: 56, height: 4, fill: '#475569' }));
    p5.appendChild(el('rect', { x: -14, y: -59, width: 10, height: 5, fill: '#94a3b8' }));
    g.appendChild(body);
    // the tower crane beside it, with the topping-out beam on its hook
    const crane = el('g', { transform: 'translate(36,0)' });
    crane.appendChild(el('rect', { x: -2.4, y: -78, width: 4.8, height: 78, fill: 'none', stroke: '#eab308', 'stroke-width': 1.4 }));
    for (let yy = -78; yy < 0; yy += 6) crane.appendChild(el('path', { d: `M -2.4 ${yy} L 2.4 ${yy + 6} M 2.4 ${yy} L -2.4 ${yy + 6}`, stroke: '#eab308', 'stroke-width': 0.7 }));
    crane.appendChild(el('rect', { x: -58, y: -82, width: 74, height: 3.4, fill: '#eab308', stroke: '#a16207', 'stroke-width': 0.5 }));
    crane.appendChild(el('rect', { x: 9, y: -86, width: 7, height: 4.4, fill: '#6b7280' }));
    crane.appendChild(el('rect', { x: -4, y: -88, width: 8, height: 6, fill: '#fde047', stroke: '#a16207', 'stroke-width': 0.5 }));
    crane.appendChild(el('path', { d: 'M 0 -88 L -40 -82 M 0 -88 L 14 -82', stroke: '#a16207', 'stroke-width': 0.6 }));
    const hook = el('g', { class: 'journey-crane-hook' });
    hook.appendChild(el('rect', { x: -36.4, y: -79, width: 0.8, height: 16, fill: '#374151' }));
    hook.appendChild(el('rect', { x: -44, y: -63, width: 16, height: 2.6, fill: '#b91c1c', stroke: '#7f1d1d', 'stroke-width': 0.5 }));
    hook.appendChild(el('rect', { x: -36.4, y: -71, width: 0.6, height: 8, fill: '#374151' }));
    hook.appendChild(el('path', { d: 'M -36 -71 L -36 -77 L -30 -75 L -36 -73 Z', fill: '#22c55e' }));
    crane.appendChild(hook);
    g.appendChild(crane);
    // the opening ribbon across the entrance
    const ribbon = el('g', { class: 'journey-ribbon' });
    ribbon.appendChild(el('path', { class: 'journey-ribbon-l', d: 'M -10 -6 L 0 -6', stroke: '#dc2626', 'stroke-width': 1.6 }));
    ribbon.appendChild(el('path', { class: 'journey-ribbon-r', d: 'M 0 -6 L 10 -6', stroke: '#dc2626', 'stroke-width': 1.6 }));
    ribbon.appendChild(el('circle', { cx: 0, cy: -6, r: 1.8, fill: '#dc2626' }));
    g.appendChild(ribbon);
    g.appendChild(sparkles([[-30, -60, 2.2], [26, -44, 1.8]]));
    return g;
  }
  // Raises the building to match progress: phases at or below it are built.
  function constructionUpdateGoal(entry, frac) {
    entry.svg.querySelectorAll('.journey-build-phase').forEach(p => {
      p.classList.toggle('is-built', frac >= Number(p.getAttribute('data-at')) - 1e-6);
    });
  }

  // A checkpoint: a site signboard on two legs, hazard-striped, turning
  // green with a tick when done.
  function constructionBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 0, cy: -22 * s, r: 15 * s, fill: NEXT_COLOR, opacity: 0.5 }));
    g.appendChild(el('ellipse', { cx: 1.5 * s, cy: 0.5 * s, rx: 7 * s, ry: 1.6 * s, fill: '#0b1220', opacity: 0.22 }));
    [-6, 6].forEach(lx => g.appendChild(el('rect', { x: (lx - 0.7) * s, y: -18 * s, width: 1.4 * s, height: 18 * s, fill: '#4b5563' })));
    const board = el('g', { class: 'journey-flag-wave' });
    board.appendChild(el('rect', {
      x: -10 * s, y: -31 * s, width: 20 * s, height: 14 * s, rx: 1 * s, fill: '#facc15', stroke: '#111827', 'stroke-width': 0.6 * s,
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    }));
    for (let k = -9; k < 10; k += 4) board.appendChild(el('path', { d: `M ${k * s} ${-31 * s} L ${(k + 2) * s} ${-31 * s} L ${(k - 1) * s} ${-17 * s} L ${(k - 3) * s} ${-17 * s} Z`, fill: '#111827', opacity: 0.85 }));
    board.appendChild(el('rect', { x: -7.6 * s, y: -28.6 * s, width: 15.2 * s, height: 9.2 * s, rx: 0.8 * s, fill: isDone ? '#10b981' : isNext ? '#fff7d6' : '#ffffff' }));
    if (isDone) {
      board.appendChild(el('path', { d: `M ${-4 * s} ${-24 * s} L ${-1.2 * s} ${-21.4 * s} L ${4.4 * s} ${-27 * s}`, fill: 'none', stroke: '#ffffff', 'stroke-width': 1.8 * s, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    } else {
      const label = el('text', { x: 0, y: -23.6 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 7 * s, 'font-weight': 900, fill: '#1f2937', 'font-family': 'Arial, sans-serif' });
      label.textContent = String(i + 1);
      board.appendChild(label);
    }
    g.appendChild(board);
    if (blocked) g.appendChild(drawFoes(blocked, s, CONSTRUCTION_FOES));
    return g;
  }

  // The topping-out: the crane lowers the final beam onto the roof, the
  // ribbon at the entrance is cut, "PROJECT COMPLETE!" and fireworks.
  function constructionCelebrateFinish(entry, from, scale, burst) {
    entry.shotPending = false;
    entry.svg.classList.add('journey-quest-done');
    const hook = entry.svg.querySelector('.journey-crane-hook');
    if (hook) { hook.classList.remove('journey-topping'); hook.getBBox(); hook.classList.add('journey-topping'); }
    finishFlourish(entry, 'PROJECT COMPLETE!', '#fde047', '#7c2d12', ['#fde047', '#fb923c', '#86efac']);
    burst();
  }

  // ════════════════════════════════════════════════════════════════
  // OBSTACLES — each task's named obstacles become that many enemies on
  // the road before its flag, drawn in the theme's own style (rival
  // players, mini-bosses, sharks, asteroids...), with the obstacle's name
  // on a tag. Finishing the task knocks them out (see celebrateFlag).
  // ════════════════════════════════════════════════════════════════
  const FOE_SPOTS = [[-26, 0], [-42, -7], [-34, 10], [-54, 3], [-18, 13], [-60, -6]];
  const FOE_SIZE = 1.25;
  // bare: just the enemies (no glow, lock or tag), from spot `start` on —
  // used for a ticked-off obstacle's enemies as they're knocked out.
  function drawFoes(blocked, s, foe, { bare = false, start = 0 } = {}) {
    const info = blocked === true ? { count: 1, label: '' } : blocked;
    const shown = Math.min(info.count, FOE_SPOTS.length);
    const spots = Array.from({ length: shown }, (_, k) => FOE_SPOTS[(start + k) % FOE_SPOTS.length]);
    const g = el('g', { class: 'journey-foes' });
    const cx = spots.reduce((a, p) => a + p[0], 0) / shown;
    if (!bare) g.appendChild(el('circle', { class: 'journey-blocked-glow', cx: cx * s, cy: -8 * s, r: (18 + shown * 4) * s, fill: '#ef4444', opacity: 0.4 }));
    spots.sort((a, b) => a[1] - b[1]).forEach(([x, y], k) => {
      const pos = el('g', { transform: `translate(${x * s},${y * s}) scale(${s * FOE_SIZE})` });
      const inner = el('g', { class: 'journey-foe', style: `animation-delay:${(-k * 0.37).toFixed(2)}s` });
      foe(inner, k + start);
      pos.appendChild(inner);
      g.appendChild(pos);
    });
    if (bare) return g;
    const top = Math.min(...FOE_SPOTS.slice(0, shown).map(p => p[1])) - 36;
    g.appendChild(lockIcon(cx * s, top * s, s));
    const extra = info.count > shown ? ` +${info.count - shown}` : '';
    const text = (info.label || 'Blocked').slice(0, 26) + (info.label && info.label.length > 26 ? '…' : '') + extra;
    const fs = Math.max(6, 8 * s), w = text.length * fs * 0.56 + 8 * Math.max(0.75, s);
    const tag = el('g', { transform: `translate(${cx * s},${(top - 12) * s})` });
    tag.appendChild(el('rect', { x: -w / 2, y: -fs * 0.85, width: w, height: fs * 1.6, rx: fs * 0.8, fill: '#7f1d1d', opacity: 0.92 }));
    const t = el('text', { x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': fs, 'font-weight': 800, fill: '#ffffff', 'font-family': 'Arial, sans-serif', class: 'journey-unflip' });
    t.textContent = text;
    tag.appendChild(t);
    g.appendChild(tag);
    return g;
  }
  // One enemy per theme, drawn at its feet (0,0), about 20 units tall.
  const SPACE_FOES = (g, k) => {
    if (k % 2 === 0) {
      g.appendChild(el('path', { d: 'M -10 -8 L -5 -17 L 5 -16 L 10 -7 L 7 2 L -4 3 L -11 -2 Z', fill: '#6b6f8a', stroke: '#2f3347', 'stroke-width': 0.8 }));
      g.appendChild(el('circle', { cx: -3, cy: -9, r: 2.6, fill: '#4b4f68' }));
      g.appendChild(el('circle', { cx: 4, cy: -3, r: 1.8, fill: '#4b4f68' }));
    } else {
      // an alien saucer
      g.appendChild(el('ellipse', { cx: 0, cy: 2, rx: 6, ry: 1.6, fill: '#a3e635', opacity: 0.35 }));
      g.appendChild(el('path', { d: 'M -5 -10 Q 0 -18 5 -10 Z', fill: '#67e8f9', stroke: '#0e7490', 'stroke-width': 0.6, opacity: 0.9 }));
      g.appendChild(el('circle', { cx: 0, cy: -12.5, r: 1.6, fill: '#84cc16' }));
      g.appendChild(el('ellipse', { cx: 0, cy: -8, rx: 12, ry: 3.6, fill: '#94a3b8', stroke: '#334155', 'stroke-width': 0.7 }));
      [-7, 0, 7].forEach(x => g.appendChild(el('circle', { cx: x, cy: -7.6, r: 1, fill: '#fde047' })));
    }
  };
  // Construction: barriers and cones, a permit-pending sign, a storm
  // cloud, a broken-down truck and a pile of rubble, in turn.
  const CONSTRUCTION_FOES = (g, k) => {
    const kind = k % 5;
    if (kind === 0) {
      [-8, 8].forEach(lx => g.appendChild(el('path', { d: `M ${lx - 1.6} 0 L ${lx} -10 L ${lx + 1.6} 0 Z`, fill: '#6b7280' })));
      g.appendChild(el('rect', { x: -10, y: -11, width: 20, height: 5, fill: '#ffffff', stroke: '#111827', 'stroke-width': 0.5 }));
      for (let x = -9; x < 10; x += 5) g.appendChild(el('path', { d: `M ${x} -11 L ${x + 2.4} -11 L ${x + 0.4} -6 L ${x - 2} -6 Z`, fill: '#dc2626' }));
      g.appendChild(el('circle', { cx: -9, cy: -12.6, r: 1.4, fill: '#f59e0b' }));
      g.appendChild(el('path', { d: 'M -14 0 L -11.6 -8 L -9.2 0 Z', fill: '#f97316' }));
    } else if (kind === 1) {
      g.appendChild(el('rect', { x: -0.8, y: -10, width: 1.6, height: 10, fill: '#4b5563' }));
      g.appendChild(el('rect', { x: -10, y: -20, width: 20, height: 11, rx: 1.2, fill: '#dc2626', stroke: '#7f1d1d', 'stroke-width': 0.6 }));
      const t1 = el('text', { x: 0, y: -15, 'text-anchor': 'middle', 'font-size': 4.4, 'font-weight': 900, fill: '#ffffff', 'font-family': 'Arial, sans-serif' });
      t1.textContent = 'PERMIT';
      const t2 = el('text', { x: 0, y: -10.6, 'text-anchor': 'middle', 'font-size': 3.6, 'font-weight': 800, fill: '#fde68a', 'font-family': 'Arial, sans-serif' });
      t2.textContent = 'PENDING';
      g.appendChild(t1); g.appendChild(t2);
    } else if (kind === 2) {
      [[-5, -18, 5.4], [1, -21, 6.4], [6.4, -17.6, 4.6], [0, -15.6, 6]].forEach(([cx, cy, r]) => g.appendChild(el('circle', { cx, cy, r, fill: '#6b7280' })));
      g.appendChild(el('path', { d: 'M -4 -15 Q -1 -17.4 2 -15', fill: 'none', stroke: '#1f2937', 'stroke-width': 0.9 }));
      [-6, -2, 2, 6].forEach(rx => g.appendChild(el('path', { d: `M ${rx} -10 L ${rx - 1.6} -4`, stroke: '#60a5fa', 'stroke-width': 1, 'stroke-linecap': 'round' })));
      g.appendChild(el('path', { d: 'M 1 -12 L -1.4 -6 L 1.4 -6 L -1 0', fill: 'none', stroke: '#facc15', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }));
    } else if (kind === 3) {
      g.appendChild(el('path', { d: 'M -11 -4 L -11 -11 L -1 -11 L 2 -15 L 10 -15 L 10 -4 Z', fill: '#eab308', stroke: '#713f12', 'stroke-width': 0.6 }));
      g.appendChild(el('rect', { x: 3, y: -14, width: 5, height: 4, fill: '#bfdbfe' }));
      g.appendChild(el('path', { d: 'M -12 -11 L -2 -11 L -4 -16 L -13 -15 Z', fill: '#a16207' }));
      [-7, 6].forEach(wx => g.appendChild(el('circle', { cx: wx, cy: -3, r: 3, fill: '#111827', stroke: '#6b7280', 'stroke-width': 0.8 })));
      g.appendChild(el('circle', { cx: -2, cy: -19, r: 3, fill: '#9ca3af', opacity: 0.8 }));
      g.appendChild(el('circle', { cx: 1, cy: -22, r: 2.2, fill: '#9ca3af', opacity: 0.6 }));
    } else {
      [[-7, -2, 4, '#9ca3af'], [-1, -3, 5, '#78716c'], [6, -2, 3.6, '#a8a29e'], [-3, -7, 3.6, '#a8a29e'], [3, -7.6, 3, '#9ca3af'], [0, -11, 2.6, '#78716c']].forEach(([cx, cy, r, f]) => {
        g.appendChild(el('path', { d: `M ${cx - r} ${cy + r * 0.6} L ${cx - r * 0.5} ${cy - r * 0.7} L ${cx + r * 0.6} ${cy - r * 0.8} L ${cx + r} ${cy + r * 0.5} Z`, fill: f, stroke: '#57534e', 'stroke-width': 0.5 }));
      });
      g.appendChild(el('path', { d: 'M -9 -4 L 9 -9', stroke: '#7c2d12', 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
    }
  };
  const FOOTBALL_FOES = g => {
    g.appendChild(el('rect', { x: -2.4, y: -7, width: 2, height: 7, fill: '#f1f5f9' }));
    g.appendChild(el('rect', { x: 0.4, y: -7, width: 2, height: 7, fill: '#f1f5f9' }));
    g.appendChild(el('rect', { x: -4.2, y: -17, width: 8.4, height: 11, rx: 2.6, fill: '#1e88e5', stroke: '#0d47a1', 'stroke-width': 0.6 }));
    g.appendChild(el('path', { d: 'M -4 -15 L -8 -10 M 4 -15 L 8 -10', stroke: '#ffd9ae', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
    g.appendChild(el('circle', { cx: 0, cy: -20.5, r: 3.6, fill: '#ffd9ae', stroke: '#1f2937', 'stroke-width': 0.5 }));
    g.appendChild(el('path', { d: 'M -2 -21.5 L -0.6 -21 M 2 -21.5 L 0.6 -21', stroke: '#1f2937', 'stroke-width': 0.6 }));
  };
  const CASTLE_FOES = (g, k) => {
    if (k % 2 === 0) {
      [-9, 9].forEach(fx => g.appendChild(el('ellipse', { cx: fx, cy: -3, rx: 5, ry: 4, fill: '#3f9440', stroke: '#1f5a24', 'stroke-width': 0.6 })));
      g.appendChild(el('ellipse', { cx: 0, cy: -8, rx: 11, ry: 8, fill: '#4fae4a', stroke: '#1f5a24', 'stroke-width': 0.8 }));
      g.appendChild(el('ellipse', { cx: 0, cy: -5, rx: 7, ry: 4.4, fill: '#e3efb0' }));
      g.appendChild(el('ellipse', { class: 'journey-frog-sac', cx: 0, cy: -2, rx: 3.4, ry: 2.2, fill: '#f2f5c8' }));
      [-4.6, 4.6].forEach(ex => {
        g.appendChild(el('circle', { cx: ex, cy: -15, r: 3.6, fill: '#4fae4a', stroke: '#1f5a24', 'stroke-width': 0.6 }));
        g.appendChild(el('circle', { cx: ex, cy: -15.4, r: 2.4, fill: '#ffffff' }));
        g.appendChild(el('circle', { cx: ex + 0.3, cy: -15, r: 1.2, fill: '#111111' }));
      });
      g.appendChild(el('path', { d: 'M -2.6 -16.6 L -2.6 -19.6 L -1.3 -18 L 0 -20.2 L 1.3 -18 L 2.6 -19.6 L 2.6 -16.6 Z', fill: '#f2c14e' }));
    } else {
      // a black knight mini-boss
      g.appendChild(el('rect', { x: -3.4, y: -8, width: 2.6, height: 8, fill: '#334155' }));
      g.appendChild(el('rect', { x: 0.8, y: -8, width: 2.6, height: 8, fill: '#334155' }));
      g.appendChild(el('rect', { x: -5.4, y: -19, width: 10.8, height: 12, rx: 3, fill: '#1e293b', stroke: '#0f172a', 'stroke-width': 0.6 }));
      g.appendChild(el('path', { d: 'M -5 -17 L -11 -9 L -9 -8 Z', fill: '#7f1d1d' }));
      g.appendChild(el('circle', { cx: 0, cy: -23, r: 4.8, fill: '#334155', stroke: '#0f172a', 'stroke-width': 0.6 }));
      g.appendChild(el('rect', { x: -3.4, y: -23.6, width: 6.8, height: 1.4, fill: '#ef4444' }));
      g.appendChild(el('path', { d: 'M 0 -28 L 1.6 -32 L 3 -28 Z', fill: '#ef4444' }));
      g.appendChild(el('path', { d: 'M 6 -6 L 8 -22 L 9.4 -22 L 8 -6 Z', fill: '#cbd5e1', stroke: '#475569', 'stroke-width': 0.4 }));
      g.appendChild(el('rect', { x: 5, y: -7, width: 5.4, height: 1.4, fill: '#7f1d1d' }));
    }
  };

  // ════════════════════════════════════════════════════════════════
  // THEME: SPRINT — "The Final". An Olympic stadium seen from above: an
  // eight-lane red track round a green infield, the stands full. You run
  // lane 1 most of a lap, from the start of the back straight round the
  // bend to the finish line at the end of the home straight; everyone
  // racing you runs their own lane. Tasks are split-time boards by the
  // track, blockers are hurdles, and the finish has a photo-finish board
  // and a tape to break.
  // ════════════════════════════════════════════════════════════════
  // The track's shape for a layout: a stadium (two straights joined by
  // half circles) round (cx, cy). Lane 1's line is at radius r1 from the
  // straights' centre line; each lane is laneW wide, eight in all.
  function sprintGeom(layout) {
    return layout === LAYOUTS.tall
      ? { vertical: true, cx: 210, cy: 404, L: 168, r1: 82, laneW: 11 }
      : { vertical: false, cx: 400, cy: 276, L: 212, r1: 86, laneW: 11 };
  }
  const SPRINT_LANES = 8;
  // A point at distance s along your run, at radius r. Wide: left along
  // the top (back) straight, round the left bend, right along the bottom
  // (home) straight. Tall: down the left, round the bottom, up the right.
  function sprintPoint(g, s, r) {
    const { cx, cy, L } = g;
    const bend = Math.PI * r;
    if (!g.vertical) {
      if (s <= 2 * L) return { x: cx + L - s, y: cy - r };
      if (s <= 2 * L + bend) { const a = -Math.PI / 2 - (s - 2 * L) / r; return { x: cx - L + r * Math.cos(a), y: cy + r * Math.sin(a) }; }
      return { x: cx - L + (s - 2 * L - bend), y: cy + r };
    }
    if (s <= 2 * L) return { x: cx - r, y: cy - L + s };
    if (s <= 2 * L + bend) { const a = Math.PI - (s - 2 * L) / r; return { x: cx + r * Math.cos(a), y: cy + L + r * Math.sin(a) }; }
    return { x: cx + r, y: cy + L - (s - 2 * L - bend) };
  }
  const sprintRunLength = g => 4 * g.L + Math.PI * g.r1;
  // The run as dense waypoints, so the shared spline follows the oval.
  function sprintPoints(layout) {
    const g = sprintGeom(layout);
    const total = sprintRunLength(g), steps = 64;
    return Array.from({ length: steps + 1 }, (_, i) => sprintPoint(g, (i / steps) * total, g.r1));
  }
  // Out from the track's centre line: the direction a higher lane lies in.
  function sprintOutward(g, p) {
    const q = g.vertical ? { x: g.cx, y: Math.max(g.cy - g.L, Math.min(g.cy + g.L, p.y)) } : { x: Math.max(g.cx - g.L, Math.min(g.cx + g.L, p.x)), y: g.cy };
    const d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
    return { x: (p.x - q.x) / d, y: (p.y - q.y) / d };
  }
  // A rival's spot: the same distance round as lane 1's point, `lane`
  // lanes out (0 is lane 1).
  function sprintLanePoint(layoutKey, p, lane) {
    const g = sprintGeom(layoutKey === 'tall' ? LAYOUTS.tall : LAYOUTS.wide);
    const o = sprintOutward(g, p);
    return { x: p.x + o.x * lane * g.laneW, y: p.y + o.y * lane * g.laneW };
  }
  // The stadium outline at radius r, as a path.
  function sprintRing(g, r) {
    const { cx, cy, L } = g;
    return g.vertical
      ? `M ${cx - r} ${cy - L} L ${cx - r} ${cy + L} A ${r} ${r} 0 0 0 ${cx + r} ${cy + L} L ${cx + r} ${cy - L} A ${r} ${r} 0 0 0 ${cx - r} ${cy - L} Z`
      : `M ${cx + L} ${cy - r} L ${cx - L} ${cy - r} A ${r} ${r} 0 0 0 ${cx - L} ${cy + r} L ${cx + L} ${cy + r} A ${r} ${r} 0 0 0 ${cx + L} ${cy - r} Z`;
  }
  let sprintLayout = LAYOUTS.wide; // the layout being built, for the finish
  function sprintDecorate(svg, layout, glowId, glowLgId) {
    sprintLayout = layout;
    const { w, h } = layout;
    const g = sprintGeom(layout);
    const rin = g.r1 - g.laneW / 2, rout = rin + SPRINT_LANES * g.laneW;
    // The stands all round, then a concourse, then the track and infield.
    svg.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: '#1e293b' }));
    const kit = ['#e53935', '#ffffff', '#1e88e5', '#fdd835', '#10b981', '#f97316'];
    const rows = g.vertical ? [[0, 0, w, 40], [0, h - 22, w, 22]] : [[0, 0, w, 44], [0, h - 26, w, 26]];
    rows.forEach(([x, y, rw, rh]) => {
      const fans = Math.round(rw / 11);
      for (let row = 0; row < Math.floor(rh / 11); row++) {
        for (let i = 0; i < fans; i++) {
          svg.appendChild(el('circle', {
            class: 'journey-crowd-bob', cx: x + (i + 0.5 + (row % 2) * 0.5) * (rw / fans), cy: y + 6 + row * 11, r: 3,
            fill: kit[(i * 7 + row * 3) % kit.length], opacity: 0.9, style: `animation-delay:${(((i + row) % 9) * 0.13).toFixed(2)}s`,
          }));
        }
      }
    });
    svg.appendChild(el('path', { d: sprintRing(g, rout + 12), fill: '#475569' }));
    svg.appendChild(el('path', { d: sprintRing(g, rout + 2), fill: '#9a3412' }));
    svg.appendChild(el('path', { d: sprintRing(g, rout), fill: '#c2410c' }));
    // The infield, in mown stripes, with a long-jump pit and a throws circle.
    const clipId = `sprint-infield-${++uid}`;
    const clip = el('clipPath', { id: clipId });
    clip.appendChild(el('path', { d: sprintRing(g, rin) }));
    svg.appendChild(clip);
    const field = el('g', { 'clip-path': `url(#${clipId})` });
    for (let i = 0; i < 16; i++) {
      field.appendChild(g.vertical
        ? el('rect', { x: 0, y: g.cy - g.L - rin + i * ((2 * (g.L + rin)) / 16), width: w, height: (2 * (g.L + rin)) / 16 + 1, fill: i % 2 ? '#3f9d4a' : '#46a852' })
        : el('rect', { x: g.cx - g.L - rin + i * ((2 * (g.L + rin)) / 16), y: 0, width: (2 * (g.L + rin)) / 16 + 1, height: h, fill: i % 2 ? '#3f9d4a' : '#46a852' }));
    }
    svg.appendChild(field);
    svg.appendChild(el('path', { d: sprintRing(g, rin), fill: 'none', stroke: '#e2e8f0', 'stroke-width': 1.6 }));
    const pit = g.vertical ? { x: g.cx - 12, y: g.cy - 60, w: 24, h: 70 } : { x: g.cx - 70, y: g.cy - 12, w: 90, h: 24 };
    svg.appendChild(el('rect', { x: pit.x, y: pit.y, width: pit.w, height: pit.h, rx: 3, fill: '#e9d5a1', stroke: '#b45309', 'stroke-width': 0.8 }));
    const throwAt = g.vertical ? { x: g.cx, y: g.cy + 70 } : { x: g.cx + 90, y: g.cy };
    svg.appendChild(el('circle', { cx: throwAt.x, cy: throwAt.y, r: 9, fill: '#94a3b8', stroke: '#ffffff', 'stroke-width': 1.2 }));
    svg.appendChild(el('path', { d: g.vertical ? `M ${throwAt.x} ${throwAt.y + 9} L ${throwAt.x - 30} ${throwAt.y + 70} M ${throwAt.x} ${throwAt.y + 9} L ${throwAt.x + 30} ${throwAt.y + 70}` : `M ${throwAt.x + 9} ${throwAt.y} L ${throwAt.x + 80} ${throwAt.y - 34} M ${throwAt.x + 9} ${throwAt.y} L ${throwAt.x + 80} ${throwAt.y + 34}`, fill: 'none', stroke: '#ffffff', 'stroke-width': 1, opacity: 0.6 }));
    // The lane lines, and the numbers at the start.
    for (let i = 1; i <= SPRINT_LANES; i++) svg.appendChild(el('path', { d: sprintRing(g, rin + i * g.laneW), fill: 'none', stroke: '#ffffff', 'stroke-width': 0.9, opacity: 0.85 }));
    const total = sprintRunLength(g);
    for (let lane = 0; lane < SPRINT_LANES; lane++) {
      const p = sprintPoint(g, 6, g.r1 + lane * g.laneW);
      const t = el('text', { x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 6.5, 'font-weight': 800, fill: '#ffffff', opacity: 0.9, 'font-family': 'Arial, sans-serif' });
      t.textContent = String(lane + 1);
      svg.appendChild(t);
    }
    // The start and finish lines, across every lane: lane 1's point
    // pushed out (the bends are longer further out, so the same distance
    // along an outer lane would land somewhere else).
    const across = (s, r) => { const p = sprintPoint(g, s, g.r1), o = sprintOutward(g, p); return { x: p.x + o.x * (r - g.r1), y: p.y + o.y * (r - g.r1) }; };
    const s0 = across(0, rin), s1 = across(0, rout);
    svg.appendChild(el('line', { x1: s0.x, y1: s0.y, x2: s1.x, y2: s1.y, stroke: '#ffffff', 'stroke-width': 2.4 }));
    const f0 = across(total, rin), f1 = across(total, rout);
    const sq = 3;
    const cells = Math.round(Math.hypot(f1.x - f0.x, f1.y - f0.y) / sq);
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < 2; j++) {
        const x = g.vertical ? f0.x + i * sq : f0.x - sq + j * sq, y = g.vertical ? f0.y - sq + j * sq : f0.y + i * sq;
        svg.appendChild(el('rect', { x, y, width: sq, height: sq, fill: (i + j) % 2 ? '#111827' : '#ffffff' }));
      }
    }
    // Floodlights, and their glow on the track.
    const lights = g.vertical ? [[16, 52], [w - 16, 52], [16, h - 36], [w - 16, h - 36]] : [[22, 56], [w - 22, 56], [22, h - 36], [w - 22, h - 36]];
    lights.forEach(([x, y]) => {
      svg.appendChild(el('circle', { cx: x, cy: y, r: 46, fill: '#fff7c2', opacity: 0.14, filter: glowLgId ? `url(#${glowLgId})` : undefined }));
      svg.appendChild(el('rect', { x: x - 11, y: y - 7, width: 22, height: 14, rx: 2, fill: '#334155', stroke: '#0f172a', 'stroke-width': 0.8 }));
      for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) svg.appendChild(el('rect', { x: x - 9 + i * 4.7, y: y - 5 + r * 5.2, width: 3.6, height: 4, rx: 0.8, fill: '#fffbe0' }));
      svg.appendChild(el('circle', { cx: x, cy: y, r: 16, fill: '#fff7c2', opacity: 0.45, filter: glowId ? `url(#${glowId})` : undefined }));
    });
  }
  // Little touches on the infield: a few marker cones and a spare hurdle.
  function sprintScatter(layer, layout, isClear, rand) {
    const g = sprintGeom(layout);
    const rin = g.r1 - g.laneW / 2;
    scatterProps(layer, layout, (x, y, m) => {
      const q = g.vertical ? { x: g.cx, y: Math.max(g.cy - g.L, Math.min(g.cy + g.L, y)) } : { x: Math.max(g.cx - g.L, Math.min(g.cx + g.L, x)), y: g.cy };
      return Math.hypot(x - q.x, y - q.y) < rin - 16 && isClear(x, y, m);
    }, rand, {
      count: 4, margin: 8, spacing: 50,
      draw(gr, v) {
        gr.appendChild(el('ellipse', { cx: 1, cy: 1, rx: 5, ry: 1.6, fill: '#0b1220', opacity: 0.25 }));
        if (v < 0.6) {
          gr.appendChild(el('path', { d: 'M -4 0 L -1.3 -8 L 1.3 -8 L 4 0 Z', fill: '#f97316', stroke: '#9a3412', 'stroke-width': 0.5 }));
        } else {
          sprintHurdle(gr, 0.7);
        }
      },
    });
  }
  // A hurdle: two feet, two posts and a striped top bar.
  function sprintHurdle(gr, k = 1) {
    [-7, 7].forEach(x => {
      gr.appendChild(el('rect', { x: (x - 2.4) * k, y: -1 * k, width: 4.8 * k, height: 1.6 * k, fill: '#334155' }));
      gr.appendChild(el('rect', { x: (x - 0.6) * k, y: -12 * k, width: 1.2 * k, height: 12 * k, fill: '#cbd5e1' }));
    });
    gr.appendChild(el('rect', { x: -9 * k, y: -15 * k, width: 18 * k, height: 3.6 * k, fill: '#ffffff', stroke: '#111827', 'stroke-width': 0.4 * k }));
    for (let x = -9; x < 9; x += 6) gr.appendChild(el('rect', { x: x * k, y: -15 * k, width: 3 * k, height: 3.6 * k, fill: '#111827' }));
  }
  // A sprinter: singlet in their colour with a race bib, black shorts,
  // spikes, a headband; the shared limb rig swings arms and legs.
  function sprintBuildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 2, cy: 24, rx: 15, ry: 3.4, fill: '#0b1220', opacity: 0.28 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    bob.appendChild(avatarLimb('journey-leg-back', '#8d5524', -3.4, 9, 3.8, 10.5, 3.4, 1.6, '#f8fafc'));
    bob.appendChild(avatarLimb('journey-arm-back', '#8d5524', -7.2, -4, 3.4, 9, 1.8, 1.8, '#8d5524'));
    bob.appendChild(el('rect', { x: -7.8, y: -9.5, width: 15.6, height: 14, rx: 5.5, fill, stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('rect', { x: -7.6, y: 3, width: 15.2, height: 6.5, rx: 2.4, fill: '#111827' }));
    bob.appendChild(el('rect', { x: -4.6, y: -6.4, width: 9.2, height: 7, rx: 1, fill: '#ffffff', stroke: '#1f2937', 'stroke-width': 0.5 }));
    const num = el('text', { class: 'journey-unflip', x: 0, y: -2.7, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 5, 'font-weight': 900, fill: '#111827', 'font-family': 'Arial, sans-serif' });
    num.textContent = '1';
    bob.appendChild(num);
    bob.appendChild(avatarLimb('journey-leg-front', '#9a6230', 3.4, 9, 3.8, 10.5, 3.4, 1.6, '#f8fafc'));
    bob.appendChild(avatarLimb('journey-arm-front', '#9a6230', 7.2, -4, 3.4, 9, 1.8, 1.8, '#9a6230'));
    const head = el('g', { transform: 'translate(0,-17.5)' });
    head.appendChild(el('circle', { cx: 0, cy: 0, r: 8.2, fill: '#9a6230', stroke: '#1f2937', 'stroke-width': 1 }));
    head.appendChild(el('path', { d: 'M -8.2 -2 Q -8.4 -9.6 0 -9.6 Q 8.4 -9.6 8.2 -2 Q 6 -6.4 0 -6.6 Q -6 -6.4 -8.2 -2 Z', fill: '#111827' }));
    head.appendChild(el('rect', { x: -8.4, y: -5.2, width: 16.8, height: 2.4, rx: 1, fill }));
    [[-3, 0.6], [3, 0.6]].forEach(([ex, ey]) => {
      head.appendChild(el('ellipse', { cx: ex, cy: ey, rx: 1.6, ry: 2, fill: '#ffffff' }));
      head.appendChild(el('circle', { cx: ex + 0.3, cy: ey + 0.4, r: 1, fill: '#1f2937' }));
    });
    head.appendChild(el('path', { d: 'M -2.2 4.2 Q 0 5.8 2.2 4.2', fill: 'none', stroke: '#1f2937', 'stroke-width': 1, 'stroke-linecap': 'round' }));
    bob.appendChild(head);
    g.appendChild(bob);
    return g;
  }
  // The finish: a tape across the lanes (it breaks when you cross it), a
  // photo-finish camera on its tower and a board that reads FINISH.
  function sprintBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const g = sprintGeom(sprintLayout);
    const span = (SPRINT_LANES - 0.5) * g.laneW;
    const out = g.vertical ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const grp = el('g', { transform: `translate(${x},${y})` });
    grp.appendChild(el('circle', { cx: 0, cy: 0, r: 30, fill: '#fff7c2', opacity: 0.28, filter: glowId ? `url(#${glowId})` : undefined }));
    // the tape, from just inside lane 1 to the outside of lane 8
    const x0 = -out.x * g.laneW * 0.6, y0 = -out.y * g.laneW * 0.6;
    const tape = el('g', { class: 'journey-sprint-tape' });
    tape.appendChild(el('line', { x1: x0, y1: y0 - 6, x2: out.x * span, y2: out.y * span - 6, stroke: '#ef4444', 'stroke-width': 1.8 }));
    [[x0, y0], [out.x * span, out.y * span]].forEach(([px, py]) => {
      tape.appendChild(el('rect', { x: px - 0.8, y: py - 12, width: 1.6, height: 12, fill: '#e2e8f0' }));
    });
    grp.appendChild(tape);
    // the camera tower and board, just off the track on the infield side
    const bx = -out.x * 26, by = -out.y * 26;
    const board = el('g', { transform: `translate(${bx},${by})`, filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    board.appendChild(el('rect', { x: -1.2, y: -26, width: 2.4, height: 26, fill: '#64748b' }));
    board.appendChild(el('rect', { x: -19, y: -40, width: 38, height: 15, rx: 2, fill: '#0f172a', stroke: '#fbbf24', 'stroke-width': 1 }));
    const t = el('text', { x: 0, y: -32.2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 7.6, 'font-weight': 900, fill: '#fbbf24', 'font-family': '"Courier New", monospace', 'letter-spacing': 0.6 });
    t.textContent = 'FINISH';
    board.appendChild(t);
    board.appendChild(el('rect', { x: 4, y: -48, width: 10, height: 7, rx: 1.4, fill: '#1f2937' }));
    board.appendChild(el('circle', { cx: 9, cy: -44.5, r: 2.4, fill: '#38bdf8', stroke: '#0f172a', 'stroke-width': 0.6 }));
    grp.appendChild(board);
    return grp;
  }
  // A split board by the track for each task: a post with a timing board,
  // coloured by status, showing its number (or a tick).
  function sprintBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 0, cy: -20 * s, r: 14 * s, fill: NEXT_COLOR, opacity: 0.5 }));
    g.appendChild(el('ellipse', { cx: 1.5 * s, cy: 0.5 * s, rx: 5 * s, ry: 1.6 * s, fill: '#0b1220', opacity: 0.25 }));
    g.appendChild(el('rect', { x: -0.9 * s, y: -18 * s, width: 1.8 * s, height: 18 * s, fill: '#cbd5e1', stroke: '#475569', 'stroke-width': 0.4 * s }));
    const board = el('rect', {
      x: -8 * s, y: -30 * s, width: 16 * s, height: 12 * s, rx: 2 * s, fill: color, stroke: '#1f2937', 'stroke-width': 0.7 * s,
      filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined,
    });
    g.appendChild(board);
    g.appendChild(el('rect', { x: -6.6 * s, y: -28.8 * s, width: 13.2 * s, height: 3 * s, rx: 1 * s, fill: '#ffffff', opacity: 0.35 }));
    const label = el('text', {
      x: 0, y: -23.6 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 7 * s, 'font-weight': 900, fill: '#1f2937', 'font-family': 'Arial, sans-serif',
    });
    label.textContent = isDone ? '✓' : String(i + 1);
    g.appendChild(label);
    if (blocked) g.appendChild(drawFoes(blocked, s, SPRINT_FOES));
    return g;
  }
  // Breaking the tape: the tape snaps, the photo-finish camera flashes,
  // the crowd jumps up and the board calls it.
  function sprintCelebrateFinish(entry, from, scale, burst) {
    entry.shotPending = false;
    const tape = entry.svg.querySelector('.journey-sprint-tape');
    if (tape) tape.style.display = 'none';
    const flash = el('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: '#ffffff', opacity: 0.85, 'pointer-events': 'none' });
    entry.svg.insertBefore(flash, entry.vignette);
    flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 450, easing: 'ease-out' }).onfinish = () => flash.remove();
    entry.svg.classList.add('journey-cheer');
    setTimeout(() => entry.svg.classList.remove('journey-cheer'), 3200);
    finishFlourish(entry, 'PERSONAL BEST!', '#fde047', '#b91c1c', ['#fde047', '#ef4444', '#ffffff']);
    burst();
  }
  // Blockers on the track: a hurdle, and a steeplechase barrier with its
  // water pit, in turn.
  const SPRINT_FOES = (g, k) => {
    if (k % 2 === 0) { sprintHurdle(g, 1); return; }
    g.appendChild(el('ellipse', { cx: 6, cy: 1, rx: 12, ry: 3.4, fill: '#38bdf8', opacity: 0.75 }));
    [-9, 9].forEach(x => g.appendChild(el('rect', { x: x - 1.2, y: -12, width: 2.4, height: 12, fill: '#e2e8f0', stroke: '#475569', 'stroke-width': 0.4 })));
    g.appendChild(el('rect', { x: -11, y: -15, width: 22, height: 5, rx: 1, fill: '#f8fafc', stroke: '#111827', 'stroke-width': 0.5 }));
    for (let x = -11; x < 11; x += 5.5) g.appendChild(el('rect', { x, y: -15, width: 2.75, height: 5, fill: '#111827' }));
  };

  // ════════════════════════════════════════════════════════════════
  // THEME: MOUNTAIN — "The Summit". Looking up a winding trail towards a
  // snow-capped peak, the hiker seen from behind. The trail narrows as it
  // climbs and everything on it gets smaller with distance (theme.depth),
  // so the summit really is a long way up.
  // ════════════════════════════════════════════════════════════════
  const MOUNTAIN_KNOTS = {
    wide: [[410, 474], [250, 432], [560, 382], [300, 330], [520, 286], [350, 246], [480, 210], [380, 178], [450, 150], [415, 126]],
    tall: [[210, 752], [70, 660], [350, 578], [90, 494], [320, 424], [130, 362], [280, 310], [170, 268], [250, 234], [205, 206]],
  };
  const mountainKey = layout => (layout === LAYOUTS.tall ? 'tall' : 'wide');
  // How big things are at a height on screen: full size at the bottom,
  // a third at the summit.
  function mountainDepthAt(layoutKey, y) {
    const k = MOUNTAIN_KNOTS[layoutKey];
    const top = k[k.length - 1][1], bottom = k[0][1];
    const t = Math.max(0, Math.min(1, (y - top) / (bottom - top)));
    return 0.34 + 0.72 * t;
  }
  // The trail as dense points along the same smooth curve the engine
  // draws (pathD's Catmull-Rom), so the tapered trail under it matches.
  function mountainPoints(layout) {
    const k = MOUNTAIN_KNOTS[mountainKey(layout)].map(([x, y]) => ({ x, y }));
    const out = [];
    for (let i = 0; i < k.length - 1; i++) {
      const p0 = k[i - 1] || k[i], p1 = k[i], p2 = k[i + 1], p3 = k[i + 2] || p2;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      for (let s = 0; s < 12; s++) {
        const t = s / 12, u = 1 - t;
        out.push({
          x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
          y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
        });
      }
    }
    out.push(k[k.length - 1]);
    return out;
  }
  // A tree, a pine or a round one, in the scene's greens.
  function mountainTree(g, v, k = 1) {
    if (v < 0.55) {
      g.appendChild(el('rect', { x: -1.4 * k, y: -6 * k, width: 2.8 * k, height: 6 * k, fill: '#6b4f2a' }));
      [[-22, 9], [-16, 7.4], [-10, 5.8]].forEach(([y, w], i) => g.appendChild(el('path', { d: `M ${-w * k} ${(y + 12) * k} L 0 ${(y - 2) * k} L ${w * k} ${(y + 12) * k} Z`, fill: ['#1f6f4a', '#26845a', '#2f9a68'][i] })));
    } else {
      g.appendChild(el('rect', { x: -1.4 * k, y: -8 * k, width: 2.8 * k, height: 8 * k, fill: '#6b4f2a' }));
      g.appendChild(el('circle', { cx: 0, cy: -14 * k, r: 8 * k, fill: v < 0.8 ? '#3f9d58' : '#c9c35a' }));
      g.appendChild(el('circle', { cx: -2.6 * k, cy: -16.4 * k, r: 3.4 * k, fill: '#ffffff', opacity: 0.16 }));
    }
  }
  function mountainDecorate(svg, layout, glowId) {
    const { w, h } = layout;
    const tall = layout === LAYOUTS.tall;
    const peak = tall ? { x: 205, y: 120 } : { x: 415, y: 40 };
    const base = tall ? 470 : 300; // where the mountain meets the meadow
    // sky
    const skyId = `mountain-sky-${++uid}`;
    const sky = el('linearGradient', { id: skyId, x1: 0, y1: 0, x2: 0, y2: 1 });
    [[0, '#9fd3f2'], [70, '#d8eefb'], [100, '#eef7ee']].forEach(([o, c]) => sky.appendChild(el('stop', { offset: `${o}%`, 'stop-color': c })));
    svg.appendChild(sky);
    svg.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${skyId})` }));
    // clouds
    (tall ? [[60, 70, 1], [340, 150, 0.8], [300, 40, 0.6]] : [[120, 50, 1.2], [690, 80, 1], [560, 30, 0.7]]).forEach(([x, y, s]) => {
      const c = el('g', { transform: `translate(${x},${y}) scale(${s})`, opacity: 0.95 });
      [[0, 0, 22], [20, -6, 18], [38, 2, 16], [-18, 4, 14]].forEach(([cx, cy, r]) => c.appendChild(el('circle', { cx, cy, r, fill: '#ffffff' })));
      svg.appendChild(c);
    });
    // distant ranges, paler with distance
    const range = (pts, fill) => svg.appendChild(el('path', { d: `M 0 ${h} L ${pts.map(([x, y]) => `${x} ${y}`).join(' L ')} L ${w} ${h} Z`, fill }));
    if (tall) {
      range([[0, 330], [60, 250], [120, 300], [170, 230], [220, 280], [300, 210], [360, 270], [420, 240]], '#b9cbd6');
      range([[0, 380], [80, 300], [150, 350], [260, 290], [330, 330], [420, 300]], '#9fb6c3');
    } else {
      range([[0, 220], [90, 150], [170, 200], [250, 130], [330, 190], [520, 120], [610, 170], [700, 110], [800, 170]], '#b9cbd6');
      range([[0, 250], [120, 180], [220, 230], [600, 190], [700, 230], [800, 200]], '#9fb6c3');
    }
    // the mountain: a lit face and a shadowed face, the snow cap, a few ridges
    const lx = tall ? -220 : -360, rx = tall ? 230 : 390;
    svg.appendChild(el('path', { d: `M ${peak.x + lx} ${base} L ${peak.x - 40} ${peak.y + 70} L ${peak.x} ${peak.y} L ${peak.x + 18} ${base} Z`, fill: '#7b86c9' }));
    svg.appendChild(el('path', { d: `M ${peak.x} ${peak.y} L ${peak.x + 46} ${peak.y + 60} L ${peak.x + 90} ${peak.y + 74} L ${peak.x + rx} ${base} L ${peak.x + 18} ${base} Z`, fill: '#5a64a8' }));
    svg.appendChild(el('path', { d: `M ${peak.x - 34} ${peak.y + 60} L ${peak.x} ${peak.y} L ${peak.x + 44} ${peak.y + 58} L ${peak.x + 26} ${peak.y + 50} L ${peak.x + 12} ${peak.y + 66} L ${peak.x - 4} ${peak.y + 48} L ${peak.x - 18} ${peak.y + 64} Z`, fill: '#ffffff' }));
    svg.appendChild(el('path', { d: `M ${peak.x + 44} ${peak.y + 58} L ${peak.x + 70} ${peak.y + 96} L ${peak.x + 58} ${peak.y + 92} L ${peak.x + 50} ${peak.y + 104} Z`, fill: '#eef2ff', opacity: 0.85 }));
    [[-90, 60, -150, 140], [60, 90, 120, 170], [-20, 120, -60, 190]].forEach(([x1, y1, x2, y2]) => svg.appendChild(el('path', { d: `M ${peak.x + x1} ${peak.y + y1} L ${peak.x + x2} ${peak.y + y2}`, stroke: '#4a5394', 'stroke-width': 2, opacity: 0.45, 'stroke-linecap': 'round' })));
    // the meadow: rolling slopes in two greens, then the foreground
    svg.appendChild(el('path', { d: `M 0 ${base + 10} Q ${w * 0.25} ${base - 30} ${w * 0.5} ${base + 4} T ${w} ${base - 10} L ${w} ${h} L 0 ${h} Z`, fill: '#9ccd5c' }));
    svg.appendChild(el('path', { d: `M 0 ${base + 70} Q ${w * 0.3} ${base + 30} ${w * 0.62} ${base + 64} T ${w} ${base + 50} L ${w} ${h} L 0 ${h} Z`, fill: '#86c04a' }));
    svg.appendChild(el('path', { d: `M 0 ${h - (tall ? 120 : 70)} Q ${w * 0.4} ${h - (tall ? 170 : 110)} ${w} ${h - (tall ? 110 : 60)} L ${w} ${h} L 0 ${h} Z`, fill: '#74b042' }));
    // the trail itself: wide at your feet, a thread near the top
    const pts = mountainPoints(layout);
    const key = mountainKey(layout);
    const left = [], right = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const hw = 23 * mountainDepthAt(key, p.y);
      left.push([p.x - (dy / d) * hw, p.y + (dx / d) * hw]);
      right.push([p.x + (dy / d) * hw, p.y - (dx / d) * hw]);
    });
    const ribbon = `M ${left.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} L ${right.reverse().map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`;
    svg.appendChild(el('path', { d: ribbon, fill: '#5d7a35', opacity: 0.35, transform: 'translate(0,3)' }));
    svg.appendChild(el('path', { d: ribbon, fill: '#efe3c8', stroke: '#c9b48a', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }));
    // a signpost, a tent and a log pile beside the trail, low on the slope
    const camp = tall ? { x: 340, y: 690 } : { x: 690, y: 420 };
    const tent = el('g', { transform: `translate(${camp.x},${camp.y})` });
    tent.appendChild(el('ellipse', { cx: 0, cy: 2, rx: 30, ry: 5, fill: '#3d6b22', opacity: 0.35 }));
    tent.appendChild(el('path', { d: 'M -26 0 L 0 -30 L 26 0 Z', fill: '#b91c1c' }));
    tent.appendChild(el('path', { d: 'M 0 -30 L 26 0 L 34 0 L 6 -30 Z', fill: '#7f1d1d' }));
    tent.appendChild(el('path', { d: 'M -6 0 L 0 -14 L 6 0 Z', fill: '#3f0d0d' }));
    [[-40, -4], [-36, -9], [-44, -9]].forEach(([x, y]) => tent.appendChild(el('rect', { x, y, width: 16, height: 5, rx: 2.5, fill: '#a0703f', stroke: '#6b4423', 'stroke-width': 0.6 })));
    svg.appendChild(tent);
    const sign = tall ? { x: 40, y: 600 } : { x: 160, y: 400 };
    const sp = el('g', { transform: `translate(${sign.x},${sign.y})` });
    sp.appendChild(el('rect', { x: -1.6, y: -26, width: 3.2, height: 26, fill: '#7c5a32' }));
    sp.appendChild(el('path', { d: 'M -2 -26 L 22 -26 L 28 -21 L 22 -16 L -2 -16 Z', fill: '#a8794a', stroke: '#6b4423', 'stroke-width': 0.8 }));
    const st = el('text', { x: 11, y: -20.6, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 5.4, 'font-weight': 800, fill: '#3b2a17', 'font-family': 'Arial, sans-serif' });
    st.textContent = 'SUMMIT';
    sp.appendChild(st);
    svg.appendChild(sp);
    // wild flowers along the bottom edge
    for (let i = 0; i < (tall ? 26 : 40); i++) {
      const x = (i * 97.3) % w, y = h - 6 - ((i * 37) % (tall ? 60 : 40));
      const c = ['#ffffff', '#c084fc', '#facc15', '#f472b6', '#a78bfa'][i % 5];
      svg.appendChild(el('path', { d: `M ${x} ${y + 8} L ${x} ${y}`, stroke: '#3f7a2a', 'stroke-width': 1 }));
      svg.appendChild(el('circle', { cx: x, cy: y, r: 2.6, fill: c }));
      svg.appendChild(el('circle', { cx: x, cy: y, r: 0.9, fill: '#f59e0b' }));
    }
  }
  // Trees all over the slopes, smaller further up (scatterProps scales by
  // height), kept off the trail.
  function mountainScatter(layer, layout, isClear, rand) {
    const tall = layout === LAYOUTS.tall;
    const minY = tall ? 260 : 170;
    scatterProps(layer, layout, (x, y, m) => {
      // not on the mountain's rock, only the green slopes
      return y > (tall ? 330 : 200) && isClear(x, y, m);
    }, rand, { count: tall ? 34 : 46, margin: 16, spacing: 24, minScale: 0.32, minY, sway: true, draw: (g, v) => mountainTree(g, v) });
  }
  // A hiker seen from behind: a big rucksack with a bedroll, a jacket in
  // their colour, a beanie, and a walking pole. No face: you're behind them.
  function mountainBuildAvatar(fill, shadowFilterId) {
    const g = el('g', { class: 'journey-avatar' });
    g.appendChild(el('ellipse', { cx: 0, cy: 24, rx: 13, ry: 3.2, fill: '#1f3a12', opacity: 0.3 }));
    const bob = el('g', { class: 'journey-avatar-bob', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    bob.appendChild(avatarLimb('journey-leg-back', '#334155', -3.6, 8, 4.4, 11, 3.6, 1.8, '#5b3a1e'));
    bob.appendChild(avatarLimb('journey-leg-front', '#3f4c63', 3.6, 8, 4.4, 11, 3.6, 1.8, '#5b3a1e'));
    // the pole, in the right hand
    bob.appendChild(el('path', { d: 'M 11 -2 L 15 23', stroke: '#475569', 'stroke-width': 1.3, 'stroke-linecap': 'round' }));
    bob.appendChild(avatarLimb('journey-arm-back', fill, -9, -6, 3.8, 10, 2, 2, '#e0ac69'));
    bob.appendChild(avatarLimb('journey-arm-front', fill, 9, -6, 3.8, 10, 2, 2, '#e0ac69'));
    // jacket, then the rucksack over it
    bob.appendChild(el('rect', { x: -9, y: -10, width: 18, height: 19, rx: 6, fill, stroke: '#1f2937', 'stroke-width': 1 }));
    bob.appendChild(el('rect', { x: -7.6, y: -12.5, width: 15.2, height: 17.5, rx: 4.5, fill: '#b45309', stroke: '#5b2c0a', 'stroke-width': 1 }));
    bob.appendChild(el('rect', { x: -5.4, y: -3.6, width: 10.8, height: 6.4, rx: 2, fill: '#92400e', stroke: '#5b2c0a', 'stroke-width': 0.6 }));
    bob.appendChild(el('path', { d: 'M -7.6 -8 L 7.6 -8', stroke: '#5b2c0a', 'stroke-width': 0.8 }));
    bob.appendChild(el('rect', { x: -9, y: -16.5, width: 18, height: 5.2, rx: 2.6, fill: '#15803d', stroke: '#14532d', 'stroke-width': 0.7 }));
    // head from behind: hair and a beanie with a bobble
    const head = el('g', { transform: 'translate(0,-21)' });
    head.appendChild(el('circle', { cx: 0, cy: 0, r: 7.4, fill: '#4a2c17', stroke: '#1f2937', 'stroke-width': 1 }));
    head.appendChild(el('path', { d: 'M -7.6 -1 Q -7.6 -8.6 0 -8.6 Q 7.6 -8.6 7.6 -1 Z', fill: '#dc2626', stroke: '#1f2937', 'stroke-width': 0.8 }));
    head.appendChild(el('rect', { x: -7.8, y: -2.4, width: 15.6, height: 2.6, rx: 1.2, fill: '#fca5a5' }));
    head.appendChild(el('circle', { cx: 0, cy: -9.6, r: 2.4, fill: '#fef3c7', stroke: '#1f2937', 'stroke-width': 0.6 }));
    bob.appendChild(head);
    g.appendChild(bob);
    return g;
  }
  // The summit: a big orange flag on the peak, glowing.
  function mountainBuildGoal(x, y, gradId, shadowFilterId, glowId) {
    const grp = el('g', { transform: `translate(${x},${y})` });
    grp.appendChild(el('circle', { cx: 0, cy: -10, r: 26, fill: '#fff7c2', opacity: 0.4, filter: glowId ? `url(#${glowId})` : undefined }));
    const f = el('g', { class: 'journey-summit-flag', filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined });
    f.appendChild(el('rect', { x: -0.9, y: -34, width: 1.8, height: 34, fill: '#374151' }));
    f.appendChild(el('path', { class: 'journey-flag-cloth', d: 'M 0.9 -34 Q 10 -37 18 -32 Q 24 -29 30 -31 L 26 -24 L 30 -17 Q 22 -15 14 -19 Q 8 -22 0.9 -20 Z', fill: 'url(#' + gradId + ')', stroke: '#c2410c', 'stroke-width': 0.8 }));
    f.appendChild(el('circle', { cx: 0, cy: 0, r: 4, fill: '#ffffff', stroke: '#ef4444', 'stroke-width': 2 }));
    grp.appendChild(f);
    return grp;
  }
  // A trail marker for each task: a white disc with a coloured centre on the
  // trail, and a blue pennant beside it.
  function mountainBuildCheckpoint(i, isDone, isNext, blocked, scale, shadowFilterId) {
    const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
    const s = scale;
    const g = el('g', { class: 'journey-flag' });
    if (isNext) g.appendChild(el('circle', { class: 'journey-next-glow', cx: 0, cy: -2 * s, r: 16 * s, fill: NEXT_COLOR, opacity: 0.45 }));
    g.appendChild(el('rect', { x: 5 * s, y: -30 * s, width: 1.6 * s, height: 26 * s, fill: '#475569' }));
    g.appendChild(el('path', { d: `M ${6.6 * s} ${-30 * s} L ${20 * s} ${-26 * s} L ${6.6 * s} ${-21 * s} Z`, fill: isDone ? '#16a34a' : '#3b82f6', stroke: '#1e3a8a', 'stroke-width': 0.5 * s }));
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 8 * s, fill: '#ffffff', stroke: '#cbd5e1', 'stroke-width': 1 * s, filter: shadowFilterId ? `url(#${shadowFilterId})` : undefined }));
    g.appendChild(el('circle', { cx: 0, cy: 0, r: 5.2 * s, fill: color }));
    const label = el('text', { x: 0, y: 0.4 * s, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 6 * s, 'font-weight': 900, fill: '#1f2937', 'font-family': 'Arial, sans-serif' });
    label.textContent = isDone ? '✓' : String(i + 1);
    g.appendChild(label);
    if (blocked) g.appendChild(drawFoes(blocked, s, MOUNTAIN_FOES));
    return g;
  }
  // Blockers on the trail: a rockfall, a fallen log and a storm cloud, in turn.
  const MOUNTAIN_FOES = (g, k) => {
    if (k % 3 === 0) {
      [[-7, 0, 6.5], [5, 1, 5.5], [-1, -7, 5]].forEach(([x, y, r]) => g.appendChild(el('path', { d: `M ${x - r} ${y + r * 0.6} L ${x - r * 0.6} ${y - r * 0.7} L ${x + r * 0.5} ${y - r} L ${x + r} ${y + r * 0.2} L ${x + r * 0.4} ${y + r * 0.8} Z`, fill: '#94a3b8', stroke: '#475569', 'stroke-width': 0.8 })));
    } else if (k % 3 === 1) {
      g.appendChild(el('rect', { x: -14, y: -6, width: 28, height: 7, rx: 3.5, fill: '#8b5a2b', stroke: '#5b3a1e', 'stroke-width': 0.8 }));
      g.appendChild(el('circle', { cx: 14, cy: -2.5, r: 3.5, fill: '#d4a373', stroke: '#5b3a1e', 'stroke-width': 0.8 }));
      g.appendChild(el('path', { d: 'M -4 -6 L -7 -12 M 4 -6 L 6 -11', stroke: '#5b3a1e', 'stroke-width': 1.2, 'stroke-linecap': 'round' }));
    } else {
      [[-6, -14, 7], [3, -16, 8], [10, -13, 6]].forEach(([x, y, r]) => g.appendChild(el('circle', { cx: x, cy: y, r, fill: '#64748b' })));
      g.appendChild(el('path', { d: 'M 1 -9 L -3 -2 L 1 -2 L -2 5', stroke: '#fde047', 'stroke-width': 1.6, fill: 'none', 'stroke-linejoin': 'round' }));
      [-6, 6].forEach(x => g.appendChild(el('path', { d: `M ${x} -7 L ${x - 1.5} -2`, stroke: '#7dd3fc', 'stroke-width': 1, 'stroke-linecap': 'round' })));
    }
  };
  // Reaching the summit: the flag waves hard, the sky flashes gold.
  function mountainCelebrateFinish(entry, from, scale, burst) {
    entry.shotPending = false;
    const flag = entry.svg.querySelector('.journey-summit-flag');
    if (flag) flag.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1.2)' }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
    finishFlourish(entry, 'SUMMIT!', '#fde047', '#c2410c', ['#fb923c', '#fde047', '#ffffff', '#60a5fa']);
    burst();
  }

  // ════════════════════════════════════════════════════════════════
  // THEME REGISTRY — picked by app.js (Settings-free: a small selector
  // right in the Journey header, see index.html's #journey-theme-select)
  // and passed in as state.theme on every sync() call.
  // ════════════════════════════════════════════════════════════════
  const THEMES = {
    space: {
      label: 'Space', avatarFill: '#ef4444',
      sky: [[0, '#0f0a2e'], [50, '#2a1760'], [100, '#4b2e83']],
      goalGrad: [[0, '#ffe7b0'], [45, '#ffb24a'], [100, '#e8762b']],
      path: { outline: '#3347a8', fill: '#dfe6ff', dash: '#7dd3fc', progress: '#67e8f9' },
      decorate: spaceDecorate, scatter: spaceScatter, buildAvatar: spaceBuildAvatar, buildGoal: spaceBuildGoal, buildCheckpoint: spaceBuildCheckpoint, foes: SPACE_FOES,
      celebrateFinish: spaceCelebrateFinish,
    },
    football: {
      label: 'Football', avatarFill: '#e53935',
      sky: [[0, '#1e293b'], [6, '#4caf50'], [100, '#43a047']],
      goalGrad: [[0, '#fff2b8'], [55, '#ffcf3f'], [100, '#f5a623']],
      path: { outline: '#2e7d32', fill: '#8bc98e', dash: '#ffffff' },
      decorate: footballDecorate, scatter: footballScatter, buildAvatar: footballBuildAvatar, buildGoal: footballBuildGoal, buildCheckpoint: footballBuildCheckpoint, foes: FOOTBALL_FOES,
      // The player stops at the last flag and shoots, instead of walking
      // into the net.
      finishAtLastFlag: true, celebrateFinish: footballCelebrateFinish,
    },
    castle: {
      label: 'Castle', avatarFill: '#c62828',
      sky: [[0, '#4a78c0'], [12, '#9cc3e6'], [22, '#f6d9a8'], [24, '#86b552'], [100, '#5f9a3d']],
      goalGrad: [[0, '#fff2b8'], [55, '#ffcf3f'], [100, '#f5a623']],
      path: { outline: '#6b5f4b', fill: '#cbbd9e', dash: '#8a7a5c', progress: '#ffd27a' },
      decorate: castleDecorate, scatter: castleScatter, buildAvatar: castleBuildAvatar, buildGoal: castleBuildGoal, buildCheckpoint: castleBuildCheckpoint, foes: CASTLE_FOES,
      // The knight stops at the last banner to fight the dragon, instead
      // of walking into the gate.
      finishAtLastFlag: true, celebrateFinish: castleCelebrateFinish,
    },
    construction: {
      label: 'Construction', avatarFill: '#f97316', clearedWord: 'CLEARED!',
      sky: [[0, '#6aa9dc'], [18, '#b6d8f0'], [27, '#f3e3c3'], [28, '#d2b48c'], [100, '#c9a67a']],
      goalGrad: [[0, '#fff2b8'], [55, '#ffcf3f'], [100, '#f5a623']],
      path: { outline: '#8b6b45', fill: '#e8d5b0', dash: '#f97316', progress: '#fde047' },
      decorate: constructionDecorate, scatter: constructionScatter, buildAvatar: constructionBuildAvatar, buildGoal: constructionBuildGoal, buildCheckpoint: constructionBuildCheckpoint, foes: CONSTRUCTION_FOES,
      updateGoal: constructionUpdateGoal, celebrateFinish: constructionCelebrateFinish,
    },
    sprint: {
      label: 'Sprint Track', avatarFill: '#2563eb', clearedWord: 'CLEARED!',
      sky: [[0, '#1e293b'], [100, '#1e293b']],
      goalGrad: [[0, '#fff2b8'], [55, '#ffcf3f'], [100, '#f5a623']],
      // Your lane, not a road: lane 1 picked out, no centre dashes.
      path: { outline: '#ffffff', fill: '#dc5a35', dash: 'none', progress: '#fde047' },
      road: { shadow: 0, outline: 10.5, base: 8.5, sheen: 0, line: 0, progress: 3.4 },
      points: sprintPoints, lanePoint: sprintLanePoint,
      decorate: sprintDecorate, scatter: sprintScatter, buildAvatar: sprintBuildAvatar, buildGoal: sprintBuildGoal, buildCheckpoint: sprintBuildCheckpoint, foes: SPRINT_FOES,
      celebrateFinish: sprintCelebrateFinish,
    },
    mountain: {
      label: 'Mountain', avatarFill: '#2563eb', clearedWord: 'CLEARED!',
      sky: [[0, '#9fd3f2'], [70, '#d8eefb'], [100, '#74b042']],
      goalGrad: [[0, '#fed7aa'], [55, '#fb923c'], [100, '#ea580c']],
      // The trail is drawn by decorate (it narrows with distance); the
      // engine adds only the centre line and the walked glow.
      path: { outline: 'none', fill: 'none', dash: '#a8916a', progress: '#f59e0b' },
      road: { shadow: 0, outline: 0, base: 0, sheen: 0, line: 1.6, progress: 3.2 },
      points: mountainPoints, depth: (layoutKey, p) => mountainDepthAt(layoutKey, p.y),
      decorate: mountainDecorate, scatter: mountainScatter, buildAvatar: mountainBuildAvatar, buildGoal: mountainBuildGoal, buildCheckpoint: mountainBuildCheckpoint, foes: MOUNTAIN_FOES,
      celebrateFinish: mountainCelebrateFinish,
    },
  };
  function resolveThemeKey(key) { return THEMES[key] ? key : 'football'; }
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
      (() => {
        const grad = el('linearGradient', { id: GLOSS_ID, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.appendChild(el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': 0.6 }));
        grad.appendChild(el('stop', { offset: '60%', 'stop-color': '#ffffff', 'stop-opacity': 0 }));
        return grad;
      })(),
      (() => {
        // SHADE mirrors GLOSS from the bottom instead of the top — a
        // soft core shadow, not a hard line, so it reads as roundness.
        const grad = el('linearGradient', { id: SHADE_ID, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.appendChild(el('stop', { offset: '55%', 'stop-color': '#000000', 'stop-opacity': 0 }));
        grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': 0.3 }));
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
    // A theme can run its own shape (the sprint track's oval) and draw
    // the road thinner (a lane rather than a road).
    const d = pathD(theme.points ? theme.points(layout) : layout.points);
    const rw = { shadow: 44, outline: 40, base: 32, sheen: 8, line: 3.2, progress: 6, ...(theme.road || {}) };
    const pathShadow = el('path', { d, fill: 'none', stroke: '#0b1220', 'stroke-width': rw.shadow, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.22, transform: 'translate(0,7)', filter: `url(#${glowId})` });
    const pathOutline = el('path', { d, fill: 'none', stroke: theme.path.outline, 'stroke-width': rw.outline, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const pathBase = el('path', { d, fill: 'none', stroke: theme.path.fill, 'stroke-width': rw.base, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const pathSheen = el('path', { d, fill: 'none', stroke: '#ffffff', 'stroke-width': rw.sheen, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.22, transform: 'translate(0,-5)' });
    const pathLine = el('path', { d, fill: 'none', stroke: theme.path.dash, 'stroke-width': rw.line, 'stroke-dasharray': '11 11', 'stroke-linecap': 'round' });
    svg.appendChild(pathShadow);
    svg.appendChild(pathOutline);
    svg.appendChild(pathBase);
    svg.appendChild(pathSheen);
    svg.appendChild(pathLine);

    // The "ground covered so far" glow — a brighter copy of the path,
    // revealed from the start up to the avatar's current position via
    // the standard stroke-dasharray/dashoffset path-draw trick. Its
    // dashoffset is updated every apply() call (see there); starts
    // fully hidden here (offset = full length) since nothing's walked yet.
    const progressLen = pathBase.getTotalLength();
    const progressPath = el('path', {
      d, fill: 'none', stroke: theme.path.progress, 'stroke-width': rw.progress, 'stroke-linecap': 'round',
      'stroke-dasharray': `${progressLen} ${progressLen}`, 'stroke-dashoffset': progressLen, opacity: 0.85,
    });
    svg.appendChild(progressPath);

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
    const popupLayer = el('g', { class: 'journey-popups', 'pointer-events': 'none' });
    svg.appendChild(flagsLayer);
    svg.appendChild(ghostLayer);

    const goalLen = pathBase.getTotalLength();
    const goalPt = pathBase.getPointAtLength(goalLen);
    svg.appendChild(theme.buildGoal(goalPt.x, goalPt.y, goalGradId, shadowId, glowId));
    svg.appendChild(avatarLayer);
    svg.appendChild(popupLayer);
    const vignette = el('rect', { x: 0, y: 0, width: layout.w, height: layout.h, fill: `url(#${vignetteId})`, 'pointer-events': 'none' });
    svg.appendChild(vignette);

    svg.classList.add(`journey-theme-${resolveThemeKey(themeKey)}`);
    container.appendChild(svg);

    const entry = {
      svg, title, roadBase: pathBase, layoutKey: layout === LAYOUTS.tall ? 'tall' : 'wide', themeKey: resolveThemeKey(themeKey),
      flagsLayer, ghostLayer, avatarLayer, popupLayer, progressPath, progressLen, shadowId, lastState: null, lastDoneIds: new Set(), lastSummit: false,
      goalPt: { x: goalPt.x, y: goalPt.y }, vignette, curFrac: null, walk: null, facing: 1, flagEls: [], shotPending: false,
    };
    containers.set(container, entry);
    return entry;
  }

  // A name tag: a rounded label with a coloured dot, drawn unscaled so it
  // stays readable however small the characters get on a long task list.
  const PLACE_CUPS = { 1: ['#F2C230', '#9A7209'], 2: ['#CDD3DA', '#6E7883'], 3: ['#D98C4A', '#8A4F1E'] };
  const TROPHY_PATH = '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>';
  function nameTag(x, y, text, color, { you = false, sub = '', k = 1 } = {}) {
    const g = el('g', { class: `journey-name-tag${you ? ' is-you' : ''}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k.toFixed(3)})` });
    const label = text.length > 14 ? `${text.slice(0, 13)}…` : text;
    // A podium place gets its cup: gold, silver or bronze.
    const cup = PLACE_CUPS[(/^([123])(st|nd|rd)$/.exec(sub) || [])[1]];
    const w = Math.max(30, label.length * 6.4 + 22 + (sub ? sub.length * 5 + 6 : 0) + (cup ? 16 : 0));
    g.appendChild(el('rect', { x: -w / 2, y: -11, width: w, height: 18, rx: 9, fill: you ? '#0D1B2A' : '#ffffff', stroke: color, 'stroke-width': 1.6, opacity: 0.95 }));
    g.appendChild(el('circle', { cx: -w / 2 + 9, cy: -2, r: 3.4, fill: color }));
    const t = el('text', { x: -w / 2 + 16, y: 2, 'font-size': 10.5, 'font-weight': 800, 'font-family': 'system-ui, Arial, sans-serif', fill: you ? '#ffffff' : '#0D1B2A' });
    t.textContent = label;
    g.appendChild(t);
    if (sub) {
      const s2 = el('text', { x: w / 2 - 7, y: 2, 'text-anchor': 'end', 'font-size': 9, 'font-weight': 700, 'font-family': 'system-ui, Arial, sans-serif', fill: you ? '#5EEAD4' : '#556270' });
      s2.textContent = sub;
      g.appendChild(s2);
      if (cup) {
        const c = el('g', { transform: `translate(${(w / 2 - 7 - sub.length * 5.4 - 13).toFixed(1)},-7.5) scale(0.46)`, fill: cup[0], stroke: cup[1], 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        c.innerHTML = TROPHY_PATH;
        g.appendChild(c);
      }
    }
    return g;
  }
  function drawRivals(entry, state, n, finishFrac, scale, theme) {
    let layer = entry.rivalLayer;
    if (!layer) {
      layer = el('g', { class: 'journey-rivals' });
      entry.ghostLayer.parentNode.insertBefore(layer, entry.ghostLayer.nextSibling);
      entry.rivalLayer = layer;
      entry.tagLayer = el('g', { class: 'journey-name-tags', 'pointer-events': 'none' });
      entry.popupLayer.parentNode.insertBefore(entry.tagLayer, entry.popupLayer);
    }
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    while (entry.tagLayer.firstChild) entry.tagLayer.removeChild(entry.tagLayer.firstChild);
    const rivals = state.rivals || [];
    if (!rivals.length) { entry.youTag = null; return; }
    // Tags are sized for the screen, not the scene: the picture is scaled
    // to fit, so on a phone a tag drawn at scene size would be unreadable.
    const shown = entry.svg.getBoundingClientRect().width || 0;
    const k = entry.tagK = shown ? Math.max(0.9, Math.min(3, entry.svg.viewBox.baseVal.width / shown)) : 1;
    const youFrac = state.youFrac || 0;
    const sorted = rivals.slice().sort((a, b) => Math.abs(a.frac - youFrac) - Math.abs(b.frac - youFrac));
    const tagged = new Set(rivals.length <= 8 ? rivals : [...sorted.slice(0, 2), ...rivals.filter(r => r.leader)]);
    // Players on the same spot stand a little apart, so each can be seen.
    const atSpot = new Map();
    // On the sprint track everyone has a lane of their own (you run lane
    // 1), kept the same however the order changes.
    const lanes = theme.lanePoint ? new Map(rivals.slice().sort((a, b) => `${a.color}${a.name}`.localeCompare(`${b.color}${b.name}`)).map((r, i) => [r, 1 + (i % 7)])) : null;
    rivals.forEach(r => {
      const key = Math.round(r.frac * 200);
      const here = atSpot.get(key) || 0; atSpot.set(key, here + 1);
      let p = pointAtFrac(entry.roadBase, progressToPathFrac(r.frac, n, finishFrac));
      if (lanes) p = theme.lanePoint(entry.layoutKey, p, lanes.get(r));
      const dx = lanes ? 0 : (here % 2 ? 1 : -1) * Math.ceil(here / 2) * 16 * scale - (here ? 0 : 12 * scale);
      const s = scale * (tagged.has(r) ? 0.92 : 0.7);
      const g = theme.buildAvatar(r.color);
      g.setAttribute('transform', `translate(${(p.x + dx).toFixed(1)},${p.y.toFixed(1)}) scale(${s})`);
      g.setAttribute('opacity', tagged.has(r) ? '0.92' : '0.6');
      layer.appendChild(g);
      // Tags of players on the same spot stack upwards rather than overlap.
      if (tagged.has(r)) entry.tagLayer.appendChild(nameTag(p.x + dx, p.y - 40 * s - 12 * k - here * 21 * k, r.name, r.color, { sub: r.badge || (r.finished ? '🏁' : ''), k }));
    });
    // You get a tag too, so it's clear which runner is yours.
    entry.youTag = entry.tagLayer.appendChild(nameTag(0, 0, 'You', state.youColor || '#0A7E8C', { you: true, k, sub: state.youBadge || '' }));
    positionYouTag(entry, scale);
  }
  function positionYouTag(entry, scale) {
    if (!entry.youTag || !entry.youTag.isConnected) return;
    const p = pointAtFrac(entry.roadBase, entry.curFrac == null ? 0 : entry.curFrac);
    const k = entry.tagK || 1;
    entry.youTag.setAttribute('transform', `translate(${p.x.toFixed(1)},${(p.y - 40 * scale - 12 * k).toFixed(1)}) scale(${k.toFixed(3)})`);
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

  // Each checkpoint's position along the path. Inset slightly from both
  // ends — a checkpoint at exactly frac 0 or 1 lands under the avatar's
  // starting pose or the goal marker and mostly disappears behind it.
  function checkpointFrac(i, n) { return n > 1 ? 0.06 + (i / (n - 1)) * 0.88 : 0.5; }

  // Maps task progress (done ÷ total, or a fractional pace for the ghost)
  // onto the path so whole numbers land exactly on the flags: nothing done
  // is the start, k done is the k-th flag, all done is the finish.
  function progressToPathFrac(p, n, finishFrac) {
    if (!n) return 0;
    const knots = [[0, 0]];
    for (let k = 1; k < n; k++) knots.push([k / n, checkpointFrac(k - 1, n)]);
    knots.push([1, finishFrac]);
    const q = Math.max(0, Math.min(1, p));
    for (let j = 1; j < knots.length; j++) {
      const [p0, f0] = knots[j - 1], [p1, f1] = knots[j];
      if (q <= p1) return f0 + (f1 - f0) * ((q - p0) / ((p1 - p0) || 1));
    }
    return finishFrac;
  }

  function placeAvatar(entry, frac, scale) {
    const p = pointAtFrac(entry.roadBase, frac);
    entry.avatarLayer.setAttribute('transform', `translate(${p.x.toFixed(2)},${p.y.toFixed(2)}) scale(${scale})`);
    if (entry.youTag && entry.youTag.isConnected) { const k = entry.tagK || 1; entry.youTag.setAttribute('transform', `translate(${p.x.toFixed(1)},${(p.y - 40 * scale - 12 * k).toFixed(1)}) scale(${k.toFixed(3)})`); }
    // The "ground covered" glow trail is revealed up to exactly where the
    // avatar stands, so it fills in step by step as the avatar walks.
    if (entry.progressPath) {
      const f = Math.max(0, Math.min(1, frac));
      entry.progressPath.setAttribute('stroke-dashoffset', String(entry.progressLen * (1 - f)));
    }
    return p;
  }

  // Turns the avatar to face the way it's walking. Text inside it (the
  // footballer's shirt number) is counter-flipped so it never reads
  // backwards.
  function setFacing(entry, dir) {
    if (entry.facing === dir) return;
    entry.facing = dir;
    const av = entry.avatarLayer.firstChild;
    if (!av) return;
    if (dir < 0) av.setAttribute('transform', 'scale(-1,1)'); else av.removeAttribute('transform');
    av.querySelectorAll('.journey-unflip').forEach(t => {
      if (dir < 0) t.setAttribute('transform', 'scale(-1,1)'); else t.removeAttribute('transform');
    });
  }

  function stopWalk(entry) {
    if (!entry.walk) return;
    cancelAnimationFrame(entry.walk.raf);
    clearTimeout(entry.walk.timer);
    entry.avatarLayer.classList.remove('journey-walking');
    entry.walk = null;
  }

  // Walks the avatar along the real curve of the path (not a straight-line
  // glide) from one fraction to another, at a steady walking speed. It
  // stops at each milestone it reaches on the way that has a celebration
  // waiting (a newly completed flag, the finish), fires that celebration
  // the moment it arrives, pauses briefly, then carries on.
  function walkAvatar(entry, from, to, arrivals, scale) {
    const dir = Math.sign(to - from), eps = 0.002;
    const onRoute = a => (dir > 0 ? a.frac > from + eps && a.frac <= to + eps : a.frac < from - eps && a.frac >= to - eps);
    arrivals.filter(a => !onRoute(a)).forEach(a => a.fire());
    const route = arrivals.filter(onRoute).map(a => Object.assign(a, { stop: Math.abs(a.frac - to) <= eps ? to : a.frac }));
    const stops = [...new Set(route.map(a => a.stop))].sort((a, b) => dir * (a - b));
    if (stops[stops.length - 1] !== to) stops.push(to);

    const total = entry.roadBase.getTotalLength();
    const layer = entry.avatarLayer;
    const walk = { raf: 0, timer: 0, pending: route };
    entry.walk = walk;
    let cur = from, idx = 0;
    const nextLeg = () => {
      if (idx >= stops.length) { layer.classList.remove('journey-walking'); entry.walk = null; return; }
      const start = cur, end = stops[idx++];
      const dur = Math.max(350, Math.min(2400, Math.abs(end - start) * total * 8));
      const t0 = performance.now();
      let lastX = null;
      layer.classList.add('journey-walking');
      const step = now => {
        if (!entry.svg.isConnected) { entry.walk = null; return; }
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const f = start + (end - start) * e;
        const pt = placeAvatar(entry, f, scale);
        if (lastX !== null && Math.abs(pt.x - lastX) > 0.15) setFacing(entry, pt.x < lastX ? -1 : 1);
        lastX = pt.x;
        entry.curFrac = f;
        if (t < 1) { walk.raf = requestAnimationFrame(step); return; }
        cur = end;
        layer.classList.remove('journey-walking');
        const here = walk.pending.filter(a => a.stop === end);
        walk.pending = walk.pending.filter(a => a.stop !== end);
        here.forEach(a => a.fire());
        walk.timer = setTimeout(nextLeg, here.length && idx < stops.length ? 500 : 0);
      };
      walk.raf = requestAnimationFrame(step);
    };
    nextLeg();
  }

  // The completed task's own title, floating up beside its flag and fading
  // away — a quick "what did I just finish?" readout, not a modal.
  // A completed task's title over "COMPLETED!" (in orange), or with kind
  // 'foe' a ticked-off obstacle's name over `sub` (in green).
  function spawnTaskPopup(entry, x, y, text, kind = 'done', sub) {
    if (!entry || !entry.svg.isConnected || !text) return;
    const label = '✓ ' + (text.length > 28 ? text.slice(0, 27) + '…' : text);
    sub = sub || (kind === 'foe' ? 'ELIMINATED!' : 'COMPLETED!');
    const outer = el('g', { class: 'journey-task-popup ' + (kind === 'foe' ? 'journey-foe-popup' : 'journey-done-popup'), transform: `translate(${x},${y - 34})` });
    const inner = el('g', { class: 'journey-task-popup-inner' });
    const txt = el('text', { class: 'journey-task-popup-text', x: 0, y: 0, 'text-anchor': 'middle' });
    txt.textContent = label;
    inner.appendChild(txt);
    {
      const subEl = el('text', { class: 'journey-foe-popup-sub', x: 0, y: 13, 'text-anchor': 'middle' });
      subEl.textContent = sub;
      inner.appendChild(subEl);
    }
    outer.appendChild(inner);
    entry.popupLayer.appendChild(outer);
    // The background pill is sized from the text's rendered bbox, so it has
    // to wait a frame until the <text> actually has layout to measure.
    requestAnimationFrame(() => {
      if (!outer.isConnected) return;
      const bbox = inner.getBBox();
      const pad = 8;
      const rect = el('rect', {
        class: 'journey-task-popup-bg', x: bbox.x - pad, y: bbox.y - 4,
        width: bbox.width + pad * 2, height: bbox.height + 8, rx: (bbox.height + 8) / 2,
      });
      inner.insertBefore(rect, txt);
    });
    // Removed on a timer regardless of the CSS animation, so reduced-motion
    // viewers still see it appear and disappear, just without the float.
    setTimeout(() => { if (outer.isConnected) outer.remove(); }, 2800);
  }

  // A flag the avatar has just reached: it pops, confetti bursts from it,
  // and the task's own title floats up beside it.
  // A task's obstacles as { count, label }: its named obstacles (counts
  // added up, the first name on the tag), or one for an older "this is a
  // blocker" status update; null when nothing is in the way.
  // Obstacles ticked off (resolved) one at a time no longer stand in the way.
  function foesFor(t) {
    const obs = t.obstacles || [];
    if (obs.length) {
      const pending = obs.filter(o => !o.resolved);
      const count = pending.reduce((a, o) => a + (o.count || 1), 0);
      return count ? { count, label: pending[0].name + (pending.length > 1 ? ` (+${pending.length - 1} more)` : '') } : null;
    }
    if (t.latestUpdateIsBlocker) return { count: 1, label: t.latestUpdateText || 'Blocked' };
    return null;
  }

  function celebrateFlag(entry, i, frac, taskTitle) {
    if (!entry || !entry.svg.isConnected) return;
    const g = entry.flagEls[i];
    // knock out whatever was standing in the way
    const foes = g && g.querySelector('.journey-foes');
    if (foes) { foes.classList.add('journey-foes-defeated'); setTimeout(() => foes.remove(), 700); }
    if (g) {
      g.classList.remove('journey-flag-pop');
      g.getBBox(); // restart the animation if it was already running
      g.classList.add('journey-flag-pop');
      setTimeout(() => g.classList.remove('journey-flag-pop'), 700);
    }
    const p = pointAtFrac(entry.roadBase, frac);
    if (window.fireScreenConfetti) {
      const sp = screenPoint(entry.svg, p.x, p.y);
      window.fireScreenConfetti(sp.x, sp.y, 24);
    }
    if (taskTitle) spawnTaskPopup(entry, p.x, p.y, taskTitle);
  }

  function apply(container, state) {
    const desiredLayout = pickLayout(container) === LAYOUTS.tall ? 'tall' : 'wide';
    const desiredTheme = resolveThemeKey(state.theme);
    let entry = containers.get(container);
    // Celebrations still waiting on a walk that this sync interrupts are
    // carried into the new walk rather than dropped or fired early.
    let carried = [];
    if (entry && entry.walk) { carried = entry.walk.pending; stopWalk(entry); }
    if (!entry || entry.layoutKey !== desiredLayout || entry.themeKey !== desiredTheme) {
      // Rebuilding (a resize across the layout breakpoint, or a theme
      // switch) throws away the old SVG — but carry over which tasks
      // were already celebrated, or the fresh entry's empty lastDoneIds
      // would read every already-done task as "newly done" and replay
      // confetti for all of them at once.
      const prevDoneIds = entry ? entry.lastDoneIds : new Set();
      const prevSummit = entry ? entry.lastSummit : false;
      const prevObstacles = entry ? entry.lastObstacles : null;
      entry = build(container, desiredTheme);
      entry.lastDoneIds = prevDoneIds;
      entry.lastSummit = prevSummit;
      entry.lastObstacles = prevObstacles;
    }
    const theme = getTheme(desiredTheme);
    const { svg, title, roadBase, flagsLayer, ghostLayer, avatarLayer, shadowId } = entry;
    const current = () => containers.get(container);

    const totalN = state.tasks.length;
    const doneN = state.tasks.filter(t => t.status === 'Completed').length;
    const pct = totalN ? Math.round((doneN / totalN) * 100) : 0;
    let phaseLabel = 'At the starting line';
    PHASES.forEach(p => { if (totalN && doneN / totalN > p.at) phaseLabel = p.label; });
    if (totalN && doneN === totalN) phaseLabel = 'Reached the target';
    title.textContent = totalN
      ? `Journey progress: ${pct} percent. ${doneN} of ${totalN} tasks completed. Current milestone: ${phaseLabel}.`
      : 'Journey not started — no tasks yet.';

    // Checkpoints — one per task, evenly spaced along the actual curve.
    // Each sits inside an outer positioned group so the flag itself can be
    // CSS-animated (the arrival "pop") without losing its translate.
    while (flagsLayer.firstChild) flagsLayer.removeChild(flagsLayer.firstChild);
    const n = totalN;
    const scale = checkpointScale(n);
    const fracs = state.tasks.map((t, i) => checkpointFrac(i, n));
    const celebrate = state.celebrationsEnabled !== false;
    entry.flagEls = [];
    state.tasks.forEach((t, i) => {
      const pt = pointAtFrac(roadBase, fracs[i]);
      const isDone = t.status === 'Completed';
      const isNext = !isDone && i === doneN;
      // Its enemies stay until the task is done; a task that's just been
      // finished keeps them until the avatar arrives to knock them out.
      const foes = foesFor(t);
      const justDone = isDone && celebrate && entry.curFrac !== null && !entry.lastDoneIds.has(t.id);
      const g = theme.buildCheckpoint(i, isDone, isNext, foes && (!isDone || justDone) ? foes : null, scale, shadowId);
      // Obstacles ticked off since the last sync: their own enemies are
      // knocked out where they stand, and the obstacle's name pops up.
      if (!isDone && entry.lastObstacles) {
        let start = foes ? Math.min(foes.count, FOE_SPOTS.length) : 0;
        (t.obstacles || []).filter(o => o.resolved && entry.lastObstacles.get(o.id) === false).forEach((o, j) => {
          const ko = drawFoes({ count: o.count || 1, label: o.name }, scale, theme.foes, { bare: true, start });
          start += Math.min(o.count || 1, FOE_SPOTS.length);
          g.appendChild(ko);
          requestAnimationFrame(() => ko.classList.add('journey-foes-defeated'));
          setTimeout(() => ko.remove(), 750);
          if (celebrate) setTimeout(() => spawnTaskPopup(current(), pt.x - 34 * scale, pt.y - 62 * scale - j * 30, o.name, 'foe', theme.clearedWord), j * 450);
        });
      }
      const pos = el('g', { transform: `translate(${pt.x},${pt.y})` });
      pos.appendChild(g);
      flagsLayer.appendChild(pos);
      entry.flagEls.push(g);
    });

    // Respect prefers-reduced-motion: the avatar still ends up in the
    // right place, it just snaps there instead of walking.
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finishFrac = theme.finishAtLastFlag && n ? checkpointFrac(n - 1, n) : 1;
    const targetFrac = progressToPathFrac(n ? doneN / n : 0, n, finishFrac);

    // Every checkpoint newly completed since the last sync gets its own
    // celebration, fired when the avatar actually arrives at that flag.
    const nowDoneIds = new Set(state.tasks.filter(t => t.status === 'Completed').map(t => t.id));
    const arrivals = carried.filter(a => (a.summit ? state.summitLit : nowDoneIds.has(a.taskId)));
    if (celebrate) {
      state.tasks.forEach((t, i) => {
        if (t.status === 'Completed' && !entry.lastDoneIds.has(t.id)) {
          arrivals.push({ taskId: t.id, frac: fracs[i], fire: () => celebrateFlag(current(), i, fracs[i], t.title) });
        }
      });
    }
    entry.lastDoneIds = nowDoneIds;
    entry.lastObstacles = new Map(state.tasks.flatMap(t => (t.obstacles || []).map(o => [o.id, !!o.resolved])));

    const newSummit = state.summitLit && !entry.lastSummit;
    entry.lastSummit = state.summitLit;
    if (!state.summitLit) entry.shotPending = false;
    if (newSummit && celebrate && !reduceMotion && theme.celebrateFinish) entry.shotPending = true;
    if (newSummit && celebrate) {
      arrivals.push({
        summit: true, frac: targetFrac,
        fire: () => {
          const e = current();
          if (!e || !e.svg.isConnected) return;
          const burst = () => {
            const sp = screenPoint(e.svg, e.goalPt.x, e.goalPt.y - 10);
            if (window.fireScreenConfetti) { window.fireScreenConfetti(sp.x, sp.y, 70); window.fireScreenConfetti(sp.x - 60, sp.y, 50); window.fireScreenConfetti(sp.x + 60, sp.y, 50); }
            if (window.fireBalloons) window.fireBalloons(10);
          };
          const t = getTheme(e.themeKey);
          // Let the app's own "Project Complete" modal show a beat after
          // this celebration actually starts, not on a fixed delay from
          // whenever the task was toggled — the avatar may still be
          // walking here, and football's own shot/GOAL! animation needs
          // a moment to land before the modal covers the scene.
          if (state.onSummit) setTimeout(state.onSummit, t.celebrateFinish ? 1800 : 600);
          if (e.shotPending && t.celebrateFinish) t.celebrateFinish(e, pointAtFrac(e.roadBase, e.curFrac), checkpointScale(n), burst);
          else { e.shotPending = false; burst(); }
        },
      });
    }

    // Ghost (pace/competitor marker) — a faded second avatar, mapped onto
    // the path the same way so its pace lines up with the flags too.
    while (ghostLayer.firstChild) ghostLayer.removeChild(ghostLayer.firstChild);
    if (state.ghost) {
      const gp = pointAtFrac(roadBase, progressToPathFrac(state.ghost.frac, n, finishFrac));
      const g = theme.buildAvatar('#94a3b8');
      g.setAttribute('transform', `translate(${gp.x},${gp.y}) scale(${scale})`);
      g.setAttribute('opacity', '0.55');
      ghostLayer.appendChild(g);
    }

    // Rivals in a race (Challenges): every other player at their own place
    // on the same road, in their colour, with their name over their head
    // and how they're doing on pace. Only you, the leader and the two
    // either side of you get full name tags once there are more than eight,
    // so the road stays readable; the rest are smaller and quieter.
    drawRivals(entry, state, n, finishFrac, scale, theme);

    if (!avatarLayer.firstChild) avatarLayer.appendChild(theme.buildAvatar(theme.avatarFill, shadowId));
    avatarLayer.style.transition = 'none';
    // Stages where the scene itself reflects progress (the Construction
    // building, the Life Path traveller growing up).
    if (theme.updateGoal) theme.updateGoal(entry, totalN ? doneN / totalN : 0, state);

    // Football: the ball sits at the player's feet until the goal is
    // scored, then in the net.
    const scored = state.summitLit && !entry.shotPending;
    const netBall = svg.querySelector('.journey-goal-ball');
    if (netBall) netBall.style.display = scored ? '' : 'none';
    const feetBall = avatarLayer.querySelector('.journey-feet-ball');
    if (feetBall) feetBall.style.display = scored ? 'none' : '';
    // Castle: once the quest is done the dragon is gone, the gate is up
    // and the princess stands outside (see .journey-quest-done in index.html).
    svg.classList.toggle('journey-quest-done', scored);

    const from = entry.curFrac;
    if (from === null || reduceMotion || Math.abs(targetFrac - from) < 0.0005) {
      placeAvatar(entry, targetFrac, scale);
      entry.curFrac = targetFrac;
      arrivals.sort((a, b) => a.frac - b.frac).forEach(a => a.fire());
    } else {
      walkAvatar(entry, from, targetFrac, arrivals, scale);
    }

    entry.lastState = state;
  }

  // ── 3D stages ────────────────────────────────────────────────────────
  // Themes rendered in real 3D (WebGL) by a separate module, loaded only
  // when one is picked. Each names the 2D theme to fall back to if the
  // device has no WebGL or the module/model fails to load, so the Journey
  // always shows something.
  const THREE_D_THEMES = {
    football3d: { module: '/js/journey3d.js', factory: 'createFootball3D', fallback: 'football', failed: false, loading: null },
    castle3d: { module: '/js/journeyCastle3d.js', factory: 'createCastle3D', fallback: 'castle', failed: false, loading: null },
    space3d: { module: '/js/journeySpace3d.js', factory: 'createSpace3D', fallback: 'space', failed: false, loading: null },
    construction3d: { module: '/js/journeyConstruction3d.js', factory: 'createConstruction3D', fallback: 'construction', failed: false, loading: null },
    sprint3d: { module: '/js/journeySprint3d.js', factory: 'createSprint3D', fallback: 'sprint', failed: false, loading: null },
  };
  const instances3d = new Set();
  let webglOk = null;
  function supportsWebGL() {
    if (webglOk === null) {
      try {
        const c = document.createElement('canvas');
        webglOk = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
      } catch (e) { webglOk = false; }
    }
    return webglOk;
  }
  function teardown3d(container) {
    instances3d.delete(container._j3d);
    container._j3d.destroy();
    container._j3d = null;
    container._j3dTheme = null;
    container.innerHTML = '';
  }
  function sync3d(container, state, cfg) {
    container._j3dState = state;
    // Switching from one 3D stage to another replaces the running one.
    if (container._j3d && container._j3dTheme !== state.theme) teardown3d(container);
    if (container._j3d) { container._j3d.sync(state); return Promise.resolve(); }
    // Leaving the 2D scene: stop its walk and drop it (its ResizeObserver
    // finds no entry while the 3D stage is up, so it stays idle).
    const entry = containers.get(container);
    if (entry) { stopWalk(entry); containers.delete(container); container.innerHTML = ''; }
    if (!container._j3dLoading) {
      cfg.loading = cfg.loading || import(cfg.module);
      container._j3dLoading = cfg.loading.then(mod => {
        container._j3dLoading = null;
        const latest = container._j3dState;
        if (!latest || !THREE_D_THEMES[latest.theme] || container._j3d) return;
        // The user switched to another 3D stage while this one loaded.
        if (THREE_D_THEMES[latest.theme] !== cfg) return JourneyGameApi.sync(container, latest);
        container._j3d = mod[cfg.factory](container);
        container._j3dTheme = latest.theme;
        instances3d.add(container._j3d);
        container._j3d.sync(latest);
      }).catch(err => {
        console.error('3D Journey unavailable, showing the 2D stage instead:', err);
        cfg.failed = true; cfg.loading = null; container._j3dLoading = null;
        if (container._j3d) { instances3d.delete(container._j3d); container._j3d = null; container._j3dTheme = null; }
        container.innerHTML = '';
        const latest = container._j3dState;
        if (latest && THREE_D_THEMES[latest.theme]) JourneyGameApi.sync(container, latest);
      });
    }
    return container._j3dLoading;
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

  const JourneyGameApi = {
    buildPhaseLabel(frac) {
      if (frac >= 1) return 'Reached the target';
      let label = 'At the starting line';
      PHASES.forEach(p => { if (frac > p.at) label = p.label; });
      return label;
    },
    sync(container, state) {
      const three = THREE_D_THEMES[state.theme];
      if (three && !three.failed && supportsWebGL()) return sync3d(container, state, three);
      if (container._j3d) teardown3d(container);
      ensureResizeObserver(container);
      apply(container, three ? Object.assign({}, state, { theme: three.fallback }) : state);
      return Promise.resolve();
    },
    pause() { instances3d.forEach(inst => inst.pause()); },
    resume() { instances3d.forEach(inst => inst.resume()); },
    destroy(container) {
      if (container) {
        if (container._j3d) teardown3d(container);
        container._j3dState = null;
        const entry = containers.get(container);
        if (entry) stopWalk(entry);
        if (container._journeyRO) { container._journeyRO.disconnect(); delete container._journeyRO; }
        containers.delete(container);
        container.innerHTML = '';
      }
    },
  };
  return JourneyGameApi;
})();
