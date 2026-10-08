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
//
// Deliberately minimal backdrops: an earlier version layered rock/snow
// texture, crack lines, a rim-light sweep, several cloud clusters,
// ambient birds, and per-milestone drawings (ledges, eagles, pine
// clusters) on top of each other — individually each seemed reasonable,
// together it read as cluttered. The backdrop here is a flat gradient
// plus the path and checkpoints; progress is told through the avatar's
// motion and the status line's text, not through more things drawn on
// screen. Resist adding another decorative layer without removing one.
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
  // TOP_Y leaves real headroom above the final checkpoint — the avatar's
  // own head/roof and the summit anchor/gate decorations all extend
  // further up than their checkpoint's own y, and at 16 that extension
  // routinely pushed them above y=0 and off the top of the canvas
  // entirely (confirmed from a user screenshot: the car and the summit
  // gate were both visibly cropped at full completion).
  const TOP_Y = 27, BOTTOM_Y = 90, CENTER_X = 50;

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
  // Drawn in profile, facing right — a silhouette with depth (back limbs
  // drawn behind the torso, front limbs in front of it) rather than a
  // front-facing figure with mirrored arms/legs. A side view reads the
  // climbing motion far better: the reach-and-pull is something you see
  // happen in front of the body, not a symmetric pose facing the camera.
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

    const legGeom = (toeFwd) => {
      const g = sc.add.graphics();
      g.fillStyle(C.pantsDark, 1); g.fillRoundedRect(-1.4, 0, 2.8, 7.6, 1.2);
      g.fillStyle(C.pants, 1); g.fillRoundedRect(-1.4, 0, 2.8, 5, 1.2);
      g.fillStyle(C.shoe, 1); g.fillRoundedRect(toeFwd ? -0.6 : -1.9, 6.4, 3.4, 2, 1);
      outline(g); g.strokeRoundedRect(-1.4, 0, 2.8, 7.6, 1.2);
      return g;
    };
    // Cling pose, side-on: the front (right, facing-direction) leg driven
    // up onto a foothold, the back (left) leg trailing down and behind.
    const backLeg = sc.add.container(-1.0, -6.0, [legGeom(false)]);
    backLeg.setAngle(-16);
    const frontLeg = sc.add.container(2.2, -7.2, [legGeom(true)]);
    frontLeg.setAngle(-46);

    // Long enough that, rotated ~165° from its hanging-down rest
    // direction, the hand clears well above the head to grip the rope
    // instead of crossing in front of the face.
    const armGeom = () => {
      const g = sc.add.graphics();
      g.fillStyle(C.jacketDark, 1); g.fillRoundedRect(-1.3, 0, 2.6, 8.6, 1.3);
      g.fillStyle(C.jacket, 1); g.fillRoundedRect(-1.3, 0, 2.6, 4.6, 1.3);
      g.fillStyle(C.skin, 1); g.fillCircle(0, 8.6, 1.55); // gripping hand
      outline(g); g.strokeRoundedRect(-1.3, 0, 2.6, 8.6, 1.3);
      return g;
    };
    // Both hands grip the rope itself, nearly overhead — a rope ascent,
    // not a reach for scattered rock holds — the front arm higher than
    // the back, hand-over-hand.
    const backArm = sc.add.container(-1.8, -15.6, [armGeom()]);
    backArm.setAngle(-160);
    const frontArm = sc.add.container(2.4, -16.4, [armGeom()]);
    frontArm.setAngle(170);

    // A soft shadow the climber casts onto the rock behind them — reads
    // as "a few inches off the wall", not pasted flat onto it.
    const wallShadow = sc.add.ellipse(1.2, -11, 8, 13, 0x000000, 0.2);

    // Torso — narrower and centered a touch forward than the old
    // front-facing build, since in profile we only see its depth, not
    // its full width.
    const body = sc.add.graphics();
    body.fillStyle(C.jacketDark, 1); body.fillRoundedRect(-4.2, -15.8, 8.6, 9.4, 3.0);
    body.fillStyle(C.jacket, 1); body.fillRoundedRect(-4.2, -15.8, 8.6, 5.6, 3.0);
    body.fillStyle(C.jacketLight, 0.5); body.fillRoundedRect(-4.2, -15.8, 3.4, 5.6, 3.0);
    outline(body); body.strokeRoundedRect(-4.2, -15.8, 8.6, 9.4, 3.0);
    // Rim-light — a bright stroke down the sun-facing (front) edge,
    // matching the cliff's own rim-light so the whole scene reads as one
    // light source.
    body.lineStyle(0.45, 0xffe6c0, 0.75);
    body.beginPath(); body.moveTo(4.1, -15); body.lineTo(4.1, -6.6); body.strokePath();
    // Harness belt + a hanging loop the rope "clips" into — the one
    // detail that most says "climbing gear" at a glance.
    const harness = sc.add.graphics();
    harness.fillStyle(C.harness, 1); harness.fillRoundedRect(-4.3, -8.0, 8.6, 1.6, 0.6);
    harness.fillStyle(0xd1d5db, 1); harness.fillCircle(0.6, -5.6, 0.9);
    harness.lineStyle(0.3, 0x9ca3af, 1); harness.lineBetween(0.6, -7.0, 0.6, -6.4);

    // Head, in profile: one eye, a nose bump on the facing (right) side,
    // hair mass on the trailing (left/back) side.
    const headG = sc.add.graphics();
    headG.fillStyle(C.skin, 1); headG.fillCircle(0.6, -18, 4.0);
    headG.fillStyle(C.skinLight, 1); headG.fillCircle(1.6, -18.8, 2.6);
    headG.fillStyle(C.skin, 1); headG.fillRoundedRect(4.0, -17.4, 1.4, 1.4, 0.6); // nose bump
    outline(headG); headG.strokeCircle(0.6, -18, 4.0);
    headG.fillStyle(C.hair, 1);
    headG.beginPath(); headG.arc(0.3, -19.4, 4.1, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(10), true); headG.closePath(); headG.fillPath();
    // Helmet — the climbing-specific silhouette swap that makes this read
    // as "on a cliff", not just "a person standing somewhere".
    headG.fillStyle(C.helmetDark, 1);
    headG.beginPath(); headG.arc(0.6, -19.1, 4.3, Phaser.Math.DegToRad(195), Phaser.Math.DegToRad(5)); headG.closePath(); headG.fillPath();
    headG.fillStyle(C.helmet, 1);
    headG.beginPath(); headG.arc(0.8, -19.4, 4.0, Phaser.Math.DegToRad(193), Phaser.Math.DegToRad(3)); headG.closePath(); headG.fillPath();
    headG.fillStyle(0xffffff, 0.45); headG.fillEllipse(2.0, -22.0, 2.2, 0.9);
    headG.lineStyle(0.3, C.helmetDark, 0.6); headG.strokeEllipse(0.8, -19.4, 8.0, 3.8);
    headG.lineStyle(0.35, 0xfff3d6, 0.7); headG.beginPath(); headG.arc(0.8, -19.4, 4.0, Phaser.Math.DegToRad(-5), Phaser.Math.DegToRad(35)); headG.strokePath();

    const eye = sc.add.ellipse(2.3, -18.2, 1.1, 1.3, 0x2b2320);
    const eyeShine = sc.add.ellipse(2.0, -18.6, 0.4, 0.4, 0xffffff, 0.9);
    const blush = sc.add.ellipse(1.3, -16.9, 1.3, 1.1, 0xfca5a5, 0.5);
    const smile = sc.add.graphics();
    smile.lineStyle(0.45, 0xb5703f, 1); smile.beginPath(); smile.arc(1.4, -16.9, 1.1, Phaser.Math.DegToRad(10), Phaser.Math.DegToRad(110)); smile.strokePath();

    art.add([wallShadow, backLeg, backArm, body, frontLeg, harness, headG, eye, eyeShine, blush, smile, frontArm]);

    const parts = { art, backLeg, frontLeg, backArm, frontArm, body };

    if (animated) {
      // A climber clinging to a rock face is never perfectly still —
      // small continuous grip adjustments, independently timed per limb
      // so it doesn't read as a mechanical loop.
      const idle = { ease: 'Sine.easeInOut', yoyo: true, repeat: -1 };
      sc.tweens.add({ targets: backArm, angle: { from: -160, to: -153 }, duration: 900, ...idle });
      sc.tweens.add({ targets: frontArm, angle: { from: 170, to: 163 }, duration: 760, delay: 180, ...idle });
      sc.tweens.add({ targets: backLeg, angle: { from: -16, to: -9 }, duration: 1100, delay: 320, ...idle });
      sc.tweens.add({ targets: frontLeg, angle: { from: -46, to: -40 }, duration: 980, delay: 90, ...idle });
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
    sc.tweens.killTweensOf([p.backArm, p.frontArm, p.backLeg, p.frontLeg, p.art, climber]);
    const fromX = climber.x, fromY = climber.y;
    const liftX = fromX + (toX - fromX) * 0.35, liftY = fromY - 4;
    const tl = [];
    // Beat 1 — reach: the front hand slides further up the rope, front leg
    // drives up against the rock for the push.
    tl.push(() => {
      sc.tweens.add({ targets: p.frontArm, angle: 183, duration: 260, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p.frontLeg, angle: -66, duration: 260, ease: 'Sine.easeOut' });
      sc.time.delayedCall(260, run.bind(null, 1));
    });
    // Beat 2 — pull: hand-over-hand up the rope while the body rises —
    // the back hand releases and trails as the body passes it — with a
    // small chalk-puff at the new grip.
    tl.push(() => {
      sc.tweens.add({ targets: climber, x: liftX, y: liftY, duration: 210, ease: 'Sine.easeIn' });
      sc.tweens.add({
        targets: climber, x: toX, y: toY, duration: 300, delay: 210, ease: 'Sine.easeOut',
        onComplete: () => { chalkPuff(sc, climber.x, climber.y - 11); },
      });
      sc.tweens.add({ targets: p.backArm, angle: -100, duration: 480, ease: 'Sine.easeInOut' });
      sc.tweens.add({ targets: p.backLeg, angle: -36, duration: 480, ease: 'Sine.easeInOut' });
      sc.time.delayedCall(510, run.bind(null, 2));
    });
    // Beat 3 — settle: limbs ease back to the resting rope-grip pose and
    // the idle sway resumes.
    tl.push(() => {
      sc.tweens.add({ targets: p.backArm, angle: -160, duration: 260, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p.frontArm, angle: 170, duration: 260, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p.backLeg, angle: -16, duration: 260, ease: 'Sine.easeOut' });
      sc.tweens.add({ targets: p.frontLeg, angle: -46, duration: 260, ease: 'Sine.easeOut',
        onComplete: () => { startIdleSway(sc, p); if (onComplete) onComplete(); } });
    });
    function run(i) { tl[i](); }
    run(0);
  }
  function startIdleSway(sc, p) {
    const idle = { ease: 'Sine.easeInOut', yoyo: true, repeat: -1 };
    sc.tweens.add({ targets: p.backArm, angle: { from: -160, to: -153 }, duration: 900, ...idle });
    sc.tweens.add({ targets: p.frontArm, angle: { from: 170, to: 163 }, duration: 760, delay: 180, ...idle });
    sc.tweens.add({ targets: p.backLeg, angle: { from: -16, to: -9 }, duration: 1100, delay: 320, ...idle });
    sc.tweens.add({ targets: p.frontLeg, angle: { from: -46, to: -40 }, duration: 980, delay: 90, ...idle });
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
  // Capped well below what a low task count's spacing would technically
  // allow — at 4.2 a 3-5 task project's markers dwarfed the avatar
  // (checkpoint diameter nearly double its shoulder width), which read as
  // a scene with badly mismatched proportions rather than just "big
  // circles". 3.0 keeps markers comfortably larger than a blocker badge
  // needs to be, without ever outgrowing the character standing next to
  // them.
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

  // ── CLIFF MILESTONE LABELS — status-line text only, no scene drawing.
  // An earlier version rendered a ledge/eagle/cloud-bank/flag for each of
  // these, layered on an already-detailed rock face; the combination was
  // the single biggest source of visual clutter in the whole scene. The
  // narrative progression is worth keeping as *text* (it costs nothing to
  // look at), the drawings weren't.
  const CLIFF_FLOURISHES = [
    { at: 0.14, label: 'Chalking up and clipping in' },
    { at: 0.32, label: 'Resting on a ledge' },
    { at: 0.52, label: 'An eagle circles overhead' },
    { at: 0.72, label: 'Breaking through the clouds' },
    { at: 0.90, label: 'Summit in sight' },
  ];

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

  // ── MOUNTAIN MILESTONE LABELS — same change as the cliff's: text only.
  const MOUNTAIN_FLOURISHES = [
    { at: 0.14, label: 'Leaving the trailhead' },
    { at: 0.32, label: 'Through the pine forest' },
    { at: 0.52, label: 'A hawk circles overhead' },
    { at: 0.72, label: 'Into the clouds' },
    { at: 0.90, label: 'Snow on the road ahead' },
  ];

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
      this.pathGfx = this.add.graphics();
      this.checkpointsLayer = this.add.container(0, 0);
      this.ghostLayer = this.add.container(0, 0);
      this.climberLayer = this.add.container(0, 0);
      this.fxLayer = this.add.container(0, 0);
      this.root = this.add.container(0, 0, [this.sky, this.bgGfx, this.decor, this.pathGfx, this.checkpointsLayer, this.ghostLayer, this.climberLayer, this.fxLayer]);

      this._lastYouFrac = null;
      this._lastStageKey = null;
      this._lastDoneIds = new Set();
      this._lastSummit = false;
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

    // A plain sky, one simple sun, the rock face, and nothing else —
    // deliberately minimal. An earlier version layered rock texture,
    // crack lines, a rim-light sweep, five cloud clusters, and ambient
    // birds on top of each other here; the combination was the clutter,
    // not any one piece of it. Progress is expressed through the
    // climber, the rope, and the checkpoints — the backdrop's job is
    // just to not fight with any of that for attention.
    buildCliffStatic() {
      this.sky.fillGradientStyle(0x4a7fc4, 0x4a7fc4, 0xf4c99a, 0xf4c99a, 1);
      this.sky.fillRect(0, 0, 100, 100);

      const sun = this.add.circle(84, 14, 4, 0xfff3cf, 1);
      this.decor.add(sun);

      this.buildCliffFace();

      // Base camp — a simple flat flag at the foot of the climb.
      const base = this.add.graphics();
      base.fillStyle(0x374151, 1); base.fillRect(CENTER_X - 22.15, BOTTOM_Y - 1, 0.3, 5);
      base.fillStyle(0xef4444, 1); base.fillTriangle(CENTER_X - 21.85, BOTTOM_Y - 1, CENTER_X - 21.85, BOTTOM_Y + 0.6, CENTER_X - 19.6, BOTTOM_Y - 0.2);
      this.decor.add(base);
    }

    // The rock face — one gradient fill plus a flat grass strip on top.
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
      this.bgGfx.fillGradientStyle(0xc4744f, 0xc4744f, 0x6b3a28, 0x6b3a28, 1);
      this.bgGfx.fillPoints(silhouette, true);

      // A flat two-tone grass strip along the top edge.
      const ridge = silhouette.slice(1, -1);
      const top = ridge.map(p => ({ x: p.x, y: p.y - 2.1 }));
      this.bgGfx.fillStyle(0x4a7a2d, 1);
      this.bgGfx.fillPoints([...top, ...ridge.slice().reverse()], true);
      this.bgGfx.fillStyle(0x6cb847, 1);
      this.bgGfx.fillPoints([...top, ...top.map(p => ({ x: p.x, y: p.y + 0.9 })).reverse()], true);
    }

    // "Mountain Drive" — a clear-day sky (a different mood from the
    // cliff's dawn, so the two stages don't just look like recolors of
    // each other) over a snow-capped peak the road switches back up.
    // Same deliberately-minimal approach as the cliff.
    buildMountainStatic() {
      this.sky.fillGradientStyle(0x2a6fb0, 0x2a6fb0, 0xcfeaf7, 0xcfeaf7, 1);
      this.sky.fillRect(0, 0, 100, 100);

      const sun = this.add.circle(18, 13, 4, 0xffffff, 1);
      this.decor.add(sun);

      this.buildMountainFace();

      // A simple trailhead sign at the foot of the road.
      const base = this.add.graphics();
      base.fillStyle(0x6b4a2e, 1); base.fillRect(CENTER_X - 22.15, BOTTOM_Y - 1, 0.3, 9);
      base.fillStyle(0xd1d5db, 1); base.fillRoundedRect(CENTER_X - 25.5, BOTTOM_Y - 1.5, 7, 3.4, 0.5);
      this.decor.add(base);
    }

    // A snow-capped peak — one gradient fill from forest green at the
    // base to white at the summit. Drawn once; never rebuilt.
    buildMountainFace() {
      const silhouette = [
        { x: -5, y: 100 }, { x: -5, y: 86 }, { x: 18, y: 48 }, { x: 34, y: 62 },
        { x: 50, y: 10 }, { x: 64, y: 56 }, { x: 80, y: 42 }, { x: 105, y: 84 }, { x: 105, y: 100 },
      ];
      this.bgGfx.fillGradientStyle(0xf4f8fc, 0xf4f8fc, 0x3f6b35, 0x3f6b35, 1);
      this.bgGfx.fillPoints(silhouette, true);
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
      // A dark halo stroke first — makes the rope read clearly against the
      // rock behind it — then a light manila-rope tan on top.
      stroke(1.8, 0x241a12, 0.45);
      stroke(1.15, 0xe4d2a0, 1);

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
      this.pathGfx.lineStyle(4.6, 0x000000, 0.2); path(this.pathGfx); // contact shadow
      this.pathGfx.lineStyle(4, 0x4b5259, 1); path(this.pathGfx); // asphalt

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
        // A soft pulsing glow — only on the single "next" marker, drawing
        // the eye to the current objective. Giving every *done* marker
        // the same permanent halo too (the previous behavior) meant a
        // closely-spaced route turned into a solid green wash once a
        // handful of checkpoints were complete, burying the rope/road
        // under overlapping glows instead of just showing clean
        // checkmarks.
        if (isNext) {
          const glow = this.add.circle(0, 0, r * 1.8, color, 0.3);
          parts.push(glow);
          this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.12, duration: 750, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
        // A plain disc with one soft highlight — enough to read as a
        // marker, not a layered "game node" with a ring, a glow, and two
        // separate specular highlights competing for attention.
        const base = this.add.circle(0, 0, r, color);
        const hi = this.add.circle(-r * 0.32, -r * 0.35, r * 0.4, 0xffffff, 0.55);
        parts.push(base, hi);
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
      }
      this._lastStageKey = stageKey;

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
