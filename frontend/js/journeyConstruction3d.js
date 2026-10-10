// ── JOURNEY 3D: CONSTRUCTION STAGE ("The Build Site", WebGL / three.js) ──
// One building goes up, phase by phase, as the project's tasks get done —
// the way a real job runs:
//   1. Planning        a site office, blueprints on the drawing table and a
//                      glowing wireframe of the finished building over the
//                      empty, grassy plot
//   2. Setting out     a surveyor at a theodolite, corner pegs, profile
//                      boards, string lines and paint marking the footprint
//   3. Foundation      the excavator digs out the pit, a rebar mat goes in,
//                      the mixer truck pours and the slab sets
//   4. Superstructure  the tower crane lifts as columns and floor slabs
//                      climb storey by storey, wrapped in scaffolding
//   5. Finishes        brick and glazing close each floor in, the roof goes
//                      on, the scaffolding comes down and the lights come on
//   6. External works  the crane and hoarding go, and lawns, trees, paving,
//                      street lamps, flower beds and parked cars arrive
// A phase tracker shows where the job is, with a banner as each phase
// completes. The builder works around a site road that circles the
// building, stopping at a signboard per task; blockers (barriers, permit
// signs, storms, broken-down trucks, rubble) stand at the signboards until
// they're cleared. The last task is the handover: the ribbon is cut at the
// front door, under fireworks.
//
// Loaded on demand by journeyGame.js (the "Construction 3D" theme), which
// falls back to the 2D Construction stage without WebGL. Same sync()
// contract as the other 3D stages. The builder and the surveyor are the
// KayKit Knight (CC0) dressed in code; everything else is built here.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  createShell, createLoop, makeCanvasTexture, seededRandom, softDotTexture, Particles, particleScaleFor,
  loadGLTF, makeCharacter, play, finished, recolorCharacter, findBone, attachToBone,
  checkpointFracOf, progressToPathFracSmooth, angleLerp, createWalker,
  stageTasks, layoutSignature, nameTagSprite, pickFoes, resolveChanges, tagText, peekCamera,
} from './journey3dKit.js';

const BUILDER_URL = '/assets/models/Knight.glb';
const CLEARED = 'CLEARED!';
const PHASES = [
  { key: 'planning', name: 'Planning', icon: '📐' },
  { key: 'setting-out', name: 'Setting out', icon: '📏' },
  { key: 'foundation', name: 'Foundation', icon: '🧱' },
  { key: 'superstructure', name: 'Superstructure', icon: '🏗️' },
  { key: 'finishes', name: 'Finishes', icon: '🪟' },
  { key: 'external', name: 'External works', icon: '🌳' },
];

