// ── JOURNEY 3D: MOUNTAIN STAGE ("The Summit", WebGL / three.js) ──────────
// A low-poly mountain: a meadow of pines at the foot, rock higher up and a
// snow cap, with a dirt trail cut into the slope in switchbacks all the way
// to the summit. You're a hiker (rucksack, beanie, walking pole), and the
// follow camera stays just behind you, so you see the trail ahead and the
// peak beyond. Each task is a pennant by the trail; a task's obstacles are
// boulders fallen across it, which you heave over the edge one by one (they
// roll away down the slope). Finishing every task takes you to the top,
// where you raise the summit flag.
//
// Loaded on demand by journeyGame.js ("mountain3d"), which falls back to the
// 2D Mountain without WebGL. Same sync() contract as the other 3D stages.
// The hiker is the KayKit Knight (CC0) re-dressed in code.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  createShell, createLoop, makeCanvasTexture, seededRandom, softDotTexture, Particles, particleScaleFor,
  loadGLTF, makeCharacter, play, finished, recolorCharacter, findBone, attachToBone,
  checkpointFracOf, progressToPathFracSmooth, angleLerp, createWalker,
  stageTasks, layoutSignature, nameTagSprite, pickFoes, resolveChanges, tagText, peekCamera, createRivals,
} from './journey3dKit.js';

const HIKER_URL = '/assets/models/Knight.glb';
const CLEARED = 'CLEARED!';

