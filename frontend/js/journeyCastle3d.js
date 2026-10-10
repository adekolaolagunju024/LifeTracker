// ── JOURNEY 3D: CASTLE STAGE ("Knight's Quest", WebGL / three.js) ──────
// A knight marches a cobbled road from a village, through a forest and over
// a river bridge, to a castle: one banner (with a fire basket that lights
// up) per task, a giant frog squatting on the road for each blocked task,
// and a dragon guarding the gate. Finishing the last task plays the fight:
// the dragon breathes fire, the knight blocks and strikes, the dragon falls,
// the portcullis lifts and the princess runs out to him under fireworks.
// The sky moves from afternoon to sunset as the quest progresses.
//
// Loaded on demand by journeyGame.js (only when the "Castle 3D" theme is
// picked), which falls back to the 2D Castle stage if WebGL or this module
// isn't available. Same contract as journey3d.js: app.js owns state and
// calls sync() with { tasks, ghost, celebrationsEnabled, onSummit, ... }.
//
// The knight and princess come from the KayKit Adventurers pack by Kay
// Lousberg, CC0 (frontend/assets/models/README.md). The frogs, the dragon,
// the castle and the valley are built here from primitives.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { stageTasks, layoutSignature, nameTagSprite, pickFoes, resolveChanges, tagText, peekCamera } from './journey3dKit.js';

const KNIGHT_URL = '/assets/models/Knight.glb';
const PRINCESS_URL = '/assets/models/Princess.glb';

function injectStyles() {
  if (document.getElementById('journey-castle3d-styles')) return;
  const style = document.createElement('style');
  style.id = 'journey-castle3d-styles';
  style.textContent = `
    .jc3d-root { position: absolute; inset: 0; overflow: hidden; background: #0d1326; }
    .jc3d-root canvas { display: block; width: 100%; height: 100%; touch-action: pan-y; }
    .jc3d-cam { position: absolute; top: 10px; right: 10px; display: flex; padding: 3px; border-radius: 999px;
      background: rgba(13,19,38,.8); border: 1px solid rgba(231,214,170,.2); z-index: 2; }
    .jc3d-cam button { font: 600 12px system-ui, sans-serif; color: #b9b3a3; background: transparent; border: 0;
      border-radius: 999px; padding: 7px 11px; cursor: pointer; min-height: 30px; }
    .jc3d-cam button[aria-pressed="true"] { background: #f6f0e1; color: #0d1326; }
    .jc3d-cam button:focus-visible { outline: 2px solid #e7b443; outline-offset: 2px; }
    .jc3d-win { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 3; text-align: center; padding: 0 12px; }
    .jc3d-win[hidden] { display: none; }
    .jc3d-win div { animation: jc3d-win-pop 4.2s cubic-bezier(.2,1.3,.4,1) both; }
    .jc3d-win strong { display: block; font: 900 clamp(30px, 7vw, 76px) Georgia, "Times New Roman", serif; letter-spacing: .04em; line-height: 1;
      color: #ffe39a; -webkit-text-stroke: 1.5px #6b3a07; text-shadow: 0 4px 0 #6b3a07, 0 12px 34px rgba(0,0,0,.6); text-transform: uppercase; }
    .jc3d-win span { display: block; margin-top: 8px; font: 700 clamp(13px, 2.4vw, 20px) Georgia, serif; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,.75); }
    @keyframes jc3d-win-pop { 0% { transform: scale(.3); opacity: 0; } 12% { transform: scale(1.08); opacity: 1; } 22% { transform: scale(1); } 85% { opacity: 1; } 100% { transform: translateY(-12px); opacity: 0; } }
    .jc3d-loading { position: absolute; inset: 0; display: grid; place-items: center; color: #b9b3a3; font: 600 14px system-ui, sans-serif; z-index: 1; text-align: center; padding: 0 16px; }
    .jc3d-loading[hidden] { display: none; }
    .jc3d-labels { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
    .jc3d-task-label { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); }
    .jc3d-task-label-inner { display: block; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;
      background: rgba(255,255,255,.96); color: #1f2937; font: 800 13px system-ui, sans-serif; padding: 5px 10px; border-radius: 999px;
      box-shadow: 0 2px 6px rgba(0,0,0,.35); animation: jc3d-label-pop 2.2s ease-out both; }
    @keyframes jc3d-label-pop {
      0% { opacity: 0; transform: translateY(6px) scale(.85); }
      12% { opacity: 1; transform: translateY(0) scale(1); }
      72% { opacity: 1; transform: translateY(-4px) scale(1); }
      100% { opacity: 0; transform: translateY(-26px) scale(.96); }
    }
    .jc3d-task-label-foe .jc3d-task-label-inner { background: #15803d; color: #fff; text-align: center; animation-duration: 2.8s; }
    .jc3d-task-label-done .jc3d-task-label-inner { background: linear-gradient(180deg, #f59e0b, #ea580c); color: #fff; text-align: center; animation-duration: 2.8s; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
    .jc3d-task-label-done .jc3d-task-label-inner small { color: #fff7d6; }
    .jc3d-task-label-inner small { display: block; font: 900 10px system-ui, sans-serif; letter-spacing: .14em; color: #fde68a; }
    @media (prefers-reduced-motion: reduce) { .jc3d-win div, .jc3d-task-label-inner { animation: none; } }
  `;
  document.head.appendChild(style);
}

