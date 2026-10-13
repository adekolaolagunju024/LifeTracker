// ── JOURNEY 3D: SPRINT TRACK STAGE ("The Final", WebGL / three.js) ────
// A floodlit Olympic stadium: an eight-lane track round a mown infield,
// full stands, a big screen. You run lane 1 most of a lap, from the start
// of the back straight round the bend to the finish line at the end of the
// home straight. Each task is a split board by the kerb (it turns green
// when done); a task's obstacles are hurdles across your lane, cleared by
// jumping them (each one tips over as you go over it). Finishing every
// task sends you sprinting through the tape, and the photo-finish camera
// flashes. In a race everyone else runs their own lane, in their colour,
// with their name (and place) over them.
//
// Loaded on demand by journeyGame.js ("sprint3d"), which falls back to the
// 2D Sprint Track without WebGL. Same sync() contract as the other 3D
// stages. The athlete is the KayKit Knight (CC0) re-dressed in code: a
// singlet in your colour, running shorts, bare arms, a headband.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  createShell, createLoop, makeCanvasTexture, seededRandom, softDotTexture, Particles, particleScaleFor,
  loadGLTF, makeCharacter, play, finished, recolorCharacter, findBone, attachToBone,
  checkpointFracOf, progressToPathFracSmooth, angleLerp, createWalker,
  stageTasks, layoutSignature, nameTagSprite, pickFoes, resolveChanges, tagText, peekCamera, createRivals,
} from './journey3dKit.js';

const ATHLETE_URL = '/assets/models/Knight.glb';
const CLEARED = 'CLEARED!';

