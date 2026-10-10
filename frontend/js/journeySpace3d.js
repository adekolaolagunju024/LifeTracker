// ── JOURNEY 3D: SPACE STAGE ("Space Mission", WebGL / three.js) ────────
// A rocket flies a route from Earth orbit, past a red planet, a ringed gas
// giant and an ice world, to a new planet. Each task is a satellite beside
// the route (its solar panels unfold and its beacon turns green when the
// task is done). An asteroid cluster blocks the route at each blocked task
// until it's done; then the rocket blasts it apart. The last task lands
// the rocket: an astronaut walks down the ramp and plants the flag.
//
// Loaded on demand by journeyGame.js (the "Space 3D" theme), which falls
// back to the 2D Space stage without WebGL. Same sync() contract as the
// other 3D stages. The astronaut is the KayKit Knight (CC0) re-dressed in
// code: a white suit, a glass helmet and a backpack. Everything else is
// built here from primitives.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createShell, createLoop, makeCanvasTexture, seededRandom, softDotTexture, Particles, particleScaleFor,
  loadGLTF, makeCharacter, play, recolorCharacter, findBone, attachToBone,
  checkpointFracOf, progressToPathFracSmooth, angleLerp, createWalker,
  stageTasks, layoutSignature, nameTagSprite, pickFoes, resolveChanges, tagText, peekCamera,
} from './journey3dKit.js';

const ASTRONAUT_URL = '/assets/models/Knight.glb';

