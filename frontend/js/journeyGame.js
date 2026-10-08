// ── JOURNEY GAME (Phaser 3) ──────────────────────────────────────
// Journey view's scene: "Cliff Climb" — a climber works their way up a
// rock face on a rope, clipping into a new anchor as each task completes,
// with a summit flag waiting at the top. Rendered by an actual game
// engine (Phaser 3 — the same "JS game library" approach picked earlier
// for Journey over hand-rolled SVG or a native engine) instead of static
// art: a persistent Phaser.Game with its own render loop, Tween-driven
// character animation, and a particle system.
//
// No external art: every shape — the rock face, the rope, the climber —
// is drawn at runtime with Phaser's Graphics API. Phaser itself is
// lazy-loaded from a CDN the first time Journey opens, not on every page
// load — most sessions never touch this view.
//
// app.js owns all state (tasks, competitor, project) and calls
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

  const DONE_COLOR = 0x10b981, NEXT_COLOR = 0xfbbf24, PENDING_COLOR = 0xcbd5c8;
  const TOP_Y = 16, BOTTOM_Y = 90, CENTER_X = 50;

  function shade(color, factor) {
    const c = Phaser.Display.Color.ValueToColor(color);
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
    return Phaser.Display.Color.GetColor(clamp(c.red), clamp(c.green), clamp(c.blue));
  }
  // Phaser rasterizes Text at its own font-size, then the scene's ~10x
  // container scale blows that bitmap up — a small font looks crisp at
  // design time and comes out visibly blurry on screen. The fix is the
  // opposite order: render at a large, sharp font size, then shrink the
  // object itself with setScale() so the already-sharp bitmap is scaled
  // down (always clean) instead of a tiny one being scaled up (never is).
  function addCrispLabel(sc, x, y, str, color, targetSize, fontWeight) {
    const FONT_PX = 34;
    const label = sc.add.text(x, y, str, { fontSize: FONT_PX + 'px', fontStyle: fontWeight || 'bold', fontFamily: 'Arial, sans-serif', color }).setOrigin(0.5);
    label.setScale(targetSize / FONT_PX);
    return label;
  }

  // A distant bird: an open gull-wing stroke (two shallow V's meeting in
  // the middle) — the classic small-bird mark, legible at a glance.
  // A *filled* triangle at this size reads as an arrowhead or debris
  // instead, so this is a stroke, never a fill.
  function drawBird(g, x, y, s, alpha) {
    g.lineStyle(0.35 * s, 0x3a2f28, alpha != null ? alpha : 0.8);
    g.beginPath();
    g.moveTo(x - 2.4 * s, y + 0.3 * s);
    g.lineTo(x - 0.6 * s, y - 1 * s);
    g.lineTo(x, y - 0.2 * s);
    g.lineTo(x + 0.6 * s, y - 1 * s);
    g.lineTo(x + 2.4 * s, y + 0.3 * s);
    g.strokePath();
  }

  // ── THE CLIMBER — a chibi figure clinging to the rock, Container-per-
  // limb so each rotates around its own joint for free. Unlike a walk
  // cycle this isn't a continuous loop: idle() is a small constant "still
  // finding their grip" sway, and climbMove() is a real three-beat action
  // — reach for the next hold, pull the body up to it, settle in — played
  // once per completed task instead of just sliding a dot along a line.
  const C = {
    jacket: 0xe25c3f, jacketDark: 0xb6432b, jacketLight: 0xf2886e,
    pants: 0x3b6ea5, pantsDark: 0x274d79, shoe: 0xf2ece0,
    skin: 0xf6c89a, skinLight: 0xffe3c2, hair: 0x4a2f1e,
    helmet: 0xfbbf24, helmetDark: 0xd99e1a, harness: 0x1f2937,
  };
  function outline(g, col) { g.lineStyle(0.3, col || 0x1a2230, 0.3); }
  function buildClimber(sc, animated) {
    // `root` is a bare position handle — applyState()/climbMove() tween
    // its x/y to move the climber up the rope, and the caller applies the
    // roundFix counter-scale to it. All the actual drawing lives in `art`,
    // scaled down on its own so the figure reads as small against the
    // rock face without that scale fighting the position tween on `root`.
    const root = sc.add.container(0, 0);
    const art = sc.add.container(0, 0);
    art.setScale(0.46);
    root.add(art);

    const legGeom = (x, flip) => {
      const g = sc.add.graphics();
      g.fillStyle(C.pantsDark, 1); g.fillRoundedRect(x, 0, 2.8, 7.6, 1.2);
      g.fillStyle(C.pants, 1); g.fillRoundedRect(x, 0, 2.8, 5, 1.2);
      g.fillStyle(C.shoe, 1); g.fillRoundedRect(x - (flip ? 0.6 : 0.1), 6.4, 3.3, 2, 1);
      outline(g); g.strokeRoundedRect(x, 0, 2.8, 7.6, 1.2);
      return g;
    };
    // Cling pose: one knee driven up onto a foothold, the other braced
    // lower — not a neutral standing stance.
    const leftLeg = sc.add.container(-2.4, -6.2, [legGeom(-1.4, false)]);
    leftLeg.setAngle(-34);
    const rightLeg = sc.add.container(2.6, -7.2, [legGeom(-1.4, true)]);
    rightLeg.setAngle(12);

    // Long enough that, rotated ~165° from its hanging-down rest
    // direction, the hand clears well above the head to grip the rope
    // instead of crossing in front of the face.
    const armGeom = (x) => {
      const g = sc.add.graphics();
      g.fillStyle(C.jacketDark, 1); g.fillRoundedRect(x, 0, 2.6, 8.6, 1.3);
      g.fillStyle(C.jacket, 1); g.fillRoundedRect(x, 0, 2.6, 4.6, 1.3);
      g.fillStyle(C.skin, 1); g.fillCircle(x + 1.3, 8.6, 1.55); // gripping hand
      outline(g); g.strokeRoundedRect(x, 0, 2.6, 8.6, 1.3);
      return g;
    };
    // Both hands grip the rope itself, nearly overhead — a rope ascent,
    // not a reach for scattered rock holds — one hand higher than the
    // other, hand-over-hand. (The arm's local "rest" direction points
    // straight down from its shoulder pivot at angle 0, so ~130° of
    // rotation is what actually swings the hand up above the head.)
    const backArm = sc.add.container(-3.4, -16.6, [armGeom(-1.3)]);
    backArm.setAngle(-165);
    const frontArm = sc.add.container(3.6, -15.4, [armGeom(-1.3)]);
    frontArm.setAngle(165);

    // A soft shadow the climber casts onto the rock behind them — reads
    // as "a few inches off the wall", not pasted flat onto it.
    const wallShadow = sc.add.ellipse(1.6, -11, 9, 13, 0x000000, 0.2);

    const body = sc.add.graphics();
    body.fillStyle(C.jacketDark, 1); body.fillRoundedRect(-5.0, -15.8, 10.0, 9.4, 3.2);
    body.fillStyle(C.jacket, 1); body.fillRoundedRect(-5.0, -15.8, 10.0, 5.6, 3.2);
    body.fillStyle(C.jacketLight, 0.5); body.fillRoundedRect(-5.0, -15.8, 4.0, 5.6, 3.2);
    outline(body); body.strokeRoundedRect(-5.0, -15.8, 10.0, 9.4, 3.2);
    // Rim-light — a bright stroke down the sun-facing edge, matching the
    // cliff's own rim-light so the whole scene reads as one light source.
    body.lineStyle(0.45, 0xffe6c0, 0.75);
    body.beginPath(); body.moveTo(4.9, -15); body.lineTo(4.9, -6.6); body.strokePath();
    // Harness belt + a hanging loop the rope "clips" into — the one
    // detail that most says "climbing gear" at a glance.
    const harness = sc.add.graphics();
    harness.fillStyle(C.harness, 1); harness.fillRoundedRect(-5.1, -8.0, 10.2, 1.6, 0.6);
    harness.fillStyle(0xd1d5db, 1); harness.fillCircle(0, -5.6, 0.9);
    harness.lineStyle(0.3, 0x9ca3af, 1); harness.lineBetween(0, -7.0, 0, -6.4);

    const headG = sc.add.graphics();
    headG.fillStyle(C.skin, 1); headG.fillCircle(0, -18, 4.3);
    headG.fillStyle(C.skinLight, 1); headG.fillCircle(-0.9, -19, 3.1);
    outline(headG); headG.strokeCircle(0, -18, 4.3);
    headG.fillStyle(C.hair, 1); headG.fillTriangle(-3.8, -19.6, -1.6, -22.2, 0.5, -19.9);
    // Helmet — the climbing-specific silhouette swap that makes this read
    // as "on a cliff", not just "a person standing somewhere".
    headG.fillStyle(C.helmetDark, 1);
    headG.beginPath(); headG.arc(0, -19.2, 4.55, Phaser.Math.DegToRad(190), Phaser.Math.DegToRad(-10)); headG.closePath(); headG.fillPath();
    headG.fillStyle(C.helmet, 1);
    headG.beginPath(); headG.arc(0.2, -19.5, 4.2, Phaser.Math.DegToRad(188), Phaser.Math.DegToRad(-8)); headG.closePath(); headG.fillPath();
    headG.fillStyle(0xffffff, 0.45); headG.fillEllipse(1.4, -22.2, 2.2, 0.9);
    headG.lineStyle(0.3, C.helmetDark, 0.6); headG.strokeEllipse(0.2, -19.5, 8.4, 4.0);
    headG.lineStyle(0.35, 0xfff3d6, 0.7); headG.beginPath(); headG.arc(0.2, -19.5, 4.2, Phaser.Math.DegToRad(-8), Phaser.Math.DegToRad(30)); headG.strokePath();

    const eyeL = sc.add.ellipse(-1.6, -18.1, 1.1, 1.3, 0x2b2320);
    const eyeR = sc.add.ellipse(1.6, -18.1, 1.1, 1.3, 0x2b2320);
    const eyeShineL = sc.add.ellipse(-1.9, -18.5, 0.4, 0.4, 0xffffff, 0.9);
    const eyeShineR = sc.add.ellipse(1.3, -18.5, 0.4, 0.4, 0xffffff, 0.9);
    const blushL = sc.add.ellipse(-2.3, -16.9, 1.3, 1.3, 0xfca5a5, 0.5);
    const blushR = sc.add.ellipse(2.3, -16.9, 1.3, 1.3, 0xfca5a5, 0.5);
    const smile = sc.add.graphics();
    smile.lineStyle(0.45, 0xb5703f, 1); smile.beginPath(); smile.arc(0, -16.8, 1.25, Phaser.Math.DegToRad(15), Phaser.Math.DegToRad(165)); smile.strokePath();
    // Clenched-jaw determination line for a "working hard" read, under
    // the smile only while actively mid-move (toggled by climbMove()).
    const effortBrow = sc.add.graphics();
    effortBrow.lineStyle(0.45, 0x4a2f1e, 0); effortBrow.lineBetween(-2.6, -20.3, -0.8, -20.0);
    effortBrow.lineBetween(0.8, -20.0, 2.6, -20.3);

    art.add([wallShadow, rightLeg, leftLeg, backArm, body, harness, headG, eyeL, eyeR, eyeShineL, eyeShineR, blushL, blushR, smile, effortBrow, frontArm]);

    const parts = { art, leftLeg, rightLeg, backArm, frontArm, body };

    if (animated) {
      // A climber clinging to a rock face is never perfectly still —
      // small continuous grip adjustments, independently timed per limb
      // so it doesn't read as a mechanical loop.
      const idle = { ease: 'Sine.easeInOut', yoyo: true, repeat: -1 };
      sc.tweens.add({ targets: backArm, angle: { from: -165, to: -158 }, duration: 900, ...idle });
      sc.tweens.add({ targets: frontArm, angle: { from: 165, to: 158 }, duration: 760, delay: 180, ...idle });
      sc.tweens.add({ targets: leftLeg, angle: { from: -34, to: -27 }, duration: 1100, delay: 320, ...idle });
      sc.tweens.add({ targets: rightLeg, angle: { from: 12, to: 18 }, duration: 980, delay: 90, ...idle });
      sc.tweens.add({ targets: art, y: { from: 0, to: -0.6 }, duration: 1400, ...idle });
    }
    root._parts = parts;
    return root;
  }

  // A real three-beat rope-ascent action instead of a sliding tween:
  // reach higher up the rope, pull the body up hand-over-hand, settle.
  // Called once per newly completed task so progress is something the
  // climber visibly *does*, not just a position that changes.
  function climbMove(sc, climber, toX, toY, onComplete) {
    const p = climber._parts;
    if (!p) { sc.tweens.add({ targets: climber, x: toX, y: toY, duration: 700, ease: 'Sine.easeInOut', onComplete }); return; }
    sc.tweens.killTweensOf([p.backArm, p.frontArm, p.leftLeg, p.rightLeg, p.art, climber]);
    const fromX = climber.x, fromY = climber.y;
    const liftX = fromX + (toX - fromX) * 0.35, liftY = fromY - 4;
    const tl = [];
    // Beat 1 — reach: the front hand slides further up the rope, back leg
    // drives up against the rock for the push.
    tl.push(() => {
      sc.tweens.add({ targets: p.frontArm, angle: 178, duration: 260, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p.rightLeg, angle: -10, duration: 260, ease: 'Sine.easeOut' });
      sc.time.delayedCall(260, run.bind(null, 1));
    });
    // Beat 2 — pull: hand-over-hand up the rope while the body rises —
    // the back hand releases and drops toward the chest as the body
    // passes it — with a small chalk-puff at the new grip.
    tl.push(() => {
      sc.tweens.add({ targets: climber, x: liftX, y: liftY, duration: 210, ease: 'Sine.easeIn' });
      sc.tweens.add({
        targets: climber, x: toX, y: toY, duration: 300, delay: 210, ease: 'Sine.easeOut',
        onComplete: () => { chalkPuff(sc, climber.x, climber.y - 11); },
      });
      sc.tweens.add({ targets: p.backArm, angle: -105, duration: 480, ease: 'Sine.easeInOut' });
      sc.tweens.add({ targets: p.leftLeg, angle: -46, duration: 480, ease: 'Sine.easeInOut' });
      sc.time.delayedCall(510, run.bind(null, 2));
    });
    // Beat 3 — settle: limbs ease back to the resting rope-grip pose and
    // the idle sway resumes.
    tl.push(() => {
      sc.tweens.add({ targets: p.backArm, angle: -165, duration: 260, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p.frontArm, angle: 165, duration: 260, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p.leftLeg, angle: -34, duration: 260, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p.rightLeg, angle: 12, duration: 260, ease: 'Sine.easeOut',
        onComplete: () => { startIdleSway(sc, p); if (onComplete) onComplete(); } });
    });
    function run(i) { tl[i](); }
    run(0);
  }
  function startIdleSway(sc, p) {
    const idle = { ease: 'Sine.easeInOut', yoyo: true, repeat: -1 };
    sc.tweens.add({ targets: p.backArm, angle: { from: -165, to: -158 }, duration: 900, ...idle });
    sc.tweens.add({ targets: p.frontArm, angle: { from: 165, to: 158 }, duration: 760, delay: 180, ...idle });
    sc.tweens.add({ targets: p.leftLeg, angle: { from: -34, to: -27 }, duration: 1100, delay: 320, ...idle });
    sc.tweens.add({ targets: p.rightLeg, angle: { from: 12, to: 18 }, duration: 980, delay: 90, ...idle });
  }
  function chalkPuff(sc, x, y) {
    const emitter = sc.add.particles(x, y, 'journeyDot', {
      speed: { min: 4, max: 14 }, angle: { min: 200, max: 340 }, gravityY: -6,
      scale: { start: 1.1, end: 0 }, alpha: { start: 0.8, end: 0 }, lifespan: 420, quantity: 8, tint: 0xffffff,
    });
    sc.time.delayedCall(450, () => emitter.destroy());
  }
  function dustPuff(sc, x, y) {
    const emitter = sc.add.particles(x, y, 'journeyDot', {
      speed: { min: 6, max: 20 }, angle: { min: 160, max: 380 }, gravityY: 4,
      scale: { start: 1.3, end: 0 }, alpha: { start: 0.6, end: 0 }, lifespan: 500, quantity: 10, tint: [0xc9b89a, 0x9c8a6e],
    });
    sc.time.delayedCall(550, () => emitter.destroy());
  }

  // ── THE CAR — "Mountain Drive": a small cartoon vehicle switching back
  // up a mountain road, one zigzag per task, instead of the Cliff Climb's
  // rope ascent. Same Container-per-part rig philosophy as the climber —
  // wheels that actually rotate, a suspension that actually bounces —
  // so driving reads as something the car *does*, not a sprite sliding.
  const V = { body: 0x2563eb, bodyDark: 0x1d4ed8, bodyLight: 0x60a5fa, roof: 0xf8fafc, tire: 0x1f2937, hub: 0xd1d5db, glass: 0xbfe3f0 };
  function buildVehicle(sc, animated) {
    const root = sc.add.container(0, 0);
    const art = sc.add.container(0, 0);
    art.setScale(0.5);
    root.add(art);

    const shadow = sc.add.ellipse(0, 1.2, 15, 3, 0x000000, 0.22);

    const wheelGeom = () => {
      const g = sc.add.graphics();
      g.fillStyle(V.tire, 1); g.fillCircle(0, 0, 3.1);
      g.fillStyle(V.hub, 1); g.fillCircle(0, 0, 1.3);
      g.lineStyle(0.4, 0x4b5563, 1); g.lineBetween(-1.3, 0, 1.3, 0); g.lineBetween(0, -1.3, 0, 1.3);
      outline(g, 0x0a0f1a); g.strokeCircle(0, 0, 3.1);
      return g;
    };
    const wheelBack = sc.add.container(-5.4, 0, [wheelGeom()]);
    const wheelFront = sc.add.container(5.4, 0, [wheelGeom()]);

    const body = sc.add.graphics();
    // Lower chassis.
    body.fillStyle(V.bodyDark, 1); body.fillRoundedRect(-9, -8, 18, 7.5, 2.4);
    body.fillStyle(V.body, 1); body.fillRoundedRect(-9, -8, 18, 4.6, 2.4);
    body.fillStyle(V.bodyLight, 0.5); body.fillRoundedRect(-9, -8, 7, 4.6, 2.4);
    // Cabin/roof.
    body.fillStyle(V.roof, 1); body.fillRoundedRect(-5, -14.2, 10.5, 7, 2.8);
    body.fillStyle(V.glass, 1); body.fillRoundedRect(-3.8, -13, 8.2, 4, 1.6);
    body.fillStyle(0xffffff, 0.4); body.fillRoundedRect(-3.8, -13, 3.6, 4, 1.6);
    // Lights + bumper detail.
    body.fillStyle(0xfff3b0, 1); body.fillCircle(8.6, -4.6, 1.2); // headlight
    body.fillStyle(0xef4444, 1); body.fillCircle(-8.6, -4.6, 1.0); // taillight
    body.fillStyle(0xe5e7eb, 1); body.fillRoundedRect(-9.6, -2.2, 19.2, 1.6, 0.8); // bumper strip
    outline(body); body.strokeRoundedRect(-9, -8, 18, 7.5, 2.4);
    body.strokeRoundedRect(-5, -14.2, 10.5, 7, 2.8);
    // Rim-light matching the rest of the scene's sun direction.
    body.lineStyle(0.45, 0xffe6c0, 0.7);
    body.beginPath(); body.moveTo(8.9, -7.6); body.lineTo(8.9, -2.6); body.strokePath();

    art.add([shadow, wheelBack, body, wheelFront]);
    const parts = { art, wheelBack, wheelFront, body };

    if (animated) {
      // Parked: a gentle idle suspension bounce — never perfectly still.
      sc.tweens.add({ targets: art, y: { from: 0, to: -0.5 }, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    root._parts = parts;
    root._isVehicle = true;
    return root;
  }

  // Drive to the next switchback: wheels actually spin through the move,
  // the car leans into the direction of travel, and a dust puff kicks up
  // at departure and a suspension bounce settles it on arrival — real
  // motion cues, not just a sliding position.
  function driveMove(sc, vehicle, toX, toY, onComplete) {
    const p = vehicle._parts;
    if (!p) { sc.tweens.add({ targets: vehicle, x: toX, y: toY, duration: 700, ease: 'Sine.easeInOut', onComplete }); return; }
    sc.tweens.killTweensOf([p.wheelBack, p.wheelFront, p.art, p.body, vehicle]);
    const dx = toX - vehicle.x;
    const lean = Phaser.Math.Clamp(dx * 3, -14, 14);
    dustPuff(sc, vehicle.x - Math.sign(dx || 1) * 6, vehicle.y - 1);
    sc.tweens.add({ targets: p.body, angle: lean, duration: 180, ease: 'Sine.easeOut', yoyo: false });
    sc.tweens.add({ targets: [p.wheelBack, p.wheelFront], angle: '+=' + (Math.sign(dx || 1) * 540), duration: 620, ease: 'Sine.easeInOut' });
    sc.tweens.add({
      targets: vehicle, x: toX, y: toY, duration: 620, ease: 'Sine.easeInOut',
      onComplete: () => {
        dustPuff(sc, vehicle.x, vehicle.y - 1);
        sc.tweens.add({ targets: p.body, angle: 0, duration: 220, ease: 'Back.easeOut' });
        sc.tweens.add({ targets: p.art, y: { from: -1.4, to: 0 }, duration: 260, ease: 'Bounce.easeOut', onComplete });
      },
    });
  }

  // ── THE ROUTE — one rope, anchored at the summit and run straight down
  // to the base, with a clip point per task. A real rope hangs close to
  // vertical under its own tension, so the per-point sideways jitter is
  // small — just enough that the clips don't all stack on one line —
  // rather than the wide switchback a walking trail would use.
  function climbRoute(n) {
    const points = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 1;
      const y = BOTTOM_Y - t * (BOTTOM_Y - TOP_Y);
      const amp = 6 - t * 3;
      const side = i % 2 === 0 ? -1 : 1;
      points.push({ x: CENTER_X + side * amp, y });
    }
    return points;
  }
  function checkpointRadius(n) { return Math.max(1.8, Math.min(4.2, 34 / Math.max(1, n))); }
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

  // ── CLIFF MILESTONE FLOURISHES — a handful of real additions keyed to
  // overall progress (not a fixed per-task step) so the climb reads as
  // more than just the route itself, regardless of task count.
  const CLIFF_FLOURISHES = [
    { at: 0.14, label: 'Chalking up and clipping in' },
    { at: 0.32, label: 'Resting on a ledge' },
    { at: 0.52, label: 'An eagle circles overhead' },
    { at: 0.72, label: 'Breaking through the clouds' },
    { at: 0.90, label: 'Summit in sight' },
  ];
  function drawCliffFlourish(g, index, sc) {
    switch (index) {
      case 0: { // chalk bag glint + first anchor sparkle, drawn near the base
        const p = { x: CENTER_X + 15, y: BOTTOM_Y - 10 };
        g.fillStyle(0xffffff, 0.5); g.fillCircle(p.x, p.y, 1.1);
        break;
      }
      case 1: { // a jutting resting ledge — a few shades lighter than the
        // surrounding rock bands, with a dark underside, so it reads as a
        // real outcrop rather than blending into the cliff texture.
        const y = BOTTOM_Y - (BOTTOM_Y - TOP_Y) * 0.34;
        g.fillStyle(0x3a322a, 0.4); g.fillEllipse(CENTER_X - 6, y + 2.6, 21, 3.2); // contact shadow
        g.fillStyle(0x5c4f3f, 1); g.fillEllipse(CENTER_X - 6, y + 1.6, 20, 3); // underside
        g.fillStyle(0xe0c49a, 1); g.fillEllipse(CENTER_X - 6, y, 20, 3.4); // top surface
        g.fillStyle(0xfff0d0, 0.8); g.fillEllipse(CENTER_X - 10, y - 0.6, 7, 1.6); // sunlit highlight
        g.lineStyle(0.25, 0xfff6e2, 0.7); g.beginPath(); g.moveTo(CENTER_X - 15.5, y - 1.2); g.lineTo(CENTER_X + 3.5, y - 1.2); g.strokePath(); // glossy rim
        g.fillStyle(0x4a6b3a, 0.85); g.fillEllipse(CENTER_X - 13, y - 0.9, 3.4, 1.5); // tuft of grass
        g.fillStyle(0x5c8a4c, 0.85); g.fillEllipse(CENTER_X + 2, y - 0.8, 2.6, 1.2);
        break;
      }
      case 2: { // an eagle, same gull-wing mark as the ambient birds, larger
        const p = { x: CENTER_X + 24, y: BOTTOM_Y - (BOTTOM_Y - TOP_Y) * 0.56 };
        drawBird(g, p.x, p.y, 2.2, 0.9);
        if (sc) sc._eagle = p;
        break;
      }
      case 3: { // a soft cloud bank drifting right past the climber —
        // same punchier cloud palette as the ambient sky clouds.
        const y = BOTTOM_Y - (BOTTOM_Y - TOP_Y) * 0.68;
        [[-18, 0], [-6, 1.5], [10, -1], [20, 1]].forEach(([dx, dy], i) => {
          g.fillStyle(i % 2 ? 0xffcdb0 : 0xffb894, 0.9); g.fillEllipse(CENTER_X + dx, y + dy, 13, 4.2);
          g.fillStyle(0xfff0e2, 0.55); g.fillEllipse(CENTER_X + dx - 2, y + dy - 1.4, 6, 1.8);
        });
        break;
      }
      case 4: { // a small glossy marker flag just below the summit
        const y = TOP_Y + 5;
        g.fillStyle(0x6b5d4f, 1); g.fillRect(CENTER_X + 20 - 0.15, y - 4, 0.3, 4);
        g.fillStyle(0xff9d2e, 1); g.fillTriangle(CENTER_X + 20.15, y - 4, CENTER_X + 20.15, y - 2.3, CENTER_X + 23, y - 3.15);
        g.fillStyle(0xffe2ad, 0.6); g.fillTriangle(CENTER_X + 20.15, y - 4, CENTER_X + 20.15, y - 3.3, CENTER_X + 21.6, y - 3.65);
        break;
      }
      default: break;
    }
  }

  // ── MOUNTAIN ROUTE — a switchback road, one bend per task. A road
  // (unlike a taut rope) genuinely zigzags, so this uses a much wider
  // sideways amplitude than the cliff's rope route.
  function mountainRoute(n) {
    const points = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 1;
      const y = BOTTOM_Y - t * (BOTTOM_Y - TOP_Y);
      const amp = 20 - t * 11;
      const side = i % 2 === 0 ? -1 : 1;
      points.push({ x: CENTER_X + side * amp, y });
    }
    return points;
  }

  // ── MOUNTAIN MILESTONE FLOURISHES — the driving equivalent of the
  // cliff's ledge/eagle/clouds beats.
  const MOUNTAIN_FLOURISHES = [
    { at: 0.14, label: 'Leaving the trailhead' },
    { at: 0.32, label: 'Through the pine forest' },
    { at: 0.52, label: 'A hawk circles overhead' },
    { at: 0.72, label: 'Into the clouds' },
    { at: 0.90, label: 'Snow on the road ahead' },
  ];
  function pineTree(g, x, y, s) {
    g.fillStyle(0x6b4a2e, 1); g.fillRect(x - 0.3 * s, y - 0.5 * s, 0.6 * s, 1.6 * s);
    g.fillStyle(0x2f6b3a, 1); g.fillTriangle(x - 2.6 * s, y - 0.4 * s, x, y - 6.2 * s, x + 2.6 * s, y - 0.4 * s);
    g.fillStyle(0x3f8a4a, 1); g.fillTriangle(x - 2.0 * s, y - 2.2 * s, x, y - 7.2 * s, x + 2.0 * s, y - 2.2 * s);
    g.fillStyle(0x58a85e, 0.7); g.fillTriangle(x - 1.1 * s, y - 4.6 * s, x, y - 7.2 * s, x + 0.3 * s, y - 4.6 * s);
  }
  function drawMountainFlourish(g, index, sc) {
    switch (index) {
      case 0: { // a cluster of roadside pines near the trailhead
        [[-16, 0], [-12, 1.2], [14, -0.5]].forEach(([dx, dy]) => pineTree(g, CENTER_X + dx, BOTTOM_Y - 4 + dy, 1.1));
        break;
      }
      case 1: { // a denser pine forest band beside the road
        const y = BOTTOM_Y - (BOTTOM_Y - TOP_Y) * 0.3;
        [[-22, 0], [-18, 2], [20, -1], [24, 1.5], [-26, 3]].forEach(([dx, dy]) => pineTree(g, CENTER_X + dx, y + dy, 1.3));
        break;
      }
      case 2: { // a hawk, same mark as the cliff's eagle
        const p = { x: CENTER_X - 22, y: BOTTOM_Y - (BOTTOM_Y - TOP_Y) * 0.56 };
        drawBird(g, p.x, p.y, 2.2, 0.9);
        if (sc) sc._eagle = p;
        break;
      }
      case 3: { // a cloud bank the road climbs into
        const y = BOTTOM_Y - (BOTTOM_Y - TOP_Y) * 0.68;
        [[-18, 0], [-6, 1.5], [10, -1], [20, 1]].forEach(([dx, dy], i) => {
          g.fillStyle(i % 2 ? 0xf4f8fc : 0xe3eef5, 0.9); g.fillEllipse(CENTER_X + dx, y + dy, 13, 4.2);
          g.fillStyle(0xffffff, 0.6); g.fillEllipse(CENTER_X + dx - 2, y + dy - 1.4, 6, 1.8);
        });
        break;
      }
      case 4: { // the first dusting of snow beside the road
        const y = BOTTOM_Y - (BOTTOM_Y - TOP_Y) * 0.86;
        [[-16, 0], [-10, 1.5], [18, -1], [12, 1]].forEach(([dx, dy]) => {
          g.fillStyle(0xffffff, 0.9); g.fillEllipse(CENTER_X + dx, y + dy, 5, 2);
        });
        break;
      }
      default: break;
    }
  }

  let game = null, scene = null, pendingState = null, ro = null, mountEl = null;

  let JourneySceneClass = null;
  function getJourneySceneClass() {
    if (JourneySceneClass) return JourneySceneClass;
    JourneySceneClass = class JourneyScene extends Phaser.Scene {
    constructor() { super('journey'); }

    create() {
      this.sky = this.add.graphics();
      this.bgGfx = this.add.graphics();
      this.decor = this.add.container(0, 0);
      this.flourishGfx = this.add.graphics();
      this.pathGfx = this.add.graphics();
      this.checkpointsLayer = this.add.container(0, 0);
      this.ghostLayer = this.add.container(0, 0);
      this.climberLayer = this.add.container(0, 0);
      this.fxLayer = this.add.container(0, 0);
      this.root = this.add.container(0, 0, [this.sky, this.bgGfx, this.decor, this.flourishGfx, this.pathGfx, this.checkpointsLayer, this.ghostLayer, this.climberLayer, this.fxLayer]);

      this._lastYouFrac = null;
      this._lastStageKey = null;
      this._lastDoneIds = new Set();
      this._lastSummit = false;
      this._lastFlourishFrac = -1;
      this._moving = false;

      if (!this.textures.exists('journeyDot')) {
        const dotG = this.add.graphics();
        dotG.fillStyle(0xffffff, 1); dotG.fillRect(0, 0, 4, 4);
        dotG.generateTexture('journeyDot', 4, 4);
        dotG.destroy();
      }
      if (!this.textures.exists('journeyBalloon')) {
        const balloonG = this.add.graphics();
        balloonG.fillStyle(0xffffff, 1);
        balloonG.fillEllipse(6, 7, 9, 12);
        balloonG.fillTriangle(6, 12.5, 4.3, 14.5, 7.7, 14.5);
        balloonG.generateTexture('journeyBalloon', 12, 16);
        balloonG.destroy();
      }

      // No stage is known yet — the backdrop is built on the first
      // applyState() call instead, once the real stageKey has arrived.

      this.input.on('pointerdown', (p) => {
        if (!this.root.scaleX) return;
        this.burst(p.x / this.root.scaleX, p.y / this.root.scaleY, 9);
      });

      if (pendingState) { this.applyState(pendingState); pendingState = null; }
    }

    layout(w, h) {
      if (!w || !h) return;
      this.root.setScale(w / 100, h / 100);
      // The root's non-uniform scale (the canvas is rarely square) keeps
      // the scene positioned correctly, but it stretches anything meant
      // to look round into an ellipse. Checkpoints and the climber
      // counter-scale by this ratio on their own local container (not the
      // shared layer, which would also shift their position) to stay
      // circular/proportioned regardless of the canvas's aspect ratio.
      this.roundFix = (w / 100) / (h / 100);
    }

    clearContainer(c) { c.each(child => child.destroy()); c.removeAll(); }

    // Dispatches to whichever stage's backdrop — called once up front and
    // again whenever the stage picker switches, in which case everything
    // static gets wiped and redrawn from scratch for the new stage.
    buildStaticScene(stageKey) {
      this.sky.clear();
      this.bgGfx.clear();
      this.clearContainer(this.decor);
      if (stageKey === 'mountain') this.buildMountainStatic(); else this.buildCliffStatic();
    }

    // A warm dawn gradient sky, soft pink clouds drifting below the
    // climber (the "high enough to be above the weather" read), a few
    // ambient birds, and the rock face itself — drawn once and left
    // alone; progress is expressed through the climber, the rope, and the
    // milestone flourishes, not by rebuilding the mountain. Flat, bold
    // color blocks over busy texture — a stylized illustration, not a
    // photo-real cliff.
    buildCliffStatic() {
      // A punchier, more saturated dawn gradient — the muted version read
      // as flat/washed-out; mobile-game skies lean vivid.
      this.sky.fillGradientStyle(0x2f5fb0, 0x2f5fb0, 0xff9d6e, 0xff9d6e, 1);
      this.sky.fillRect(0, 0, 100, 100);

      // A small, contained glossy sun — layered rings, but kept tight so
      // it reads as a bright disc, not a wash over a quarter of the sky.
      const sun = this.add.container(84, 14);
      [[7, 0xffe8b0, 0.3], [4.6, 0xffd98a, 0.5], [2.8, 0xfff3cf, 0.9], [1.6, 0xffffff, 1]].forEach(([r, col, a]) => sun.add(this.add.circle(0, 0, r, col, a)));
      this.decor.add(sun);
      this.tweens.add({ targets: sun.list[0], scale: 1.2, alpha: 0.18, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

      // Soft pink/peach cloud clusters, lower in the frame so the climber
      // reads as above them — each a handful of overlapping ellipses with
      // a brighter top lobe for a touch of gloss.
      const cloudAt = (cx, cy, scale, tint, hi) => {
        const g = this.add.graphics();
        g.fillStyle(tint, 0.92);
        [[-7, 0.5, 6.5, 3], [-2, -1.2, 7, 3.6], [4, 0.3, 6, 3], [9, 1, 5, 2.6]].forEach(([dx, dy, w, h]) => g.fillEllipse(dx * scale, dy * scale, w * scale, h * scale));
        g.fillStyle(hi, 0.55);
        g.fillEllipse(-1 * scale, -2.1 * scale, 5 * scale, 2 * scale);
        g.setPosition(cx, cy);
        return g;
      };
      this.decor.add(cloudAt(20, 62, 1.1, 0xffc19f, 0xffe9d8));
      this.decor.add(cloudAt(85, 70, 1.3, 0xffcdb0, 0xfff0e2));
      this.decor.add(cloudAt(14, 80, 0.9, 0xffe4d2, 0xfffaf4));
      this.decor.add(cloudAt(60, 85, 1.1, 0xffc19f, 0xffe9d8));
      this.decor.add(cloudAt(92, 40, 0.7, 0xffe4d2, 0xfffaf4));

      // A few ambient birds, purely atmospheric.
      [[30, 22, 1], [40, 30, 0.75], [15, 35, 0.85], [68, 15, 0.95]].forEach(([x, y, s]) => {
        const g = this.add.graphics();
        drawBird(g, 0, 0, s);
        g.setPosition(x, y);
        this.decor.add(g);
      });

      this.buildCliffFace();

      // Base camp — a small glossy tent + flag at the foot of the climb.
      const base = this.add.graphics();
      base.fillStyle(0x000000, 0.18); base.fillEllipse(CENTER_X - 22, BOTTOM_Y + 9, 9, 1.8); // contact shadow
      base.fillStyle(0x14b8a6, 1); base.fillTriangle(CENTER_X - 22, BOTTOM_Y + 4, CENTER_X - 26, BOTTOM_Y + 8.5, CENTER_X - 18, BOTTOM_Y + 8.5);
      base.fillStyle(0x0f766e, 1); base.fillTriangle(CENTER_X - 22, BOTTOM_Y + 4, CENTER_X - 22, BOTTOM_Y + 8.5, CENTER_X - 18, BOTTOM_Y + 8.5);
      base.fillStyle(0x5eead4, 0.6); base.fillTriangle(CENTER_X - 22, BOTTOM_Y + 4, CENTER_X - 25, BOTTOM_Y + 8.5, CENTER_X - 23, BOTTOM_Y + 8.5);
      base.fillStyle(0x374151, 1); base.fillRect(CENTER_X - 22.15, BOTTOM_Y - 1, 0.3, 5);
      base.fillStyle(0xff5a4e, 1); base.fillTriangle(CENTER_X - 21.85, BOTTOM_Y - 1, CENTER_X - 21.85, BOTTOM_Y + 0.6, CENTER_X - 19.6, BOTTOM_Y - 0.2);
      base.fillStyle(0xffb3ab, 0.5); base.fillTriangle(CENTER_X - 21.85, BOTTOM_Y - 1, CENTER_X - 21.85, BOTTOM_Y - 0.5, CENTER_X - 20.7, BOTTOM_Y - 0.65);
      this.decor.add(base);
    }

    // A warm terracotta rock face — a clean gradient block with a couple
    // of broad soft highlight sweeps, and a grassy green edge where it
    // meets the sky, rather than literal striped strata/cracks/moss. The
    // stylized-illustration look over a busy, photo-real texture pass.
    // Drawn once; never rebuilt, since the cliff itself doesn't change —
    // only what's happening on it does.
    buildCliffFace() {
      // A side-on view of the cliff — looking along the top of the
      // plateau edge-on, the way the reference image does, rather than
      // up at a peaked hillside. That top edge is close to flat (only
      // small natural variation), not a rising-and-falling ridge line,
      // because a cliff's top surface is roughly level; what makes it a
      // cliff is the near-vertical drop below it, not the shape on top.
      const silhouette = [
        { x: -5, y: 100 }, { x: -5, y: 21 }, { x: 18, y: 18.5 }, { x: 36, y: 20 },
        { x: 50, y: 16.5 }, { x: 64, y: 19 }, { x: 80, y: 17 }, { x: 94, y: 19.5 },
        { x: 105, y: 18 }, { x: 105, y: 100 },
      ];
      // A richer, more saturated terracotta — the muted version read as
      // washed-out next to a vivid sky.
      this.bgGfx.fillGradientStyle(0xc4744f, 0xc4744f, 0x6b3a28, 0x6b3a28, 1);
      this.bgGfx.fillPoints(silhouette, true);

      // A modest, soft glow suggesting the sun catches this corner of the
      // rock — small and low-alpha so it reads as light, not a wash.
      this.bgGfx.fillStyle(0xffcf9a, 0.14);
      this.bgGfx.fillCircle(90, 22, 20);

      // Real rock texture: a field of small soft blotches in varying
      // warm tones (sunlit bumps, shadowed pockets) instead of a couple
      // of large flat-shaded panels — this is what actually reads as
      // "rock" rather than "a few big triangles of slightly different
      // brown". Seeded so the texture is stable for this scene instance.
      let seed = 1337;
      const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
      const tones = [[0xe8a870, 0.34], [0xdd8f5c, 0.34], [0x8a4e3a, 0.3], [0x6f3c2b, 0.28], [0xc47f51, 0.24], [0xffe2b8, 0.18]];
      for (let i = 0; i < 90; i++) {
        const x = -3 + rand() * 106;
        const y = 23 + rand() * 76;
        const r = 1.6 + rand() * 4.4;
        const [color, alpha] = tones[Math.floor(rand() * tones.length)];
        this.bgGfx.fillStyle(color, alpha * (0.6 + rand() * 0.5));
        this.bgGfx.fillCircle(x, y, r);
      }
      // A handful of thin crack lines for grit, low-opacity so they read
      // as detail rather than damage.
      this.bgGfx.lineStyle(0.22, 0x3a2a20, 0.3);
      [[22, 40, 28, 62], [66, 34, 60, 58], [38, 68, 44, 92], [84, 44, 90, 76]].forEach(([x1, y1, x2, y2]) => {
        this.bgGfx.beginPath(); this.bgGfx.moveTo(x1, y1);
        this.bgGfx.lineTo((x1 + x2) / 2 + 1.5, (y1 + y2) / 2); this.bgGfx.lineTo(x2, y2); this.bgGfx.strokePath();
      });

      // A bright rim-light along the sun-facing (right) side of the
      // cliff's silhouette — the single highest-impact "polished mobile
      // game" trick: a saturated light edge where a form turns away from
      // the light, instead of flat, evenly-lit color everywhere.
      this.bgGfx.lineStyle(0.9, 0xffe1b0, 0.55);
      this.bgGfx.beginPath();
      this.bgGfx.moveTo(64, 19); this.bgGfx.lineTo(80, 17); this.bgGfx.lineTo(94, 19.5); this.bgGfx.lineTo(105, 18);
      this.bgGfx.strokePath();

      // A grassy plateau top with real depth — a flat-ish top surface
      // plus the short front lip where it meets the rock — rather than
      // just a painted line along the silhouette, so looking at it from
      // the side actually reads as a ledge, not a hairline border.
      const ridge = silhouette.slice(1, -1);
      const GRASS_THICK = 2.1;
      const top = ridge.map(p => ({ x: p.x, y: p.y - GRASS_THICK }));
      this.bgGfx.fillStyle(0x4a7a2d, 1);
      this.bgGfx.fillPoints([...top, ...ridge.slice().reverse()], true);
      this.bgGfx.fillStyle(0x7fd14a, 0.95);
      this.bgGfx.fillPoints([...top, ...top.map(p => ({ x: p.x, y: p.y + 0.9 })).reverse()], true);
      // A thin glossy highlight along the very top edge of the grass.
      this.bgGfx.lineStyle(0.3, 0xc8f08a, 0.7);
      this.bgGfx.beginPath();
      top.forEach((p, i) => { if (i === 0) this.bgGfx.moveTo(p.x, p.y); else this.bgGfx.lineTo(p.x, p.y); });
      this.bgGfx.strokePath();
      this.bgGfx.lineStyle(0.35, 0x3f6b2a, 0.8);
      this.bgGfx.beginPath();
      ridge.forEach((p, i) => { if (i === 0) this.bgGfx.moveTo(p.x, p.y); else this.bgGfx.lineTo(p.x, p.y); });
      this.bgGfx.strokePath();
    }

    // "Mountain Drive" — a clear-day sky (a different mood from the
    // cliff's dawn, so the two stages don't just look like recolors of
    // each other) over a snow-capped peak the road switches back up.
    buildMountainStatic() {
      this.sky.fillGradientStyle(0x2a6fb0, 0x2a6fb0, 0xcfeaf7, 0xcfeaf7, 1);
      this.sky.fillRect(0, 0, 100, 100);

      const sun = this.add.container(18, 13);
      [[7, 0xffffff, 0.25], [4.6, 0xfff9e0, 0.5], [2.8, 0xffffff, 0.9], [1.6, 0xffffff, 1]].forEach(([r, col, a]) => sun.add(this.add.circle(0, 0, r, col, a)));
      this.decor.add(sun);
      this.tweens.add({ targets: sun.list[0], scale: 1.2, alpha: 0.15, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

      const cloudAt = (cx, cy, scale, tint, hi) => {
        const g = this.add.graphics();
        g.fillStyle(tint, 0.92);
        [[-7, 0.5, 6.5, 3], [-2, -1.2, 7, 3.6], [4, 0.3, 6, 3], [9, 1, 5, 2.6]].forEach(([dx, dy, w, h]) => g.fillEllipse(dx * scale, dy * scale, w * scale, h * scale));
        g.fillStyle(hi, 0.6); g.fillEllipse(-1 * scale, -2.1 * scale, 5 * scale, 2 * scale);
        g.setPosition(cx, cy);
        return g;
      };
      this.decor.add(cloudAt(80, 20, 1.1, 0xffffff, 0xffffff));
      this.decor.add(cloudAt(60, 60, 0.9, 0xe9f3f8, 0xffffff));
      this.decor.add(cloudAt(90, 72, 1.2, 0xe9f3f8, 0xffffff));
      this.decor.add(cloudAt(10, 45, 0.7, 0xf2f8fb, 0xffffff));

      [[30, 22, 1], [40, 30, 0.75], [68, 15, 0.95]].forEach(([x, y, s]) => {
        const g = this.add.graphics();
        drawBird(g, 0, 0, s);
        g.setPosition(x, y);
        this.decor.add(g);
      });

      this.buildMountainFace();

      // A trailhead sign at the foot of the road.
      const base = this.add.graphics();
      base.fillStyle(0x000000, 0.18); base.fillEllipse(CENTER_X - 22, BOTTOM_Y + 9, 7, 1.6);
      base.fillStyle(0x6b4a2e, 1); base.fillRect(CENTER_X - 22.15, BOTTOM_Y - 1, 0.3, 9);
      base.fillStyle(0xd1d5db, 1); base.fillRoundedRect(CENTER_X - 25.5, BOTTOM_Y - 1.5, 7, 3.4, 0.5);
      base.fillStyle(0xffffff, 0.4); base.fillRoundedRect(CENTER_X - 25.5, BOTTOM_Y - 1.5, 3, 3.4, 0.5);
      this.decor.add(base);
    }

    // A snow-capped peak — a gradient from forest green at the base
    // through bare rock to white snow at the summit, built from one
    // gradient fill (always stays inside the silhouette, unlike separate
    // inset polygons) plus a rocky texture band and a brighter snow cap
    // cluster so the transition actually reads as three zones.
    buildMountainFace() {
      const silhouette = [
        { x: -5, y: 100 }, { x: -5, y: 86 }, { x: 18, y: 48 }, { x: 34, y: 62 },
        { x: 50, y: 10 }, { x: 64, y: 56 }, { x: 80, y: 42 }, { x: 105, y: 84 }, { x: 105, y: 100 },
      ];
      this.bgGfx.fillGradientStyle(0xf4f8fc, 0xf4f8fc, 0x3f6b35, 0x3f6b35, 1);
      this.bgGfx.fillPoints(silhouette, true);

      // A rocky gray texture band across the middle third, the same
      // "scattered soft blotches" trick as the cliff's rock texture.
      let seed = 777;
      const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
      const tones = [[0x8a8f94, 0.3], [0x6f757b, 0.3], [0xa3a8ad, 0.22], [0x5c6066, 0.26]];
      for (let i = 0; i < 55; i++) {
        const x = 10 + rand() * 80;
        const y = 32 + rand() * 32;
        const r = 1.6 + rand() * 3.6;
        const [color, alpha] = tones[Math.floor(rand() * tones.length)];
        this.bgGfx.fillStyle(color, alpha * (0.6 + rand() * 0.5));
        this.bgGfx.fillCircle(x, y, r);
      }

      // A brighter snow-cap cluster right at the peak, so the gradient's
      // natural white-at-top isn't the only thing selling "snow".
      [[50, 16, 9], [43, 24, 6], [57, 23, 6.5], [50, 30, 5]].forEach(([x, y, r]) => {
        this.bgGfx.fillStyle(0xffffff, 0.85); this.bgGfx.fillCircle(x, y, r);
      });
      this.bgGfx.fillStyle(0xdbe9f2, 0.5); this.bgGfx.fillCircle(46, 20, 4);

      // Rim-light along the sun-facing (left, where this stage's sun
      // sits) slope.
      this.bgGfx.lineStyle(0.9, 0xffffff, 0.5);
      this.bgGfx.beginPath();
      this.bgGfx.moveTo(18, 48); this.bgGfx.lineTo(34, 62); this.bgGfx.lineTo(50, 10);
      this.bgGfx.strokePath();

      // Green foothill texture near the base.
      [[15, 80], [30, 88], [70, 86], [88, 82]].forEach(([x, y]) => {
        this.bgGfx.fillStyle(0x2f6b3a, 0.5); this.bgGfx.fillEllipse(x, y, 8, 3.4);
        this.bgGfx.fillStyle(0x3f8a4a, 0.5); this.bgGfx.fillEllipse(x + 1.5, y + 1, 5, 2.2);
      });
    }

    // One real rope, fixed at a summit anchor and run straight down past
    // every clip point to the base — not a trail that changes color as
    // you go, since it's a single physical rope that's already fully
    // rigged top to bottom. A twisted-fiber look (a dark base strand plus
    // a thinner warm highlight strand) instead of a flat line.
    drawRope(points) {
      this.pathGfx.clear();
      const all = [{ x: CENTER_X, y: BOTTOM_Y + 6 }, ...points, { x: CENTER_X, y: TOP_Y - 5 }];
      const stroke = (w, col, a, dx) => {
        this.pathGfx.lineStyle(w, col, a);
        this.pathGfx.beginPath(); this.pathGfx.moveTo(all[0].x + (dx || 0), all[0].y);
        all.slice(1).forEach(p => this.pathGfx.lineTo(p.x + (dx || 0), p.y));
        this.pathGfx.strokePath();
      };
      // A dark halo stroke first — makes the rope read clearly against
      // *any* patch of the rock texture behind it, not just the ones it
      // happens to contrast with. Then a light manila-rope tan (not a
      // dark brown that blends straight into the cliff) with a shadow
      // stripe and a bright highlight stripe either side for a round,
      // twisted-fiber look instead of a flat ribbon.
      stroke(1.8, 0x241a12, 0.45);
      stroke(1.15, 0xe4d2a0, 1);
      stroke(0.4, 0xb08f58, 0.85, 0.3);
      stroke(0.22, 0xfff6e0, 0.95, -0.28);

      // A summit anchor — the piton the rope is actually fixed to.
      const anchor = all[all.length - 1];
      this.pathGfx.fillStyle(0x4b5563, 1); this.pathGfx.fillRoundedRect(anchor.x - 0.5, anchor.y - 1.6, 1, 2.2, 0.3);
      this.pathGfx.lineStyle(0.3, 0x374151, 1); this.pathGfx.strokeCircle(anchor.x, anchor.y - 1.6, 1.1);
    }

    // A switchback asphalt road — thick enough to be an actual ribbon
    // (not a thin line), with a dashed centerline and guardrail posts on
    // the outer edge of each bend, finishing at a summit gate.
    drawRoad(points) {
      this.pathGfx.clear();
      const all = [{ x: CENTER_X, y: BOTTOM_Y + 6 }, ...points, { x: CENTER_X, y: TOP_Y - 4 }];
      const path = (fn) => {
        fn.beginPath(); fn.moveTo(all[0].x, all[0].y);
        all.slice(1).forEach(p => fn.lineTo(p.x, p.y));
        fn.strokePath();
      };
      this.pathGfx.lineStyle(4.6, 0x000000, 0.22); path(this.pathGfx); // contact shadow, offset-free (good enough at this scale)
      this.pathGfx.lineStyle(4, 0x4b5259, 1); path(this.pathGfx); // asphalt
      this.pathGfx.lineStyle(2.4, 0x5c646b, 0.6); path(this.pathGfx); // center sheen

      // A dashed yellow centerline, built per-segment so the dashes stay
      // evenly spaced along each bend rather than one continuous stroke.
      for (let i = 0; i < all.length - 1; i++) {
        const a = all[i], b = all[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const dashes = Math.max(2, Math.round(len / 2.6));
        for (let d = 0; d < dashes; d += 2) {
          const t0 = d / dashes, t1 = Math.min(1, (d + 1) / dashes);
          this.pathGfx.lineStyle(0.35, 0xffd93d, 0.95);
          this.pathGfx.beginPath();
          this.pathGfx.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
          this.pathGfx.lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
          this.pathGfx.strokePath();
        }
      }

      // Guardrail posts along the outer edge of each bend.
      points.forEach((p) => {
        const side = p.x > CENTER_X ? 1 : -1;
        this.pathGfx.fillStyle(0xe5e7eb, 0.95); this.pathGfx.fillRoundedRect(p.x + side * 2.3 - 0.25, p.y - 1, 0.5, 2, 0.2);
      });

      // A summit gate — the arrival marker the road's own checkpoint
      // circle sits in front of.
      const summit = all[all.length - 1];
      this.pathGfx.fillStyle(0x4b5563, 1);
      this.pathGfx.fillRect(summit.x - 3.2, summit.y - 4.2, 0.35, 4.2);
      this.pathGfx.fillRect(summit.x + 2.9, summit.y - 4.2, 0.35, 4.2);
      this.pathGfx.fillStyle(0xffffff, 1); this.pathGfx.fillRoundedRect(summit.x - 3.4, summit.y - 5, 6.8, 1.3, 0.3);
      this.pathGfx.fillStyle(0xef4444, 0.9); this.pathGfx.fillRect(summit.x - 3.4, summit.y - 5, 1.3, 1.3);
      this.pathGfx.fillRect(summit.x + 1.3, summit.y - 5, 1.3, 1.3);
    }

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
        const shadow = this.add.circle(0.3, 0.5, r, 0x000000, 0.25);
        const parts = [shadow];
        // A soft colored glow behind the live markers — done/next — the
        // glossy "game node" halo, not just a flat disc.
        if (isDone || isNext) {
          const glow = this.add.circle(0, 0, r * 1.8, color, 0.3);
          parts.push(glow);
          if (isNext) this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.12, duration: 750, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
        // A piton/anchor look: a bright metal ring behind a solid disc,
        // rather than a plain dot — plus a strong specular highlight for
        // a glossy, lit-from-above read.
        const ring = this.add.circle(0, 0, r * 1.22, 0x9aa3ad, 0.95);
        const base = this.add.circle(0, 0, r, color);
        const hi = this.add.circle(-r * 0.32, -r * 0.35, r * 0.46, 0xffffff, 0.75);
        const hi2 = this.add.circle(r * 0.28, r * 0.15, r * 0.14, 0xffffff, 0.4);
        parts.push(ring, base, hi, hi2);
        c.add(parts);
        if (showLabel) {
          const labelColor = isDone ? '#ffffff' : isNext ? '#3a2a00' : '#4B5563';
          c.add(addCrispLabel(this, 0, 0, isDone ? '✓' : String(i + 1), labelColor, Math.max(2.8, r * 1.5)));
        }
        if (t.latestUpdateIsBlocker && baseR >= 1.7) {
          c.add(addCrispLabel(this, r * 0.85, -r * 0.85, '🚧', '#000000', Math.max(3, r * 1.4), 'normal'));
        }
        c.setScale(1, this.roundFix || 1);
        this.checkpointsLayer.add(c);
      });
    }

    buildFlourishesAt(stageKey, frac) {
      this.flourishGfx.clear();
      const list = stageKey === 'mountain' ? MOUNTAIN_FLOURISHES : CLIFF_FLOURISHES;
      const drawFn = stageKey === 'mountain' ? drawMountainFlourish : drawCliffFlourish;
      list.forEach((f, i) => { if (frac > f.at) drawFn(this.flourishGfx, i, this); });
      // The circling bird (eagle/hawk) gets a gentle drift once it exists.
      if (this._eagle && frac > list[2].at) {
        if (!this._eagleTween) {
          this._eagleAngle = 0;
          this._eagleTween = this.tweens.addCounter({ from: 0, to: Math.PI * 2, duration: 6000, repeat: -1, onUpdate: (tw) => {
            this._eagleAngle = tw.getValue();
            this.flourishGfx.clear();
            list.forEach((f2, i2) => { if (frac > f2.at && i2 !== 2) drawFn(this.flourishGfx, i2, this); });
            const ex = this._eagle.x + Math.cos(this._eagleAngle) * 6, ey = this._eagle.y + Math.sin(this._eagleAngle) * 2.2;
            drawBird(this.flourishGfx, ex, ey, 2.2, 0.85);
          } });
        }
      }
    }

    applyState(state) {
      const stageKey = state.stageKey === 'mountain' ? 'mountain' : 'cliff';
      const stageChanged = this._lastStageKey !== null && this._lastStageKey !== stageKey;
      const firstSync = this._lastStageKey === null;
      // A brand-new scene, or the stage picker just switched: rebuild the
      // whole backdrop and swap the avatar for this stage's own rig
      // (a climber and a car share nothing structurally). Position snaps
      // instead of animating in either case — a stage switch shouldn't
      // play a climb/drive move from wherever the old scene left off.
      if (firstSync || stageChanged) {
        this.buildStaticScene(stageKey);
        if (this.climberLayer.list[0]) this.climberLayer.list[0].destroy();
        const avatar = stageKey === 'mountain' ? buildVehicle(this, true) : buildClimber(this, true);
        avatar.setScale(1, this.roundFix || 1);
        this.climberLayer.add(avatar);
        if (this._eagleTween) { this._eagleTween.remove(); this._eagleTween = null; }
        this._eagle = null;
        this._lastFlourishFrac = -1;
      }
      this._lastStageKey = stageKey;

      this.buildFlourishesAt(stageKey, state.youFrac);
      this._lastFlourishFrac = state.youFrac;

      const points = stageKey === 'mountain' ? mountainRoute(state.tasks.length) : climbRoute(state.tasks.length);
      const doneCount = state.tasks.filter(t => t.status === 'Completed').length;
      if (stageKey === 'mountain') this.drawRoad(points); else this.drawRope(points);
      this.buildCheckpoints(points, state.tasks, doneCount);

      // Celebrate any checkpoint that's newly done since the last sync —
      // unless Celebration Effects is turned off (Settings), in which case
      // progress still tracks correctly, it just doesn't throw confetti.
      const celebrate = state.celebrationsEnabled !== false;
      const nowDoneIds = new Set(state.tasks.filter(t => t.status === 'Completed').map(t => t.id));
      state.tasks.forEach((t, i) => {
        if (t.status === 'Completed' && !this._lastDoneIds.has(t.id) && celebrate) {
          // No tint override — falls back to burst()'s own vibrant
          // multi-color palette. A single pale tan tint here used to make
          // this almost invisible against the scene; a real confetti
          // burst needs real contrast, not a near-background color.
          this.burst(points[i].x, points[i].y, 24);
        }
      });
      this._lastDoneIds = nowDoneIds;

      // Ghost (pace/competitor marker) — a faded second avatar elsewhere
      // on the route, built with whichever rig matches the active stage.
      const offset = stageKey === 'mountain' ? -1.5 : -2.2;
      this.clearContainer(this.ghostLayer);
      if (state.ghost) {
        const gp = positionAt(points, state.ghost.frac);
        const ghostAvatar = stageKey === 'mountain' ? buildVehicle(this, false) : buildClimber(this, false);
        const g = this.add.container(gp.x, gp.y + offset, [ghostAvatar]);
        g.setScale(1, this.roundFix || 1);
        g.setAlpha(0.4);
        const badge = this.add.container(3, -16, [
          this.add.circle(0, 0, 1.6, 0x0d1b2a),
          addCrispLabel(this, 0, 0, state.ghost.isComputer ? '🖥' : state.ghost.label.charAt(0).toUpperCase(), '#ffffff', 2.4, 'normal'),
        ]);
        g.add(badge);
        this.ghostLayer.add(g);
      }

      // Avatar — plays a real climb/drive action to the new spot rather
      // than just sliding, unless this is a fresh placement (first sync
      // or a stage just switched).
      const you = positionAt(points, state.youFrac);
      const avatar = this.climberLayer.list[0];
      if (avatar) {
        if (firstSync || stageChanged) {
          avatar.setPosition(you.x, you.y + offset);
        } else if (this._lastYouFrac !== state.youFrac) {
          const moveFn = stageKey === 'mountain' ? driveMove : climbMove;
          moveFn(this, avatar, you.x, you.y + offset);
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

    burst(xFrac, yFrac, count, tint) {
      const colors = [0x0A7E8C, 0xF59E0B, 0xEF4444, 0x22C55E, 0x3B82F6, 0xEC4899];
      const emitter = this.add.particles(xFrac, yFrac, 'journeyDot', {
        speed: { min: 20, max: 70 },
        angle: { min: 230, max: 310 },
        gravityY: 140,
        scale: { start: 1.6, end: 0.4 },
        lifespan: 700,
        quantity: count,
        tint: tint || colors,
        emitting: false,
      });
      this.fxLayer.add(emitter);
      emitter.explode(count);
      this.time.delayedCall(900, () => emitter.destroy());
    }

    // Balloons rising from the base of the scene — the whole-project
    // moment only, never a per-checkpoint one. Opposite physics from
    // confetti (gentle upward drift, slight sway, no gravity).
    burstBalloons(count) {
      const colors = [0xEF4444, 0xF59E0B, 0x22C55E, 0x3B82F6, 0xEC4899, 0xA855F7, 0x0A7E8C];
      const emitter = this.add.particles(50, 95, 'journeyBalloon', {
        x: { min: 15, max: 85 },
        speedY: { min: -26, max: -16 },
        speedX: { min: -4, max: 4 },
        lifespan: 2600,
        scale: { start: 1, end: 0.85 },
        alpha: { start: 1, end: 0 },
        quantity: count,
        tint: colors,
        emitting: false,
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
    // state: { tasks, youFrac, ghost, summitLit, celebrationsEnabled }
    // Returns the current milestone's label (for the status line) once
    // ready — callers don't need to duplicate the FLOURISHES thresholds.
    buildPhaseLabel(frac, stageKey) {
      if (frac >= 1) return 'Summit reached';
      const mountain = stageKey === 'mountain';
      let label = mountain ? 'Starting the drive' : 'Starting the climb';
      (mountain ? MOUNTAIN_FLOURISHES : CLIFF_FLOURISHES).forEach(f => { if (frac > f.at) label = f.label; });
      return label;
    },
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