export function createSprint3D(container) {
  const shell = createShell(container, {
    label: 'Sprint Track Journey in 3D', background: '#0b1324', loadingText: 'Filling the stadium…',
    winTitle: 'Personal Best!', winText: 'You broke the tape', winFill: '#fde047', winEdge: '#b91c1c',
  });
  const { renderer, reduceMotion, timers } = shell;
  renderer.toneMappingExposure = 1.05;
  const canvasTexture = makeCanvasTexture(renderer);
  const rnd = seededRandom(61);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color();
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;

  // ── The track (metres): straights along x, bends round x = ±L ─────────
  const L = 22, LANE_W = 1.22, LANES = 8, R1 = 16;
  const RIN = R1 - LANE_W / 2, ROUT = RIN + LANES * LANE_W;
  const ATHLETE_H = 1.7, RUN_SPEED = 7;
  // A point on the stadium outline at radius r, by distance s round it:
  // left along the back straight (z = -r), round the left bend, right along
  // the home straight (z = +r), then round the right bend back to the
  // start. Your run is the first three parts.
  function ovalPoint(s, r) {
    const bend = Math.PI * r, lap = 4 * L + 2 * bend;
    s = ((s % lap) + lap) % lap;
    if (s <= 2 * L) return V(L - s, 0, -r);
    if (s <= 2 * L + bend) { const a = -Math.PI / 2 - (s - 2 * L) / r; return V(-L + r * Math.cos(a), 0, r * Math.sin(a)); }
    if (s <= 4 * L + bend) return V(-L + (s - 2 * L - bend), 0, r);
    const a = Math.PI / 2 - (s - 4 * L - bend) / r;
    return V(L + r * Math.cos(a), 0, r * Math.sin(a));
  }
  const runPoint = (s, r) => ovalPoint(s, r);
  const RUN_LEN = 4 * L + Math.PI * R1;
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 97 }, (_, i) => runPoint((i / 96) * RUN_LEN, R1)), false, 'catmullrom', 0.5);
  const curveLen = curve.getLength();
  const checkpointFrac = (i, n) => checkpointFracOf(i, n);
  const wallFrac = i => checkpointFrac(i, tasks.length) - 0.035;
  const hurdleStopFrac = i => wallFrac(i) - 2.2 / curveLen;
  // Out from the track's centre line: the way a higher lane lies.
  function outward(p) {
    const q = V(THREE.MathUtils.clamp(p.x, -L, L), 0, 0);
    const d = p.clone().sub(q).setY(0);
    return d.lengthSq() < 1e-6 ? V(0, 0, 1) : d.normalize();
  }
  // The whole stadium outline at radius r, as points round it.
  function ringPoints(r, n = 120) {
    const lap = 4 * L + 2 * Math.PI * r;
    return Array.from({ length: n }, (_, i) => ovalPoint((i / n) * lap, r));
  }
  const shapeOf = r => new THREE.Shape(ringPoints(r).map(p => new THREE.Vector2(p.x, -p.z)));

  // ── Scene, sky, light ─────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = canvasTexture(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#050914'); grd.addColorStop(0.55, '#14233f'); grd.addColorStop(0.85, '#33496f'); grd.addColorStop(1, '#5b6f94');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog('#1d2b48', 90, 220);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  camera.position.set(30, 8, -30);
  scene.add(new THREE.HemisphereLight('#c3d4ff', '#2a3a28', 0.85));
  const key = new THREE.DirectionalLight('#fff4dd', 2.4);
  key.position.set(-30, 50, 24); key.target.position.set(0, 0, 0);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -52, right: 52, top: 40, bottom: -40, near: 5, far: 140 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#9fb8ff', 0.7);
  rim.position.set(40, 20, -50); scene.add(rim);

  // ── Ground: concourse, track, infield ─────────────────────────────────
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#3b4252', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);
  const flatMesh = (shape, mat, y) => {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), mat);
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; scene.add(m);
    return m;
  };
  const trackTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#c2462c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,190,160,0.06)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  }, { repeat: true });
  trackTex.repeat.set(0.25, 0.25);
  const outerShape = shapeOf(ROUT + 1.2);
  outerShape.holes.push(new THREE.Path(ringPoints(RIN - 0.25).map(p => new THREE.Vector2(p.x, -p.z))));
  flatMesh(outerShape, new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.92 }), 0);
  const kerbShape = shapeOf(RIN - 0.25);
  kerbShape.holes.push(new THREE.Path(ringPoints(RIN - 0.45).map(p => new THREE.Vector2(p.x, -p.z))));
  flatMesh(kerbShape, new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.6 }), 0.02);
  const grassTex = canvasTexture(512, 64, (g, w, h) => {
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#3f9d4a' : '#48aa53'; g.fillRect((i / 16) * w, 0, w / 16 + 1, h); }
    for (let i = 0; i < 3000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  }, { repeat: true });
  grassTex.repeat.set(1 / (2 * (L + RIN)), 1 / 8); grassTex.offset.set(0.5, 0);
  flatMesh(shapeOf(RIN - 0.45), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }), 0.01);

  // Lane lines: thin white ribbons round the oval.
  function ribbon(points, width, y, closed = true) {
    const pos = [], idx = [];
    const n = points.length;
    for (let i = 0; i <= (closed ? n : n - 1); i++) {
      const p = points[i % n], q = points[(i + 1) % n], o = points[(i - 1 + n) % n];
      const t = q.clone().sub(o).setY(0).normalize();
      const side = V(-t.z, 0, t.x);
      pos.push(p.x + side.x * width / 2, y, p.z + side.z * width / 2, p.x - side.x * width / 2, y, p.z - side.z * width / 2);
      if (i < (closed ? n : n - 1)) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  const lineMat = new THREE.MeshBasicMaterial({ color: '#f8fafc', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 });
  for (let i = 1; i <= LANES; i++) scene.add(new THREE.Mesh(ribbon(ringPoints(RIN + i * LANE_W, 160), 0.06, 0.02), lineMat));
  // Your lane, picked out, and the ground you've covered in gold.
  const runPts = Array.from({ length: 161 }, (_, i) => curve.getPointAt(i / 160));
  scene.add(new THREE.Mesh(ribbon(runPts, LANE_W * 0.86, 0.015, false), new THREE.MeshStandardMaterial({ color: '#dc5a35', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 })));
  const progressLine = new THREE.Mesh(ribbon(runPts, 0.22, 0.03, false), new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
  progressLine.geometry.setDrawRange(0, 0); scene.add(progressLine);
  let progressShown = 0, progressTarget = 0;

  // The start and finish lines across every lane, and the lane numbers.
  const across = (s, r) => { const p = runPoint(s, R1), o = outward(p); return p.clone().addScaledVector(o, r - R1); };
  function lineAcross(s, width, color) {
    const a = across(s, RIN), b = across(s, ROUT);
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, 0.01, a.distanceTo(b)), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(a.clone().lerp(b, 0.5)).setY(0.03);
    m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    scene.add(m);
    return m;
  }
  lineAcross(0, 0.12, '#ffffff');
  lineAcross(RUN_LEN, 0.12, '#ffffff');
  const numberTex = n => canvasTexture(64, 64, (g, w) => {
    g.fillStyle = '#ffffff'; g.font = '900 52px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), w / 2, w / 2 + 3);
  });
  for (let lane = 0; lane < LANES; lane++) {
    [1.2, RUN_LEN - 1.4].forEach(s => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: numberTex(lane + 1), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = s < 2 ? Math.PI / 2 : -Math.PI / 2;
      m.position.copy(across(s, R1 + lane * LANE_W)).setY(0.035);
      scene.add(m);
    });
  }

  // ── The stadium: stands all round, a crowd, a big screen, floodlights ─
  const standMats = [new THREE.MeshStandardMaterial({ color: '#1b2234', roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: '#232c42', roughness: 0.9 })];
  const fanSpots = [];
  const STAND_R = ROUT + 4;
  // tiers following the oval: boxes along each straight, wedges round the bends
  for (let tier = 0; tier < 5; tier++) {
    const r = STAND_R + tier * 2.2, rise = 1.25 * (tier + 1);
    const pts = ringPoints(r, 72);
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const len = p.distanceTo(q) + 0.05;
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, rise, 2.2), standMats[tier % 2]);
      box.position.copy(p.clone().lerp(q, 0.5)).setY(rise / 2);
      box.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
      box.receiveShadow = true; scene.add(box);
      const steps = Math.max(1, Math.floor(len / 0.8));
      for (let k = 0; k < steps; k++) fanSpots.push(p.clone().lerp(q, (k + 0.5) / steps).setY(rise));
    });
  }
  const KIT = ['#e53935', '#ffffff', '#1e88e5', '#fdd835', '#10b981', '#f97316', '#e53935', '#ffffff'];
  const fans = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.42, 2, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), fanSpots.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.7 }), fanSpots.length);
  const SKIN = ['#f1c7a3', '#d9a07a', '#a8714f', '#7a4a32', '#f6d7bd'];
  const fanPhase = new Float32Array(fanSpots.length);
  fanSpots.forEach((p, i) => {
    fanPhase[i] = rnd() * Math.PI * 2;
    fans.setMatrixAt(i, tmpM.makeTranslation(p.x, p.y + 0.4, p.z)); fans.setColorAt(i, tmpC.set(KIT[(i * 7 + (i >> 3)) % KIT.length]));
    heads.setMatrixAt(i, tmpM.makeTranslation(p.x, p.y + 0.86, p.z)); heads.setColorAt(i, tmpC.set(SKIN[(i * 3 + (i >> 2)) % SKIN.length]));
  });
  scene.add(fans, heads);
  let cheer = 0;
  // Roofs over the two straights.
  [-1, 1].forEach(sz => {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2 * L + 16, 0.4, 9), new THREE.MeshStandardMaterial({ color: '#0f1524', roughness: 0.6, metalness: 0.3 }));
    roof.position.set(0, 12, sz * (STAND_R + 7)); scene.add(roof);
  });
  // The big screen at the far end, over the left bend's stands.
  const screenCanvas = document.createElement('canvas'); screenCanvas.width = 512; screenCanvas.height = 256;
  const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(-L - STAND_R - 9, 13, 0); screen.rotation.y = Math.PI / 2; scene.add(screen);
  const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.8, 14.8), new THREE.MeshStandardMaterial({ color: '#111827' }));
  screenFrame.position.copy(screen.position).add(V(-0.3, 0, 0)); scene.add(screenFrame);
  let screenKey = '';
  function drawScreen(lines) {
    const key2 = lines.join('|');
    if (key2 === screenKey) return;
    screenKey = key2;
    const g = screenCanvas.getContext('2d'), w = 512, h = 256;
    g.fillStyle = '#0b1020'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fbbf24'; g.font = '900 34px "Arial Black", Arial, sans-serif'; g.textBaseline = 'middle';
    g.fillText(lines[0] || '', 24, 36);
    g.font = '800 30px "Courier New", monospace';
    lines.slice(1, 6).forEach((t, i) => { g.fillStyle = i === 0 ? '#ffffff' : '#cbd5e1'; g.fillText(t, 24, 84 + i * 38); });
    screenTex.needsUpdate = true;
  }
  const glowTex = softDotTexture(canvasTexture);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const x = sx * (L + STAND_R - 2), z = sz * (STAND_R + 9);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 30, 8), new THREE.MeshStandardMaterial({ color: '#5b6476', metalness: 0.6, roughness: 0.4 }));
    mast.position.set(x, 15, z); scene.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 0.6), new THREE.MeshStandardMaterial({ color: '#2a3140', emissive: '#fff6d8', emissiveIntensity: 1.6 }));
    head.position.set(x, 30.5, z); head.lookAt(0, 0, 0); scene.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff6d8', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.position.set(x * 0.98, 30.5, z * 0.98); glow.scale.setScalar(26); scene.add(glow);
  });
  // A long-jump pit and a throws circle on the infield.
  {
    const pit = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 2.6), new THREE.MeshStandardMaterial({ color: '#e9d5a1', roughness: 1 }));
    pit.position.set(-6, 0.02, -2); pit.receiveShadow = true; scene.add(pit);
    const runway = new THREE.Mesh(new THREE.BoxGeometry(14, 0.03, 1.2), new THREE.MeshStandardMaterial({ color: '#c2462c', roughness: 0.9 }));
    runway.position.set(6, 0.02, -2); scene.add(runway);
    const circle = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.06, 32), new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.7 }));
    circle.position.set(8, 0.03, 5); scene.add(circle);
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 6, 32), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
    rimRing.rotation.x = -Math.PI / 2; rimRing.position.set(8, 0.06, 5); scene.add(rimRing);
  }

  // ── The finish: tape, photo-finish tower ──────────────────────────────
  const FIN = runPoint(RUN_LEN, R1);
  const finA = across(RUN_LEN, RIN - 0.3), finB = across(RUN_LEN, ROUT + 0.3);
  const tapeMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.6, side: THREE.DoubleSide });
  const tapeHalves = [0, 1].map(k => {
    const pivot = new THREE.Group();
    const from = k ? finB : finA, mid = finA.clone().lerp(finB, 0.5);
    pivot.position.copy(from).setY(1.15);
    const len = from.distanceTo(mid);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, len), tapeMat);
    strip.position.set(0, 0, len / 2);
    pivot.add(strip);
    pivot.lookAt(mid.clone().setY(1.15));
    scene.add(pivot);
    return { pivot, rest: pivot.quaternion.clone(), swing: 0 };
  });
  [finA, finB].forEach(p => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 8), new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.3 }));
    post.position.copy(p).setY(0.65); post.castShadow = true; scene.add(post);
  });
  const tower = new THREE.Group();
  {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.5), new THREE.MeshStandardMaterial({ color: '#64748b' }));
    leg.position.y = 2; tower.add(leg);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1), new THREE.MeshStandardMaterial({ color: '#1f2937' }));
    box.position.y = 4.4; tower.add(box);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 16), new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#0ea5e9', emissiveIntensity: 0.6 }));
    lens.rotation.z = Math.PI / 2; lens.position.set(0, 4.4, 0); tower.add(lens);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 88, (g, w, h) => { g.fillStyle = '#0f172a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fbbf24'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#fbbf24'; g.font = '900 52px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('FINISH', w / 2, h / 2 + 2); }),
      toneMapped: false,
    }));
    board.position.set(0, 5.5, 0); tower.add(board);
    tower.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // just inside the infield, by the line, facing the runners
    tower.position.copy(across(RUN_LEN, RIN - 3.2));
    tower.rotation.y = -Math.PI / 2;
    scene.add(tower);
  }
  const flash = new THREE.PointLight('#ffffff', 0, 40);
  flash.position.copy(tower.position).add(V(0, 4.4, 0)); scene.add(flash);
  let flashT = 0;

  // ── Particles ─────────────────────────────────────────────────────────
  const scaleU = { value: 400 };
  const sparks = new Particles(scene, 1600, { additive: true, map: glowTex, scale: scaleU });
  function sparkle(at, n = 40, colors = ['#fff3b0', '#ffffff'], power = 3) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.9 + 0.1, rnd() - 0.5).normalize().multiplyScalar(power * (0.4 + rnd() * 0.8));
      sparks.emit({ pos: at.clone(), vel: d, life: 0.9 + rnd() * 0.8, size: [0.3, 0.05], color: [colors[i % colors.length], '#ffffff'], gravity: 0.5, drag: 2 });
    }
  }
  const CONFETTI = ['#ef4444', '#ffffff', '#fde047', '#22c55e', '#3b82f6', '#f472b6'];
  function confetti(at, n = 140) {
    if (reduceMotion || !celebrationsOn) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, 0.6 + rnd(), rnd() - 0.5).normalize().multiplyScalar(5 + rnd() * 4);
      sparks.emit({ pos: at.clone().add(rand3(1)), vel: d, life: 2 + rnd() * 1.2, size: [0.35, 0.2], color: [CONFETTI[i % CONFETTI.length]], gravity: 4, drag: 1.4 });
    }
  }

  // ── Split boards (one per task), by the kerb ──────────────────────────
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 96, (g, w, h) => {
      g.fillStyle = bg; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 14); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.4)'; g.stroke();
      g.fillStyle = fg; g.font = '900 62px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 4);
    });
  }
  const STATUS = { done: ['✓', '#22c55e', '#052e16'], next: [null, '#fbbf24', '#1b2234'], pending: [null, '#e6ebf3', '#1b2234'] };
  const flags = [];
  function buildFlags() {
    flags.forEach(f => scene.remove(f.group));
    flags.length = 0;
    tasks.forEach((t, i) => {
      const u = checkpointFrac(i, tasks.length);
      const p = curve.getPointAt(u), o = outward(p);
      const group = new THREE.Group();
      group.position.copy(p).addScaledVector(o, -LANE_W * 0.5 - 1.6); // on the infield, clear of your lane
      const tan = curve.getTangentAt(u);
      group.rotation.y = Math.atan2(-tan.x, -tan.z); // facing you as you come
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 8), new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.4 }));
      pole.position.y = 0.9; pole.castShadow = true; group.add(pole);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.68), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }));
      board.position.y = 2.05; group.add(board);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.74, 0.05), new THREE.MeshStandardMaterial({ color: '#111827' }));
      back.position.set(0, 2.05, -0.04); group.add(back);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 40), new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; group.add(ring);
      scene.add(group);
      flags.push({ group, board, ring, pop: 0, status: '' });
    });
  }
  function refreshFlags() {
    const doneCount = tasks.filter(t => t.done).length;
    tasks.forEach((t, i) => {
      const f = flags[i];
      if (!f) return;
      const status = t.done ? 'done' : i === doneCount ? 'next' : 'pending';
      if (f.status === status) return;
      f.status = status;
      const [txt, bg, fg] = STATUS[status];
      if (f.board.material.map) f.board.material.map.dispose();
      f.board.material.map = badgeTexture(txt || String(i + 1), bg, fg);
      f.board.material.needsUpdate = true;
      f.ring.visible = status === 'next';
    });
  }

  // ── Hurdles: one per obstacle point, across your lane ─────────────────
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6157'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  const barTex = canvasTexture(64, 8, (g, w, h) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#111827' : '#ffffff'; g.fillRect((i * w) / 4, 0, w / 4 + 1, h); } });
  const hurdleMats = { leg: new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.3, roughness: 0.5 }), foot: new THREE.MeshStandardMaterial({ color: '#334155' }), bar: new THREE.MeshStandardMaterial({ map: barTex }) };
  const HURDLE_H = 0.84;
  function buildHurdle() {
    const g = new THREE.Group();
    const tip = new THREE.Group(); g.add(tip); // tips over forward about its feet
    [-1, 1].forEach(s => {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), hurdleMats.foot); foot.position.set(s * 0.5, 0.025, -0.25); tip.add(foot);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, HURDLE_H, 0.04), hurdleMats.leg); leg.position.set(s * 0.5, HURDLE_H / 2, 0); tip.add(leg);
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.03), hurdleMats.bar); bar.position.y = HURDLE_H - 0.06; tip.add(bar);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { g, tip };
  }
  const walls = [];
  function buildWalls() {
    walls.forEach(w => { w.foes.forEach(f => scene.remove(f.g)); scene.remove(w.lock, w.tag, w.ring); });
    walls.length = 0;
    tasks.forEach((t, i) => {
      if (!t.foeList.length) return;
      const n = Math.min(t.foeList.length, 5);
      const owners = pickFoes(t.foeList, n);
      const u0 = wallFrac(i);
      const foes = Array.from({ length: n }, (_, k) => {
        const u = u0 + (k * 2.4) / curveLen;
        const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
        const h = buildHurdle();
        h.g.position.copy(p); h.g.rotation.y = Math.atan2(tan.x, tan.z);
        scene.add(h.g);
        const down = owners[k].resolved;
        if (down) h.tip.rotation.x = Math.PI / 2 - 0.08;
        return Object.assign(h, { u, owner: owners[k].id, ticked: down, fall: down ? 1 : 0, falling: false });
      });
      const at = curve.getPointAt(u0 + ((n - 1) * 1.2) / curveLen);
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.copy(at).setY(2.1); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
      tag.position.copy(at).setY(2.7); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.85, 48), new THREE.MeshBasicMaterial({ color: '#ff6157', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(at).setY(0.04); scene.add(ring);
      const w = { taskIndex: i, foes, lock, tag, ring, at, cleared: !!t.done, clearing: false, t: t.done ? 99 : 0, open: !t.foes, fade: t.done || !t.foes ? 1 : 0 };
      if (w.cleared) foes.forEach(f => { f.fall = 1; f.tip.rotation.x = Math.PI / 2 - 0.08; });
      if (w.fade) lock.visible = tag.visible = ring.visible = false;
      walls.push(w);
    });
  }
  // Cleared: you run on and jump each hurdle; each tips over as you clear it.
  function clearWall(w) { if (w.cleared) return; w.cleared = true; w.t = 0; notify(); }
  function restoreWall(w) {
    w.cleared = false; w.clearing = false; w.t = 0;
    w.foes.forEach(f => { if (!f.ticked) { f.fall = 0; f.falling = false; f.tip.rotation.x = 0; } });
  }
  function knock(f) {
    if (f.falling || f.fall >= 1) return;
    f.falling = true;
    sparkle(f.g.position.clone().setY(0.9), 22, ['#ffffff', '#fde047'], 2.5);
  }
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  // An obstacle ticked off on its own: you run up to its hurdles and they
  // go down one by one (or, unticked, stand back up).
  function applyResolves(changes) {
    const engaging = [];
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.at.clone().setY(3.2) : curve.getPointAt(wallFrac(c.index)).setY(3.2);
      const label = c.resolved ? () => shell.spawnTaskLabel(at, c.name, 'foe', CLEARED) : null;
      const now = () => { if (label) { timers.push(setTimeout(label, j * 450)); if (w) { peek.at.copy(w.at); peek.t = 3.4; } } };
      let engagedHere = false;
      if (!w) { now(); return; }
      w.foes.forEach((f, k) => {
        if (f.owner !== c.id) return;
        if (c.resolved && !f.ticked) {
          f.ticked = true;
          if (!reduceMotion && !w.cleared) { engaging.push({ w, f, label: engagedHere ? null : label }); engagedHere = true; }
          else timers.push(setTimeout(() => knock(f), j * 450 + k * 200));
        } else if (!c.resolved && f.ticked) {
          f.ticked = false;
          if (!w.cleared) { f.fall = 0; f.falling = false; f.tip.rotation.x = 0; }
        }
      });
      if (!engagedHere) now();
    });
    walls.forEach(w => { w.open = !tasks[w.taskIndex].foes; });
    new Set(changes.map(c => c.index)).forEach(i => { const w = walls.find(x => x.taskIndex === i); if (w) retagWall(w); });
    const byWall = new Map();
    engaging.forEach(e => { if (!byWall.has(e.w)) byWall.set(e.w, []); byWall.get(e.w).push(e); });
    byWall.forEach((items, w) => walker.engage(w.taskIndex, near => {
      items.forEach((e, k) => timers.push(setTimeout(() => knock(e.f), (near ? 250 : 0) + k * 380)));
      items.filter(e => e.label).forEach((e, k) => timers.push(setTimeout(e.label, k * 450 + (near ? 300 : 0))));
      peek.at.copy(w.at); peek.t = 3.4;
    }, 0.6 + 0.4 * items.length));
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      w.foes.forEach(f => {
        if (f.falling) {
          f.fall = Math.min(1, f.fall + dt * 2.4);
          const k = f.fall;
          f.tip.rotation.x = (Math.PI / 2 - 0.08) * (k * k) - Math.sin(k * Math.PI) * 0.05;
          if (f.fall >= 1) f.falling = false;
        }
      });
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.75, 0, 1);
      w.lock.material.opacity = w.tag.material.opacity = 1 - w.fade;
      w.ring.material.opacity = (shut ? 0.35 + 0.25 * Math.sin(time * 4) : 0.55) * (1 - w.fade);
      w.lock.visible = w.tag.visible = w.ring.visible = w.fade < 1;
      if (shut) w.lock.position.y = 2.1 + Math.sin(time * 2.2) * 0.08;
    });
  }
  const wallPause = w => 0.3 + 0.1 * w.foes.length;

  // ── The athlete ───────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  let athlete = null, clips = [];
  const YOU_COLOR = '#2563eb';
  function dressAthlete(obj, singlet) {
    ['Knight_Helmet', 'Knight_Cape', '1H_Sword', 'Badge_Shield'].forEach(n => { const o = obj.getObjectByName(n); if (o) o.removeFromParent(); });
    const kit = new THREE.Color(singlet), hsl = {};
    kit.getHSL(hsl);
    // armour → the singlet; leather → black shorts and spikes
    recolorCharacter(obj, (h, s, l) => {
      if (s < 0.16 && l > 0.16 && l < 0.86) return [hsl.h * 360, Math.max(0.55, hsl.s), 0.3 + l * 0.25];
      if (h > 12 && h < 45 && s > 0.3 && l < 0.6) return [220, 0.15, 0.1 + l * 0.15];
      if ((h > 340 || h < 12) && s > 0.4) return [0, 0, 0.95];
      return null;
    });
    // bare arms, and running tights
    [['Knight_ArmLeft', '#a26a42'], ['Knight_ArmRight', '#a26a42'], ['Knight_LegLeft', '#111827'], ['Knight_LegRight', '#111827']].forEach(([n, c]) => {
      const m = obj.getObjectByName(n);
      if (m) { m.material = m.material.clone(); m.material.map = null; m.material.color.set(c); m.material.needsUpdate = true; }
    });
  }
  // A headband in their colour, and a race number on the chest.
  function rigAthlete(ch, color, number) {
    const obj = ch.obj;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const head = findBone(obj, 'head');
    if (head) {
      const hp = new THREE.Vector3(); head.getWorldPosition(hp);
      const top = box.max.y - hp.y; // the head bone to the crown
      const r = top * 0.47;
      const band = new THREE.Mesh(new THREE.TorusGeometry(r, top * 0.05, 6, 28), new THREE.MeshStandardMaterial({ color }));
      band.name = 'headband';
      band.rotation.x = Math.PI / 2 - 0.12;
      attachToBone(obj, head, band, V(hp.x, hp.y + top * 0.5, hp.z + top * 0.02));
    }
    const chest = findBone(obj, 'chest');
    if (chest && number) {
      const cp = new THREE.Vector3(); chest.getWorldPosition(cp);
      const bib = new THREE.Mesh(new THREE.PlaneGeometry(ATHLETE_H * 0.17, ATHLETE_H * 0.12), new THREE.MeshBasicMaterial({
        map: canvasTexture(96, 64, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#111827'; g.font = '900 44px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(number, w / 2, h / 2 + 2); }),
      }));
      bib.name = 'bib';
      attachToBone(obj, chest, bib, V(cp.x, cp.y + ATHLETE_H * 0.02, cp.z + ATHLETE_H * 0.115));
    }
  }

  // ── Running the lap ───────────────────────────────────────────────────
  // Over a cleared hurdle you hop: a little arc while you pass its spot.
  function hopAt(frac) {
    let y = 0;
    walls.forEach(w => {
      if (!w.cleared && !w.open) return;
      w.foes.forEach(f => {
        if (f.fall >= 1 && !f.falling) return;
        const d = (frac - f.u) * curveLen; // metres past the hurdle
        if (d > -1.1 && d < 1.1) {
          y = Math.max(y, Math.cos((d / 1.1) * (Math.PI / 2)) * 0.75);
          if (d > -0.1) knock(f);
        }
      });
    });
    return y;
  }
  const walker = createWalker({
    curve, speed: RUN_SPEED, accel: 8, brakeDecel: 7, reduceMotion, getTasks: () => tasks, walls,
    hooks: {
      stopFrac: hurdleStopFrac, wallPause,
      place(frac, moving) {
        const u = THREE.MathUtils.clamp(frac, 0, 1);
        const p = curve.getPointAt(u);
        athlete.holder.position.set(p.x, 0.02 + (moving ? hopAt(u) : 0), p.z);
        athlete.holder.rotation.y = P.heading;
        progressTarget = u;
      },
      runAnim(k) { play(athlete, 'Running_A', { fade: 0.2, timeScale: Math.max(0.8, k * 1.25) }); },
      idleAnim(pause, tick) {
        if (tick) { if (finished(athlete)) play(athlete, 'Idle', { fade: 0.4 }); return; }
        if (pause && athlete.current !== athlete.actions.Running_A) return;
        play(athlete, 'Idle', { fade: 0.3 });
      },
      onFlag(i, t) {
        const f = flags[i];
        if (!f) return;
        f.pop = 1;
        sparkle(f.group.position.clone().add(V(0, 2.1, 0)), 46, ['#86efac', '#ffffff', '#fde047'], 3.4);
        if (P.mode !== 'finale') play(athlete, 'Cheer', { fade: 0.2, once: true, timeScale: 1.3 });
        shell.spawnTaskLabel(f.group.position.clone().add(V(0, 3, 0)), t.title);
        cheer = Math.max(cheer, 1.2);
      },
      clearWall, restoreWall,
      startFinale, undoFinale: undoVictory, updateFinale, updateVictory,
    },
  });
  const P = walker.P;

  // ── Finale: sprint through the tape ───────────────────────────────────
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  const pastLine = 9; // metres past the finish line where you slow to a stop
  function finalePoint(s) { return s <= RUN_LEN ? runPoint(s, R1) : V(-L + (s - 2 * L - Math.PI * R1), 0, R1); }
  function startFinale() {
    if (P.won) return;
    P.mode = 'finale'; P.finT = 0;
    P.fin = { s0: P.frac * RUN_LEN, steps: new Set() };
    if (reduceMotion) { settleWon(); victory(); }
  }
  function updateFinale(dt) {
    const t = (P.finT += dt), F = P.fin;
    once('go', () => play(athlete, 'Running_A', { fade: 0.15, timeScale: 1.4 }));
    const total = RUN_LEN + pastLine - F.s0;
    // fast to the line, easing down after it
    const k = smooth(0, 3.4, t);
    const s = F.s0 + total * (1 - Math.pow(1 - k, 1.6));
    const p = finalePoint(s);
    athlete.holder.position.set(p.x, 0.02, p.z);
    P.heading = angleLerp(P.heading, Math.PI / 2, Math.min(1, dt * 6));
    athlete.holder.rotation.y = P.heading;
    progressTarget = Math.min(1, s / RUN_LEN);
    if (s >= RUN_LEN) once('tape', breakTape);
    if (t > 3.4) once('stop', () => { play(athlete, 'Cheer', { fade: 0.3 }); });
    if (t > 4.2) once('win', victory);
  }
  function breakTape() {
    tapeHalves.forEach(h => { h.swing = 0.0001; });
    flashT = 0.5;
    cheer = 3;
    confetti(FIN.clone().setY(2), 180);
    sparkle(FIN.clone().setY(1.2), 60, ['#ffffff', '#fde047', '#ef4444'], 4);
  }
  function victory() {
    P.won = true;
    if (celebrationsOn) shell.showWin();
    P.mode = 'victory'; P.vicT = 0;
    notify();
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; timers.push(setTimeout(cb, celebrationsOn ? 1800 : 0)); }
  }
  function updateVictory(dt) {
    P.vicT = (P.vicT || 0) + dt;
    const toCam = Math.atan2(camera.position.x - athlete.holder.position.x, camera.position.z - athlete.holder.position.z);
    athlete.holder.rotation.y = angleLerp(athlete.holder.rotation.y, toCam, Math.min(1, dt * 2));
    if (P.vicT > 6 && athlete.current === athlete.actions.Cheer) play(athlete, 'Idle', { fade: 0.5 });
    if (!reduceMotion && celebrationsOn && rnd() < dt * 1.5) confetti(FIN.clone().add(V((rnd() - 0.5) * 8, 4, (rnd() - 0.5) * 6)), 40);
  }
  function settleWon() {
    const p = finalePoint(RUN_LEN + pastLine);
    athlete.holder.position.set(p.x, 0.02, p.z);
    tapeHalves.forEach(h => { h.swing = 1; });
    P.fin = { steps: new Set(['go', 'tape', 'stop', 'win']) };
    P.won = true; P.mode = 'victory'; P.vicT = 99; progressTarget = 1;
    play(athlete, 'Idle', { fade: 0 });
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; shell.winEl.hidden = true;
    tapeHalves.forEach(h => { h.swing = 0; h.pivot.quaternion.copy(h.rest); });
    if (athlete) play(athlete, 'Idle', { fade: 0.2 });
  }
  function updateTape(dt) {
    tapeHalves.forEach((h, k) => {
      if (h.swing <= 0) return;
      h.swing = Math.min(1, h.swing + dt * 1.6);
      const a = (1 - Math.pow(1 - h.swing, 3)) * 1.25;
      h.pivot.quaternion.copy(h.rest).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), (k ? 1 : -1) * a))
        .multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), a * 0.6));
    });
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  const cam = { look: V(0, 0, 0) };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  const peek = { at: new THREE.Vector3(), t: 0 };
  function updateCamera(dt, time) {
    const ap = athlete.holder.position;
    let rate = 3;
    if (P.mode === 'finale' && P.finT < 3.6) {
      // side-on at the line from the stands, like the broadcast camera
      camDesired.copy(FIN).add(V(-3, 3.4, 11)); lookDesired.copy(ap).add(V(0, 1, 0)); rate = 2.4;
    } else if (P.mode === 'finale' || P.mode === 'victory') {
      const a = 0.4 + (P.mode === 'victory' ? Math.sin(time * 0.12) * 0.4 : 0);
      camDesired.copy(ap).add(V(Math.sin(a) * 6, 2.4, Math.cos(a) * 6)); lookDesired.copy(ap).add(V(0, 1.1, 0)); rate = 1.6;
    } else if (shell.cam.mode === 'overview') {
      overview(camDesired); lookDesired.set(0, 0, 0);
    } else {
      const dir = V(Math.sin(P.heading), 0, Math.cos(P.heading));
      const o = outward(ap);
      camDesired.copy(ap).addScaledVector(dir, -7.5).addScaledVector(o, 2.2).add(V(0, 3.4, 0));
      lookDesired.copy(ap).addScaledVector(dir, 5).add(V(0, 1, 0));
      peekCamera(peek, ap, camDesired, lookDesired, dt, 8, 3.6, 1.2);
    }
    const k = 1 - Math.exp(-dt * rate);
    camera.position.lerp(camDesired, k);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
  }
  // Over the whole stadium. On a tall screen the view turns so the oval
  // runs top to bottom (as the 2D phone layout does), far enough out for
  // its width to fit.
  function overview(v) {
    if (camera.aspect >= 1) return v.set(0, 62, 46);
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const d = 1.08 * Math.max((ROUT + 3) / Math.tan(hHalf), (L + ROUT + 3) / Math.tan(vHalf));
    return v.set(d * 0.4, d * 0.92, 0);
  }
  function snapCamera() {
    const ap = athlete.holder.position;
    if (shell.cam.mode === 'overview') { overview(camera.position); cam.look.set(0, 0, 0); }
    else {
      const dir = V(Math.sin(P.heading), 0, Math.cos(P.heading));
      camera.position.copy(ap).addScaledVector(dir, -7.5).add(V(0, 3.4, 0));
      cam.look.copy(ap).addScaledVector(dir, 5).add(V(0, 1, 0));
    }
    camera.lookAt(cam.look);
  }

  // ── Ghost, rivals, the big screen ─────────────────────────────────────
  let ghost = null;
  function cloneAthlete(color, opacity = 1) {
    const obj = SkeletonUtils.clone(athlete.obj);
    const tint = new THREE.Color(color);
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (o.material.color && o.name === 'Knight_Body') o.material.color.lerp(tint, 0.75);
      if (opacity < 1) { o.material.transparent = true; o.material.opacity = opacity; o.material.depthWrite = false; }
      o.castShadow = opacity === 1;
    });
    // your number stays yours; their headband is in their colour
    const bib = obj.getObjectByName('bib'); if (bib) bib.visible = false;
    const band = obj.getObjectByName('headband'); if (band) band.material.color.set(color);
    const holder = new THREE.Group(); holder.add(obj); scene.add(holder);
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {}; clips.forEach(c => { actions[c.name] = mixer.clipAction(c); });
    const ch = { holder, obj, mixer, actions, current: null };
    play(ch, 'Idle', { fade: 0 }); mixer.update(rnd() * 2);
    return ch;
  }
  // a lane by the line at path fraction u, `lane` lanes out from yours
  function inLane(u, lane) {
    const p = curve.getPointAt(THREE.MathUtils.clamp(u, 0, 1));
    return p.addScaledVector(outward(p), lane * LANE_W);
  }
  function updateGhost(g) {
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) ghost = cloneAthlete('#94a3b8', 0.4);
    const u = THREE.MathUtils.clamp(progressToPathFracSmooth(g.frac, tasks.length), 0, 1);
    ghost.holder.visible = true;
    ghost.holder.position.copy(inLane(u, 1)).setY(0.02);
    const t = curve.getTangentAt(u); ghost.holder.rotation.y = Math.atan2(t.x, t.z);
  }
  // Everyone in the race gets a lane of their own (2 to 8), kept the same
  // however the order changes.
  let lastRace = null;
  const laneOf = new Map();
  const rivals = createRivals({
    tagSize: 0.5, tagHeight: ATHLETE_H + 0.7,
    build: color => {
      const ch = cloneAthlete(color);
      if (!laneOf.has(color)) laneOf.set(color, 1 + (laneOf.size % 7));
      ch.lane = laneOf.get(color);
      return ch;
    },
    place: (ch, u) => {
      ch.holder.position.copy(inLane(u, ch.lane)).setY(0.02);
      const t = curve.getTangentAt(THREE.MathUtils.clamp(u, 0, 1));
      ch.holder.rotation.y = Math.atan2(t.x, t.z);
    },
  });
  function updateRivals(state) {
    if (state) lastRace = state;
    if (athlete && lastRace) {
      // lanes by colour, sorted, so each player keeps theirs
      (lastRace.rivals || []).map(r => r.color).sort().forEach(c => { if (!laneOf.has(c)) laneOf.set(c, 1 + (laneOf.size % 7)); });
      rivals.sync(lastRace.rivals, tasks.length, lastRace.youFrac || 0);
    }
    paintScreen();
  }
  function paintScreen() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    const race = lastRace && lastRace.rivals && lastRace.rivals.length ? lastRace : null;
    if (race) {
      const all = [...race.rivals.map(r => ({ name: r.name, frac: r.frac, place: r.place || 0 })), { name: 'YOU', frac: race.youFrac || 0, place: 0 }]
        .sort((a, b) => (a.place && b.place ? a.place - b.place : a.place ? -1 : b.place ? 1 : b.frac - a.frac));
      drawScreen(['THE FINAL', ...all.slice(0, 5).map((p, i) => `${String(i + 1).padStart(2)}  ${p.name.slice(0, 12).toUpperCase().padEnd(12)} ${Math.round(p.frac * 100)}%`)]);
    } else {
      drawScreen(['THE FINAL', `SPLITS   ${done} / ${n}`, `PROGRESS ${n ? Math.round((done / n) * 100) : 0}%`, P.won ? 'NEW PB!' : done === n && n ? 'TO THE LINE' : 'ON YOUR MARKS']);
    }
  }

  function notify() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Sprint Track Journey: ${done} of ${n} tasks done.` : 'Sprint Track Journey: no tasks yet.';
    const blocked = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= walker.progressToFrac(done, n) + 1e-3);
    if (blocked) text += ` Hurdles in the lane: ${tasks[blocked.taskIndex].blocker}.`;
    if (n && done === n) text += P.won ? ' Through the tape: a personal best!' : ' Sprinting for the line.';
    shell.root.setAttribute('aria-label', text);
    paintScreen();
  }

  let latestState = null, layoutSig = null;
  function applyState(state) {
    onSummitCb = state.onSummit || null;
    const next = stageTasks(state), n = next.length;
    const sig = layoutSignature(next);
    if (sig !== layoutSig) {
      const firstBuild = layoutSig === null;
      layoutSig = sig;
      if (P.won || P.mode === 'finale' || P.mode === 'victory') undoVictory();
      tasks = next;
      buildFlags(); buildWalls(); refreshFlags();
      walker.reset();
      if (n && tasks.every(t => t.done)) settleWon();
      progressShown = progressTarget;
      if (firstBuild) snapCamera();
    } else {
      const changes = resolveChanges(tasks, next);
      next.forEach((t, i) => { tasks[i].done = t.done; tasks[i].title = t.title; tasks[i].blocker = t.blocker; tasks[i].foes = t.foes; tasks[i].foeList = t.foeList; });
      if (changes.length) applyResolves(changes);
      refreshFlags();
      walker.plan();
    }
    updateGhost(state.ghost);
    updateRivals(state);
    notify();
  }

  // ── Loop ─────────────────────────────────────────────────────────────
  let simTime = 0;
  function simulate(dt) {
    simTime += dt;
    const time = simTime;
    athlete.mixer.update(dt);
    walker.update(dt);
    rivals.update(dt);
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
    updateWalls(dt, time);
    updateTape(dt);
    flags.forEach(f => {
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); f.board.scale.setScalar(1 + Math.sin((1 - f.pop) * Math.PI) * 0.35); }
      if (f.ring.visible) { f.ring.material.opacity = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); }
    });
    // the gold line behind you
    progressShown += (progressTarget - progressShown) * Math.min(1, dt * 6);
    progressLine.geometry.setDrawRange(0, Math.floor(progressShown * 160) * 6);
    // the crowd: a gentle bob, on its feet when something happens
    cheer = Math.max(0, cheer - dt);
    if (!reduceMotion) {
      const amp = 0.05 + Math.min(1, cheer) * 0.3, speed = cheer > 0 ? 10 : 3;
      for (let i = 0; i < fanSpots.length; i += 1) {
        const p = fanSpots[i], y = p.y + Math.max(0, Math.sin(time * speed + fanPhase[i])) * amp;
        fans.setMatrixAt(i, tmpM.makeTranslation(p.x, y + 0.4, p.z));
        heads.setMatrixAt(i, tmpM.makeTranslation(p.x, y + 0.86, p.z));
      }
      fans.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    }
    if (flashT > 0) { flashT = Math.max(0, flashT - dt); flash.intensity = flashT > 0.35 ? 400 : 0; }
    sparks.update(dt);
    updateCamera(dt, time);
    shell.updateTaskLabels(camera);
  }
  const loop = createLoop(shell, camera, scene, simulate, (w, h) => { scaleU.value = particleScaleFor(renderer, camera, h); });

  loadGLTF(loader, ATHLETE_URL).then(gltf => {
    if (loop.destroyed) return;
    clips = gltf.animations;
    dressAthlete(gltf.scene, YOU_COLOR);
    athlete = makeCharacter(scene, gltf.scene, clips, ATHLETE_H);
    rigAthlete(athlete, '#fbbf24', '1');
    play(athlete, 'Idle', { fade: 0 });
    shell.loadingEl.hidden = true;
    loop.setReady();
    if (latestState) applyState(latestState);
    loop.start();
  }).catch(err => {
    console.error('Sprint 3D: could not load the athlete', err);
    shell.loadingEl.textContent = 'Couldn’t load the 3D athlete. Switch the scene to 2D for the Sprint Track.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (athlete) applyState(state);
    },
    pause: loop.stop,
    resume: loop.start,
    destroy() { loop.destroy(container); },
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) simulate(1 / 30); },
      get state() {
        return {
          ready: !!athlete, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)),
          walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, hurdles: w.foes.length, down: w.foes.filter(f => f.fall >= 1).length, open: !!w.open })),
          tape: tapeHalves[0].swing, rivals: rivals.count(), ghost: ghost ? ghost.holder.visible : false,
          label: shell.root.getAttribute('aria-label'),
        };
      },
    },
  };
}
