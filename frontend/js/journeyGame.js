// ── JOURNEY GAME (Phaser 3) ──────────────────────────────────────
// Journey view's scene, rendered by an actual game engine instead of
// hand-coded SVG — a persistent Phaser.Game with its own render loop,
// Tween-driven character animation (a real walk cycle, and the avatar
// actually walks from checkpoint to checkpoint when progress changes,
// not just teleporting), and a particle system for celebrations.
//
// No external art: every shape is drawn at runtime with Phaser's
// Graphics API, the same "hand-coded, no downloaded assets" approach
// Journey has used throughout, just executed by a real game framework.
// Phaser itself is lazy-loaded from a CDN the first time Journey opens,
// not on every page load — most sessions never touch this view.
//
// app.js owns all state (tasks, stage, competitor, project) and calls
// JourneyGame.sync({...}) with the derived values each time something
// changes; this module owns only rendering and animation, diffing the
// new state against the last sync to decide what should animate.
const JourneyGame = (() => {
  // Falls back to jsDelivr if cdnjs is unreachable (a network filter or ad
  // blocker blocking one CDN but not the other is common enough to be
  // worth a real fallback, not just a single point of failure).
  const PHASER_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.80.1/phaser.min.js',
    'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js',
  ];
  let loadPromise = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('script load failed: ' + src));
      document.head.appendChild(s);
    });
  }
  function loadPhaser() {
    if (window.Phaser) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = loadScript(PHASER_URLS[0])
      .catch(() => loadScript(PHASER_URLS[1]))
      .catch(() => {
        // A real failure (not just one mirror down) — let the next call
        // try again from scratch instead of staying permanently broken
        // for the rest of the session over one transient network hiccup.
        loadPromise = null;
        throw new Error('Could not load the Journey game engine — check your connection');
      });
    return loadPromise;
  }

  const PALETTES = {
    house: { skyTop: 0x8fcbf2, skyBottom: 0xe3f5fc, trail: 0xb7a68c, avatar: { body: 0xfbbf24, bodyDark: 0xd97706, leg: 0x3b82f6, legDark: 0x1d4ed8, hat: 0xfcd34d, hatDark: 0xf59e0b, hammer: true } },
    road:  { skyTop: 0x2f5fa8, skyBottom: 0xa9d3f0, trail: 0xe8d9b5, avatar: { body: 0x3b5fc4, bodyDark: 0x1e3a8a, leg: 0x1f2937, legDark: 0x0b0f19, hat: null, hatDark: null, hammer: false } },
    cliff: { skyTop: 0xf4a989, skyBottom: 0xfce0c8, trail: 0xfef3c7, avatar: { body: 0xf87171, bodyDark: 0xdc2626, leg: 0x3b5fc4, legDark: 0x1e3a8a, hat: 0xf87171, hatDark: 0xdc2626, hammer: false } },
  };
  const DONE_COLOR = 0x10b981, NEXT_COLOR = 0xfbbf24, PENDING_COLOR = 0xe5e7eb;

  let game = null, scene = null, pendingState = null, ro = null, mountEl = null;

  // ── Avatar: a Container per limb, each rotating around its own
  // attachment point for free (a Container's rotation pivots at its own
  // position — no SVG transform-origin workaround needed here). ──
  function buildAvatar(sc, pal, animated) {
    const root = sc.add.container(0, 0);
    const shadow = sc.add.ellipse(0, 2, 11, 2.4, 0x000000, 0.18);

    const legGeom = (x) => { const g = sc.add.graphics(); g.fillStyle(pal.legDark, 1); g.fillRoundedRect(x, 0, 2.8, 8, 1.3); g.fillStyle(pal.leg, 1); g.fillRoundedRect(x, 0, 2.8, 5, 1.3); return g; };
    const leftLeg = sc.add.container(-2.2, -6.6, [legGeom(-1.4)]);
    const rightLeg = sc.add.container(2.2, -6.6, [legGeom(-1.4)]);

    const armGeom = (x) => { const g = sc.add.graphics(); g.fillStyle(pal.bodyDark, 1); g.fillRoundedRect(x, 0, 2.6, 6.2, 1.3); g.fillStyle(pal.body, 1); g.fillRoundedRect(x, 0, 2.6, 3.5, 1.3); return g; };
    const backArm = sc.add.container(-6.1, -14.6, [armGeom(-1.3)]);

    let toolArm;
    if (pal.hammer) {
      const g = sc.add.graphics();
      g.fillStyle(pal.body, 1); g.fillRoundedRect(-1.3, 0, 2.6, 6.4, 1.3);
      g.fillStyle(0x9ca3af, 1); g.fillRoundedRect(-1.7, -5.4, 5.2, 2.1, 0.8);
      g.fillStyle(0x6b7280, 1); g.fillRect(-0.5, -6.4, 1.1, 1.6);
      toolArm = sc.add.container(3, -9, [g]);
    } else {
      toolArm = sc.add.container(4.3, -14.4, [armGeom(-1.3)]);
    }

    const body = sc.add.graphics();
    body.fillStyle(pal.bodyDark, 1); body.fillRoundedRect(-5.2, -15.5, 10.4, 9.6, 3.4);
    body.fillStyle(pal.body, 1); body.fillRoundedRect(-5.2, -15.5, 10.4, 5.5, 3.4);

    const headG = sc.add.graphics();
    headG.fillStyle(0xf6c89a, 1); headG.fillCircle(0, -18, 4.3);
    headG.fillStyle(0xffe3c2, 1); headG.fillCircle(-0.8, -19, 3.1);
    const eyeL = sc.add.ellipse(-1.6, -18.3, 1.1, 1.1, 0x3a2e1f);
    const eyeR = sc.add.ellipse(1.6, -18.3, 1.1, 1.1, 0x3a2e1f);
    const blushL = sc.add.ellipse(-2.3, -17.1, 1.4, 1.4, 0xfca5a5, 0.55);
    const blushR = sc.add.ellipse(2.3, -17.1, 1.4, 1.4, 0xfca5a5, 0.55);
    const smile = sc.add.graphics();
    smile.lineStyle(0.4, 0xb5703f, 1); smile.beginPath(); smile.arc(0, -17, 1.3, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160)); smile.strokePath();

    let hat = null;
    if (pal.hat) {
      hat = sc.add.graphics();
      hat.fillStyle(pal.hatDark, 1); hat.fillEllipse(0, -20.6, 8.6, 5);
      hat.fillStyle(pal.hat, 1); hat.beginPath();
      hat.arc(0, -20.6, 4.3, Phaser.Math.DegToRad(180), Phaser.Math.DegToRad(360));
      hat.closePath(); hat.fillPath();
    }

    root.add([shadow, leftLeg, rightLeg, backArm, body, headG, eyeL, eyeR, blushL, blushR, smile, toolArm].concat(hat ? [hat] : []));

    if (animated) {
      const STEP = 360; // ms per half-stride
      const spline = { ease: 'Sine.easeInOut' };
      if (pal.hammer) {
        sc.tweens.add({ targets: toolArm, angle: { from: -18, to: 48 }, duration: 275, yoyo: true, repeat: -1, ...spline });
        sc.tweens.add({ targets: root, y: '-=0.9', duration: 500, yoyo: true, repeat: -1, ...spline });
      } else {
        sc.tweens.add({ targets: leftLeg, angle: { from: -28, to: 28 }, duration: STEP, yoyo: true, repeat: -1, ...spline });
        sc.tweens.add({ targets: rightLeg, angle: { from: 28, to: -28 }, duration: STEP, yoyo: true, repeat: -1, ...spline });
        sc.tweens.add({ targets: backArm, angle: { from: 20, to: -20 }, duration: STEP, yoyo: true, repeat: -1, ...spline });
        sc.tweens.add({ targets: toolArm, angle: { from: -20, to: 20 }, duration: STEP, yoyo: true, repeat: -1, ...spline });
        sc.tweens.add({ targets: root, y: '-=0.8', duration: STEP, yoyo: true, repeat: -1, repeatDelay: 0, ...spline });
      }
    }
    return root;
  }

  // Defined lazily (not at module-load time) — `extends Phaser.Scene`
  // evaluates Phaser.Scene the instant this class statement runs, and
  // Phaser itself is only loaded on demand, long after this module parses.
  let JourneySceneClass = null;
  function getJourneySceneClass() {
    if (JourneySceneClass) return JourneySceneClass;
    JourneySceneClass = class JourneyScene extends Phaser.Scene {
    constructor() { super('journey'); }

    create() {
      this.sky = this.add.graphics();
      this.decor = this.add.container(0, 0);
      this.backdrop = this.add.container(0, 0);
      this.trailGfx = this.add.graphics();
      this.checkpointsLayer = this.add.container(0, 0);
      this.ghostLayer = this.add.container(0, 0);
      this.avatarLayer = this.add.container(0, 0);
      this.fxLayer = this.add.container(0, 0);
      this.root = this.add.container(0, 0, [this.sky, this.decor, this.backdrop, this.trailGfx, this.checkpointsLayer, this.ghostLayer, this.avatarLayer, this.fxLayer]);

      this._stageKey = null;
      this._lastYouFrac = null;
      this._lastDoneIds = new Set();
      this._lastSummit = false;
      this._lastHouseFrac = -1;

      this.input.on('pointerdown', (p) => {
        if (!this.root.scaleX) return;
        this.burst(p.x / this.root.scaleX, p.y / this.root.scaleY, 9, null);
      });

      if (pendingState) { this.applyState(pendingState); pendingState = null; }
    }

    layout(w, h) {
      if (!w || !h) return;
      this.root.setScale(w / 100, h / 100);
      // The root's non-uniform scale (the canvas is rarely square) keeps
      // trail/backdrop shapes positioned correctly, but it stretches
      // anything meant to look round into an ellipse. Checkpoints and the
      // avatar counter-scale by this ratio on their own local container
      // (not the shared layer, which would also shift their position) to
      // stay circular/proportioned regardless of the canvas's aspect ratio.
      this.roundFix = (w / 100) / (h / 100);
    }

    drawSky(pal) {
      this.sky.clear();
      this.sky.fillGradientStyle(pal.skyTop, pal.skyTop, pal.skyBottom, pal.skyBottom, 1);
      this.sky.fillRect(0, 0, 100, 100);
    }

    clearContainer(c) { c.each(child => child.destroy()); c.removeAll(); }

    buildDecor(stageKey) {
      this.clearContainer(this.decor);
      const add = (obj) => this.decor.add(obj);
      if (stageKey === 'house') {
        const glow = this.add.circle(84, 14, 13, 0xfff4cc, 0.5); add(glow);
        const sun = this.add.circle(84, 14, 5.5, 0xfde68a, 1); add(sun);
        this.tweens.add({ targets: glow, scale: 1.15, alpha: 0.3, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        [[18, 16, 0], [60, 10, -5]].forEach(([x, y, dx], i) => {
          const c = this.add.container(x, y, [this.add.ellipse(0, 0, 7, 3.2, 0xffffff), this.add.ellipse(6, -2, 5.5, 2.8, 0xffffff)]);
          add(c);
          this.tweens.add({ targets: c, x: x + (dx || 6), duration: 9000 + i * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        });
        const ground = this.add.graphics();
        ground.fillGradientStyle(0x9bdb7e, 0x9bdb7e, 0x6fb859, 0x6fb859, 1);
        ground.fillRect(0, 90, 100, 10);
        add(ground);
        [8, 18, 78, 92, 15, 85].forEach((x, i) => add(this.add.circle(x, 91.5 + (i % 2), 0.5, i % 3 === 0 ? 0xfde68a : 0xffffff, 0.8)));
      } else if (stageKey === 'road') {
        for (let i = 0; i < 8; i++) {
          const x = [10, 22, 4, 16, 88, 94, 78, 96][i], y = [10, 6, 20, 26, 8, 18, 22, 28][i];
          const star = this.add.circle(x, y, [0.5, 0.35, 0.4, 0.3][i % 4], 0xffffff, 0.4);
          add(star);
          this.tweens.add({ targets: star, alpha: { from: 0.3, to: 1 }, duration: 1800 + (i % 3) * 500, delay: i * 250, yoyo: true, repeat: -1 });
        }
        const back = this.add.graphics(); back.fillStyle(0x4c75ae, 1); back.fillTriangle(22, 52, 78, 52, 50, 14); add(back);
        const front = this.add.graphics(); front.fillStyle(0x3b5fc4, 1); front.fillTriangle(34, 52, 66, 52, 50, 24); add(front);
        const glow1 = this.add.circle(50, 16, 14, 0xffffff, 0.35); const glow2 = this.add.circle(50, 16, 7, 0xffffff, 0.5);
        add(glow1); add(glow2);
        this.tweens.add({ targets: glow1, scale: 1.2, alpha: 0.2, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: glow2, scale: 1.3, alpha: 0.35, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 200 });
        const cloud = this.add.container(14, 34, [this.add.ellipse(0, 0, 6, 2.6, 0xffffff, 0.8), this.add.ellipse(5, -2, 4.5, 2.2, 0xffffff, 0.7)]);
        add(cloud);
        this.tweens.add({ targets: cloud, x: 22, duration: 10000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        add(this.buildFlag(50, 6));
      } else {
        const sunGlow = this.add.circle(86, 16, 6.5, 0xfff0dd, 0.9); add(sunGlow);
        this.tweens.add({ targets: sunGlow, scale: 1.12, alpha: 0.7, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const cloud1 = this.add.container(20, 14, [this.add.ellipse(0, 0, 7, 3, 0xffffff, 0.85)]);
        const cloud2 = this.add.container(26, 12, [this.add.ellipse(0, 0, 5, 2.4, 0xffffff, 0.7)]);
        add(cloud1); add(cloud2);
        [[18, 18], [76, 14], [60, 24]].forEach(([x, y], i) => {
          const bird = this.add.graphics();
          bird.lineStyle(0.6, 0x5b4636, 0.75);
          bird.beginPath(); bird.arc(x, y, 3, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340)); bird.strokePath();
          bird.beginPath(); bird.arc(x + 6, y, 3, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340)); bird.strokePath();
          add(bird);
          this.tweens.add({ targets: bird, x: 10 + i * 3, y: -1.5, duration: 9000 + i * 2000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        });
        const back = this.add.graphics(); back.fillStyle(0xc79b7d, 1);
        back.fillPoints([{ x: 0, y: 100 }, { x: 0, y: 30 }, { x: 48, y: 6 }, { x: 100, y: 50 }, { x: 100, y: 100 }], true);
        add(back);
        const front = this.add.graphics(); front.fillStyle(0xa3785d, 1);
        front.fillPoints([{ x: 0, y: 100 }, { x: 0, y: 46 }, { x: 40, y: 24 }, { x: 62, y: 62 }, { x: 100, y: 78 }, { x: 100, y: 100 }], true);
        add(front);
        const rope = this.add.graphics();
        const ropePts = [[50, 90], [45, 76], [53, 60], [46, 44], [54, 28], [49, 10]];
        rope.lineStyle(1, 0x8b6952, 1);
        for (let i = 0; i < ropePts.length - 1; i++) rope.lineBetween(...ropePts[i], ...ropePts[i + 1]);
        rope.lineStyle(0.4, 0xd9be92, 0.9);
        for (let i = 0; i < ropePts.length - 1; i++) rope.lineBetween(...ropePts[i], ...ropePts[i + 1]);
        add(rope);
        add(this.buildFlag(48, 6));
      }
    }

    // A pole + a pennant that flutters — built once per backdrop, its own
    // points animated directly (safer than rotating/scaling the whole
    // thing from a shared pivot, which would fight the non-uniform scale
    // everything else in the scene already has to work around).
    buildFlag(x, y) {
      const c = this.add.container(0, 0);
      const pole = this.add.graphics();
      pole.lineStyle(0.8, 0xe5e7eb, 1);
      pole.lineBetween(x, y, x, y + 10);
      const flag = this.add.graphics();
      let t = 0;
      const draw = (lean) => {
        flag.clear();
        flag.fillStyle(0xef4444, 1);
        flag.fillTriangle(x, y, x, y + 5, x + 6 + lean, y + 2.5);
        flag.lineStyle(0.3, 0x991b1b, 1);
        flag.strokeTriangle(x, y, x, y + 5, x + 6 + lean, y + 2.5);
      };
      draw(0);
      c.add([pole, flag]);
      this.tweens.addCounter({
        from: 0, to: 1, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        onUpdate: (tw) => { t = tw.getValue(); draw(-1.5 * t); },
      });
      return c;
    }

    // Each phase's pieces live in their own Container so the whole group
    // can drop into place with one tween — 'Back.easeOut' overshoots and
    // settles on its own, a real entrance instead of just appearing, but
    // only plays the first time progress actually crosses that phase's
    // threshold (prevFrac), not on every unrelated re-sync.
    housePiecesAt(frac, prevFrac, add) {
      const dropIn = (piece) => {
        piece.y -= 9;
        this.tweens.add({ targets: piece, y: '+=9', duration: 550, ease: 'Back.easeOut' });
      };
      if (frac > 0) {
        const piece = this.add.container(0, 0);
        const f = this.add.graphics();
        f.fillStyle(0x8d95a0, 1); f.fillRoundedRect(30, 86, 40, 5, 1.2);
        f.fillStyle(0xb6bdc6, 1); f.fillRoundedRect(30, 86, 40, 2, 1.2);
        piece.add(f); add(piece);
        if (!(prevFrac > 0)) dropIn(piece);
      }
      if (frac > 0.25) {
        const piece = this.add.container(0, 0);
        const w = this.add.graphics();
        w.fillStyle(0xf3d29c, 1); w.fillRect(32, 62, 36, 24);
        w.fillStyle(0xfff2d6, 1); w.fillRect(32, 62, 36, 10);
        piece.add(w); add(piece);
        if (!(prevFrac > 0.25)) dropIn(piece);
      }
      if (frac > 0.5) {
        const piece = this.add.container(0, 0);
        const r = this.add.graphics();
        r.fillStyle(0x9a4a0e, 1); r.fillTriangle(26, 63, 74, 63, 50, 40);
        r.fillStyle(0xd2691e, 1); r.fillTriangle(32, 58, 62, 58, 50, 40);
        piece.add(r); add(piece);
        if (!(prevFrac > 0.5)) dropIn(piece);
      }
      if (frac > 0.75) {
        const piece = this.add.container(0, 0);
        const d = this.add.graphics();
        d.fillStyle(0x6b4423, 1); d.fillRoundedRect(44, 72, 12, 14, 0.8);
        d.fillStyle(0xfbbf24, 1); d.fillCircle(53.5, 79, 0.7);
        d.fillStyle(0x8fcbea, 1); d.fillRoundedRect(35.5, 66.5, 7, 7, 0.8);
        d.fillRoundedRect(57.5, 66.5, 7, 7, 0.8);
        d.fillStyle(0x6b4423, 1); d.fillRect(60, 44, 5.5, 12);
        piece.add(d); add(piece);
        if (!(prevFrac > 0.75)) dropIn(piece);
        // Two puffs rising and fading on staggered loops — alpha driven
        // from the tween's own progress (rise-then-fade) rather than a
        // multi-stop keyframe shorthand, to keep this reliably correct.
        for (let k = 0; k < 2; k++) {
          const puff = this.add.circle(62.7, 41, 1.2 + k * 0.3, 0xe5e7eb, 0);
          add(puff);
          this.tweens.add({
            targets: puff, y: 26, duration: 2600, delay: k * 900, repeat: -1,
            onUpdate: (tw) => { puff.alpha = tw.progress < 0.5 ? tw.progress * 1.5 : (1 - tw.progress) * 1.5; },
          });
        }
      }
    }

    buildBackdropContent(stageKey, youFrac) {
      this.clearContainer(this.backdrop);
      const add = (obj) => this.backdrop.add(obj);
      if (stageKey === 'house') {
        const prevFrac = this._lastHouseFrac === undefined ? -1 : this._lastHouseFrac;
        this.housePiecesAt(youFrac, prevFrac, add);
        this._lastHouseFrac = youFrac;
      }
    }

    drawTrail(points, color, isRoad) {
      this.trailGfx.clear();
      // The Road stage gets an actual road — a thick solid ribbon with a
      // dashed centerline on top — everyone else gets the plain dashed
      // trail this started as.
      if (isRoad) {
        this.trailGfx.lineStyle(7, color, 0.95);
        for (let i = 0; i < points.length - 1; i++) this.trailGfx.lineBetween(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
        this.trailGfx.lineStyle(0.8, 0xffffff, 0.9);
      } else {
        this.trailGfx.lineStyle(1.5, color, 0.85);
      }
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        const steps = Math.max(1, Math.floor(dist / 3));
        for (let s = 0; s < steps; s += 2) {
          const t0 = s / steps, t1 = Math.min(1, (s + 1) / steps);
          this.trailGfx.lineBetween(
            a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0,
            a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
        }
      }
    }

    buildCheckpoints(points, tasks, doneCount) {
      this.clearContainer(this.checkpointsLayer);
      points.forEach((p, i) => {
        const t = tasks[i];
        const isDone = t.status === 'Completed';
        const isNext = !isDone && i === doneCount;
        const color = isDone ? DONE_COLOR : isNext ? NEXT_COLOR : PENDING_COLOR;
        const r = isDone || isNext ? 3.6 : 3.1;
        const c = this.add.container(p.x, p.y);
        const shadow = this.add.circle(0.3, 0.4, r, 0x000000, 0.25);
        const base = this.add.circle(0, 0, r, color);
        const hi = this.add.circle(-r * 0.3, -r * 0.3, r * 0.45, 0xffffff, 0.5);
        const label = this.add.text(0, 0, isDone ? '✓' : String(i + 1), { fontSize: '5px', fontStyle: 'bold', fontFamily: 'Arial, sans-serif', color: isDone ? '#ffffff' : isNext ? '#0D1B2A' : '#6B7280' }).setOrigin(0.5);
        c.add([shadow, base, hi, label]);
        if (t.latestUpdateIsBlocker) {
          const cone = this.add.text(r * 0.8, -r * 0.8, '🚧', { fontSize: '5px' }).setOrigin(0.5);
          c.add(cone);
        }
        c.setScale(1, this.roundFix || 1);
        this.checkpointsLayer.add(c);
      });
    }

    applyState(state) {
      const pal = PALETTES[state.stageKey] || PALETTES.house;
      const stageChanged = this._stageKey !== state.stageKey;
      this._stageKey = state.stageKey;

      if (stageChanged) {
        this.drawSky(pal);
        this.buildDecor(state.stageKey);
        this.clearContainer(this.avatarLayer);
        this.clearContainer(this.ghostLayer);
        const av = buildAvatar(this, pal.avatar, true);
        av.setScale(1, this.roundFix || 1);
        this.avatarLayer.add(av);
        this._lastDoneIds = new Set();
        this._lastHouseFrac = -1;
      }
      this.buildBackdropContent(state.stageKey, state.youFrac);

      const points = mountainCheckpoints(state.tasks.length, state.topY, state.bottomY);
      this.drawTrail(points, pal.trail, state.stageKey === 'road');
      const doneCount = state.tasks.filter(t => t.status === 'Completed').length;
      this.buildCheckpoints(points, state.tasks, doneCount);

      // Celebrate any checkpoint that's newly done since the last sync.
      const nowDoneIds = new Set(state.tasks.filter(t => t.status === 'Completed').map(t => t.id));
      state.tasks.forEach((t, i) => {
        if (t.status === 'Completed' && !this._lastDoneIds.has(t.id)) {
          const p = points[i];
          this.burst(p.x, p.y, 26, pal.trail);
        }
      });
      this._lastDoneIds = nowDoneIds;

      // Ghost (pace/competitor marker).
      this.clearContainer(this.ghostLayer);
      if (state.ghost) {
        const gp = mountainPointAt(points, state.ghost.frac, state.topY, state.bottomY);
        const ghostAvatar = buildAvatar(this, pal.avatar, false);
        const g = this.add.container(gp.x, gp.y - 9.2, [ghostAvatar]);
        g.setScale(1, this.roundFix || 1);
        g.setAlpha(0.45);
        const badge = this.add.container(3, -16, [
          this.add.circle(0, 0, 1.6, 0x0d1b2a),
          this.add.text(0, 0, state.ghost.isComputer ? '🖥' : state.ghost.label.charAt(0).toUpperCase(), { fontSize: '2.6px', color: '#fff' }).setOrigin(0.5),
        ]);
        g.add(badge);
        this.ghostLayer.add(g);
      }

      // Avatar — walk (tween) to the new spot rather than snapping, unless
      // this is the first placement for this stage/project.
      const you = mountainPointAt(points, state.youFrac, state.topY, state.bottomY);
      const avatar = this.avatarLayer.list[0];
      if (avatar) {
        if (this._lastYouFrac === null || stageChanged) {
          avatar.setPosition(you.x, you.y - 9.2);
        } else if (this._lastYouFrac !== state.youFrac) {
          this.tweens.add({ targets: avatar, x: you.x, y: you.y - 9.2, duration: 900, ease: 'Sine.easeInOut' });
        }
      }
      this._lastYouFrac = state.youFrac;

      if (state.summitLit && !this._lastSummit) {
        this.burst(50, 8, 90, pal.trail);
        this.burst(30, 20, 60, pal.trail);
        this.burst(70, 20, 60, pal.trail);
      }
      this._lastSummit = state.summitLit;
    }

    burst(xFrac, yFrac, count) {
      const colors = [0x0A7E8C, 0xF59E0B, 0xEF4444, 0x22C55E, 0x3B82F6, 0xEC4899];
      const emitter = this.add.particles(xFrac, yFrac, 'journeyDot', {
        speed: { min: 20, max: 70 },
        angle: { min: 230, max: 310 },
        gravityY: 140,
        scale: { start: 1.6, end: 0.4 },
        lifespan: 700,
        quantity: count,
        tint: colors,
        emitting: false,
      });
      this.fxLayer.add(emitter);
      emitter.explode(count);
      this.time.delayedCall(900, () => emitter.destroy());
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
        type: Phaser.AUTO,
        parent: container,
        width: w, height: h,
        transparent: true,
        scene: getJourneySceneClass(),
        banner: false,
        callbacks: { postBoot: () => {
          scene = game.scene.getScene('journey');
          scene.layout(w, h);
          resolve();
        } },
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
    // state: { stageKey, tasks, topY, bottomY, youFrac, ghost, summitLit }
    sync(container, state) {
      return ensureGame(container).then(() => {
        if (scene) scene.applyState(state); else pendingState = state;
      }).catch(e => {
        console.error('Journey game error:', e);
        // Visible, not just logged — a blocked CDN script otherwise fails
        // silently and the scene area just stays blank, which looks
        // indistinguishable from "nothing happening".
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
