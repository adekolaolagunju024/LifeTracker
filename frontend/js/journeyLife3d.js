// ── JOURNEY 3D: LIFE PATH STAGE ("My Road to Success", WebGL / three.js) ──
// A storybook world for parents to share with their children: a winding
// road over rolling hills from the home village, past the school, the
// college and the city, to a dream home on the hill. The traveller grows
// up along the way — a little kid, a schoolkid, a graduate in cap and
// gown, then a grown-up — as tasks get done. Each task is a wooden
// signpost whose star lights up when it's done. Blockers are gentle and
// get solved, never beaten: a grumpy troll smiles and waves, a fallen log
// rolls aside, a puddle dries into a rainbow sparkle, thorns burst into
// flowers and a storm cloud turns into a sunny one. At the end the family
// comes out to celebrate under a rainbow.
//
// Loaded on demand by journeyGame.js (the "Life Path 3D" theme), which
// falls back to the 2D Life Path stage without WebGL. Same sync()
// contract as the other 3D stages. The people are the KayKit Knight and
// Princess (CC0) dressed in code; everything else is built from primitives.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  createShell, createLoop, makeCanvasTexture, seededRandom, softDotTexture, Particles, particleScaleFor,
  loadGLTF, makeCharacter, play, finished, recolorCharacter, findBone, attachToBone,
  checkpointFracOf, progressToPathFracSmooth, angleLerp, createWalker,
  stageTasks, layoutSignature, nameTagSprite, pickFoes, resolveChanges, tagText, peekCamera,
} from './journey3dKit.js';

const KNIGHT_URL = '/assets/models/Knight.glb';
const PRINCESS_URL = '/assets/models/Princess.glb';
const CLEARED = 'SOLVED!';

