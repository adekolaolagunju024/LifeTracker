// ── JOURNEY 3D: PRODUCT LAUNCH STAGE ("Idea to Happy Customers", WebGL / three.js) ──
// A founder walks a product from idea to launch through five districts:
// the Idea Lab (a giant glowing lightbulb), the Workshop (a turning gear
// and a workbench), the Factory (chimneys and a conveyor of boxes), the
// Marketplace (striped market stalls) and, at the end, the launch stage
// where the happy customers wait. Each district's sign lights up as the
// founder reaches it. Each task is a launch-pad milestone sign with a mini
// rocket on top that fires when the task is done.
//
// The product on the launch stage grows up with progress (an idea, a
// blueprint, a prototype, a boxed product and finally a rocket), and the
// stage's big screen fills a five-star review meter, star by star.
//
// Blockers are budget cuts (a money bag with wings), bugs, a falling sales
// chart, an unhappy-customer storm cloud and a rival's billboard. Each is
// FIXED in its own way: the bag turns to gold coins, the bug is squashed,
// the chart flips to a rising one, the storm turns into a smiling sun and
// the billboard topples over. The finale: the founder presses launch, the
// product rockets up over the stage, the confetti cannons fire and the
// crowd cheers, "Launch Success!".
//
// Loaded on demand by journeyGame.js (the "Product Launch 3D" theme), which
// falls back to the 2D Product Launch stage without WebGL. Same sync()
// contract as the other 3D stages. The founder is the KayKit Knight (CC0)
// dressed in code as a hoodie-and-jeans founder with a laptop; everything
// else is built here from primitives.
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
const CLEARED = 'FIXED!';