export function createCastle3D(container) {
  injectStyles();
  const root = document.createElement('div');
  root.className = 'jc3d-root';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Castle Journey in 3D');
  const loadingEl = document.createElement('div');
  loadingEl.className = 'jc3d-loading';
  loadingEl.textContent = 'Raising the drawbridge…';
  const camBar = document.createElement('div');
  camBar.className = 'jc3d-cam';
  camBar.setAttribute('role', 'group');
  camBar.setAttribute('aria-label', 'Camera');
  const camBtns = {};
  [['follow', 'Follow cam'], ['overview', 'Overview']].forEach(([mode, text]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.setAttribute('aria-pressed', String(mode === 'follow'));
    b.addEventListener('click', e => {
      e.stopPropagation();
      cam.mode = mode;
      Object.entries(camBtns).forEach(([m, btn]) => btn.setAttribute('aria-pressed', String(m === mode)));
    });
    camBtns[mode] = b; camBar.appendChild(b);
  });
  const winEl = document.createElement('div');
  winEl.className = 'jc3d-win'; winEl.hidden = true;
  winEl.innerHTML = '<div><strong>Quest Complete</strong><span>The dragon is beaten and the princess is free</span></div>';
  // Completed tasks' own titles float up here — a DOM overlay rather than
  // in-scene geometry, tracked onto each banner's screen position every
  // frame since the camera itself moves (see updateTaskLabels).
  const labelLayer = document.createElement('div');
  labelLayer.className = 'jc3d-labels';
  root.append(loadingEl, camBar, labelLayer, winEl);
  container.appendChild(root);
  if (container.parentElement) container.parentElement.style.background = '#0d1326';

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const timers = [];
  function notify() { updateLabel(); }

  const KNIGHT_H = 1.75, PRINCESS_H = 1.6, RUN_SPEED = 4.0;

  // Throws if WebGL can't start; journeyGame.js catches that and falls back to 2D.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.appendChild(renderer.domElement);

  // ── The road: village (south) → castle gate (north) ──────────────────
  const curve = new THREE.CatmullRomCurve3(
    [[-10, 37], [-3, 31], [6, 25], [4, 17], [-4, 12], [-0.5, 6], [0.4, 1.5], [0, -3], [-6, -9], [-3, -16], [6, -20], [4, -26], [0, -30], [0, -33]]
      .map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false, 'catmullrom', 0.5,
  );
  const curveLen = curve.getLength();
  const PATH_SAMPLES = Array.from({ length: 361 }, (_, i) => curve.getPointAt(i / 360));
  function distToPath(x, z) {
    let d = Infinity;
    for (const p of PATH_SAMPLES) { const dx = p.x - x, dz = p.z - z, q = dx * dx + dz * dz; if (q < d) d = q; }
    return Math.sqrt(d);
  }

  const checkpointFrac = (i, n) => (n > 1 ? 0.06 + (i / (n - 1)) * 0.86 : 0.5);
  const wallFrac = i => checkpointFrac(i, tasks.length) - 0.03;
  const frogStopFrac = i => wallFrac(i) - 1.55 / curveLen;
  function progressToFrac(doneCount, n) {
    if (!n || doneCount <= 0) return 0;
    return checkpointFrac(Math.min(doneCount, n) - 1, n);
  }

  // ── Terrain shape: rolling hills away from the road, a river, a moat ──
  const riverZ = x => 1.8 + 2.2 * Math.sin(x * 0.07) + 0.8 * Math.sin(x * 0.19 + 1);
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const MOAT_Z = -35.6, MOAT_X = 20.5, MOAT_BACK = -62;
  function moatDist(x, z) {
    const front = Math.abs(x) <= MOAT_X ? Math.abs(z - MOAT_Z) : Math.hypot(Math.abs(x) - MOAT_X, z - MOAT_Z);
    const side = z <= MOAT_Z && z >= MOAT_BACK ? Math.abs(Math.abs(x) - MOAT_X) : Infinity;
    return Math.min(front, side);
  }
  const inCastle = (x, z) => Math.abs(x) < 25 && z < -31 && z > -66;
  function groundHeight(x, z, dp = distToPath(x, z)) {
    const rd = Math.abs(z - riverZ(x)), md = moatDist(x, z);
    let h = (vnoise(x * 0.035, z * 0.035) * 2.6 + vnoise(x * 0.09 + 7, z * 0.09) * 0.7 - 0.6) * smooth(6, 16, dp) * smooth(4, 12, rd);
    if (inCastle(x, z)) h *= 0;
    h *= smooth(2, 6, md);
    h -= 0.75 * (1 - smooth(2.3, 4.2, rd));
    h -= 0.8 * (1 - smooth(1.3, 2.7, md));
    return h;
  }
  // The road rises over a stone bridge where it crosses the river.
  const BRIDGE_REACH = 4.8;
  function roadY(p) {
    const d = Math.abs(p.z - riverZ(p.x));
    return d < BRIDGE_REACH ? 0.6 * Math.cos((d / BRIDGE_REACH) * Math.PI / 2) ** 2 : 0;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 700);
  camera.position.set(-14, 6, 46);

  function canvasTexture(w, h, draw, opts = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...extra });

  // ── Sky: a gradient dome whose light moves from afternoon to sunset as the quest progresses ─
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir; varying vec3 vWorld;
      void main(){
        vec3 d = normalize(vWorld - cameraPosition);
        float h = d.y;
        vec3 col = mix(horizon, top, pow(smoothstep(-0.02, 0.55, h), 0.75));
        col = mix(col, horizon * 0.8, smoothstep(0.0, -0.2, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 14.0) * 0.45);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog('#cfe0ee', 80, 300);

  const hemi = new THREE.HemisphereLight('#cfe3ff', '#4b6a2c', 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d8', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 5, far: 160 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // Afternoon → golden hour → sunset, keyed on how much of the quest is done.
  const SKY_KEYS = [
    { at: 0, top: '#3f86d4', horizon: '#cfe6f5', sun: '#fff3dc', light: '#fff1d8', li: 2.6, hemiSky: '#cfe3ff', hemiGround: '#4b6a2c', hi: 1.0, el: 0.78, az: -0.55 },
    { at: 0.6, top: '#3b6db8', horizon: '#f5d7a6', sun: '#ffe2a8', light: '#ffd9a0', li: 2.4, hemiSky: '#d7dcff', hemiGround: '#55602a', hi: 0.9, el: 0.45, az: -0.95 },
    { at: 1, top: '#27377a', horizon: '#f39a6a', sun: '#ffb27a', light: '#ffa874', li: 2.1, hemiSky: '#a9a8e6', hemiGround: '#4a3d2a', hi: 0.8, el: 0.22, az: -1.25 },
  ];
  const env = { cur: 0, target: 0 };
  const cA = new THREE.Color(), cB = new THREE.Color();
  const sunDir = new THREE.Vector3();
  function applySky(f) {
    let a = SKY_KEYS[0], b = SKY_KEYS[1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++) if (f >= SKY_KEYS[i].at) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; }
    const t = THREE.MathUtils.clamp((f - a.at) / (b.at - a.at), 0, 1);
    const mix = (k, out) => out.copy(cA.set(a[k])).lerp(cB.set(b[k]), t);
    mix('top', skyMat.uniforms.top.value); mix('horizon', skyMat.uniforms.horizon.value); mix('sun', skyMat.uniforms.sunColor.value);
    mix('light', sun.color); mix('hemiSky', hemi.color); mix('hemiGround', hemi.groundColor);
    scene.fog.color.copy(skyMat.uniforms.horizon.value);
    sun.intensity = a.li + (b.li - a.li) * t; hemi.intensity = a.hi + (b.hi - a.hi) * t;
    const el = a.el + (b.el - a.el) * t, az = a.az + (b.az - a.az) * t;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    skyMat.uniforms.sunDir.value.copy(sunDir);
  }
  applySky(0);

  // ── Ground: one big vertex-coloured terrain mesh ──────────────────────
  const grassTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 200 + Math.floor(rnd() * 55);
      g.fillStyle = `rgba(${v - 30},${v},${v - 50},0.5)`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 2 + rnd() * 4);
    }
  }, { repeat: true });
  grassTex.repeat.set(70, 70);
  {
    const SIZE = 320, SEG = 140;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
    const g1 = new THREE.Color('#5c9a3c'), g2 = new THREE.Color('#86b44c'), sand = new THREE.Color('#b8a46c'), mud = new THREE.Color('#5d6a45'), dirt = new THREE.Color('#9a8a5c'), hill = new THREE.Color('#9fbf5a');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), dp = distToPath(x, z);
      const h = groundHeight(x, z, dp);
      pos.setY(i, h);
      c.copy(g1).lerp(g2, vnoise(x * 0.06, z * 0.06));
      if (h > 0.8) c.lerp(hill, Math.min(1, (h - 0.8) / 2));
      if (dp < 2.4) c.lerp(dirt, 0.6);
      const rd = Math.min(Math.abs(z - riverZ(x)), moatDist(x, z) + 1.5);
      if (rd < 4.6) c.lerp(sand, smooth(4.6, 3.4, rd) * 0.8);
      if (h < -0.3) c.lerp(mud, 0.7);
      if (inCastle(x, z) && z < -39 && Math.abs(x) < 16) c.set('#9d9479');
      cols.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // ── Water: river + moat, with a slow ripple scroll ────────────────────
  const waterTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#2f6f99'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(200,235,255,${0.08 + rnd() * 0.22})`; g.lineWidth = 1 + rnd() * 2;
      const x = rnd() * w, y = rnd() * h, l = 8 + rnd() * 26;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 3, x + l, y); g.stroke();
    }
  }, { repeat: true });
  waterTex.repeat.set(30, 30);
  const waterMat = new THREE.MeshStandardMaterial({ map: waterTex, color: '#9fd3ef', roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.9 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = -0.32;
  scene.add(water);

  // ── Road ribbons (cobbles over a dirt verge) ──────────────────────────
  function ribbonGeometry(width, samples, tile, lift = 0, u0 = 0, u1 = 1) {
    const pos = [], uv = [], nrm = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const u = u0 + (u1 - u0) * (i / samples), p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const side = new THREE.Vector3(-t.z, 0, t.x).normalize(), y = roadY(p) + lift;
      pos.push(p.x + side.x * width / 2, y, p.z + side.z * width / 2, p.x - side.x * width / 2, y, p.z - side.z * width / 2);
      nrm.push(0, 1, 0, 0, 1, 0);
      const s = (u * curveLen) / tile;
      uv.push(s, 0, s, 1);
      if (i < samples) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }
  const cobbleTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#5b5446'; g.fillRect(0, 0, w, h);
    const rows = 10, cols = 9;
    for (let r = 0; r < rows; r++) for (let k = -1; k < cols; k++) {
      const cw = w / cols, ch = h / rows, x = k * cw + (r % 2 ? cw / 2 : 0) + cw / 2 + (rnd() - 0.5) * 4, y = r * ch + ch / 2 + (rnd() - 0.5) * 3;
      const v = 104 + Math.floor(rnd() * 46);
      g.fillStyle = `rgb(${v + 10},${v + 2},${v - 14})`;
      g.beginPath(); g.ellipse(x, y, cw * (0.38 + rnd() * 0.08), ch * (0.34 + rnd() * 0.08), rnd() * 0.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.beginPath(); g.ellipse(x - cw * 0.1, y - ch * 0.1, cw * 0.22, ch * 0.16, 0, 0, Math.PI * 2); g.fill();
    }
  }, { repeat: true });
  const vergeTex = canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(140,120,80,0)'); grd.addColorStop(0.18, 'rgba(140,120,80,0.85)');
    grd.addColorStop(0.82, 'rgba(140,120,80,0.85)'); grd.addColorStop(1, 'rgba(140,120,80,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { repeat: true });
  const verge = new THREE.Mesh(ribbonGeometry(4.2, 600, 4, 0.02), new THREE.MeshStandardMaterial({ map: vergeTex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  verge.receiveShadow = true; scene.add(verge);
  const road = new THREE.Mesh(ribbonGeometry(2.7, 600, 2.2, 0.04), new THREE.MeshStandardMaterial({ map: cobbleTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4 }));
  road.receiveShadow = true; scene.add(road);

  // ── Stone ────────────────────────────────────────────────────────────
  const stoneTexBase = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#6f6a62'; g.fillRect(0, 0, w, h);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const ch = h / rows, off = r % 2 ? 0.5 : 0;
      for (let k = -1; k < 5; k++) {
        const cw = w / 4, x = (k + off) * cw, v = 150 + Math.floor(rnd() * 50);
        g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
        g.fillRect(x + 2, r * ch + 2, cw - 4, ch - 4);
        g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + 2, r * ch + ch - 7, cw - 4, 5);
      }
    }
  }, { repeat: true });
  const stoneMats = new Map();
  function stoneMat(rx, ry, tint = '#ffffff') {
    const key = `${rx.toFixed(1)}:${ry.toFixed(1)}:${tint}`;
    if (!stoneMats.has(key)) {
      const t = stoneTexBase.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
      stoneMats.set(key, new THREE.MeshStandardMaterial({ map: t, color: tint, roughness: 0.92 }));
    }
    return stoneMats.get(key);
  }
  function stoneBox(w, h, d, x, y, z, tint) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat(Math.max(1, Math.max(w, d) / 3), Math.max(1, h / 3), tint));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    return m;
  }

  // River bridge: parapets and a stone skirt following the road where it rises.
  {
    const pos = [], idx = [];
    let u0 = 1, u1 = 0;
    for (let i = 0; i <= 600; i++) { const u = i / 600, p = curve.getPointAt(u); if (Math.abs(p.z - riverZ(p.x)) < BRIDGE_REACH) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); } }
    const N = 40;
    [-1, 1].forEach(s => {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const u = u0 + (u1 - u0) * (i / N), p = curve.getPointAt(u), t = curve.getTangentAt(u);
        const side = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(s * 1.5), y = roadY(p);
        pos.push(p.x + side.x, -0.9, p.z + side.z, p.x + side.x, y + 0.55, p.z + side.z);
        if (i < N) { const k = base + i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uv = []; for (let i = 0; i < pos.length / 3; i++) uv.push((Math.floor(i / 2) % (N + 1)) / 3, (i % 2) * 0.5);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: stoneTexBase, color: '#d8d2c4', roughness: 0.9, side: THREE.DoubleSide }));
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
    // cap stones along the parapet tops
    const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.16, 0.5), flat('#b9b2a2'), (N + 1) * 2);
    let n = 0; const M = new THREE.Matrix4(), q = new THREE.Quaternion();
    [-1, 1].forEach(s => { for (let i = 0; i <= N; i++) {
      const u = u0 + (u1 - u0) * (i / N), p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const side = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(s * 1.5);
      q.setFromAxisAngle(V(0, 1, 0), Math.atan2(t.x, t.z));
      cap.setMatrixAt(n++, M.compose(V(p.x + side.x, roadY(p) + 0.6, p.z + side.z), q, V(1, 1, 1)));
    } });
    cap.castShadow = true; scene.add(cap);
  }

  // ── Particles: one additive system (fire, sparks, fireworks) and one soft system (smoke) ─
  const glowTex = canvasTexture(64, 64, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
  const puffTex = canvasTexture(64, 64, (g, w) => {
    for (let i = 0; i < 7; i++) {
      const x = w / 2 + (rnd() - 0.5) * 18, y = w / 2 + (rnd() - 0.5) * 18, r = 14 + rnd() * 10;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
    }
  });
  const particleUniformScale = { value: 400 };
  class Particles {
    constructor(max, additive, map) {
      this.max = max; this.next = 0;
      this.items = Array.from({ length: max }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 1, s1: 1, c0: new THREE.Color(), c1: new THREE.Color(), c2: null, a: 1, g: 0, drag: 0 }));
      const geo = new THREE.BufferGeometry();
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { map: { value: map }, uScale: particleUniformScale },
        vertexShader: `attribute float size; attribute vec4 color; varying vec4 vColor; uniform float uScale;
          void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D map; varying vec4 vColor;
          void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
            #include <colorspace_fragment>
          }`,
      });
      this.points = new THREE.Points(geo, mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = additive ? 3 : 2;
      scene.add(this.points);
    }
    emit(o) {
      const it = this.items[this.next]; this.next = (this.next + 1) % this.max;
      it.max = it.life = o.life; it.p.copy(o.pos); it.v.copy(o.vel || V(0, 0, 0));
      it.s0 = o.size[0]; it.s1 = o.size[1]; it.c0.set(o.color[0]); it.c1.set(o.color[1] ?? o.color[0]);
      it.c2 = o.color[2] ? (it.c2 || new THREE.Color()).set(o.color[2]) : null;
      it.a = o.alpha ?? 1; it.g = o.gravity ?? 0; it.drag = o.drag ?? 0;
    }
    update(dt) {
      for (let i = 0; i < this.max; i++) {
        const it = this.items[i];
        if (it.life <= 0) { this.size[i] = 0; continue; }
        it.life -= dt;
        it.v.y -= it.g * dt; it.v.multiplyScalar(Math.max(0, 1 - it.drag * dt));
        it.p.addScaledVector(it.v, dt);
        const t = 1 - Math.max(0, it.life) / it.max;
        this.pos[i * 3] = it.p.x; this.pos[i * 3 + 1] = it.p.y; this.pos[i * 3 + 2] = it.p.z;
        this.size[i] = it.life > 0 ? it.s0 + (it.s1 - it.s0) * t : 0;
        if (it.c2) { if (t < 0.5) cA.copy(it.c0).lerp(it.c1, t * 2); else cA.copy(it.c1).lerp(it.c2, (t - 0.5) * 2); }
        else cA.copy(it.c0).lerp(it.c1, t);
        const alpha = it.a * Math.min(1, t * 8) * Math.pow(1 - t, 1.3);
        this.col[i * 4] = cA.r; this.col[i * 4 + 1] = cA.g; this.col[i * 4 + 2] = cA.b; this.col[i * 4 + 3] = alpha;
      }
      const a = this.points.geometry.attributes;
      a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = true;
    }
  }
  const sparks = new Particles(3200, true, glowTex);
  const smoke = new Particles(900, false, puffTex);
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);
  function flame(at, scale = 1) {
    sparks.emit({ pos: at.clone().add(rand3(0.18 * scale)), vel: V((rnd() - 0.5) * 0.3, 1.1 + rnd() * 0.8, (rnd() - 0.5) * 0.3).multiplyScalar(scale), life: 0.45 + rnd() * 0.3, size: [0.42 * scale, 0.08 * scale], color: ['#fff2b0', '#ff9a2e', '#a3201a'], alpha: 0.9, gravity: -0.6 });
  }
  function poof(at, n = 26, tint = '#ece6da') {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) smoke.emit({ pos: at.clone().add(rand3(0.8)), vel: rand3(3).add(V(0, 1.2, 0)), life: 1 + rnd() * 0.8, size: [0.9, 2.6 + rnd()], color: [tint, '#9c958a'], alpha: 0.85, drag: 2.2 });
  }
  function sparkle(at, n = 40, colors = ['#ffe28a', '#ffffff'], power = 4) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.9 + 0.1, rnd() - 0.5).normalize().multiplyScalar(power * (0.4 + rnd() * 0.8));
      sparks.emit({ pos: at.clone(), vel: d, life: 0.8 + rnd() * 0.7, size: [0.3, 0.05], color: [colors[i % colors.length], '#ffb347'], gravity: 3.2, drag: 1.4 });
    }
  }

  // ── Confetti petals (finale) ──────────────────────────────────────────
  const CONFETTI_MAX = 700;
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.14), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONFETTI_MAX);
  const bits = [];
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < CONFETTI_MAX; i++) {
    bits.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() });
    confetti.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    confetti.setColorAt(i, tmpC.set('#ffffff'));
  }
  confetti.frustumCulled = false;
  scene.add(confetti);
  let confettiNext = 0;
  const PETALS = ['#ffd1e1', '#ffffff', '#ffe28a', '#ff8fb1', '#e7b443'];
  function burst(at, count = 80, power = 6) {
    if (reduceMotion) return;
    for (let n = 0; n < count; n++) {
      const b = bits[confettiNext]; const i = confettiNext;
      confettiNext = (confettiNext + 1) % CONFETTI_MAX;
      b.life = 2.8 + rnd();
      b.p.copy(at);
      const a = rnd() * Math.PI * 2, up = 0.55 + rnd() * 0.6;
      b.v.set(Math.cos(a) * (1 - up) * power, up * power, Math.sin(a) * (1 - up) * power);
      b.r.set(rnd() * 6, rnd() * 6, rnd() * 6);
      b.w.set((rnd() - 0.5) * 12, (rnd() - 0.5) * 12, (rnd() - 0.5) * 12);
      confetti.setColorAt(i, tmpC.set(PETALS[n % PETALS.length]));
    }
    confetti.instanceColor.needsUpdate = true;
  }
  function updateConfetti(dt) {
    for (let i = 0; i < CONFETTI_MAX; i++) {
      const b = bits[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.v.y -= 5 * dt; b.v.multiplyScalar(1 - 1.8 * dt);
      b.p.addScaledVector(b.v, dt);
      if (b.p.y < 0.05) { b.p.y = 0.05; b.v.set(0, 0, 0); b.w.multiplyScalar(0.9); }
      b.r.x += b.w.x * dt; b.r.y += b.w.y * dt; b.r.z += b.w.z * dt;
      tmpS.setScalar(b.life > 0 ? Math.min(1, b.life * 2) : 0);
      confetti.setMatrixAt(i, tmpM.compose(b.p, tmpQ.setFromEuler(b.r), tmpS));
    }
    confetti.instanceMatrix.needsUpdate = true;
  }

  // ── Waving cloth (banners on checkpoints, pennants on the towers) ─────
  const cloths = [];
  function pennant(parent, { len = 0.7, half = 0.22, y = 1.4, mat, phase = rnd() * 6, cols = 10, swallow = false }) {
    const pos = new Float32Array((cols + 1) * 2 * 3), idx = [];
    for (let c = 0; c < cols; c++) { const a = c * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; parent.add(mesh);
    const cl = { mesh, len, half, y, phase, cols, swallow };
    cloths.push(cl);
    return cl;
  }
  function waveCloths(time) {
    cloths.forEach(cl => {
      if (!cl.mesh.parent || !cl.mesh.visible) return;
      const pos = cl.mesh.geometry.attributes.position;
      for (let c = 0; c <= cl.cols; c++) {
        const f = c / cl.cols, x = f * cl.len;
        const half = cl.swallow ? cl.half * (f > 0.75 ? 1 - (f - 0.75) * 1.6 : 1) : cl.half * (1 - f);
        const z = Math.sin(time * 6 + cl.phase - x * 7) * 0.08 * f * (cl.len / 0.7);
        pos.setXYZ(c * 2, x, cl.y + half, z); pos.setXYZ(c * 2 + 1, x, cl.y - half, z);
      }
      pos.needsUpdate = true; cl.mesh.geometry.computeVertexNormals(); cl.mesh.geometry.computeBoundingSphere();
    });
  }

  // ── Scenery: forest, rocks, grass, flowers, hills, mountains, clouds ─
  const castleMeadow = (x, z) => Math.abs(x) < 30 && z < -17 && z > -70;
  function scatter(count, minDist, accept) {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 40; tries++) {
      const x = (rnd() - 0.5) * 230, z = (rnd() - 0.5) * 230 - 6;
      const dp = distToPath(x, z);
      if (dp < minDist) continue;
      if (Math.abs(z - riverZ(x)) < 4.6 || moatDist(x, z) < 3.5 || (Math.abs(x) < 24 && z < -30 && z > -66)) continue;
      if (!accept(x, z, dp)) continue;
      out.push({ x, z, y: groundHeight(x, z, dp), dp });
    }
    return out;
  }
  const village = [[-17, 42, 0.3], [-5, 46, -0.1], [7, 41, 0.5], [14, 34, -0.6], [-19, 30, 0.9], [16, 46, 0.2]];
  const nearVillage = (x, z) => village.some(([vx, vz]) => Math.hypot(vx - x, vz - z) < 5.5);
  {
    // Forest: thick in the middle of the journey, thinner by the village and the castle.
    const trees = scatter(520, 6.2, (x, z, dp) => !nearVillage(x, z) && !castleMeadow(x, z) && rnd() < (Math.abs(z) < 26 ? 0.95 : 0.45) * (dp < 9 ? 0.7 : 1));
    const pines = trees.filter((_, i) => i % 3 !== 0), rounds = trees.filter((_, i) => i % 3 === 0);
    const pineGeo = mergeGeometries([
      new THREE.ConeGeometry(1.6, 2.6, 7).translate(0, 2.2, 0),
      new THREE.ConeGeometry(1.25, 2.2, 7).translate(0, 3.4, 0),
      new THREE.ConeGeometry(0.85, 1.8, 7).translate(0, 4.5, 0),
    ]);
    const roundGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(1.5, 0).translate(0, 3.0, 0),
      new THREE.IcosahedronGeometry(1.05, 0).translate(0.7, 3.7, 0.3),
      new THREE.IcosahedronGeometry(0.95, 0).translate(-0.6, 3.5, -0.4),
    ]);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 2.2, 6).translate(0, 1.1, 0);
    const place = (list, geo, colors) => {
      const m = new THREE.InstancedMesh(geo, flat('#ffffff'), list.length);
      list.forEach((t, i) => {
        const s = 0.75 + rnd() * 0.75;
        m.setMatrixAt(i, tmpM.compose(V(t.x, t.y - 0.1, t.z), tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * 6), V(s, s * (0.85 + rnd() * 0.35), s)));
        m.setColorAt(i, tmpC.set(colors[Math.floor(rnd() * colors.length)]).multiplyScalar(0.85 + rnd() * 0.3));
        t.s = s;
      });
      m.castShadow = true; m.receiveShadow = true; scene.add(m);
    };
    place(pines, pineGeo, ['#2f6b3a', '#3a7a3f', '#2b5e3a', '#3f7f4a']);
    place(rounds, roundGeo, ['#6aa548', '#5c9a3e', '#7fb14c', '#8fbf55']);
    const trunks = new THREE.InstancedMesh(trunkGeo, flat('#6b4a2e'), trees.length);
    trees.forEach((t, i) => trunks.setMatrixAt(i, tmpM.compose(V(t.x, t.y - 0.1, t.z), tmpQ.identity(), V(t.s, t.s, t.s))));
    trunks.castShadow = true; scene.add(trunks);

    const rocks = scatter(90, 3.2, () => true);
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.6, 0), flat('#ffffff'), rocks.length);
    rocks.forEach((r, i) => {
      const s = 0.4 + rnd() * 1.1;
      rockMesh.setMatrixAt(i, tmpM.compose(V(r.x, r.y + 0.1, r.z), tmpQ.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), V(s * 1.3, s * 0.8, s)));
      rockMesh.setColorAt(i, tmpC.set(rnd() < 0.5 ? '#8d8a82' : '#a29d92'));
    });
    rockMesh.castShadow = true; rockMesh.receiveShadow = true; scene.add(rockMesh);

    const tufts = scatter(1600, 1.9, (x, z, dp) => dp < 20 || rnd() < 0.3);
    const tuftGeo = mergeGeometries([
      new THREE.ConeGeometry(0.06, 0.5, 3).translate(0, 0.25, 0),
      new THREE.ConeGeometry(0.05, 0.38, 3).rotateZ(0.35).translate(0.08, 0.18, 0),
      new THREE.ConeGeometry(0.05, 0.42, 3).rotateX(-0.3).translate(-0.04, 0.2, 0.06),
    ]);
    const tuftMesh = new THREE.InstancedMesh(tuftGeo, flat('#ffffff'), tufts.length);
    tufts.forEach((t, i) => {
      tuftMesh.setMatrixAt(i, tmpM.compose(V(t.x, t.y, t.z), tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * 6), V(1, 0.7 + rnd() * 0.8, 1)));
      tuftMesh.setColorAt(i, tmpC.set(rnd() < 0.5 ? '#5f9c3b' : '#7cb04a'));
    });
    scene.add(tuftMesh);
    const flowers = scatter(520, 1.8, (x, z, dp) => dp < 12);
    const flowerMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.08, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), flowers.length);
    const FLOWER = ['#ffffff', '#ffe066', '#ff8fb1', '#b59bff', '#ff7a59'];
    flowers.forEach((f, i) => {
      flowerMesh.setMatrixAt(i, tmpM.makeTranslation(f.x, f.y + 0.22, f.z));
      flowerMesh.setColorAt(i, tmpC.set(FLOWER[i % FLOWER.length]));
    });
    scene.add(flowerMesh);

    // Distant mountains with snow caps, softened by the fog.
    const mtn = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), flat('#7b8798'), 26);
    const cap = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), flat('#f3f6fb'), 26);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rnd() * 0.2, r = 190 + rnd() * 60;
      const h = 40 + rnd() * 50, w = 38 + rnd() * 30, x = Math.sin(a) * r, z = Math.cos(a) * r - 20;
      mtn.setMatrixAt(i, tmpM.compose(V(x, h / 2 - 2, z), tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * 6), V(w, h, w)));
      cap.setMatrixAt(i, tmpM.compose(V(x, h - 2 - h * 0.14, z), tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * 6), V(w * 0.29, h * 0.29, w * 0.29)));
    }
    scene.add(mtn, cap);
  }
  // Clouds: soft billboard puffs drifting slowly.
  const clouds = [];
  {
    const cloudMat = new THREE.SpriteMaterial({ map: puffTex, color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      for (let k = 0; k < 5; k++) { const s = new THREE.Sprite(cloudMat); s.position.set((k - 2) * 7 + rnd() * 3, rnd() * 3, rnd() * 3); s.scale.setScalar(16 + rnd() * 10); g.add(s); }
      g.position.set((rnd() - 0.5) * 360, 55 + rnd() * 30, -60 - rnd() * 200);
      scene.add(g); clouds.push(g);
    }
  }

  // ── The village (start of the road) ───────────────────────────────────
  const chimneys = [];
  function cottage(x, z, rot) {
    const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z); g.rotation.y = rot; scene.add(g);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3.2), flat('#eadcbc'));
    walls.position.y = 1.3; walls.castShadow = walls.receiveShadow = true; g.add(walls);
    // timber beams
    const beam = flat('#5a3b24');
    [[-2.01, 0], [2.01, 0]].forEach(([bx]) => [-1.2, 0, 1.2].forEach(bz => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.16), beam); b.position.set(bx, 1.3, bz); g.add(b); }));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.2, 4), flat(rnd() < 0.5 ? '#a1432f' : '#c49a4a'));
    roof.position.y = 3.7; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.78); roof.castShadow = true; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.1), flat('#4a2f1d')); door.position.set(0, 0.75, 1.62); g.add(door);
    const winMat = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb347', emissiveIntensity: 0.9 });
    [-1.2, 1.2].forEach(wx => { const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.08), winMat); w.position.set(wx, 1.55, 1.62); g.add(w); });
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), stoneMat(1, 1)); ch.position.set(1.1, 4.0, -0.5); ch.castShadow = true; g.add(ch);
    g.updateMatrixWorld(true);
    chimneys.push(ch.localToWorld(V(0, 0.8, 0)));
  }
  village.forEach(([x, z, r]) => cottage(x, z, r + Math.atan2(-x, 40 - z) * 0));
  // A wooden sign at the road start.
  {
    const p = curve.getPointAt(0.03), t = curve.getTangentAt(0.03), side = V(-t.z, 0, t.x).normalize();
    const g = new THREE.Group(); g.position.copy(p).addScaledVector(side, -3.6); g.rotation.y = Math.atan2(t.x, t.z) + Math.PI; scene.add(g);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.8, 6), flat('#6b4a2e')); post.position.y = 0.9; post.castShadow = true; g.add(post);
    const signTex = canvasTexture(256, 96, (c, w, h) => {
      c.fillStyle = '#8a5a34'; c.fillRect(0, 0, w, h); c.strokeStyle = '#5a3b24'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
      c.fillStyle = '#fff3d6'; c.font = '700 34px Cinzel, Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('CASTLE →', w / 2, h / 2 + 2);
    });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.48, 0.06), [flat('#8a5a34'), flat('#8a5a34'), flat('#8a5a34'), flat('#8a5a34'), new THREE.MeshStandardMaterial({ map: signTex }), new THREE.MeshStandardMaterial({ map: signTex })]);
    board.position.y = 1.5; board.castShadow = true; g.add(board);
  }

  // ── The castle ───────────────────────────────────────────────────────
  const CASTLE_FRONT = -38, GATE_HALF = 1.8, GATE_H = 4.0, WALL_H = 6.5, WALL_T = 1.8;
  const torches = [];
  const crimsonMat = new THREE.MeshStandardMaterial({ color: '#b3202c', side: THREE.DoubleSide, roughness: 0.7 });
  const blueMat = new THREE.MeshStandardMaterial({ color: '#2f4f9a', side: THREE.DoubleSide, roughness: 0.7 });
  let portcullis = null;
  {
    const fz = CASTLE_FRONT - WALL_T / 2;
    // front wall in three pieces, leaving the gate opening
    const sideLen = 16 - GATE_HALF;
    stoneBox(sideLen, WALL_H, WALL_T, -(GATE_HALF + sideLen / 2), WALL_H / 2, fz);
    stoneBox(sideLen, WALL_H, WALL_T, GATE_HALF + sideLen / 2, WALL_H / 2, fz);
    stoneBox(GATE_HALF * 2, WALL_H - GATE_H, WALL_T, 0, GATE_H + (WALL_H - GATE_H) / 2, fz);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(GATE_HALF + 0.15, 0.28, 6, 16, Math.PI), stoneMat(1, 1, '#cfc8b8'));
    arch.position.set(0, GATE_H - GATE_HALF * 0.35, CASTLE_FRONT + 0.05); arch.scale.y = 0.55; scene.add(arch);
    // side and back walls
    stoneBox(WALL_T, WALL_H, 20, -16, WALL_H / 2, -48);
    stoneBox(WALL_T, WALL_H, 20, 16, WALL_H / 2, -48);
    stoneBox(32, WALL_H, WALL_T, 0, WALL_H / 2, -58);
    // crenellations along the wall tops
    const merlonSpots = [];
    for (let x = -15.5; x <= 15.5; x += 1.3) if (Math.abs(x) > 0.3) merlonSpots.push([x, CASTLE_FRONT - 0.3, 0]);
    for (let z = -39; z >= -57.5; z -= 1.3) { merlonSpots.push([-15.4, z, Math.PI / 2], [15.4, z, Math.PI / 2]); }
    for (let x = -15.5; x <= 15.5; x += 1.3) merlonSpots.push([x, -57.4, 0]);
    const merlons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.8, 0.6), stoneMat(1, 1), merlonSpots.length);
    merlonSpots.forEach(([x, z, r], i) => merlons.setMatrixAt(i, tmpM.compose(V(x, WALL_H + 0.4, z), tmpQ.setFromAxisAngle(V(0, 1, 0), r), V(1, 1, 1))));
    merlons.castShadow = true; scene.add(merlons);

    const tower = (x, z, r, h, roofMat, flagMat) => {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 14), stoneMat(r * 2, h / 3));
      body.position.set(x, h / 2, z); body.castShadow = body.receiveShadow = true; scene.add(body);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.5, 14), stoneMat(r * 2, 0.4, '#d6d0c2'));
      ring.position.set(x, h + 0.25, z); ring.castShadow = true; scene.add(ring);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, r * 1.9, 14), roofMat);
      roof.position.set(x, h + 0.5 + r * 0.95, z); roof.castShadow = true; scene.add(roof);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), flat('#3b3b3b'));
      const top = h + 0.5 + r * 1.9;
      pole.position.set(x, top + 0.7, z); scene.add(pole);
      const fg = new THREE.Group(); fg.position.set(x, top, z); fg.rotation.y = -Math.PI / 2 + 0.4; scene.add(fg);
      pennant(fg, { len: 1.4, half: 0.32, y: 1.2, mat: flagMat });
      // warm windows: narrow slits set into the stone, facing out
      for (let k = 0; k < 3; k++) {
        const a = (k - 1) * 0.75 + (x === 0 ? 0 : -Math.sign(x) * 0.25), wy = h * (0.42 + (k % 2) * 0.2);
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.55, 0.12), windowMat);
        w.position.set(x + Math.sin(a) * r * 1.02, wy, z + Math.cos(a) * r * 1.02); w.rotation.y = a;
        scene.add(w);
      }
    };
    const windowMat = new THREE.MeshStandardMaterial({ color: '#3a2412', emissive: '#ffae42', emissiveIntensity: 0.85 });
    const roofRed = flat('#9b2f2f'), roofBlue = flat('#33518f');
    tower(-16, CASTLE_FRONT - 0.9, 2.8, 11, roofBlue, crimsonMat);
    tower(16, CASTLE_FRONT - 0.9, 2.8, 11, roofBlue, crimsonMat);
    tower(-16, -58, 2.8, 11, roofBlue, crimsonMat);
    tower(16, -58, 2.8, 11, roofBlue, crimsonMat);
    tower(-3.6, CASTLE_FRONT - 0.6, 2.0, 9.5, roofRed, blueMat);
    tower(3.6, CASTLE_FRONT - 0.6, 2.0, 9.5, roofRed, blueMat);
    // the keep, with the princess's tall tower
    stoneBox(13, 12, 10, 0, 6, -49, '#e2dccd');
    const keepMerl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.8, 0.6), stoneMat(1, 1), 36);
    let km = 0;
    for (let x = -6; x <= 6; x += 1.4) { keepMerl.setMatrixAt(km++, tmpM.compose(V(x, 12.4, -44.2), tmpQ.identity(), V(1, 1, 1))); keepMerl.setMatrixAt(km++, tmpM.compose(V(x, 12.4, -53.8), tmpQ.identity(), V(1, 1, 1))); }
    keepMerl.count = km; keepMerl.castShadow = true; scene.add(keepMerl);
    tower(-6.2, -44.3, 1.3, 15, roofRed, crimsonMat);
    tower(6.2, -44.3, 1.3, 15, roofRed, crimsonMat);
    tower(0, -50, 2.4, 21, roofBlue, crimsonMat);
    for (let k = 0; k < 4; k++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.12), windowMat);
      w.position.set(-4.5 + k * 3, 8, -43.97); scene.add(w);
    }
    // long banners either side of the gate
    const bannerTex = canvasTexture(128, 384, (g, w, h) => {
      g.fillStyle = '#b3202c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e7b443'; g.fillRect(0, 0, w, 14); g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
      // a crown
      g.beginPath(); g.moveTo(30, 200); g.lineTo(30, 140); g.lineTo(48, 170); g.lineTo(64, 128); g.lineTo(80, 170); g.lineTo(98, 140); g.lineTo(98, 200); g.closePath(); g.fill();
      g.fillRect(28, 206, 72, 12);
      g.beginPath(); g.moveTo(0, h); g.lineTo(w / 2, h - 40); g.lineTo(w, h); g.fillStyle = '#0d1326'; g.fill();
    });
    [-6.5, 6.5].forEach(x => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 4.4), new THREE.MeshStandardMaterial({ map: bannerTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }));
      b.position.set(x, WALL_H - 2.4, CASTLE_FRONT + 0.06); scene.add(b);
    });
    // a warm glow from the gate torches lights the dragon and the princess
    const gateLight = new THREE.PointLight('#ff9a4a', 26, 16, 1.6);
    gateLight.position.set(0, 3.4, CASTLE_FRONT + 2.2); scene.add(gateLight);
    // wall torches by the gate
    [-2.7, 2.7].forEach(x => {
      const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.4, 6), flat('#2b2b2b'));
      bracket.position.set(x, 3.0, CASTLE_FRONT + 0.25); scene.add(bracket);
      torches.push(V(x, 3.3, CASTLE_FRONT + 0.3));
    });
    // portcullis: an iron grid inside the gate opening that lifts into the wall
    portcullis = new THREE.Group();
    const iron = flat('#2d2d33', { metalness: 0.5, roughness: 0.5 });
    for (let i = 0; i <= 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, GATE_H, 0.1), iron); b.position.set(-GATE_HALF + 0.15 + i * ((GATE_HALF * 2 - 0.3) / 6), GATE_H / 2, 0); b.castShadow = true; portcullis.add(b); }
    for (let j = 1; j <= 4; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(GATE_HALF * 2, 0.08, 0.08), iron); b.position.set(0, j * (GATE_H / 5), 0); portcullis.add(b); }
    portcullis.position.set(0, 0, CASTLE_FRONT - 0.7);
    scene.add(portcullis);
    // moat bridge into the gate
    const deck = stoneBox(3.4, 0.8, 5.6, 0, -0.3, -35.3, '#cfc8b8');
    deck.receiveShadow = true;
    [-1, 1].forEach(s => stoneBox(0.3, 0.5, 5.6, s * 1.55, 0.35, -35.3, '#bfb8a8'));
  }
  const DECK_Y = 0.1;

  // ── Checkpoints: one banner + brazier per task ────────────────────────
  const bannerMats = {
    done: new THREE.MeshStandardMaterial({ color: '#b3202c', side: THREE.DoubleSide, roughness: 0.65 }),
    next: new THREE.MeshStandardMaterial({ color: '#e7b443', side: THREE.DoubleSide, roughness: 0.6, emissive: '#e7b443', emissiveIntensity: 0.3 }),
    pending: new THREE.MeshStandardMaterial({ color: '#9aa3b5', side: THREE.DoubleSide, roughness: 0.7 }),
  };
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 128, (g, w) => {
      g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
      g.fillStyle = fg; g.font = '900 66px Cinzel, Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, w / 2 + 4);
    });
  }
  const flags = [];
  function buildFlags() {
    flags.forEach(f => { scene.remove(f.group); cloths.splice(cloths.indexOf(f.cloth), 1); });
    flags.length = 0;
    tasks.forEach((t, i) => {
      const u = checkpointFrac(i, tasks.length);
      const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const group = new THREE.Group();
      group.position.copy(p).addScaledVector(side, 1.95);
      group.position.y = Math.max(roadY(p), 0);
      group.rotation.y = Math.atan2(tan.x, tan.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.5, 7), flat('#6b4a2e'));
      pole.position.y = 1.25; pole.castShadow = true; group.add(pole);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.14, 0.26, 8, 1, true), flat('#2d2d33', { side: THREE.DoubleSide, metalness: 0.4 }));
      bowl.position.y = 2.6; bowl.castShadow = true; group.add(bowl);
      const coals = new THREE.Mesh(new THREE.CircleGeometry(0.24, 8), new THREE.MeshStandardMaterial({ color: '#2a1a12', emissive: '#ff6a1a', emissiveIntensity: 0 }));
      coals.rotation.x = -Math.PI / 2; coals.position.y = 2.66; group.add(coals);
      const cloth = pennant(group, { len: 0.75, half: 0.26, y: 1.95, mat: bannerMats.pending, swallow: true });
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      badge.position.set(0, 3.25, 0); badge.scale.setScalar(0.55); group.add(badge);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb347', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      glow.position.y = 2.85; glow.scale.setScalar(1.6); glow.visible = false; group.add(glow);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), new THREE.MeshBasicMaterial({ color: '#e7b443', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(new THREE.Vector3().copy(side).multiplyScalar(-1.95).applyAxisAngle(new THREE.Vector3(0, 1, 0), -group.rotation.y)).setY(0.08);
      group.add(ring);
      scene.add(group);
      flags.push({ group, cloth, badge, ring, coals, glow, pop: 0, status: '', lit: false, fireAt: new THREE.Vector3() });
    });
  }
  function refreshFlags() {
    const doneCount = tasks.filter(t => t.done).length;
    tasks.forEach((t, i) => {
      const f = flags[i];
      const status = t.done ? 'done' : i === doneCount ? 'next' : 'pending';
      if (f.status === status) return;
      f.status = status;
      f.cloth.mesh.material = bannerMats[status];
      f.badge.material.map = status === 'done' ? badgeTexture('✓', '#4cc38a', '#06301b') : badgeTexture(String(i + 1), status === 'next' ? '#e7b443' : '#e9e4d6', '#0d1326');
      f.badge.material.needsUpdate = true;
      f.ring.visible = status === 'next';
      if (status !== 'done') setLit(f, false);
    });
  }
  function setLit(f, on) {
    f.lit = on; f.glow.visible = on; f.coals.material.emissiveIntensity = on ? 1.6 : 0;
    f.group.updateMatrixWorld(true);
    f.fireAt.copy(f.group.localToWorld(V(0, 2.75, 0)));
  }

  // ── Characters ───────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  let knight = null, princess = null, clips = [];
  function makeCharacter(gltf, height) {
    const obj = gltf.scene;
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    const box = new THREE.Box3().setFromObject(obj);
    obj.scale.multiplyScalar(height / (box.max.y - box.min.y));
    const holder = new THREE.Group(); holder.add(obj); scene.add(holder);
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {};
    clips.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
    return { holder, obj, mixer, actions, current: null };
  }
  function play(ch, name, { fade = 0.25, timeScale = 1, once = false } = {}) {
    const next = ch.actions[name];
    if (!next) return;
    next.timeScale = timeScale;
    if (ch.current === next && !once) return;
    next.loop = once ? THREE.LoopOnce : THREE.LoopRepeat;
    next.clampWhenFinished = once;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (ch.current && ch.current !== next) ch.current.fadeOut(fade);
    ch.current = next;
  }
  const finished = ch => ch.current && ch.current.loop === THREE.LoopOnce && !ch.current.isRunning();

  // The princess is the mage model with her hat left out: the robe is re-dyed
  // rose pink, the cape gold, and she gets a crown.
  function dressPrincess(obj) {
    let mat = null;
    obj.traverse(o => { if (o.isMesh && !mat) mat = o.material; });
    if (mat && mat.map && mat.map.image) {
      const img = mat.map.image, c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height), px = d.data, hsl = {};
      for (let i = 0; i < px.length; i += 4) {
        tmpC.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
        const h = hsl.h * 360;
        if (h > 220 && h < 290 && hsl.s > 0.1) tmpC.setHSL(335 / 360, Math.min(1, hsl.s * 0.9 + 0.35), Math.min(0.86, hsl.l * 1.15 + 0.32), THREE.SRGBColorSpace);
        else if ((h > 310 || h < 5) && hsl.s > 0.45) tmpC.setHSL(44 / 360, 0.78, Math.min(0.7, hsl.l + 0.18), THREE.SRGBColorSpace);
        else continue;
        const o = { r: 0, g: 0, b: 0 }; tmpC.getRGB(o, THREE.SRGBColorSpace);
        px[i] = o.r * 255; px[i + 1] = o.g * 255; px[i + 2] = o.b * 255;
      }
      g.putImageData(d, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.flipY = mat.map.flipY; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = mat.map.wrapS; t.wrapT = mat.map.wrapT;
      t.magFilter = mat.map.magFilter; t.minFilter = mat.map.minFilter;
      const m2 = mat.clone(); m2.map = t;
      obj.traverse(o => { if (o.isMesh && o.material === mat) o.material = m2; });
    }
    let head = null;
    obj.traverse(o => { if (o.isBone && o.name === 'head') head = o; });
    if (head) {
      obj.updateMatrixWorld(true);
      const crown = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.08, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }));
      crown.add(band);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2, pt = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 4), band.material);
        pt.position.set(Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15); crown.add(pt);
        const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 0), new THREE.MeshStandardMaterial({ color: k % 2 ? '#e0315b' : '#3aa0ff', roughness: 0.2 }));
        gem.position.set(Math.cos(a) * 0.16, 0.0, Math.sin(a) * 0.16); crown.add(gem);
      }
      const box = new THREE.Box3().setFromObject(obj);
      const hp = new THREE.Vector3(); head.getWorldPosition(hp);
      const world = V(hp.x, box.max.y - 0.02, hp.z);
      const ws = new THREE.Vector3(); head.getWorldScale(ws);
      head.add(crown);
      crown.position.copy(head.worldToLocal(world.clone()));
      crown.scale.setScalar(1 / ws.x);
    }
  }

  // ── Giant frogs (blocked tasks) ───────────────────────────────────────
  const frogMats = { skin: flat('#4fae4a'), dark: flat('#2f7d32'), belly: flat('#e3efb0'), white: flat('#ffffff', { roughness: 0.3 }), black: flat('#111111', { roughness: 0.2 }), mouth: flat('#24391a'), sac: flat('#f2f5c8') };
  function buildFrog() {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const S = (r, mat, pos, scale = [1, 1, 1], parent = body) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat); m.position.set(...pos); m.scale.set(...scale); m.castShadow = true; parent.add(m); return m; };
    S(0.75, frogMats.skin, [0, 0.72, 0], [1.15, 0.85, 1.05]);
    S(0.62, frogMats.skin, [0, 0.98, 0.45], [1.15, 0.75, 0.9]);
    S(0.6, frogMats.belly, [0, 0.62, 0.52], [1.05, 0.75, 0.6]);
    const eyes = new THREE.Group(); body.add(eyes);
    [-1, 1].forEach(s => {
      S(0.25, frogMats.skin, [s * 0.42, 1.36, 0.42], [1, 1, 1], eyes);
      S(0.19, frogMats.white, [s * 0.45, 1.42, 0.55], [1, 1, 1], eyes);
      S(0.09, frogMats.black, [s * 0.47, 1.45, 0.7], [1, 1.2, 0.6], eyes);
      S(0.12, frogMats.skin, [s * 0.58, 0.32, 0.62], [0.9, 2.4, 0.9]);
      S(0.2, frogMats.skin, [s * 0.62, 0.05, 0.82], [1.3, 0.3, 1.5]);
      S(0.42, frogMats.skin, [s * 0.85, 0.48, -0.25], [0.7, 0.55, 1.1]);
      S(0.32, frogMats.skin, [s * 0.98, 0.06, 0.25], [1.1, 0.22, 1.6]);
    });
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 20, Math.PI), frogMats.mouth);
    mouth.position.set(0, 1.0, 0.86); mouth.rotation.set(-0.35, 0, Math.PI); mouth.scale.set(1, 0.45, 1); body.add(mouth);
    const sac = S(0.3, frogMats.sac, [0, 0.66, 0.86], [1, 0.8, 0.8]);
    [[0.3, 1.2, -0.3], [-0.35, 1.05, -0.5], [0.05, 1.3, 0.05], [0.55, 0.9, -0.55], [-0.6, 0.95, -0.1]].forEach(p => S(0.12, frogMats.dark, p, [1, 0.35, 1]));
    // a tiny crown: the frog prince of the road
    const crown = new THREE.Group(); crown.position.set(0, 1.42, 0.15); body.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.19, 0.1, 8, 1, true), new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }));
    crown.add(band);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2, pt = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 4), band.material); pt.position.set(Math.cos(a) * 0.19, 0.1, Math.sin(a) * 0.19); crown.add(pt); }
    const mats = [];
    root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
    root.scale.setScalar(1.15);
    return { root, body, eyes, sac, mats, phase: rnd() * 10 };
  }
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6b5e'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  // Black knights: the knight's own model, re-tinted dark and a size up.
  function buildBlackKnight() {
    const obj = SkeletonUtils.clone(knight.obj);
    const mats = [];
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color.set('#3d4250');
      o.material.emissive = new THREE.Color('#000000');
      o.castShadow = true;
      mats.push(o.material);
    });
    const root = new THREE.Group(), body = new THREE.Group();
    body.add(obj); root.add(body);
    root.scale.setScalar(1.15);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }));
    const head = obj.getObjectByName('head');
    if (head) { obj.updateMatrixWorld(true); const hp = new THREE.Vector3(); head.getWorldPosition(hp); const ws = new THREE.Vector3(); head.getWorldScale(ws); head.add(eyes); eyes.position.copy(head.worldToLocal(hp.clone().add(new THREE.Vector3(0, KNIGHT_H * 0.16, KNIGHT_H * 0.2)))); eyes.scale.setScalar(1 / ws.x); }
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {};
    clips.forEach(c => { actions[c.name] = mixer.clipAction(c); });
    const ch = { holder: root, obj, mixer, actions, current: null };
    play(ch, 'Blocking', { fade: 0 }); mixer.update(rnd() * 2);
    return { kind: 'knight', root, body, mats, ch };
  }
  // Every task's obstacles: one mini-boss per obstacle point (frogs and
  // black knights in turn), in rows across the road, a step further toward
  // the banner each row. The knight beats them one by one.
  const walls = [];
  function buildWalls() {
    walls.forEach(w => { w.foes.forEach(f => scene.remove(f.root)); scene.remove(w.lock, w.ring, w.tag); });
    walls.length = 0;
    tasks.forEach((t, i) => {
      if (!t.foeList.length) return;
      const u = wallFrac(i), p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const face = Math.atan2(-tan.x, -tan.z);
      const n = Math.min(t.foeList.length, 5);
      const owners = pickFoes(t.foeList, n);
      const foes = Array.from({ length: n }, (_, k) => {
        const f = k % 2 === 0 ? buildFrog() : buildBlackKnight();
        const row = Math.floor(k / 2), inRow = Math.min(2, n - row * 2), col = k % 2;
        const home = p.clone().addScaledVector(side, (col - (inRow - 1) / 2) * 1.9).addScaledVector(tan, row * 1.7);
        home.y = roadY(home) + 0.04;
        f.root.position.copy(home); f.root.rotation.y = face;
        if (!f.phase) f.phase = rnd() * 10;
        scene.add(f.root);
        // owner: the obstacle this foe stands for; gone once it's ticked off
        const gone = owners[k].resolved;
        if (gone) f.root.visible = false;
        return Object.assign(f, { home, delay: k * 0.9, hit: gone, poofed: gone, swung: gone, owner: owners[k].id, gone, goneT: 0 });
      });
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.copy(p).setY(roadY(p) + 2.8); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
      tag.position.copy(p).setY(roadY(p) + 3.45); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.5, 48), new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(p).setY(roadY(p) + 0.08); scene.add(ring);
      const w = { taskIndex: i, foes, lock, tag, ring, home: p.clone().setY(roadY(p)), cleared: !!t.done, clearing: false, t: t.done ? 99 : 0, open: !t.foes, fade: t.done || !t.foes ? 1 : 0 };
      if (w.cleared) foes.forEach(f => { f.root.visible = false; f.poofed = true; });
      if (w.fade) lock.visible = tag.visible = ring.visible = false;
      walls.push(w);
    });
  }
  const standing = w => w.foes.filter(f => !f.gone);
  const wallPause = w => 0.5 + 0.9 * Math.max(1, standing(w).length);
  function clearWall(w) {
    if (w.cleared) return;
    w.cleared = true; w.t = 0;
    // the knight takes on whoever is still standing, one after another
    standing(w).forEach((f, j) => { f.delay = j * 0.9; });
    if (reduceMotion) { w.t = 99; w.foes.forEach(f => { f.root.visible = false; f.poofed = true; }); }
    notify();
  }
  function restoreWall(w) {
    w.cleared = false; w.clearing = false; w.t = 0;
    w.foes.forEach(f => { if (!f.gone) reviveFoe(f); });
  }
  function reviveFoe(f) {
    Object.assign(f, { hit: false, poofed: false, swung: false, gone: false, engaged: false });
    f.root.visible = true; f.root.position.copy(f.home); f.body.rotation.set(0, 0, 0); f.body.position.set(0, 0, 0);
    f.mats.forEach(m => m.emissive.setRGB(0, 0, 0));
    if (f.ch) play(f.ch, 'Blocking', { fade: 0.2 });
  }
  // Swaps a wall's red tag for one naming only what's still pending.
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  // An obstacle ticked off (or unticked) on its own: the knight runs up
  // and strikes its foes down (see engageResolved), or they come back, and
  // its name pops up.
  function applyResolves(changes) {
    const engaging = [];
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.home.clone() : curve.getPointAt(wallFrac(c.index));
      const label = c.resolved ? () => spawnTaskLabel(at.clone().setY(at.y + 4.1), c.name, 'foe') : null;
      const now = () => { if (label) { timers.push(setTimeout(label, j * 450)); peek.at.copy(at); peek.t = 3.4; } };
      let engagedHere = false;
      if (!w) { now(); return; }
      w.foes.forEach(f => {
        if (f.owner !== c.id) return;
        if (c.resolved && !f.gone) {
          f.gone = true;
          if (!f.poofed) {
            f.goneT = 0; f.hit = false; f.swung = true;
            if (reduceMotion) { f.poofed = true; f.root.visible = false; }
            else if (!w.cleared) { f.goneT = -1e9; engaging.push({ w, f, label: engagedHere ? null : label }); engagedHere = true; }
          }
        } else if (!c.resolved && f.gone) {
          if (w.cleared) f.gone = false; else reviveFoe(f);
        }
      });
      if (!engagedHere) now();
    });
    walls.forEach(w => { w.open = !tasks[w.taskIndex].foes; });
    new Set(changes.map(c => c.index)).forEach(i => { const w = walls.find(x => x.taskIndex === i); if (w) retagWall(w); });
    engageResolved(engaging);
  }
  // The knight runs up to a ticked-off obstacle's foes and takes them on
  // one after another with his sword, then walks back to his banner. near
  // is false when he couldn't get there, and they fall where they stand.
  function engageResolved(list) {
    const byWall = new Map();
    list.forEach(e => { if (!byWall.has(e.w)) byWall.set(e.w, []); byWall.get(e.w).push(e); });
    byWall.forEach((items, w) => engage(w.taskIndex, near => {
      items.forEach((e, k) => { e.f.engaged = near; e.f.swung = !near; e.f.goneT = -k * 0.9; });
      items.filter(e => e.label).forEach((e, k) => timers.push(setTimeout(e.label, k * 450 + (near ? 400 : 0))));
      peek.at.copy(w.home); peek.t = 3.4;
    }, 0.6 + 0.9 * items.length));
  }
  function idleFoe(f, time) {
    const t = time + f.phase;
    if (f.kind === 'knight') { f.body.position.y = 0; return; }
    // frogs breathe, croak, blink and hop impatiently
    f.body.scale.set(1, 1 + Math.sin(t * 2.2) * 0.03, 1);
    const croak = (t % 3.4) / 3.4, sac = croak > 0.78 ? Math.sin(((croak - 0.78) / 0.22) * Math.PI) : 0;
    f.sac.scale.set(1 + sac * 0.9, 0.8 + sac * 0.8, 0.8 + sac * 0.9);
    f.eyes.scale.y = (t % 4.3) > 4.15 ? 0.15 : 1;
    const hop = (t % 7.1) / 7.1;
    f.body.position.y = hop > 0.9 ? Math.sin(((hop - 0.9) / 0.1) * Math.PI) * 0.35 : 0;
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      w.foes.forEach(f => { if (f.ch && f.root.visible) f.ch.mixer.update(dt); });
      // the lock, tag and ring fade out once nothing is left blocking
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.6, 0, 1);
      w.lock.material.opacity = w.tag.material.opacity = 1 - w.fade;
      w.ring.material.opacity = (shut ? 0.35 + 0.25 * Math.sin(time * 4) : 0.55) * (1 - w.fade);
      w.lock.visible = w.tag.visible = w.ring.visible = w.fade < 1;
      if (shut) w.lock.position.y = w.home.y + 2.8 + Math.sin(time * 2.2) * 0.08;
      if (w.cleared && w.t <= 60) w.t += dt;
      w.foes.forEach((f, k) => {
        if (f.poofed) return;
        // a foe whose own obstacle was ticked off is struck on its own clock
        // (by the knight's sword when he went up to it, else the blow lands
        // straight away); the rest fall in turn once the whole task is done
        let lt;
        if (f.gone) { f.goneT += dt; lt = f.engaged ? f.goneT : 0.35 + f.goneT; }
        else if (w.cleared) lt = w.t - f.delay;
        else { idleFoe(f, time); return; }
        if (lt < 0) { idleFoe(f, time); return; }
        // the knight turns to this foe and swings; the blow lands ~0.35s in
        if (!f.swung && knight) {
          f.swung = true;
          const toFoe = Math.atan2(f.home.x - knight.holder.position.x, f.home.z - knight.holder.position.z);
          P.heading = toFoe; knight.holder.rotation.y = toFoe;
          play(knight, k % 2 ? '1H_Melee_Attack_Chop' : '1H_Melee_Attack_Slice_Diagonal', { fade: 0.12, once: true, timeScale: 1.2 });
          if (f.ch) play(f.ch, 'Blocking', { fade: 0.1 });
        }
        if (lt > 0.35 && !f.hit) {
          f.hit = true; if (!f.gone || f.engaged) cam.shake = 0.25;
          sparkle(f.home.clone().setY(f.home.y + 1.2), 30, ['#ffffff', '#ffe28a'], 5);
          if (f.ch) play(f.ch, 'Hit_A', { fade: 0.05, once: true });
        }
        const flash = lt > 0.35 ? Math.max(0, 1 - (lt - 0.35) * 4) : 0;
        f.mats.forEach(m => m.emissive.setRGB(flash, flash, flash));
        if (lt > 0.4 && lt < 0.95) {
          const q = (lt - 0.4) / 0.55;
          if (f.kind === 'knight') { f.body.rotation.x = -q * 1.3; f.body.position.y = Math.sin(q * Math.PI) * 0.6; }
          else { f.body.position.y = Math.sin(q * Math.PI) * 1.6; f.body.rotation.y = q * Math.PI * 3; f.body.rotation.x = -q * 0.6; }
        }
        if (lt >= 0.95) {
          f.poofed = true;
          const at = f.home.clone().setY(f.home.y + 1.2);
          poof(at, 30); sparkle(at, 50, f.kind === 'knight' ? ['#ff6b5e', '#ffe28a', '#ffffff'] : ['#7fe36a', '#ffe28a', '#ffffff'], 5);
          f.root.visible = false;
        }
      });
    });
  }

  // ── The dragon (guards the castle gate; the final task beats it) ──────
  function buildDragon() {
    const M = {
      scale: flat('#a8202a'), dark: flat('#6e1420'), belly: flat('#e0a84a'), horn: flat('#efe3c2'),
      wing: new THREE.MeshStandardMaterial({ color: '#7d1d2a', roughness: 0.8, side: THREE.DoubleSide, flatShading: true }),
      eye: new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb000', emissiveIntensity: 1.4 }), black: flat('#111111'),
    };
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const S = (r, mat, pos, scale = [1, 1, 1], parent = body, seg = [12, 9]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg[0], seg[1]), mat); m.position.set(...pos); m.scale.set(...scale); m.castShadow = true; parent.add(m); return m; };
    const C = (rt, rb, h, mat, pos, rot = [0, 0, 0], parent = body, seg = 7) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(...pos); m.rotation.set(...rot); m.castShadow = true; parent.add(m); return m; };
    const K = (r, h, mat, pos, rot = [0, 0, 0], parent = body) => { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mat); m.position.set(...pos); m.rotation.set(...rot); m.castShadow = true; parent.add(m); return m; };
    const torso = S(1, M.scale, [0, 1.6, 0], [1.25, 1.05, 1.9]);
    S(0.95, M.belly, [0, 1.38, 0.3], [1.0, 0.8, 1.5]);
    S(1, M.scale, [0, 1.95, 1.15], [1.0, 1.0, 1.0]);
    // legs
    [[-1, 0.95, 1], [1, 0.95, 1], [-1, -0.95, 0], [1, -0.95, 0]].forEach(([s, z, front]) => {
      const x = s * (front ? 0.85 : 0.95);
      S(0.5, M.scale, [x, 1.15, z], [0.9, 1.2, 1.1]);
      C(0.22, 0.28, 0.9, M.scale, [x, 0.55, z + 0.1]);
      const foot = S(0.3, M.dark, [x, 0.12, z + 0.32], [1.1, 0.45, 1.4]);
      for (let k = -1; k <= 1; k++) K(0.06, 0.24, M.horn, [x + k * 0.14, 0.08, z + 0.72], [Math.PI / 2, 0, 0]);
      void foot;
    });
    // back spikes
    for (let k = 0; k < 6; k++) K(0.16, 0.5, k % 2 ? M.belly : M.dark, [0, 2.6 - k * 0.04, 1.0 - k * 0.55], [-0.35, 0, 0]);
    // neck chain → head
    const neckPivot = new THREE.Group(); neckPivot.position.set(0, 2.25, 1.55); body.add(neckPivot);
    const neck = []; let parent = neckPivot;
    [0.6, 0.55, 0.5, 0.45].forEach((r, k) => {
      const seg = new THREE.Group(); seg.position.set(0, k === 0 ? 0 : 0.42, k === 0 ? 0 : 0.2); parent.add(seg);
      S(r, M.scale, [0, 0, 0], [1, 1, 1.1], seg);
      S(r * 0.75, M.belly, [0, -0.12, r * 0.45], [0.9, 0.9, 0.7], seg);
      K(0.1, 0.32, M.dark, [0, r * 0.95, -0.1], [-0.5, 0, 0], seg);
      neck.push(seg); parent = seg;
    });
    const head = new THREE.Group(); head.position.set(0, 0.42, 0.28); parent.add(head);
    S(0.55, M.scale, [0, 0, 0], [1, 0.85, 1.15], head);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 1.0, 8), M.scale); snout.rotation.x = Math.PI / 2; snout.scale.set(1, 1, 0.72); snout.position.set(0, -0.04, 0.74); snout.castShadow = true; head.add(snout);
    S(0.22, M.scale, [0, 0.0, 1.2], [1, 0.75, 0.8], head);
    [-1, 1].forEach(s => {
      S(0.05, M.black, [s * 0.16, 0.12, 1.18], [1, 1, 1], head);
      S(0.13, M.eye, [s * 0.33, 0.2, 0.36], [1, 1, 1], head);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.03), M.black); slit.position.set(s * 0.37, 0.2, 0.47); head.add(slit);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.3), M.dark); brow.position.set(s * 0.3, 0.33, 0.4); brow.rotation.z = s * 0.35; head.add(brow);
      K(0.11, 0.8, M.horn, [s * 0.3, 0.42, -0.3], [-1.05, 0, s * -0.25], head);
      K(0.07, 0.4, M.dark, [s * 0.5, 0.0, -0.2], [-1.2, 0, s * -0.9], head);
      for (let k = 0; k < 3; k++) K(0.03, 0.12, M.horn, [s * (0.22 - k * 0.03), -0.2, 0.55 + k * 0.22], [Math.PI, 0, 0], head);
    });
    const jaw = new THREE.Group(); jaw.position.set(0, -0.22, 0.2); head.add(jaw);
    const jawMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.29, 0.95, 8), M.dark); jawMesh.rotation.x = Math.PI / 2; jawMesh.scale.set(1, 1, 0.42); jawMesh.position.set(0, -0.06, 0.5); jawMesh.castShadow = true; jaw.add(jawMesh);
    [-1, 1].forEach(s => { for (let k = 0; k < 3; k++) K(0.03, 0.12, M.horn, [s * (0.2 - k * 0.03), 0.06, 0.4 + k * 0.2], [0, 0, 0], jaw); });
    const mouth = new THREE.Object3D(); mouth.position.set(0, -0.15, 1.2); head.add(mouth);
    // wings: a leading-edge arm, finger bones, and a membrane fanned between them
    const wings = [-1, 1].map(s => {
      const pivot = new THREE.Group(); pivot.position.set(s * 0.75, 2.4, 0.4); pivot.scale.x = s; body.add(pivot);
      const Sp = V(0, 0, 0), E = V(1.7, 1.05, -0.3), T = V(3.6, 0.6, -1.3), F1 = V(3.1, -0.55, -1.9), F2 = V(2.0, -0.75, -2.0), F3 = V(0.95, -0.5, -1.6), B = V(0.1, -0.15, -1.0);
      const tri = [Sp, E, F3, E, F2, F3, E, F1, F2, E, T, F1, Sp, F3, B];
      const geo = new THREE.BufferGeometry().setFromPoints(tri); geo.computeVertexNormals();
      const mem = new THREE.Mesh(geo, M.wing); mem.castShadow = true; pivot.add(mem);
      const bone = (a, b, r) => { const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, d.length(), 5), M.dark); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); m.castShadow = true; pivot.add(m); };
      bone(Sp, E, 0.12); bone(E, T, 0.08); bone(E, F1, 0.06); bone(E, F2, 0.06); bone(E, F3, 0.06);
      K(0.06, 0.25, M.horn, [E.x, E.y + 0.15, E.z], [0, 0, 0], pivot);
      return { pivot, s };
    });
    // tail chain
    const tail = []; parent = body;
    for (let k = 0; k < 8; k++) {
      const seg = new THREE.Group(); seg.position.set(0, k === 0 ? 1.45 : -0.04, k === 0 ? -1.75 : -0.55); parent.add(seg);
      const r = 0.5 * (1 - k / 9);
      S(r, M.scale, [0, 0, -0.25], [1, 0.9, 1.4], seg, [9, 7]);
      K(0.08, 0.28 * (1 - k / 10), M.dark, [0, r * 0.9, -0.2], [-0.5, 0, 0], seg);
      tail.push(seg); parent = seg;
    }
    const spade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 4), M.dark); spade.rotation.x = -Math.PI / 2; spade.scale.y = 0.4; spade.position.set(0, 0, -0.7); parent.add(spade);
    const mats = [];
    root.traverse(o => { if (o.isMesh && !mats.includes(o.material)) mats.push(o.material); });
    return { root, body, torso, neckPivot, neck, head, jaw, mouth, wings, tail, mats, eyeMat: M.eye,
      pose: { rear: 0, roar: 0, pitch: 0.3, yaw: 0, wing: 0, collapse: 0, fade: 0, flash: 0 },
      target: { rear: 0, roar: 0, pitch: 0.3, yaw: 0, wing: 0 }, breathing: 0, alive: true, nextDisplay: 6, displayT: -1 };
  }
  let dragon = null, dragonHome = new THREE.Vector3(), dragonFace = 0;
  function placeDragon() {
    const end = curve.getPointAt(1), tan = curve.getTangentAt(1);
    dragonHome.copy(end).addScaledVector(tan, 1.0).setY(DECK_Y);
    dragonFace = Math.atan2(-tan.x, -tan.z);
    dragon.root.position.copy(dragonHome); dragon.root.rotation.y = dragonFace;
  }
  const dragonFront = () => dragonHome.clone().add(V(Math.sin(dragonFace), 0, Math.cos(dragonFace)).multiplyScalar(2.2));
  const tmpV = new THREE.Vector3(), tmpT = new THREE.Vector3();
  function updateDragon(dt, time) {
    const D = dragon; if (!D) return;
    const p = D.pose, tg = D.target;
    const k = 1 - Math.exp(-dt * 6);
    ['rear', 'roar', 'pitch', 'yaw', 'wing'].forEach(n => { p[n] += (tg[n] - p[n]) * k; });
    // look at the knight (yaw relative to the dragon's facing)
    if (knight && D.alive && P.mode !== 'finale') {
      const kp = knight.holder.position;
      const want = Math.atan2(kp.x - dragonHome.x, kp.z - dragonHome.z) - dragonFace;
      tg.yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(want), Math.cos(want)), -0.7, 0.7);
    }
    // idle threat display every so often: rear up, wings open, roar fire into the sky
    if (D.alive && P.mode !== 'finale' && !reduceMotion) {
      D.nextDisplay -= dt;
      if (D.nextDisplay <= 0 && D.displayT < 0) { D.displayT = 0; D.nextDisplay = 9 + rnd() * 5; }
      if (D.displayT >= 0) {
        D.displayT += dt;
        const t = D.displayT;
        tg.rear = t < 2.6 ? 1 : 0; tg.wing = t < 2.8 ? 1 : 0; tg.roar = t > 0.5 && t < 2.4 ? 1 : 0; tg.pitch = t < 2.6 ? -0.55 : 0.3;
        D.breathing = t > 0.8 && t < 2.2 ? 1 : 0;
        if (t > 3.2) { D.displayT = -1; D.breathing = 0; }
      }
    }
    const breath = Math.sin(time * 1.8);
    D.torso.scale.set(1.25, 1.05 * (1 + breath * 0.025), 1.9);
    D.neckPivot.rotation.set(-0.5 * p.rear + 0.04 * breath, p.yaw * 0.45, 0);
    D.neck.forEach((s, i) => { s.rotation.x = 0.06 - 0.1 * p.rear; s.rotation.y = p.yaw * 0.1; void i; });
    D.head.rotation.set(p.pitch, p.yaw * 0.3, 0);
    D.jaw.rotation.x = 0.06 + 0.6 * p.roar;
    D.wings.forEach(({ pivot, s }) => {
      const open = p.wing, flap = Math.sin(time * (open > 0.5 ? 7 : 1.4)) * (0.08 + open * 0.35);
      const dead = p.collapse;
      const ry = 0.95 - open * 0.8 + dead * -0.3, rz = 0.75 - open * 0.55 + flap - dead * 1.0;
      pivot.rotation.set(0, s * ry, s * rz);
    });
    D.tail.forEach((seg, i) => { seg.rotation.y = Math.sin(time * 1.6 - i * 0.55) * (0.12 + p.wing * 0.1) * (1 - p.collapse); seg.rotation.x = 0.05; });
    // collapse + fade + hit flash
    D.body.rotation.z = p.collapse * 1.25;
    D.body.position.y = -p.collapse * 0.55;
    D.body.position.x = p.collapse * 0.6;
    D.mats.forEach(m => {
      if (m !== D.eyeMat) m.emissive.setRGB(p.flash, p.flash * 0.9, p.flash * 0.8);
      m.transparent = p.fade > 0; m.opacity = 1 - p.fade;
    });
    D.eyeMat.emissiveIntensity = 1.4 * (1 - p.collapse);
    D.root.visible = p.fade < 0.999;
    p.flash = Math.max(0, p.flash - dt * 3.5);
    // fire
    if (D.breathing > 0 && D.alive && !reduceMotion) {
      D.mouth.getWorldPosition(tmpV);
      const dir = tmpT.set(0, 0, 1).applyQuaternion(D.head.getWorldQuaternion(tmpQ)).normalize();
      const n = Math.ceil(dt * 160);
      for (let i = 0; i < n; i++) {
        const v = dir.clone().multiplyScalar(D.fireSpeed || 9).add(rand3(1.6));
        sparks.emit({ pos: tmpV.clone().add(rand3(0.1)), vel: v, life: 0.45 + rnd() * 0.3, size: [0.35, 1.9 + rnd()], color: ['#fff6c2', '#ff9a2e', '#b3261e'], alpha: 0.9, gravity: -1.5, drag: 1.6 });
      }
      if (rnd() < dt * 12) smoke.emit({ pos: tmpV.clone().addScaledVector(dir, 2.4), vel: dir.clone().multiplyScalar(2).add(V(0, 1.2, 0)), life: 1.4, size: [1, 2.6], color: ['#5a4d45', '#2a2522'], alpha: 0.5, drag: 1 });
    } else if (D.alive && !reduceMotion && rnd() < dt * 0.8) {
      D.mouth.getWorldPosition(tmpV);
      smoke.emit({ pos: tmpV.clone().add(V(0, 0.15, -0.1)), vel: V(0, 0.8, 0).add(rand3(0.3)), life: 2, size: [0.3, 1.1], color: ['#d0c8c0', '#8f8780'], alpha: 0.45, drag: 0.6 });
    }
  }

  // ── Player state: walking the real curve, stopping at banners ─────────
  const P = {
    frac: 0, speed: 0, heading: 0, targetHeading: 0,
    stops: [], pauseLeft: 0, mode: 'idle', // idle | run | pause | finale | victory
    finT: 0, won: false, fin: {},
  };
  const celebrated = new Set(tasks.filter(t => t.done).map(t => t.id));
  const targetFrac = () => restFrac();
  const allDone = () => tasks.every(t => t.done);

  // Once one of the next task's foes is ticked off, the knight goes up to
  // them and stands his ground there (camped), striking each one down as
  // it's ticked instead of walking back to his banner in between;
  // finishing the task sends him on along the road.
  const campedAt = i => { const t = tasks[i]; return !!t && !t.done && (t.foeList || []).some(o => o.resolved); };
  function restFrac() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let to = progressToFrac(done, n);
    const next = tasks.findIndex(t => !t.done);
    const wall = walls.find(w => w.taskIndex === next);
    if (wall && !wall.cleared && campedAt(next)) to = Math.max(to, frogStopFrac(next));
    walls.forEach(w => { if (!w.cleared && !w.clearing && !w.open) to = Math.min(to, frogStopFrac(w.taskIndex)); });
    return to;
  }
  // A ticked-off obstacle: fn(true) when the knight is standing at its foes
  // (at once if he's there, else on arrival, see plan), then a pause for
  // the swings. With another blocked wall in the way or the finale under
  // way, fn(false) runs at once and they fall where they stand.
  const engageQueue = [];
  function engage(i, fn, pause) {
    if (reduceMotion || P.mode === 'finale' || P.mode === 'victory') { fn(false); return; }
    const at = frogStopFrac(i);
    const inTheWay = walls.some(w => w.taskIndex !== i && !w.cleared && !w.clearing && !w.open
      && frogStopFrac(w.taskIndex) > P.frac + 1e-4 && frogStopFrac(w.taskIndex) < at - 1e-4);
    if (inTheWay || at < P.frac - 1e-3) { fn(false); return; }
    if (Math.abs(P.frac - at) < 1e-3 && (P.mode === 'idle' || P.mode === 'pause')) {
      fn(true);
      P.mode = 'pause'; P.pauseLeft = Math.max(P.pauseLeft, pause);
      return;
    }
    engageQueue.push({ i, fn, pause });
  }
  function plan() {
    if (P.mode === 'finale' || P.mode === 'victory') {
      if (allDone()) return;
      undoVictory();
    }
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    const events = [];
    tasks.forEach((t, i) => {
      const wall = walls.find(w => w.taskIndex === i);
      if (t.done && !celebrated.has(t.id)) {
        celebrated.add(t.id);
        // every obstacle already ticked off: nothing left standing to beat
        if (wall && wall.open && !wall.cleared) { wall.cleared = true; wall.t = 99; }
        if (wall && !wall.cleared && !wall.clearing) {
          wall.clearing = true;
          events.push({ frac: frogStopFrac(i), fn: () => clearWall(wall), pause: wallPause(wall), kind: 'wall', wall });
        }
        events.push({ frac: checkpointFrac(i, n), fn: () => popFlag(i, t.title), pause: 0.9, kind: 'flag', taskId: t.id });
      }
      if (!t.done) {
        celebrated.delete(t.id);
        if (wall && (wall.cleared || wall.clearing)) restoreWall(wall);
      }
    });
    const carried = P.stops.flatMap(s => s.events).filter(e =>
      e.kind === 'wall' ? e.wall.clearing && !e.wall.cleared
        : e.kind === 'flag' ? !!(tasks.find(t => t.id === e.taskId) || {}).done : e.kind === 'engage');
    engageQueue.splice(0).forEach(q => events.push({ frac: frogStopFrac(q.i), fn: () => q.fn(true), raw: q.fn, pause: q.pause, kind: 'engage' }));
    const all = carried.concat(events);
    const to = restFrac();
    if (allDone() && !P.won && Math.abs(to - progressToFrac(n, n)) < 1e-6) all.push({ frac: to, fn: startFinale, pause: 0, kind: 'finale' });

    const from = P.frac, dir = to >= from ? 1 : -1;
    const moving = Math.abs(to - from) > 1e-4;
    const onRoute = e => moving && (dir > 0 ? e.frac > from + 1e-4 && e.frac <= to + 1e-4 : e.frac < from - 1e-4 && e.frac >= to - 1e-4);
    const stops = [];
    all.filter(onRoute).sort((a, b) => dir * (a.frac - b.frac)).forEach(e => {
      const last = stops[stops.length - 1];
      if (last && Math.abs(last.frac - e.frac) < 1e-3) { last.events.push(e); last.pause = Math.max(last.pause, e.pause); }
      else stops.push({ frac: e.frac, events: [e], pause: e.pause });
    });
    if (moving && (!stops.length || Math.abs(stops[stops.length - 1].frac - to) > 1e-3)) stops.push({ frac: to, events: [], pause: 0 });
    P.stops = stops;
    if (moving) P.mode = 'run'; else if (P.mode === 'run') P.mode = 'idle';
    all.filter(e => !onRoute(e)).forEach(e => (e.kind === 'engage' ? e.raw(false) : e.fn()));

    if (reduceMotion) {
      P.stops.forEach(s => { P.frac = s.frac; s.events.forEach(e => e.fn()); });
      P.stops = []; if (P.mode === 'run') P.mode = 'idle';
      placeKnight(true);
    }
  }
  // Completed task titles, floating above their banner — world positions
  // re-projected to screen space every frame (see updateTaskLabels) so
  // they track their banner as the follow-cam moves, instead of a
  // position computed once at spawn that drifts off as the camera pans.
  const activeLabels = [];
  // A completed task's title over "COMPLETED!" (in orange), or with kind
  // 'foe' a ticked-off obstacle's name over "ELIMINATED!" (in green).
  function spawnTaskLabel(worldPos, text, kind = 'done') {
    if (!text) return;
    const label = text.length > 28 ? text.slice(0, 27) + '…' : text;
    const outer = document.createElement('div');
    outer.className = 'jc3d-task-label ' + (kind === 'foe' ? 'jc3d-task-label-foe' : 'jc3d-task-label-done');
    const inner = document.createElement('div');
    inner.className = 'jc3d-task-label-inner';
    inner.textContent = '✓ ' + label;
    const sub = document.createElement('small'); sub.textContent = kind === 'foe' ? 'ELIMINATED!' : 'COMPLETED!'; inner.appendChild(sub);
    outer.appendChild(inner);
    labelLayer.appendChild(outer);
    const rec = { el: outer, pos: worldPos.clone() };
    activeLabels.push(rec);
    timers.push(setTimeout(() => {
      outer.remove();
      const idx = activeLabels.indexOf(rec);
      if (idx >= 0) activeLabels.splice(idx, 1);
    }, 2800));
  }
  function updateTaskLabels() {
    if (!activeLabels.length) return;
    const w = root.clientWidth, h = root.clientHeight;
    activeLabels.forEach(rec => {
      const v = rec.pos.clone().project(camera);
      rec.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
      rec.el.style.top = ((1 - (v.y * 0.5 + 0.5)) * h) + 'px';
      rec.el.style.opacity = v.z > 1 ? '0' : '1';
    });
  }

  function popFlag(i, title) {
    const f = flags[i];
    if (!f) return;
    f.pop = 1;
    setLit(f, true);
    sparkle(f.fireAt, 40, ['#ffe28a', '#ff9a2e', '#ffffff'], 4);
    if (knight && P.mode !== 'finale') play(knight, 'Cheer', { fade: 0.2, once: true, timeScale: 1.3 });
    if (title) spawnTaskLabel(f.group.localToWorld(new THREE.Vector3(0, 3.4, 0)), title);
  }

  function placeKnight(snapHeading) {
    const u = THREE.MathUtils.clamp(P.frac, 0, 1), p = curve.getPointAt(u);
    knight.holder.position.copy(p).setY(roadY(p) + 0.04);
    if (snapHeading) {
      const t = curve.getTangentAt(u);
      P.heading = P.targetHeading = Math.atan2(t.x, t.z);
    }
    knight.holder.rotation.y = P.heading;
  }
  const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

  function updateKnight(dt) {
    if (!knight) return;
    knight.mixer.update(dt);
    const stop = P.stops[0];
    if (P.mode === 'run' && stop) {
      const dir = Math.sign(stop.frac - P.frac);
      const distM = Math.abs(stop.frac - P.frac) * curveLen;
      const brake = Math.sqrt(2 * 7 * distM) + 0.3;
      P.speed = Math.min(RUN_SPEED, P.speed + 9 * dt, brake);
      const stepM = Math.min(distM, P.speed * dt);
      P.frac += dir * (stepM / curveLen);
      const t = curve.getTangentAt(THREE.MathUtils.clamp(P.frac, 0, 1));
      P.targetHeading = Math.atan2(t.x * dir, t.z * dir);
      P.heading = angleLerp(P.heading, P.targetHeading, Math.min(1, dt * 10));
      if (P.speed > 0.4) play(knight, 'Running_A', { fade: 0.2, timeScale: Math.max(0.6, P.speed / RUN_SPEED) });
      placeKnight(false);
      if (distM - stepM < 0.005) {
        P.frac = stop.frac; P.speed = 0; placeKnight(false);
        P.stops.shift();
        stop.events.forEach(e => e.fn());
        if (P.mode === 'finale') return;
        if (stop.pause > 0) { P.mode = 'pause'; P.pauseLeft = stop.pause; if (knight.current === knight.actions.Running_A) play(knight, 'Idle', { fade: 0.2 }); }
        else if (!P.stops.length) { P.mode = 'idle'; play(knight, 'Idle', { fade: 0.3 }); }
      }
    } else if (P.mode === 'run' && !stop) {
      P.mode = 'idle'; play(knight, 'Idle', { fade: 0.3 });
    } else if (P.mode === 'pause') {
      P.pauseLeft -= dt;
      if (P.pauseLeft <= 0) P.mode = P.stops.length ? 'run' : 'idle';
    } else if (P.mode === 'finale') {
      updateFinale(dt);
    } else if (P.mode === 'victory') {
      updateVictory(dt);
    } else if (P.mode === 'idle' && finished(knight)) {
      play(knight, 'Idle', { fade: 0.3 });
    }
  }

  // ── Finale: the dragon fight, the gate, the rescue ────────────────────
  let gateLift = 0, princessHome = new THREE.Vector3();
  function startFinale() {
    if (P.won) return;
    P.mode = 'finale'; P.finT = 0;
    const kp = knight.holder.position.clone();
    const front = dragonFront();
    const toward = front.clone().sub(kp).setY(0).normalize();
    P.fin = { from: kp, strike: front.clone().addScaledVector(toward, -1.15).setY(kp.y), toward, steps: new Set() };
    play(knight, 'Idle', { fade: 0.2 });
    if (reduceMotion) { finishInstantly(); }
  }
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  function updateFinale(dt) {
    const D = dragon, t = (P.finT += dt), F = P.fin, kp = knight.holder.position;
    const faceDragon = Math.atan2(dragonHome.x - kp.x, dragonHome.z - kp.z);
    if (t < 9) { P.heading = angleLerp(P.heading, faceDragon, Math.min(1, dt * 6)); knight.holder.rotation.y = P.heading; }
    // 0–1.2 the dragon rears and roars
    if (t < 1.2) { D.displayT = -1; D.target.rear = 1; D.target.wing = 1; D.target.roar = t > 0.4 ? 1 : 0.2; D.target.pitch = -0.45; D.target.yaw = 0; D.fireSpeed = 9; D.breathing = t > 0.45 && t < 1.05 ? 1 : 0; once('roar', () => { cam.shake = 0.35; }); }
    // 1.2–3.0 fire at the knight, who raises his shield
    else if (t < 3.0) {
      once('block', () => play(knight, 'Blocking', { fade: 0.15 }));
      D.target.rear = 0.35; D.target.roar = 1; D.target.wing = 1;
      D.mouth.getWorldPosition(tmpV);
      const aim = kp.clone().setY(kp.y + 1.1);
      D.target.pitch = THREE.MathUtils.clamp(Math.atan2(tmpV.y - aim.y, Math.hypot(aim.x - tmpV.x, aim.z - tmpV.z)) * 0.9 + 0.1, -0.4, 0.9);
      D.fireSpeed = 7; D.breathing = 1;
      if (!reduceMotion && rnd() < dt * 18) sparkle(aim.clone().addScaledVector(F.toward, 0.35), 4, ['#ffe28a', '#ff9a2e'], 3);
    }
    // 3.0–3.7 the fire stops; the knight charges in
    else if (t < 3.7) {
      D.breathing = 0; D.target.roar = 0.3; D.target.rear = 0.2;
      once('charge', () => play(knight, 'Running_A', { fade: 0.15, timeScale: 1.1 }));
      const k = smooth(3.0, 3.7, t);
      kp.lerpVectors(F.from, F.strike, k);
    }
    // 3.7–5.1 two sword strikes
    else if (t < 5.1) {
      kp.copy(F.strike);
      once('strike1', () => play(knight, '1H_Melee_Attack_Chop', { fade: 0.1, once: true, timeScale: 1.2 }));
      if (t > 4.05) once('hit1', () => { D.pose.flash = 1; D.target.rear = 0.6; D.target.roar = 1; cam.shake = 0.4; sparkle(dragonFront().setY(2.2), 50, ['#ffffff', '#ffe28a'], 6); });
      if (t > 4.4) once('strike2', () => play(knight, '1H_Melee_Attack_Slice_Diagonal', { fade: 0.1, once: true, timeScale: 1.2 }));
      if (t > 4.8) once('hit2', () => { D.pose.flash = 1; cam.shake = 0.55; sparkle(dragonFront().setY(2.4), 80, ['#ffffff', '#ffe28a', '#ff9a2e'], 7); });
    }
    // 5.1–6.5 the dragon collapses
    else if (t < 6.5) {
      once('fall', () => { D.alive = false; D.target.rear = 0; D.target.wing = 0; D.target.roar = 0.6; D.target.pitch = 0.9; play(knight, 'Idle', { fade: 0.3 }); });
      D.pose.collapse = smooth(5.1, 6.3, t);
    }
    // 6.5–7.6 it vanishes in smoke and gold
    else if (t < 7.6) {
      once('vanish', () => {
        const c = dragonHome.clone().setY(1.8);
        poof(c, 60, '#e9e1d6'); sparkle(c, 140, ['#ffe28a', '#ffd23f', '#ffffff'], 7);
      });
      D.pose.fade = smooth(6.5, 7.3, t);
    }
    // 7.4–9.4 the portcullis lifts
    if (t > 7.4 && t < 9.6) {
      once('gate', () => poof(V(0, 0.6, CASTLE_FRONT + 0.4), 14, '#cfc6b6'));
      gateLift = smooth(7.4, 9.4, t);
    }
    // 9.0–12 the princess runs out to the knight
    if (t > 9.0 && !F.reunited) {
      once('run', () => play(princess, 'Running_A', { fade: 0.2, timeScale: 0.95 }));
      const meet = kp.clone().addScaledVector(F.toward, 1.25).add(V(F.toward.z, 0, -F.toward.x).multiplyScalar(0.55));
      const pp = princess.holder.position, d = meet.clone().sub(pp).setY(0), dist = d.length();
      const step = Math.min(dist, 3.4 * dt);
      if (dist > 0.02) { pp.addScaledVector(d.normalize(), step); princess.holder.rotation.y = Math.atan2(d.x, d.z); }
      pp.y = pp.z < -32.6 ? DECK_Y + 0.02 : roadY(pp) + 0.04;
      if (dist - step < 0.03) { F.reunited = true; F.reunitedAt = t; }
    }
    if (F.reunited) {
      // both turn to the camera (south) and celebrate
      once('cheer', () => {
        play(knight, 'Cheer', { fade: 0.3 }); play(princess, 'Cheer', { fade: 0.3 });
        victory();
      });
    }
    if (gateLift > 0) portcullis.position.y = gateLift * (GATE_H + 0.2);
  }
  function victory() {
    P.won = true;
    if (celebrationsOn) {
      winEl.hidden = false;
      const div = winEl.firstChild; div.style.animation = 'none'; void div.offsetWidth; div.style.animation = '';
      timers.push(setTimeout(() => { winEl.hidden = true; }, 4300));
      burst(knight.holder.position.clone().setY(1.2), 160, 8);
      fireworks.queue = reduceMotion ? 0 : 14; fireworks.wait = 0;
    }
    P.mode = 'victory'; P.vicT = 0;
    notify();
    // Let the rescue land on screen before the app's own "Project Complete"
    // modal shows up over it.
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; timers.push(setTimeout(cb, celebrationsOn ? 1800 : 0)); }
  }
  function updateVictory(dt) {
    P.vicT = (P.vicT || 0) + dt;
    const toCam = Math.atan2(camera.position.x - knight.holder.position.x, camera.position.z - knight.holder.position.z);
    P.heading = angleLerp(P.heading, toCam, Math.min(1, dt * 3)); knight.holder.rotation.y = P.heading;
    const pp = princess.holder.position, pf = Math.atan2(camera.position.x - pp.x, camera.position.z - pp.z);
    princess.holder.rotation.y = angleLerp(princess.holder.rotation.y, pf, Math.min(1, dt * 3));
    if (fireworks.queue === 0 && celebrationsOn && !reduceMotion && rnd() < dt * 0.35) fireworks.queue = 1;
    if (P.vicT > 7 && knight.current === knight.actions.Cheer) { play(knight, 'Idle', { fade: 0.5 }); play(princess, 'Idle', { fade: 0.5 }); }
  }
  function finishInstantly() {
    dragon.alive = false; dragon.pose.fade = 1; dragon.pose.collapse = 1; dragon.breathing = 0;
    gateLift = 1; portcullis.position.y = GATE_H + 0.2;
    P.fin.strike.y = knight.holder.position.y;
    knight.holder.position.copy(P.fin.strike);
    princess.holder.position.copy(P.fin.strike).addScaledVector(P.fin.toward, 1.25).add(V(P.fin.toward.z, 0, -P.fin.toward.x).multiplyScalar(0.55));
    P.fin.reunited = true;
    victory();
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; winEl.hidden = true; fireworks.queue = 0; fireworks.rockets = [];
    dragon.alive = true; Object.assign(dragon.pose, { rear: 0, roar: 0, pitch: 0.3, yaw: 0, wing: 0, collapse: 0, fade: 0, flash: 0 });
    Object.assign(dragon.target, { rear: 0, roar: 0, pitch: 0.3, yaw: 0, wing: 0 }); dragon.breathing = 0; dragon.displayT = -1; dragon.fireSpeed = 9;
    gateLift = 0; portcullis.position.y = 0;
    princess.holder.position.copy(princessHome); princess.holder.rotation.y = 0; play(princess, 'Idle', { fade: 0.2 });
    placeKnight(true); play(knight, 'Idle', { fade: 0.2 });
  }

  // ── Fireworks over the castle ─────────────────────────────────────────
  const fireworks = { queue: 0, wait: 0, rockets: [] };
  const FW_COLORS = [['#ffc21a', '#ff6a00'], ['#ff2d6f', '#ff8fb1'], ['#2ea8ff', '#9bdcff'], ['#3fdc4f', '#d6ff7a'], ['#a35bff', '#ff7af0']];
  function updateFireworks(dt) {
    if (fireworks.queue > 0) {
      fireworks.wait -= dt;
      if (fireworks.wait <= 0) {
        fireworks.queue--; fireworks.wait = 0.35 + rnd() * 0.4;
        fireworks.rockets.push({ p: V((rnd() - 0.5) * 24, 6, -43 + (rnd() - 0.5) * 8), v: V((rnd() - 0.5) * 2, 11 + rnd() * 2.5, (rnd() - 0.5) * 2), fuse: 0.85 + rnd() * 0.3, c: FW_COLORS[Math.floor(rnd() * FW_COLORS.length)] });
      }
    }
    fireworks.rockets = fireworks.rockets.filter(r => {
      r.fuse -= dt; r.v.y -= 9 * dt; r.p.addScaledVector(r.v, dt);
      sparks.emit({ pos: r.p.clone(), vel: rand3(0.6), life: 0.35, size: [0.25, 0.04], color: ['#ffe9b0', '#ff9a2e'], alpha: 0.7, gravity: 1 });
      if (r.fuse > 0) return true;
      for (let i = 0; i < 130; i++) {
        const d = V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(8 + rnd() * 3);
        sparks.emit({ pos: r.p.clone(), vel: d, life: 1.3 + rnd() * 0.8, size: [0.55, 0.1], color: [r.c[0], r.c[1]], alpha: 0.75, gravity: 2.4, drag: 1.3 });
      }
      return false;
    });
  }

  // ── Birds circling the towers ─────────────────────────────────────────
  const birds = [];
  {
    const wingGeo = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0.12), V(0.55, 0, -0.05), V(0, 0, -0.12)]);
    wingGeo.computeVertexNormals();
    const birdMat = new THREE.MeshBasicMaterial({ color: '#2b2b33', side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const l = new THREE.Mesh(wingGeo, birdMat), r = new THREE.Mesh(wingGeo, birdMat); r.scale.x = -1;
      g.add(l, r); g.scale.setScalar(1.3); scene.add(g);
      birds.push({ g, l, r, cx: i < 5 ? 0 : (rnd() - 0.5) * 40, cz: i < 5 ? -46 : (rnd() - 0.5) * 40, rad: 9 + rnd() * 14, h: 16 + rnd() * 10, sp: (0.18 + rnd() * 0.15) * (rnd() < 0.5 ? 1 : -1), ph: rnd() * 6 });
    }
  }
  function updateBirds(time) {
    birds.forEach(b => {
      const a = time * b.sp + b.ph;
      b.g.position.set(b.cx + Math.cos(a) * b.rad, b.h + Math.sin(time * 0.7 + b.ph) * 1.2, b.cz + Math.sin(a) * b.rad);
      b.g.rotation.y = -a + (b.sp > 0 ? 0 : Math.PI);
      const f = Math.sin(time * 9 + b.ph) * 0.6;
      b.l.rotation.z = f; b.r.rotation.z = -f;
    });
  }

  // ── Camera: follow, overview, and the finale's cinematic angles ───────
  const cam = { mode: 'follow', look: new THREE.Vector3(0, 1, 20), shake: 0 };
  const peek = { at: new THREE.Vector3(), t: 0 };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  function updateCamera(dt, time) {
    if (!knight) return;
    const kp = knight.holder.position;
    const fwd = new THREE.Vector3(Math.sin(P.heading), 0, Math.cos(P.heading));
    let rate = 3;
    if (P.mode === 'finale') {
      const t = P.finT, F = P.fin, perp = V(F.toward.z, 0, -F.toward.x);
          if (t < 3.7) { camDesired.copy(kp).addScaledVector(F.toward, -7.5).addScaledVector(perp, 3.6).setY(3.3); lookDesired.copy(dragonHome).addScaledVector(F.toward, 1.2).addScaledVector(perp, 0.8).setY(2.6); }
      else if (t < 6.5) { camDesired.copy(kp).addScaledVector(F.toward, -4.8).addScaledVector(perp, 2.8).setY(2.3); lookDesired.copy(dragonHome).addScaledVector(perp, 0.6).setY(2.5); }
      else if (t < 9.2) { camDesired.copy(kp).addScaledVector(F.toward, -5.5).addScaledVector(perp, -2.5).setY(3.4); lookDesired.set(0, 2.4, CASTLE_FRONT); }
      else { camDesired.copy(kp).addScaledVector(F.toward, -4.2).addScaledVector(perp, 3.2).setY(2.4); lookDesired.copy(kp).addScaledVector(F.toward, 1.2).setY(1.1); }
      rate = 2.2;
    } else if (P.mode === 'victory') {
      // in front of the couple, looking back past them at the castle and the fireworks
      const F = P.fin;
      const perp = V(F.toward.z, 0, -F.toward.x);
      camDesired.copy(kp).addScaledVector(F.toward, -10).addScaledVector(perp, 3.4).setY(kp.y + 2.6);
      lookDesired.copy(kp).addScaledVector(F.toward, 8).addScaledVector(perp, -0.6).setY(5.0);
      rate = 1.6;
    } else if (cam.mode === 'overview') {
      camDesired.set(44, 52, 40);
      lookDesired.set(0, 0, -6);
    } else {
      const orbit = P.mode === 'idle' ? Math.sin(time * 0.25) * 1.6 : 0;
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      camDesired.copy(kp).addScaledVector(fwd, -6.4).addScaledVector(side, 1.8 + orbit).setY(kp.y + 3.4);
      lookDesired.copy(kp).addScaledVector(fwd, 3.5).setY(kp.y + 1.0);
      peekCamera(peek, kp, camDesired, lookDesired, dt, 10, 5, 2.5);
    }
    const k = 1 - Math.exp(-dt * rate);
    camera.position.lerp(camDesired, k);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
    if (cam.shake > 0 && !reduceMotion) {
      camera.position.add(rand3(cam.shake * 0.25));
      cam.shake = Math.max(0, cam.shake - dt * 1.2);
    }
    // keep the shadow map centred on the action
    sun.target.position.copy(kp);
    sun.position.copy(kp).addScaledVector(sunDir, 70);
    sky.position.copy(camera.position);
  }

  function simulate(dt, time) {
    env.cur += (env.target - env.cur) * Math.min(1, dt * 0.8);
    applySky(env.cur);
    updateKnight(dt);
    if (princess) {
      princess.mixer.update(dt);
      if (P.mode !== 'finale' && P.mode !== 'victory') {
        // calling for help behind the bars every few seconds
        if (finished(princess)) play(princess, 'Idle', { fade: 0.3 });
        if (Math.floor(time / 5.5) !== Math.floor((time - dt) / 5.5) && !reduceMotion) play(princess, 'Cheer', { fade: 0.25, once: true });
      }
    }
    updateDragon(dt, time);
    updateWalls(dt, time);
    updateFireworks(dt);
    // ambient emitters: lit braziers, gate torches, chimney smoke
    if (!reduceMotion) {
      emitAcc += dt;
      while (emitAcc > 1 / 30) {
        emitAcc -= 1 / 30;
        flags.forEach(f => { if (f.lit) flame(f.fireAt, 0.9); });
        torches.forEach(t => flame(t, 0.75));
        if (rnd() < 0.25) chimneys.forEach(c => smoke.emit({ pos: c.clone().add(rand3(0.2)), vel: V(0.35, 0.9, 0.1).add(rand3(0.2)), life: 4.5, size: [0.6, 2.6], color: ['#e6e1d8', '#9f9a92'], alpha: 0.45, drag: 0.15 }));
      }
    }
    sparks.update(dt);
    smoke.update(dt);
    updateConfetti(dt);
    waveCloths(time);
    updateBirds(time);
    flags.forEach(f => {
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); const s = 1 + Math.sin((1 - f.pop) * Math.PI) * 0.4; f.group.scale.setScalar(s); }
      if (f.ring.visible) { const s = 1 + 0.15 * Math.sin(time * 4); f.ring.scale.setScalar(s); f.ring.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); }
      if (f.lit) f.glow.scale.setScalar(1.4 + Math.sin(time * 17 + f.group.position.x) * 0.12 + rnd() * 0.08);
    });
    waterTex.offset.x = time * 0.012; waterTex.offset.y = time * 0.006;
    clouds.forEach((c, i) => { c.position.x += dt * (0.8 + (i % 3) * 0.3); if (c.position.x > 200) c.position.x = -200; });
    updateCamera(dt, time);
    updateTaskLabels();
  }

  // ── Pace ghost (the app's "competitor" marker): a faded knight standing
  // at the pace position, mapped onto the banners the same way.
  let ghost = null;
  function progressToPathFracSmooth(p, n) {
    if (!n) return 0;
    const knots = [[0, 0]];
    for (let k = 1; k <= n; k++) knots.push([k / n, checkpointFrac(k - 1, n)]);
    const q = Math.max(0, Math.min(1, p));
    for (let j = 1; j < knots.length; j++) {
      const [p0, f0] = knots[j - 1], [p1, f1] = knots[j];
      if (q <= p1) return f0 + (f1 - f0) * ((q - p0) / ((p1 - p0) || 1));
    }
    return knots[knots.length - 1][1];
  }
  function updateGhost(g) {
    if (!knight) return;
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) {
      const obj = SkeletonUtils.clone(knight.obj);
      obj.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        Object.assign(o.material, { transparent: true, opacity: 0.4, depthWrite: false });
        o.material.color.set('#cbd5e1');
        o.castShadow = false;
      });
      const holder = new THREE.Group(); holder.add(obj); scene.add(holder);
      const mixer = new THREE.AnimationMixer(obj);
      const actions = {};
      clips.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
      ghost = { holder, obj, mixer, actions, current: null };
      play(ghost, 'Idle', { fade: 0 });
    }
    const u = THREE.MathUtils.clamp(progressToPathFracSmooth(g.frac, tasks.length), 0, 1);
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    ghost.holder.visible = true;
    ghost.holder.position.copy(p).addScaledVector(new THREE.Vector3(-t.z, 0, t.x).normalize(), -0.9).setY(roadY(p) + 0.04);
    ghost.holder.rotation.y = Math.atan2(t.x, t.z);
  }

  function updateLabel() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Castle Journey: ${done} of ${n} tasks done.` : 'Castle Journey: no tasks yet.';
    const blockedAhead = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= progressToFrac(done, n) + 1e-3);
    if (blockedAhead) text += ` A giant frog blocks the road: ${tasks[blockedAhead.taskIndex].blocker}.`;
    if (n && done === n) text += P.won ? ' The dragon is beaten and the princess is free!' : ' Facing the dragon.';
    root.setAttribute('aria-label', text);
  }

  // ── State from the app ───────────────────────────────────────────────
  let latestState = null, layoutSig = null;
  const toTasks = stageTasks;
  // Already finished when the stage opens: show the ending without replaying it.
  function settleWon() {
    const kp = knight.holder.position.clone(), front = dragonFront();
    const toward = front.clone().sub(kp).setY(0).normalize();
    const strike = front.clone().addScaledVector(toward, -1.15).setY(kp.y);
    P.fin = { from: kp, strike, toward, steps: new Set(['cheer']), reunited: true };
    knight.holder.position.copy(strike);
    princess.holder.position.copy(strike).addScaledVector(toward, 1.25).add(V(toward.z, 0, -toward.x).multiplyScalar(0.55));
    princess.holder.position.y = roadY(princess.holder.position) + 0.04;
    dragon.alive = false; dragon.breathing = 0; Object.assign(dragon.pose, { fade: 1, collapse: 1 });
    gateLift = 1; portcullis.position.y = GATE_H + 0.2;
    P.won = true; P.mode = 'victory'; P.vicT = 99;
    play(knight, 'Idle', { fade: 0 }); play(princess, 'Idle', { fade: 0 });
  }
  function applyState(state) {
    onSummitCb = state.onSummit || null;
    const next = toTasks(state);
    const n = next.length, frac = n ? next.filter(t => t.done).length / n : 0;
    // Which tasks exist, in what order, and which are blocked decides where
    // banners and frogs stand. When that changes, rebuild and place the
    // knight directly; otherwise only statuses changed, and he marches.
    const sig = layoutSignature(next);
    if (sig !== layoutSig) {
      const firstBuild = layoutSig === null;
      layoutSig = sig;
      if (P.won || P.mode === 'finale' || P.mode === 'victory') undoVictory();
      tasks = next;
      celebrated.clear();
      tasks.forEach(t => { if (t.done) celebrated.add(t.id); });
      P.stops = []; P.speed = 0; P.mode = 'idle'; cam.shake = 0; engageQueue.length = 0;
      buildFlags(); buildWalls(); refreshFlags();
      tasks.forEach((t, i) => { if (t.done) setLit(flags[i], true); });
      P.frac = targetFrac(); placeKnight(true); play(knight, 'Idle', { fade: 0.2 });
      if (n && tasks.every(t => t.done)) settleWon();
      env.target = env.cur = frac;
      if (firstBuild) snapCamera();
    } else {
      const changes = resolveChanges(tasks, next);
      next.forEach((t, i) => { tasks[i].done = t.done; tasks[i].title = t.title; tasks[i].blocker = t.blocker; tasks[i].foes = t.foes; tasks[i].foeList = t.foeList; });
      if (changes.length) applyResolves(changes);
      refreshFlags();
      plan();
      env.target = frac;
    }
    updateGhost(state.ghost);
    updateLabel();
  }
  function snapCamera() {
    const fwd = new THREE.Vector3(Math.sin(P.heading), 0, Math.cos(P.heading));
    camera.position.copy(knight.holder.position).addScaledVector(fwd, -6.4).setY(knight.holder.position.y + 3.4);
    cam.look.copy(knight.holder.position).addScaledVector(fwd, 3.5).setY(knight.holder.position.y + 1);
    camera.lookAt(cam.look);
  }

  // ── Loop, size, lifecycle ────────────────────────────────────────────
  // Measure our own absolutely-positioned root rather than the container, so
  // the canvas still gets a real size if the container's own layout classes
  // haven't applied (e.g. the Tailwind CDN was slow or blocked).
  function resize() {
    const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 62 : 50;
    camera.updateProjectionMatrix();
    particleUniformScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  const clock = new THREE.Clock();
  let simTime = 0, emitAcc = 0, running = false, destroyed = false;
  function step(dt) {
    simTime += dt;
    simulate(dt, simTime);
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
  }
  function frame() {
    step(Math.min(clock.getDelta(), 1 / 20));
    renderer.render(scene, camera);
  }
  function start() { if (running || destroyed || !knight) return; running = true; clock.getDelta(); renderer.setAnimationLoop(frame); }
  function stop() { running = false; renderer.setAnimationLoop(null); }

  const load = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  Promise.all([load(KNIGHT_URL), load(PRINCESS_URL)]).then(([kg, pg]) => {
    if (destroyed) return;
    clips = kg.animations;
    knight = makeCharacter(kg, KNIGHT_H);
    dressPrincess(pg.scene);
    princess = makeCharacter(pg, PRINCESS_H);
    princessHome.set(0.2, DECK_Y - 0.08, CASTLE_FRONT - 1.35);
    princess.holder.position.copy(princessHome);
    play(princess, 'Idle', { fade: 0 });
    dragon = buildDragon(); scene.add(dragon.root); placeDragon();
    play(knight, 'Idle', { fade: 0 });
    loadingEl.hidden = true;
    if (latestState) applyState(latestState);
    start();
  }).catch(err => {
    console.error('Castle 3D: could not load the characters', err);
    loadingEl.textContent = 'Couldn’t load the 3D knight. Switch the scene to Castle for the 2D version.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (knight) applyState(state);
    },
    pause: stop,
    resume: start,
    destroy() {
      destroyed = true;
      stop();
      ro.disconnect();
      timers.forEach(clearTimeout);
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(m => {
          Object.values(m).forEach(v => { if (v && v.isTexture) v.dispose(); });
          if (m.uniforms) Object.values(m.uniforms).forEach(u => { if (u && u.value && u.value.isTexture) u.value.dispose(); });
          m.dispose();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
      if (container.parentElement) container.parentElement.style.background = '';
    },
    // For automated checks.
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30); },
      get state() {
        return {
          ready: !!knight, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length, finT: P.finT,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)), walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, foes: w.foes.length, gone: w.foes.filter(f => f.gone).length, open: !!w.open })),
          dragon: dragon ? { alive: dragon.alive, fade: +dragon.pose.fade.toFixed(2) } : null, gate: +gateLift.toFixed(2),
          ghost: ghost ? ghost.holder.visible : false, label: root.getAttribute('aria-label'), lit: flags.map(f => f.lit),
          onPath: knight && P.mode !== 'finale' && P.mode !== 'victory' ? distToPath(knight.holder.position.x, knight.holder.position.z) : 0,
        };
      },
    },
  };
}
