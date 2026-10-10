// ── JOURNEY 3D: CORPORATE STAGE ("Road to the Boardroom", WebGL / three.js) ──
// A professional in a suit walks a sidewalk through a downtown district,
// past glass towers and busy streets, to the company HQ. Each task is a
// KPI billboard beside the sidewalk (its chart turns into a green tick when
// the task is done), and the HQ tower lights up floor by floor as tasks
// get done. Blockers are piles of red tape, angry emails, ringing meeting
// clocks and rival executives standing on the sidewalk; each is stamped
// "APPROVED" and whisked away when it's cleared. The last task is the
// deal: a handshake with the partner at the HQ entrance, the whole tower
// lights up and paper confetti rains down.
//
// Loaded on demand by journeyGame.js (the "Corporate 3D" theme), which
// falls back to the 2D Corporate stage without WebGL. Same sync() contract
// as the other 3D stages. The people are the KayKit Knight (CC0) dressed
// in code: armour re-dyed into a suit, a shirt and tie, and a briefcase.
// Everything else is built here from primitives.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  createShell, createLoop, makeCanvasTexture, seededRandom, softDotTexture, Particles, particleScaleFor,
  loadGLTF, makeCharacter, play, finished, recolorCharacter, findBone, attachToBone,
  checkpointFracOf, progressToPathFracSmooth, angleLerp, createWalker,
  stageTasks, layoutSignature, nameTagSprite, pickFoes, resolveChanges, tagText, peekCamera,
} from './journey3dKit.js';

const PERSON_URL = '/assets/models/Knight.glb';
const CLEARED = 'APPROVED!';