export function createSpace3D(container) {
  const shell = createShell(container, {
    label: 'Space Journey in 3D', background: '#03040c', loadingText: 'Fuelling the rocket…',
    winTitle: 'Mission Complete!', winText: 'You landed on a new world', winFill: '#bfe9ff', winEdge: '#1b2a6b',
  });
  const { renderer, reduceMotion, timers } = shell;
  renderer.toneMappingExposure = 1.1;
  const canvasTexture = makeCanvasTexture(renderer);
  const rnd = seededRandom(23);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3();
  const UP = V(0, 1, 0);
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;
  const uTime = { value: 0 };

  // ── The route through space ─────────────────────────────────────────
  const curve = new THREE.CatmullRomCurve3(
    [[-12, 3, 46], [0, 6, 36], [12, 3, 24], [6, -2, 12], [-10, 2, 2], [-6, 8, -10], [10, 6, -20], [8, 0, -32], [-4, 2, -42], [0, 8, -50]]
      .map(([x, y, z]) => V(x, y, z)), false, 'catmullrom', 0.5,
  );
  const curveLen = curve.getLength();
  const checkpointFrac = (i, n) => checkpointFracOf(i, n);
  const wallFrac = i => checkpointFrac(i, tasks.length) - 0.03;
  const rocksStopFrac = i => wallFrac(i) - 7 / curveLen;

  // ── Scene, sky, light ─────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03040c');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
  camera.position.set(-16, 8, 58);
  const sunDir = V(-0.6, 0.35, 0.7).normalize();
  scene.add(new THREE.AmbientLight('#4a5a8a', 0.55));
  const sun = new THREE.DirectionalLight('#fff4e0', 3.0);
  sun.position.copy(sunDir).multiplyScalar(100);
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#7aa2ff', 0.8);
  rim.position.set(30, -10, -60); scene.add(rim);

  // Nebula: a procedural colour wash on a huge sphere around everything.
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float a = fbm(d * 2.2 + vec3(3.0, 1.0, 0.0)), b = fbm(d * 3.1 - vec3(1.0, 4.0, 2.0));
        float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.9, -0.3))) * 2.2, 2.0));
        vec3 col = vec3(0.012, 0.016, 0.045);
        col += vec3(0.45, 0.12, 0.55) * pow(a, 3.0) * 1.4 * band;
        col += vec3(0.05, 0.35, 0.55) * pow(b, 3.5) * 1.2 * band;
        col += vec3(0.6, 0.25, 0.35) * pow(a * b, 2.5) * 1.2;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(nebula);
  // Stars: two layers of points, small and many plus fewer bright ones.
  function starLayer(count, size, colors, rMin, rMax) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin), s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * s * r, u * r, Math.sin(th) * s * r], i * 3);
      tmpC.set(colors[Math.floor(rnd() * colors.length)]).multiplyScalar(0.6 + rnd() * 0.4);
      col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }));
    scene.add(pts);
    return pts;
  }
  starLayer(3500, 1.4, ['#ffffff', '#cfe0ff', '#ffe9c4'], 500, 800);
  const brightStars = starLayer(260, 2.6, ['#ffffff', '#bcd4ff', '#ffd9a0'], 500, 800);

  const glowTex = softDotTexture(canvasTexture);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2d0', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  sunGlow.position.copy(sunDir).multiplyScalar(600); sunGlow.scale.setScalar(140); scene.add(sunGlow);
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  sunCore.position.copy(sunGlow.position); sunCore.scale.setScalar(40); scene.add(sunCore);

  // ── Planets ───────────────────────────────────────────────────────────
  function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 5) { let a = 0.5, s = 0; for (let k = 0; k < oct; k++) { s += a * vnoise(x, y); x *= 2.02; y *= 2.02; a *= 0.5; } return s; }
  // Equirectangular planet texture from a colour function of (noise, latitude).
  function planetTexture(w, h, paint) {
    return canvasTexture(w, h, (g) => {
      const img = g.createImageData(w, h), d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const lon = (x / w) * Math.PI * 2, lat = y / h;
        // sample noise on a cylinder so the seam wraps
        const nx = Math.cos(lon) * 2 + 10, ny = Math.sin(lon) * 2 + 10;
        const c = paint(fbm(nx + lat * 3, ny + lat * 3), lat, fbm(nx * 3 + 5, ny * 3 + lat * 8, 3));
        const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
  }
  function atmosphere(radius, color, power = 2.5, strength = 1.2) {
    return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.08, 48, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(vN, vV)), ${power.toFixed(1)}); gl_FragColor = vec4(uColor * f * ${strength.toFixed(2)}, f);
          #include <colorspace_fragment>
        }`,
    }));
  }
  const spinners = [];
  function planet(radius, pos, map, { atmo, atmoPower, spin = 0.02, tilt = 0.2, rough = 0.9, bump } = {}) {
    const g = new THREE.Group(); g.position.copy(pos); g.rotation.z = tilt;
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, bumpMap: bump || null, bumpScale: bump ? 2 : 0 }));
    g.add(m);
    if (atmo) g.add(atmosphere(radius, atmo, atmoPower));
    scene.add(g); spinners.push({ m, spin });
    return g;
  }
  const earthTex = planetTexture(512, 256, (n, lat, n2) => {
    const ice = lat < 0.08 || lat > 0.92;
    if (ice) return [240, 246, 255];
    if (n > 0.53) { const k = n2 > 0.5 ? 1 : 0; return k ? [96, 140, 70] : [150, 130, 90]; }
    const deep = Math.max(0, 0.53 - n) * 3;
    return [20 + 20 * (1 - deep), 70 + 60 * (1 - deep), 150 + 60 * (1 - deep)];
  });
  const earth = planet(22, V(-40, -18, 78), earthTex, { atmo: '#5fb0ff', spin: 0.01, tilt: 0.4, rough: 0.7 });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(22.3, 48, 32), new THREE.MeshStandardMaterial({
    map: planetTexture(256, 128, (n, lat, n2) => { const a = Math.max(0, n2 - 0.52) * 4; return [255 * Math.min(1, a), 255 * Math.min(1, a), 255 * Math.min(1, a)]; }),
    transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  earth.add(clouds); spinners.push({ m: clouds, spin: 0.016 });
  const moonTex = planetTexture(256, 128, (n, lat, n2) => { const v = 120 + n * 90 - (n2 > 0.62 ? 40 : 0); return [v, v, v * 0.98]; });
  planet(4, V(-14, 10, 66), moonTex, { spin: 0.02 });
  const marsTex = planetTexture(256, 128, (n, lat) => { const ice = lat < 0.07 || lat > 0.93; return ice ? [235, 225, 220] : [170 + n * 70, 70 + n * 40, 40 + n * 20]; });
  planet(7, V(32, 4, 14), marsTex, { atmo: '#ff9a6a', spin: 0.03 });
  const giantTex = planetTexture(512, 256, (n, lat, n2) => {
    const b = Math.sin(lat * 38 + n * 6) * 0.5 + 0.5;
    return [200 + b * 40 - n2 * 30, 160 + b * 40 - n2 * 40, 110 + b * 30 - n2 * 30];
  });
  const giant = planet(16, V(-46, 14, -14), giantTex, { atmo: '#ffd59a', atmoPower: 3, spin: 0.04, tilt: 0.35, rough: 1 });
  {
    const ringTex = canvasTexture(512, 8, (g, w, h) => {
      for (let x = 0; x < w; x++) { const v = 0.5 + 0.5 * Math.sin(x * 0.15) * Math.sin(x * 0.043); g.fillStyle = `rgba(${220 - v * 40},${200 - v * 50},${160 - v * 50},${0.25 + v * 0.6})`; g.fillRect(x, 0, 1, h); }
    });
    const ringGeo = new THREE.RingGeometry(20, 32, 128, 1);
    const p = ringGeo.attributes.position, uv = ringGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (r - 20) / 12, 0.5); }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
    ring.rotation.x = Math.PI / 2 - 0.25; giant.add(ring);
  }
  const iceTex = planetTexture(256, 128, (n, lat, n2) => [180 + n * 60, 220 + n * 30, 245 - n2 * 20]);
  planet(5, V(30, -10, -36), iceTex, { atmo: '#9fe7ff', spin: 0.025 });

  // The destination: a violet-and-teal alien world with a landing pad on top.
  const DEST_R = 34;
  const destCenter = V(0, 8 - DEST_R, -58);
  const PAD = V(0, 8, -58);
  const destTex = planetTexture(1024, 512, (n, lat, n2) => {
    const k = n * 0.7 + n2 * 0.3;
    if (k > 0.58) return [120 + k * 60, 220, 190];
    return [90 + k * 80, 60 + k * 60, 140 + k * 80];
  });
  planet(DEST_R, destCenter, destTex, { atmo: '#7af0d8', atmoPower: 2.2, spin: 0, tilt: 0, rough: 0.95 });
  const surfaceY = (x, z) => destCenter.y + Math.sqrt(Math.max(0, DEST_R * DEST_R - (x - destCenter.x) ** 2 - (z - destCenter.z) ** 2));
  {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.3, 40), flat('#5b6474', { metalness: 0.5, roughness: 0.5 }));
    pad.position.copy(PAD).setY(PAD.y - 0.05); pad.receiveShadow = true; scene.add(pad);
    const mark = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.8, 40), new THREE.MeshBasicMaterial({ color: '#fbbf24' }));
    mark.rotation.x = -Math.PI / 2; mark.position.copy(PAD).setY(PAD.y + 0.12); scene.add(mark);
    const hLetter = new THREE.Group();
    [[-0.7, 0, 0.3, 2], [0.7, 0, 0.3, 2], [0, 0, 1.4, 0.3]].forEach(([x, z, w, d]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), new THREE.MeshBasicMaterial({ color: '#fbbf24' })); b.position.set(x, 0, z); hLetter.add(b); });
    hLetter.position.copy(PAD).setY(PAD.y + 0.12); scene.add(hLetter);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: k % 2 ? '#22d3ee' : '#f472b6' }));
      l.position.set(PAD.x + Math.cos(a) * 4.3, PAD.y + 0.15, PAD.z + Math.sin(a) * 4.3); scene.add(l);
    }
    // glowing crystals around the pad
    const crystalGeo = mergeGeometries([0, 1, 2].map(k => new THREE.OctahedronGeometry(0.35 + k * 0.1, 0).scale(0.6, 2.2, 0.6).rotateZ((k - 1) * 0.35).translate((k - 1) * 0.35, 0.6, 0)));
    const spots = [];
    for (let k = 0; k < 40; k++) { const a = rnd() * Math.PI * 2, r = 7 + rnd() * 16; spots.push([PAD.x + Math.cos(a) * r, PAD.z + Math.sin(a) * r]); }
    const crystals = new THREE.InstancedMesh(crystalGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#5eead4', emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.1 }), spots.length);
    spots.forEach(([x, z], i) => {
      const y = surfaceY(x, z), nrm = V(x - destCenter.x, y - destCenter.y, z - destCenter.z).normalize();
      tmpQ.setFromUnitVectors(UP, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 6));
      crystals.setMatrixAt(i, tmpM.compose(V(x, y - 0.2, z), tmpQ, V(1, 1, 1).multiplyScalar(0.7 + rnd() * 1.2)));
      crystals.setColorAt(i, tmpC.set(['#a5f3fc', '#c4b5fd', '#f0abfc'][i % 3]));
    });
    crystals.castShadow = true; scene.add(crystals);
  }
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 220 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  scene.add(sun.target);

  // A space station near the start, slowly turning, and a belt of distant rocks.
  const station = new THREE.Group();
  {
    const metal = flat('#c8cfdb', { metalness: 0.6, roughness: 0.4 }), panelMat = new THREE.MeshStandardMaterial({ color: '#1e3a8a', emissive: '#1d4ed8', emissiveIntensity: 0.25, metalness: 0.4, roughness: 0.3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.45, 10, 40), metal); station.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 12), metal); hub.rotation.x = Math.PI / 2; station.add(hub);
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), metal); sp.rotation.z = (k / 4) * Math.PI; station.add(sp); }
    [-1, 1].forEach(s => { const p2 = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 2), panelMat); p2.position.set(0, 0, s * 3.5); p2.rotation.x = 0; station.add(p2); });
    station.position.set(-26, 12, 40); station.rotation.set(0.5, 0.6, 0);
    station.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(station);
  }
  const beltRocks = 360;
  const belt = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), flat('#ffffff'), beltRocks);
  const beltData = Array.from({ length: beltRocks }, () => ({ a: rnd() * Math.PI * 2, r: 150 + rnd() * 40, y: (rnd() - 0.5) * 14 + 20, s: 0.6 + rnd() * 2.6, sp: 0.004 + rnd() * 0.006, rot: rnd() * 6 }));
  beltData.forEach((b, i) => belt.setColorAt(i, tmpC.set(['#7c7f8f', '#8d8478', '#6a6f80'][i % 3])));
  scene.add(belt);
  function updateBelt(time) {
    beltData.forEach((b, i) => {
      const a = b.a + time * b.sp;
      belt.setMatrixAt(i, tmpM.compose(V(Math.cos(a) * b.r, b.y, Math.sin(a) * b.r - 10), tmpQ.setFromEuler(new THREE.Euler(b.rot + time * 0.2, b.rot, 0)), V(b.s, b.s * 0.8, b.s)));
    });
    belt.instanceMatrix.needsUpdate = true;
  }

  // ── Particles ─────────────────────────────────────────────────────────
  const scaleU = { value: 400 };
  const sparks = new Particles(scene, 2600, { additive: true, map: glowTex, scale: scaleU });
  const dust = new Particles(scene, 600, { additive: false, map: glowTex, scale: scaleU });
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);
  function sparkle(at, n = 40, colors = ['#ffffff', '#bfe9ff'], power = 4) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = rand3(2).normalize().multiplyScalar(power * (0.4 + rnd() * 0.8));
      sparks.emit({ pos: at.clone(), vel: d, life: 0.8 + rnd() * 0.7, size: [0.4, 0.06], color: [colors[i % colors.length], '#7aa2ff'], drag: 1.6 });
    }
  }

  // ── The rocket (the avatar while flying) ─────────────────────────────
  const ROCKET_SCALE = 2.0;
  function buildRocket(ghostly) {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const white = new THREE.MeshStandardMaterial({ color: '#f4f6fb', metalness: 0.3, roughness: 0.35 });
    const red = new THREE.MeshStandardMaterial({ color: '#e5382f', metalness: 0.2, roughness: 0.4 });
    const grey = flat('#4b5563', { metalness: 0.6, roughness: 0.4 });
    const prof = [[0.001, 0], [0.34, 0.04], [0.4, 0.3], [0.42, 1.0], [0.4, 1.5], [0.001, 1.5]].map(([r, y]) => new THREE.Vector2(r, y));
    const hull = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), white); body.add(hull);
    const noseProf = [[0.4, 1.5], [0.36, 1.8], [0.26, 2.08], [0.12, 2.3], [0.001, 2.4]].map(([r, y]) => new THREE.Vector2(r, y));
    const nose = new THREE.Mesh(new THREE.LatheGeometry(noseProf, 28), red); body.add(nose);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.425, 0.425, 0.1, 28, 1, true), red); stripe.position.y = 0.55; body.add(stripe);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), new THREE.MeshStandardMaterial({ color: '#7dd3fc', emissive: '#38bdf8', emissiveIntensity: 0.8, roughness: 0.1 }));
    win.position.set(0, 1.25, 0.415); body.add(win);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 20), grey); frame.position.copy(win.position); body.add(frame);
    for (let k = 0; k < 4; k++) {
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.42, -0.25); shape.lineTo(0.42, 0.05); shape.lineTo(0, 0.6); shape.lineTo(0, 0);
      const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }), red);
      fin.position.y = 0.1; fin.rotation.y = (k / 4) * Math.PI * 2 + Math.PI / 4;
      fin.geometry.translate(0.36, 0, -0.02);
      body.add(fin);
    }
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.25, 16, 1, true), grey); nozzle.position.y = -0.08; body.add(nozzle);
    // door (opens on landing) and landing legs (fold out)
    const doorPivot = new THREE.Group(); doorPivot.position.set(-0.18, 0.2, 0.41); body.add(doorPivot);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.62, 0.03), white); door.position.set(0.18, 0.31, 0); doorPivot.add(door);
    const doorEdge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.66, 0.02), grey); doorEdge.position.set(0, 0.51, 0.405); body.add(doorEdge);
    const legs = [];
    for (let k = 0; k < 3; k++) {
      const pv = new THREE.Group(); pv.position.set(0, 0.35, 0); pv.rotation.y = (k / 3) * Math.PI * 2 + Math.PI / 3; body.add(pv);
      const hinge = new THREE.Group(); hinge.position.set(0.38, 0, 0); pv.add(hinge);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), grey); leg.position.y = -0.3; hinge.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10), grey); foot.position.y = -0.6; hinge.add(foot);
      legs.push(hinge);
    }
    // engine flame: an additive cone that flickers in the shader
    const flameMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime, uThrust: { value: 0.3 } },
      vertexShader: 'varying vec2 vUv; uniform float uTime; uniform float uThrust; void main(){ vUv = uv; vec3 p = position; p.xz *= 1.0 + 0.12 * sin(uTime * 40.0 + p.y * 8.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uThrust;
        void main(){ float a = smoothstep(0.0, 0.85, vUv.y); vec3 c = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.95, 0.7), a);
          gl_FragColor = vec4(c * a * (0.4 + uThrust) , 1.0); }`,
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 16, 1, true), flameMat);
    flame.rotation.x = Math.PI; flame.position.y = -0.85; body.add(flame);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb066', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    glow.position.y = -0.3; glow.scale.setScalar(1.6); body.add(glow);
    const mats = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o !== flame) { o.castShadow = !ghostly; mats.push(o.material); }
    });
    if (ghostly) {
      root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); Object.assign(o.material, { transparent: true, opacity: 0.32, depthWrite: false }); } });
      flame.visible = glow.visible = false;
    }
    body.scale.setScalar(ROCKET_SCALE);
    scene.add(root);
    return { root, body, flame, flameMat, glow, doorPivot, legs, nose };
  }
  const rocket = buildRocket(false);
  const ROCKET_MID = 1.1 * ROCKET_SCALE; // the hull's middle, which follows the route
  const rocketQ = new THREE.Quaternion();
  const fly = { thrust: 0.3, roll: 0, lastHeading: 0 };
  function aimRocket(dir, dt, rollTarget = 0) {
    const want = tmpQ.setFromUnitVectors(UP, dir.clone().normalize());
    fly.roll += (rollTarget - fly.roll) * Math.min(1, dt * 3);
    want.multiply(new THREE.Quaternion().setFromAxisAngle(UP, fly.roll));
    rocketQ.slerp(want, Math.min(1, dt * 5));
    rocket.root.quaternion.copy(rocketQ);
  }
  function placeRocketMid(p) {
    // the route runs through the hull's middle, not its base
    tmpV.set(0, ROCKET_MID, 0).applyQuaternion(rocket.root.quaternion);
    rocket.root.position.copy(p).sub(tmpV);
  }
  function exhaust(dt, strength) {
    if (reduceMotion || strength <= 0.05) return;
    const back = V(0, -1, 0).applyQuaternion(rocket.root.quaternion);
    const base = rocket.root.position.clone().addScaledVector(back, 0.4 * ROCKET_SCALE);
    const n = Math.ceil(dt * 90 * strength);
    for (let i = 0; i < n; i++) {
      sparks.emit({ pos: base.clone().add(rand3(0.3)), vel: back.clone().multiplyScalar(6 + rnd() * 4).add(rand3(1)), life: 0.35 + rnd() * 0.3, size: [0.7, 0.1], color: ['#fff3c4', '#ff9a2e', '#7a2ad8'], drag: 1.5 });
    }
  }

  // ── Satellites: one per task beside the route ────────────────────────
  const STATUS = { done: '#10b981', next: '#fbbf24', pending: '#cbd5e1' };
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 128, (g, w) => {
      g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
      g.fillStyle = fg; g.font = '900 68px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, w / 2 + 4);
    });
  }
  const foil = new THREE.MeshStandardMaterial({ color: '#d4a937', metalness: 0.9, roughness: 0.35 });
  const panelTex = canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#16245a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#5b7bd6'; g.lineWidth = 2;
    for (let x = 0; x <= w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  const panelMat = new THREE.MeshStandardMaterial({ map: panelTex, metalness: 0.5, roughness: 0.3, emissive: '#1d3b9a', emissiveIntensity: 0.25, side: THREE.DoubleSide });
  const flags = [];
  function buildFlags() {
    flags.forEach(f => scene.remove(f.group, f.ring));
    flags.length = 0;
    tasks.forEach((t, i) => {
      const u = checkpointFrac(i, tasks.length), p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize();
      const group = new THREE.Group();
      group.position.copy(p).addScaledVector(side, 4.2).add(V(0, 0.6, 0));
      const sat = new THREE.Group(); group.add(sat);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), foil); sat.add(box);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), new THREE.MeshStandardMaterial({ color: '#e5e7eb', side: THREE.DoubleSide, metalness: 0.4, roughness: 0.4 }));
      dish.position.y = 0.75; dish.rotation.x = Math.PI; sat.add(dish);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), flat('#9ca3af')); ant.position.y = 0.95; sat.add(ant);
      const panels = [-1, 1].map(s => {
        const pv = new THREE.Group(); pv.position.set(s * 0.45, 0, 0); sat.add(pv);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), flat('#9ca3af')); arm.rotation.z = Math.PI / 2; arm.position.x = s * 0.2; pv.add(arm);
        const pn = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), panelMat); pn.position.x = s * 1.2; pv.add(pn);
        return { pv, s };
      });
      const beaconMat = new THREE.MeshStandardMaterial({ color: STATUS.pending, emissive: STATUS.pending, emissiveIntensity: 0.6 });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), beaconMat); beacon.position.y = 1.3; sat.add(beacon);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: STATUS.pending, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      glow.position.y = 1.3; glow.scale.setScalar(1.4); sat.add(glow);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      badge.position.y = 2.1; badge.scale.setScalar(0.8); group.add(badge);
      // a hoop around the route marks the next satellite
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.06, 8, 48), new THREE.MeshBasicMaterial({ color: STATUS.next, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.copy(p); ring.quaternion.setFromUnitVectors(V(0, 0, 1), tan); scene.add(ring);
      sat.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(group);
      flags.push({ group, sat, panels, beaconMat, glow, badge, ring, unfold: 0, unfoldTarget: 0, pop: 0, status: '', spin: rnd() * 6 });
    });
  }
  function refreshFlags() {
    const doneCount = tasks.filter(t => t.done).length;
    tasks.forEach((t, i) => {
      const f = flags[i];
      const status = t.done ? 'done' : i === doneCount ? 'next' : 'pending';
      if (f.status === status) return;
      f.status = status;
      f.beaconMat.color.set(STATUS[status]); f.beaconMat.emissive.set(STATUS[status]); f.glow.material.color.set(STATUS[status]);
      f.badge.material.map = status === 'done' ? badgeTexture('✓', STATUS.done, '#06301b') : badgeTexture(String(i + 1), status === 'next' ? STATUS.next : '#eef2f7', '#0b1534');
      f.badge.material.needsUpdate = true;
      f.ring.visible = status === 'next';
      if (status !== 'done') f.unfoldTarget = 0;
    });
  }

  // ── Asteroid clusters (blocked tasks) ─────────────────────────────────
  const rockGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { tmpV.fromBufferAttribute(p, i); const k = 0.75 + vnoise(tmpV.x * 2 + 5, tmpV.y * 2 + tmpV.z * 2) * 0.5; p.setXYZ(i, tmpV.x * k, tmpV.y * k, tmpV.z * k); }
    g.computeVertexNormals();
    return g;
  })();
  const rockMat = new THREE.MeshStandardMaterial({ color: '#7c7468', roughness: 0.95, flatShading: true });
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6b5e'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  // Alien saucers: a silver disc, a glass dome and a ring of blinking lights.
  const ufoMetal = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.85, roughness: 0.25 });
  const ufoGlass = new THREE.MeshStandardMaterial({ color: '#67e8f9', emissive: '#22d3ee', emissiveIntensity: 0.6, transparent: true, opacity: 0.8, roughness: 0.1 });
  function buildUfo() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const disc = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), ufoMetal); disc.scale.set(1.3, 0.28, 1.3); body.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.08, 8, 32), new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.7, roughness: 0.3 })); rim.rotation.x = Math.PI / 2; body.add(rim);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), ufoGlass); dome.position.y = 0.18; body.add(dome);
    const alien = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: '#84cc16', roughness: 0.5 })); alien.position.y = 0.35; body.add(alien);
    const lights = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: k % 2 ? '#fde047' : '#f472b6' }));
      l.position.set(Math.cos(a) * 1.05, -0.05, Math.sin(a) * 1.05); body.add(l); lights.push(l);
    }
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#a3e635', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = -1.2; body.add(beam);
    body.traverse(o => { if (o.isMesh && o !== beam) o.castShadow = true; });
    body.scale.setScalar(0.85);
    scene.add(g);
    return { kind: 'ufo', g, body, lights };
  }
  function buildRockFoe() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    [[0, 0, 0, 1.25], [1.1, 0.5, -0.3, 0.5], [-0.9, -0.6, 0.4, 0.45]].forEach(([x, y, z, sc]) => {
      const m = new THREE.Mesh(rockGeo, rockMat); m.position.set(x, y, z); m.scale.setScalar(sc); m.castShadow = true; body.add(m);
    });
    scene.add(g);
    return { kind: 'rock', g, body };
  }
  // Every task's obstacles: one enemy per obstacle point (asteroids and
  // alien saucers in turn) hanging across the route in front of the satellite.
  const walls = [];
  function buildWalls() {
    walls.forEach(w => { w.foes.forEach(f => scene.remove(f.g)); scene.remove(w.lock, w.hoop, w.tag); });
    walls.length = 0;
    tasks.forEach((t, i) => {
      if (!t.foeList.length) return;
      const u = wallFrac(i), p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = new THREE.Vector3().crossVectors(tan, UP).normalize(), up2 = new THREE.Vector3().crossVectors(side, tan).normalize();
      const n = Math.min(t.foeList.length, 5);
      const owners = pickFoes(t.foeList, n);
      const foes = Array.from({ length: n }, (_, k) => {
        const f = k % 2 === 0 ? buildRockFoe() : buildUfo();
        const a = (k / n) * Math.PI * 2 + 0.4, r = n === 1 ? 0 : 1.6 + (k % 2) * 0.7;
        const home = p.clone().addScaledVector(side, Math.cos(a) * r * 1.3).addScaledVector(up2, Math.sin(a) * r).addScaledVector(tan, (k % 3) * 1.4);
        f.g.position.copy(home);
        // owner: the obstacle this enemy stands for; ticked once it's resolved
        const ticked = owners[k].resolved;
        if (ticked) f.g.visible = false;
        return Object.assign(f, { home, spin: rand3(1), ph: rnd() * 6, delay: 0.15 + k * 0.35, blasted: ticked, owner: owners[k].id, ticked });
      });
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.copy(p).addScaledVector(up2, 3.6); lock.scale.setScalar(0.9); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear', 0.6);
      tag.position.copy(p).addScaledVector(up2, 4.5); scene.add(tag);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.07, 8, 48), new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      hoop.position.copy(p); hoop.quaternion.setFromUnitVectors(V(0, 0, 1), tan); scene.add(hoop);
      const w = { taskIndex: i, foes, lock, tag, hoop, center: p.clone(), up: up2.clone(), cleared: !!t.done, clearing: false, t: t.done ? 99 : 0, open: !t.foes, fade: t.done || !t.foes ? 1 : 0 };
      if (w.cleared) foes.forEach(f => { f.g.visible = false; f.blasted = true; });
      if (w.fade) lock.visible = tag.visible = hoop.visible = false;
      walls.push(w);
    });
  }
  const standing = w => w.foes.filter(f => !f.ticked);
  const wallPause = w => 0.8 + 0.35 * Math.max(1, standing(w).length);
  // laser bolts and rock fragments
  const laserMat = new THREE.MeshBasicMaterial({ color: '#ff4d6d', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const lasers = [];
  function fireLaser(from, to) {
    const d = to.clone().sub(from), len = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6, 1, true), laserMat);
    m.position.copy(from).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize());
    scene.add(m); lasers.push({ m, life: 0.18 });
  }
  const FRAGS = 160;
  const frags = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: '#8a8070', roughness: 0.9, flatShading: true }), FRAGS);
  frags.frustumCulled = false;
  const fragState = Array.from({ length: FRAGS }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1 }));
  let fragNext = 0;
  scene.add(frags);
  function shatter(at, scale) {
    sparkle(at, 30, ['#fff3c4', '#ff9a2e', '#ffffff'], 6);
    if (reduceMotion) return;
    for (let k = 0; k < 14; k++) {
      const f = fragState[fragNext]; fragNext = (fragNext + 1) % FRAGS;
      f.life = 1.6 + rnd(); f.p.copy(at).add(rand3(scale)); f.v.copy(rand3(1).normalize().multiplyScalar(4 + rnd() * 5));
      f.r.set(rnd() * 6, rnd() * 6, rnd() * 6); f.w.copy(rand3(12)); f.s = scale * (0.6 + rnd() * 0.8);
    }
  }
  function updateFrags(dt) {
    fragState.forEach((f, i) => {
      if (f.life > 0) {
        f.life -= dt; f.p.addScaledVector(f.v, dt); f.r.x += f.w.x * dt; f.r.y += f.w.y * dt; f.r.z += f.w.z * dt;
      }
      const s = f.life > 0 ? f.s * Math.min(1, f.life) : 0;
      frags.setMatrixAt(i, tmpM.compose(f.p, tmpQ.setFromEuler(f.r), V(s, s, s)));
    });
    frags.instanceMatrix.needsUpdate = true;
    for (let k = lasers.length - 1; k >= 0; k--) {
      lasers[k].life -= dt;
      if (lasers[k].life <= 0) { scene.remove(lasers[k].m); lasers[k].m.geometry.dispose(); lasers.splice(k, 1); }
    }
  }
  function clearWall(w) {
    if (w.cleared) return;
    w.cleared = true; w.t = 0;
    standing(w).forEach((f, j) => { f.delay = 0.15 + j * 0.35; });
    if (reduceMotion) { w.t = 99; w.foes.forEach(f => { f.g.visible = false; f.blasted = true; }); w.lock.visible = w.tag.visible = w.hoop.visible = false; }
    notify();
  }
  function restoreWall(w) {
    w.cleared = false; w.clearing = false; w.t = 0;
    w.foes.forEach(f => { if (!f.ticked) reviveFoe(f); });
  }
  function reviveFoe(f) { f.ticked = false; f.g.visible = true; f.g.position.copy(f.home); f.blasted = false; }
  // The rocket's laser blows one enemy apart.
  function blast(f) {
    f.blasted = true;
    if (!f.g.visible) return;
    const nose = V(0, 2.4 * ROCKET_SCALE, 0).applyQuaternion(rocket.root.quaternion).add(rocket.root.position);
    fireLaser(nose, f.g.position);
    shatter(f.g.position.clone(), f.kind === 'rock' ? 1.2 : 0.8);
    if (f.kind === 'ufo') sparkle(f.g.position.clone(), 40, ['#a3e635', '#fde047', '#ffffff'], 6);
    f.g.visible = false;
    cam.shake = Math.max(cam.shake, 0.18);
  }
  // Swaps a wall's red tag for one naming only what's still pending.
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear', 0.6);
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  // An obstacle ticked off (or unticked) on its own: the rocket flies up
  // beside its enemies and blasts them (see engageResolved), or they drift
  // back, and its name pops up over the route.
  function applyResolves(changes) {
    const engaging = [];
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.center.clone().addScaledVector(w.up, 5.2) : curve.getPointAt(wallFrac(c.index));
      const label = c.resolved ? () => shell.spawnTaskLabel(at, c.name, 'foe') : null;
      const now = () => { if (label) { timers.push(setTimeout(label, j * 450)); if (w) { peek.at.copy(w.center); peek.t = 3.4; } } };
      let engagedHere = false;
      if (!w) { now(); return; }
      w.foes.forEach((f, k) => {
        if (f.owner !== c.id) return;
        if (c.resolved && !f.ticked) {
          f.ticked = true;
          if (f.blasted) return;
          // still out there: the rocket goes and blasts it (engageResolved)
          if (!reduceMotion && !w.cleared) { engaging.push({ w, f, label: engagedHere ? null : label }); engagedHere = true; }
          else timers.push(setTimeout(() => { if (f.ticked && !f.blasted) blast(f); }, j * 450 + k * 160));
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
  // The rocket flies up beside a ticked-off obstacle's enemies and blasts
  // them one after another (walker.engage); near is false when it couldn't
  // get there, and they're blasted from where it is.
  function engageResolved(list) {
    const byWall = new Map();
    list.forEach(e => { if (!byWall.has(e.w)) byWall.set(e.w, []); byWall.get(e.w).push(e); });
    byWall.forEach((items, w) => walker.engage(w.taskIndex, near => {
      items.forEach((e, k) => timers.push(setTimeout(() => { if (e.f.ticked && !e.f.blasted) blast(e.f); }, (near ? 250 : 0) + k * 350)));
      items.filter(e => e.label).forEach((e, k) => timers.push(setTimeout(e.label, k * 450 + (near ? 300 : 0))));
      peek.at.copy(w.center); peek.t = 3.4;
    }, 0.6 + 0.35 * items.length));
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      w.foes.forEach(f => {
        if (!f.g.visible) return;
        if (f.kind === 'rock') { f.body.rotation.x += f.spin.x * dt * 0.4; f.body.rotation.y += f.spin.y * dt * 0.4; }
        else { f.body.rotation.y += dt * 1.6; f.lights.forEach((l, q) => { l.visible = ((Math.floor(time * 6) + q) % 3) !== 0; }); }
        if (!w.cleared) f.g.position.copy(f.home).add(V(Math.sin(time * 0.5 + f.ph) * 0.2, Math.cos(time * 0.7 + f.ph) * 0.25, 0));
      });
      // the lock, tag and hoop fade out once nothing is left blocking
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.8, 0, 1);
      w.lock.material.opacity = w.tag.material.opacity = 1 - w.fade;
      w.hoop.material.opacity = (shut ? 0.4 + 0.25 * Math.sin(time * 4) : 0.6) * (1 - w.fade);
      w.lock.visible = w.tag.visible = w.hoop.visible = w.fade < 1;
      if (!w.cleared || w.t > 60) return;
      w.t += dt;
      // lasers fire from the nose at each enemy in turn, and it blows apart
      w.foes.forEach(f => { if (!f.blasted && w.t >= f.delay) blast(f); });
    });
  }

  // ── The astronaut (comes out at the end) ──────────────────────────────
  const loader = new GLTFLoader();
  let astro = null, clips = [];
  const ASTRO_H = 1.45;
  function dressAstronaut(obj) {
    ['Knight_Helmet', 'Knight_Cape', '1H_Sword', 'Badge_Shield'].forEach(n => { const o = obj.getObjectByName(n); if (o) o.removeFromParent(); });
    recolorCharacter(obj, (h, s, l) => {
      if (s < 0.16 && l > 0.16 && l < 0.86) return [215, 0.08, 0.72 + l * 0.22];
      if ((h > 340 || h < 12) && s > 0.4) return [22, 0.95, Math.min(0.6, l + 0.1)];
      if (h > 15 && h < 40 && s > 0.25 && s < 0.6 && l < 0.45) return [215, 0.1, 0.55 + l * 0.3];
      return null;
    });
  }
  function rigAstronaut(ch) {
    const obj = ch.obj;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const head = findBone(obj, 'head');
    if (head) {
      const hp = new THREE.Vector3(); head.getWorldPosition(hp);
      const r = (box.max.y - hp.y) * 0.64;
      const helmet = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ color: '#e0f2ff', transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.2, depthWrite: false }));
      glass.renderOrder = 6; helmet.add(glass);
      const visor = new THREE.Mesh(new THREE.SphereGeometry(r * 1.01, 24, 16, -0.9, 1.8, 0.7, 1.0), new THREE.MeshStandardMaterial({ color: '#f59e0b', metalness: 0.9, roughness: 0.15, transparent: true, opacity: 0.45, depthWrite: false }));
      visor.rotation.y = Math.PI / 2; helmet.add(visor);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.13, 8, 24), new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 0.4, roughness: 0.4 }));
      collar.rotation.x = Math.PI / 2; collar.position.y = -r * 0.78; helmet.add(collar);
      attachToBone(obj, head, helmet, V(hp.x, hp.y + r * 0.82, hp.z + r * 0.04));
    }
    const chestBone = findBone(obj, 'chest');
    if (chestBone) {
      const cp = new THREE.Vector3(); chestBone.getWorldPosition(cp);
      const pack = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(ASTRO_H * 0.3, ASTRO_H * 0.34, ASTRO_H * 0.14), new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.5 })); pack.add(b);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(ASTRO_H * 0.16, ASTRO_H * 0.1, 0.02), new THREE.MeshStandardMaterial({ color: '#1e293b', emissive: '#22d3ee', emissiveIntensity: 0.5 }));
      panel.position.set(0, ASTRO_H * 0.06, -ASTRO_H * 0.075); pack.add(panel);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, ASTRO_H * 0.3, 6), flat('#9ca3af')); ant.position.set(ASTRO_H * 0.1, ASTRO_H * 0.3, 0); pack.add(ant);
      pack.traverse(o => { if (o.isMesh) o.castShadow = true; });
      attachToBone(obj, chestBone, pack, V(cp.x, cp.y, cp.z - ASTRO_H * 0.16));
    }
  }
  // the flag the astronaut plants
  const flag = new THREE.Group();
  const flagCloth = (() => {
    const tex = canvasTexture(128, 80, (g, w, h) => {
      g.fillStyle = '#0d9488'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fbbf24'; g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? 11 : 26; g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
      g.fill();
    });
    const geo = new THREE.PlaneGeometry(1.6, 1.0, 12, 4); geo.translate(0.8, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 });
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(uTime * 3.0 - position.x * 4.0) * 0.09 * (position.x / 1.6);');
    };
    return new THREE.Mesh(geo, mat);
  })();
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 0.7, roughness: 0.3 }));
    pole.position.y = 1.1; flag.add(pole);
    flagCloth.position.set(0.03, 1.65, 0); flag.add(flagCloth);
    flag.traverse(o => { if (o.isMesh) o.castShadow = true; });
    flag.visible = false; scene.add(flag);
  }

  // ── Flying the route ──────────────────────────────────────────────────
  const walker = createWalker({
    curve, speed: 7, accel: 7, brakeDecel: 6, reduceMotion, getTasks: () => tasks, walls,
    hooks: {
      stopFrac: rocksStopFrac, wallPause,
      place(frac, moving) {
        fly.moving = moving;
        const u = THREE.MathUtils.clamp(frac, 0, 1);
        const p = curve.getPointAt(u), t = curve.getTangentAt(u);
        if (!fly.dir) fly.dir = t.clone();
        fly.p = p;
        if (moving) fly.dir.copy(t).multiplyScalar(walker.P.stops[0] && walker.P.stops[0].frac < walker.P.frac ? -1 : 1);
      },
      runAnim() {}, idleAnim() {},
      onFlag(i, t) {
        const f = flags[i];
        if (!f) return;
        f.unfoldTarget = 1; f.pop = 1;
        sparkle(f.group.position.clone().add(V(0, 1.3, 0)), 50, ['#a7f3d0', '#ffffff', '#fde68a'], 4);
        shell.spawnTaskLabel(f.group.position.clone().add(V(0, 2.7, 0)), t.title);
      },
      clearWall, restoreWall,
      startFinale, undoFinale: undoVictory, updateFinale, updateVictory,
    },
  });
  const P = walker.P;
  function updateRocket(dt, time) {
    walker.update(dt);
    if (P.mode === 'finale' || P.mode === 'victory') return;
    if (!fly.p) return;
    const turn = angleLerp(0, Math.atan2(fly.dir.x, fly.dir.z) - fly.lastHeading, 1);
    fly.lastHeading = Math.atan2(fly.dir.x, fly.dir.z);
    const bank = THREE.MathUtils.clamp(-turn * 25, -0.6, 0.6);
    aimRocket(fly.dir, dt, fly.moving ? bank + time * 0.0 : Math.sin(time * 0.4) * 0.3);
    const bob = fly.moving ? 0 : Math.sin(time * 1.4) * 0.15;
    placeRocketMid(fly.p.clone().add(V(0, bob, 0)));
    const want = fly.moving ? 1 : 0.25;
    fly.thrust += (want - fly.thrust) * Math.min(1, dt * 4);
    setThrust(fly.thrust);
    exhaust(dt, fly.moving ? 1 : 0.15);
  }
  function setThrust(k) {
    rocket.flameMat.uniforms.uThrust.value = k;
    rocket.flame.scale.set(1, 0.4 + k * 1.1, 1);
    rocket.flame.visible = k > 0.02;
    rocket.glow.material.opacity = Math.min(1, k * 1.2);
    rocket.glow.scale.setScalar(1 + k);
  }

  // ── Finale: land, open the hatch, walk out, plant the flag ───────────
  const HOVER = PAD.clone().add(V(0, 9, 0));
  const ROCKET_BASE_ON_PAD = PAD.clone().add(V(0, 0.6 * ROCKET_SCALE + 0.05, 0));
  let legsOut = 0, doorOpen = 0;
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  const doorDir = () => V(0, 0, 1).applyQuaternion(rocket.root.quaternion).setY(0).normalize();
  function startFinale() {
    if (P.won) return;
    P.mode = 'finale'; P.finT = 0;
    const midNow = rocket.root.position.clone().add(V(0, ROCKET_MID, 0).applyQuaternion(rocket.root.quaternion));
    P.fin = { from: midNow, steps: new Set() };
    if (reduceMotion) { settleWon(); victory(); }
  }
  function bezier(a, b, c, t) { return a.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(b, 2 * (1 - t) * t).addScaledVector(c, t * t); }
  function updateFinale(dt) {
    const t = (P.finT += dt), F = P.fin;
    if (t < 3) {
      // arc over to hover above the pad, turning nose-up
      const k = smooth(0, 3, t);
      const ctrl = F.from.clone().lerp(HOVER, 0.5).add(V(0, 6, 0));
      const p = bezier(F.from, ctrl, HOVER, k), ahead = bezier(F.from, ctrl, HOVER, Math.min(1, k + 0.02));
      const dir = ahead.sub(p); if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      aimRocket(dir.normalize().lerp(UP, smooth(1.8, 3, t)).normalize(), dt, 0);
      placeRocketMid(p);
      setThrust(1); exhaust(dt, 1);
    } else if (t < 6) {
      // descend onto the pad, legs out, dust kicking up
      const k = smooth(3, 6, t);
      aimRocket(UP, dt, 0);
      rocket.root.position.lerpVectors(HOVER.clone().sub(V(0, ROCKET_MID, 0)), ROCKET_BASE_ON_PAD, k);
      legsOut = smooth(3.3, 4.6, t);
      setThrust(0.9 - k * 0.6); exhaust(dt, 0.8 - k * 0.5);
      if (k > 0.55 && !reduceMotion) {
        for (let i = 0; i < Math.ceil(dt * 40); i++) {
          const a = rnd() * Math.PI * 2;
          dust.emit({ pos: PAD.clone().add(V(Math.cos(a) * 1.2, 0.2, Math.sin(a) * 1.2)), vel: V(Math.cos(a) * 5, 0.6 + rnd(), Math.sin(a) * 5), life: 1.4 + rnd(), size: [1, 3], color: ['#c4b5fd', '#6b5b8f'], alpha: 0.5, drag: 1.8 });
        }
      }
      if (k > 0.98) once('touchdown', () => { cam.shake = 0.3; });
    } else {
      setThrust(Math.max(0, rocket.flameMat.uniforms.uThrust.value - dt));
      rocket.root.position.copy(ROCKET_BASE_ON_PAD);
      doorOpen = smooth(6.2, 7.0, t);
      // the astronaut steps out and walks to the flag spot
      const out = doorDir();
      const doorPos = ROCKET_BASE_ON_PAD.clone().addScaledVector(out, 0.9 * ROCKET_SCALE).add(V(0, -0.4, 0));
      const flagSpot = PAD.clone().addScaledVector(out, 3.6).add(V(1.4, 0, 0));
      if (t > 6.8) once('exit', () => {
        astro.holder.visible = true; astro.holder.position.copy(doorPos).setY(surfaceY(doorPos.x, doorPos.z));
        astro.holder.rotation.y = Math.atan2(out.x, out.z);
        play(astro, 'Walking_A', { fade: 0.2, timeScale: 0.75 });
      });
      if (t > 6.8 && t < 10) {
        const k = smooth(6.8, 9.6, t);
        const p = doorPos.clone().lerp(flagSpot, k);
        astro.holder.position.set(p.x, surfaceY(p.x, p.z) + Math.abs(Math.sin(t * 3.2)) * 0.12, p.z);
        astro.holder.rotation.y = angleLerp(astro.holder.rotation.y, Math.atan2(flagSpot.x - doorPos.x, flagSpot.z - doorPos.z), Math.min(1, dt * 5));
      }
      if (t > 10) once('plant', () => {
        astro.holder.position.y = surfaceY(astro.holder.position.x, astro.holder.position.z);
        play(astro, 'Interact', { fade: 0.2, once: true });
      });
      if (t > 10.4) {
        const f = astro.holder.position.clone().add(V(Math.sin(astro.holder.rotation.y), 0, Math.cos(astro.holder.rotation.y)).multiplyScalar(0.8));
        once('flag', () => { flag.visible = true; flag.position.set(f.x, surfaceY(f.x, f.z) - 2.2, f.z); flag.rotation.y = astro.holder.rotation.y + Math.PI / 2; sparkle(f.clone().setY(surfaceY(f.x, f.z) + 0.4), 40, ['#fde68a', '#ffffff'], 3); });
        flag.position.y = surfaceY(flag.position.x, flag.position.z) - 2.2 * (1 - smooth(10.4, 11, t));
      }
      if (t > 11.6) once('win', victory);
    }
    rocket.legs.forEach(h => { h.rotation.z = -0.15 - legsOut * 0.55; });
    rocket.doorPivot.rotation.y = -doorOpen * 1.8;
  }
  function victory() {
    P.won = true;
    if (celebrationsOn) shell.showWin();
    if (astro) play(astro, 'Cheer', { fade: 0.3 });
    P.mode = 'victory'; P.vicT = 0;
    notify();
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; timers.push(setTimeout(cb, celebrationsOn ? 1800 : 0)); }
  }
  function updateVictory(dt) {
    P.vicT = (P.vicT || 0) + dt;
    if (astro && astro.holder.visible) {
      const toCam = Math.atan2(camera.position.x - astro.holder.position.x, camera.position.z - astro.holder.position.z);
      astro.holder.rotation.y = angleLerp(astro.holder.rotation.y, toCam, Math.min(1, dt * 2));
      if (P.vicT > 6 && astro.current === astro.actions.Cheer) play(astro, 'Idle', { fade: 0.5 });
    }
    if (!reduceMotion && celebrationsOn && rnd() < dt * 2) sparkle(PAD.clone().add(V((rnd() - 0.5) * 10, 3 + rnd() * 5, (rnd() - 0.5) * 10)), 16, ['#fde68a', '#a5f3fc', '#f0abfc'], 3);
  }
  function settleWon() {
    rocketQ.identity(); rocket.root.quaternion.identity();
    rocket.root.position.copy(ROCKET_BASE_ON_PAD);
    legsOut = 1; doorOpen = 1; setThrust(0);
    rocket.legs.forEach(h => { h.rotation.z = -0.7; }); rocket.doorPivot.rotation.y = -1.8;
    const out = doorDir();
    const spot = PAD.clone().addScaledVector(out, 3.6).add(V(1.4, 0, 0));
    astro.holder.visible = true; astro.holder.position.set(spot.x, surfaceY(spot.x, spot.z), spot.z);
    astro.holder.rotation.y = Math.atan2(out.x, out.z);
    const f = spot.clone().addScaledVector(out, 0.8);
    flag.visible = true; flag.position.set(f.x, surfaceY(f.x, f.z), f.z); flag.rotation.y = astro.holder.rotation.y + Math.PI / 2;
    P.fin = { steps: new Set(['touchdown', 'exit', 'plant', 'flag', 'win']) };
    P.won = true; P.mode = 'victory'; P.vicT = 99;
    play(astro, 'Idle', { fade: 0 });
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; shell.winEl.hidden = true;
    legsOut = 0; doorOpen = 0;
    rocket.legs.forEach(h => { h.rotation.z = -0.15; }); rocket.doorPivot.rotation.y = 0;
    flag.visible = false;
    if (astro) { astro.holder.visible = false; play(astro, 'Idle', { fade: 0 }); }
    fly.dir = null;
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  const cam = { look: V(0, 0, 30), shake: 0 };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  const peek = { at: new THREE.Vector3(), t: 0 };
  function updateCamera(dt, time) {
    const rp = rocket.root.position.clone().add(V(0, ROCKET_MID, 0).applyQuaternion(rocket.root.quaternion));
    let rate = 3;
    if (P.mode === 'finale' && P.finT < 6) {
      camDesired.copy(PAD).add(V(9, 5, 15)); lookDesired.copy(rp); rate = 2;
    } else if (P.mode === 'finale' || P.mode === 'victory') {
      const a = 0.5 + (P.mode === 'victory' ? Math.sin(time * 0.1) * 0.35 : 0);
      const focus = astro && astro.holder.visible ? astro.holder.position.clone() : PAD.clone();
      camDesired.copy(focus).add(V(Math.sin(a) * 5.2, 2.0, Math.cos(a) * 5.2 + 1));
      lookDesired.copy(focus).add(V(-0.6, 1.5, -1.2));
      rate = 1.6;
    } else if (shell.cam.mode === 'overview') {
      camDesired.set(55, 38, 52);
      lookDesired.set(0, 0, -6);
    } else {
      const dir = (fly.dir || V(0, 0, -1)).clone().setY(fly.dir ? fly.dir.y * 0.5 : 0).normalize();
      const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
      camDesired.copy(rp).addScaledVector(dir, -12.5).addScaledVector(side, 2.6).add(V(0, 4.2, 0));
      lookDesired.copy(rp).addScaledVector(dir, 6);
      peekCamera(peek, rp, camDesired, lookDesired, dt, 15, 5, 2.5);
    }
    const k = 1 - Math.exp(-dt * rate);
    camera.position.lerp(camDesired, k);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
    if (cam.shake > 0 && !reduceMotion) { camera.position.add(rand3(cam.shake * 0.3)); cam.shake = Math.max(0, cam.shake - dt); }
    sun.target.position.copy(rp); sun.position.copy(rp).addScaledVector(sunDir, 100);
    nebula.position.copy(camera.position);
  }

  // ── Ghost, label, state ──────────────────────────────────────────────
  let ghost = null;
  function updateGhost(g) {
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.root.visible = false; return; }
    if (!ghost) ghost = buildRocket(true);
    const u = THREE.MathUtils.clamp(progressToPathFracSmooth(g.frac, tasks.length), 0, 1);
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    const side = new THREE.Vector3().crossVectors(t, UP).normalize();
    ghost.root.visible = true;
    ghost.root.quaternion.setFromUnitVectors(UP, t);
    ghost.root.position.copy(p).addScaledVector(side, -2.4).sub(V(0, ROCKET_MID, 0).applyQuaternion(ghost.root.quaternion));
  }
  function notify() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Space Journey: ${done} of ${n} tasks done.` : 'Space Journey: no tasks yet.';
    const blocked = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= walker.progressToFrac(done, n) + 1e-3);
    if (blocked) text += ` An asteroid field blocks the route: ${tasks[blocked.taskIndex].blocker}.`;
    if (n && done === n) text += P.won ? ' Landed on a new world!' : ' Coming in to land.';
    shell.root.setAttribute('aria-label', text);
  }
  let latestState = null, layoutSig = null;
  const toTasks = stageTasks;
  function snapCamera() {
    const rp = rocket.root.position.clone().add(V(0, ROCKET_MID, 0).applyQuaternion(rocket.root.quaternion));
    const dir = (fly.dir || V(0, 0, -1)).clone().setY(0).normalize();
    camera.position.copy(rp).addScaledVector(dir, -12.5).add(V(0, 4.2, 0));
    cam.look.copy(rp).addScaledVector(dir, 5);
    camera.lookAt(cam.look);
  }
  function applyState(state) {
    onSummitCb = state.onSummit || null;
    const next = toTasks(state), n = next.length;
    const sig = layoutSignature(next);
    if (sig !== layoutSig) {
      const firstBuild = layoutSig === null;
      layoutSig = sig;
      if (P.won || P.mode === 'finale' || P.mode === 'victory') undoVictory();
      tasks = next;
      buildFlags(); buildWalls(); refreshFlags();
      tasks.forEach((t, i) => { if (t.done) { flags[i].unfoldTarget = 1; flags[i].unfold = 1; } });
      fly.dir = null;
      walker.reset();
      // settle the rocket onto the route at once
      fly.dir = curve.getTangentAt(THREE.MathUtils.clamp(P.frac, 0, 1)).clone();
      rocketQ.setFromUnitVectors(UP, fly.dir); rocket.root.quaternion.copy(rocketQ);
      placeRocketMid(curve.getPointAt(THREE.MathUtils.clamp(P.frac, 0, 1)));
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
    uTime.value = time;
    if (astro) astro.mixer.update(dt);
    updateRocket(dt, time);
    updateWalls(dt, time);
    updateFrags(dt);
    updateBelt(time);
    spinners.forEach(s => { s.m.rotation.y += s.spin * dt; });
    station.rotation.z += dt * 0.08;
    brightStars.material.opacity = 0.8 + Math.sin(time * 2) * 0.2;
    flags.forEach(f => {
      f.unfold += (f.unfoldTarget - f.unfold) * Math.min(1, dt * 2.5);
      f.panels.forEach(({ pv, s }) => { pv.rotation.y = s * (1 - f.unfold) * 1.45; });
      f.sat.rotation.y = f.spin + time * 0.25;
      f.group.position.y += Math.sin(time * 0.9 + f.spin) * 0.002;
      f.glow.material.opacity = f.status === 'done' ? 0.7 + Math.sin(time * 3 + f.spin) * 0.3 : 0.6;
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); f.sat.scale.setScalar(1 + Math.sin((1 - f.pop) * Math.PI) * 0.3); }
      if (f.ring.visible) { f.ring.material.opacity = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); f.ring.scale.setScalar(1 + 0.06 * Math.sin(time * 4)); }
    });
    sparks.update(dt); dust.update(dt);
    updateCamera(dt, time);
    shell.updateTaskLabels(camera);
  }
  const loop = createLoop(shell, camera, scene, simulate, (w, h) => { scaleU.value = particleScaleFor(renderer, camera, h); });

  loadGLTF(loader, ASTRONAUT_URL).then(gltf => {
    if (loop.destroyed) return;
    clips = gltf.animations;
    dressAstronaut(gltf.scene);
    astro = makeCharacter(scene, gltf.scene, clips, ASTRO_H);
    rigAstronaut(astro);
    astro.holder.visible = false;
    play(astro, 'Idle', { fade: 0 });
    shell.loadingEl.hidden = true;
    loop.setReady();
    if (latestState) applyState(latestState);
    loop.start();
  }).catch(err => {
    console.error('Space 3D: could not load the astronaut', err);
    shell.loadingEl.textContent = 'Couldn’t load the 3D astronaut. Switch the scene to Space for the 2D version.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (astro) applyState(state);
    },
    pause: loop.stop,
    resume: loop.start,
    destroy() { loop.destroy(container); },
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) simulate(1 / 30); },
      get state() {
        const rp = rocket.root.position.clone().add(V(0, ROCKET_MID, 0).applyQuaternion(rocket.root.quaternion));
        return {
          ready: !!astro, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length, finT: P.finT,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)), walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, foes: w.foes.length, gone: w.foes.filter(f => f.ticked).length, open: !!w.open })),
          landed: legsOut > 0.99, flag: flag.visible, astro: astro ? astro.holder.visible : false, ghost: ghost ? ghost.root.visible : false,
          label: shell.root.getAttribute('aria-label'), panels: flags.map(f => +f.unfold.toFixed(2)),
          onPath: P.mode !== 'finale' && P.mode !== 'victory' ? (() => { let d = 1e9; for (let i = 0; i <= 400; i++) d = Math.min(d, curve.getPointAt(i / 400).distanceTo(rp)); return d; })() : 0,
        };
      },
    },
  };
}