export function createLaunch3D(container) {
  const shell = createShell(container, {
    label: 'Product Launch Journey in 3D', background: '#d8ccf5', loadingText: 'Setting up the launch…',
    winTitle: 'Launch Success!', winText: 'Customers love it ★★★★★', winFill: '#fde047', winEdge: '#5b21b6',
  });
  const { renderer, reduceMotion, timers } = shell;
  renderer.toneMappingExposure = 1.0;
  const canvasTexture = makeCanvasTexture(renderer);
  const rnd = seededRandom(57);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra });
  const glow = (color, intensity = 0.8) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  const tmpV = new THREE.Vector3();
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);
  const shadowAll = g => g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;

  // ── The route: a winding promenade from the Idea Lab to the launch stage ──
  const PATH_XZ = [[-12, 48], [-2, 42], [7, 34], [8, 24], [0, 16], [-9, 8], [-11, -2], [-3, -10], [8, -16], [10, -26], [4, -33], [0, -38]];
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
  const STAGE = V(0, 0, -47);

  // ── Scene, sky, light ─────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d8ccf5');
  scene.fog = new THREE.Fog('#efe4fb', 80, 240);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  camera.position.set(-16, 6, 58);
  const hemi = new THREE.HemisphereLight('#fdf4ff', '#7fae8a', 1.35);
  scene.add(hemi);
  const sunDir = V(0.5, 0.8, 0.35).normalize();
  const sun = new THREE.DirectionalLight('#fff4e0', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 150 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 col = mix(vec3(1.0, 0.82, 0.86), vec3(0.83, 0.78, 0.98), smoothstep(0.0, 0.2, h));
        col = mix(col, vec3(0.45, 0.62, 0.95), smoothstep(0.2, 0.8, h));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(sky);
  const glowTex = softDotTexture(canvasTexture);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff4d6', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  sunGlow.position.copy(sunDir).multiplyScalar(420); sunGlow.scale.setScalar(110); scene.add(sunGlow);

  // ── The ground: lawns, a pastel promenade and a gold progress line ─────
  const lawnTex = canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#a9dcb4'; g.fillRect(0, 0, w, w);
    for (let k = 0; k < 900; k++) {
      g.fillStyle = k % 3 ? 'rgba(120,190,140,0.5)' : 'rgba(200,240,205,0.5)';
      g.fillRect(rnd() * w, rnd() * w, 2, 3);
    }
  }, { repeat: true });
  lawnTex.repeat.set(70, 70);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ map: lawnTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
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
    g.fillStyle = '#f5f0ff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e6dcfb';
    for (let x = 0; x < w; x += 32) for (let y = 8; y < h - 8; y += 16) g.fillRect(x + ((y / 16) % 2) * 16 + 2, y + 2, 28, 12);
    g.fillStyle = '#8b5cf6'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
  }, { repeat: true });
  const walk = new THREE.Mesh(ribbonGeometry(3.6, 420, 0.05), new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
  walk.receiveShadow = true; scene.add(walk);
  const progressLine = new THREE.Mesh(ribbonGeometry(0.24, 420, 0.07), new THREE.MeshBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.9 }));
  progressLine.geometry.setDrawRange(0, 0); scene.add(progressLine);
  let progressShown = 0, progressTarget = 0;

  // ── Particles: sparkles, confetti, smoke ──────────────────────────────
  const scaleU = { value: 400 };
  const squareTex = canvasTexture(16, 16, (g, w) => { g.fillStyle = '#ffffff'; g.fillRect(2, 2, w - 4, w - 4); });
  const sparks = new Particles(scene, 1600, { additive: true, map: glowTex, scale: scaleU });
  const confettiP = new Particles(scene, 1400, { additive: false, map: squareTex, scale: scaleU });
  const smoke = new Particles(scene, 500, { additive: false, map: glowTex, scale: scaleU });
  const CONFETTI = ['#f472b6', '#fde047', '#22d3ee', '#a78bfa', '#4ade80', '#fb923c'];
  function sparkle(at, n = 40, colors = ['#fff3b0', '#ffffff'], power = 3) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.9 + 0.1, rnd() - 0.5).normalize().multiplyScalar(power * (0.4 + rnd() * 0.8));
      sparks.emit({ pos: at.clone(), vel: d, life: 0.9 + rnd() * 0.8, size: [0.3, 0.05], color: [colors[i % colors.length], '#ffffff'], gravity: 0.5, drag: 2 });
    }
  }
  function confettiBurst(at, dir, n = 80, power = 9) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(rand3(0.9)).normalize().multiplyScalar(power * (0.5 + rnd() * 0.6));
      const c = CONFETTI[i % CONFETTI.length];
      confettiP.emit({ pos: at.clone(), vel: d, life: 2.4 + rnd() * 1.4, size: [0.3, 0.26], color: [c, c], gravity: 3.2, drag: 1.4 });
    }
  }
  function puff(at, n = 3) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) smoke.emit({ pos: at.clone().add(rand3(0.4)), vel: V((rnd() - 0.5) * 0.4, 1.4 + rnd() * 0.6, (rnd() - 0.5) * 0.4), life: 3 + rnd(), size: [0.9, 2.6], color: ['#f1f5f9', '#cbd5e1'], alpha: 0.55, drag: 0.3 });
  }

  // ── Signs: a board on two posts with the district's name ──────────────
  function textTexture(text, bg, fg, w = 512, h = 128, font = 64) {
    return canvasTexture(w, h, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.font = `900 ${font}px "Arial Black", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 4);
    });
  }
  const postMat = flat('#475569');

  // ── The districts along the way ──────────────────────────────────────
  // Each is placed beside its stretch of the route, on whichever side has
  // room, turned to face the path; its sign lights up once the founder
  // has walked that far.
  const occupied = []; // { x, z, r } — keeps scenery out of the districts
  const districts = [];
  function placeBeside(u, r, minFromPath) {
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const side = V(-t.z, 0, t.x).normalize();
    for (let off = minFromPath; off < minFromPath + 14; off += 1.5) {
      for (const s of [1, -1]) {
        const c = p.clone().addScaledVector(side, s * off);
        if (distToPath(c.x, c.z) < minFromPath - 0.2) continue;
        if (occupied.some(o => Math.hypot(o.x - c.x, o.z - c.z) < o.r + r)) continue;
        return { at: c, face: Math.atan2(p.x - c.x, p.z - c.z) };
      }
    }
    return { at: p.clone().addScaledVector(side, minFromPath + 14), face: 0 };
  }
  function districtSign(group, text, color) {
    const sign = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.05, 0.14), new THREE.MeshStandardMaterial({ map: textTexture(text, color, '#ffffff'), emissive: '#ffffff', emissiveMap: null, emissiveIntensity: 0, roughness: 0.5 }));
    board.position.y = 2.9; sign.add(board);
    [-1.7, 1.7].forEach(x => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), postMat); p.position.set(x, 1.3, 0); sign.add(p); });
    group.add(sign);
    return { sign, board };
  }
  function addDistrict(kind, u, build) {
    const { at, face } = placeBeside(u, 7, 10.5);
    const g = new THREE.Group(); g.position.copy(at); g.rotation.y = face; scene.add(g);
    occupied.push({ x: at.x, z: at.z, r: 8 });
    const d = { kind, u, group: g, lit: 0, parts: {} };
    build(g, d);
    shadowAll(g);
    districts.push(d);
    return d;
  }
  const lilac = flat('#ddd6fe'), white = flat('#f8fafc'), glassMat = new THREE.MeshStandardMaterial({ color: '#bae6fd', roughness: 0.15, metalness: 0.3 });
  function windows(g, w, h, z, rows, cols, y0) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), glassMat);
      win.position.set(-w / 2 + (c + 0.5) * (w / cols), y0 + r * 1.5, z); g.add(win);
    }
  }
  // The Idea Lab: a lilac lab with a giant lightbulb glowing on the roof.
  addDistrict('lab', 0.05, (g, d) => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 6), lilac); body.position.set(0, 2.5, -1); g.add(body);
    windows(g, 8, 5, 2.01, 2, 4, 1.5);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.1), flat('#7c3aed')); door.position.set(0, 1.1, 2.05); g.add(door);
    const bulbMat = glow('#fde047', 0.4);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 16), bulbMat); bulb.position.set(0, 7.2, -1); g.add(bulb);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 1.1, 14), flat('#9ca3af', { metalness: 0.5 })); neck.position.set(0, 5.6, -1); g.add(neck);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fde68a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
    halo.position.set(0, 7.2, -1); halo.scale.setScalar(6); g.add(halo);
    d.parts = { bulbMat, halo };
    Object.assign(d, districtSign(g, 'IDEA LAB', '#7c3aed'));
    d.sign.position.set(-3.5, 0, 3.4);
  });
  // The Workshop: an orange workshop with a big turning gear and a bench.
  addDistrict('workshop', 0.3, (g, d) => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, 4.4, 6), flat('#fed7aa')); body.position.set(0, 2.2, -1); g.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 6.2, 3, 1), flat('#ea580c'));
    roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2; roof.scale.set(1, 1, 0.35); roof.position.set(0, 5.4, -1); g.add(roof);
    const doorway = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.8, 0.1), flat('#78350f')); doorway.position.set(0, 1.4, 2.05); g.add(doorway);
    const gear = new THREE.Group(); gear.position.set(2.6, 3.4, 2.15); g.add(gear);
    const gMat = flat('#64748b', { metalness: 0.5, roughness: 0.4 });
    gear.add(new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.22, 8, 20), gMat));
    for (let k = 0; k < 8; k++) { const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), gMat); const a = (k / 8) * Math.PI * 2; tooth.position.set(Math.cos(a) * 1.02, Math.sin(a) * 1.02, 0); tooth.rotation.z = a; gear.add(tooth); }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 1), flat('#a16207')); bench.position.set(-2.4, 1, 3.2); g.add(bench);
    [[-3.7, 2.9], [-1.1, 2.9], [-3.7, 3.5], [-1.1, 3.5]].forEach(([x, z]) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), postMat); leg.position.set(x, 0.5, z); g.add(leg); });
    const proto = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), flat('#cbd5e1')); proto.position.set(-2.6, 1.4, 3.2); g.add(proto);
    d.parts = { gear };
    Object.assign(d, districtSign(g, 'WORKSHOP', '#ea580c'));
    d.sign.position.set(3.6, 0, 4);
  });
  // The Factory: a sawtooth-roofed factory, smoking chimneys and a conveyor.
  addDistrict('factory', 0.55, (g, d) => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 4.5, 6), flat('#cbd5e1')); body.position.set(0, 2.25, -1.5); g.add(body);
    for (let k = 0; k < 4; k++) {
      const tooth = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 6, 3, 1), flat('#94a3b8'));
      tooth.rotation.x = Math.PI / 2; tooth.position.set(-3.75 + k * 2.5, 5.0, -1.5); tooth.scale.set(1, 1, 1); g.add(tooth);
    }
    const chimneys = [V(3, 0, -3.5), V(4.2, 0, -3.5)].map(c => {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 8, 10), flat('#64748b')); ch.position.set(c.x, 4, c.z); g.add(ch);
      return c.clone().setY(8.2);
    });
    windows(g, 10, 4.5, 1.51, 1, 5, 2.6);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 1.1), flat('#334155')); belt.position.set(0, 0.9, 2.8); g.add(belt);
    [-4, 0, 4].forEach(x => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.8, 0.9), postMat); leg.position.set(x, 0.4, 2.8); g.add(leg); });
    const boxes = [0, 1, 2, 3].map(k => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), flat(['#f472b6', '#a78bfa', '#fbbf24', '#22d3ee'][k])); b.position.set(-4 + k * 2.6, 1.3, 2.8); g.add(b); return b; });
    d.parts = { chimneys, boxes };
    Object.assign(d, districtSign(g, 'FACTORY', '#475569'));
    d.sign.position.set(-4.4, 0, 4.4);
  });
  // The Marketplace: striped stalls piled with the finished product.
  addDistrict('market', 0.78, (g, d) => {
    const stripes = (a, b) => canvasTexture(128, 64, (x, w, h) => { for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? a : b; x.fillRect(k * 16, 0, 16, h); } });
    [[-3.6, '#ec4899'], [0, '#22c55e'], [3.6, '#3b82f6']].forEach(([x, c]) => {
      const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.6), flat('#fef3c7')); counter.position.set(x, 0.5, 0); g.add(counter);
      [-1.4, 1.4].forEach(px => [-0.7, 0.7].forEach(pz => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), postMat); p.position.set(x + px, 1.3, pz); g.add(p); }));
      const awning = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 2), new THREE.MeshStandardMaterial({ map: stripes(c, '#ffffff'), roughness: 0.7 }));
      awning.position.set(x, 2.65, 0); awning.rotation.x = 0.18; g.add(awning);
      for (let k = 0; k < 5; k++) { const pk = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), flat(c)); pk.position.set(x - 1 + k * 0.5, 1.25, (k % 2) * 0.3 - 0.15); g.add(pk); }
    });
    const shop = new THREE.Mesh(new THREE.BoxGeometry(7, 3.6, 3.5), flat('#fff7ed')); shop.position.set(0, 1.8, -3.4); g.add(shop);
    const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: textTexture('SHOP', '#be185d', '#ffffff', 256, 64, 40) })); shopSign.position.set(0, 3.1, -1.63); g.add(shopSign);
    Object.assign(d, districtSign(g, 'MARKETPLACE', '#be185d'));
    d.sign.position.set(5.4, 0, 2.6);
  });

  // ── The launch stage: platform, truss, screen, product and crowd ──────
  const stage = new THREE.Group(); stage.position.copy(STAGE); scene.add(stage);
  occupied.push({ x: STAGE.x, z: STAGE.z, r: 15 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 8), flat('#7c3aed')); deck.position.y = 0.6; stage.add(deck);
  const deckTop = new THREE.Mesh(new THREE.BoxGeometry(16.2, 0.08, 8.2), flat('#a78bfa')); deckTop.position.y = 1.24; stage.add(deckTop);
  for (let k = 0; k < 3; k++) { const step = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 0.6), flat('#8b5cf6')); step.position.set(0, 0.2 + k * 0.4, 4.6 - k * 0.6); stage.add(step); }
  const trussMat = flat('#475569', { metalness: 0.6, roughness: 0.4 });
  [-7.4, 7.4].forEach(x => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), trussMat); t.position.set(x, 5.7, -3.4); stage.add(t); });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.5, 0.5), trussMat); beam.position.set(0, 10, -3.4); stage.add(beam);
  // the review screen: five stars that fill with progress
  const screenCanvas = document.createElement('canvas'); screenCanvas.width = 1024; screenCanvas.height = 384;
  const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.1), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 6.6, -3.3); stage.add(screen);
  const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(11.5, 4.6, 0.25), flat('#1e1b4b')); screenFrame.position.set(0, 6.6, -3.45); stage.add(screenFrame);
  let starsShown = -1;
  function starPath(g, cx, cy, ro, ri) {
    g.beginPath();
    for (let k = 0; k < 10; k++) { const r = k % 2 ? ri : ro, a = -Math.PI / 2 + (k * Math.PI) / 5; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath();
  }
  function drawScreen(lit, launched) {
    const g = screenCanvas.getContext('2d'), w = screenCanvas.width, h = screenCanvas.height;
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#312e81'); grd.addColorStop(1, '#1e1b4b');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4b5fd'; g.font = '800 46px Arial, sans-serif'; g.textAlign = 'center';
    g.fillText(launched ? 'LAUNCHED — CUSTOMERS LOVE IT' : 'CUSTOMER REVIEWS', w / 2, 70);
    for (let k = 0; k < 5; k++) {
      starPath(g, 152 + k * 180, 220, 74, 32);
      g.fillStyle = k < lit ? '#fbbf24' : '#4c4a7a'; g.fill();
      g.lineWidth = 6; g.strokeStyle = k < lit ? '#fde68a' : '#6d6aa8'; g.stroke();
    }
    g.fillStyle = '#e0e7ff'; g.font = '700 38px Arial, sans-serif';
    g.fillText(`${lit} of 5 stars`, w / 2, 350);
    screenTex.needsUpdate = true;
  }
  // spotlights from the truss
  const beams = [-5, 5].map(x => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#fef9c3', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const pivot = new THREE.Group(); pivot.position.set(x, 9.7, -3); stage.add(pivot);
    cone.position.y = -4.5; pivot.add(cone);
    return pivot;
  });
  // the confetti cannons at the front corners
  const cannons = [-7, 7].map(x => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.6, 12), flat('#f43f5e', { metalness: 0.3 }));
    c.position.set(x, 2, 3.2); c.rotation.z = x < 0 ? -0.35 : 0.35; c.rotation.x = 0.25; stage.add(c);
    return c;
  });
  // the pedestal and the product, at five stages of growing up
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1, 20), white); pedestal.position.set(0, 1.75, 0.6); stage.add(pedestal);
  const product = new THREE.Group(); product.position.set(0, 2.25, 0.6); stage.add(product);
  const productStages = [];
  {
    const s0 = new THREE.Group(); // the idea: a glowing bulb
    s0.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), glow('#fde047', 0.9)));
    const s0n = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 10), flat('#9ca3af')); s0n.position.y = -0.6; s0.add(s0n);
    s0.children[0].position.y = 0.1; s0.position.y = 0.55;
    const s1 = new THREE.Group(); // the blueprint on an easel
    const bp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.05), new THREE.MeshStandardMaterial({ map: canvasTexture(128, 96, (g, w, h) => {
      g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, w, h); g.strokeStyle = '#bfdbfe'; g.lineWidth = 2;
      for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.globalAlpha = 0.25; g.stroke(); }
      g.globalAlpha = 1; g.lineWidth = 3; g.strokeRect(36, 20, 56, 56); g.beginPath(); g.arc(64, 48, 14, 0, Math.PI * 2); g.stroke();
    }) }));
    bp.position.y = 1; bp.rotation.x = -0.15; s1.add(bp);
    [-0.5, 0.5].forEach(x => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.06), flat('#92400e')); leg.position.set(x, 0.7, 0.1); leg.rotation.z = x * 0.2; s1.add(leg); });
    const s2 = new THREE.Group(); // the prototype: a rough device with a gear and wires
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.8), flat('#cbd5e1')); box.position.y = 0.45; s2.add(box);
    const pg = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 6, 12), flat('#64748b')); pg.position.set(0, 0.5, 0.42); s2.add(pg);
    const wire = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 6, 12, Math.PI), flat('#ef4444')); wire.position.set(0.55, 0.6, 0); wire.rotation.y = Math.PI / 2; s2.add(wire);
    const s3 = new THREE.Group(); // the boxed product with a star on the lid
    const pkg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.8), flat('#f472b6')); pkg.position.y = 0.65; s3.add(pkg);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.2, 0.86), flat('#fbcfe8')); lid.position.y = 1.32; s3.add(lid);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 6, 12), flat('#fde047')); bow.position.y = 1.5; s3.add(bow);
    const s4 = new THREE.Group(); // the finished product: a sleek rocket, ready to launch
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.9, 18), flat('#f8fafc', { flatShading: false, metalness: 0.2 })); hull.position.y = 1.05; s4.add(hull);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 18), flat('#ec4899', { flatShading: false })); nose.position.y = 2.45; s4.add(nose);
    const port = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), glassMat); port.position.set(0, 1.4, 0.42); s4.add(port);
    for (let k = 0; k < 3; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.5), flat('#8b5cf6')); const a = (k / 3) * Math.PI * 2; fin.position.set(Math.sin(a) * 0.5, 0.35, Math.cos(a) * 0.5); fin.rotation.y = a; s4.add(fin); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.2, 12), new THREE.MeshBasicMaterial({ color: '#fb923c', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.x = Math.PI; flame.position.y = -0.55; flame.visible = false; s4.add(flame);
    s4.userData.flame = flame;
    [s0, s1, s2, s3, s4].forEach(sg => { shadowAll(sg); product.add(sg); productStages.push(sg); });
  }
  let productStage = -1;
  function showProduct(k) {
    if (k === productStage) return;
    productStage = k;
    productStages.forEach((sg, j) => { sg.visible = j === k; });
    if (!reduceMotion && starsShown >= 0) sparkle(product.getWorldPosition(tmpV).clone().add(V(0, 1, 0)), 30, ['#fde047', '#f9a8d4', '#ffffff'], 3);
  }
  // the crowd: happy customers on both sides of the promenade's end
  const CROWD = [];
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 7; k++) {
      [-1, 1].forEach(s => {
        const x = s * (3.4 + k * 1.15 + (row % 2) * 0.5), z = STAGE.z + 7.4 + row * 1.5 + (rnd() - 0.5) * 0.4;
        if (distToPath(x, z) < 2.6) return;
        CROWD.push({ x, z, ph: rnd() * 6, c: CONFETTI[(k + row) % CONFETTI.length] });
      });
    }
  }
  const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.32, 1.0, 10), new THREE.MeshStandardMaterial({ roughness: 0.7 }), CROWD.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.23, 12, 10), new THREE.MeshStandardMaterial({ color: '#fcd9b6', roughness: 0.7 }), CROWD.length);
  const SKIN = ['#fcd9b6', '#e8b48a', '#c68642', '#8d5524', '#f1c27d'];
  CROWD.forEach((p, i) => { bodies.setColorAt(i, new THREE.Color(p.c)); heads.setColorAt(i, new THREE.Color(SKIN[i % SKIN.length])); });
  bodies.castShadow = heads.castShadow = true;
  scene.add(bodies, heads);
  const tmpM = new THREE.Matrix4();
  let cheer = 0;
  function updateCrowd(time) {
    CROWD.forEach((p, i) => {
      const hop = reduceMotion ? 0 : Math.max(0, Math.sin(time * (3 + cheer * 6) + p.ph)) * (0.03 + cheer * 0.5);
      // everyone faces the stage
      tmpM.makeTranslation(p.x, 0.5 + hop, p.z); bodies.setMatrixAt(i, tmpM);
      tmpM.makeTranslation(p.x, 1.23 + hop, p.z); heads.setMatrixAt(i, tmpM);
    });
    bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  }
  const happySign = new THREE.Group();
  {
    const board = new THREE.Mesh(new THREE.BoxGeometry(5, 1.05, 0.14), new THREE.MeshStandardMaterial({ map: textTexture('HAPPY CUSTOMERS', '#16a34a', '#ffffff', 640, 128, 58) }));
    board.position.y = 2.9; happySign.add(board);
    [-2.1, 2.1].forEach(x => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), postMat); p.position.set(x, 1.3, 0); happySign.add(p); });
    happySign.position.set(-9, 0, STAGE.z + 13); happySign.rotation.y = 0.5; scene.add(happySign);
    occupied.push({ x: -9, z: STAGE.z + 13, r: 3 });
  }
  shadowAll(stage);
  CROWD.forEach(p => occupied.push({ x: p.x, z: p.z, r: 0.8 }));

  // ── Scenery: round trees, lamps, benches, balloons ────────────────────
  function scatterNearPath(count, minDist, maxDist, minGap) {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 80; tries++) {
      const u = rnd(), p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const side = V(-t.z, 0, t.x).normalize().multiplyScalar((rnd() < 0.5 ? -1 : 1) * (minDist + rnd() * (maxDist - minDist)));
      const x = p.x + side.x, z = p.z + side.z;
      if (distToPath(x, z) < minDist - 0.1) continue;
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < minGap)) continue;
      if (occupied.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 1)) continue;
      out.push({ x, z, u });
    }
    out.forEach(o => occupied.push({ x: o.x, z: o.z, r: 1 }));
    return out;
  }
  const trunk = flat('#8b5e3c');
  const LEAVES = ['#4ade80', '#34d399', '#86efac', '#f9a8d4'];
  scatterNearPath(42, 4.2, 16, 3.2).forEach(({ x, z }, k) => {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6), trunk); stem.position.y = 0.8; g.add(stem);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), flat(LEAVES[k % LEAVES.length])); crown.position.y = 2.3; g.add(crown);
    g.position.set(x, 0, z); g.scale.setScalar(0.8 + rnd() * 0.5);
    shadowAll(g); scene.add(g);
  });
  const lampMat = flat('#6d28d9'), bulbMat = new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#ffe08a', emissiveIntensity: 0.6 });
  for (let k = 0; k < 13; k++) {
    const u = 0.05 + k * 0.07, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const side = V(-t.z, 0, t.x).normalize().multiplyScalar(k % 2 ? 3.3 : -3.3);
    const x = p.x + side.x, z = p.z + side.z;
    if (occupied.some(o => Math.hypot(o.x - x, o.z - z) < o.r)) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.4, 6), lampMat); pole.position.set(x, 1.7, z); pole.castShadow = true; scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat); lamp.position.set(x, 3.5, z); scene.add(lamp);
  }
  // balloons tied along the last stretch, bobbing
  const balloons = [];
  for (let k = 0; k < 10; k++) {
    const u = 0.82 + k * 0.016, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const side = V(-t.z, 0, t.x).normalize().multiplyScalar(k % 2 ? 2.4 : -2.4);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), flat(CONFETTI[k % CONFETTI.length], { flatShading: false, roughness: 0.3 }));
    b.scale.y = 1.2; const base = p.clone().add(side).setY(2.6); b.position.copy(base); scene.add(b);
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2.2, 3), flat('#e5e7eb')); str.position.copy(base).setY(1.25); scene.add(str);
    balloons.push({ b, base, ph: rnd() * 6 });
  }
  // a few clouds
  const clouds = [];
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.92 });
  for (let k = 0; k < 9; k++) {
    const g = new THREE.Group();
    for (let m = 0; m < 5; m++) { const puffM = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + rnd() * 2.5, 1), cloudMat); puffM.position.set((m - 2) * 3.2, rnd() * 1.4, rnd() * 2); puffM.scale.y = 0.6; g.add(puffM); }
    g.position.set(-150 + k * 36, 50 + rnd() * 20, -120 + rnd() * 140); scene.add(g);
    clouds.push(g);
  }

  // ── Checkpoints: a launch-pad milestone sign per task ─────────────────
  const STATUS = { done: '#10b981', next: '#fbbf24', pending: '#e9e5ff' };
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 128, (g, w) => {
      g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.3)'; g.stroke();
      g.fillStyle = fg; g.font = '900 68px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, w / 2 + 4);
    });
  }
  function boardTexture(i, status) {
    return canvasTexture(256, 160, (g, w, h) => {
      g.fillStyle = status === 'done' ? '#10b981' : '#ffffff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = status === 'next' ? '#f59e0b' : '#7c3aed'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
      if (status === 'done') {
        g.strokeStyle = '#ffffff'; g.lineWidth = 18; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(70, 84); g.lineTo(112, 122); g.lineTo(182, 40); g.stroke();
      } else {
        g.fillStyle = '#4c1d95'; g.font = '800 30px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('MILESTONE', w / 2, 46);
        g.font = '900 70px "Arial Black", Arial, sans-serif'; g.fillText(String(i + 1), w / 2, 108);
      }
    });
  }
  function miniRocket() {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.7, 10), flat('#f8fafc')); hull.position.y = 0.35; g.add(hull);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 10), flat('#ec4899')); nose.position.y = 0.87; g.add(nose);
    for (let k = 0; k < 3; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.2), flat('#8b5cf6')); const a = (k / 3) * Math.PI * 2; fin.position.set(Math.sin(a) * 0.19, 0.12, Math.cos(a) * 0.19); fin.rotation.y = a; g.add(fin); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 8), new THREE.MeshBasicMaterial({ color: '#fb923c', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.x = Math.PI; flame.position.y = -0.24; flame.visible = false; g.add(flame);
    g.userData.flame = flame;
    return g;
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
      group.position.copy(p).addScaledVector(side, 2.7);
      group.rotation.y = Math.atan2(-side.x, -side.z) + Math.PI;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.16, 24), flat('#334155')); pad.position.y = 0.08; group.add(pad);
      const padRing = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.06, 6, 30), flat('#fbbf24')); padRing.rotation.x = Math.PI / 2; padRing.position.y = 0.17; group.add(padRing);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), postMat); post.position.set(0, 1.2, -0.55); group.add(post);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshStandardMaterial({ roughness: 0.6 }));
      face.position.set(0, 2.2, -0.5); group.add(face);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), face.material); back.position.set(0, 2.2, -0.52); back.rotation.y = Math.PI; group.add(back);
      const rocket = miniRocket(); rocket.position.set(0, 0.17, 0.2); group.add(rocket);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      badge.position.set(0, 3.25, -0.5); badge.scale.setScalar(0.55); group.add(badge);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.45, 40), new THREE.MeshBasicMaterial({ color: STATUS.next, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2; group.add(ring);
      shadowAll(group); ring.castShadow = false;
      scene.add(group);
      flags.push({ group, face, badge, ring, rocket, pop: 0, launch: t.done ? 99 : -1, status: '' });
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
      f.badge.material.map = status === 'done' ? badgeTexture('✓', STATUS.done, '#06301b') : badgeTexture(String(i + 1), status === 'next' ? STATUS.next : STATUS.pending, '#2e1065');
      f.badge.material.needsUpdate = true;
      f.ring.visible = status === 'next';
      // undone again: the mini rocket is back on its pad
      if (status !== 'done') { f.launch = -1; f.rocket.position.set(0, 0.17, 0.2); f.rocket.visible = true; f.rocket.userData.flame.visible = false; }
      else if (f.launch < 0) f.launch = 99;
    });
    progressTarget = tasks.length ? doneCount / tasks.length : 0;
  }
  // a done milestone's mini rocket lifts off its pad and hovers above it
  function updateFlagRocket(f, dt, time) {
    if (f.launch < 0) return;
    if (f.launch < 50) f.launch += dt;
    const t = Math.min(f.launch, 3);
    const lift = smooth(0, 1.4, t) * 2.4;
    f.rocket.position.set(0, 0.17 + lift + (t >= 3 ? Math.sin(time * 2) * 0.05 : 0), 0.2);
    f.rocket.rotation.y += dt * (t < 1.4 ? 6 : 1);
    f.rocket.userData.flame.visible = !reduceMotion && t > 0.05;
    f.rocket.userData.flame.scale.setScalar(t < 1.4 ? 1 + Math.sin(time * 40) * 0.2 : 0.55 + Math.sin(time * 30) * 0.1);
    if (!reduceMotion && t < 1.4 && rnd() < dt * 30) smoke.emit({ pos: f.rocket.getWorldPosition(tmpV).clone(), vel: V((rnd() - 0.5) * 0.6, -0.5, (rnd() - 0.5) * 0.6), life: 1.2, size: [0.3, 1], color: ['#fde68a', '#e5e7eb'], alpha: 0.5, drag: 0.6 });
  }

  // ── Blockers: budget cuts, bugs, falling sales, angry customers, rivals ──
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6b5e'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  const faceTex = happy => canvasTexture(128, 128, (g) => {
    g.strokeStyle = '#1f2937'; g.fillStyle = '#1f2937'; g.lineWidth = 8; g.lineCap = 'round';
    if (happy) {
      g.beginPath(); g.arc(44, 54, 9, Math.PI, 0); g.stroke(); g.beginPath(); g.arc(84, 54, 9, Math.PI, 0); g.stroke();
      g.beginPath(); g.arc(64, 72, 26, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    } else {
      g.beginPath(); g.moveTo(30, 36); g.lineTo(54, 48); g.moveTo(98, 36); g.lineTo(74, 48); g.stroke();
      g.beginPath(); g.arc(44, 60, 8, 0, Math.PI * 2); g.arc(84, 60, 8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(64, 104, 22, 1.15 * Math.PI, 1.85 * Math.PI); g.stroke();
    }
  });
  const ANGRY = faceTex(false), HAPPY = faceTex(true);
  const dollarTex = textTexture('$', '#65a30d', '#ecfccb', 128, 128, 96);
  const chartTex = up => canvasTexture(256, 160, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#cbd5e1'; g.lineWidth = 2;
    for (let y = 30; y < h; y += 30) { g.beginPath(); g.moveTo(16, y); g.lineTo(w - 16, y); g.stroke(); }
    const col = up ? '#16a34a' : '#dc2626';
    [0, 1, 2, 3].forEach(k => { const bh = up ? 30 + k * 26 : 108 - k * 26; g.fillStyle = up ? '#bbf7d0' : '#fecaca'; g.fillRect(36 + k * 50, h - 14 - bh, 30, bh); });
    g.strokeStyle = col; g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    if (up) { g.moveTo(30, 130); g.lineTo(90, 100); g.lineTo(140, 108); g.lineTo(220, 30); } else { g.moveTo(30, 30); g.lineTo(90, 62); g.lineTo(140, 52); g.lineTo(220, 130); }
    g.stroke();
    g.fillStyle = col; g.beginPath();
    if (up) { g.moveTo(232, 18); g.lineTo(200, 26); g.lineTo(226, 50); } else { g.moveTo(232, 142); g.lineTo(200, 134); g.lineTo(226, 110); }
    g.fill();
  });
  const rivalTex = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#111827'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f87171'; g.font = '900 40px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('RIVAL CO.', w / 2, 42);
    g.fillStyle = '#fde047'; g.font = '900 36px "Arial Black", Arial, sans-serif'; g.fillText('50% OFF!', w / 2, 92);
  });
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
  // 💸 Budget cuts: a money bag with wings, flapping just out of reach.
  function buildBudget() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), flat('#a3a065', { flatShading: false })); bag.scale.set(1, 1.05, 0.9); body.add(bag);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.3, 10), flat('#8a8650')); neck.position.y = 0.6; body.add(neck);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 6, 12), flat('#7c2d12')); tie.rotation.x = Math.PI / 2; tie.position.y = 0.55; body.add(tie);
    const dollar = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: dollarTex, transparent: true })); dollar.position.set(0, 0, 0.5); body.add(dollar);
    const wingMat = flat('#ffffff', { side: THREE.DoubleSide });
    const wings = [-1, 1].map(s => {
      const pivot = new THREE.Group(); pivot.position.set(s * 0.45, 0.25, 0); body.add(pivot);
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.quadraticCurveTo(s * 0.5, 0.55, s * 1.0, 0.3); shape.quadraticCurveTo(s * 0.6, 0.05, 0, -0.1);
      const w = new THREE.Mesh(new THREE.ShapeGeometry(shape), wingMat); pivot.add(w);
      return pivot;
    });
    body.position.y = 1.4;
    return finishFoe(g, 'budget', body, { wings, bag });
  }
  // 🐛 A bug: a red beetle scuttling about on the path.
  function buildBug() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), flat('#dc2626', { flatShading: false, roughness: 0.35 })); shell.scale.set(0.85, 0.55, 1.1); shell.position.y = 0.42; body.add(shell);
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 1.1), flat('#111827')); line.position.y = 0.72; body.add(line);
    [[-0.22, 0.6, 0.15], [0.24, 0.6, -0.2], [0.05, 0.62, 0.4]].forEach(([x, y, z]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), flat('#111827')); s.position.set(x, y, z); body.add(s); });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), flat('#111827')); head.position.set(0, 0.42, 0.68); body.add(head);
    [-1, 1].forEach(s => { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#fef08a' })); eye.position.set(s * 0.12, 0.5, 0.92); body.add(eye);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), flat('#111827')); ant.position.set(s * 0.12, 0.85, 0.85); ant.rotation.x = 0.6; ant.rotation.z = -s * 0.4; body.add(ant); });
    const legs = [];
    [-1, 1].forEach(s => [-0.3, 0, 0.3].forEach(z => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), flat('#111827')); l.position.set(s * 0.55, 0.22, z); l.rotation.z = s * 0.5; body.add(l); legs.push(l); }));
    body.scale.setScalar(1.15);
    return finishFoe(g, 'bug', body, { legs });
  }
  // 📉 Falling sales: a chart board with a red line heading down.
  function buildChart() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    [-0.8, 0.8].forEach(x => { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5), postMat); leg.position.set(x, 0.7, 0); body.add(leg); });
    const spin = new THREE.Group(); spin.position.y = 1.95; body.add(spin);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.2), new THREE.MeshStandardMaterial({ map: chartTex(false), roughness: 0.6 })); front.position.z = 0.04; spin.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.2), new THREE.MeshStandardMaterial({ map: chartTex(true), roughness: 0.6 })); back.position.z = -0.04; back.rotation.y = Math.PI; spin.add(back);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 0.06), flat('#334155')); spin.add(frame);
    return finishFoe(g, 'chart', body, { spin });
  }
  // 😠 Unhappy customers: a dark storm cloud with an angry face and rain.
  function buildStorm() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const cMat = flat('#64748b', { flatShading: false, roughness: 0.9 });
    [[-0.5, 0, 0, 0.55], [0.1, 0.25, 0, 0.7], [0.65, 0, 0, 0.5], [0.05, -0.12, 0.15, 0.6]].forEach(([x, y, z, r]) => { const p = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), cMat); p.position.set(x, y, z); body.add(p); });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: ANGRY, transparent: true })); face.position.set(0.05, 0.05, 0.72); body.add(face);
    const bolt = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 4), new THREE.MeshBasicMaterial({ color: '#fde047' })); bolt.position.set(0.3, -0.85, 0.2); bolt.rotation.z = 0.3; body.add(bolt);
    const rays = new THREE.Group(); rays.visible = false; body.add(rays);
    for (let k = 0; k < 10; k++) { const ray = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 5), new THREE.MeshBasicMaterial({ color: '#fde047' })); const a = (k / 10) * Math.PI * 2; ray.position.set(Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0); ray.rotation.z = a - Math.PI / 2; rays.add(ray); }
    body.position.y = 2.3;
    return finishFoe(g, 'storm', body, { faceMesh: face, bolt, rays });
  }
  // 🏢 A rival's billboard, shouting about its discount.
  function buildRival() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    [-0.9, 0.9].forEach(x => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.12), postMat); leg.position.set(x, 1, 0); body.add(leg); });
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.25, 0.12), [flat('#111827'), flat('#111827'), flat('#111827'), flat('#111827'), new THREE.MeshStandardMaterial({ map: rivalTex, emissive: '#ffffff', emissiveMap: rivalTex, emissiveIntensity: 0.25 }), flat('#111827')]);
    board.position.y = 2.4; body.add(board);
    return finishFoe(g, 'rival', body, { board });
  }
  const STORM_GREY = new THREE.Color('#64748b'), SUNNY = new THREE.Color('#fde047'), BAG = new THREE.Color('#a3a065'), GOLD = new THREE.Color('#fbbf24');
  const KINDS = ['budget', 'bug', 'chart', 'storm', 'rival'];
  const BUILD = { budget: buildBudget, bug: buildBug, chart: buildChart, storm: buildStorm, rival: buildRival };
  const walls = [];
  function buildWalls() {
    walls.forEach(w => { w.foes.forEach(f => scene.remove(f.g)); scene.remove(w.lock, w.ring, w.tag); });
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
        const home = p.clone().addScaledVector(side, (col - (inRow - 1) / 2) * 1.55).addScaledVector(tan, row * 1.5);
        f.g.position.copy(home); f.g.rotation.y = face;
        // owner: the obstacle this blocker stands for; ticked once it's resolved
        const ticked = owners[k].resolved;
        if (ticked) f.g.visible = false;
        return Object.assign(f, { home, face, ph: rnd() * 6, delay: k * 0.6, done: ticked, started: ticked, owner: owners[k].id, ticked, tickT: 0 });
      });
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.copy(p).setY(3.5); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
      tag.position.copy(p).setY(4.15); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.7, 48), new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
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
    Object.assign(f, { done: false, started: false, ticked: false, engaged: false, tickT: 0, hit: false });
    f.g.visible = true; f.g.position.copy(f.home); f.g.rotation.set(0, f.face, 0); f.g.scale.setScalar(1);
    f.body.rotation.set(0, 0, 0); f.body.scale.setScalar(f.kind === 'bug' ? 1.15 : 1);
    f.mats.forEach(m => { if (m.emissive && !m.emissiveMap) m.emissive.setRGB(0, 0, 0); });
    if (f.kind === 'budget') f.bag.material.color.copy(BAG);
    if (f.kind === 'storm') { f.mats.forEach(m => m.color && m.color.copy(STORM_GREY)); f.faceMesh.material.map = ANGRY; f.rays.visible = false; f.bolt.visible = true; }
    if (f.kind === 'chart') f.spin.rotation.set(0, 0, 0);
  }
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  // An obstacle ticked off (or unticked) on its own: the founder fixes its
  // blockers in person (see engageResolved), or they come back, and its
  // name pops up with "FIXED!".
  function applyResolves(changes) {
    const engaging = [];
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.center.clone() : curve.getPointAt(wallFrac(c.index));
      const label = c.resolved ? () => shell.spawnTaskLabel(at.clone().setY(4.4), c.name, 'foe', CLEARED) : null;
      const now = () => { if (label) { timers.push(setTimeout(label, j * 450)); peek.at.copy(at); peek.t = 3.4; } };
      let engagedHere = false;
      if (!w) { now(); return; }
      w.foes.forEach(f => {
        if (f.owner !== c.id) return;
        if (c.resolved && !f.ticked) {
          f.ticked = true; f.tickT = 0;
          // still standing: the founder goes up and fixes it (engageResolved)
          if (!reduceMotion && !f.done && !w.cleared) { f.tickT = -1e9; engaging.push({ w, f, label: engagedHere ? null : label }); engagedHere = true; }
          if (reduceMotion || f.done) { f.done = true; f.g.visible = false; }
        } else if (!c.resolved && f.ticked) {
          if (w.cleared) f.ticked = false; else reviveFoe(f);
        }
      });
      if (!engagedHere) now();
    });
    walls.forEach(w => { w.open = !tasks[w.taskIndex].foes; });
    new Set(changes.map(c => c.index)).forEach(i => { const w = walls.find(x => x.taskIndex === i); if (w) retagWall(w); });
    engageResolved(engaging);
  }
  // The founder stands at a ticked-off obstacle's blockers and fixes them
  // one after another (walker.engage); near is false when they couldn't
  // get there, and the blockers are fixed where they stand.
  function engageResolved(list) {
    const byWall = new Map();
    list.forEach(e => { if (!byWall.has(e.w)) byWall.set(e.w, []); byWall.get(e.w).push(e); });
    byWall.forEach((items, w) => walker.engage(w.taskIndex, near => {
      items.forEach((e, k) => { e.f.engaged = near; e.f.tickT = -k * 0.6; });
      items.filter(e => e.label).forEach((e, k) => timers.push(setTimeout(e.label, k * 450 + (near ? 300 : 0))));
      peek.at.copy(w.center); peek.t = 3.4;
    }, 1 + 0.6 * items.length + 0.8));
  }
  function idleFoe(f, time, dt) {
    const t = time + f.ph;
    if (f.kind === 'budget') {
      f.body.position.y = 1.4 + Math.sin(t * 2.2) * 0.18;
      f.wings.forEach((w, s) => { w.rotation.z = (s ? -1 : 1) * Math.sin(t * 14) * 0.6; });
    } else if (f.kind === 'bug') {
      f.legs.forEach((l, k) => { l.rotation.y = Math.sin(t * 16 + k) * 0.35; });
      f.body.rotation.y = Math.sin(t * 0.9) * 0.8;
      f.g.position.copy(f.home).add(V(Math.sin(t * 0.9) * 0.3, 0, Math.cos(t * 0.7) * 0.2));
    } else if (f.kind === 'chart') {
      f.spin.rotation.z = Math.sin(t * 1.2) * 0.04;
    } else if (f.kind === 'storm') {
      f.body.position.y = 2.3 + Math.sin(t * 1.2) * 0.14;
      f.bolt.visible = (t % 2.2) < 0.16 || ((t % 2.2) > 0.3 && (t % 2.2) < 0.38);
      if (!reduceMotion && rnd() < dt * 16) smoke.emit({ pos: f.g.position.clone().add(V((rnd() - 0.5) * 1.2, 1.7, (rnd() - 0.5) * 0.6)), vel: V(0, -5, 0), life: 0.4, size: [0.08, 0.08], color: ['#93c5fd'], alpha: 0.9 });
    } else if (f.kind === 'rival') {
      f.mats.forEach(m => { if (m.emissiveMap) m.emissiveIntensity = (t % 1.2) < 0.6 ? 0.35 : 0.12; });
    }
  }
  // Fixing one blocker; lt is the time since its turn came. The founder
  // turns to it and gets to work, then it's fixed in its own way.
  function fixFoe(f, lt, time, dt) {
    if (lt < 0) { idleFoe(f, time, dt); return; }
    if (!f.started) {
      f.started = true;
      if (founder && (!f.ticked || f.engaged)) {
        P.heading = Math.atan2(f.home.x - founder.holder.position.x, f.home.z - founder.holder.position.z);
        founder.holder.rotation.y = P.heading;
        play(founder, 'Interact', { fade: 0.12, once: true, timeScale: 1.2 });
      }
    }
    const hp = f.home;
    if (f.kind === 'budget') {
      // the bag turns to gold and bursts into coins
      f.bag.material.color.copy(BAG).lerp(GOLD, smooth(0, 0.5, lt));
      f.wings.forEach((w, s) => { w.rotation.z = (s ? -1 : 1) * Math.sin(time * 30) * 0.8; });
      if (lt > 0.5 && !f.hit) { f.hit = true; sparkle(hp.clone().setY(1.5), 50, ['#fde047', '#fbbf24', '#ffffff'], 4.5); }
      const q = smooth(0.5, 1.3, lt);
      f.body.position.y = 1.4 + q * 2.5; f.g.scale.setScalar(Math.max(0.01, 1 - q));
      if (lt >= 1.3 && !f.done) { f.done = true; f.g.visible = false; }
      return;
    }
    if (f.kind === 'bug') {
      // squashed flat into a sparkle
      if (lt > 0.35 && !f.hit) { f.hit = true; sparkle(hp.clone().setY(0.4), 40, ['#86efac', '#ffffff', '#fde047'], 3); if (!f.ticked || f.engaged) cam.shake = 0.12; }
      const sq = smooth(0.25, 0.45, lt);
      f.body.scale.set(1.15 * (1 + sq * 0.3), 1.15 * (1 - sq * 0.85), 1.15 * (1 + sq * 0.3));
      if (lt > 0.7) f.g.scale.setScalar(Math.max(0.01, 1 - smooth(0.7, 1.2, lt)));
      if (lt >= 1.2 && !f.done) { f.done = true; f.g.visible = false; }
      return;
    }
    if (f.kind === 'chart') {
      // the board spins round to a chart that's going up
      f.spin.rotation.y = smooth(0, 0.8, lt) * Math.PI;
      if (lt > 0.8 && !f.hit) { f.hit = true; sparkle(hp.clone().setY(2), 40, ['#86efac', '#ffffff'], 3.5); }
      if (lt > 1.3) { const q = smooth(1.3, 1.8, lt); f.g.scale.setScalar(Math.max(0.01, 1 - q)); }
      if (lt >= 1.8 && !f.done) { f.done = true; f.g.visible = false; }
      return;
    }
    if (f.kind === 'storm') {
      // the angry cloud brightens into a smiling sun and floats away
      const q = smooth(0, 0.7, lt);
      f.mats.forEach(m => m.color && m.color.copy(STORM_GREY).lerp(SUNNY, q));
      f.bolt.visible = false;
      if (lt > 0.4 && !f.hit) { f.hit = true; f.faceMesh.material.map = HAPPY; f.rays.visible = true; sparkle(hp.clone().setY(2.6), 50, ['#fde047', '#ffffff', '#fef3c7'], 4); }
      f.rays.rotation.z += dt * 2;
      if (lt > 1) f.g.position.copy(hp).setY(smooth(1, 1.9, lt) * 4);
      if (lt >= 1.9 && !f.done) { f.done = true; f.g.visible = false; }
      return;
    }
    // the rival's billboard topples over backwards and sinks away
    const q = smooth(0, 0.8, lt);
    f.body.rotation.x = -q * Math.PI / 2;
    if (lt > 0.75 && !f.hit) { f.hit = true; puff(hp.clone().setY(0.3), 8); if (!f.ticked || f.engaged) cam.shake = 0.15; }
    if (lt > 0.9) f.g.position.copy(hp).setY(-smooth(0.9, 1.5, lt) * 1.2);
    if (lt >= 1.5 && !f.done) { f.done = true; f.g.visible = false; }
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.6, 0, 1);
      w.lock.material.opacity = w.tag.material.opacity = 1 - w.fade;
      w.ring.material.opacity = (shut ? 0.35 + 0.25 * Math.sin(time * 4) : 0.55) * (1 - w.fade);
      w.lock.visible = w.tag.visible = w.ring.visible = w.fade < 1;
      if (shut) w.lock.position.y = 3.5 + Math.sin(time * 2.2) * 0.08;
      if (w.cleared && w.t <= 60) w.t += dt;
      w.foes.forEach(f => {
        if (f.done) return;
        if (f.ticked) { f.tickT += dt; fixFoe(f, f.tickT, time, dt); return; }
        if (w.cleared) fixFoe(f, w.t - f.delay, time, dt);
        else idleFoe(f, time, dt);
      });
    });
  }

  // ── The founder ───────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  let founder = null, clips = [];
  const STRIP = ['Knight_Helmet', 'Knight_Cape', '1H_Sword', 'Badge_Shield'];
  // Re-dyes the knight: armour → a purple hoodie, leather → denim, the red
  // rosette → white; then a laptop under one arm.
  function dressFounder(obj) {
    STRIP.forEach(n => { const o = obj.getObjectByName(n); if (o) o.removeFromParent(); });
    recolorCharacter(obj, (h, s, l) => {
      if (s < 0.16 && l > 0.16 && l < 0.86) return [265, 0.5, 0.26 + l * 0.2];
      if (h > 12 && h < 45 && s > 0.3 && l < 0.6) return [215, 0.45, 0.2 + l * 0.15];
      if ((h > 340 || h < 12) && s > 0.4) return [0, 0, 0.95];
      return null;
    });
  }
  function giveLaptop(ch) {
    const obj = ch.obj; obj.updateMatrixWorld(true);
    const hand = findBone(obj, 'handslotr');
    if (!hand) return;
    const hp = new THREE.Vector3(); hand.getWorldPosition(hp);
    const lap = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(CHAR_H * 0.2, CHAR_H * 0.012, CHAR_H * 0.14), new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.6, roughness: 0.3 }));
    lap.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(CHAR_H * 0.2, CHAR_H * 0.012, CHAR_H * 0.14), new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.6, roughness: 0.3 }));
    lid.position.y = CHAR_H * 0.014; lap.add(lid);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(CHAR_H * 0.018, 12), new THREE.MeshBasicMaterial({ color: '#ec4899' })); logo.rotation.x = -Math.PI / 2; logo.position.y = CHAR_H * 0.021; lap.add(logo);
    lap.rotation.z = Math.PI / 2; lap.position.y = -CHAR_H * 0.06;
    lap.traverse(o => { if (o.isMesh) o.castShadow = true; });
    attachToBone(obj, hand, lap, hp);
  }

  // ── Walking the promenade ─────────────────────────────────────────────
  const walker = createWalker({
    curve, speed: 3.8, accel: 7, brakeDecel: 6, reduceMotion, getTasks: () => tasks, walls,
    hooks: {
      stopFrac: foeStopFrac, wallPause,
      place(frac) {
        const p = curve.getPointAt(THREE.MathUtils.clamp(frac, 0, 1));
        founder.holder.position.set(p.x, 0.05, p.z);
        founder.holder.rotation.y = P.heading;
      },
      runAnim(k) { play(founder, k > 0.7 ? 'Running_A' : 'Walking_A', { fade: 0.3, timeScale: k > 0.7 ? 0.8 : 1.2 }); },
      idleAnim(pause, tick) {
        if (tick) { if (finished(founder)) play(founder, 'Idle', { fade: 0.4 }); return; }
        if (pause && founder.current !== founder.actions.Running_A && founder.current !== founder.actions.Walking_A) return;
        play(founder, 'Idle', { fade: 0.35 });
      },
      onFlag(i, t) {
        const f = flags[i];
        if (!f) return;
        f.pop = 1; f.launch = 0;
        sparkle(f.group.position.clone().add(V(0, 2.4, 0)), 46, ['#f9a8d4', '#ffffff', '#fde68a'], 3.4);
        confettiBurst(f.group.position.clone().add(V(0, 1.2, 0)), V(0, 1, 0), 26, 5);
        if (P.mode !== 'finale') play(founder, 'Cheer', { fade: 0.2, once: true, timeScale: 1.2 });
        shell.spawnTaskLabel(f.group.position.clone().add(V(0, 4, 0)), t.title);
      },
      clearWall, restoreWall,
      startFinale, undoFinale: undoVictory, updateFinale, updateVictory,
    },
  });
  const P = walker.P;

  // ── Finale: the founder presses launch and the product takes off ──────
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  const launchSpot = STAGE.clone().add(V(0, 0.05, 6.4));
  const rocketStage = () => productStages[4];
  let rocketUp = 0; // 0 on the pedestal … 1 hovering high over the stage
  function startFinale() {
    if (P.won) return;
    P.mode = 'finale'; P.finT = 0;
    P.fin = { from: founder.holder.position.clone(), steps: new Set() };
    showProduct(4);
    if (reduceMotion) { settleWon(); victory(); }
  }
  function updateFinale(dt) {
    const t = (P.finT += dt), F = P.fin;
    if (t < 1.6) {
      once('walk', () => play(founder, 'Walking_A', { fade: 0.3, timeScale: 1.2 }));
      const k = smooth(0, 1.6, t);
      founder.holder.position.lerpVectors(F.from, launchSpot, k);
      const toward = Math.atan2(launchSpot.x - F.from.x, launchSpot.z - F.from.z);
      P.heading = angleLerp(P.heading, toward, Math.min(1, dt * 6));
    } else {
      P.heading = angleLerp(P.heading, Math.PI, Math.min(1, dt * 6));
      once('press', () => play(founder, 'Interact', { fade: 0.2, once: true }));
    }
    founder.holder.rotation.y = P.heading;
    if (t > 2.2) {
      once('ignite', () => { rocketStage().userData.flame.visible = true; cam.shake = 0.2; puff(STAGE.clone().add(V(0, 2.2, 0.6)), 14); });
      rocketUp = Math.min(1, rocketUp + dt / 2.2);
    }
    if (t > 2.6) once('cannons', fireCannons);
    if (t > 3.0) cheer = Math.min(1, cheer + dt);
    if (t > 4.4) once('win', victory);
  }
  function fireCannons() {
    cannons.forEach(c => {
      const at = c.getWorldPosition(new THREE.Vector3()).add(V(0, 0.8, 0));
      confettiBurst(at, V(-Math.sign(c.position.x) * 0.5, 1, 0.4), 140, 11);
    });
    sparkle(STAGE.clone().add(V(0, 8, 0)), 80, ['#fde047', '#f472b6', '#22d3ee', '#ffffff'], 6);
  }
  function victory() {
    P.won = true;
    if (celebrationsOn) shell.showWin();
    play(founder, 'Cheer', { fade: 0.3 });
    P.mode = 'victory'; P.vicT = 0;
    drawScreen(5, true); starsShown = 5;
    notify();
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; timers.push(setTimeout(cb, celebrationsOn ? 1800 : 0)); }
  }
  function updateVictory(dt) {
    P.vicT = (P.vicT || 0) + dt;
    rocketUp = Math.min(1, rocketUp + dt / 2.2);
    cheer = Math.max(0.35, cheer - dt * 0.05);
    const toCam = Math.atan2(camera.position.x - founder.holder.position.x, camera.position.z - founder.holder.position.z);
    P.heading = angleLerp(P.heading, toCam, Math.min(1, dt * 2.5)); founder.holder.rotation.y = P.heading;
    if (P.vicT > 6 && founder.current === founder.actions.Cheer) play(founder, 'Idle', { fade: 0.5 });
    if (!reduceMotion && celebrationsOn && rnd() < dt * 2.5) sparkle(STAGE.clone().add(V((rnd() - 0.5) * 16, 12 + rnd() * 6, (rnd() - 0.5) * 6)), 34, [CONFETTI[Math.floor(rnd() * CONFETTI.length)], '#ffffff'], 5);
  }
  function settleWon() {
    founder.holder.position.copy(launchSpot);
    P.heading = Math.PI; founder.holder.rotation.y = P.heading;
    showProduct(4); rocketUp = 1; rocketStage().userData.flame.visible = true; cheer = 0.35;
    P.fin = { steps: new Set(['walk', 'press', 'ignite', 'cannons', 'win']) };
    P.won = true; P.mode = 'victory'; P.vicT = 99;
    drawScreen(5, true); starsShown = 5;
    play(founder, 'Idle', { fade: 0 });
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; shell.winEl.hidden = true;
    rocketUp = 0; cheer = 0; rocketStage().userData.flame.visible = false;
    starsShown = -1;
    play(founder, 'Idle', { fade: 0.2 });
  }
  // the product rocket: on its pedestal, or rising to hover over the stage
  function placeRocket(time) {
    const r = rocketStage();
    const up = smooth(0, 1, rocketUp);
    r.position.set(0, up * 11 + (rocketUp >= 1 ? Math.sin(time * 1.6) * 0.3 : 0), 0);
    r.rotation.y += rocketUp > 0 ? 0.02 : 0;
    if (r.userData.flame.visible) {
      r.userData.flame.scale.set(1, 1 + Math.sin(time * 40) * 0.25 + (rocketUp < 1 ? 0.8 : 0), 1);
      if (!reduceMotion && rnd() < 0.6) smoke.emit({ pos: r.getWorldPosition(tmpV).clone().add(V(0, -0.6, 0)), vel: V((rnd() - 0.5) * 0.8, -1.5, (rnd() - 0.5) * 0.8), life: 1.4, size: [0.5, 1.6], color: ['#fde68a', '#e5e7eb'], alpha: 0.5, drag: 0.8 });
    }
  }

  // ── The reviews meter (HUD) ───────────────────────────────────────────
  injectHudStyles();
  const hud = document.createElement('div');
  hud.className = 'jl-reviews';
  hud.setAttribute('aria-hidden', 'true');
  shell.root.appendChild(hud);
  let hudKey = '';
  function updateHud() {
    const lit = P.won ? 5 : Math.round(progressShown * 5);
    const stage = P.won ? 'Launched!' : ['Idea', 'Blueprint', 'Prototype', 'Product', 'Ready to launch'][Math.max(0, productStage)] || 'Idea';
    const key = `${lit}|${stage}`;
    if (key === hudKey) return;
    hudKey = key;
    hud.innerHTML = `<div class="jl-stars">${'★'.repeat(lit)}<span>${'★'.repeat(5 - lit)}</span></div><div class="jl-stage">${stage}</div>`;
  }
  function injectHudStyles() {
    if (document.getElementById('jl-reviews-styles')) return;
    const st = document.createElement('style');
    st.id = 'jl-reviews-styles';
    st.textContent = `.jl-reviews{position:absolute;left:10px;top:10px;z-index:3;pointer-events:none;background:rgba(46,16,101,.78);color:#fff;border-radius:12px;padding:6px 10px 7px;font:700 11px/1.2 Inter,Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18)}
      .jl-stars{font-size:17px;letter-spacing:1px;color:#fbbf24}.jl-stars span{color:rgba(255,255,255,.28)}
      .jl-stage{margin-top:1px;color:#e9d5ff;font-size:10px;text-transform:uppercase;letter-spacing:.08em}`;
    document.head.appendChild(st);
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  const cam = { look: V(0, 1, 20), shake: 0 };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  const peek = { at: new THREE.Vector3(), t: 0 };
  function updateCamera(dt) {
    if (!founder) return;
    const pp = founder.holder.position;
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading));
    let rate = 3;
    if (P.mode === 'finale' || P.mode === 'victory') {
      // from behind the crowd: the founder, the crowd, the stage and the
      // rocket climbing above it all in one shot
      camDesired.copy(launchSpot).add(V(-5, 6.5 + smooth(0, 1, rocketUp) * 2, 21));
      lookDesired.copy(STAGE).add(V(0, 3.5 + smooth(0, 1, rocketUp) * 4.5, 2));
      rate = 1.8;
    } else if (shell.cam.mode === 'overview') {
      camDesired.set(48, 52, 40);
      lookDesired.set(0, 0, -2);
    } else {
      const side = V(fwd.z, 0, -fwd.x);
      const orbit = P.mode === 'idle' ? Math.sin(performance.now() / 4000) * 1.4 : 0;
      camDesired.copy(pp).addScaledVector(fwd, -6.4).addScaledVector(side, 1.8 + orbit).setY(3.5);
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
    if (!founder) return;
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) {
      const obj = SkeletonUtils.clone(founder.obj);
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
    let text = n ? `Product Launch Journey: ${done} of ${n} tasks done.` : 'Product Launch Journey: no tasks yet.';
    const blocked = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= walker.progressToFrac(done, n) + 1e-3);
    if (blocked) text += ` Held up by: ${tasks[blocked.taskIndex].blocker}.`;
    text += ` Reviews: ${P.won ? 5 : Math.round(progressTarget * 5)} of 5 stars.`;
    if (n && done === n) text += P.won ? ' Launched, and customers love it!' : ' Launching now.';
    shell.root.setAttribute('aria-label', text);
  }
  let latestState = null, layoutSig = null;
  function snapCamera() {
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading)), pp = founder.holder.position;
    camera.position.copy(pp).addScaledVector(fwd, -6.4).setY(3.5);
    cam.look.copy(pp).addScaledVector(fwd, 3.5).setY(1.1);
    camera.lookAt(cam.look);
  }
  // product stage from progress: the idea, then a blueprint, a prototype
  // and a boxed product; the rocket only once every task is done
  const productFor = p => (p >= 1 - 1e-6 ? 4 : Math.min(3, Math.floor(p * 4 + 1e-6)));
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
      play(founder, 'Idle', { fade: 0.2 });
      progressShown = progressTarget;
      showProduct(productFor(progressTarget));
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
    if (founder) { founder.mixer.update(dt); walker.update(dt); }
    updateWalls(dt, time);
    flags.forEach(f => {
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); f.group.scale.setScalar(1 + Math.sin((1 - f.pop) * Math.PI) * 0.2); }
      if (f.ring.visible) { f.ring.scale.setScalar(1 + 0.15 * Math.sin(time * 4)); f.ring.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); }
      updateFlagRocket(f, dt, time);
    });
    // the pink line along the promenade, the product and the stars follow progress
    progressShown += (progressTarget - progressShown) * Math.min(1, dt * 1.5);
    const shownFrac = progressShown >= 0.999 ? 1 : walker.progressToFrac(Math.round(progressShown * tasks.length), tasks.length) * (progressShown > 0 ? 1 : 0);
    progressLine.geometry.setDrawRange(0, Math.floor(Math.min(1, shownFrac) * 420) * 6);
    if (P.mode !== 'finale' && P.mode !== 'victory') {
      if (Math.abs(progressShown - progressTarget) < 0.02) showProduct(productFor(progressTarget));
      const lit = Math.round(progressShown * 5);
      if (lit !== starsShown) { starsShown = lit; drawScreen(lit, false); }
    }
    // districts light up once the founder has walked that far
    districts.forEach(d => {
      const want = P.frac >= d.u - 0.03 ? 1 : 0;
      d.lit += (want - d.lit) * Math.min(1, dt * 2);
      d.board.material.emissiveIntensity = d.lit * 0.35;
      if (d.kind === 'lab') { d.parts.bulbMat.emissiveIntensity = 0.3 + d.lit * (1.1 + Math.sin(time * 3) * 0.2); d.parts.halo.material.opacity = 0.2 + d.lit * 0.6; }
      if (d.kind === 'workshop' && !reduceMotion) d.parts.gear.rotation.z += dt * (0.3 + d.lit * 1.4);
      if (d.kind === 'factory' && !reduceMotion) {
        d.parts.boxes.forEach(b => { b.position.x += dt * (0.4 + d.lit * 1.1); if (b.position.x > 4.2) b.position.x -= 10.4; });
        if (rnd() < dt * (1 + d.lit * 3)) d.parts.chimneys.forEach(c => puff(d.group.localToWorld(c.clone()), 1));
      }
    });
    placeRocket(time);
    beams.forEach((b, k) => { b.rotation.z = Math.sin(time * 0.6 + k * 2) * 0.35; b.rotation.x = Math.sin(time * 0.4 + k) * 0.2; });
    balloons.forEach(o => { o.b.position.copy(o.base).add(V(Math.sin(time * 0.9 + o.ph) * 0.12, Math.sin(time * 1.3 + o.ph) * 0.15, 0)); });
    clouds.forEach((c, k) => { if (!reduceMotion) c.position.x += dt * (0.6 + (k % 3) * 0.2); if (c.position.x > 170) c.position.x -= 340; });
    updateCrowd(time);
    sparks.update(dt); confettiP.update(dt); smoke.update(dt);
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
    updateHud();
    updateCamera(dt);
    shell.updateTaskLabels(camera);
  }
  const loop = createLoop(shell, camera, scene, simulate, (w, h) => { scaleU.value = particleScaleFor(renderer, camera, h); });

  drawScreen(0, false);
  loadGLTF(loader, PERSON_URL).then(gltf => {
    if (loop.destroyed) return;
    clips = gltf.animations;
    const obj = gltf.scene;
    dressFounder(obj);
    founder = makeCharacter(scene, obj, clips, CHAR_H);
    giveLaptop(founder);
    play(founder, 'Idle', { fade: 0 });
    shell.loadingEl.hidden = true;
    loop.setReady();
    if (latestState) applyState(latestState);
    loop.start();
  }).catch(err => {
    console.error('Product Launch 3D: could not load the founder', err);
    shell.loadingEl.textContent = 'Couldn’t load the 3D launch. Switch the scene to Product Launch for the 2D version.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (founder) applyState(state);
    },
    pause: loop.stop,
    resume: loop.start,
    destroy() { loop.destroy(container); },
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) simulate(1 / 30); },
      get state() {
        return {
          ready: !!founder, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length, finT: P.finT,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)),
          walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, foes: w.foes.length, gone: w.foes.filter(f => f.ticked).length, open: !!w.open })),
          stars: starsShown, product: productStage, rocketUp: +rocketUp.toFixed(2),
          ghost: ghost ? ghost.holder.visible : false, label: shell.root.getAttribute('aria-label'),
          onPath: founder && P.mode !== 'finale' && P.mode !== 'victory' ? (() => { let d = 1e9; for (let i = 0; i <= 400; i++) d = Math.min(d, curve.getPointAt(i / 400).distanceTo(tmpV.copy(founder.holder.position).setY(0))); return d; })() : 0,
        };
      },
    },
  };
}