export function createLife3D(container) {
  const shell = createShell(container, {
    label: 'Life Path Journey in 3D', background: '#bfe3fb', loadingText: 'Opening the storybook…',
    winTitle: 'You Did It!', winText: 'Your road to success', winFill: '#fde047', winEdge: '#7c3aed',
  });
  const { renderer, reduceMotion, timers } = shell;
  renderer.toneMappingExposure = 1.05;
  const canvasTexture = makeCanvasTexture(renderer);
  const rnd = seededRandom(61);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
  const soft = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
  const tmpV = new THREE.Vector3();
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;

  // ── The road over the hills: home (south) to the dream home (north) ──
  const PATH_XZ = [[-12, 46], [-2, 40], [6, 31], [4, 21], [-6, 14], [-10, 4], [-4, -5], [7, -12], [10, -22], [3, -31], [-2, -38], [0, -44]];
  const flatCurve = new THREE.CatmullRomCurve3(PATH_XZ.map(([x, z]) => V(x, 0, z)), false, 'catmullrom', 0.5);
  const PATH_SAMPLES = Array.from({ length: 301 }, (_, i) => flatCurve.getPointAt(i / 300));
  function distToPath(x, z) {
    let d = 1e9;
    for (const p of PATH_SAMPLES) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2);
    return Math.sqrt(d);
  }
  function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // Gentle rolling hills, flattened along the road, with the dream home's
  // hill rising at the north end.
  const HOME = V(0, 0, -53);
  function groundHeight(x, z, dp = distToPath(x, z)) {
    let h = (vnoise(x * 0.06, z * 0.06) - 0.5) * 5 + (vnoise(x * 0.15 + 9, z * 0.15) - 0.5) * 1.2;
    const near = 1 - smooth(3, 9, dp);
    h = h * (1 - near * 0.85);
    h += 4 * Math.exp(-((x - HOME.x) ** 2 + (z - HOME.z) ** 2) / 260);
    h += 1.6 * smooth(10, -45, z);
    return h;
  }
  const curve = new THREE.CatmullRomCurve3(PATH_XZ.map(([x, z]) => V(x, groundHeight(x, z, 0), z)), false, 'catmullrom', 0.5);
  const curveLen = curve.getLength();
  const checkpointFrac = (i, n) => checkpointFracOf(i, n);
  const wallFrac = i => checkpointFrac(i, tasks.length) - 0.03;
  const foeStopFrac = i => wallFrac(i) - 2.4 / curveLen;

  // ── Scene, sky, light ─────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe3fb');
  scene.fog = new THREE.Fog('#d9eefc', 60, 210);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  camera.position.set(-16, 8, 58);
  const hemi = new THREE.HemisphereLight('#fff7fb', '#7fb069', 1.4);
  scene.add(hemi);
  const sunDir = V(-0.45, 0.8, 0.45).normalize();
  const sun = new THREE.DirectionalLight('#fff4dc', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 150 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 col = mix(vec3(1.0, 0.88, 0.94), vec3(0.75, 0.89, 0.98), smoothstep(0.0, 0.2, h));
        col = mix(col, vec3(0.45, 0.7, 0.95), smoothstep(0.2, 0.85, h));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(sky);
  const glowTex = softDotTexture(canvasTexture);
  // a smiling storybook sun
  const sunFace = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, map: canvasTexture(256, 256, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,240,160,1)'); grd.addColorStop(0.42, 'rgba(255,214,74,1)'); grd.addColorStop(0.5, 'rgba(255,214,74,0.5)'); grd.addColorStop(1, 'rgba(255,214,74,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
    g.fillStyle = '#7c4a03'; g.beginPath(); g.arc(w * 0.42, w * 0.46, 7, 0, Math.PI * 2); g.arc(w * 0.58, w * 0.46, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#7c4a03'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.arc(w / 2, w * 0.52, 20, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    g.fillStyle = 'rgba(255,140,120,0.6)'; g.beginPath(); g.arc(w * 0.36, w * 0.54, 7, 0, Math.PI * 2); g.arc(w * 0.64, w * 0.54, 7, 0, Math.PI * 2); g.fill();
  }), transparent: true }));
  sunFace.position.copy(sunDir).multiplyScalar(380); sunFace.scale.setScalar(70); scene.add(sunFace);

  // ── The ground: green hills, a pale road, a stream and a bridge ──────
  {
    const SIZE = 260, SEG = 160;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), dp = distToPath(x, z), y = groundHeight(x, z, dp);
      pos.setY(i, y);
      const n = vnoise(x * 0.3, z * 0.3);
      c.set(n > 0.55 ? '#8fd07a' : '#a3d98a').lerp(new THREE.Color('#c7ecb0'), Math.max(0, y - 2) * 0.06);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    ground.receiveShadow = true; scene.add(ground);
  }
  function ribbonGeometry(width, samples, lift) {
    const pos = [], uv = [], nrm = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples, p = flatCurve.getPointAt(u), t = flatCurve.getTangentAt(u);
      const side = V(-t.z, 0, t.x).normalize();
      const a = p.clone().addScaledVector(side, width / 2), b = p.clone().addScaledVector(side, -width / 2);
      pos.push(a.x, groundHeight(a.x, a.z) + lift, a.z, b.x, groundHeight(b.x, b.z) + lift, b.z);
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
  const roadTex = canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#f6e3bf'; g.fillRect(0, 0, w, h);
    const r = seededRandom(3);
    for (let k = 0; k < 160; k++) { g.fillStyle = r() < 0.5 ? 'rgba(214,180,130,0.5)' : 'rgba(255,250,235,0.7)'; g.fillRect(r() * w, r() * h, 2 + r() * 3, 2); }
    g.fillStyle = '#d6b07a'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
  }, { repeat: true });
  const road = new THREE.Mesh(ribbonGeometry(3.4, 420, 0.05), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
  road.receiveShadow = true; scene.add(road);
  // A line of pink hearts down the road that fills in as tasks get done.
  const progressLine = new THREE.Mesh(ribbonGeometry(0.24, 420, 0.07), new THREE.MeshBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.85 }));
  progressLine.geometry.setDrawRange(0, 0); scene.add(progressLine);
  let progressShown = 0, progressTarget = 0;
  // the stream, crossing the road under a wooden bridge
  const STREAM_Z = 8;
  {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(260, 5), new THREE.MeshStandardMaterial({ color: '#7cc8ee', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, -0.2, STREAM_Z); scene.add(water);
    // the bridge where the road meets the stream
    let bx = 0;
    for (let i = 1; i < PATH_SAMPLES.length; i++) { const a = PATH_SAMPLES[i - 1], b = PATH_SAMPLES[i]; if ((a.z - STREAM_Z) * (b.z - STREAM_Z) <= 0) { bx = a.x + (b.x - a.x) * ((STREAM_Z - a.z) / (b.z - a.z)); break; } }
    const by = groundHeight(bx, STREAM_Z, 0);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 7), flat('#a16207')); deck.position.set(bx, by + 0.12, STREAM_Z); deck.receiveShadow = true; scene.add(deck);
    [-1.9, 1.9].forEach(x => { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 7), flat('#7c4a1e')); rail.position.set(bx + x, by + 0.9, STREAM_Z); scene.add(rail);
      [-3, 0, 3].forEach(z => { const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 0.15), flat('#7c4a1e')); post.position.set(bx + x, by + 0.5, STREAM_Z + z); scene.add(post); }); });
  }
  const groundAt = (x, z) => groundHeight(x, z);

  // ── Particles ─────────────────────────────────────────────────────────
  const scaleU = { value: 400 };
  const heartTex = canvasTexture(64, 64, (g, w) => {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(w / 2, w * 0.82); g.bezierCurveTo(w * 0.05, w * 0.5, w * 0.2, w * 0.1, w / 2, w * 0.32); g.bezierCurveTo(w * 0.8, w * 0.1, w * 0.95, w * 0.5, w / 2, w * 0.82); g.fill();
  });
  const sparks = new Particles(scene, 1600, { additive: true, map: glowTex, scale: scaleU });
  const hearts = new Particles(scene, 600, { additive: false, map: heartTex, scale: scaleU });
  function sparkle(at, n = 40, colors = ['#fff3b0', '#ffffff'], power = 3) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.9 + 0.1, rnd() - 0.5).normalize().multiplyScalar(power * (0.4 + rnd() * 0.8));
      sparks.emit({ pos: at.clone(), vel: d, life: 0.9 + rnd() * 0.8, size: [0.3, 0.05], color: [colors[i % colors.length], '#ffffff'], gravity: 0.5, drag: 2 });
    }
  }
  function heartBurst(at, n = 14, power = 1.6) {
    if (reduceMotion) return;
    const cols = ['#f472b6', '#fb7185', '#f43f5e', '#f9a8d4'];
    for (let i = 0; i < n; i++) {
      hearts.emit({ pos: at.clone().add(rand3(0.6)), vel: V((rnd() - 0.5) * power, 1 + rnd() * power, (rnd() - 0.5) * power), life: 1.6 + rnd(), size: [0.3, 0.5], color: [cols[i % 4], cols[(i + 1) % 4]], gravity: -0.2, drag: 1 });
    }
  }

  // ── Scenery: round trees, flowers, fences, mushrooms ──────────────────
  function scatter(count, minDist, maxDist, minGap, accept = () => true) {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 60; tries++) {
      const x = (rnd() - 0.5) * 120, z = (rnd() - 0.5) * 120 - 2;
      const dp = distToPath(x, z);
      if (dp < minDist || dp > maxDist || Math.abs(z - STREAM_Z) < 3.5) continue;
      if (Math.hypot(x - HOME.x, z - HOME.z) < 11) continue;
      if (out.some(o => Math.hypot(o.x - x, o.z - z) < minGap)) continue;
      if (!accept(x, z)) continue;
      out.push({ x, z, y: groundHeight(x, z, dp) });
    }
    return out;
  }
  const reserved = [];
  const freeOf = (x, z, r) => reserved.every(p => Math.hypot(p.x - x, p.z - z) > p.r + r);
  // The landmarks of a life, each beside its own stretch of the road.
  function landmarkAt(u, side, dist) {
    const p = flatCurve.getPointAt(u), t = flatCurve.getTangentAt(u);
    const s = V(-t.z, 0, t.x).normalize().multiplyScalar(side * dist);
    const x = p.x + s.x, z = p.z + s.z;
    return { x, z, y: groundHeight(x, z), face: Math.atan2(-s.x, -s.z) };
  }
  function signTexture(text, bg, fg) {
    return canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.font = '900 34px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
    });
  }
  function addSign(group, text, bg, fg, y, z) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg) }));
    sign.position.set(0, y, z); group.add(sign);
  }
  function placeLandmark(g, spot, r) {
    g.position.set(spot.x, spot.y, spot.z); g.rotation.y = spot.face;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g); reserved.push({ x: spot.x, z: spot.z, r });
  }
  // home village: three cottages
  {
    const g = new THREE.Group();
    [[-4, '#fbcfe8', '#be123c'], [0.5, '#fef3c7', '#b45309'], [5, '#dbeafe', '#1d4ed8']].forEach(([x, wall, roof], k) => {
      const house = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), soft(wall)); house.position.set(x, 1.2, -k * 0.8); g.add(house);
      const r = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.8, 4), soft(roof)); r.rotation.y = Math.PI / 4; r.position.set(x, 3.3, -k * 0.8); g.add(r);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.05), soft('#92400e')); door.position.set(x, 0.6, 1.52 - k * 0.8); g.add(door);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.05), soft('#bae6fd', { emissive: '#fde68a', emissiveIntensity: 0.2 })); win.position.set(x + 0.8, 1.5, 1.52 - k * 0.8); g.add(win);
    });
    addSign(g, 'HOME', '#fde68a', '#7c2d12', 4.9, 0.4);
    placeLandmark(g, landmarkAt(0.05, -1, 9), 8);
  }
  // school: a red schoolhouse with a bell tower
  {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 4.4), soft('#ef4444')); body.position.y = 1.7; g.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.4, 2, 4, 1), soft('#7f1d1d')); roof.rotation.y = Math.PI / 4; roof.scale.set(1.3, 1, 0.75); roof.position.y = 4.4; g.add(roof);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 1.4), soft('#ef4444')); tower.position.y = 5.6; g.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 4), soft('#7f1d1d')); cap.rotation.y = Math.PI / 4; cap.position.y = 7; g.add(cap);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), soft('#fbbf24', { metalness: 0.6 })); bell.rotation.x = Math.PI; bell.position.y = 5.7; g.add(bell);
    for (let k = -3; k <= 3; k += 2) { const w = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), soft('#fef9c3')); w.position.set(k, 2, 2.22); g.add(w); }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.05), soft('#7c2d12')); door.position.set(0, 0.9, 2.23); g.add(door);
    addSign(g, 'SCHOOL', '#fef3c7', '#991b1b', 3.6, 2.25);
    placeLandmark(g, landmarkAt(0.3, 1, 10), 7);
  }
  // college: a columned hall with a dome
  {
    const g = new THREE.Group();
    const steps = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 6), soft('#e7e5e4')); steps.position.y = 0.3; g.add(steps);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 4.6), soft('#f5f5f4')); hall.position.set(0, 2.6, -0.4); g.add(hall);
    for (let k = -4; k <= 4; k += 1.6) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 3.6, 10), soft('#ffffff')); col.position.set(k, 2.4, 2.2); g.add(col); }
    const tri = new THREE.Shape(); tri.moveTo(-5, 0); tri.lineTo(5, 0); tri.lineTo(0, 1.5); tri.closePath();
    const pediment = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.6, bevelEnabled: false }), soft('#e7e5e4')); pediment.position.set(0, 4.6, 1.9); g.add(pediment);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), soft('#93c5fd')); dome.position.set(0, 4.6, -0.4); g.add(dome);
    addSign(g, 'COLLEGE', '#1e3a8a', '#ffffff', 4.25, 2.35);
    placeLandmark(g, landmarkAt(0.55, -1, 11), 8);
  }
  // career: a little city of glass towers
  {
    const g = new THREE.Group();
    [[-3.4, 7, '#93c5fd'], [0, 10, '#60a5fa'], [3.4, 8, '#a5b4fc'], [-1.6, 5, '#c4b5fd']].forEach(([x, h, c], k) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(2.6, h, 2.6), soft(c, { metalness: 0.2, roughness: 0.4 })); t.position.set(x, h / 2, k === 3 ? 2.4 : 0); g.add(t);
      for (let y = 1; y < h - 0.5; y += 1.2) { const band = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.25, 2.62), soft('#fef9c3', { emissive: '#fde68a', emissiveIntensity: 0.25 })); band.position.set(x, y, k === 3 ? 2.4 : 0); g.add(band); }
    });
    addSign(g, 'CAREER', '#312e81', '#fde68a', 5.8, 3.8);
    placeLandmark(g, landmarkAt(0.78, 1, 10), 8);
  }
  // round fruit trees
  const leafA = soft('#4ade80', { flatShading: true }), leafB = soft('#22c55e', { flatShading: true }), trunk = soft('#8b5e3c');
  const fruit = [soft('#ef4444'), soft('#f97316'), soft('#facc15')];
  scatter(46, 6, 40, 4.5, (x, z) => freeOf(x, z, 3)).forEach(({ x, z, y }, k) => {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.8, 7), trunk); stem.position.y = 0.9; g.add(stem);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), k % 2 ? leafA : leafB); crown.position.y = 2.6; g.add(crown);
    if (k % 3 === 0) for (let f = 0; f < 5; f++) { const ap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), fruit[k % 3]); const a = rnd() * 6; ap.position.set(Math.cos(a) * 1.2, 2.3 + rnd() * 0.8, Math.sin(a) * 1.2); g.add(ap); }
    g.position.set(x, y, z); g.scale.setScalar(0.8 + rnd() * 0.5);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
  });
  // flowers in clumps beside the road
  {
    const N = 360, petals = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 4), new THREE.MeshStandardMaterial({ roughness: 0.6 }), N);
    const tmpM = new THREE.Matrix4(), c = new THREE.Color(), cols = ['#ffffff', '#fde047', '#f9a8d4', '#c4b5fd', '#fb7185'];
    let n = 0;
    scatter(90, 2.4, 22, 1.2).forEach(({ x, z, y }, k) => {
      for (let f = 0; f < 4 && n < N; f++, n++) {
        tmpM.makeTranslation(x + (rnd() - 0.5) * 0.8, y + 0.2, z + (rnd() - 0.5) * 0.8);
        petals.setMatrixAt(n, tmpM); petals.setColorAt(n, c.set(cols[(k + f) % cols.length]));
      }
    });
    petals.count = n; scene.add(petals);
  }
  // a few big storybook mushrooms
  scatter(10, 5, 20, 8).forEach(({ x, z, y }) => {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.8, 8), soft('#fef3c7')); stalk.position.set(x, y + 0.4, z); stalk.castShadow = true; scene.add(stalk);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), soft('#ef4444')); cap.position.set(x, y + 0.75, z); cap.castShadow = true; scene.add(cap);
    for (let d = 0; d < 4; d++) { const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), soft('#ffffff')); const a = d * 1.6; dot.position.set(x + Math.cos(a) * 0.38, y + 1.12, z + Math.sin(a) * 0.38); scene.add(dot); }
  });
  // clouds
  const clouds = [];
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  for (let k = 0; k < 9; k++) {
    const g = new THREE.Group();
    for (let m = 0; m < 5; m++) { const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6 + rnd() * 2, 1), cloudMat); puff.position.set((m - 2) * 2.8, rnd() * 1.2, rnd() * 2); puff.scale.y = 0.7; g.add(puff); }
    g.position.set(-150 + k * 36, 42 + rnd() * 18, -110 + rnd() * 130); scene.add(g);
    clouds.push(g);
  }

  // ── The dream home on the hill ────────────────────────────────────────
  const homeY = groundHeight(HOME.x, HOME.z);
  const home = new THREE.Group(); home.position.set(HOME.x, homeY, HOME.z); scene.add(home);
  {
    const body = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5.5), soft('#fef3c7')); body.position.y = 2; home.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 5.2, 3, 4, 1), soft('#f87171')); roof.rotation.y = Math.PI / 4; roof.scale.set(1.05, 1, 0.82); roof.position.y = 5.5; home.add(roof);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), soft('#b45309')); chimney.position.set(1.8, 6, -0.6); home.add(chimney);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.2, 0.08), soft('#92400e')); door.position.set(0, 1.1, 2.79); home.add(door);
    // a heart-shaped window
    const heartShape = new THREE.Shape();
    heartShape.moveTo(0, -0.4); heartShape.bezierCurveTo(-0.9, 0.2, -0.5, 0.75, 0, 0.35); heartShape.bezierCurveTo(0.5, 0.75, 0.9, 0.2, 0, -0.4);
    const hw = new THREE.Mesh(new THREE.ShapeGeometry(heartShape), new THREE.MeshStandardMaterial({ color: '#f472b6', emissive: '#f472b6', emissiveIntensity: 0.4, side: THREE.DoubleSide })); hw.position.set(-2, 2.6, 2.79); home.add(hw);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.08), soft('#bae6fd', { emissive: '#fde68a', emissiveIntensity: 0.2 })); win.position.set(2, 2.6, 2.79); home.add(win);
    // white picket fence across the front
    for (let x = -6; x <= 6; x += 0.7) { if (Math.abs(x) < 1.6) continue; const picket = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 0.08), soft('#ffffff')); picket.position.set(x, 0.45, 5.4); home.add(picket); }
    [-1, 1].forEach(s => { const rail = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 0.06), soft('#ffffff')); rail.position.set(s * 3.8, 0.6, 5.4); home.add(rail); });
    const bigTree = new THREE.Group(); bigTree.position.set(-6, 0, -1); home.add(bigTree);
    const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 3, 8), trunk); bt.position.y = 1.5; bigTree.add(bt);
    const bc = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), leafA); bc.position.y = 4.2; bigTree.add(bc);
    home.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  const doorstep = V(HOME.x, homeY, HOME.z + 4.4);
  // the trophy star over the home, and the rainbow (shown at the finish)
  const trophy = new THREE.Group(); trophy.position.set(HOME.x, homeY + 9.5, HOME.z); scene.add(trophy);
  {
    const s = new THREE.Shape();
    for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.45 : 1.1, a = (k / 10) * Math.PI * 2 + Math.PI / 2; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (k === 0) s.moveTo(x, y); else s.lineTo(x, y); }
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 }), new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.3 }));
    star.position.z = -0.15; trophy.add(star);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fde68a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); glow.scale.setScalar(5); trophy.add(glow);
  }
  const rainbow = new THREE.Group(); rainbow.position.set(HOME.x, homeY - 1, HOME.z - 3); scene.add(rainbow);
  ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6'].forEach((c, k) => {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(15 - k * 0.7, 0.36, 8, 64, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false }));
    rainbow.add(arc);
  });
  rainbow.scale.setScalar(0.001); rainbow.visible = false;
  let rainbowK = 0;

  // ── Checkpoints: a wooden signpost with a star per task ──────────────
  const STATUS = { done: '#10b981', next: '#fbbf24', pending: '#cbd5e1' };
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 128, (g, w) => {
      g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
      g.fillStyle = fg; g.font = '900 68px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, w / 2 + 4);
    });
  }
  const starShape = (() => {
    const s = new THREE.Shape();
    for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.17 : 0.4, a = (k / 10) * Math.PI * 2 + Math.PI / 2; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (k === 0) s.moveTo(x, y); else s.lineTo(x, y); }
    return s;
  })();
  const flags = [];
  function buildFlags() {
    flags.forEach(f => scene.remove(f.group));
    flags.length = 0;
    tasks.forEach((t, i) => {
      const u = checkpointFrac(i, tasks.length);
      const p = flatCurve.getPointAt(u), tan = flatCurve.getTangentAt(u);
      const side = V(-tan.z, 0, tan.x).normalize();
      const group = new THREE.Group();
      const gp = p.clone().addScaledVector(side, 2.6);
      group.position.set(gp.x, groundHeight(gp.x, gp.z), gp.z);
      group.rotation.y = Math.atan2(-side.x, -side.z) + Math.PI;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 7), soft('#a16207')); post.position.y = 1.3; group.add(post);
      const arrow = new THREE.Shape(); arrow.moveTo(-0.7, -0.3); arrow.lineTo(0.5, -0.3); arrow.lineTo(0.85, 0); arrow.lineTo(0.5, 0.3); arrow.lineTo(-0.7, 0.3); arrow.closePath();
      const board = new THREE.Mesh(new THREE.ExtrudeGeometry(arrow, { depth: 0.08, bevelEnabled: false }), soft('#fde68a')); board.position.set(0.15, 2.2, -0.04); group.add(board);
      const starMat = new THREE.MeshStandardMaterial({ color: '#d6d3d1', emissive: '#000000', metalness: 0.3, roughness: 0.4 });
      const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.08, bevelEnabled: false }), starMat); star.position.set(0, 2.85, -0.04); group.add(star);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      badge.position.set(0, 3.7, 0); badge.scale.setScalar(0.55); group.add(badge);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 40), new THREE.MeshBasicMaterial({ color: STATUS.next, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; group.add(ring);
      group.traverse(o => { if (o.isMesh && o !== ring) o.castShadow = true; });
      scene.add(group);
      flags.push({ group, star, starMat, badge, ring, pop: 0, status: '' });
    });
  }
  function refreshFlags() {
    const doneCount = tasks.filter(t => t.done).length;
    tasks.forEach((t, i) => {
      const f = flags[i];
      const status = t.done ? 'done' : i === doneCount ? 'next' : 'pending';
      if (f.status === status) return;
      f.status = status;
      f.starMat.color.set(status === 'done' ? '#fbbf24' : '#d6d3d1'); f.starMat.emissive.set(status === 'done' ? '#f59e0b' : '#000000');
      if (f.badge.material.map) f.badge.material.map.dispose();
      f.badge.material.map = status === 'done' ? badgeTexture('✓', STATUS.done, '#06301b') : badgeTexture(String(i + 1), status === 'next' ? STATUS.next : '#eef2f7', '#0b2534');
      f.badge.material.needsUpdate = true;
      f.ring.visible = status === 'next';
    });
    progressTarget = tasks.length ? doneCount / tasks.length : 0;
  }

  // ── Blockers: gentle storybook troubles that get solved ───────────────
  function finishFoe(g, kind, body, extra = {}) {
    const mats = [];
    g.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = o.material.clone();
      if (o.material.emissive) mats.push(o.material);
    });
    scene.add(g);
    return { kind, g, body, mats, ...extra };
  }
  function faceTexture(happy) {
    return canvasTexture(128, 96, (g) => {
      g.fillStyle = '#1f2937'; g.beginPath(); g.arc(42, 44, 8, 0, Math.PI * 2); g.arc(86, 44, 8, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#1f2937'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath();
      if (happy) { g.arc(64, 58, 20, 0.15 * Math.PI, 0.85 * Math.PI); }
      else { g.moveTo(26, 22); g.lineTo(52, 32); g.moveTo(102, 22); g.lineTo(76, 32); g.moveTo(46, 80); g.quadraticCurveTo(64, 68, 82, 80); }
      g.stroke();
      if (happy) { g.fillStyle = 'rgba(244,114,182,0.6)'; g.beginPath(); g.arc(28, 62, 8, 0, Math.PI * 2); g.arc(100, 62, 8, 0, Math.PI * 2); g.fill(); }
    });
  }
  const GRUMPY = faceTexture(false), HAPPY = faceTexture(true);
  function buildTroll() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const skin = soft('#86c26a');
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), skin); torso.scale.set(1, 1.1, 0.9); torso.position.y = 0.95; body.add(torso);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.68), new THREE.MeshBasicMaterial({ map: GRUMPY, transparent: true })); face.position.set(0, 1.15, 0.7); body.add(face);
    [-1, 1].forEach(s => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 6), skin); ear.rotation.z = -s * 1.3; ear.position.set(s * 0.8, 1.25, 0); body.add(ear);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.4, 8), skin); leg.position.set(s * 0.3, 0.2, 0); body.add(leg);
    });
    const arms = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 1, 4, 8), skin); arms.rotation.z = Math.PI / 2; arms.position.set(0, 0.75, 0.62); body.add(arms);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 6), soft('#fde68a')); horn.position.y = 1.95; body.add(horn);
    return finishFoe(g, 'troll', body, { faceMesh: face });
  }
  function buildLog() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const bark = soft('#92400e', { flatShading: true });
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, 2.6, 10), bark); log.rotation.z = Math.PI / 2; log.position.y = 0.42; body.add(log);
    [-1, 1].forEach(s => { const end = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), soft('#d6a46a')); end.rotation.y = s * Math.PI / 2; end.position.set(s * 1.31, 0.42, 0); body.add(end); });
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 5), bark); twig.rotation.z = 0.6; twig.position.set(0.4, 0.95, 0); body.add(twig);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 5), leafA); leaf.position.set(0.62, 1.25, 0); body.add(leaf);
    return finishFoe(g, 'log', body);
  }
  function buildPuddle() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const mud = new THREE.Mesh(new THREE.CircleGeometry(1.2, 20), soft('#8b6b4a')); mud.rotation.x = -Math.PI / 2; mud.position.y = 0.06; mud.scale.y = 0.7; body.add(mud);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), new THREE.MeshStandardMaterial({ color: '#7dd3fc', roughness: 0.05, metalness: 0.2, emissive: '#000000' })); water.rotation.x = -Math.PI / 2; water.position.y = 0.08; water.scale.y = 0.65; body.add(water);
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 24), new THREE.MeshBasicMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.8 })); ripple.rotation.x = -Math.PI / 2; ripple.position.y = 0.1; body.add(ripple);
    return finishFoe(g, 'puddle', body, { ripple, water });
  }
  function buildThorns() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const bush = soft('#3f7a3a', { flatShading: true });
    [[0, 0.55, 0, 0.7], [0.45, 0.45, 0.1, 0.5], [-0.45, 0.42, -0.1, 0.5]].forEach(([x, y, z, r]) => { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), bush); b.position.set(x, y, z); body.add(b); });
    const thornMat = soft('#7c2d12');
    for (let k = 0; k < 16; k++) {
      const th = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 4), thornMat);
      const a = rnd() * Math.PI * 2, e = rnd() * 1.2;
      th.position.set(Math.cos(a) * 0.75 * Math.cos(e * 0.6), 0.5 + Math.sin(e) * 0.5, Math.sin(a) * 0.65);
      th.lookAt(th.position.clone().multiplyScalar(2).setY(th.position.y * 1.5)); th.rotateX(Math.PI / 2);
      body.add(th);
    }
    const blooms = new THREE.Group(); blooms.visible = false; body.add(blooms);
    for (let k = 0; k < 9; k++) { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), soft(['#f9a8d4', '#fde047', '#ffffff'][k % 3])); const a = (k / 9) * Math.PI * 2; fl.position.set(Math.cos(a) * 0.7, 0.55 + (k % 3) * 0.2, Math.sin(a) * 0.6); blooms.add(fl); }
    return finishFoe(g, 'thorns', body, { blooms });
  }
  const STORM_GREY = new THREE.Color('#9ca3af'), WHITE = new THREE.Color('#ffffff');
  function buildStorm() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const greyMat = soft('#9ca3af', { roughness: 1 });
    [[0, 0, 0, 0.62], [0.55, 0.08, 0.1, 0.48], [-0.55, 0.05, -0.1, 0.45], [0.2, 0.32, -0.12, 0.45]].forEach(([x, y, z, r]) => { const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), greyMat); puff.position.set(x, y, z); body.add(puff); });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.52), new THREE.MeshBasicMaterial({ map: GRUMPY, transparent: true })); face.position.set(0, 0.02, 0.6); body.add(face);
    body.position.y = 2.2;
    return finishFoe(g, 'storm', body, { faceMesh: face });
  }
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#f472b6'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  const KINDS = ['troll', 'log', 'puddle', 'thorns', 'storm'];
  const BUILD = { troll: buildTroll, log: buildLog, puddle: buildPuddle, thorns: buildThorns, storm: buildStorm };
  const walls = [];
  function buildWalls() {
    walls.forEach(w => { w.foes.forEach(f => scene.remove(f.g)); scene.remove(w.lock, w.ring, w.tag); });
    walls.length = 0;
    tasks.forEach((t, i) => {
      if (!t.foeList.length) return;
      const u = wallFrac(i), p = flatCurve.getPointAt(u), tan = flatCurve.getTangentAt(u);
      const side = V(-tan.z, 0, tan.x).normalize();
      const face = Math.atan2(-tan.x, -tan.z);
      const n = Math.min(t.foeList.length, 5);
      const owners = pickFoes(t.foeList, n);
      const foes = Array.from({ length: n }, (_, k) => {
        const kind = KINDS[(k + i) % KINDS.length];
        const f = BUILD[kind]();
        const row = Math.floor(k / 3), inRow = Math.min(3, n - row * 3), col = k % 3;
        const home = p.clone().addScaledVector(side, (col - (inRow - 1) / 2) * 1.45).addScaledVector(tan, row * 1.5);
        home.y = groundHeight(home.x, home.z);
        f.g.position.copy(home); f.g.rotation.y = face;
        const ticked = owners[k].resolved;
        if (ticked) f.g.visible = false;
        return Object.assign(f, { home, face, ph: rnd() * 6, delay: k * 0.7, done: ticked, started: ticked, owner: owners[k].id, ticked, tickT: 0 });
      });
      const gy = groundHeight(p.x, p.z);
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.set(p.x, gy + 3.3, p.z); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
      tag.position.set(p.x, gy + 3.95, p.z); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.7, 48), new THREE.MeshBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, gy + 0.1, p.z); scene.add(ring);
      const w = { taskIndex: i, foes, lock, tag, ring, center: V(p.x, gy, p.z), cleared: !!t.done, clearing: false, t: t.done ? 99 : 0, open: !t.foes, fade: t.done || !t.foes ? 1 : 0 };
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
    Object.assign(f, { done: false, started: false, ticked: false, engaged: false, tickT: 0, hit: false });
    f.g.visible = true; f.g.position.copy(f.home); f.g.rotation.set(0, f.face, 0); f.g.scale.setScalar(1);
    f.body.rotation.set(0, 0, 0); f.body.position.x = 0;
    f.mats.forEach(m => m.emissive && m.emissive.setRGB(0, 0, 0));
    if (f.faceMesh) f.faceMesh.material.map = GRUMPY;
    if (f.kind === 'storm') f.mats.forEach(m => m.color.copy(STORM_GREY));
    if (f.blooms) f.blooms.visible = false;
  }
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  function applyResolves(changes) {
    const engaging = [];
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.center.clone() : curve.getPointAt(wallFrac(c.index));
      const label = c.resolved ? () => shell.spawnTaskLabel(at.clone().setY(at.y + 4.5), c.name, 'foe', CLEARED) : null;
      const now = () => { if (label) { timers.push(setTimeout(label, j * 450)); peek.at.copy(at); peek.t = 3.6; } };
      let engagedHere = false;
      if (!w) { now(); return; }
      w.foes.forEach(f => {
        if (f.owner !== c.id) return;
        if (c.resolved && !f.ticked) {
          f.ticked = true; f.tickT = 0;
          // still standing: the character goes up and deals with it (engageResolved)
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
  // Ticked-off blockers the character goes up to and deals with itself
  // (walker.engage): their clearing (and name popup) starts once it's there,
  // one after another. near is false when it couldn't get there, and then
  // they just go where they stand.
  function engageResolved(list) {
    const byWall = new Map();
    list.forEach(e => { if (!byWall.has(e.w)) byWall.set(e.w, []); byWall.get(e.w).push(e); });
    byWall.forEach((items, w) => walker.engage(w.taskIndex, near => {
      items.forEach((e, k) => { e.f.engaged = near; e.f.tickT = -k * 0.6; });
      items.filter(e => e.label).forEach((e, k) => timers.push(setTimeout(e.label, k * 450 + (near ? 300 : 0))));
      peek.at.copy(w.center); peek.t = 3.6;
    }, 1 + 0.6 * items.length + 0.8));
  }

  function idleFoe(f, time) {
    const t = time + f.ph;
    if (f.kind === 'troll') { f.body.position.y = Math.abs(Math.sin(t * 2.4)) * 0.08; f.body.rotation.y = Math.sin(t * 0.8) * 0.25; }
    else if (f.kind === 'storm') f.body.position.y = 2.2 + Math.sin(t * 1.2) * 0.15;
    else if (f.kind === 'puddle') { const k = (t * 0.6) % 1; f.ripple.scale.setScalar(0.6 + k * 2); f.ripple.material.opacity = 0.8 * (1 - k); }
    else if (f.kind === 'thorns') f.body.rotation.z = Math.sin(t * 1.5) * 0.04;
  }
  // Solving one blocker; lt is the time since its turn came. Each kind
  // changes its mood first (a smile, flowers, a white cloud, a rainbow
  // sparkle, a roll aside), then floats away in a shower of hearts.
  function solveFoe(f, lt, time) {
    if (lt < 0) { idleFoe(f, time); return; }
    if (!f.started) {
      f.started = true;
      if (traveller && (!f.ticked || f.engaged)) {
        P.heading = Math.atan2(f.home.x - traveller.holder.position.x, f.home.z - traveller.holder.position.z);
        traveller.holder.rotation.y = P.heading;
        play(traveller, 'Interact', { fade: 0.12, once: true, timeScale: 1.2 });
      }
    }
    const top = f.kind === 'storm' ? 2.4 : f.kind === 'troll' ? 1.8 : 0.9;
    if (lt > 0.25 && !f.hit) {
      f.hit = true;
      if (f.faceMesh) f.faceMesh.material.map = HAPPY;
      if (f.blooms) f.blooms.visible = true;
      sparkle(f.home.clone().setY(f.home.y + top), 40, ['#fde047', '#f9a8d4', '#ffffff', '#86efac'], 3.4);
      heartBurst(f.home.clone().setY(f.home.y + top), 10);
    }
    if (f.kind === 'storm') f.mats.forEach(m => m.color.copy(STORM_GREY).lerp(WHITE, smooth(0.25, 0.8, lt)));
    if (f.kind === 'troll' && lt > 0.3 && lt < 1) f.body.rotation.y = Math.sin(lt * 14) * 0.25;
    if (f.kind === 'log') { const q = smooth(0.2, 1.1, lt); f.body.position.x = q * 2.4; f.body.rotation.x = -q * 4; }
    if (f.kind === 'puddle') f.body.scale.setScalar(Math.max(0.01, 1 - smooth(0.2, 1, lt)));
    if (lt > 0.9) {
      const q = smooth(0.9, 1.7, lt);
      f.g.position.copy(f.home).setY(f.home.y + q * 2.5);
      f.g.scale.setScalar(Math.max(0.01, 1 - q));
    }
    if (lt >= 1.7 && !f.done) { f.done = true; f.g.visible = false; heartBurst(f.home.clone().setY(f.home.y + top + 2), 8, 1); }
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.6, 0, 1);
      w.lock.material.opacity = w.tag.material.opacity = 1 - w.fade;
      w.ring.material.opacity = (shut ? 0.35 + 0.25 * Math.sin(time * 4) : 0.55) * (1 - w.fade);
      w.lock.visible = w.tag.visible = w.ring.visible = w.fade < 1;
      if (shut) w.lock.position.y = w.center.y + 3.3 + Math.sin(time * 2.2) * 0.08;
      if (w.cleared && w.t <= 60) w.t += dt;
      w.foes.forEach(f => {
        if (f.done) return;
        if (f.ticked) { f.tickT += dt; solveFoe(f, f.tickT, time); return; }
        if (w.cleared) solveFoe(f, w.t - f.delay, time);
        else idleFoe(f, time);
      });
    });
  }

  // ── The traveller, at four ages ───────────────────────────────────────
  const loader = new GLTFLoader();
  let clips = [], traveller = null, family = [];
  const ages = []; // [{ ch, scale }] — kid, schoolkid, graduate, grown-up
  const AGE_AT = [0, 0.25, 0.5, 0.8];
  const AGE_SCALE = [0.7, 0.82, 0.95, 1];
  const CHAR_H = 1.6;
  let ageIndex = 0;
  const STRIP = ['Knight_Helmet', 'Knight_Cape', '1H_Sword', 'Badge_Shield'];
  function dressAge(obj, age) {
    STRIP.forEach(n => { const o = obj.getObjectByName(n); if (o) o.removeFromParent(); });
    const outfit = [[0, 0.75, 0.5], [217, 0.7, 0.42], [230, 0.15, 0.1], [174, 0.6, 0.3]][age];
    recolorCharacter(obj, (h, s, l) => {
      if (s < 0.16 && l > 0.16 && l < 0.86) return [outfit[0], outfit[1], outfit[2] + l * 0.16];
      if (h > 12 && h < 45 && s > 0.3 && l < 0.6) return [25, 0.45, 0.14 + l * 0.18];
      if ((h > 340 || h < 12) && s > 0.4) return age === 2 ? [45, 0.9, 0.55] : [0, 0, 0.92];
      return null;
    });
    const legs = ['#1e40af', '#1e3a8a', '#111827', '#334155'][age];
    ['Knight_LegLeft', 'Knight_LegRight'].forEach(n => { const m = obj.getObjectByName(n); if (m) { m.material = m.material.clone(); m.material.map = null; m.material.color.set(legs); m.material.needsUpdate = true; } });
  }
  function accessorize(ch, age) {
    const obj = ch.obj; obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const head = findBone(obj, 'head'), chest = findBone(obj, 'chest');
    if (head && (age === 0 || age === 2)) {
      const hp = new THREE.Vector3(); head.getWorldPosition(hp);
      const r = (box.max.y - hp.y) * 0.62, g = new THREE.Group();
      if (age === 0) { // a red cap with a peak
        const capMat = soft('#ef4444');
        const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat); g.add(dome);
        const peak = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r * 0.75, r * 0.06, 16, 1, false, -Math.PI / 2, Math.PI), capMat); peak.position.set(0, 0, r * 0.4); g.add(peak);
      } else { // a mortarboard with a gold tassel
        const black = soft('#111827');
        const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.9, r * 0.45, 16), black); g.add(band);
        const board = new THREE.Mesh(new THREE.BoxGeometry(r * 2.4, r * 0.08, r * 2.4), black); board.position.y = r * 0.25; board.rotation.y = Math.PI / 4; g.add(board);
        const tassel = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.04, r * 0.04, r * 0.9, 5), soft('#facc15')); tassel.position.set(r * 1.1, -r * 0.15, 0); g.add(tassel);
      }
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      attachToBone(obj, head, g, V(hp.x, box.max.y - r * (age === 2 ? 0.55 : 0.8), hp.z + r * 0.04));
    }
    if (chest && (age === 0 || age === 1)) { // a backpack
      const cp = new THREE.Vector3(); chest.getWorldPosition(cp);
      const bag = new THREE.Mesh(new THREE.BoxGeometry(CHAR_H * 0.24, CHAR_H * 0.26, CHAR_H * 0.1), soft(age === 0 ? '#facc15' : '#f97316'));
      bag.castShadow = true;
      attachToBone(obj, chest, bag, cp.clone().add(V(0, -CHAR_H * 0.02, -CHAR_H * 0.16)));
    }
    const hand = findBone(obj, 'handslotr');
    if (hand && (age === 1 || age === 3)) {
      const hp = new THREE.Vector3(); hand.getWorldPosition(hp);
      const item = age === 1
        ? new THREE.Mesh(new THREE.BoxGeometry(CHAR_H * 0.05, CHAR_H * 0.16, CHAR_H * 0.12), soft('#16a34a'))
        : new THREE.Mesh(new THREE.BoxGeometry(CHAR_H * 0.2, CHAR_H * 0.15, CHAR_H * 0.06), soft('#7c4a1e'));
      item.position.y = -CHAR_H * 0.08; item.castShadow = true;
      const holder = new THREE.Group(); holder.add(item);
      attachToBone(obj, hand, holder, hp);
    }
  }
  function ageFor(frac) { return AGE_AT.reduce((a, at, k) => (frac >= at - 1e-6 ? k : a), 0); }
  // Swap to the age that progress has reached, with a sparkle when it's a
  // grow-up moment rather than the first placement.
  function setAge(next, celebrate) {
    if (!ages.length || next === ageIndex && traveller) return;
    const prev = traveller;
    ageIndex = next;
    traveller = ages[next].ch;
    ages.forEach((a, k) => { a.ch.holder.visible = k === next; });
    if (prev && prev !== traveller) {
      traveller.holder.position.copy(prev.holder.position); traveller.holder.rotation.copy(prev.holder.rotation);
      play(traveller, prev.current === prev.actions.Running_A ? 'Running_A' : prev.current === prev.actions.Walking_A ? 'Walking_A' : 'Idle', { fade: 0 });
    }
    if (celebrate && !reduceMotion) {
      const at = traveller.holder.position.clone().add(V(0, 1, 0));
      sparkle(at, 70, ['#fde047', '#f9a8d4', '#ffffff', '#93c5fd'], 4);
      heartBurst(at, 10);
      shell.spawnTaskLabel(at.clone().add(V(0, 2, 0)), ['Little explorer', 'Off to school', 'Graduated', 'All grown up'][next], 'foe', 'GROWING UP!');
    }
  }

  // ── Walking the road ──────────────────────────────────────────────────
  const walker = createWalker({
    curve, speed: 3.4, accel: 7, brakeDecel: 6, reduceMotion, getTasks: () => tasks, walls,
    hooks: {
      stopFrac: foeStopFrac, wallPause,
      place(frac) {
        const p = curve.getPointAt(THREE.MathUtils.clamp(frac, 0, 1));
        traveller.holder.position.set(p.x, p.y + 0.04, p.z);
        traveller.holder.rotation.y = P.heading;
      },
      runAnim(k) { play(traveller, k > 0.7 ? 'Running_A' : 'Walking_A', { fade: 0.3, timeScale: k > 0.7 ? 0.85 : 1.2 }); },
      idleAnim(pause, tick) {
        if (tick) { if (finished(traveller)) play(traveller, 'Idle', { fade: 0.4 }); return; }
        if (pause && traveller.current !== traveller.actions.Running_A && traveller.current !== traveller.actions.Walking_A) return;
        play(traveller, 'Idle', { fade: 0.35 });
      },
      onFlag(i, t) {
        const f = flags[i];
        if (!f) return;
        f.pop = 1;
        sparkle(f.group.position.clone().add(V(0, 2.8, 0)), 50, ['#fde047', '#ffffff', '#f9a8d4'], 3.4);
        // growing up happens as the traveller reaches each milestone
        const doneSoFar = tasks.slice(0, i + 1).filter(x => x.done).length;
        const want = ageFor(tasks.length ? doneSoFar / tasks.length : 0);
        if (want > ageIndex) setAge(want, true);
        if (P.mode !== 'finale') play(traveller, 'Cheer', { fade: 0.2, once: true, timeScale: 1.2 });
        shell.spawnTaskLabel(f.group.position.clone().add(V(0, 4.3, 0)), t.title);
      },
      clearWall, restoreWall,
      startFinale, undoFinale: undoVictory, updateFinale, updateVictory,
    },
  });
  const P = walker.P;

  // ── Finale: home, family and a rainbow ────────────────────────────────
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  const meet = doorstep.clone().add(V(0, 0.04, 1.6));
  function startFinale() {
    if (P.won) return;
    setAge(3, ageIndex !== 3);
    P.mode = 'finale'; P.finT = 0;
    P.fin = { from: traveller.holder.position.clone(), steps: new Set() };
    if (reduceMotion) { settleWon(); victory(); }
  }
  function updateFinale(dt) {
    const t = (P.finT += dt), F = P.fin;
    if (t < 2.2) {
      once('walk', () => play(traveller, 'Walking_A', { fade: 0.3, timeScale: 1.2 }));
      traveller.holder.position.lerpVectors(F.from, meet, smooth(0, 2.2, t));
      const toward = Math.atan2(meet.x - F.from.x, meet.z - F.from.z);
      P.heading = angleLerp(P.heading, toward, Math.min(1, dt * 6));
    } else {
      P.heading = angleLerp(P.heading, Math.PI, Math.min(1, dt * 6));
      once('family', () => { family.forEach(m => play(m, 'Cheer', { fade: 0.3 })); heartBurst(doorstep.clone().add(V(0, 2, 0)), 30, 2.4); });
    }
    traveller.holder.rotation.y = P.heading;
    if (t > 2.4) { rainbow.visible = true; rainbowK = Math.min(1, rainbowK + dt * 0.8); }
    if (t > 2.8) once('star', () => { sparkle(trophy.position.clone(), 120, ['#fde047', '#ffffff', '#f9a8d4'], 6); cam.shake = 0.12; });
    if (t > 4.2) once('win', victory);
  }
  function victory() {
    P.won = true;
    if (celebrationsOn) shell.showWin();
    play(traveller, 'Cheer', { fade: 0.3 });
    family.forEach(m => play(m, 'Cheer', { fade: 0.3 }));
    P.mode = 'victory'; P.vicT = 0;
    notify();
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; timers.push(setTimeout(cb, celebrationsOn ? 1800 : 0)); }
  }
  function updateVictory(dt) {
    P.vicT = (P.vicT || 0) + dt;
    rainbow.visible = true; rainbowK = Math.min(1, rainbowK + dt * 0.8);
    const toCam = Math.atan2(camera.position.x - traveller.holder.position.x, camera.position.z - traveller.holder.position.z);
    P.heading = angleLerp(P.heading, toCam, Math.min(1, dt * 2.5)); traveller.holder.rotation.y = P.heading;
    if (P.vicT > 6 && traveller.current === traveller.actions.Cheer) { play(traveller, 'Idle', { fade: 0.5 }); family.forEach(m => play(m, 'Idle', { fade: 0.5 })); }
    if (!reduceMotion && celebrationsOn && rnd() < dt * 3) heartBurst(doorstep.clone().add(V((rnd() - 0.5) * 6, 2 + rnd() * 2, (rnd() - 0.5) * 3)), 3, 1);
  }
  function settleWon() {
    setAge(3, false);
    traveller.holder.position.copy(meet);
    P.heading = Math.PI; traveller.holder.rotation.y = P.heading;
    rainbow.visible = true; rainbowK = 1;
    P.fin = { steps: new Set(['walk', 'family', 'star', 'win']) };
    P.won = true; P.mode = 'victory'; P.vicT = 99;
    play(traveller, 'Idle', { fade: 0 });
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; shell.winEl.hidden = true;
    rainbowK = 0; rainbow.visible = false; rainbow.scale.setScalar(0.001);
    play(traveller, 'Idle', { fade: 0.2 });
    family.forEach(m => play(m, 'Idle', { fade: 0.2 }));
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  const cam = { look: V(0, 1, 20), shake: 0 };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  const peek = { at: new THREE.Vector3(), t: 0 };
  function updateCamera(dt) {
    if (!traveller) return;
    const pp = traveller.holder.position;
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading));
    let rate = 3;
    if (P.mode === 'finale' || P.mode === 'victory') {
      camDesired.copy(doorstep).add(V(-3, 6, 17));
      lookDesired.copy(doorstep).add(V(0, P.mode === 'victory' ? 4 + Math.min(1, (P.vicT || 0) / 3) * 3 : 3, -4));
      rate = 1.8;
    } else if (shell.cam.mode === 'overview') {
      camDesired.set(-44, 50, 44);
      lookDesired.set(0, 0, -6);
    } else {
      const side = V(fwd.z, 0, -fwd.x);
      const orbit = P.mode === 'idle' ? Math.sin(performance.now() / 4000) * 1.4 : 0;
      camDesired.copy(pp).addScaledVector(fwd, -6.2).addScaledVector(side, 1.8 + orbit).setY(pp.y + 3.4);
      lookDesired.copy(pp).addScaledVector(fwd, 3.5).setY(pp.y + 1.1);
      peekCamera(peek, pp, camDesired, lookDesired, dt, 10, 5, 2.4);
    }
    const k = 1 - Math.exp(-dt * rate);
    camera.position.lerp(camDesired, k);
    camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z) + 1.5);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
    if (cam.shake > 0 && !reduceMotion) { camera.position.add(rand3(cam.shake * 0.25)); cam.shake = Math.max(0, cam.shake - dt); }
    const focus = P.mode === 'finale' || P.mode === 'victory' ? doorstep : pp;
    sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(sunDir, 60);
  }

  // ── Ghost, label, state ──────────────────────────────────────────────
  let ghost = null;
  function updateGhost(g) {
    if (!traveller) return;
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) {
      const obj = SkeletonUtils.clone(ages[3].ch.obj);
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
    ghost.holder.position.copy(p).addScaledVector(V(-t.z, 0, t.x).normalize(), -0.9).add(V(0, 0.04, 0));
    ghost.holder.rotation.y = Math.atan2(t.x, t.z);
    ghost.holder.scale.setScalar(AGE_SCALE[ageFor(g.frac)] / AGE_SCALE[3]);
  }
  function notify() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Life Path Journey: ${done} of ${n} tasks done.` : 'Life Path Journey: no tasks yet.';
    const blocked = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= walker.progressToFrac(done, n) + 1e-3);
    if (blocked) text += ` A little trouble on the road: ${tasks[blocked.taskIndex].blocker}.`;
    if (n && done === n) text += P.won ? ' Home at last, and the family is celebrating!' : ' Nearly home.';
    shell.root.setAttribute('aria-label', text);
  }
  let latestState = null, layoutSig = null;
  function snapCamera() {
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading)), pp = traveller.holder.position;
    camera.position.copy(pp).addScaledVector(fwd, -6.2).setY(pp.y + 3.4);
    cam.look.copy(pp).addScaledVector(fwd, 3.5).setY(pp.y + 1.1);
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
      setAge(ageFor(progressTarget), false);
      walker.reset();
      play(traveller, 'Idle', { fade: 0.2 });
      progressShown = progressTarget;
      if (n && tasks.every(t => t.done)) settleWon();
      if (firstBuild) snapCamera();
    } else {
      const changes = resolveChanges(tasks, next);
      next.forEach((t, i) => { tasks[i].done = t.done; tasks[i].title = t.title; tasks[i].blocker = t.blocker; tasks[i].foes = t.foes; tasks[i].foeList = t.foeList; });
      if (changes.length) applyResolves(changes);
      refreshFlags();
      // un-done tasks can make the traveller younger again straight away;
      // growing up waits until they reach the milestone (see onFlag)
      const want = ageFor(progressTarget);
      if (want < ageIndex) setAge(want, false);
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
    if (traveller) { ages.forEach(a => { if (a.ch.holder.visible) a.ch.mixer.update(dt); }); walker.update(dt); }
    family.forEach(m => m.mixer.update(dt));
    updateWalls(dt, time);
    clouds.forEach((c, k) => { if (!reduceMotion) c.position.x += dt * (0.5 + (k % 3) * 0.2); if (c.position.x > 170) c.position.x -= 340; });
    flags.forEach(f => {
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); f.group.scale.setScalar(1 + Math.sin((1 - f.pop) * Math.PI) * 0.25); }
      if (f.status === 'done' && !reduceMotion) f.star.rotation.y = time * 1.5;
      if (f.ring.visible) { f.ring.scale.setScalar(1 + 0.15 * Math.sin(time * 4)); f.ring.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); }
    });
    if (!reduceMotion) { trophy.rotation.y = time * 0.8; trophy.position.y = homeY + 9.5 + Math.sin(time * 1.6) * 0.3; }
    rainbow.scale.setScalar(Math.max(0.001, rainbowK < 1 ? 1 - Math.pow(1 - rainbowK, 3) : 1));
    progressShown += (progressTarget - progressShown) * Math.min(1, dt * 1.5);
    const shownFrac = progressShown >= 0.999 ? 1 : walker.progressToFrac(Math.round(progressShown * tasks.length), tasks.length) * (progressShown > 0 ? 1 : 0);
    progressLine.geometry.setDrawRange(0, Math.floor(Math.min(1, shownFrac) * 420) * 6);
    sparks.update(dt); hearts.update(dt);
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
    updateCamera(dt);
    shell.updateTaskLabels(camera);
  }
  const loop = createLoop(shell, camera, scene, simulate, (w, h) => { scaleU.value = particleScaleFor(renderer, camera, h); });

  Promise.all([loadGLTF(loader, KNIGHT_URL), loadGLTF(loader, PRINCESS_URL)]).then(([knight, princess]) => {
    if (loop.destroyed) return;
    clips = knight.animations;
    // the traveller at each age
    for (let age = 0; age < 4; age++) {
      const obj = age === 3 ? knight.scene : SkeletonUtils.clone(knight.scene);
      dressAge(obj, age);
      const ch = makeCharacter(scene, obj, clips, CHAR_H * AGE_SCALE[age]);
      accessorize(ch, age);
      ch.holder.visible = false;
      play(ch, 'Idle', { fade: 0 });
      ages[age] = { ch };
    }
    // the family at the dream home: a parent in a pink dress (the Princess,
    // crown and all), a parent in a green jumper and a little sibling
    const mum = makeCharacter(scene, princess.scene, clips, CHAR_H * 1.02);
    const dadObj = SkeletonUtils.clone(knight.scene);
    STRIP.forEach(n => { const o = dadObj.getObjectByName(n); if (o) o.removeFromParent(); });
    recolorCharacter(dadObj, (h, sat, l) => (sat < 0.16 && l > 0.16 && l < 0.86 ? [140, 0.45, 0.2 + l * 0.18] : (h > 340 || h < 12) && sat > 0.4 ? [0, 0, 0.92] : null));
    const dad = makeCharacter(scene, dadObj, clips, CHAR_H * 1.05);
    const sibObj = SkeletonUtils.clone(ages[0].ch.obj);
    const sib = makeCharacter(scene, sibObj, clips, CHAR_H * 0.62);
    [[mum, -1.4, 0.4], [dad, 1.4, 0.4], [sib, 2.8, 1.2]].forEach(([m, x, z]) => {
      m.holder.position.set(doorstep.x + x, homeY + 0.04, doorstep.z + z);
      m.holder.rotation.y = 0;
      play(m, 'Idle', { fade: 0 }); m.mixer.update(rnd());
    });
    family = [mum, dad, sib];
    shell.loadingEl.hidden = true;
    loop.setReady();
    if (latestState) applyState(latestState);
    else setAge(0, false);
    loop.start();
  }).catch(err => {
    console.error('Life Path 3D: could not load the people', err);
    shell.loadingEl.textContent = 'Couldn’t load the 3D storybook. Switch the scene to Life Path for the 2D version.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (ages.length) applyState(state);
    },
    pause: loop.stop,
    resume: loop.start,
    destroy() { loop.destroy(container); },
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) simulate(1 / 30); },
      get state() {
        return {
          ready: !!traveller, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length, finT: P.finT, age: ageIndex,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)),
          walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, foes: w.foes.length, gone: w.foes.filter(f => f.ticked).length, open: !!w.open })),
          rainbow: +rainbowK.toFixed(2), ghost: ghost ? ghost.holder.visible : false, label: shell.root.getAttribute('aria-label'),
          onPath: traveller && P.mode !== 'finale' && P.mode !== 'victory' ? (() => { let d = 1e9; for (let i = 0; i <= 400; i++) d = Math.min(d, curve.getPointAt(i / 400).distanceTo(tmpV.copy(traveller.holder.position).add(V(0, -0.04, 0)))); return d; })() : 0,
        };
      },
    },
  };
}