export function createConstruction3D(container) {
  const shell = createShell(container, {
    label: 'Construction Journey in 3D', background: '#b5d3ec', loadingText: 'Opening the site…',
    winTitle: 'Handed Over!', winText: 'From plans to keys in hand', winFill: '#fde047', winEdge: '#7c2d12',
  });
  const { renderer, reduceMotion, timers } = shell;
  renderer.toneMappingExposure = 1.0;
  const canvasTexture = makeCanvasTexture(renderer);
  const rnd = seededRandom(47);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
  const tmpV = new THREE.Vector3();
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);
  // 0..1 progress through [a, b] — how far along a piece of the build is
  const span = (a, b, x) => THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;

  // ── The plot and the site road around it ──────────────────────────────
  // The building stands in the middle; the site road starts at the gate
  // (south-east), loops round the plot and finishes at the front door.
  const PLOT = V(0, 0, -4);
  const PATH_XZ = [[16, 30], [22, 14], [23, -4], [17, -20], [4, -27], [-11, -25], [-21, -13], [-22, 3], [-15, 16], [-6, 15], [0, 12]];
  const curve = new THREE.CatmullRomCurve3(PATH_XZ.map(([x, z]) => V(x, 0, z)), false, 'catmullrom', 0.5);
  const curveLen = curve.getLength();
  const PATH_SAMPLES = Array.from({ length: 301 }, (_, i) => curve.getPointAt(i / 300));
  function distToPath(x, z) {
    let d = 1e9;
    for (const p of PATH_SAMPLES) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2);
    return Math.sqrt(d);
  }
  const checkpointFrac = (i, n) => checkpointFracOf(i, n);
  const wallFrac = i => checkpointFrac(i, tasks.length) - 0.03;
  const foeStopFrac = i => wallFrac(i) - 2.4 / curveLen;
  const CHAR_H = 1.6;

  // ── Scene, sky, light ─────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b5d3ec');
  scene.fog = new THREE.Fog('#d9e4ec', 80, 260);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  camera.position.set(-40, 30, 50);
  const hemi = new THREE.HemisphereLight('#eef6ff', '#8a6f4e', 1.3);
  scene.add(hemi);
  const sunDir = V(0.5, 0.8, 0.35).normalize();
  const sun = new THREE.DirectionalLight('#fff3dc', 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 160 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 col = mix(vec3(0.96, 0.9, 0.78), vec3(0.66, 0.82, 0.94), smoothstep(0.0, 0.16, h));
        col = mix(col, vec3(0.32, 0.57, 0.86), smoothstep(0.16, 0.8, h));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(sky);
  const glowTex = softDotTexture(canvasTexture);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2d6', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  sunGlow.position.copy(sunDir).multiplyScalar(420); sunGlow.scale.setScalar(110); scene.add(sunGlow);

  // ── The ground: packed site earth, the grassy plot and the site road ──
  const dirt = canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#c9a77b'; g.fillRect(0, 0, w, w);
    const r = seededRandom(5);
    for (let k = 0; k < 900; k++) {
      const v = r();
      g.fillStyle = v < 0.4 ? 'rgba(150,118,80,0.55)' : v < 0.75 ? 'rgba(226,203,164,0.6)' : 'rgba(120,110,100,0.5)';
      g.fillRect(r() * w, r() * w, 1 + r() * 3, 1 + r() * 3);
    }
  }, { repeat: true });
  dirt.repeat.set(70, 70);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: dirt, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // the untouched plot: a meadow that's stripped away during setting out
  const meadowMat = new THREE.MeshStandardMaterial({ color: '#7fb85e', roughness: 1, transparent: true });
  const meadow = new THREE.Mesh(new THREE.CircleGeometry(15, 40), meadowMat);
  meadow.rotation.x = -Math.PI / 2; meadow.position.set(PLOT.x, 0.03, PLOT.z); meadow.receiveShadow = true; scene.add(meadow);
  function ribbonGeometry(width, samples, lift, offset = 0) {
    const pos = [], uv = [], nrm = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples, p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const side = V(-t.z, 0, t.x).normalize();
      const c = p.clone().addScaledVector(side, offset);
      const a = c.clone().addScaledVector(side, width / 2), b = c.clone().addScaledVector(side, -width / 2);
      pos.push(a.x, lift, a.z, b.x, lift, b.z);
      nrm.push(0, 1, 0, 0, 1, 0);
      uv.push((u * curveLen) / 3, 0, (u * curveLen) / 3, 1);
      if (i < samples) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }
  const gravel = canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#ddd2bf'; g.fillRect(0, 0, w, h);
    const r = seededRandom(9);
    for (let k = 0; k < 500; k++) { const v = 150 + Math.floor(r() * 90); g.fillStyle = `rgb(${v},${v - 6},${v - 18})`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.fillStyle = 'rgba(120,96,70,0.35)'; g.fillRect(0, 12, w, 8); g.fillRect(0, h - 20, w, 8);
  }, { repeat: true });
  const road = new THREE.Mesh(ribbonGeometry(3.8, 420, 0.04), new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
  road.receiveShadow = true; scene.add(road);
  const progressLine = new THREE.Mesh(ribbonGeometry(0.24, 420, 0.06), new THREE.MeshBasicMaterial({ color: '#f97316', transparent: true, opacity: 0.85 }));
  progressLine.geometry.setDrawRange(0, 0); scene.add(progressLine);
  let progressShown = 0, progressTarget = 0;

  // ── Particles: sparkles, dust and rain ────────────────────────────────
  const scaleU = { value: 400 };
  const sparks = new Particles(scene, 1600, { additive: true, map: glowTex, scale: scaleU });
  const dust = new Particles(scene, 900, { additive: false, map: glowTex, scale: scaleU });
  function sparkle(at, n = 40, colors = ['#fff3b0', '#ffffff'], power = 3) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.9 + 0.1, rnd() - 0.5).normalize().multiplyScalar(power * (0.4 + rnd() * 0.8));
      sparks.emit({ pos: at.clone(), vel: d, life: 0.9 + rnd() * 0.8, size: [0.3, 0.05], color: [colors[i % colors.length], '#ffffff'], gravity: 0.5, drag: 2 });
    }
  }
  function dustCloud(at, n = 24, power = 1.6) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      dust.emit({ pos: at.clone().add(rand3(0.8)), vel: V((rnd() - 0.5) * power, rnd() * power * 0.6, (rnd() - 0.5) * power), life: 1.4 + rnd(), size: [0.5, 1.6], color: ['#d8c2a0', '#c9b08a'], alpha: 0.55, drag: 1.5 });
    }
  }
  function confetti(center, n = 160) {
    if (reduceMotion) return;
    const cols = ['#fde047', '#f97316', '#22c55e', '#3b82f6', '#ef4444', '#ffffff'];
    for (let i = 0; i < n; i++) {
      sparks.emit({ pos: center.clone().add(V((rnd() - 0.5) * 3, rnd() * 2, (rnd() - 0.5) * 3)), vel: V((rnd() - 0.5) * 9, 6 + rnd() * 6, (rnd() - 0.5) * 9),
        life: 2.4 + rnd(), size: [0.28, 0.2], color: [cols[i % cols.length], cols[(i + 2) % cols.length]], gravity: 6, drag: 1.2 });
    }
  }

  // ── The site: hoarding, cabins, materials, cones, lights ─────────────
  const yellow = flat('#facc15'), dark = flat('#1f2937'), steelMat = flat('#64748b', { metalness: 0.4 });
  // Perimeter hoarding: a ring of painted panels (they come down during
  // external works), with the low city skyline beyond.
  const hoarding = [];
  {
    const hoardTex = canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = '#eef0f2'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1e3a5f'; g.fillRect(0, h - 10, w, 10);
      g.fillStyle = '#f59e0b'; g.font = '900 17px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.fillText('BUILDING YOUR FUTURE', w / 2, 32);
    }, { repeat: true });
    const panelSide = flat('#d1d5db'), panelFace = new THREE.MeshStandardMaterial({ map: hoardTex });
    const R = 42;
    for (let k = 0; k < 44; k++) {
      const a = (k / 44) * Math.PI * 2, x = Math.cos(a) * R, z = Math.sin(a) * R * 0.95 + PLOT.z;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.6, 0.15), [panelSide, panelSide, panelSide, panelSide, panelFace, panelFace]);
      panel.position.set(x, 1.3, z); panel.lookAt(PLOT.x, 1.3, PLOT.z); panel.receiveShadow = true; scene.add(panel);
      hoarding.push({ panel, k });
    }
    for (let k = 0; k < 46; k++) {
      const a = (k / 46) * Math.PI * 2 + rnd() * 0.05, r = 95 + rnd() * 40;
      const w = 8 + rnd() * 8, h = 10 + rnd() * 34;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), flat(['#a9b8c8', '#c3cdd6', '#94a3b8', '#b8c4cf'][k % 4]));
      b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); scene.add(b);
    }
  }
  const placed = [];
  const clearOf = (x, z, r) => placed.every(p => Math.hypot(p.x - x, p.z - z) > p.r + r);
  const reserve = (x, z, r) => placed.push({ x, z, r });
  // anything outside the road ring and inside the hoarding
  function siteSpot(minFromPlot, maxFromPlot, r) {
    for (let tries = 0; tries < 400; tries++) {
      const a = rnd() * Math.PI * 2, d = minFromPlot + rnd() * (maxFromPlot - minFromPlot);
      const x = PLOT.x + Math.cos(a) * d, z = PLOT.z + Math.sin(a) * d;
      if (distToPath(x, z) < 4 + r || !clearOf(x, z, r)) continue;
      reserve(x, z, r);
      return { x, z };
    }
    return null;
  }
  // The site office (planning happens here), with the drawings pinned up.
  const officePos = V(30, 0, 24);
  {
    const g = new THREE.Group();
    for (let lvl = 0; lvl < 2; lvl++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(7, 2.6, 2.8), flat(lvl ? '#e5e7eb' : '#2563eb')); box.position.set(0, 1.3 + lvl * 2.65, 0); g.add(box);
      for (let w = -2.4; w <= 2.4; w += 2.4) { const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.05), flat('#a7c7e7')); win.position.set(w, 1.6 + lvl * 2.65, 1.41); g.add(win); }
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), new THREE.MeshBasicMaterial({ map: canvasTexture(256, 52, (c, w, h) => {
      c.fillStyle = '#facc15'; c.fillRect(0, 0, w, h); c.fillStyle = '#111827'; c.font = '900 30px "Arial Black", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SITE OFFICE', w / 2, h / 2 + 2);
    }) }));
    sign.position.set(0, 5.1, 1.42); g.add(sign);
    g.position.copy(officePos); g.lookAt(PLOT.x, 0, PLOT.z);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g); reserve(officePos.x, officePos.z, 6);
  }
  // A welfare cabin and a skip.
  [[siteSpot(28, 37, 4), '#e5e7eb'], [siteSpot(28, 37, 4), '#16a34a']].forEach(([spot, color]) => {
    if (!spot) return;
    const box = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 2.6), flat(color)); box.position.set(spot.x, 1.3, spot.z); box.lookAt(PLOT.x, 1.3, PLOT.z);
    box.castShadow = box.receiveShadow = true; scene.add(box);
  });
  // Materials: brick pallets, pipe stacks, steel beams and sand piles.
  const brickMat = flat('#b45309'), palletMat = flat('#a16207'), sandMat = flat('#e6c88f'), pipeMat = flat('#94a3b8', { metalness: 0.3 });
  for (let k = 0; k < 18; k++) {
    const spot = siteSpot(27, 38, 2);
    if (!spot) continue;
    const g = new THREE.Group(), kind = k % 4;
    if (kind === 0) {
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 1.2), palletMat); pallet.position.y = 0.09; g.add(pallet);
      const bricks = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1), brickMat); bricks.position.y = 0.65; g.add(bricks);
    } else if (kind === 1) {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3, 10), pipeMat); p.rotation.x = Math.PI / 2; p.position.set((c - (2 - r) / 2) * 0.46, 0.22 + r * 0.4, 0); g.add(p);
      }
    } else if (kind === 2) {
      for (let r = 0; r < 3; r++) { const beam = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 0.3), flat('#7f1d1d')); beam.position.set(0, 0.15 + r * 0.32, (r - 1) * 0.36); g.add(beam); }
    } else {
      const pile = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.3, 9), sandMat); pile.position.y = 0.6; pile.scale.z = 0.8; g.add(pile);
    }
    g.position.set(spot.x, 0, spot.z); g.rotation.y = rnd() * Math.PI;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
  }
  // Traffic cones along the site road.
  const coneMat = flat('#f97316'), stripeMat = flat('#ffffff');
  for (let k = 0; k < 36; k++) {
    const u = 0.02 + k * 0.027, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const out = V(p.x - PLOT.x, 0, p.z - PLOT.z).normalize();
    const side = V(-t.z, 0, t.x).normalize();
    const s = side.dot(out) > 0 ? 2.4 : -2.4;
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 10), coneMat); cone.position.y = 0.32; g.add(cone);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.1, 10), stripeMat); band.position.y = 0.36; g.add(band);
    g.position.copy(p).addScaledVector(side, s); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }
  // Floodlight towers at the corners of the plot.
  [[-30, 20], [30, 6], [-30, -26], [26, -30]].forEach(([x, z]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 8, 6), steelMat); pole.position.set(x, 4, z); pole.castShadow = true; scene.add(pole);
    const lamps = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.3), new THREE.MeshStandardMaterial({ color: '#fef9c3', emissive: '#fde68a', emissiveIntensity: 0.5 }));
    lamps.position.set(x, 8.1, z); lamps.lookAt(PLOT.x, 0, PLOT.z); scene.add(lamps);
  });
  const clouds = [];
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.92 });
  for (let k = 0; k < 8; k++) {
    const g = new THREE.Group();
    for (let m = 0; m < 5; m++) { const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + rnd() * 2.5, 1), cloudMat); puff.position.set((m - 2) * 3.2, rnd() * 1.4, rnd() * 2); puff.scale.y = 0.6; g.add(puff); }
    g.position.set(-150 + k * 40, 55 + rnd() * 20, -120 + rnd() * 140); scene.add(g);
    clouds.push(g);
  }

  // ── The build: six phases driven by one number ─────────────────────────
  // `build` runs from 0 to 6 (progress × 6) and eases toward its target, so
  // each completed task visibly advances the work. Each piece of the job
  // fades or grows in over its own slice of that range.
  const BW = 14, BD = 10, FLOORS = 6, FLOOR_H = 3.2, BASE_Y = 0.5;
  const building = new THREE.Group(); building.position.copy(PLOT); scene.add(building);
  let build = 0;
  const pieces = []; // { obj, show(b) -> 0..1 (0 hidden), mode: 'scaleY' | 'scale' | 'fade' | 'toggle' }
  function piece(obj, show, mode = 'toggle') { pieces.push({ obj, show, mode, mats: mode === 'fade' ? collectMats(obj) : null }); return obj; }
  function collectMats(obj) {
    const mats = [];
    obj.traverse(o => { if (o.isMesh || o.isLine || o.isLineSegments) { o.material = o.material.clone(); o.material.transparent = true; mats.push(o.material); } });
    return mats;
  }
  function applyPieces() {
    pieces.forEach(p => {
      const k = p.show(build);
      p.obj.visible = k > 0.001;
      if (!p.obj.visible) return;
      if (p.mode === 'scaleY') p.obj.scale.y = Math.max(0.001, k);
      else if (p.mode === 'scale') p.obj.scale.setScalar(Math.max(0.001, 1 - Math.pow(1 - k, 3)));
      else if (p.mode === 'fade') p.mats.forEach(m => { m.opacity = k * (m.userData.baseOpacity ?? 1); });
    });
  }

  // 1 · PLANNING — the drawing table and a wireframe of the finished building
  const blueprintTex = canvasTexture(256, 192, (g, w, h) => {
    g.fillStyle = '#1e4f9c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#e0f2fe'; g.lineWidth = 3;
    g.strokeRect(48, 40, 160, 112); g.beginPath(); g.moveTo(48, 96); g.lineTo(208, 96); g.moveTo(128, 40); g.lineTo(128, 152); g.stroke();
    g.strokeRect(112, 140, 32, 12);
    g.fillStyle = '#e0f2fe'; g.font = '700 14px Arial'; g.fillText('GROUND FLOOR PLAN', 52, 30);
  });
  const desk = new THREE.Group(); desk.position.copy(PLOT).add(V(-11, 0, 7)); scene.add(desk);
  {
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.6), flat('#a16207')); top.position.y = 1; top.rotation.x = -0.25; desk.add(top);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.4), new THREE.MeshStandardMaterial({ map: blueprintTex, roughness: 0.6 }));
    sheet.rotation.x = -Math.PI / 2 - 0.25; sheet.position.y = 1.07; desk.add(sheet);
    [[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]].forEach(([x, z]) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), dark); leg.position.set(x, 0.5, z); desk.add(leg); });
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8), flat('#bfdbfe')); roll.rotation.z = Math.PI / 2; roll.position.set(0.3, 1.25, -0.4); desk.add(roll);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), yellow); hat.position.set(-0.8, 1.12, 0.2); desk.add(hat);
    desk.lookAt(PLOT.x, 0, PLOT.z);
    desk.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  piece(desk, b => (b < 5 ? 1 : 0));
  const HEIGHT = BASE_Y + FLOORS * FLOOR_H;
  const holoMat = new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.75 });
  holoMat.userData.baseOpacity = 0.75;
  const hologram = new THREE.Group(); building.add(hologram);
  {
    const shell3 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BW, HEIGHT, BD)), holoMat); shell3.position.y = HEIGHT / 2; hologram.add(shell3);
    for (let f = 1; f < FLOORS; f++) {
      const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BW, 0.01, BD)), holoMat); ring.position.y = BASE_Y + f * FLOOR_H; hologram.add(ring);
    }
    const roofLines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BW + 0.6, 0.8, BD + 0.6)), holoMat); roofLines.position.y = HEIGHT + 0.4; hologram.add(roofLines);
  }
  piece(hologram, b => 1 - span(2.6, 3.8, b), 'fade');

  // 2 · SETTING OUT — pegs, profile boards, string lines, paint, a surveyor
  const setOut = new THREE.Group(); building.add(setOut);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => V(sx * BW / 2, 0, sz * BD / 2));
  const pegs = new THREE.Group(); setOut.add(pegs);
  corners.forEach(c => {
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), flat('#a16207')); peg.position.copy(c).setY(0.3); pegs.add(peg);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), flat('#f97316')); tip.position.copy(c).setY(0.62); pegs.add(tip);
  });
  piece(pegs, b => (b >= 1.05 && b < 2.9 ? 1 : 0));
  const profiles = new THREE.Group(); setOut.add(profiles);
  corners.forEach(c => {
    const out = c.clone().normalize().multiplyScalar(1.6), at = c.clone().add(out);
    const g = new THREE.Group(); g.position.copy(at);
    [-0.6, 0.6].forEach(x => { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), flat('#a16207')); post.position.set(x, 0.5, 0); g.add(post); });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.05), flat('#e5c48f')); board.position.y = 0.85; g.add(board);
    g.lookAt(0, 0.85, 0);
    profiles.add(g);
  });
  piece(profiles, b => (b >= 1.2 && b < 2.9 ? 1 : 0));
  const strings = new THREE.Group(); setOut.add(strings);
  const stringMat = new THREE.MeshBasicMaterial({ color: '#f472b6' });
  for (let k = 0; k < 4; k++) {
    const a = corners[k], b2 = corners[(k + 1) % 4], len = a.distanceTo(b2);
    const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.03), stringMat);
    s.position.copy(a).add(b2).multiplyScalar(0.5).setY(0.55); s.rotation.y = -Math.atan2(b2.z - a.z, b2.x - a.x);
    strings.add(s);
  }
  piece(strings, b => span(1.3, 1.7, b) * (b < 2.6 ? 1 : 0), 'scaleY');
  const paint = new THREE.Group(); setOut.add(paint);
  const paintMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 });
  paintMat.userData.baseOpacity = 0.9;
  for (let k = 0; k < 4; k++) {
    const a = corners[k], b2 = corners[(k + 1) % 4], len = a.distanceTo(b2);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.18), paintMat);
    line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(b2.z - a.z, b2.x - a.x) * -1;
    line.position.copy(a).add(b2).multiplyScalar(0.5).setY(0.05);
    paint.add(line);
  }
  piece(paint, b => span(1.5, 1.9, b) * (b < 2.4 ? 1 : 1 - span(2.4, 2.6, b)), 'fade');
  // the theodolite on its tripod (the surveyor stands at it; see the crew)
  const surveyPos = PLOT.clone().add(V(10, 0, 6));
  const theodolite = new THREE.Group(); theodolite.position.copy(surveyPos); scene.add(theodolite);
  {
    [0, 2.1, 4.2].forEach(a => { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.5, 5), flat('#d4a24c')); leg.position.set(Math.cos(a) * 0.3, 0.7, Math.sin(a) * 0.3); leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); theodolite.add(leg); });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.22), yellow); head.position.y = 1.55; theodolite.add(head);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), dark); scope.rotation.x = Math.PI / 2; scope.position.y = 1.62; theodolite.add(scope);
    theodolite.lookAt(PLOT.x, 1.5, PLOT.z);
  }
  piece(theodolite, b => (b > 0.8 && b < 2.7 ? 1 : 0));
  // the meadow is stripped as setting out begins
  const meadowFade = () => { meadowMat.opacity = 1 - span(1, 1.6, build); meadow.visible = meadowMat.opacity > 0.01; };

  // 3 · FOUNDATION — dig, rebar, pour
  const pit = new THREE.Group(); building.add(pit);
  {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(BW + 2, BD + 2), flat('#6b4f32')); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.035; pit.add(floor);
    [[0, BD / 2 + 1, BW + 2.6, 0.6], [0, -BD / 2 - 1, BW + 2.6, 0.6], [BW / 2 + 1, 0, 0.6, BD + 2.6], [-BW / 2 - 1, 0, 0.6, BD + 2.6]].forEach(([x, z, w, d]) => {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), flat('#8b6b45')); lip.position.set(x, 0.15, z); pit.add(lip);
    });
  }
  piece(pit, b => (b > 2 && b < 5.2 ? span(2, 2.2, b) : 0), 'scale');
  const spoil = new THREE.Mesh(new THREE.ConeGeometry(3, 2, 10), flat('#8b6b45')); spoil.position.copy(PLOT).add(V(-12, 1, -9)); spoil.castShadow = true; scene.add(spoil);
  piece(spoil, b => (b < 5.3 ? span(2, 2.4, b) : 0), 'scaleY');
  const rebar = new THREE.Group(); building.add(rebar);
  {
    const bar = flat('#9a3412', { metalness: 0.4 });
    for (let x = -BW / 2; x <= BW / 2; x += 1) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, BD), bar); r.position.set(x, 0.25, 0); rebar.add(r); }
    for (let z = -BD / 2; z <= BD / 2; z += 1) { const r = new THREE.Mesh(new THREE.BoxGeometry(BW, 0.06, 0.06), bar); r.position.set(0, 0.28, z); rebar.add(r); }
  }
  piece(rebar, b => (b > 2.3 && b < 2.85 ? 1 : 0));
  const slab = new THREE.Mesh(new THREE.BoxGeometry(BW + 2, BASE_Y, BD + 2), flat('#9ca3af')); slab.position.y = BASE_Y / 2; slab.castShadow = slab.receiveShadow = true;
  const slabHolder = new THREE.Group(); slabHolder.add(slab); building.add(slabHolder);
  piece(slabHolder, b => span(2.55, 3, b), 'scaleY');
  // the excavator digging out the pit
  function excavator() {
    const g = new THREE.Group();
    const tracks = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 2.6), dark); tracks.position.y = 0.4; g.add(tracks);
    const turret = new THREE.Group(); turret.position.y = 0.8; g.add(turret);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.2), yellow); cab.position.set(-0.3, 0.8, 0); turret.add(cab);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 1.6), flat('#a7c7e7')); glass.position.set(0.5, 1.2, 0.35); turret.add(glass);
    const boom = new THREE.Group(); boom.position.set(0.6, 1.4, -0.5); turret.add(boom);
    const boomArm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 0.4), yellow); boomArm.position.x = 1.6; boom.add(boomArm);
    const stick = new THREE.Group(); stick.position.x = 3.2; boom.add(stick);
    const stickArm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), yellow); stickArm.position.y = -1.1; stick.add(stickArm);
    const bucket = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), dark); bucket.position.y = -2.4; stick.add(bucket);
    return { g, turret, boom, stick };
  }
  const digger = excavator();
  digger.g.position.copy(PLOT).add(V(-12, 0, -2)); digger.g.lookAt(PLOT.x, 0, PLOT.z); digger.g.rotateY(-Math.PI / 2);
  digger.g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(digger.g);
  piece(digger.g, b => (b < 5.4 ? 1 : 0));
  // the mixer truck that pours the slab
  const mixer = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.7, 3, 14), flat('#e5e7eb'));
  {
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 2), dark); chassis.position.y = 0.8; mixer.add(chassis);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 2), flat('#ef4444')); cab.position.set(2, 1.75, 0); mixer.add(cab);
    drum.rotation.z = Math.PI / 2 - 0.2; drum.position.set(-0.6, 2.05, 0); mixer.add(drum);
    const chute = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.4), flat('#9ca3af')); chute.position.set(-3.1, 1.3, 0); chute.rotation.z = -0.35; mixer.add(chute);
    [[1.8, 1], [1.8, -1], [-1.4, 1], [-1.4, -1], [-0.4, 1], [-0.4, -1]].forEach(([x, z]) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12), dark); w.rotation.x = Math.PI / 2; w.position.set(x, 0.45, z); mixer.add(w); });
    mixer.position.copy(PLOT).add(V(12, 0, 3)); mixer.rotation.y = Math.PI * 0.85;
    mixer.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(mixer);
  }
  piece(mixer, b => (b > 2.2 && b < 3.3 ? 1 : 0));

  // 4 · SUPERSTRUCTURE and 5 · FINISHES — frame up, then skin, roof, lights
  const slabMat = flat('#cbd5e1'), columnMat = flat('#9ca3af'), wallMat = flat('#c2410c');
  const glassMat = new THREE.MeshStandardMaterial({ color: '#9cc3e6', roughness: 0.1, metalness: 0.4, emissive: '#fde68a', emissiveIntensity: 0 });
  for (let f = 0; f < FLOORS; f++) {
    const frame = new THREE.Group(); frame.position.y = BASE_Y + f * FLOOR_H; building.add(frame);
    [-BW / 2 + 0.3, -BW / 6, BW / 6, BW / 2 - 0.3].forEach(x => [-BD / 2 + 0.3, BD / 2 - 0.3].forEach(z => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, FLOOR_H, 0.4), columnMat); col.position.set(x, FLOOR_H / 2, z); frame.add(col);
    }));
    const deck = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.4, 0.3, BD + 0.4), slabMat); deck.position.y = FLOOR_H; frame.add(deck);
    frame.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    piece(frame, b => span(3 + f / FLOORS, 3 + (f + 1) / FLOORS, b), 'scaleY');
    const skin = new THREE.Group(); skin.position.y = BASE_Y + f * FLOOR_H; building.add(skin);
    [[BW, BD / 2, 0], [BW, -BD / 2, Math.PI], [BD, BW / 2, Math.PI / 2], [BD, -BW / 2, -Math.PI / 2]].forEach(([len, off, rot]) => {
      const side = new THREE.Group(); side.rotation.y = rot; side.position.set(Math.sin(rot) * off, 0, Math.cos(rot) * off); skin.add(side);
      const n = Math.round(len / 2.4);
      for (let k = 0; k < n; k++) {
        const x = -len / 2 + (k + 0.5) * (len / n);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(len / n - 0.5, FLOOR_H - 1, 0.1), glassMat); pane.position.set(x, FLOOR_H / 2 + 0.1, 0); side.add(pane);
        const pier = new THREE.Mesh(new THREE.BoxGeometry(0.5, FLOOR_H, 0.3), wallMat); pier.position.set(-len / 2 + k * (len / n), FLOOR_H / 2, 0); side.add(pier);
      }
      const sill = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.32), wallMat); sill.position.set(0, 0.25, 0); side.add(sill);
    });
    skin.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    piece(skin, b => span(4 + f / FLOORS, 4 + (f + 1) / FLOORS, b), 'scaleY');
  }
  const roof = new THREE.Group(); roof.position.y = HEIGHT + 0.15; building.add(roof);
  {
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.6, 0.8, BD + 0.6), flat('#475569')); parapet.position.y = 0.4; roof.add(parapet);
    const plant = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 2.4), flat('#94a3b8')); plant.position.set(-3, 1.2, 0); roof.add(plant);
    roof.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  piece(roof, b => span(4.85, 5, b), 'scale');
  const scaffold = new THREE.Group(); building.add(scaffold);
  {
    const tube = flat('#d4d4d8', { metalness: 0.5 }), board = flat('#a16207');
    for (let f = 0; f <= FLOORS; f++) {
      const y = BASE_Y + f * FLOOR_H;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(BW + 1.6, 0.08, 0.08), tube); rail.position.set(0, y + 1, BD / 2 + 1.1); scaffold.add(rail);
      const walk = new THREE.Mesh(new THREE.BoxGeometry(BW + 1.6, 0.08, 0.8), board); walk.position.set(0, y, BD / 2 + 0.75); scaffold.add(walk);
    }
    for (let x = -BW / 2 - 0.8; x <= BW / 2 + 0.8; x += (BW + 1.6) / 6) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, HEIGHT + 1.5, 0.08), tube); pole.position.set(x, (HEIGHT + 1.5) / 2, BD / 2 + 1.1); scaffold.add(pole);
    }
  }
  // scaffolding goes up with the frame and comes down when the finishes are done
  piece(scaffold, b => (b < 4.9 ? span(3, 3.4, b) : 0), 'scaleY');
  // the tower crane: up for the superstructure, gone before external works
  const crane = new THREE.Group(); crane.position.copy(PLOT).add(V(BW / 2 + 5, 0, -2)); scene.add(crane);
  const MAST_H = HEIGHT + 10;
  {
    const base = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), flat('#6b7280')); base.position.y = 0.5; crane.add(base);
    for (let y = 1; y < MAST_H; y += 2) {
      [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(([x, z]) => { const c = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2, 0.14), yellow); c.position.set(x, y + 1, z); crane.add(c); });
      [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach(r => { const d = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), yellow); d.rotation.set(0, r, 0.62); d.position.set(Math.sin(r) * 0.7, y + 1, Math.cos(r) * 0.7); crane.add(d); });
    }
    crane.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  const slew = new THREE.Group(); slew.position.y = MAST_H; crane.add(slew);
  const JIB = 22;
  {
    const jib = new THREE.Mesh(new THREE.BoxGeometry(JIB + 7, 0.9, 1.1), yellow); jib.position.x = -JIB / 2 + 3.5; slew.add(jib);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 1.8), flat('#f8fafc')); cab.position.set(1.2, -0.9, 1.2); slew.add(cab);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.6), flat('#4b5563')); counter.position.set(6, -0.6, 0); slew.add(counter);
    const peak = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4, 4), yellow); peak.position.y = 2.4; slew.add(peak);
    slew.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  const trolley = new THREE.Group(); slew.add(trolley);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 4), dark); trolley.add(cable);
  const hookLoad = new THREE.Group(); trolley.add(hookLoad);
  {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 6, 12, Math.PI * 1.5), dark); hookLoad.add(hook);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 0.4), flat('#7f1d1d')); beam.position.y = -1.2; hookLoad.add(beam);
    [-2.2, 2.2].forEach(x => { const sling = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 4), dark); sling.position.set(x / 2, -0.6, 0); sling.rotation.z = x > 0 ? -1.1 : 1.1; hookLoad.add(sling); });
    hookLoad.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  piece(crane, b => (b > 2.6 && b < 5.5 ? 1 : 0));
  const cranePose = { slew: 0.4, reach: 12, hookY: 9 };
  function applyCrane(time) {
    if (!crane.visible) return;
    // while the frame climbs the crane swings beams over the plot
    const busy = build > 3 && build < 4.95;
    const s = reduceMotion ? 0 : time;
    cranePose.slew = 0.55 + Math.sin(s * (busy ? 0.35 : 0.12)) * (busy ? 0.7 : 0.4);
    cranePose.reach = 10 + Math.sin(s * 0.27) * 4;
    const top = BASE_Y + Math.min(FLOORS, Math.max(0, build - 3) * FLOORS) * FLOOR_H;
    cranePose.hookY = top + 3 + Math.abs(Math.sin(s * (busy ? 0.6 : 0.25))) * 6;
    slew.rotation.y = cranePose.slew;
    trolley.position.set(-cranePose.reach, 0, 0);
    const drop = MAST_H - cranePose.hookY;
    cable.scale.y = Math.max(0.1, drop - 0.5); cable.position.y = -(drop - 0.5) / 2;
    hookLoad.position.y = -drop;
  }

  // 6 · EXTERNAL WORKS — paving, lawns, trees, lamps, flowers, cars
  const front = PLOT.clone().add(V(0, 0, BD / 2));
  const forecourt = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), flat('#d6d3d1')); forecourt.rotation.x = -Math.PI / 2; forecourt.position.copy(front).add(V(0, 0.07, 3.6)); forecourt.receiveShadow = true; scene.add(forecourt);
  piece(forecourt, b => span(5, 5.25, b), 'scale');
  const lawns = new THREE.Group(); scene.add(lawns);
  [[-12, 0, 9, 18], [12, 0, 9, 18], [0, -14, 26, 6]].forEach(([x, z, w, d]) => {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(w, d), flat('#6fb34f')); l.rotation.x = -Math.PI / 2; l.position.copy(PLOT).add(V(x, 0.06, z)); l.receiveShadow = true; lawns.add(l);
  });
  piece(lawns, b => (b >= 5.2 ? 1 : 0));
  const leaf = flat('#4f9a52'), leafLight = flat('#79bf6a'), trunk = flat('#6b4a2e');
  [[-10, 6], [10, 6], [-12, -6], [12, -10], [-6, -14], [6, -14], [-14, 1], [14, 0]].forEach(([x, z], k) => {
    const g = new THREE.Group(); g.position.copy(PLOT).add(V(x, 0, z));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 1.8, 6), trunk); stem.position.y = 0.9; g.add(stem);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), k % 2 ? leaf : leafLight); crown.position.y = 2.5; g.add(crown);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    piece(g, b => span(5.3 + k * 0.03, 5.6 + k * 0.03, b), 'scale');
  });
  const lampsOn = [];
  [[-6.5, 7.5], [6.5, 7.5], [-6.5, 1.5], [6.5, 1.5]].forEach(([x, z]) => {
    const g = new THREE.Group(); g.position.copy(front).add(V(x, 0, z));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.2, 6), dark); pole.position.y = 1.6; g.add(pole);
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#ffe08a', emissiveIntensity: 0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), bulbMat); bulb.position.y = 3.3; g.add(bulb);
    scene.add(g); lampsOn.push(bulbMat);
    piece(g, b => span(5.45, 5.7, b), 'scaleY');
  });
  const beds = new THREE.Group(); scene.add(beds);
  {
    const cols = ['#f472b6', '#fde047', '#f87171', '#c084fc', '#ffffff'];
    [-1, 1].forEach(s => {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 1), flat('#7c4a1e')); bed.position.copy(front).add(V(s * 3.6, 0.15, 1.2)); beds.add(bed);
      for (let k = 0; k < 9; k++) { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), flat(cols[k % 5])); fl.position.copy(front).add(V(s * 3.6 - 1.3 + k * 0.32, 0.42, 1.2 + (k % 2 ? 0.2 : -0.2))); beds.add(fl); }
    });
  }
  piece(beds, b => (b >= 5.55 ? 1 : 0));
  const carColors = ['#ef4444', '#3b82f6', '#f8fafc', '#111827'];
  [[-10, 10], [-13, 10], [10, 10], [13, 10]].forEach(([x, z], k) => {
    const g = new THREE.Group(); g.position.copy(PLOT).add(V(x, 0, z)); g.rotation.y = Math.PI / 2;
    const body = flat(carColors[k], { roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 1.05), body); base.position.y = 0.45; g.add(base);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 0.95), body); cab.position.set(-0.1, 0.92, 0); g.add(cab);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.3, 0.97), flat('#a7c7e7')); glass.position.set(-0.1, 0.95, 0); g.add(glass);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    piece(g, b => span(5.75 + k * 0.04, 5.9 + k * 0.04, b), 'scale');
  });
  // the opening ribbon across the front door (ready once the finishes are in)
  const entrance = PLOT.clone().add(V(0, 0, BD / 2 + 3.6));
  const ribbon = new THREE.Group(); ribbon.position.copy(entrance); scene.add(ribbon);
  const ribbonHalves = [-1, 1].map(s => {
    const half = new THREE.Group(); half.position.x = s * 2.2; ribbon.add(half);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 8), flat('#d4a24c', { metalness: 0.6 })); post.position.y = 0.6; half.add(post);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.04), flat('#dc2626')); strip.position.set(-s * 1.1, 1.05, 0); half.add(strip);
    return { half, strip, s };
  });
  const bow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), flat('#dc2626')); bow.position.y = 1.05; ribbon.add(bow);
  function setRibbonCut(k) {
    ribbonHalves.forEach(({ strip, s }) => { strip.rotation.z = s * k * 1.2; strip.position.y = 1.05 - k * 0.5; strip.position.x = -s * 1.1 * (1 - k * 0.5); });
    bow.visible = k < 0.5;
  }
  piece(ribbon, b => (b >= 4.95 ? 1 : 0));

  // Moves the build toward its target and refreshes every piece.
  let buildTarget = 0, handedOver = false;
  function updateBuild(dt, instant) {
    const before = build;
    build = instant ? buildTarget : build + (buildTarget - build) * Math.min(1, dt * 0.9);
    if (Math.abs(buildTarget - build) < 0.002) build = buildTarget;
    applyPieces();
    meadowFade();
    // hoarding comes down at the very end
    const down = span(5.6, 6, build);
    hoarding.forEach(({ panel, k }) => { panel.position.y = 1.3 - smooth(k / 60, k / 60 + 0.4, down) * 3; panel.visible = panel.position.y > -1.2; });
    glassMat.emissiveIntensity = span(4.9, 5.2, build) * 0.35 + (handedOver ? 0.25 : 0);
    lampsOn.forEach(m => { m.emissiveIntensity = span(5.6, 5.9, build) * 1.2; });
    if (!instant) phaseCrossed(before, build);
    updatePhaseHud();
  }

  // ── Phase tracker and banners ─────────────────────────────────────────
  injectPhaseStyles();
  const hud = document.createElement('div');
  hud.className = 'jc-phase';
  hud.innerHTML = `<div class="jc-phase-label"></div><div class="jc-phase-steps">${PHASES.map(p => `<span title="${p.name}">${p.icon}</span>`).join('')}</div>`;
  shell.root.appendChild(hud);
  const banner = document.createElement('div');
  banner.className = 'jc-phase-banner'; banner.hidden = true;
  shell.root.appendChild(banner);
  const phaseOf = b => Math.min(PHASES.length - 1, Math.floor(b + 1e-6));
  let hudKey = '';
  function updatePhaseHud() {
    const done = build >= 6 - 1e-3, current = phaseOf(build);
    const key = done ? 'done' : String(current);
    if (key === hudKey) return;
    hudKey = key;
    hud.querySelector('.jc-phase-label').textContent = done ? 'Handed over' : `Phase ${current + 1} of 6 · ${PHASES[current].name}`;
    [...hud.querySelectorAll('.jc-phase-steps span')].forEach((s, k) => {
      s.className = done || k < current ? 'is-done' : k === current ? 'is-now' : '';
    });
  }
  function phaseCrossed(from, to) {
    if (Math.floor(to + 1e-6) <= Math.floor(from + 1e-6) || to < 1) return;
    const finished = Math.min(5, Math.floor(to + 1e-6) - 1);
    const next = PHASES[finished + 1];
    banner.innerHTML = `<strong>✓ ${PHASES[finished].name} complete!</strong>${next ? `<span>Next: ${next.icon} ${next.name}</span>` : ''}`;
    banner.hidden = false;
    banner.style.animation = 'none'; void banner.offsetWidth; banner.style.animation = '';
    timers.push(setTimeout(() => { banner.hidden = true; }, 2600));
    sparkle(PLOT.clone().setY(3), 60, ['#fde047', '#ffffff', '#86efac'], 4);
  }
  function injectPhaseStyles() {
    if (document.getElementById('jc-phase-styles')) return;
    const style = document.createElement('style');
    style.id = 'jc-phase-styles';
    style.textContent = `
      .jc-phase { position: absolute; left: 10px; top: 10px; z-index: 3; background: rgba(17,24,39,.78); color: #fff; border-radius: 12px; padding: 7px 10px; font: 700 12px system-ui, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.25); pointer-events: none; }
      .jc-phase-label { letter-spacing: .02em; margin-bottom: 5px; }
      .jc-phase-steps { display: flex; gap: 4px; }
      .jc-phase-steps span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; background: rgba(255,255,255,.12); font-size: 13px; filter: grayscale(1); opacity: .55; }
      .jc-phase-steps span.is-done { background: #16a34a; filter: none; opacity: 1; }
      .jc-phase-steps span.is-now { background: #f59e0b; filter: none; opacity: 1; animation: jc-now 1.4s ease-in-out infinite; }
      @keyframes jc-now { 0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,.6); } 50% { box-shadow: 0 0 0 5px rgba(245,158,11,0); } }
      .jc-phase-banner { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); z-index: 4; text-align: center; pointer-events: none; animation: jc-banner 2.6s ease-out both; }
      .jc-phase-banner strong { display: block; font: 900 clamp(18px, 3.4vw, 34px) "Arial Black", Impact, sans-serif; color: #fde047; -webkit-text-stroke: 1px #7c2d12; text-shadow: 0 3px 0 #7c2d12, 0 8px 24px rgba(0,0,0,.45); text-transform: uppercase; }
      .jc-phase-banner span { display: inline-block; margin-top: 6px; background: rgba(17,24,39,.8); color: #fff; font: 800 13px system-ui, sans-serif; padding: 4px 12px; border-radius: 999px; }
      @keyframes jc-banner { 0% { opacity: 0; transform: translate(-50%, 10px) scale(.8); } 12% { opacity: 1; transform: translate(-50%, 0) scale(1.05); } 22% { transform: translate(-50%, 0) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -12px); } }
      @media (prefers-reduced-motion: reduce) { .jc-phase-banner, .jc-phase-steps span.is-now { animation: none; } }
    `;
    document.head.appendChild(style);
  }

  // ── Checkpoints: one site signboard per task ──────────────────────────
  const STATUS = { done: '#10b981', next: '#fbbf24', pending: '#cbd5e1' };
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 128, (g, w) => {
      g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
      g.fillStyle = fg; g.font = '900 68px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, w / 2 + 4);
    });
  }
  function boardTexture(i, status) {
    return canvasTexture(256, 160, (g, w, h) => {
      g.fillStyle = '#facc15'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#111827';
      for (let x = -h; x < w; x += 36) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 18, 0); g.lineTo(x + 18 + h, h); g.lineTo(x + h, h); g.closePath(); g.fill(); }
      g.fillStyle = status === 'done' ? '#10b981' : status === 'next' ? '#fff7d6' : '#ffffff'; g.fillRect(22, 20, w - 44, h - 40);
      if (status === 'done') {
        g.strokeStyle = '#ffffff'; g.lineWidth = 18; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(84, 84); g.lineTo(116, 112); g.lineTo(172, 52); g.stroke();
      } else {
        g.fillStyle = '#1f2937'; g.font = '900 76px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i + 1), w / 2, h / 2 + 4);
      }
    });
  }
  const flags = [];
  function buildFlags() {
    flags.forEach(f => scene.remove(f.group));
    flags.length = 0;
    tasks.forEach((t, i) => {
      const u = checkpointFrac(i, tasks.length);
      const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = V(-tan.z, 0, tan.x).normalize();
      const group = new THREE.Group();
      group.position.copy(p).addScaledVector(side, 3);
      group.rotation.y = Math.atan2(-side.x, -side.z) + Math.PI;
      [-0.8, 0.8].forEach(x => { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), flat('#4b5563')); post.position.set(x, 1.1, 0); group.add(post); });
      const spin = new THREE.Group(); spin.position.y = 2.45; group.add(spin);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.45, 0.1), flat('#374151')); spin.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.36), new THREE.MeshStandardMaterial({ roughness: 0.6 })); face.position.z = 0.055; spin.add(face);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.36), face.material); back.position.z = -0.055; back.rotation.y = Math.PI; spin.add(back);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#f59e0b', emissiveIntensity: 0.8 }));
      beacon.position.set(1.05, 0.85, 0); spin.add(beacon);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      badge.position.set(0, 3.7, 0); badge.scale.setScalar(0.55); group.add(badge);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 40), new THREE.MeshBasicMaterial({ color: STATUS.next, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07; group.add(ring);
      group.traverse(o => { if (o.isMesh && o !== ring) o.castShadow = true; });
      scene.add(group);
      flags.push({ group, spin, face, badge, beacon, ring, pop: 0, turn: 0, status: '' });
    });
  }
  function refreshFlags() {
    const doneCount = tasks.filter(t => t.done).length;
    tasks.forEach((t, i) => {
      const f = flags[i];
      const status = t.done ? 'done' : i === doneCount ? 'next' : 'pending';
      if (f.status === status) return;
      f.status = status;
      if (f.face.material.map) f.face.material.map.dispose();
      f.face.material.map = boardTexture(i, status); f.face.material.needsUpdate = true;
      if (f.badge.material.map) f.badge.material.map.dispose();
      f.badge.material.map = status === 'done' ? badgeTexture('✓', STATUS.done, '#06301b') : badgeTexture(String(i + 1), status === 'next' ? STATUS.next : '#eef2f7', '#0b2534');
      f.badge.material.needsUpdate = true;
      f.beacon.material.color.set(status === 'done' ? '#22c55e' : '#f59e0b'); f.beacon.material.emissive.set(status === 'done' ? '#22c55e' : '#f59e0b');
      f.ring.visible = status === 'next';
    });
    progressTarget = tasks.length ? doneCount / tasks.length : 0;
  }

  // ── Blockers: barriers, permit signs, storms, broken trucks, rubble ───
  function finishFoe(g, kind, body, extra = {}) {
    const mats = [];
    g.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.emissive) mats.push(m); });
    });
    scene.add(g);
    return { kind, g, body, mats, ...extra };
  }
  const stripeTex = canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#dc2626';
    for (let x = -h; x < w; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill(); }
  });
  function buildBarrier() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.36, 0.06), new THREE.MeshStandardMaterial({ map: stripeTex })); board.position.y = 0.95; body.add(board);
    [-0.75, 0.75].forEach(x => [-1, 1].forEach(s => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), flat('#6b7280')); leg.position.set(x, 0.55, s * 0.18); leg.rotation.x = s * 0.3; body.add(leg); }));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#f59e0b', emissiveIntensity: 1 })); lamp.position.set(-0.75, 1.22, 0); body.add(lamp);
    [-1.15, 1.15].forEach(x => { const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.65, 10), coneMat); c.position.set(x, 0.33, 0.3); body.add(c); });
    return finishFoe(g, 'barrier', body, { lamp });
  }
  function buildPermit() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const tex = canvasTexture(256, 160, (c, w, h) => {
      c.fillStyle = '#dc2626'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffffff'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
      c.fillStyle = '#ffffff'; c.font = '900 50px "Arial Black", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('PERMIT', w / 2, 62); c.fillStyle = '#fde68a'; c.font = '800 34px Arial, sans-serif'; c.fillText('PENDING', w / 2, 112);
    });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.06), [flat('#991b1b'), flat('#991b1b'), flat('#991b1b'), flat('#991b1b'), new THREE.MeshStandardMaterial({ map: tex }), flat('#991b1b')]);
    sign.position.y = 1.55; body.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), flat('#6b7280')); post.position.y = 0.65; body.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 10), flat('#374151')); foot.position.y = 0.06; body.add(foot);
    return finishFoe(g, 'permit', body);
  }
  function buildStorm() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const greyMat = flat('#6b7280', { flatShading: false, roughness: 1 });
    [[0, 0, 0, 0.7], [0.6, 0.1, 0.1, 0.55], [-0.6, 0.05, -0.1, 0.5], [0.2, 0.35, -0.15, 0.5], [-0.25, 0.3, 0.15, 0.45]].forEach(([x, y, z, r]) => {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), greyMat); puff.position.set(x, y, z); body.add(puff);
    });
    const boltShape = new THREE.Shape(); boltShape.moveTo(0, 0); boltShape.lineTo(0.18, 0); boltShape.lineTo(0.05, -0.32); boltShape.lineTo(0.2, -0.32); boltShape.lineTo(-0.12, -0.8); boltShape.lineTo(-0.02, -0.42); boltShape.lineTo(-0.16, -0.42); boltShape.closePath();
    const bolt = new THREE.Mesh(new THREE.ShapeGeometry(boltShape), new THREE.MeshBasicMaterial({ color: '#fde047', side: THREE.DoubleSide })); bolt.position.set(0.1, -0.45, 0.2); body.add(bolt);
    body.position.y = 2.3;
    return finishFoe(g, 'storm', body, { bolt });
  }
  function buildTruck() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 1.1), dark); chassis.position.y = 0.45; body.add(chassis);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 1.05), yellow); cab.position.set(0.72, 0.98, 0); body.add(cab);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.86), flat('#a7c7e7')); glass.position.set(1.1, 1.1, 0); body.add(glass);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1.1), flat('#ea580c')); tray.position.set(-0.4, 0.92, 0); tray.rotation.z = 0.25; body.add(tray);
    [[0.7, 0.55], [0.7, -0.55], [-0.6, 0.55], [-0.6, -0.55]].forEach(([x, z], k) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 12), dark); w.rotation.x = Math.PI / 2; w.position.set(x, 0.28, z); body.add(w);
      if (k === 0) { w.position.y = 0.2; w.rotation.y = 0.4; } // the wheel that came off
    });
    body.rotation.z = -0.06;
    return finishFoe(g, 'truck', body, { smokeAt: V(0.72, 1.5, 0) });
  }
  function buildRubble() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const rock = [flat('#9ca3af'), flat('#78716c'), flat('#a8a29e')];
    for (let k = 0; k < 9; k++) {
      const r = 0.22 + rnd() * 0.28, m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rock[k % 3]);
      m.position.set((rnd() - 0.5) * 1.3, r * 0.7 + (k > 5 ? 0.35 : 0), (rnd() - 0.5) * 0.9); m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); body.add(m);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), flat('#7c2d12')); bar.position.set(0, 0.55, 0); bar.rotation.z = 1.2; body.add(bar);
    return finishFoe(g, 'rubble', body);
  }
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6b5e'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  // A site-crane hook that comes down out of the sky to lift a blocker away.
  function makeHook() {
    const g = new THREE.Group();
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 4), dark); g.add(line);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.2), yellow); g.add(block);
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 10, Math.PI * 1.5), dark); g.add(hk);
    g.visible = false; scene.add(g);
    return { g, line, block, hk };
  }
  function placeHook(h, x, y, z) {
    const top = 14;
    h.g.visible = true;
    h.line.scale.y = top - y; h.line.position.set(x, (top + y) / 2 + 0.3, z);
    h.block.position.set(x, y + 0.45, z); h.hk.position.set(x, y + 0.15, z);
  }
  const STORM_GREY = new THREE.Color('#6b7280'), WHITE = new THREE.Color('#ffffff');
  const KINDS = ['barrier', 'permit', 'storm', 'truck', 'rubble'];
  const BUILD = { barrier: buildBarrier, permit: buildPermit, storm: buildStorm, truck: buildTruck, rubble: buildRubble };
  const walls = [];
  function buildWalls() {
    walls.forEach(w => { w.foes.forEach(f => { scene.remove(f.g); scene.remove(f.hook.g); }); scene.remove(w.lock, w.ring, w.tag); });
    walls.length = 0;
    tasks.forEach((t, i) => {
      if (!t.foeList.length) return;
      const u = wallFrac(i), p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = V(-tan.z, 0, tan.x).normalize();
      const face = Math.atan2(-tan.x, -tan.z);
      const n = Math.min(t.foeList.length, 5);
      const owners = pickFoes(t.foeList, n);
      const foes = Array.from({ length: n }, (_, k) => {
        const kind = KINDS[(k + i * 2) % KINDS.length];
        const f = BUILD[kind]();
        const row = Math.floor(k / 3), inRow = Math.min(3, n - row * 3), col = k % 3;
        const home = p.clone().addScaledVector(side, (col - (inRow - 1) / 2) * 1.5).addScaledVector(tan, row * 1.5);
        f.g.position.copy(home); f.g.rotation.y = face + (kind === 'truck' ? Math.PI / 2 : 0);
        // owner: the obstacle this blocker stands for; ticked once it's resolved
        const ticked = owners[k].resolved;
        if (ticked) f.g.visible = false;
        return Object.assign(f, { home, face: f.g.rotation.y, hook: makeHook(), ph: rnd() * 6, delay: k * 0.7, done: ticked, started: ticked, owner: owners[k].id, ticked, tickT: 0 });
      });
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.copy(p).setY(3.4); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
      tag.position.copy(p).setY(4.05); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.7, 48), new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(p).setY(0.08); scene.add(ring);
      const w = { taskIndex: i, foes, lock, tag, ring, center: p.clone(), cleared: !!t.done, clearing: false, t: t.done ? 99 : 0, open: !t.foes, fade: t.done || !t.foes ? 1 : 0 };
      if (w.cleared) foes.forEach(f => { f.g.visible = false; f.done = true; });
      if (w.fade) lock.visible = tag.visible = ring.visible = false;
      walls.push(w);
    });
  }
  const standing = w => w.foes.filter(f => !f.ticked);
  const wallPause = w => 0.8 + 0.7 * Math.max(1, standing(w).length);
  function clearWall(w) {
    if (w.cleared) return;
    w.cleared = true; w.t = 0;
    standing(w).forEach((f, j) => { f.delay = j * 0.7; });
    if (reduceMotion) { w.t = 99; w.foes.forEach(f => { f.g.visible = false; f.done = true; }); }
    notify();
  }
  function restoreWall(w) {
    w.cleared = false; w.clearing = false; w.t = 0;
    w.foes.forEach(f => { if (!f.ticked) reviveFoe(f); });
  }
  function reviveFoe(f) {
    Object.assign(f, { done: false, started: false, ticked: false, tickT: 0 });
    f.g.visible = true; f.g.position.copy(f.home); f.g.rotation.set(0, f.face, 0); f.g.scale.setScalar(1);
    f.body.rotation.set(0, 0, f.kind === 'truck' ? -0.06 : 0);
    f.mats.forEach(m => m.emissive && m.emissive.setRGB(0, 0, 0));
    if (f.kind === 'storm') f.mats.forEach(m => m.color.copy(STORM_GREY));
    f.hook.g.visible = false;
  }
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  // An obstacle ticked off (or unticked) on its own: its blockers are
  // cleared away (or come back), and its name pops up.
  function applyResolves(changes) {
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.center.clone() : curve.getPointAt(wallFrac(c.index));
      if (c.resolved) { timers.push(setTimeout(() => shell.spawnTaskLabel(at.clone().setY(4.6), c.name, 'foe', CLEARED), j * 450)); peek.at.copy(at); peek.t = 3.6; }
      if (!w) return;
      w.foes.forEach(f => {
        if (f.owner !== c.id) return;
        if (c.resolved && !f.ticked) {
          f.ticked = true; f.tickT = 0;
          if (reduceMotion || f.done) { f.done = true; f.g.visible = false; }
        } else if (!c.resolved && f.ticked) {
          if (w.cleared) f.ticked = false; else reviveFoe(f);
        }
      });
    });
    walls.forEach(w => { w.open = !tasks[w.taskIndex].foes; });
    new Set(changes.map(c => c.index)).forEach(i => { const w = walls.find(x => x.taskIndex === i); if (w) retagWall(w); });
  }
  function idleFoe(f, time, dt) {
    const t = time + f.ph;
    if (f.kind === 'barrier') f.lamp.material.emissiveIntensity = (t % 1) < 0.5 ? 1.4 : 0.1;
    else if (f.kind === 'permit') f.body.rotation.z = Math.sin(t * 1.4) * 0.03;
    else if (f.kind === 'storm') {
      f.body.position.y = 2.3 + Math.sin(t * 1.2) * 0.15;
      f.bolt.visible = (t % 2.2) < 0.18 || ((t % 2.2) > 0.3 && (t % 2.2) < 0.38);
      if (!reduceMotion && rnd() < dt * 18) dust.emit({ pos: f.g.position.clone().add(V((rnd() - 0.5) * 1.2, 1.9, (rnd() - 0.5) * 0.8)), vel: V(0, -5, 0), life: 0.4, size: [0.08, 0.08], color: ['#93c5fd'], alpha: 0.8 });
    } else if (f.kind === 'truck') {
      if (!reduceMotion && rnd() < dt * 3) dust.emit({ pos: f.g.localToWorld(f.smokeAt.clone()), vel: V((rnd() - 0.5) * 0.3, 0.8, (rnd() - 0.5) * 0.3), life: 1.6, size: [0.3, 0.9], color: ['#6b7280', '#9ca3af'], alpha: 0.6 });
    }
  }
  // Clearing one blocker; lt is the time since its turn came. Barriers,
  // signs and trucks are lifted out by a crane hook; rubble is pushed off
  // into the dirt; a storm brightens into a white cloud and drifts away.
  function clearFoe(f, lt, time, dt) {
    if (lt < 0) { idleFoe(f, time, dt); return; }
    if (!f.started) {
      f.started = true;
      if (builder && !f.ticked) {
        P.heading = Math.atan2(f.home.x - builder.holder.position.x, f.home.z - builder.holder.position.z);
        builder.holder.rotation.y = P.heading;
        play(builder, 'Interact', { fade: 0.12, once: true, timeScale: 1.2 });
      }
    }
    const hp = f.home;
    if (f.kind === 'storm') {
      const q = smooth(0, 1.2, lt);
      f.mats.forEach(m => m.color.copy(STORM_GREY).lerp(WHITE, q));
      f.bolt.visible = false;
      f.g.position.copy(hp).add(V(0, q * 3, 0)); f.g.scale.setScalar(1 - q * 0.5);
      if (lt > 0.3 && !f.hit) { f.hit = true; sparkle(hp.clone().setY(3), 50, ['#fde047', '#ffffff', '#fef3c7'], 4); }
      if (lt >= 1.5 && !f.done) { f.done = true; f.g.visible = false; sparkle(hp.clone().setY(5), 30, ['#fde047', '#ffffff'], 3); }
      return;
    }
    if (f.kind === 'rubble') {
      const side = V(Math.cos(f.face), 0, -Math.sin(f.face));
      const q = smooth(0.1, 1.2, lt);
      f.g.position.copy(hp).addScaledVector(side, q * 3).setY(-q * 0.9);
      f.body.rotation.z = q * 0.6;
      if (lt > 0.1 && !f.hit) { f.hit = true; dustCloud(hp.clone().setY(0.6), 30, 2.2); if (!f.ticked) cam.shake = 0.15; }
      if (lt >= 1.3 && !f.done) { f.done = true; f.g.visible = false; dustCloud(hp.clone().addScaledVector(side, 3).setY(0.3), 16, 1.2); }
      return;
    }
    // the hook comes down, catches it, and lifts it out of sight
    const top = f.kind === 'permit' ? 2.1 : f.kind === 'truck' ? 1.5 : 1.3;
    if (lt < 0.6) placeHook(f.hook, hp.x, top + 10 - smooth(0, 0.6, lt) * 10, hp.z);
    else {
      const up = smooth(0.7, 1.8, lt) * 12;
      placeHook(f.hook, hp.x, top + up, hp.z);
      f.g.position.copy(hp).setY(up);
      f.g.rotation.y = f.face + Math.sin(lt * 4) * 0.3 * Math.min(1, lt - 0.6);
      if (!f.hit) { f.hit = true; sparkle(hp.clone().setY(top), 20, ['#fde047', '#ffffff'], 2.4); dustCloud(hp.clone().setY(0.3), 12, 1); }
    }
    if (lt >= 1.9 && !f.done) { f.done = true; f.g.visible = false; f.hook.g.visible = false; }
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.6, 0, 1);
      w.lock.material.opacity = w.tag.material.opacity = 1 - w.fade;
      w.ring.material.opacity = (shut ? 0.35 + 0.25 * Math.sin(time * 4) : 0.55) * (1 - w.fade);
      w.lock.visible = w.tag.visible = w.ring.visible = w.fade < 1;
      if (shut) w.lock.position.y = 3.4 + Math.sin(time * 2.2) * 0.08;
      if (w.cleared && w.t <= 60) w.t += dt;
      w.foes.forEach(f => {
        if (f.done) return;
        if (f.ticked) { f.tickT += dt; clearFoe(f, f.tickT, time, dt); return; }
        if (w.cleared) clearFoe(f, w.t - f.delay, time, dt);
        else idleFoe(f, time, dt);
      });
    });
  }

  // ── The builder ───────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  let builder = null, clips = [];
  function dressBuilder(obj) {
    ['Knight_Helmet', 'Knight_Cape', '1H_Sword', 'Badge_Shield'].forEach(n => { const o = obj.getObjectByName(n); if (o) o.removeFromParent(); });
    // armour → a hi-vis orange vest; leather → brown work boots and belt
    recolorCharacter(obj, (h, s, l) => {
      if (s < 0.16 && l > 0.16 && l < 0.86) return [26, 0.95, 0.38 + l * 0.18];
      if (h > 12 && h < 45 && s > 0.3 && l < 0.6) return [28, 0.55, 0.16 + l * 0.2];
      if ((h > 340 || h < 12) && s > 0.4) return [0, 0, 0.92];
      return null;
    });
    // a blue work shirt with gloves, and jeans
    [['Knight_ArmLeft', '#2f6fd6'], ['Knight_ArmRight', '#2f6fd6'], ['Knight_LegLeft', '#2a4d8f'], ['Knight_LegRight', '#2a4d8f']].forEach(([n, c]) => {
      const m = obj.getObjectByName(n);
      if (m) { m.material = m.material.clone(); m.material.map = null; m.material.color.set(c); m.material.needsUpdate = true; }
    });
  }
  function rigBuilder(ch) {
    const obj = ch.obj;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const head = findBone(obj, 'head');
    if (head) {
      const hp = new THREE.Vector3(); head.getWorldPosition(hp);
      const r = (box.max.y - hp.y) * 0.66;
      const hat = new THREE.Group();
      const hatMat = new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.35 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), hatMat); hat.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.18, r * 1.18, r * 0.08, 20), hatMat); brim.position.set(0, r * 0.02, r * 0.12); brim.scale.z = 1.12; hat.add(brim);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(r * 0.22, r * 0.18, r * 1.9), hatMat); ridge.position.y = r * 0.9; hat.add(ridge);
      hat.traverse(o => { if (o.isMesh) o.castShadow = true; });
      attachToBone(obj, head, hat, V(hp.x, box.max.y - r * 0.82, hp.z + r * 0.04));
    }
    const chest = findBone(obj, 'chest');
    if (chest) {
      const cp = new THREE.Vector3(); chest.getWorldPosition(cp);
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#e5e7eb'; x.fillRect(0, 34, 128, 14); x.fillRect(0, 74, 128, 14);
      x.fillStyle = 'rgba(255,255,255,0.7)'; x.fillRect(0, 36, 128, 3); x.fillRect(0, 76, 128, 3);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const strips = new THREE.Mesh(new THREE.PlaneGeometry(CHAR_H * 0.3, CHAR_H * 0.3), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.3 }));
      attachToBone(obj, chest, strips, cp.clone().add(V(0, -CHAR_H * 0.02, CHAR_H * 0.152)));
    }
  }

  // ── Walking the haul road ─────────────────────────────────────────────
  const walker = createWalker({
    curve, speed: 3.6, accel: 7, brakeDecel: 6, reduceMotion, getTasks: () => tasks, walls,
    hooks: {
      stopFrac: foeStopFrac, wallPause,
      place(frac) {
        const p = curve.getPointAt(THREE.MathUtils.clamp(frac, 0, 1));
        builder.holder.position.set(p.x, 0.04, p.z);
        builder.holder.rotation.y = P.heading;
      },
      runAnim(k) { play(builder, k > 0.7 ? 'Running_A' : 'Walking_A', { fade: 0.3, timeScale: k > 0.7 ? 0.8 : 1.2 }); },
      idleAnim(pause, tick) {
        if (tick) { if (finished(builder)) play(builder, 'Idle', { fade: 0.4 }); return; }
        if (pause && builder.current !== builder.actions.Running_A && builder.current !== builder.actions.Walking_A) return;
        play(builder, 'Idle', { fade: 0.35 });
      },
      onFlag(i, t) {
        const f = flags[i];
        if (!f) return;
        f.pop = 1; f.turn = 1;
        sparkle(f.group.position.clone().add(V(0, 2.6, 0)), 46, ['#86efac', '#ffffff', '#fde047'], 3.4);
        if (P.mode !== 'finale') play(builder, 'Cheer', { fade: 0.2, once: true, timeScale: 1.2 });
        shell.spawnTaskLabel(f.group.position.clone().add(V(0, 4.3, 0)), t.title);
      },
      clearWall, restoreWall,
      startFinale, undoFinale: undoVictory, updateFinale, updateVictory,
    },
  });
  const P = walker.P;

  // ── Finale: the handover ──────────────────────────────────────────────
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  const cutSpot = entrance.clone().add(V(0, 0.04, 1.1));
  function startFinale() {
    if (P.won) return;
    P.mode = 'finale'; P.finT = 0;
    P.fin = { from: builder.holder.position.clone(), steps: new Set() };
    if (reduceMotion) { settleWon(); victory(); }
  }
  function updateFinale(dt) {
    const t = (P.finT += dt), F = P.fin;
    if (t < 2.2) {
      once('walk', () => play(builder, 'Walking_A', { fade: 0.3, timeScale: 1.2 }));
      builder.holder.position.lerpVectors(F.from, cutSpot, smooth(0, 2.2, t));
      const toward = Math.atan2(cutSpot.x - F.from.x, cutSpot.z - F.from.z);
      P.heading = angleLerp(P.heading, toward, Math.min(1, dt * 6));
    } else {
      P.heading = angleLerp(P.heading, Math.PI, Math.min(1, dt * 6));
      once('cut', () => play(builder, 'Interact', { fade: 0.2, once: true }));
    }
    builder.holder.rotation.y = P.heading;
    if (t > 2.7) setRibbonCut(smooth(2.7, 3.3, t));
    if (t > 2.8) once('confetti', () => {
      handedOver = true;
      confetti(entrance.clone().setY(1.2));
      sparkle(entrance.clone().setY(1.2), 60, ['#fde047', '#ffffff'], 4);
      cam.shake = 0.12;
    });
    if (t > 4) once('win', victory);
  }
  function victory() {
    P.won = true;
    handedOver = true;
    if (celebrationsOn) shell.showWin();
    play(builder, 'Cheer', { fade: 0.3 });
    if (surveyor) play(surveyor, 'Cheer', { fade: 0.3 });
    P.mode = 'victory'; P.vicT = 0;
    notify();
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; timers.push(setTimeout(cb, celebrationsOn ? 1800 : 0)); }
  }
  function updateVictory(dt) {
    P.vicT = (P.vicT || 0) + dt;
    const toCam = Math.atan2(camera.position.x - builder.holder.position.x, camera.position.z - builder.holder.position.z);
    P.heading = angleLerp(P.heading, toCam, Math.min(1, dt * 2.5)); builder.holder.rotation.y = P.heading;
    if (P.vicT > 6 && builder.current === builder.actions.Cheer) play(builder, 'Idle', { fade: 0.5 });
    if (!reduceMotion && celebrationsOn && rnd() < dt * 2.5) sparkle(PLOT.clone().add(V((rnd() - 0.5) * 16, HEIGHT + 5 + rnd() * 8, (rnd() - 0.5) * 8)), 34, ['#fde047', '#fb923c', '#86efac', '#93c5fd'], 5);
  }
  function settleWon() {
    builder.holder.position.copy(cutSpot);
    P.heading = Math.PI; builder.holder.rotation.y = P.heading;
    setRibbonCut(1); handedOver = true;
    P.fin = { steps: new Set(['walk', 'cut', 'confetti', 'win']) };
    P.won = true; P.mode = 'victory'; P.vicT = 99;
    play(builder, 'Idle', { fade: 0 });
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; shell.winEl.hidden = true;
    setRibbonCut(0); handedOver = false;
    play(builder, 'Idle', { fade: 0.2 });
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  // The default is the site view: a slow orbit round the building, looking
  // at whatever height the work has reached. Follow cam rides with the
  // builder round the site road.
  shell.cam.mode = 'overview';
  shell.root.querySelectorAll('.jk-cam button').forEach(b => {
    if (b.textContent === 'Overview') b.textContent = 'Site view';
    b.setAttribute('aria-pressed', String(b.textContent === 'Site view'));
  });
  const cam = { look: V(0, 1, 20), shake: 0, orbit: -0.9 };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  const peek = { at: new THREE.Vector3(), t: 0 };
  const workHeight = () => (build < 3 ? 1 : BASE_Y + Math.min(FLOORS, (build - 3) * FLOORS) * FLOOR_H * 0.6);
  function siteView(target, look, radius = 46, height = 24) {
    target.set(PLOT.x + Math.sin(cam.orbit) * radius, height + workHeight() * 0.5, PLOT.z + Math.cos(cam.orbit) * radius);
    look.copy(PLOT).setY(workHeight());
  }
  function updateCamera(dt) {
    if (!builder) return;
    const pp = builder.holder.position;
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading));
    let rate = 3;
    if (!reduceMotion) cam.orbit += dt * 0.05;
    if (P.mode === 'finale' || P.mode === 'victory') {
      camDesired.copy(entrance).add(V(-10, 12, 34));
      lookDesired.copy(entrance).add(V(0, P.mode === 'victory' ? 8 + Math.min(1, (P.vicT || 0) / 3) * 3 : 6, -6));
      rate = 1.8;
    } else if (shell.cam.mode === 'overview') {
      siteView(camDesired, lookDesired);
      rate = 1.5;
    } else {
      const side = V(fwd.z, 0, -fwd.x);
      const orbit = P.mode === 'idle' ? Math.sin(performance.now() / 4000) * 1.4 : 0;
      camDesired.copy(pp).addScaledVector(fwd, -6.4).addScaledVector(side, 1.8 + orbit).setY(3.6);
      lookDesired.copy(pp).addScaledVector(fwd, 3.5).setY(1.1);
      peekCamera(peek, pp, camDesired, lookDesired, dt, 10, 5, 2.4);
    }
    const k = 1 - Math.exp(-dt * rate);
    camera.position.lerp(camDesired, k);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
    if (cam.shake > 0 && !reduceMotion) { camera.position.add(rand3(cam.shake * 0.25)); cam.shake = Math.max(0, cam.shake - dt); }
    const focus = shell.cam.mode === 'overview' || P.mode === 'finale' || P.mode === 'victory' ? PLOT : pp;
    sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(sunDir, 70);
  }

  // ── Ghost, label, state ──────────────────────────────────────────────
  let ghost = null;
  function updateGhost(g) {
    if (!builder) return;
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) {
      const obj = SkeletonUtils.clone(builder.obj);
      obj.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        Object.assign(o.material, { transparent: true, opacity: 0.35, depthWrite: false });
        o.castShadow = false;
      });
      const holder = new THREE.Group(); holder.add(obj); scene.add(holder);
      const mixer = new THREE.AnimationMixer(obj);
      const actions = {}; clips.forEach(c => { actions[c.name] = mixer.clipAction(c); });
      ghost = { holder, obj, mixer, actions, current: null };
      play(ghost, 'Idle', { fade: 0 });
    }
    const u = THREE.MathUtils.clamp(progressToPathFracSmooth(g.frac, tasks.length), 0, 1);
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    ghost.holder.visible = true;
    ghost.holder.position.copy(p).addScaledVector(V(-t.z, 0, t.x).normalize(), -0.9).setY(0.04);
    ghost.holder.rotation.y = Math.atan2(t.x, t.z);
  }
  function notify() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Construction Journey: ${done} of ${n} tasks done.` : 'Construction Journey: no tasks yet.';
    const blocked = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= walker.progressToFrac(done, n) + 1e-3);
    if (blocked) text += ` Held up by: ${tasks[blocked.taskIndex].blocker}.`;
    text += ` Phase: ${buildTarget >= 6 - 1e-3 ? 'handed over' : PHASES[phaseOf(buildTarget)].name}.`;
    if (n && done === n) text += P.won ? ' The building is handed over!' : ' Cutting the ribbon.';
    shell.root.setAttribute('aria-label', text);
  }
  let latestState = null, layoutSig = null;
  function snapCamera() {
    siteView(camera.position, cam.look);
    camera.lookAt(cam.look);
  }
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
      play(builder, 'Idle', { fade: 0.2 });
      progressShown = progressTarget;
      buildTarget = progressTarget * 6;
      updateBuild(0, true);
      if (n && tasks.every(t => t.done)) settleWon();
      if (firstBuild) snapCamera();
    } else {
      const changes = resolveChanges(tasks, next);
      next.forEach((t, i) => { tasks[i].done = t.done; tasks[i].title = t.title; tasks[i].blocker = t.blocker; tasks[i].foes = t.foes; tasks[i].foeList = t.foeList; });
      if (changes.length) applyResolves(changes);
      refreshFlags();
      buildTarget = progressTarget * 6;
      walker.plan();
    }
    updateGhost(state.ghost);
    notify();
  }

  // ── Loop ─────────────────────────────────────────────────────────────
  let simTime = 0;
  function simulate(dt) {
    simTime += dt;
    const time = simTime;
    if (builder) { builder.mixer.update(dt); walker.update(dt); }
    if (surveyor) {
      surveyor.holder.visible = theodolite.visible;
      if (surveyor.holder.visible) {
        surveyor.mixer.update(dt);
        if (!reduceMotion && surveyor.current === surveyor.actions.Idle && rnd() < dt * 0.3) play(surveyor, 'Interact', { fade: 0.2, once: true });
        else if (finished(surveyor)) play(surveyor, 'Idle', { fade: 0.3 });
      }
    }
    updateWalls(dt, time);
    if (build !== buildTarget) updateBuild(dt, false);
    applyCrane(time);
    if (!reduceMotion) {
      // the excavator digs while the pit is being dug; the drum turns while pouring
      const digging = build > 1.9 && build < 2.7;
      digger.turret.rotation.y = digging ? Math.sin(time * 0.8) * 0.5 : digger.turret.rotation.y * 0.98;
      digger.boom.rotation.z = digging ? -0.2 + Math.sin(time * 1.6) * 0.25 : 0.3;
      digger.stick.rotation.z = digging ? Math.sin(time * 1.6 + 1) * 0.4 : -0.3;
      if (digging && rnd() < dt * 3) dustCloud(PLOT.clone().add(V(-6, 0.4, -2)), 4, 1);
      if (mixer.visible) drum.rotation.y += dt * (build > 2.5 && build < 3 ? 4 : 1);
      hologram.position.y = Math.sin(time * 1.2) * 0.15;
    }
    clouds.forEach((c, k) => { if (!reduceMotion) c.position.x += dt * (0.6 + (k % 3) * 0.2); if (c.position.x > 170) c.position.x -= 340; });
    flags.forEach(f => {
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); f.group.scale.setScalar(1 + Math.sin((1 - f.pop) * Math.PI) * 0.2); }
      if (f.turn > 0) { f.turn = Math.max(0, f.turn - dt * 0.9); f.spin.rotation.y = (1 - f.turn) * Math.PI * 2 * (f.turn > 0 ? 1 : 0); }
      if (f.status !== 'done') f.beacon.material.emissiveIntensity = (time + f.group.position.x) % 1 < 0.5 ? 1.2 : 0.2;
      if (f.ring.visible) { f.ring.scale.setScalar(1 + 0.15 * Math.sin(time * 4)); f.ring.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); }
    });
    progressShown += (progressTarget - progressShown) * Math.min(1, dt * 1.5);
    const shownFrac = progressShown >= 0.999 ? 1 : walker.progressToFrac(Math.round(progressShown * tasks.length), tasks.length) * (progressShown > 0 ? 1 : 0);
    progressLine.geometry.setDrawRange(0, Math.floor(Math.min(1, shownFrac) * 420) * 6);
    sparks.update(dt); dust.update(dt);
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
    updateCamera(dt);
    shell.updateTaskLabels(camera);
  }
  const loop = createLoop(shell, camera, scene, simulate, (w, h) => { scaleU.value = particleScaleFor(renderer, camera, h); });

  let surveyor = null;
  loadGLTF(loader, BUILDER_URL).then(gltf => {
    if (loop.destroyed) return;
    clips = gltf.animations;
    dressBuilder(gltf.scene);
    builder = makeCharacter(scene, gltf.scene, clips, CHAR_H);
    rigBuilder(builder);
    play(builder, 'Idle', { fade: 0 });
    // the surveyor at the theodolite, in the same site gear
    surveyor = makeCharacter(scene, SkeletonUtils.clone(builder.obj), clips, CHAR_H);
    surveyor.holder.position.copy(surveyPos).add(V(0.6, 0.04, 0.9));
    surveyor.holder.rotation.y = Math.atan2(surveyPos.x - surveyor.holder.position.x, surveyPos.z - surveyor.holder.position.z);
    play(surveyor, 'Idle', { fade: 0 });
    shell.loadingEl.hidden = true;
    loop.setReady();
    if (latestState) applyState(latestState);
    loop.start();
  }).catch(err => {
    console.error('Construction 3D: could not load the builder', err);
    shell.loadingEl.textContent = 'Couldn’t load the 3D site. Switch the scene to Construction for the 2D version.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (builder) applyState(state);
    },
    pause: loop.stop,
    resume: loop.start,
    destroy() { loop.destroy(container); },
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) simulate(1 / 30); },
      get state() {
        return {
          ready: !!builder, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length, finT: P.finT,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)),
          walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, foes: w.foes.length, gone: w.foes.filter(f => f.ticked).length, open: !!w.open })),
          build: +build.toFixed(2), phase: build >= 6 - 1e-3 ? 'handed over' : PHASES[phaseOf(build)].name, ghost: ghost ? ghost.holder.visible : false, label: shell.root.getAttribute('aria-label'),
          onPath: builder && P.mode !== 'finale' && P.mode !== 'victory' ? (() => { let d = 1e9; for (let i = 0; i <= 400; i++) d = Math.min(d, curve.getPointAt(i / 400).distanceTo(tmpV.copy(builder.holder.position).setY(0))); return d; })() : 0,
        };
      },
    },
  };
}
