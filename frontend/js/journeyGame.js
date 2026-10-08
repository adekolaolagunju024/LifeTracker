// ── JOURNEY GAME (Phaser 3) ───────────────────────────────────────
// "Launch to Orbit": a rocket lifts off from a launchpad and climbs
// straight up toward a space station, one burn per completed task.
// Rendered by Phaser 3, lazy-loaded from a CDN only when Journey opens.
//
// Why this replaced the earlier cliff-climb/mountain-drive concepts:
// a rocket's path is vertical, not a switchback, so there's no zigzag
// amplitude to tune; and space is naturally sparse — stars are small
// dots, there's no rock-texture/tree/cloud temptation that made the
// earlier scenes cluttered. Design rule carried over from that lesson:
// a flat gradient backdrop, one path, plain numbered checkpoints, and
// the avatar. Nothing else gets added without removing something first.
//
// app.js owns state (tasks, competitor, project) and calls
// JourneyGame.sync(container, state) whenever it changes; this module
// owns only rendering and animation.
const JourneyGame = (() => {
  // ── Engine loading ────────────────────────────────────────────
  const PHASER_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.80.1/phaser.min.js',
    'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js',
  ];
  let loadPromise = null;
  function loadPhaser() {
    if (window.Phaser) return Promise.resolve();
    if (loadPromise) return loadPromise;
    const loadScript = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('script load failed: ' + src));
      document.head.appendChild(s);
    });
    loadPromise = loadScript(PHASER_URLS[0]).catch(() => loadScript(PHASER_URLS[1])).catch((e) => {
      loadPromise = null; // let a retry try again instead of staying broken for the session
      throw e;
    });
    return loadPromise;
  }

  // ── Shared constants ──────────────────────────────────────────
  const DONE_COLOR = 0x10b981, NEXT_COLOR = 0xfbbf24, PENDING_COLOR = 0xcbd5c8;
  const CENTER_X = 50, BOTTOM_Y = 90;
  // Real headroom above the final checkpoint for the rocket's own nose
  // cone and the station above it — too little margin here is what
  // cropped the avatar/decorations off-canvas in an earlier version.
  const TOP_Y = 16;

  // Phaser rasterizes Text at its own font-size, then the scene's ~10x
  // container scale blows that up — render large, then shrink the object
  // itself, so the bitmap is always scaled down (crisp), never up (blurry).
  function crispLabel(sc, x, y, str, color, size, weight) {
    const FONT_PX = 34;
    const t = sc.add.text(x, y, str, { fontSize: FONT_PX + 'px', fontStyle: weight || 'bold', fontFamily: 'Arial, sans-serif', color }).setOrigin(0.5);
    t.setScale(size / FONT_PX);
    return t;
  }

  // ── THE FLIGHT PATH — straight up, one stop per task. A rocket doesn't
  // switch back, so there's no amplitude to tune; a small constant
  // alternating offset just keeps each checkpoint's number legible next
  // to the flight line instead of directly behind the rocket.
  function routePoints(n) {
    const points = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 1;
      const y = BOTTOM_Y - t * (BOTTOM_Y - TOP_Y);
      const side = i % 2 === 0 ? -1 : 1;
      points.push({ x: CENTER_X + side * 3, y });
    }
    return points;
  }
  function checkpointRadius(n) { return Math.max(1.6, Math.min(3.0, 34 / Math.max(1, n))); }
  function positionAt(points, frac) {
    if (!points.length) return { x: CENTER_X, y: BOTTOM_Y };
    if (frac <= 0) return points[0];
    if (frac >= 1) return points[points.length - 1];
    const idx = frac * (points.length - 1);
    const i0 = Math.floor(idx), i1 = Math.min(points.length - 1, i0 + 1);
    const f = idx - i0;
    const a = points[i0], b = points[i1];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  const PHASES = [
    { at: 0.14, label: 'Liftoff' },
    { at: 0.32, label: 'Max velocity' },
    { at: 0.52, label: 'Leaving the atmosphere' },
    { at: 0.72, label: 'Coasting through space' },
    { at: 0.90, label: 'Approaching the station' },
  ];

  // ── BACKDROP — one gradient from pale atmosphere blue at the bottom to
  // deep space at the top, a sparse field of star dots (only where the
  // sky is actually dark), a launch tower, and a space station marking
  // the goal. No texture, no clouds, nothing scattered beyond the stars.
  function buildBackdrop(sc) {
    sc.sky.fillGradientStyle(0x0a1230, 0x0a1230, 0x6fa8d8, 0x6fa8d8, 1);
    sc.sky.fillRect(0, 0, 100, 100);

    // Stars — sparse dots, seeded so they're stable for this scene
    // instance, confined to the upper (dark) two-thirds of the sky.
    let seed = 99;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
    for (let i = 0; i < 26; i++) {
      const x = rand() * 100, y = rand() * 58;
      sc.decor.add(sc.add.circle(x, y, 0.35 + rand() * 0.35, 0xffffff, 0.5 + rand() * 0.4));
    }

    // The space station — a simple ring + core, marking the goal.
    const station = sc.add.container(CENTER_X, TOP_Y - 6);
    const ring = sc.add.graphics();
    ring.lineStyle(0.6, 0xaab4c0, 0.9); ring.strokeEllipse(0, 0, 11, 3.4);
    station.add(ring);
    station.add(sc.add.circle(0, 0, 2.6, 0xd4dae2, 1));
    station.add(sc.add.circle(-0.7, -0.7, 0.9, 0xffffff, 0.5));
    sc.decor.add(station);
    sc.tweens.add({ targets: ring, angle: 360, duration: 14000, repeat: -1, ease: 'Linear' });

    // Launch tower at the base — a pole with one angled support strut,
    // not two horizontal crossbars (which, at this scale, read as the
    // letter "F" rather than a gantry tower).
    const tower = sc.add.graphics();
    tower.fillStyle(0x6b7280, 1); tower.fillRect(CENTER_X - 10, BOTTOM_Y - 10, 0.6, 10);
    tower.fillStyle(0x4b5563, 1); tower.fillTriangle(CENTER_X - 10, BOTTOM_Y - 10, CENTER_X - 10, BOTTOM_Y - 8.2, CENTER_X - 7.2, BOTTOM_Y - 6.5);
    sc.decor.add(tower);

    // Ground.
    const ground = sc.add.graphics();
    ground.fillStyle(0x3a4a5a, 1); ground.fillRect(0, BOTTOM_Y + 3, 100, 100);
    sc.decor.add(ground);
  }

  // ── THE ROPE — no, this stage has no rope; the "path" is just a thin
  // exhaust-trail line connecting the checkpoints, drawn once per sync.
  function drawFlightPath(sc, points) {
    sc.pathGfx.clear();
    const all = [{ x: CENTER_X, y: BOTTOM_Y + 4 }, ...points, { x: CENTER_X, y: TOP_Y - 6 }];
    sc.pathGfx.lineStyle(0.5, 0x8fb4de, 0.5);
    sc.pathGfx.beginPath(); sc.pathGfx.moveTo(all[0].x, all[0].y);
    all.slice(1).forEach(p => sc.pathGfx.lineTo(p.x, p.y));
    sc.pathGfx.strokePath();
  }

  // ── THE ROCKET — nose cone, body, fins, and a flame that's a real
  // thrust effect, not decoration: it flickers at idle and burns bright
  // with trailing particles on each move.
  const R = { hull: 0xe5e7eb, hullDark: 0xc3c9d1, nose: 0xef4444, window: 0x60a5fa, fin: 0xdc2626 };
  function buildRocket(sc, animated) {
    const root = sc.add.container(0, 0);
    const art = sc.add.container(0, 0);
    art.setScale(0.5);
    root.add(art);

    const finL = sc.add.graphics();
    finL.fillStyle(R.fin, 1); finL.fillTriangle(-2.2, 0, -5, 4, -2.2, 4.5);
    const finR = sc.add.graphics();
    finR.fillStyle(R.fin, 1); finR.fillTriangle(2.2, 0, 5, 4, 2.2, 4.5);

    const body = sc.add.graphics();
    body.fillStyle(R.hullDark, 1); body.fillRoundedRect(-2.6, -2, 5.2, 14, 1.4);
    body.fillStyle(R.hull, 1); body.fillRoundedRect(-2.6, -2, 3.4, 14, 1.4);
    body.fillStyle(R.nose, 1); body.fillTriangle(-2.6, -2, 2.6, -2, 0, -9);
    body.fillStyle(0xf87171, 0.6); body.fillTriangle(-2.6, -2, -0.3, -2, 0, -9);
    body.fillStyle(R.window, 1); body.fillCircle(0, 3.4, 1.7);
    body.fillStyle(0xdbeafe, 0.6); body.fillCircle(-0.5, 2.9, 0.7);
    body.lineStyle(0.25, 0x9aa3ad, 0.6); body.strokeRoundedRect(-2.6, -2, 5.2, 14, 1.4);

    const flame = sc.add.graphics();
    flame.fillStyle(0xfbbf24, 1); flame.fillTriangle(-1.6, 12, 1.6, 12, 0, 17);
    flame.fillStyle(0xfff3c4, 0.9); flame.fillTriangle(-0.8, 12, 0.8, 12, 0, 15.2);

    art.add([finL, finR, body, flame]);
    const parts = { art, flame, body };

    if (animated) {
      // Idle: a small flicker, never perfectly still.
      sc.tweens.add({ targets: flame, scaleY: 0.7, scaleX: 0.85, duration: 180, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      sc.tweens.add({ targets: art, y: { from: 0, to: -0.6 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    root._parts = parts;
    return root;
  }
  function exhaustBurst(sc, x, y) {
    const emitter = sc.add.particles(x, y, 'journeyDot', {
      speed: { min: 20, max: 50 }, angle: { min: 80, max: 100 }, gravityY: 0,
      scale: { start: 1.3, end: 0 }, alpha: { start: 0.9, end: 0 }, lifespan: 420, quantity: 12, tint: [0xfbbf24, 0xf87171, 0xfff3c4],
    });
    sc.time.delayedCall(450, () => emitter.destroy());
  }
  // A real burn per completed task: the flame flares, exhaust fires
  // downward, the rocket accelerates to the new altitude, then idles.
  function launchMove(sc, rocket, toX, toY, onComplete) {
    const p = rocket._parts;
    if (!p) { sc.tweens.add({ targets: rocket, x: toX, y: toY, duration: 700, ease: 'Sine.easeInOut', onComplete }); return; }
    sc.tweens.killTweensOf([p.flame, p.art, rocket]);
    exhaustBurst(sc, rocket.x, rocket.y + 8);
    sc.tweens.add({ targets: p.flame, scaleY: 1.8, scaleX: 1.3, duration: 180, ease: 'Sine.easeOut' });
    sc.tweens.add({
      targets: rocket, x: toX, y: toY, duration: 560, ease: 'Sine.easeInOut',
      onUpdate: (tw) => { if (tw.progress > 0.15 && tw.progress < 0.85 && Math.random() < 0.3) exhaustBurst(sc, rocket.x, rocket.y + 8); },
      onComplete: () => {
        sc.tweens.add({ targets: p.flame, scaleY: 1, scaleX: 1, duration: 220, ease: 'Sine.easeIn' });
        sc.tweens.add({
          targets: p.flame, scaleY: 0.7, scaleX: 0.85, duration: 180, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 220,
        });
        sc.tweens.add({ targets: p.art, y: { from: 0, to: -0.6 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 220, onComplete });
      },
    });
  }

  // ── THE SCENE ──────────────────────────────────────────────────
  let game = null, scene = null, pendingState = null, ro = null, mountEl = null;
  let JourneySceneClass = null;
  function getJourneySceneClass() {
    if (JourneySceneClass) return JourneySceneClass;
    JourneySceneClass = class JourneyScene extends Phaser.Scene {
      constructor() { super('journey'); }

      create() {
        this.sky = this.add.graphics();
        this.decor = this.add.container(0, 0);
        this.pathGfx = this.add.graphics();
        this.checkpointsLayer = this.add.container(0, 0);
        this.ghostLayer = this.add.container(0, 0);
        this.avatarLayer = this.add.container(0, 0);
        this.fxLayer = this.add.container(0, 0);
        this.root = this.add.container(0, 0, [this.sky, this.decor, this.pathGfx, this.checkpointsLayer, this.ghostLayer, this.avatarLayer, this.fxLayer]);

        this._built = false;
        this._lastYouFrac = null;
        this._lastDoneIds = new Set();
        this._lastSummit = false;

        if (!this.textures.exists('journeyDot')) {
          const g = this.add.graphics();
          g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 4, 4);
          g.generateTexture('journeyDot', 4, 4); g.destroy();
        }
        if (!this.textures.exists('journeyBalloon')) {
          const g = this.add.graphics();
          g.fillStyle(0xffffff, 1);
          g.fillEllipse(6, 7, 9, 12);
          g.fillTriangle(6, 12.5, 4.3, 14.5, 7.7, 14.5);
          g.generateTexture('journeyBalloon', 12, 16); g.destroy();
        }

        this.input.on('pointerdown', (p) => {
          if (!this.root.scaleX) return;
          this.burst(p.x / this.root.scaleX, p.y / this.root.scaleY, 9);
        });

        if (pendingState) { this.applyState(pendingState); pendingState = null; }
      }

      layout(w, h) {
        if (!w || !h) return;
        this.root.setScale(w / 100, h / 100);
        // Checkpoints and the rocket counter-scale by this ratio on their
        // own container (not the shared layer, which would also shift
        // position) to stay circular regardless of the canvas's aspect.
        this.roundFix = (w / 100) / (h / 100);
      }

      clearContainer(c) { c.each(child => child.destroy()); c.removeAll(); }

      buildCheckpoints(points, tasks, doneCount) {
        this.clearContainer(this.checkpointsLayer);
        const baseR = checkpointRadius(points.length);
        const showLabel = baseR >= 1.9;
        points.forEach((pt, i) => {
          const t = tasks[i];
          const isDone = t.status === 'Completed';
          const isNext = !isDone && i === doneCount;
          const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
          const r = isDone || isNext ? baseR * 1.08 : baseR * 0.92;
          const c = this.add.container(pt.x, pt.y);
          const parts = [this.add.circle(0.3, 0.5, r, 0x000000, 0.25)];
          if (isNext) {
            const glow = this.add.circle(0, 0, r * 1.8, color, 0.3);
            parts.push(glow);
            this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.12, duration: 750, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          }
          parts.push(this.add.circle(0, 0, r, color), this.add.circle(-r * 0.32, -r * 0.35, r * 0.4, 0xffffff, 0.55));
          c.add(parts);
          if (showLabel) {
            const labelColor = isDone ? '#ffffff' : isNext ? '#3a2a00' : '#4B5563';
            c.add(crispLabel(this, 0, 0, isDone ? '✓' : String(i + 1), labelColor, Math.max(2.8, r * 1.5)));
          }
          if (t.latestUpdateIsBlocker && baseR >= 1.7) {
            c.add(crispLabel(this, r * 0.85, -r * 0.85, '🚧', '#000000', Math.max(3, r * 1.4), 'normal'));
          }
          c.setScale(1, this.roundFix || 1);
          this.checkpointsLayer.add(c);
        });
      }

      applyState(state) {
        const firstSync = !this._built;
        if (firstSync) {
          buildBackdrop(this);
          const rocket = buildRocket(this, true);
          rocket.setScale(1, this.roundFix || 1);
          this.avatarLayer.add(rocket);
          this._built = true;
        }

        const points = routePoints(state.tasks.length);
        const doneCount = state.tasks.filter(t => t.status === 'Completed').length;
        drawFlightPath(this, points);
        this.buildCheckpoints(points, state.tasks, doneCount);

        // Celebrate any checkpoint newly done since the last sync, unless
        // Celebration Effects is off — progress still tracks either way.
        const celebrate = state.celebrationsEnabled !== false;
        const nowDoneIds = new Set(state.tasks.filter(t => t.status === 'Completed').map(t => t.id));
        state.tasks.forEach((t, i) => {
          if (t.status === 'Completed' && !this._lastDoneIds.has(t.id) && celebrate) this.burst(points[i].x, points[i].y, 24);
        });
        this._lastDoneIds = nowDoneIds;

        // Ghost (pace/competitor marker) — a faded second rocket.
        this.clearContainer(this.ghostLayer);
        if (state.ghost) {
          const gp = positionAt(points, state.ghost.frac);
          const ghostRocket = buildRocket(this, false);
          const g = this.add.container(gp.x, gp.y, [ghostRocket]);
          g.setScale(1, this.roundFix || 1);
          g.setAlpha(0.4);
          g.add(this.add.container(4, -4, [
            this.add.circle(0, 0, 1.6, 0x0d1b2a),
            crispLabel(this, 0, 0, state.ghost.isComputer ? '🖥' : state.ghost.label.charAt(0).toUpperCase(), '#ffffff', 2.4, 'normal'),
          ]));
          this.ghostLayer.add(g);
        }

        // Rocket — plays a real burn to the new altitude, unless this is
        // the very first placement.
        const you = positionAt(points, state.youFrac);
        const rocket = this.avatarLayer.list[0];
        if (rocket) {
          if (firstSync) {
            rocket.setPosition(you.x, you.y);
          } else if (this._lastYouFrac !== state.youFrac) {
            launchMove(this, rocket, you.x, you.y);
          }
        }
        this._lastYouFrac = state.youFrac;

        if (state.summitLit && !this._lastSummit && celebrate) {
          this.burst(CENTER_X, TOP_Y - 2, 90);
          this.burst(CENTER_X - 14, TOP_Y + 6, 60);
          this.burst(CENTER_X + 14, TOP_Y + 6, 60);
          this.burstBalloons(10);
        }
        this._lastSummit = state.summitLit;
      }

      burst(x, y, count, tint) {
        const colors = [0x0A7E8C, 0xF59E0B, 0xEF4444, 0x22C55E, 0x3B82F6, 0xEC4899];
        const emitter = this.add.particles(x, y, 'journeyDot', {
          speed: { min: 20, max: 70 }, angle: { min: 230, max: 310 }, gravityY: 140,
          scale: { start: 1.6, end: 0.4 }, lifespan: 700, quantity: count, tint: tint || colors, emitting: false,
        });
        this.fxLayer.add(emitter);
        emitter.explode(count);
        this.time.delayedCall(900, () => emitter.destroy());
      }
      burstBalloons(count) {
        const colors = [0xEF4444, 0xF59E0B, 0x22C55E, 0x3B82F6, 0xEC4899, 0xA855F7, 0x0A7E8C];
        const emitter = this.add.particles(50, 95, 'journeyBalloon', {
          x: { min: 15, max: 85 }, speedY: { min: -26, max: -16 }, speedX: { min: -4, max: 4 },
          lifespan: 2600, scale: { start: 1, end: 0.85 }, alpha: { start: 1, end: 0 }, quantity: count, tint: colors, emitting: false,
        });
        this.fxLayer.add(emitter);
        emitter.explode(count);
        this.time.delayedCall(2700, () => emitter.destroy());
      }
    };
    return JourneySceneClass;
  }

  function ensureGame(container) {
    if (game) return Promise.resolve();
    mountEl = container;
    return loadPhaser().then(() => new Promise((resolve) => {
      const w = container.clientWidth || 300, h = container.clientHeight || 300;
      game = new Phaser.Game({
        type: Phaser.AUTO, parent: container, width: w, height: h, transparent: true,
        scene: getJourneySceneClass(), banner: false,
        callbacks: { postBoot: () => { scene = game.scene.getScene('journey'); scene.layout(w, h); resolve(); } },
      });
      ro = new ResizeObserver(() => {
        if (!game || !mountEl) return;
        const cw = mountEl.clientWidth, ch = mountEl.clientHeight;
        if (cw < 10 || ch < 10) return;
        game.scale.resize(cw, ch);
        if (scene) scene.layout(cw, ch);
      });
      ro.observe(container);
    }));
  }

  return {
    buildPhaseLabel(frac) {
      if (frac >= 1) return 'Docked at the station';
      let label = 'On the launchpad';
      PHASES.forEach(p => { if (frac > p.at) label = p.label; });
      return label;
    },
    sync(container, state) {
      return ensureGame(container).then(() => {
        if (scene) scene.applyState(state); else pendingState = state;
      }).catch((e) => {
        console.error('Journey game error:', e);
        container.innerHTML = `
          <div class="absolute inset-0 flex items-center justify-center p-6 text-center">
            <div>
              <p class="text-sm font-semibold text-gray-600 mb-2">⚠️ Couldn't load Journey's graphics</p>
              <p class="text-xs text-gray-400 mb-3">This is usually a network filter or ad blocker blocking the game engine's script. Everything else in the app is unaffected.</p>
              <button onclick="renderMountainScene()" class="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-lg">Try again</button>
            </div>
          </div>`;
      });
    },
    pause() { if (game) game.loop.sleep(); },
    resume() { if (game) game.loop.wake(); },
    destroy() {
      if (ro) { ro.disconnect(); ro = null; }
      if (game) { game.destroy(true); game = null; scene = null; }
      pendingState = null;
      mountEl = null;
    },
  };
})();