export function createMountain3D(container) {
  const shell = createShell(container, {
    label: 'Mountain Journey in 3D', background: '#9fd3f2', loadingText: 'Packing the rucksack…',
    winTitle: 'Summit!', winText: 'You made it to the top', winFill: '#ffffff', winEdge: '#ea580c',
  });
  const { renderer, reduceMotion, timers } = shell;
  renderer.toneMappingExposure = 1.1;
  const canvasTexture = makeCanvasTexture(renderer);
  const rnd = seededRandom(83);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;

  // ── The land (metres) ─────────────────────────────────────────────────
  // One big peak at PEAK, smooth at the top and steepest halfway down,
  // roughened with a few sine ridges (more of them higher up) over a gently
  // rolling meadow.
  const PEAK = V(0, 0, -50), HS = 42, RAD = 64, HIKER_H = 1.7, WALK_SPEED = 3.1;
  function baseHeight(x, z) {
    const u = Math.min(1, Math.hypot(x - PEAK.x, z - PEAK.z) / RAD);
    const h0 = HS * (1 - u) * (1 - u) * (1 + 2 * u);
    const rug = (0.25 + h0 / HS) * (1.1 * Math.sin(x * 0.17 + 1.3) * Math.sin(z * 0.13 + 0.4) + 0.6 * Math.sin(x * 0.31 - z * 0.23 + 2.1));
    const meadow = 0.5 * Math.sin(x * 0.07) * Math.cos(z * 0.08 + 0.5);
    return h0 + rug * (1 - smooth(0, 8, -h0 + 8) * 0.6) + meadow;
  }

  // ── The trail: switchbacks from the meadow to the summit ──────────────
  const KNOTS = [[2, 22], [-12, 14], [13, 6], [-14, -3], [12, -12], [-11, -21], [9, -29], [-8, -36], [6, -42], [-3, -46.5], [0, -49.2]];
  const flat = new THREE.CatmullRomCurve3(KNOTS.map(([x, z]) => V(x, 0, z)), false, 'catmullrom', 0.5);
  const TRAIL_N = 240;
  const trailPts = flat.getSpacedPoints(TRAIL_N).map(p => p.setY(baseHeight(p.x, p.z)));
  // A few passes of smoothing so the climb is steady rather than bumpy.
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < trailPts.length - 1; i++) trailPts[i].y = (trailPts[i - 1].y + 2 * trailPts[i].y + trailPts[i + 1].y) / 4;
  }
  const curve = new THREE.CatmullRomCurve3(trailPts, false, 'catmullrom', 0.5);
  const curveLen = curve.getLength();
  const checkpointFrac = (i, n) => checkpointFracOf(i, n);
  const wallFrac = i => checkpointFrac(i, tasks.length) - 0.03;
  const boulderStopFrac = i => wallFrac(i) - 2.4 / curveLen;
  const sideAt = u => { const t = curve.getTangentAt(THREE.MathUtils.clamp(u, 0, 1)); return V(-t.z, 0, t.x).normalize(); };
  // Which side of the trail at u is downhill (+1 along sideAt, or -1).
  const downhillAt = u => { const p = curve.getPointAt(u), s = sideAt(u); return baseHeight(p.x + s.x * 4, p.z + s.z * 4) < baseHeight(p.x - s.x * 4, p.z - s.z * 4) ? 1 : -1; };
  // Nearest trail sample to a spot (in plan): its height and distance.
  function nearTrail(x, z) {
    let best = Infinity, y = 0;
    for (let i = 0; i < trailPts.length; i++) {
      const p = trailPts[i], d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best) { best = d; y = p.y; }
    }
    return { d: Math.sqrt(best), y };
  }
  // The ground, with the trail cut level into the slope.
  const CUT = 1.7, CUT_EDGE = 3.6;
  function groundAt(x, z) {
    const h = baseHeight(x, z), t = nearTrail(x, z);
    return t.d > CUT_EDGE ? h : THREE.MathUtils.lerp(t.y, h, smooth(CUT, CUT_EDGE, t.d));
  }

  // ── Scene, sky, light ─────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = canvasTexture(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#4f9fdc'); grd.addColorStop(0.5, '#8fcaf0'); grd.addColorStop(0.8, '#cfe9f8'); grd.addColorStop(1, '#eaf6fb');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog('#cfe6f4', 110, 300);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 700);
  camera.position.set(10, 12, 40);
  scene.add(new THREE.HemisphereLight('#dbeeff', '#5a6b3a', 1.05));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.5);
  sun.position.set(40, 60, 40); sun.target.position.set(0, 10, -15);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 10, far: 200 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // ── Terrain: low-poly, coloured by height (meadow, rock, snow) ─────────
  {
    const SIZE = 220, SEG = 150;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -30);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, groundAt(pos.getX(i), pos.getZ(i)));
    const g2 = geo.toNonIndexed();
    g2.computeVertexNormals();
    const p2 = g2.attributes.position, n2 = g2.attributes.normal;
    const cols = new Float32Array(p2.count * 3);
    const GRASS = [new THREE.Color('#6fae45'), new THREE.Color('#7fbd4f'), new THREE.Color('#5f9e3a')];
    const ROCK = [new THREE.Color('#8a8f99'), new THREE.Color('#9aa0a8'), new THREE.Color('#7c8089')];
    const SNOW = new THREE.Color('#f4f8fc'), DIRT = new THREE.Color('#b99b6b');
    for (let f = 0; f < p2.count; f += 3) {
      // one colour per face, for the faceted look
      const cx = (p2.getX(f) + p2.getX(f + 1) + p2.getX(f + 2)) / 3, cz = (p2.getZ(f) + p2.getZ(f + 1) + p2.getZ(f + 2)) / 3;
      const cy = (p2.getY(f) + p2.getY(f + 1) + p2.getY(f + 2)) / 3, steep = 1 - n2.getY(f);
      const jitter = Math.sin(cx * 1.7 + cz * 2.3) * 0.5 + 0.5;
      const snowLine = HS * 0.7 + Math.sin(cx * 0.4) * 1.6 + Math.cos(cz * 0.5) * 1.2;
      let c;
      if (cy > snowLine && steep < 0.45) c = SNOW;
      else if (cy > 12 + jitter * 4 || steep > 0.42) c = ROCK[Math.floor(jitter * 2.99)];
      else c = GRASS[Math.floor(jitter * 2.99)];
      if (nearTrail(cx, cz).d < CUT + 0.4) c = DIRT;
      for (let k = 0; k < 3; k++) { cols[(f + k) * 3] = c.r; cols[(f + k) * 3 + 1] = c.g; cols[(f + k) * 3 + 2] = c.b; }
    }
    g2.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const land = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    land.receiveShadow = true; land.castShadow = true;
    scene.add(land);
  }
  // Distant ranges, paler with distance, under the fog.
  {
    const far = new THREE.MeshStandardMaterial({ color: '#8ea6bd', flatShading: true, roughness: 1 });
    const cap = new THREE.MeshStandardMaterial({ color: '#f1f5f9', flatShading: true, roughness: 1 });
    [[-120, -170, 38, 70], [-55, -200, 52, 85], [40, -190, 46, 75], [115, -160, 34, 60], [-170, -110, 30, 55], [170, -100, 32, 60], [0, -240, 60, 100]].forEach(([x, z, h, r]) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 1), far);
      m.position.set(x, h / 2 - 2, z); m.rotation.y = rnd() * Math.PI; scene.add(m);
      const c = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, h * 0.3, 7, 1), cap);
      c.position.set(x, h - 2 - h * 0.15 + 0.2, z); c.rotation.y = m.rotation.y; scene.add(c);
    });
  }

  // ── The trail surface and the gold line of ground covered ──────────────
  function ribbon(points, width, lift) {
    const pos = [], idx = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p = points[i], q = points[Math.min(n - 1, i + 1)], o = points[Math.max(0, i - 1)];
      const t = q.clone().sub(o).setY(0).normalize();
      const side = V(-t.z, 0, t.x);
      pos.push(p.x + side.x * width / 2, p.y + lift, p.z + side.z * width / 2, p.x - side.x * width / 2, p.y + lift, p.z - side.z * width / 2);
      if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  const runPts = Array.from({ length: 321 }, (_, i) => curve.getPointAt(i / 320));
  const dirtTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#cfb486'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(90,60,30,0.12)' : 'rgba(255,240,210,0.14)'; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 2, 2); }
  }, { repeat: true });
  const trailMesh = new THREE.Mesh(ribbon(runPts, 2.1, 0.06), new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
  trailMesh.receiveShadow = true; scene.add(trailMesh);
  const progressLine = new THREE.Mesh(ribbon(runPts, 0.24, 0.1), new THREE.MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }));
  progressLine.geometry.setDrawRange(0, 0); scene.add(progressLine);
  let progressShown = 0, progressTarget = 0;

  // ── Pines, rocks, a camp, clouds ──────────────────────────────────────
  {
    const spots = [];
    for (let k = 0; k < 900 && spots.length < 300; k++) {
      const x = (rnd() - 0.5) * 170, z = -75 + rnd() * 110;
      const h = baseHeight(x, z);
      if (h > 18 || nearTrail(x, z).d < 4.2) continue;
      if (Math.hypot(x - 12, z - 24) < 7) continue; // the camp
      spots.push([x, z, groundAt(x, z), 0.75 + rnd() * 0.7]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 1.2, 5), new THREE.MeshStandardMaterial({ color: '#6b4f2a', roughness: 1 }), spots.length);
    const lower = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, 2.8, 7), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), spots.length);
    const upper = new THREE.InstancedMesh(new THREE.ConeGeometry(1.05, 2.2, 7), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), spots.length);
    const GREENS = ['#1f6f4a', '#26845a', '#2f7d3f', '#3a8f4a'];
    spots.forEach(([x, z, y, s], i) => {
      tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * Math.PI); tmpS.setScalar(s);
      trunk.setMatrixAt(i, tmpM.compose(V(x, y + 0.6 * s, z), tmpQ, tmpS));
      lower.setMatrixAt(i, tmpM.compose(V(x, y + 2.2 * s, z), tmpQ, tmpS));
      upper.setMatrixAt(i, tmpM.compose(V(x, y + 3.6 * s, z), tmpQ, tmpS));
      const c = GREENS[i % GREENS.length];
      lower.setColorAt(i, tmpC.set(c)); upper.setColorAt(i, tmpC.set(c).offsetHSL(0, 0, 0.05));
    });
    [trunk, lower, upper].forEach(m => { m.castShadow = true; m.receiveShadow = true; scene.add(m); });

    const rocks = [];
    for (let k = 0; k < 500 && rocks.length < 90; k++) {
      const x = (rnd() - 0.5) * 120, z = -70 + rnd() * 80;
      const h = baseHeight(x, z);
      if (h < 6 || nearTrail(x, z).d < 3) continue;
      rocks.push([x, z, groundAt(x, z), 0.4 + rnd() * 1.4]);
    }
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), rocks.length);
    rocks.forEach(([x, z, y, s], i) => {
      tmpQ.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)); tmpS.set(s, s * 0.7, s);
      rockMesh.setMatrixAt(i, tmpM.compose(V(x, y + s * 0.2, z), tmpQ, tmpS));
      rockMesh.setColorAt(i, tmpC.set('#a3a8b0').offsetHSL(0, 0, (rnd() - 0.5) * 0.12));
    });
    rockMesh.castShadow = true; rockMesh.receiveShadow = true; scene.add(rockMesh);

    // Base camp by the start: a tent, a log pile and a signpost.
    const camp = new THREE.Group();
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.9, 4), new THREE.MeshStandardMaterial({ color: '#dc2626', flatShading: true, roughness: 0.8 }));
    tent.position.y = 0.95; tent.rotation.y = Math.PI / 4; camp.add(tent);
    for (let k = 0; k < 3; k++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 6), new THREE.MeshStandardMaterial({ color: '#8b5a2b' }));
      log.rotation.z = Math.PI / 2; log.position.set(2.3, 0.16 + (k === 2 ? 0.28 : 0), k === 2 ? 0 : (k ? 0.17 : -0.17)); camp.add(log);
    }
    camp.position.set(12, groundAt(12, 24), 24);
    camp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(camp);
    const sign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), new THREE.MeshStandardMaterial({ color: '#7c5a32' }));
    post.position.y = 0.8; sign.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.38, 0.06), new THREE.MeshStandardMaterial({
      map: canvasTexture(256, 72, (g, w, h) => { g.fillStyle = '#a8794a'; g.fillRect(0, 0, w, h); g.fillStyle = '#3b2a17'; g.font = '900 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SUMMIT ▲', w / 2, h / 2 + 2); }),
    }));
    board.position.set(0.3, 1.4, 0); sign.add(board);
    const s0 = curve.getPointAt(0.012), side0 = sideAt(0.012);
    sign.position.copy(s0).addScaledVector(side0, -1.9);
    sign.rotation.y = Math.atan2(side0.x, side0.z);
    sign.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(sign);
  }
  const glowTex = softDotTexture(canvasTexture);
  const clouds = [];
  [[-30, 34, -60, 16], [26, 30, -40, 12], [-8, 40, -80, 20], [45, 24, -70, 14], [-50, 22, -30, 12]].forEach(([x, y, z, s]) => {
    const g = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }));
      puff.position.set((rnd() - 0.5) * s, (rnd() - 0.5) * s * 0.18, (rnd() - 0.5) * s * 0.4);
      puff.scale.setScalar(s * (0.45 + rnd() * 0.35));
      g.add(puff);
    }
    g.position.set(x, y, z); scene.add(g); clouds.push({ g, x, speed: 0.4 + rnd() * 0.5 });
  });

  // ── The summit: a cairn and the flagpole ───────────────────────────────
  const SUMMIT = curve.getPointAt(1);
  const summit = new THREE.Group();
  summit.position.copy(SUMMIT);
  {
    const cairn = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: '#7c8089', flatShading: true }));
    cairn.scale.set(1, 0.55, 1); cairn.position.set(1.6, 0.35, -0.6); summit.add(cairn);
    const top = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), cairn.material);
    top.scale.set(1, 0.7, 1); top.position.set(1.6, 0.95, -0.6); summit.add(top);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 4.6, 8), new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.4, roughness: 0.4 }));
    pole.position.set(1.6, 3.3, -0.6); summit.add(pole);
    summit.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  const FLAG_W = 1.9, FLAG_H = 1.2;
  const flagGeo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 12, 6);
  flagGeo.translate(FLAG_W / 2, -FLAG_H / 2, 0);
  const flagRest = flagGeo.attributes.position.array.slice();
  const summitFlag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: '#f97316', side: THREE.DoubleSide, roughness: 0.7 }));
  summitFlag.castShadow = true;
  summit.add(summitFlag);
  const FLAG_LOW = 1.75, FLAG_TOP = 5.55;
  let flagRaise = 0, flagRaising = false;
  const placeFlag = () => summitFlag.position.set(1.6 + 0.07, FLAG_LOW + (FLAG_TOP - FLAG_LOW) * flagRaise, -0.6);
  placeFlag();
  scene.add(summit);

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
  function dust(at, n = 26) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.5, rnd() - 0.5).normalize().multiplyScalar(1.5 + rnd() * 2);
      sparks.emit({ pos: at.clone().add(rand3(0.8)), vel: d, life: 1 + rnd() * 0.8, size: [0.5, 0.9], color: ['#d6c3a0', '#efe6d4'], gravity: -0.2, drag: 1.6 });
    }
  }
  const CONFETTI = ['#ef4444', '#ffffff', '#fde047', '#22c55e', '#3b82f6', '#f97316'];
  function confetti(at, n = 140) {
    if (reduceMotion || !celebrationsOn) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, 0.6 + rnd(), rnd() - 0.5).normalize().multiplyScalar(5 + rnd() * 4);
      sparks.emit({ pos: at.clone().add(rand3(1)), vel: d, life: 2 + rnd() * 1.2, size: [0.35, 0.2], color: [CONFETTI[i % CONFETTI.length]], gravity: 4, drag: 1.4 });
    }
  }

  // ── Pennants (one per task), on the downhill edge of the trail ─────────
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 96, (g, w, h) => {
      g.fillStyle = bg; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 14); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
      g.fillStyle = fg; g.font = '900 62px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 4);
    });
  }
  const STATUS = { done: ['✓', '#22c55e', '#052e16', '#16a34a'], next: [null, '#fbbf24', '#1b2234', '#f59e0b'], pending: [null, '#ffffff', '#1b2234', '#3b82f6'] };
  const pennantGeo = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0.95, -0.28, 0), V(0, -0.56, 0)]);
  pennantGeo.computeVertexNormals();
  const flags = [];
  function buildFlags() {
    flags.forEach(f => scene.remove(f.group));
    flags.length = 0;
    tasks.forEach((t, i) => {
      const u = checkpointFrac(i, tasks.length);
      const p = curve.getPointAt(u), side = sideAt(u), down = downhillAt(u);
      const group = new THREE.Group();
      group.position.copy(p).addScaledVector(side, down * 1.45);
      const tan = curve.getTangentAt(u);
      group.rotation.y = Math.atan2(-tan.x, -tan.z); // facing you as you come up
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.1, 6), new THREE.MeshStandardMaterial({ color: '#8b5a2b' }));
      pole.position.y = 1.05; pole.castShadow = true; group.add(pole);
      const pennant = new THREE.Mesh(pennantGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 }));
      pennant.position.set(0.03, 2.08, 0); pennant.castShadow = true; group.add(pennant);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.47), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }));
      board.position.set(0, 1.12, 0.05); group.add(board);
      const stones = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color: '#8b9099', flatShading: true }));
      stones.scale.set(1, 0.5, 1); stones.position.y = 0.08; group.add(stones);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.78, 40), new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; group.add(ring);
      scene.add(group);
      flags.push({ group, board, pennant, ring, pop: 0, status: '', phase: rnd() * 6 });
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
      const [txt, bg, fg, cloth] = STATUS[status];
      if (f.board.material.map) f.board.material.map.dispose();
      f.board.material.map = badgeTexture(txt || String(i + 1), bg, fg);
      f.board.material.needsUpdate = true;
      f.pennant.material.color.set(cloth);
      f.ring.visible = status === 'next';
    });
  }

  // ── Boulders: one per obstacle point, fallen across the trail ──────────
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6157'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  const boulderMat = new THREE.MeshStandardMaterial({ color: '#b3a58f', flatShading: true, roughness: 1 });
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
        const u = u0 + (k * 1.5) / curveLen;
        const p = curve.getPointAt(u), side = sideAt(u), down = downhillAt(u);
        const r = 0.55 + rnd() * 0.25;
        const g = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), boulderMat);
        g.scale.set(1, 0.85, 1.1);
        const at = p.clone().addScaledVector(side, (k % 2 ? 0.45 : -0.45)).setY(p.y + r * 0.75);
        g.position.copy(at); g.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        g.castShadow = true; scene.add(g);
        const roll = side.clone().multiplyScalar(down); // where it goes when heaved off
        const gone = owners[k].resolved;
        if (gone) g.visible = false;
        return { g, u, at, roll, owner: owners[k].id, ticked: gone, fall: gone ? 1 : 0, falling: false };
      });
      const at = curve.getPointAt(u0 + ((n - 1) * 0.75) / curveLen);
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.copy(at).add(V(0, 2.2, 0)); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
      tag.position.copy(at).add(V(0, 2.8, 0)); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.95, 48), new THREE.MeshBasicMaterial({ color: '#ff6157', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(at).add(V(0, 0.12, 0)); scene.add(ring);
      const w = { taskIndex: i, foes, lock, tag, ring, at, baseY: at.y + 2.2, cleared: !!t.done, clearing: false, t: t.done ? 99 : 0, open: !t.foes, fade: t.done || !t.foes ? 1 : 0 };
      if (w.cleared) foes.forEach(f => { f.fall = 1; f.g.visible = false; });
      if (w.fade) lock.visible = tag.visible = ring.visible = false;
      walls.push(w);
    });
  }
  function clearWall(w) { if (w.cleared) return; w.cleared = true; w.t = 0; notify(); }
  function resetBoulder(f) { f.fall = 0; f.falling = false; f.g.visible = true; f.g.position.copy(f.at); }
  function restoreWall(w) {
    w.cleared = false; w.clearing = false; w.t = 0;
    w.foes.forEach(f => { if (!f.ticked) resetBoulder(f); });
  }
  // Heaved over the edge: it rolls off the trail and down the slope.
  function knock(f) {
    if (f.falling || f.fall >= 1) return;
    f.falling = true;
    dust(f.g.position.clone(), 22);
  }
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  // An obstacle ticked off on its own: you walk up to its boulders and push
  // them off one by one (or, unticked, they're back).
  function applyResolves(changes) {
    const engaging = [];
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.at.clone().add(V(0, 3.2, 0)) : curve.getPointAt(wallFrac(c.index)).add(V(0, 3.2, 0));
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
          if (!w.cleared) resetBoulder(f);
        }
      });
      if (!engagedHere) now();
    });
    walls.forEach(w => { w.open = !tasks[w.taskIndex].foes; });
    new Set(changes.map(c => c.index)).forEach(i => { const w = walls.find(x => x.taskIndex === i); if (w) retagWall(w); });
    const byWall = new Map();
    engaging.forEach(e => { if (!byWall.has(e.w)) byWall.set(e.w, []); byWall.get(e.w).push(e); });
    byWall.forEach((items, w) => walker.engage(w.taskIndex, near => {
      if (near) play(hiker, 'Interact', { fade: 0.15, once: true, timeScale: 1.2 });
      items.forEach((e, k) => timers.push(setTimeout(() => knock(e.f), (near ? 450 : 0) + k * 420)));
      items.filter(e => e.label).forEach((e, k) => timers.push(setTimeout(e.label, k * 450 + (near ? 500 : 0))));
      peek.at.copy(w.at); peek.t = 3.4;
    }, 0.8 + 0.42 * items.length));
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      w.foes.forEach(f => {
        if (!f.falling) return;
        f.fall = Math.min(1, f.fall + dt * 0.8);
        const k = f.fall;
        // out over the edge, then dropping away down the slope, tumbling
        f.g.position.copy(f.at).addScaledVector(f.roll, k * 7).add(V(0, -k * k * 6 + Math.sin(k * Math.PI) * 0.4, 0));
        f.g.rotateOnWorldAxis(V(-f.roll.z, 0, f.roll.x), dt * 6);
        if (f.fall >= 1) { f.falling = false; f.g.visible = false; }
      });
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.75, 0, 1);
      w.lock.material.opacity = w.tag.material.opacity = 1 - w.fade;
      w.ring.material.opacity = (shut ? 0.35 + 0.25 * Math.sin(time * 4) : 0.55) * (1 - w.fade);
      w.lock.visible = w.tag.visible = w.ring.visible = w.fade < 1;
      if (shut) w.lock.position.y = w.baseY + Math.sin(time * 2.2) * 0.08;
    });
  }
  const wallPause = w => 0.5 + 0.42 * w.foes.filter(f => f.fall < 1).length;
  // Boulders on a cleared stretch go over the edge as you reach them.
  function clearAhead(frac) {
    walls.forEach(w => {
      if (!w.cleared && !w.open) return;
      w.foes.forEach(f => {
        if (f.fall >= 1 || f.falling) return;
        const d = (f.u - frac) * curveLen;
        if (d < 1.4) {
          knock(f);
          if (hiker.current !== hiker.actions.Interact) play(hiker, 'Interact', { fade: 0.12, once: true, timeScale: 1.4 });
        }
      });
    });
  }

  // ── The hiker ─────────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  let hiker = null, clips = [];
  const YOU_COLOR = '#2563eb';
  function dressHiker(obj, jacket) {
    ['Knight_Helmet', 'Knight_Cape', '1H_Sword', 'Badge_Shield'].forEach(n => { const o = obj.getObjectByName(n); if (o) o.removeFromParent(); });
    const kit = new THREE.Color(jacket), hsl = {};
    kit.getHSL(hsl);
    // armour → the jacket; leather → brown walking trousers and boots
    recolorCharacter(obj, (h, s, l) => {
      if (s < 0.16 && l > 0.16 && l < 0.86) return [hsl.h * 360, Math.max(0.55, hsl.s), 0.28 + l * 0.25];
      if (h > 12 && h < 45 && s > 0.3 && l < 0.6) return [28, 0.35, 0.18 + l * 0.2];
      if ((h > 340 || h < 12) && s > 0.4) return [28, 0.3, 0.3];
      return null;
    });
  }
  // A beanie with a bobble, a rucksack with a bedroll, and a walking pole.
  function rigHiker(ch, color) {
    const obj = ch.obj;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const H = box.max.y - box.min.y;
    const head = findBone(obj, 'head');
    if (head) {
      const hp = new THREE.Vector3(); head.getWorldPosition(hp);
      const top = box.max.y - hp.y;
      const hat = new THREE.Group();
      hat.name = 'beanie';
      const capMat = new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.9 });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(top * 0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
      cap.scale.set(1.08, 0.92, 1.08); hat.add(cap);
      const brim = new THREE.Mesh(new THREE.TorusGeometry(top * 0.5, top * 0.075, 6, 24), new THREE.MeshStandardMaterial({ color: '#f8fafc' }));
      brim.rotation.x = Math.PI / 2; brim.scale.set(1.08, 1.08, 1); hat.add(brim);
      const bobble = new THREE.Mesh(new THREE.SphereGeometry(top * 0.15, 10, 8), brim.material);
      bobble.position.y = top * 0.47; hat.add(bobble);
      hat.traverse(o => { if (o.isMesh) o.castShadow = true; });
      attachToBone(obj, head, hat, V(hp.x, hp.y + top * 0.56, hp.z - top * 0.03));
    }
    const chest = findBone(obj, 'chest');
    if (chest) {
      const cp = new THREE.Vector3(); chest.getWorldPosition(cp);
      const pack = new THREE.Group();
      pack.name = 'rucksack';
      const bagMat = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.85 });
      const bag = new THREE.Mesh(new THREE.BoxGeometry(H * 0.26, H * 0.3, H * 0.15), bagMat);
      pack.add(bag);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(H * 0.27, H * 0.06, H * 0.16), new THREE.MeshStandardMaterial({ color: '#92400e' }));
      lid.position.y = H * 0.16; pack.add(lid);
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(H * 0.18, H * 0.1, H * 0.04), lid.material);
      pocket.position.set(0, -H * 0.05, -H * 0.09); pack.add(pocket);
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.045, H * 0.045, H * 0.3, 10), new THREE.MeshStandardMaterial({ color: color }));
      roll.rotation.z = Math.PI / 2; roll.position.y = H * 0.22; pack.add(roll);
      pack.traverse(o => { if (o.isMesh) o.castShadow = true; });
      attachToBone(obj, chest, pack, V(cp.x, cp.y - H * 0.02, cp.z - H * 0.13));
    }
    const hand = findBone(obj, 'handslot.r');
    if (hand) {
      const hp = new THREE.Vector3(); hand.getWorldPosition(hp);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.012, H * 0.012, H * 0.72, 6), new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.6, roughness: 0.3 }));
      pole.name = 'pole';
      pole.castShadow = true;
      attachToBone(obj, hand, pole, V(hp.x, hp.y - H * 0.2, hp.z + H * 0.02));
    }
  }

  // ── Walking the trail ──────────────────────────────────────────────────
  const walker = createWalker({
    curve, speed: WALK_SPEED, accel: 5, brakeDecel: 5, reduceMotion, getTasks: () => tasks, walls,
    hooks: {
      stopFrac: boulderStopFrac, wallPause,
      place(frac, moving) {
        const u = THREE.MathUtils.clamp(frac, 0, 1);
        const p = curve.getPointAt(u);
        hiker.holder.position.set(p.x, p.y + 0.04, p.z);
        hiker.holder.rotation.y = P.heading;
        progressTarget = u;
        if (moving) clearAhead(u);
      },
      runAnim(k) { if (hiker.current === hiker.actions.Interact && hiker.current.isRunning()) return; play(hiker, 'Walking_A', { fade: 0.25, timeScale: Math.max(0.9, k * 1.75) }); },
      idleAnim(pause, tick) {
        if (tick) { if (finished(hiker)) play(hiker, 'Idle', { fade: 0.4 }); return; }
        if (pause && hiker.current !== hiker.actions.Walking_A) return;
        play(hiker, 'Idle', { fade: 0.3 });
      },
      onFlag(i, t) {
        const f = flags[i];
        if (!f) return;
        f.pop = 1;
        sparkle(f.group.position.clone().add(V(0, 2.1, 0)), 46, ['#86efac', '#ffffff', '#fde047'], 3.4);
        if (P.mode !== 'finale') play(hiker, 'Cheer', { fade: 0.2, once: true, timeScale: 1.3 });
        shell.spawnTaskLabel(f.group.position.clone().add(V(0, 3, 0)), t.title);
      },
      clearWall, restoreWall,
      startFinale, undoFinale: undoVictory, updateFinale, updateVictory,
    },
  });
  const P = walker.P;

  // ── Finale: the last climb, and up goes the flag ───────────────────────
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  const STAND = SUMMIT.clone().add(V(0.4, 0, 0.6)); // where you stand by the flagpole
  function startFinale() {
    if (P.won) return;
    P.mode = 'finale'; P.finT = 0;
    P.fin = { u0: P.frac, steps: new Set() };
    if (reduceMotion) { settleWon(); victory(); }
  }
  function updateFinale(dt) {
    const t = (P.finT += dt), F = P.fin;
    const walkT = Math.max(1.2, ((1 - F.u0) * curveLen) / WALK_SPEED);
    once('go', () => play(hiker, 'Walking_A', { fade: 0.2, timeScale: 1.6 }));
    if (t < walkT) {
      const u = F.u0 + (1 - F.u0) * smooth(0, walkT, t);
      const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      hiker.holder.position.set(p.x, p.y + 0.04, p.z);
      P.heading = angleLerp(P.heading, Math.atan2(tan.x, tan.z), Math.min(1, dt * 6));
      hiker.holder.rotation.y = P.heading;
      progressTarget = u;
    } else {
      once('arrive', () => { progressTarget = 1; play(hiker, 'Interact', { fade: 0.2, once: true }); flagRaising = true; });
      const toPole = Math.atan2(summit.position.x + 1.6 - hiker.holder.position.x, summit.position.z - 0.6 - hiker.holder.position.z);
      P.heading = angleLerp(P.heading, toPole, Math.min(1, dt * 4));
      hiker.holder.rotation.y = P.heading;
    }
    if (flagRaise >= 1) once('flag', () => {
      confetti(SUMMIT.clone().add(V(1.6, 5.5, -0.6)), 200);
      sparkle(SUMMIT.clone().add(V(1.6, 5.5, -0.6)), 70, ['#ffffff', '#fde047', '#f97316'], 4);
      play(hiker, 'Cheer', { fade: 0.3 });
    });
    if (flagRaise >= 1 && P.fin.steps.has('flag') && t > walkT + 3.2) once('win', victory);
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
    const toCam = Math.atan2(camera.position.x - hiker.holder.position.x, camera.position.z - hiker.holder.position.z);
    hiker.holder.rotation.y = angleLerp(hiker.holder.rotation.y, toCam, Math.min(1, dt * 2));
    if (P.vicT > 6 && hiker.current === hiker.actions.Cheer) play(hiker, 'Idle', { fade: 0.5 });
    if (!reduceMotion && celebrationsOn && rnd() < dt * 1.2) confetti(SUMMIT.clone().add(V((rnd() - 0.5) * 6, 5, (rnd() - 0.5) * 6)), 40);
  }
  function settleWon() {
    const p = curve.getPointAt(1);
    hiker.holder.position.set(p.x, p.y + 0.04, p.z);
    flagRaise = 1; flagRaising = false; placeFlag();
    P.fin = { steps: new Set(['go', 'arrive', 'flag', 'win']) };
    P.won = true; P.mode = 'victory'; P.vicT = 99; progressTarget = 1;
    play(hiker, 'Idle', { fade: 0 });
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; shell.winEl.hidden = true;
    flagRaise = 0; flagRaising = false; placeFlag();
    if (hiker) play(hiker, 'Idle', { fade: 0.2 });
  }
  function updateFlag(dt, time) {
    if (flagRaising) { flagRaise = Math.min(1, flagRaise + dt * 0.45); if (flagRaise >= 1) flagRaising = false; placeFlag(); }
    // the cloth ripples in the wind, more the higher it is
    const a = flagGeo.attributes.position, amp = 0.05 + flagRaise * 0.14;
    for (let i = 0; i < a.count; i++) {
      const x = flagRest[i * 3];
      a.setZ(i, Math.sin(x * 3.2 - time * 5) * amp * (x / FLAG_W));
    }
    a.needsUpdate = true;
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  // Follow: just behind and above the hiker, looking up the trail, so you
  // see the way ahead and the peak. Kept above the slope.
  const cam = { look: V(0, 0, 0) };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  const peek = { at: new THREE.Vector3(), t: 0 };
  // Behind you, turned partly towards the summit: on a switchback you're
  // seen from behind and a little below, with the peak up ahead.
  function followView(ap, at, look) {
    const dir = V(Math.sin(P.heading), 0, Math.cos(P.heading));
    const toPeak = SUMMIT.clone().sub(ap).setY(0);
    const near = toPeak.length();
    toPeak.normalize();
    const back = dir.multiplyScalar(0.7).addScaledVector(toPeak, near > 6 ? 0.3 : 0).normalize();
    at.copy(ap).addScaledVector(back, -8).add(V(0, 6.2, 0));
    look.copy(ap).addScaledVector(back, 4.5).add(V(0, 2.1, 0));
  }
  function keepAboveGround(v, clear = 1.4) { const g = baseHeight(v.x, v.z) + clear; if (v.y < g) v.y = g; return v; }
  function updateCamera(dt, time) {
    const ap = hiker.holder.position;
    let rate = 3, user = null;
    if (P.mode === 'finale' || P.mode === 'victory') {
      // round the summit, with the flag and the view down the mountain
      const a = 0.5 + (P.mode === 'victory' ? Math.sin(time * 0.1) * 0.5 : 0);
      camDesired.copy(ap).add(V(Math.sin(a) * 8.5, 3.4, Math.cos(a) * 8.5)); lookDesired.copy(ap).add(V(0.8, 2.6, -0.3)); rate = 1.4;
    } else if (shell.cam.mode === 'overview') {
      overview(camDesired); lookDesired.set(0, 15, -16);
      user = 'overview';
    } else {
      user = 'follow';
      followView(ap, camDesired, lookDesired);
      peekCamera(peek, ap, camDesired, lookDesired, dt, 8, 3.8, 1.2);
    }
    if (user) shell.camCtl.apply(camDesired, lookDesired, user, dt);
    keepAboveGround(camDesired);
    const k = 1 - Math.exp(-dt * shell.camCtl.rate(rate));
    camera.position.lerp(camDesired, k);
    keepAboveGround(camera.position, 0.8);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
  }
  // The whole mountain from out on the meadow; further back on a tall
  // screen so its width still fits.
  function overview(v) {
    if (camera.aspect >= 1) return v.set(28, 48, 66);
    return v.set(16, 60, 96 + (1 - camera.aspect) * 40);
  }
  function snapCamera() {
    const ap = hiker.holder.position;
    if (shell.cam.mode === 'overview') { overview(camera.position); cam.look.set(0, 15, -16); }
    else { followView(ap, camera.position, cam.look); keepAboveGround(camera.position); }
    camera.lookAt(cam.look);
  }

  // ── Ghost and rivals: hikers beside you on the trail ───────────────────
  let ghost = null;
  function cloneHiker(color, opacity = 1) {
    const obj = SkeletonUtils.clone(hiker.obj);
    const tint = new THREE.Color(color);
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (o.material.color && o.name === 'Knight_Body') o.material.color.lerp(tint, 0.75);
      if (opacity < 1) { o.material.transparent = true; o.material.opacity = opacity; o.material.depthWrite = false; }
      o.castShadow = opacity === 1;
    });
    const hat = obj.getObjectByName('beanie');
    if (hat) hat.children[0].material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: opacity < 1, opacity });
    const holder = new THREE.Group(); holder.add(obj); scene.add(holder);
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {}; clips.forEach(c => { actions[c.name] = mixer.clipAction(c); });
    const ch = { holder, obj, mixer, actions, current: null };
    play(ch, 'Idle', { fade: 0 }); mixer.update(rnd() * 2);
    return ch;
  }
  // a spot on the trail at path fraction u, `side` metres across it
  function onTrail(u, side) {
    const uu = THREE.MathUtils.clamp(u, 0, 1);
    const p = curve.getPointAt(uu);
    return p.addScaledVector(sideAt(uu), THREE.MathUtils.clamp(side, -1.6, 1.6)).add(V(0, 0.04, 0));
  }
  function updateGhost(g) {
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) ghost = cloneHiker('#94a3b8', 0.4);
    const u = THREE.MathUtils.clamp(progressToPathFracSmooth(g.frac, tasks.length), 0, 1);
    ghost.holder.visible = true;
    ghost.holder.position.copy(onTrail(u, 0.9));
    const t = curve.getTangentAt(u); ghost.holder.rotation.y = Math.atan2(t.x, t.z);
  }
  const rivals = createRivals({
    tagSize: 0.5, tagHeight: HIKER_H + 0.7,
    build: color => cloneHiker(color),
    place: (ch, u, side) => {
      ch.holder.position.copy(onTrail(u, side * 0.8));
      const t = curve.getTangentAt(THREE.MathUtils.clamp(u, 0, 1));
      ch.holder.rotation.y = Math.atan2(t.x, t.z);
    },
  });
  let lastRace = null;
  function updateRivals(state) {
    if (state) lastRace = state;
    if (hiker && lastRace) rivals.sync(lastRace.rivals, tasks.length, lastRace.youFrac || 0);
  }

  function notify() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Mountain Journey: ${done} of ${n} tasks done.` : 'Mountain Journey: no tasks yet.';
    const blocked = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= walker.progressToFrac(done, n) + 1e-3);
    if (blocked) text += ` Boulders on the trail: ${tasks[blocked.taskIndex].blocker}.`;
    if (n && done === n) text += P.won ? ' On the summit, flag flying!' : ' Climbing the last stretch to the summit.';
    shell.root.setAttribute('aria-label', text);
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
    hiker.mixer.update(dt);
    walker.update(dt);
    rivals.update(dt);
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
    updateWalls(dt, time);
    updateFlag(dt, time);
    flags.forEach(f => {
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); f.board.scale.setScalar(1 + Math.sin((1 - f.pop) * Math.PI) * 0.35); }
      if (f.ring.visible) f.ring.material.opacity = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4));
      if (!reduceMotion) f.pennant.rotation.y = Math.sin(time * 2.4 + f.phase) * 0.25;
    });
    if (!reduceMotion) clouds.forEach(c => { c.g.position.x = c.x + Math.sin(time * 0.02 * c.speed) * 12; });
    progressShown += (progressTarget - progressShown) * Math.min(1, dt * 6);
    progressLine.geometry.setDrawRange(0, Math.floor(progressShown * 320) * 6);
    sparks.update(dt);
    updateCamera(dt, time);
    shell.updateTaskLabels(camera);
  }
  const loop = createLoop(shell, camera, scene, simulate, (w, h) => { scaleU.value = particleScaleFor(renderer, camera, h); });

  loadGLTF(loader, HIKER_URL).then(gltf => {
    if (loop.destroyed) return;
    clips = gltf.animations;
    dressHiker(gltf.scene, YOU_COLOR);
    hiker = makeCharacter(scene, gltf.scene, clips, HIKER_H);
    rigHiker(hiker, '#22c55e');
    play(hiker, 'Idle', { fade: 0 });
    shell.loadingEl.hidden = true;
    loop.setReady();
    if (latestState) applyState(latestState);
    loop.start();
  }).catch(err => {
    console.error('Mountain 3D: could not load the hiker', err);
    shell.loadingEl.textContent = 'Couldn’t load the 3D hiker. Switch the scene to 2D for the Mountain.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (hiker) applyState(state);
    },
    pause: loop.stop,
    resume: loop.start,
    destroy() { loop.destroy(container); },
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) simulate(1 / 30); },
      get state() {
        return {
          ready: !!hiker, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)),
          walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, boulders: w.foes.length, gone: w.foes.filter(f => f.fall >= 1).length, open: !!w.open })),
          flag: flagRaise, rivals: rivals.count(), ghost: ghost ? ghost.holder.visible : false,
          label: shell.root.getAttribute('aria-label'), trailLength: curveLen,
        };
      },
    },
  };
}