export function createCorporate3D(container) {
  const shell = createShell(container, {
    label: 'Corporate Journey in 3D', background: '#a9cbe9', loadingText: 'Opening the office…',
    winTitle: 'Deal Closed!', winText: 'You made it to the boardroom', winFill: '#fde68a', winEdge: '#1e3a5f',
  });
  const { renderer, reduceMotion, timers } = shell;
  renderer.toneMappingExposure = 1.0;
  const canvasTexture = makeCanvasTexture(renderer);
  const rnd = seededRandom(31);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
  const tmpV = new THREE.Vector3();
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;

  // ── The route: a sidewalk from the south plaza to the HQ in the north ──
  const PATH_XZ = [[-14, 46], [-3, 41], [7, 33], [9, 23], [0, 15], [-10, 7], [-12, -3], [-3, -11], [9, -17], [11, -27], [4, -35], [0, -41]];
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
  const foeStopFrac = i => wallFrac(i) - 2.2 / curveLen;
  const CHAR_H = 1.6;

  // ── Scene, sky, light ─────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a9cbe9');
  scene.fog = new THREE.Fog('#c9dcec', 70, 230);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  camera.position.set(-18, 6, 56);
  const hemi = new THREE.HemisphereLight('#e8f3ff', '#7d7a70', 1.35);
  scene.add(hemi);
  const sunDir = V(-0.55, 0.75, 0.4).normalize();
  const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 col = mix(vec3(1.0, 0.86, 0.68), vec3(0.62, 0.79, 0.94), smoothstep(0.0, 0.18, h));
        col = mix(col, vec3(0.30, 0.54, 0.86), smoothstep(0.18, 0.75, h));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(sky);
  const glowTex = softDotTexture(canvasTexture);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2d6', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  sunGlow.position.copy(sunDir).multiplyScalar(420); sunGlow.scale.setScalar(110); scene.add(sunGlow);

  // ── The ground: paved plazas, lawns and a grid of streets ─────────────
  const paving = canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#d3d8de'; g.fillRect(0, 0, w, w);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = 200 + Math.floor(((x * 7 + y * 13) % 9) * 3);
      g.fillStyle = `rgb(${v},${v + 4},${v + 9})`; g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
  }, { repeat: true });
  paving.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: paving, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // Streets running east-west across the district; the sidewalk crosses
  // each one on a zebra crossing.
  const STREETS = [28, 1, -22];
  const asphalt = new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.9 });
  const lineMat = new THREE.MeshBasicMaterial({ color: '#f5d24b' });
  const whiteMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.6 });
  STREETS.forEach(z => {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 7), asphalt);
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, z); road.receiveShadow = true; scene.add(road);
    for (let x = -150; x < 150; x += 5) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.16), lineMat);
      dash.rotation.x = -Math.PI / 2; dash.position.set(x, 0.03, z); scene.add(dash);
    }
    [-3.6, 3.6].forEach(off => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(400, 0.16, 0.3), flat('#b6bcc4'));
      curb.position.set(0, 0.08, z + off); curb.receiveShadow = true; scene.add(curb);
    });
    // where the sidewalk crosses this street: zebra stripes
    for (let i = 1; i < PATH_SAMPLES.length; i++) {
      const a = PATH_SAMPLES[i - 1], b = PATH_SAMPLES[i];
      if ((a.z - z) * (b.z - z) > 0) continue;
      const k = (z - a.z) / (b.z - a.z), x = a.x + (b.x - a.x) * k;
      for (let s = -2.4; s <= 2.4; s += 0.8) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.45), whiteMat);
        stripe.rotation.x = -Math.PI / 2; stripe.position.set(x, 0.035, z + s); scene.add(stripe);
      }
    }
  });
  const nearStreet = (z, m) => STREETS.some(s => Math.abs(z - s) < 3.5 + m);
  // The sidewalk itself: a warm stone ribbon with a darker edge.
  function ribbonGeometry(width, samples, lift) {
    const pos = [], uv = [], nrm = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples, p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const side = V(-t.z, 0, t.x).normalize();
      const a = p.clone().addScaledVector(side, width / 2), b = p.clone().addScaledVector(side, -width / 2);
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
  const walkTex = canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#efe6d6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d8cbb3'; g.lineWidth = 2;
    for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x, h - 6); g.stroke(); }
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.fillStyle = '#9aa1ab'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
  }, { repeat: true });
  const walk = new THREE.Mesh(ribbonGeometry(3.4, 420, 0.05), new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
  walk.receiveShadow = true; scene.add(walk);
  // A gold line down the middle that fills in as tasks get done.
  const progressLine = new THREE.Mesh(ribbonGeometry(0.22, 420, 0.07), new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.85 }));
  progressLine.geometry.setDrawRange(0, 0); scene.add(progressLine);
  let progressShown = 0, progressTarget = 0;

  // ── Particles: sparkles and paper ─────────────────────────────────────
  const scaleU = { value: 400 };
  const paperTex = canvasTexture(32, 40, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#cbd5e1'; for (let y = 10; y < h - 6; y += 6) g.fillRect(6, y, w - 12, 2);
  });
  const sparks = new Particles(scene, 1600, { additive: true, map: glowTex, scale: scaleU });
  const papers = new Particles(scene, 700, { additive: false, map: paperTex, scale: scaleU });
  function sparkle(at, n = 40, colors = ['#fff3b0', '#ffffff'], power = 3) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.9 + 0.1, rnd() - 0.5).normalize().multiplyScalar(power * (0.4 + rnd() * 0.8));
      sparks.emit({ pos: at.clone(), vel: d, life: 0.9 + rnd() * 0.8, size: [0.3, 0.05], color: [colors[i % colors.length], '#ffffff'], gravity: 0.5, drag: 2 });
    }
  }
  function paperBurst(at, n = 24, power = 3) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.8 + 0.4, rnd() - 0.5).normalize().multiplyScalar(power * (0.5 + rnd() * 0.7));
      papers.emit({ pos: at.clone().add(rand3(0.4)), vel: d, life: 1.6 + rnd() * 1.2, size: [0.32, 0.28], color: ['#ffffff', '#fef3c7'], gravity: 1.4, drag: 1.6 });
    }
  }
  function paperRain(center, n = 160) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      papers.emit({ pos: center.clone().add(V((rnd() - 0.5) * 14, 8 + rnd() * 8, (rnd() - 0.5) * 10)), vel: V((rnd() - 0.5) * 0.8, -1 - rnd(), (rnd() - 0.5) * 0.8),
        life: 5 + rnd() * 2, size: [0.34, 0.3], color: [i % 3 ? '#ffffff' : '#fde68a', '#ffffff'], gravity: 0.1, drag: 0.3 });
    }
  }

  // ── Buildings: glass and stone towers on the blocks between streets ───
  function facadeTexture(base, glass, frame, litChance, seed) {
    const r = seededRandom(seed);
    const map = canvasTexture(128, 128, (g, w) => {
      g.fillStyle = base; g.fillRect(0, 0, w, w);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = frame; g.fillRect(x * 32 + 3, y * 16 + 3, 26, 11);
        const lit = r() < litChance;
        const grd = g.createLinearGradient(0, y * 16 + 4, 0, y * 16 + 13);
        grd.addColorStop(0, lit ? '#fff1c4' : glass); grd.addColorStop(1, lit ? '#f6d58a' : base);
        g.fillStyle = grd; g.fillRect(x * 32 + 4, y * 16 + 4, 24, 9);
      }
    }, { repeat: true });
    return map;
  }
  const FACADES = [
    ['#8fb3d6', '#cfe6ff', '#5c7ea3', 0.12, 3], ['#c9b89a', '#e6edf5', '#8d7a5c', 0.15, 5],
    ['#9aa7b5', '#d9e8f7', '#5f6b78', 0.1, 7], ['#6e8fb0', '#b9dcff', '#3f5f80', 0.18, 9], ['#d8d2c6', '#dce9f5', '#9a9284', 0.14, 11],
  ].map(([base, glass, frame, lit, seed]) => new THREE.MeshStandardMaterial({ map: facadeTexture(base, glass, frame, lit, seed), roughness: 0.45, metalness: 0.15 }));
  const roofMat = flat('#7b828c'), roofDark = flat('#5d636b');
  // Box UVs scaled so the window grid keeps its size on any building.
  function buildingGeometry(w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv, nrm = geo.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
      if (ny > 0.5) continue;
      const across = nx > 0.5 ? d : w;
      uv.setXY(i, uv.getX(i) * across / 4, uv.getY(i) * h / 8);
    }
    return geo;
  }
  const HQ = V(0, 0, -51);
  const buildingSpots = [];
  for (let gx = -96; gx <= 96; gx += 9) {
    for (let gz = -110; gz <= 60; gz += 9) {
      const x = gx + (rnd() - 0.5) * 2, z = gz + (rnd() - 0.5) * 2;
      const w = 5 + rnd() * 3, d = 5 + rnd() * 3;
      if (distToPath(x, z) < 8.5 + Math.max(w, d) / 2) continue;
      if (nearStreet(z, d / 2)) continue;
      if (Math.hypot(x - HQ.x, z - HQ.z) < 18) continue;
      if (Math.hypot(x + 14, z - 50) < 12) continue; // the start plaza
      const north = smooth(50, -60, z), centre = 1 - smooth(20, 80, Math.abs(x));
      const h = 6 + rnd() * 10 + north * centre * (14 + rnd() * 22);
      buildingSpots.push({ x, z, w, d, h });
    }
  }
  buildingSpots.forEach(({ x, z, w, d, h }, i) => {
    const facade = FACADES[i % FACADES.length];
    const b = new THREE.Mesh(buildingGeometry(w, h, d), [facade, facade, roofMat, roofMat, facade, facade]);
    b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; scene.add(b);
    if (rnd() < 0.6) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.2 + rnd(), 0.7, 1 + rnd()), roofDark);
      ac.position.set(x + (rnd() - 0.5) * (w - 2), h + 0.35, z + (rnd() - 0.5) * (d - 2)); ac.castShadow = true; scene.add(ac);
    }
    if (h > 26 && rnd() < 0.5) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 4, 5), flat('#cbd5e1'));
      mast.position.set(x, h + 2, z); scene.add(mast);
    }
  });

  // ── Street life: trees, lamps, benches and traffic ────────────────────
  function scatterNearPath(count, minDist, maxDist, minGap, accept = () => true) {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 60; tries++) {
      const u = rnd(), p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const side = V(-t.z, 0, t.x).normalize().multiplyScalar((rnd() < 0.5 ? -1 : 1) * (minDist + rnd() * (maxDist - minDist)));
      const x = p.x + side.x, z = p.z + side.z;
      if (distToPath(x, z) < minDist - 0.1 || nearStreet(z, 0.6)) continue;
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < minGap)) continue;
      if (!accept(x, z)) continue;
      out.push({ x, z, u });
    }
    return out;
  }
  const leaf = flat('#4f9a52'), leafLight = flat('#79bf6a'), trunk = flat('#6b4a2e'), planter = flat('#d6d9de');
  scatterNearPath(34, 2.6, 5.5, 3.2).forEach(({ x, z }) => {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.52, 0.55, 10), planter); pot.position.y = 0.27; g.add(pot);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.4, 6), trunk); stem.position.y = 1.2; g.add(stem);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0), leaf); crown.position.y = 2.25; g.add(crown);
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), leafLight); top.position.set(-0.2, 2.75, 0.15); g.add(top);
    g.position.set(x, 0, z); g.scale.setScalar(0.85 + rnd() * 0.4);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
  });
  const lampMat = flat('#334155'), bulbMat = new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#ffe08a', emissiveIntensity: 0.6 });
  for (let k = 0; k < 14; k++) {
    const u = 0.04 + k * 0.068, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const side = V(-t.z, 0, t.x).normalize().multiplyScalar(k % 2 ? 3.2 : -3.2);
    const x = p.x + side.x, z = p.z + side.z;
    if (nearStreet(z, 0)) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 6), lampMat); pole.position.set(x, 1.8, z); pole.castShadow = true; scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), lampMat);
    arm.position.set(x - side.x * 0.15, 3.55, z - side.z * 0.15); arm.lookAt(p.x, 3.55, p.z); scene.add(arm);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bulbMat); bulb.position.set(x - side.x * 0.14, 3.45, z - side.z * 0.14); scene.add(bulb);
  }
  scatterNearPath(8, 2.4, 3.2, 8).forEach(({ x, z, u }) => {
    const t = curve.getTangentAt(u), g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.45), flat('#8b5e3c')); seat.position.y = 0.45; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.06), flat('#8b5e3c')); back.position.set(0, 0.7, -0.2); g.add(back);
    [-0.6, 0.6].forEach(lx => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.4), lampMat); leg.position.set(lx, 0.22, 0); g.add(leg); });
    g.position.set(x, 0, z); g.lookAt(x + t.z * (distToPath(x + t.z, z - t.x) > distToPath(x, z) ? -1 : 1), 0, z - t.x);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  });
  // The start plaza: a fountain.
  {
    const fx = -15, fz = 51;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.6, 24), flat('#c7ccd3')); basin.position.set(fx, 0.3, fz); basin.receiveShadow = true; scene.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.1, 24), new THREE.MeshStandardMaterial({ color: '#7cc7ec', roughness: 0.1, metalness: 0.2 }));
    water.position.set(fx, 0.58, fz); scene.add(water);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.8, 10), flat('#d8dde3')); column.position.set(fx, 1.2, fz); scene.add(column);
  }
  // Traffic: little cars and taxis driving along the streets.
  const cars = [];
  const CAR_COLORS = ['#ef4444', '#f8fafc', '#3b82f6', '#facc15', '#10b981', '#111827', '#f97316'];
  STREETS.forEach((z, si) => {
    for (let k = 0; k < 7; k++) {
      const dir = k % 2 ? 1 : -1, color = CAR_COLORS[(k + si * 3) % CAR_COLORS.length];
      const g = new THREE.Group(), body = flat(color, { roughness: 0.4 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 1.05), body); base.position.y = 0.45; g.add(base);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 0.95), body); cab.position.set(-0.1, 0.92, 0); g.add(cab);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.3, 0.97), new THREE.MeshStandardMaterial({ color: '#a7c7e7', roughness: 0.1, metalness: 0.4 })); glass.position.set(-0.1, 0.95, 0); g.add(glass);
      if (color === '#facc15') { const sign = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.2), flat('#111827')); sign.position.set(-0.1, 1.22, 0); g.add(sign); }
      [[-0.7, -0.52], [0.7, -0.52], [-0.7, 0.52], [0.7, 0.52]].forEach(([wx, wz]) => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 10), flat('#1f2937')); wheel.rotation.x = Math.PI / 2; wheel.position.set(wx, 0.22, wz); g.add(wheel);
      });
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.rotation.y = dir > 0 ? 0 : Math.PI;
      scene.add(g);
      cars.push({ g, z: z + (dir > 0 ? 1.7 : -1.7), dir, x: -120 + k * 34 + rnd() * 10, speed: 6 + rnd() * 4 });
    }
  });
  function updateCars(dt) {
    cars.forEach(c => {
      if (!reduceMotion) c.x += c.dir * c.speed * dt;
      if (c.x > 130) c.x -= 260; if (c.x < -130) c.x += 260;
      c.g.position.set(c.x, 0, c.z);
    });
  }
  // A few clouds drifting over the skyline.
  const clouds = [];
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.92 });
  for (let k = 0; k < 9; k++) {
    const g = new THREE.Group();
    for (let m = 0; m < 5; m++) { const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + rnd() * 2.5, 1), cloudMat); puff.position.set((m - 2) * 3.2, rnd() * 1.4, rnd() * 2); puff.scale.y = 0.6; g.add(puff); }
    g.position.set(-150 + k * 36, 55 + rnd() * 20, -120 + rnd() * 140); scene.add(g);
    clouds.push(g);
  }

  // ── The HQ: a glass tower that lights up floor by floor ───────────────
  const HQ_W = 13, HQ_H = 46, HQ_D = 11, FLOORS = 14;
  const hqLit = { value: 0 }, hqGlow = { value: 0 };
  const hqMat = new THREE.ShaderMaterial({
    uniforms: { uLit: hqLit, uGlow: hqGlow, uH: { value: HQ_H } },
    vertexShader: `varying vec3 vPos; varying vec3 vN; varying vec2 vUv;
      void main(){ vPos = position; vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uLit; uniform float uGlow; uniform float uH; varying vec3 vPos; varying vec3 vN; varying vec2 vUv;
      void main(){
        float y = vPos.y + uH * 0.5;
        float floorF = y / (uH / ${FLOORS}.0);
        float fy = fract(floorF), fx = fract(vUv.x * 7.0);
        float pane = step(0.12, fy) * step(fy, 0.86) * step(0.08, fx) * step(fx, 0.92);
        float lit = step(floorF, uLit * ${FLOORS}.0 + 0.001);
        vec3 glass = mix(vec3(0.26, 0.42, 0.62), vec3(0.62, 0.78, 0.92), clamp(vN.y * 0.5 + 0.5 + vUv.y * 0.3, 0.0, 1.0));
        vec3 frame = vec3(0.16, 0.22, 0.3);
        vec3 warm = vec3(1.0, 0.86, 0.48) * (1.0 + uGlow * 0.5);
        vec3 col = mix(frame, mix(glass, warm, lit), pane);
        float light = 0.55 + 0.45 * max(0.0, dot(vN, normalize(vec3(-0.5, 0.7, 0.5))));
        col *= mix(light, 1.0, lit * pane);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const hq = new THREE.Group(); hq.position.copy(HQ); scene.add(hq);
  {
    const towerGeo = new THREE.BoxGeometry(HQ_W, HQ_H, HQ_D);
    const tower = new THREE.Mesh(towerGeo, hqMat); tower.position.y = HQ_H / 2; tower.castShadow = true; hq.add(tower);
    // the boardroom crown, an antenna and a beacon
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(HQ_W * 0.5, HQ_W * 0.62, 3, 4, 1), flat('#24476b', { metalness: 0.4 }));
    crown.rotation.y = Math.PI / 4; crown.scale.z = HQ_D / HQ_W; crown.position.y = HQ_H + 1.5; hq.add(crown);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 9, 6), flat('#cbd5e1')); mast.position.y = HQ_H + 7.5; hq.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff4d4d' })); beacon.position.y = HQ_H + 12.2; hq.add(beacon);
    hq.userData.beacon = beacon;
    // the lobby: a stone base, glass doors, a canopy and the company sign
    const base = new THREE.Mesh(new THREE.BoxGeometry(HQ_W + 2, 4, HQ_D + 2), flat('#e2e5ea')); base.position.y = 2; base.castShadow = true; base.receiveShadow = true; hq.add(base);
    const doors = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3, 0.2), new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.1, metalness: 0.5 }));
    doors.position.set(0, 1.5, HQ_D / 2 + 1.05); hq.add(doors);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.25, 2.6), flat('#1e3a5f')); canopy.position.set(0, 3.4, HQ_D / 2 + 2.2); canopy.castShadow = true; hq.add(canopy);
    const signTex = canvasTexture(512, 128, (g, w, h) => {
      g.fillStyle = '#1e3a5f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fde68a'; g.font = '900 72px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('HQ', w / 2, h / 2 + 4);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(0, 4.85, HQ_D / 2 + 1.02); hq.add(sign);
    // a red carpet out to the sidewalk, flanked by potted trees
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 8), flat('#b91c1c')); carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.04, HQ_D / 2 + 5); hq.add(carpet);
    [-2.6, 2.6].forEach(px => [3.4, 7.4].forEach(pz => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.8, 10), flat('#e5e7eb')); pot.position.set(px, 0.4, HQ_D / 2 + pz); hq.add(pot);
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), leaf); bush.position.set(px, 1.3, HQ_D / 2 + pz); hq.add(bush);
    }));
    hq.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  }
  const meetPoint = HQ.clone().add(V(0, 0, HQ_D / 2 + 5.2)); // where the deal is done
  // the signing table with the contract
  const table = new THREE.Group();
  {
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.8), flat('#6b4a2e')); top.position.y = 0.95; table.add(top);
    [-0.8, 0.8].forEach(x => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.7), flat('#4b3520')); leg.position.set(x, 0.47, 0); table.add(leg); });
    const contract = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), new THREE.MeshStandardMaterial({ map: canvasTexture(64, 84, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#cbd5e1'; for (let y = 10; y < h - 22; y += 7) g.fillRect(8, y, w - 16, 3);
      g.strokeStyle = '#1d4ed8'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, h - 12); g.bezierCurveTo(20, h - 22, 28, h - 4, 48, h - 14); g.stroke();
    }) }));
    contract.rotation.x = -Math.PI / 2; contract.position.set(0.1, 1.0, 0); table.add(contract);
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), flat('#111827')); pen.rotation.z = Math.PI / 2; pen.rotation.y = 0.5; pen.position.set(0.5, 1.01, 0.1); table.add(pen);
    table.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  table.position.copy(meetPoint).add(V(1.7, 0, -0.4)); table.rotation.y = Math.PI / 2; scene.add(table);

  // ── Checkpoints: one KPI billboard per task ───────────────────────────
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
      g.fillStyle = status === 'done' ? '#0f9f6e' : '#ffffff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = status === 'next' ? '#f59e0b' : '#334155'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
      if (status === 'done') {
        g.strokeStyle = '#ffffff'; g.lineWidth = 18; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(60, 84); g.lineTo(100, 120); g.lineTo(150, 44); g.stroke();
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(196, 40); g.lineTo(222, 74); g.lineTo(206, 74); g.lineTo(206, 120); g.lineTo(186, 120); g.lineTo(186, 74); g.lineTo(170, 74); g.closePath(); g.fill();
      } else {
        [36, 58, 46, 80].forEach((bh, k) => { g.fillStyle = status === 'next' ? '#f59e0b' : '#94a3b8'; g.fillRect(30 + k * 34, 130 - bh, 22, bh); });
        g.fillStyle = '#1f2937'; g.font = '900 64px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i + 1), 205, 84);
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
      group.position.copy(p).addScaledVector(side, 2.6);
      group.rotation.y = Math.atan2(-side.x, -side.z) + Math.PI;
      [-0.7, 0.7].forEach(x => { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), lampMat); post.position.set(x, 1.1, 0); group.add(post); });
      const spin = new THREE.Group(); spin.position.y = 2.55; group.add(spin);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.5, 0.12), flat('#334155')); spin.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.14, 1.34), new THREE.MeshStandardMaterial({ roughness: 0.6 })); face.position.z = 0.065; spin.add(face);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(2.14, 1.34), face.material); back.position.z = -0.065; back.rotation.y = Math.PI; spin.add(back);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      badge.position.set(0, 3.75, 0); badge.scale.setScalar(0.55); group.add(badge);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 40), new THREE.MeshBasicMaterial({ color: STATUS.next, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; group.add(ring);
      group.traverse(o => { if (o.isMesh && o !== ring) o.castShadow = true; });
      scene.add(group);
      flags.push({ group, spin, face, badge, ring, pop: 0, turn: 0, status: '' });
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
      f.ring.visible = status === 'next';
    });
    progressTarget = tasks.length ? doneCount / tasks.length : 0;
  }

  // ── Blockers: red tape, angry emails, ringing clocks, rival execs ─────
  const stampTex = canvasTexture(256, 96, (g, w, h) => {
    g.strokeStyle = '#16a34a'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#16a34a'; g.font = '900 52px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('APPROVED', w / 2, h / 2 + 3);
  });
  const angryTex = canvasTexture(128, 96, (g) => {
    g.strokeStyle = '#1f2937'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(22, 24); g.lineTo(52, 38); g.moveTo(106, 24); g.lineTo(76, 38); g.stroke();
    g.fillStyle = '#1f2937'; g.beginPath(); g.arc(42, 50, 8, 0, Math.PI * 2); g.arc(86, 50, 8, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(44, 82); g.quadraticCurveTo(64, 66, 84, 82); g.stroke();
  });
  function finishFoe(g, kind, body, extra = {}) {
    const mats = [];
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); if (o.material.emissive) mats.push(o.material); } });
    scene.add(g);
    return { kind, g, body, mats, ...extra };
  }
  function buildPaperwork() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const sheet = flat('#fffaf0', { flatShading: false });
    for (let k = 0; k < 7; k++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.66), sheet);
      s.position.set((rnd() - 0.5) * 0.12, 0.1 + k * 0.19, (rnd() - 0.5) * 0.12); s.rotation.y = (rnd() - 0.5) * 0.4; body.add(s);
    }
    const tape = flat('#dc2626');
    const band1 = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.42, 0.08), tape); band1.position.y = 0.72; band1.rotation.y = 0.6; body.add(band1);
    const band2 = band1.clone(); band2.rotation.y = -0.6; body.add(band2);
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 12), flat('#991b1b')); seal.position.set(0, 1.45, 0); body.add(seal);
    return finishFoe(g, 'paper', body);
  }
  function buildEmail() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const env = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.12), flat('#ffffff', { flatShading: false })); body.add(env);
    const flapShape = new THREE.Shape(); flapShape.moveTo(-0.6, 0.4); flapShape.lineTo(0.6, 0.4); flapShape.lineTo(0, -0.08); flapShape.closePath();
    const flap = new THREE.Mesh(new THREE.ShapeGeometry(flapShape), flat('#e2e8f0', { side: THREE.DoubleSide })); flap.position.z = 0.065; body.add(flap);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshBasicMaterial({ map: angryTex, transparent: true })); face.position.set(0, -0.12, 0.07); body.add(face);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), flat('#ef4444')); dot.position.set(0.58, 0.4, 0.06); body.add(dot);
    body.position.y = 1.3;
    return finishFoe(g, 'email', body);
  }
  function buildClock() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const red = flat('#ef4444', { flatShading: false });
    const caseM = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 20), red); caseM.rotation.x = Math.PI / 2; body.add(caseM);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), flat('#ffffff')); dial.position.z = 0.16; body.add(dial);
    const hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.02), flat('#111827')); hand1.position.set(0, 0.13, 0.18); body.add(hand1);
    const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.02), flat('#111827')); hand2.position.set(0.09, 0, 0.18); body.add(hand2);
    [-1, 1].forEach(s => {
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), flat('#f59e0b', { metalness: 0.5 })); bell.position.set(s * 0.34, 0.48, 0); bell.rotation.z = -s * 0.5; body.add(bell);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.3, 5), flat('#374151')); leg.position.set(s * 0.3, -0.58, 0); leg.rotation.z = s * 0.4; body.add(leg);
    });
    body.position.y = 0.95; body.scale.setScalar(1.2);
    return finishFoe(g, 'clock', body);
  }
  let clips = [];
  function buildRival() {
    const obj = SkeletonUtils.clone(rivalSrc);
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const box = new THREE.Box3().setFromObject(obj);
    obj.scale.multiplyScalar(CHAR_H * 1.02 / (box.max.y - box.min.y));
    body.add(obj);
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {}; clips.forEach(c => { actions[c.name] = mixer.clipAction(c); });
    const ch = { holder: g, obj, mixer, actions, current: null };
    play(ch, 'Blocking', { fade: 0 }); mixer.update(rnd() * 2);
    const mats = [];
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); mats.push(o.material); } });
    scene.add(g);
    return { kind: 'rival', g, body, mats, ch };
  }
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6b5e'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  // Every task's obstacles: one blocker per obstacle point, in rows across
  // the sidewalk in front of the billboard (paperwork, emails, clocks and,
  // at most one per wall, a rival executive).
  const walls = [];
  function buildWalls() {
    walls.forEach(w => { w.foes.forEach(f => { scene.remove(f.g); if (f.stamp) scene.remove(f.stamp); }); scene.remove(w.lock, w.ring, w.tag); });
    walls.length = 0;
    tasks.forEach((t, i) => {
      if (!t.foeList.length) return;
      const u = wallFrac(i), p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = V(-tan.z, 0, tan.x).normalize();
      const face = Math.atan2(-tan.x, -tan.z);
      const n = Math.min(t.foeList.length, 5);
      const owners = pickFoes(t.foeList, n);
      const kinds = ['paper', 'email', 'clock', 'rival'];
      const foes = Array.from({ length: n }, (_, k) => {
        const kind = kinds[(k + i) % 4] === 'rival' && k > 0 ? 'paper' : kinds[(k + i) % 4];
        const f = kind === 'paper' ? buildPaperwork() : kind === 'email' ? buildEmail() : kind === 'clock' ? buildClock() : buildRival();
        const row = Math.floor(k / 3), inRow = Math.min(3, n - row * 3), col = k % 3;
        const home = p.clone().addScaledVector(side, (col - (inRow - 1) / 2) * 1.15).addScaledVector(tan, row * 1.2);
        f.g.position.copy(home); f.g.rotation.y = face;
        const stamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: stampTex, transparent: true, opacity: 0, depthWrite: false }));
        stamp.scale.set(1.3, 0.49, 1); stamp.visible = false; scene.add(stamp);
        // owner: the obstacle this blocker stands for; ticked once it's resolved
        const ticked = owners[k].resolved;
        if (ticked) f.g.visible = false;
        return Object.assign(f, { home, face, stamp, ph: rnd() * 6, delay: k * 0.6, done: ticked, swung: ticked, owner: owners[k].id, ticked, tickT: 0 });
      });
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.copy(p).setY(2.9); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
      tag.position.copy(p).setY(3.55); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.4, 48), new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(p).setY(0.09); scene.add(ring);
      const w = { taskIndex: i, foes, lock, tag, ring, center: p.clone(), cleared: !!t.done, clearing: false, t: t.done ? 99 : 0, open: !t.foes, fade: t.done || !t.foes ? 1 : 0 };
      if (w.cleared) foes.forEach(f => { f.g.visible = false; f.done = true; });
      if (w.fade) lock.visible = tag.visible = ring.visible = false;
      walls.push(w);
    });
  }
  const standing = w => w.foes.filter(f => !f.ticked);
  const wallPause = w => 0.8 + 0.6 * Math.max(1, standing(w).length);
  function clearWall(w) {
    if (w.cleared) return;
    w.cleared = true; w.t = 0;
    standing(w).forEach((f, j) => { f.delay = j * 0.6; });
    if (reduceMotion) { w.t = 99; w.foes.forEach(f => { f.g.visible = false; f.done = true; }); }
    notify();
  }
  function restoreWall(w) {
    w.cleared = false; w.clearing = false; w.t = 0;
    w.foes.forEach(f => { if (!f.ticked) reviveFoe(f); });
  }
  function reviveFoe(f) {
    Object.assign(f, { done: false, swung: false, ticked: false, tickT: 0 });
    f.g.visible = true; f.g.position.copy(f.home); f.g.rotation.set(0, f.face, 0); f.g.scale.setScalar(1);
    f.body.rotation.set(0, 0, 0);
    f.mats.forEach(m => m.emissive && m.emissive.setRGB(0, 0, 0));
    f.stamp.visible = false; f.stamp.material.opacity = 0;
    if (f.ch) play(f.ch, 'Blocking', { fade: 0.2 });
  }
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  // An obstacle ticked off (or unticked) on its own: its blockers are
  // stamped APPROVED and whisked away (or come back), and its name pops up.
  function applyResolves(changes) {
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.center.clone() : curve.getPointAt(wallFrac(c.index));
      if (c.resolved) { timers.push(setTimeout(() => shell.spawnTaskLabel(at.clone().setY(4.2), c.name, 'foe', CLEARED), j * 450)); peek.at.copy(at); peek.t = 3.4; }
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
  function idleFoe(f, time) {
    const t = time + f.ph;
    if (f.kind === 'paper') { f.body.rotation.z = Math.sin(t * 1.3) * 0.05; f.body.position.y = 0; }
    else if (f.kind === 'email') { f.body.position.y = 1.3 + Math.sin(t * 2) * 0.12; f.body.rotation.y = Math.sin(t * 0.9) * 0.3; }
    else if (f.kind === 'clock') { const ring = (t % 2.6) < 1.1; f.body.rotation.z = ring ? Math.sin(t * 60) * 0.12 : 0; f.body.position.y = 0.95 + (ring ? Math.abs(Math.sin(t * 30)) * 0.04 : 0); }
  }
  // Stamped and whisked away: lt is the time since this blocker's turn came.
  function stampFoe(f, lt, time) {
    if (lt < 0) { idleFoe(f, time); return; }
    if (!f.swung) {
      f.swung = true;
      f.stamp.visible = true; f.stamp.material.opacity = 0;
      if (person && !f.ticked) {
        P.heading = Math.atan2(f.home.x - person.holder.position.x, f.home.z - person.holder.position.z);
        person.holder.rotation.y = P.heading;
        play(person, 'Interact', { fade: 0.12, once: true, timeScale: 1.3 });
      }
    }
    const top = f.kind === 'email' ? 2.4 : f.kind === 'rival' ? 2.3 : 2.0;
    // the stamp drops onto the blocker and thumps
    const drop = smooth(0, 0.3, lt);
    f.stamp.position.copy(f.home).setY(top + 1.6 - drop * 1.1);
    f.stamp.material.opacity = Math.min(1, lt * 5) * (1 - smooth(1.2, 1.7, lt));
    const s = 1.3 * (1 + (lt > 0.3 && lt < 0.45 ? 0.25 : 0));
    f.stamp.scale.set(s, s * 0.377, 1);
    if (lt > 0.3 && !f.hit) { f.hit = true; sparkle(f.home.clone().setY(top - 0.3), 26, ['#86efac', '#ffffff'], 3); if (!f.ticked) cam.shake = 0.12; }
    const flash = lt > 0.3 ? Math.max(0, 1 - (lt - 0.3) * 3) : 0;
    f.mats.forEach(m => m.emissive && m.emissive.setRGB(flash * 0.2, flash, flash * 0.3));
    // then it's swept up and away
    if (lt > 0.55) {
      const q = smooth(0.55, 1.3, lt);
      f.g.position.copy(f.home).add(V(0, q * 3.2, 0));
      f.g.rotation.y = f.face + q * 6;
      f.g.scale.setScalar(Math.max(0.01, 1 - q * 0.9));
    }
    if (lt >= 1.3 && !f.done) {
      f.done = true; f.g.visible = false;
      paperBurst(f.home.clone().setY(2.6), 22, 3);
    }
    if (lt > 1.8) f.stamp.visible = false;
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      w.foes.forEach(f => { if (f.ch && f.g.visible) f.ch.mixer.update(dt); });
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.6, 0, 1);
      w.lock.material.opacity = w.tag.material.opacity = 1 - w.fade;
      w.ring.material.opacity = (shut ? 0.35 + 0.25 * Math.sin(time * 4) : 0.55) * (1 - w.fade);
      w.lock.visible = w.tag.visible = w.ring.visible = w.fade < 1;
      if (shut) w.lock.position.y = 2.9 + Math.sin(time * 2.2) * 0.08;
      if (w.cleared && w.t <= 60) w.t += dt;
      w.foes.forEach(f => {
        if (f.done && !f.stamp.visible) return;
        if (f.ticked) { f.tickT += dt; stampFoe(f, f.tickT, time); return; }
        if (w.cleared) stampFoe(f, w.t - f.delay, time);
        else idleFoe(f, time);
      });
    });
  }

  // ── The people ────────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  let person = null, partner = null, rivalSrc = null;
  const STRIP = ['Knight_Helmet', 'Knight_Cape', '1H_Sword', 'Badge_Shield'];
  // Re-dyes the knight into a suit: armour → suit colour, leather → dark
  // brown, the red rosette → a white pocket square; hair to taste.
  function suitUp(obj, suitHue, suitSat, suitBase, hairHue) {
    STRIP.forEach(n => { const o = obj.getObjectByName(n); if (o) o.removeFromParent(); });
    recolorCharacter(obj, (h, s, l) => {
      if (s < 0.16 && l > 0.16 && l < 0.86) return [suitHue, suitSat, suitBase + l * 0.17];
      if (h > 12 && h < 45 && s > 0.3 && l < 0.6) return [25, 0.25, 0.08 + l * 0.12];
      if ((h > 340 || h < 12) && s > 0.4) return [210, 0.1, 0.9];
      if (hairHue !== undefined && h > 38 && h < 60 && s > 0.2 && l > 0.45) return [hairHue, 0.5, l * 0.45];
      return null;
    });
  }
  function shirtAndTie(tieColor) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = '#f8fafc'; x.beginPath(); x.moveTo(8, 0); x.lineTo(120, 0); x.lineTo(64, 150); x.closePath(); x.fill();
    x.fillStyle = tieColor; x.beginPath(); x.moveTo(52, 6); x.lineTo(76, 6); x.lineTo(70, 30); x.lineTo(58, 30); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(58, 30); x.lineTo(70, 30); x.lineTo(80, 118); x.lineTo(64, 138); x.lineTo(48, 118); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(60, 34, 4, 80);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(CHAR_H * 0.15, CHAR_H * 0.19), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.6 }));
  }
  function dress(ch, tieColor, briefcase) {
    const obj = ch.obj; obj.updateMatrixWorld(true);
    const chest = findBone(obj, 'chest');
    if (chest) {
      const cp = new THREE.Vector3(); chest.getWorldPosition(cp);
      const front = shirtAndTie(tieColor); front.rotation.x = -0.18;
      attachToBone(obj, chest, front, cp.clone().add(V(0, CHAR_H * 0.06, CHAR_H * 0.15)));
    }
    const hand = findBone(obj, 'handslotr');
    if (hand && briefcase) {
      const hp = new THREE.Vector3(); hand.getWorldPosition(hp);
      const bc = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(CHAR_H * 0.2, CHAR_H * 0.15, CHAR_H * 0.06), new THREE.MeshStandardMaterial({ color: '#7c4a1e', roughness: 0.55 })); box.position.y = -CHAR_H * 0.1; bc.add(box);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(CHAR_H * 0.035, CHAR_H * 0.008, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: '#3f2410' })); handle.position.y = -CHAR_H * 0.025; bc.add(handle);
      const clasp = new THREE.Mesh(new THREE.BoxGeometry(CHAR_H * 0.03, CHAR_H * 0.02, CHAR_H * 0.065), new THREE.MeshStandardMaterial({ color: '#d4a24c', metalness: 0.8, roughness: 0.3 })); clasp.position.y = -CHAR_H * 0.05; bc.add(clasp);
      bc.traverse(o => { if (o.isMesh) o.castShadow = true; });
      attachToBone(obj, hand, bc, hp);
    }
  }

  // ── Walking the sidewalk ──────────────────────────────────────────────
  const walker = createWalker({
    curve, speed: 3.6, accel: 7, brakeDecel: 6, reduceMotion, getTasks: () => tasks, walls,
    hooks: {
      stopFrac: foeStopFrac, wallPause,
      place(frac) {
        const p = curve.getPointAt(THREE.MathUtils.clamp(frac, 0, 1));
        person.holder.position.set(p.x, 0.05, p.z);
        person.holder.rotation.y = P.heading;
      },
      runAnim(k) { play(person, k > 0.7 ? 'Running_A' : 'Walking_A', { fade: 0.3, timeScale: k > 0.7 ? 0.8 : 1.2 }); },
      idleAnim(pause, tick) {
        if (tick) { if (finished(person)) play(person, 'Idle', { fade: 0.4 }); return; }
        if (pause && person.current !== person.actions.Running_A && person.current !== person.actions.Walking_A) return;
        play(person, 'Idle', { fade: 0.35 });
      },
      onFlag(i, t) {
        const f = flags[i];
        if (!f) return;
        f.pop = 1; f.turn = 1;
        sparkle(f.group.position.clone().add(V(0, 2.6, 0)), 46, ['#86efac', '#ffffff', '#fde68a'], 3.4);
        paperBurst(f.group.position.clone().add(V(0, 3, 0)), 12, 2);
        if (P.mode !== 'finale') play(person, 'Cheer', { fade: 0.2, once: true, timeScale: 1.2 });
        shell.spawnTaskLabel(f.group.position.clone().add(V(0, 4.3, 0)), t.title);
      },
      clearWall, restoreWall,
      startFinale, undoFinale: undoVictory, updateFinale, updateVictory,
    },
  });
  const P = walker.P;

  // ── Finale: the handshake at HQ ───────────────────────────────────────
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  const partnerSpot = meetPoint.clone().add(V(0, 0.05, -0.9));
  const shakeSpot = meetPoint.clone().add(V(0, 0.05, 0.35));
  function startFinale() {
    if (P.won) return;
    P.mode = 'finale'; P.finT = 0;
    P.fin = { from: person.holder.position.clone(), steps: new Set() };
    if (reduceMotion) { settleWon(); victory(); }
  }
  function updateFinale(dt) {
    const t = (P.finT += dt), F = P.fin;
    if (t < 2.2) {
      once('walk', () => play(person, 'Walking_A', { fade: 0.3, timeScale: 1.2 }));
      const k = smooth(0, 2.2, t);
      person.holder.position.lerpVectors(F.from, shakeSpot, k);
      const toward = Math.atan2(shakeSpot.x - F.from.x, shakeSpot.z - F.from.z);
      P.heading = angleLerp(P.heading, toward, Math.min(1, dt * 6));
    } else {
      P.heading = angleLerp(P.heading, Math.PI, Math.min(1, dt * 6));
      once('shake', () => {
        play(person, 'Interact', { fade: 0.2, once: true });
        if (partner) play(partner, 'Interact', { fade: 0.2, once: true });
      });
    }
    person.holder.rotation.y = P.heading;
    if (t > 2.9) once('stamp', () => {
      cam.shake = 0.2;
      sparkle(table.position.clone().add(V(0, 1.2, 0)), 60, ['#86efac', '#fde68a', '#ffffff'], 4);
    });
    if (t > 3.0) hqLit.value = Math.min(1, hqLit.value + dt * 0.6);
    if (t > 3.2) once('rain', () => paperRain(meetPoint.clone()));
    if (t > 4.4) once('win', victory);
  }
  function victory() {
    P.won = true;
    if (celebrationsOn) shell.showWin();
    play(person, 'Cheer', { fade: 0.3 });
    if (partner) play(partner, 'Cheer', { fade: 0.3 });
    P.mode = 'victory'; P.vicT = 0;
    notify();
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; timers.push(setTimeout(cb, celebrationsOn ? 1800 : 0)); }
  }
  function updateVictory(dt) {
    P.vicT = (P.vicT || 0) + dt;
    hqLit.value = Math.min(1, hqLit.value + dt * 0.6);
    hqGlow.value = 0.5 + 0.5 * Math.sin(P.vicT * 2);
    const toCam = Math.atan2(camera.position.x - person.holder.position.x, camera.position.z - person.holder.position.z);
    P.heading = angleLerp(P.heading, toCam, Math.min(1, dt * 2.5)); person.holder.rotation.y = P.heading;
    if (P.vicT > 6 && person.current === person.actions.Cheer) { play(person, 'Idle', { fade: 0.5 }); if (partner) play(partner, 'Idle', { fade: 0.5 }); }
    if (!reduceMotion && celebrationsOn && rnd() < dt * 3) sparkle(HQ.clone().add(V((rnd() - 0.5) * 12, HQ_H + 4 + rnd() * 6, HQ_D / 2)), 30, ['#fde68a', '#93c5fd', '#86efac'], 5);
  }
  function settleWon() {
    person.holder.position.copy(shakeSpot);
    P.heading = Math.PI; person.holder.rotation.y = P.heading;
    hqLit.value = 1;
    P.fin = { steps: new Set(['walk', 'shake', 'stamp', 'rain', 'win']) };
    P.won = true; P.mode = 'victory'; P.vicT = 99;
    play(person, 'Idle', { fade: 0 });
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; shell.winEl.hidden = true;
    hqGlow.value = 0;
    play(person, 'Idle', { fade: 0.2 });
    if (partner) play(partner, 'Idle', { fade: 0.2 });
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  const cam = { look: V(0, 1, 20), shake: 0 };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  const peek = { at: new THREE.Vector3(), t: 0 };
  function updateCamera(dt) {
    if (!person) return;
    const pp = person.holder.position;
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading));
    let rate = 3;
    if (P.mode === 'finale' || P.mode === 'victory') {
      camDesired.copy(meetPoint).add(V(-1.2, 4.2, 10.5));
      lookDesired.copy(meetPoint).add(V(0, P.mode === 'victory' ? 2.5 + Math.min(1, (P.vicT || 0) / 3) * 5 : 1.4, -1.5));
      rate = 1.8;
    } else if (shell.cam.mode === 'overview') {
      camDesired.set(46, 52, 46);
      lookDesired.set(0, 0, -4);
    } else {
      const side = V(fwd.z, 0, -fwd.x);
      const orbit = P.mode === 'idle' ? Math.sin(performance.now() / 4000) * 1.4 : 0;
      camDesired.copy(pp).addScaledVector(fwd, -6.4).addScaledVector(side, 1.8 + orbit).setY(3.4);
      lookDesired.copy(pp).addScaledVector(fwd, 3.5).setY(1.1);
      peekCamera(peek, pp, camDesired, lookDesired, dt, 9, 4.5, 2.2);
    }
    const k = 1 - Math.exp(-dt * rate);
    camera.position.lerp(camDesired, k);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
    if (cam.shake > 0 && !reduceMotion) { camera.position.add(rand3(cam.shake * 0.25)); cam.shake = Math.max(0, cam.shake - dt); }
    sun.target.position.copy(pp); sun.position.copy(pp).addScaledVector(sunDir, 60);
  }

  // ── Ghost, label, state ──────────────────────────────────────────────
  let ghost = null;
  function updateGhost(g) {
    if (!person) return;
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) {
      const obj = SkeletonUtils.clone(person.obj);
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
    ghost.holder.position.copy(p).addScaledVector(V(-t.z, 0, t.x).normalize(), -0.9).setY(0.05);
    ghost.holder.rotation.y = Math.atan2(t.x, t.z);
  }
  function notify() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Corporate Journey: ${done} of ${n} tasks done.` : 'Corporate Journey: no tasks yet.';
    const blocked = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= walker.progressToFrac(done, n) + 1e-3);
    if (blocked) text += ` Held up by: ${tasks[blocked.taskIndex].blocker}.`;
    if (n && done === n) text += P.won ? ' The deal is closed!' : ' Heading into the boardroom.';
    shell.root.setAttribute('aria-label', text);
  }
  let latestState = null, layoutSig = null;
  function snapCamera() {
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading)), pp = person.holder.position;
    camera.position.copy(pp).addScaledVector(fwd, -6.4).setY(3.4);
    cam.look.copy(pp).addScaledVector(fwd, 3.5).setY(1.1);
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
      tasks.forEach((t, i) => { if (t.done) flags[i].turn = 0; });
      walker.reset();
      play(person, 'Idle', { fade: 0.2 });
      progressShown = progressTarget;
      hqLit.value = progressTarget * 0.85;
      if (n && tasks.every(t => t.done)) settleWon();
      if (firstBuild) snapCamera();
    } else {
      const changes = resolveChanges(tasks, next);
      next.forEach((t, i) => { tasks[i].done = t.done; tasks[i].title = t.title; tasks[i].blocker = t.blocker; tasks[i].foes = t.foes; tasks[i].foeList = t.foeList; });
      if (changes.length) applyResolves(changes);
      refreshFlags();
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
    if (person) { person.mixer.update(dt); walker.update(dt); }
    if (partner) {
      partner.mixer.update(dt);
      if (P.mode !== 'finale' && P.mode !== 'victory' && partner.current !== partner.actions.Idle) play(partner, 'Idle', { fade: 0.4 });
    }
    updateWalls(dt, time);
    updateCars(dt);
    clouds.forEach((c, k) => { if (!reduceMotion) c.position.x += dt * (0.6 + (k % 3) * 0.2); if (c.position.x > 170) c.position.x -= 340; });
    flags.forEach(f => {
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); f.group.scale.setScalar(1 + Math.sin((1 - f.pop) * Math.PI) * 0.2); }
      if (f.turn > 0) { f.turn = Math.max(0, f.turn - dt * 0.9); f.spin.rotation.y = (1 - f.turn) * Math.PI * 2 * (f.turn > 0 ? 1 : 0); }
      if (f.ring.visible) { f.ring.scale.setScalar(1 + 0.15 * Math.sin(time * 4)); f.ring.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); }
    });
    // the gold line along the sidewalk and the lit floors follow progress
    progressShown += (progressTarget - progressShown) * Math.min(1, dt * 1.5);
    const shownFrac = progressShown >= 0.999 ? 1 : walker.progressToFrac(Math.round(progressShown * tasks.length), tasks.length) * (progressShown > 0 ? 1 : 0);
    progressLine.geometry.setDrawRange(0, Math.floor(Math.min(1, shownFrac) * 420) * 6);
    if (P.mode !== 'finale' && P.mode !== 'victory') hqLit.value += (progressTarget * 0.85 - hqLit.value) * Math.min(1, dt * 1.2);
    hq.userData.beacon.visible = Math.floor(time * 1.4) % 2 === 0;
    sparks.update(dt); papers.update(dt);
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
    updateCamera(dt);
    shell.updateTaskLabels(camera);
  }
  const loop = createLoop(shell, camera, scene, simulate, (w, h) => { scaleU.value = particleScaleFor(renderer, camera, h); });

  loadGLTF(loader, PERSON_URL).then(gltf => {
    if (loop.destroyed) return;
    clips = gltf.animations;
    const personSrc = gltf.scene;
    // the rival executives: a charcoal suit and grey hair (built from a
    // clone before the hero's own colours go on)
    rivalSrc = SkeletonUtils.clone(personSrc);
    suitUp(rivalSrc, 220, 0.06, 0.1, 30);
    rivalSrc.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
    const partnerObj = SkeletonUtils.clone(personSrc);
    suitUp(partnerObj, 160, 0.35, 0.08, 20);
    suitUp(personSrc, 222, 0.42, 0.11);
    person = makeCharacter(scene, personSrc, clips, CHAR_H);
    dress(person, '#c81e33', true);
    partner = makeCharacter(scene, partnerObj, clips, CHAR_H);
    dress(partner, '#1d4ed8', false);
    partner.holder.position.copy(partnerSpot); partner.holder.rotation.y = 0;
    play(person, 'Idle', { fade: 0 });
    play(partner, 'Idle', { fade: 0 });
    shell.loadingEl.hidden = true;
    loop.setReady();
    if (latestState) applyState(latestState);
    loop.start();
  }).catch(err => {
    console.error('Corporate 3D: could not load the people', err);
    shell.loadingEl.textContent = 'Couldn’t load the 3D office. Switch the scene to Corporate for the 2D version.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (person) applyState(state);
    },
    pause: loop.stop,
    resume: loop.start,
    destroy() { loop.destroy(container); },
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) simulate(1 / 30); },
      get state() {
        return {
          ready: !!person, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length, finT: P.finT,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)),
          walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, foes: w.foes.length, gone: w.foes.filter(f => f.ticked).length, open: !!w.open })),
          lit: +hqLit.value.toFixed(2), ghost: ghost ? ghost.holder.visible : false, label: shell.root.getAttribute('aria-label'),
          onPath: person && P.mode !== 'finale' && P.mode !== 'victory' ? (() => { let d = 1e9; for (let i = 0; i <= 400; i++) d = Math.min(d, curve.getPointAt(i / 400).distanceTo(tmpV.copy(person.holder.position).setY(0))); return d; })() : 0,
        };
      },
    },
  };
}
