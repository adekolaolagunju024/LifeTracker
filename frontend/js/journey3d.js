// ── JOURNEY 3D: FOOTBALL STAGE (WebGL / three.js) ─────────────────────
// A real 3D take on the Football Journey stage: a floodlit stadium, a
// rigged, animated player who runs the path to one flag per task, defender
// walls on the path for blocked tasks, and a shot into the goal when every
// task is done.
//
// Loaded on demand by journeyGame.js (only when the "Football 3D" theme is
// picked), which falls back to the 2D Football stage if WebGL or this module
// isn't available. Same contract as the 2D scene: app.js owns state and calls
// sync() with { tasks, ghost, celebrationsEnabled, ... }; this owns drawing.
//
// three.js is self-hosted (see the /vendor/three routes in server.js and the
// import map in index.html). The player model is RobotExpressive by Tomás
// Laulhé, CC0 (frontend/assets/models/README.md).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { stageTasks, layoutSignature, nameTagSprite, pickFoes, resolveChanges, tagText, peekCamera } from './journey3dKit.js';

const MODEL_URL = '/assets/models/RobotExpressive.glb';
const UI_FONT = '"Arial Black", Impact, "Arial Narrow", sans-serif';

function injectStyles() {
  if (document.getElementById('journey3d-styles')) return;
  const style = document.createElement('style');
  style.id = 'journey3d-styles';
  style.textContent = `
    .j3d-root { position: absolute; inset: 0; overflow: hidden; background: #0a1220; }
    .j3d-root canvas { display: block; width: 100%; height: 100%; touch-action: pan-y; }
    .j3d-cam { position: absolute; top: 10px; right: 10px; display: flex; padding: 3px; border-radius: 999px;
      background: rgba(10,18,32,.78); border: 1px solid rgba(214,226,255,.16); z-index: 2; }
    .j3d-cam button { font: 600 12px system-ui, sans-serif; color: #a9b5ca; background: transparent; border: 0;
      border-radius: 999px; padding: 7px 11px; cursor: pointer; min-height: 30px; }
    .j3d-cam button[aria-pressed="true"] { background: #f3f6fc; color: #0a1220; }
    .j3d-cam button:focus-visible { outline: 2px solid #f6b93b; outline-offset: 2px; }
    .j3d-goal { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 3;
      font: 900 clamp(56px, 14vw, 150px) ${UI_FONT}; color: #fff; -webkit-text-stroke: 3px #c62828;
      text-shadow: 0 5px 0 #a3201a, 0 12px 34px rgba(0,0,0,.55); }
    .j3d-goal[hidden] { display: none; }
    .j3d-goal span { animation: j3d-goal-pop 2.6s cubic-bezier(.2,1.4,.4,1) both; }
    @keyframes j3d-goal-pop { 0% { transform: scale(.2) rotate(-6deg); opacity: 0; } 14% { transform: scale(1.12) rotate(2deg); opacity: 1; }
      26% { transform: scale(1); } 82% { opacity: 1; } 100% { transform: translateY(-14px); opacity: 0; } }
    .j3d-loading { position: absolute; inset: 0; display: grid; place-items: center; color: #a9b5ca; font: 600 14px system-ui, sans-serif; z-index: 1; }
    .j3d-loading[hidden] { display: none; }
    .j3d-labels { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
    .j3d-task-label { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); }
    .j3d-task-label-inner { display: block; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;
      background: rgba(255,255,255,.96); color: #1f2937; font: 800 13px system-ui, sans-serif; padding: 5px 10px; border-radius: 999px;
      box-shadow: 0 2px 6px rgba(0,0,0,.35); animation: j3d-label-pop 2.2s ease-out both; }
    @keyframes j3d-label-pop {
      0% { opacity: 0; transform: translateY(6px) scale(.85); }
      12% { opacity: 1; transform: translateY(0) scale(1); }
      72% { opacity: 1; transform: translateY(-4px) scale(1); }
      100% { opacity: 0; transform: translateY(-26px) scale(.96); }
    }
    .j3d-task-label-foe .j3d-task-label-inner { background: #15803d; color: #fff; text-align: center; animation-duration: 2.8s; }
    .j3d-task-label-done .j3d-task-label-inner { background: linear-gradient(180deg, #f59e0b, #ea580c); color: #fff; text-align: center; animation-duration: 2.8s; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
    .j3d-task-label-done .j3d-task-label-inner small { color: #fff7d6; }
    .j3d-task-label-inner small { display: block; font: 900 10px system-ui, sans-serif; letter-spacing: .14em; color: #fde68a; }
    @media (prefers-reduced-motion: reduce) { .j3d-goal span, .j3d-task-label-inner { animation: none; } }
  `;
  document.head.appendChild(style);
}

export function createFootball3D(container) {
  injectStyles();
  const root = document.createElement('div');
  root.className = 'j3d-root';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Football Journey in 3D');
  const loadingEl = document.createElement('div');
  loadingEl.className = 'j3d-loading';
  loadingEl.textContent = 'Loading the stadium…';
  const camBar = document.createElement('div');
  camBar.className = 'j3d-cam';
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
  const goalOverlay = document.createElement('div');
  goalOverlay.className = 'j3d-goal'; goalOverlay.hidden = true;
  goalOverlay.innerHTML = '<span>GOAL!</span>';
  // Completed tasks' own titles float up here — a DOM overlay rather than
  // in-scene geometry, tracked onto each flag's screen position every
  // frame since (unlike the 2D stage) the camera itself moves.
  const labelLayer = document.createElement('div');
  labelLayer.className = 'j3d-labels';
  root.append(loadingEl, camBar, labelLayer, goalOverlay);
  container.appendChild(root);
  if (container.parentElement) container.parentElement.style.background = '#0a1220';

  let tasks = [];
  let celebrationsOn = true;
  // The app shows its own "Project Complete" modal a short beat after
  // this fires — not on task-toggle like it used to, since the player
  // now runs to the goal and takes a shot before the goal actually
  // lands, and that travel + shot + celebration easily takes several
  // seconds the old fixed-delay approach never accounted for.
  let onSummitCb = null;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const timers = [];
  function notify() { updateLabel(); }

  // ── Pitch geometry (metres). Pitch runs along z; the goal is at z = -30. ─
  const HALF_W = 20, HALF_L = 30, GOAL_Z = -HALF_L, GOAL_HALF = 3.66, GOAL_H = 2.44, NET_D = 2.0;
  const PLAYER_H = 1.8, RUN_SPEED = 4.2;

  const curve = new THREE.CatmullRomCurve3(
    [[-11, 27], [6, 21], [-7, 12], [8, 3], [-6, -6], [5, -14], [-2.5, -21], [0, -28.6]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false, 'catmullrom', 0.5,
  );
  const curveLen = curve.getLength();

  const checkpointFrac = (i, n) => (n > 1 ? 0.06 + (i / (n - 1)) * 0.88 : 0.5);
  const wallFrac = i => checkpointFrac(i, tasks.length) - 0.03;
  // k tasks done → stand at the k-th flag; all done → the last flag (the shot is taken from there).
  function progressToFrac(doneCount, n) {
    if (!n || doneCount <= 0) return 0;
    return checkpointFrac(Math.min(doneCount, n) - 1, n);
  }

  // ── Renderer / scene ─────────────────────────────────────────────────
  // Throws if WebGL can't start; journeyGame.js catches that and falls back to 2D.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = canvasTexture(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#060b18'); grd.addColorStop(0.55, '#16264a'); grd.addColorStop(0.8, '#3a4d7a'); grd.addColorStop(1, '#6d7fa8');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog('#24365e', 70, 170);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(-14, 6, 36);

  function canvasTexture(w, h, draw, opts = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  // Lighting: a cool sky fill, plus the main floodlight as a shadow-casting key light.
  scene.add(new THREE.HemisphereLight('#bcd2ff', '#1c3a1c', 0.9));
  const key = new THREE.DirectionalLight('#fff4dd', 2.6);
  key.position.set(-22, 42, 16);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -38, right: 38, top: 42, bottom: -42, near: 5, far: 120 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#9fb8ff', 0.8);
  rim.position.set(25, 18, -40);
  scene.add(rim);

  // ── Pitch: mown stripes + full markings, painted onto one texture ──────
  const PITCH_PLANE_W = 48, PITCH_PLANE_L = 72, PPM = 1024 / PITCH_PLANE_W;
  const pitchTex = canvasTexture(1024, Math.round(PITCH_PLANE_L * PPM), (g, w, h) => {
    const X = x => (x + PITCH_PLANE_W / 2) * PPM, Y = z => (z + PITCH_PLANE_L / 2) * PPM;
    const bands = 18;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = i % 2 ? '#3b9d3f' : '#45ad48';
      g.fillRect(0, (i / bands) * h, w, h / bands + 1);
    }
    // subtle grain
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.fillStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 0.12 * PPM;
    const rect = (x0, z0, x1, z1) => g.strokeRect(X(x0), Y(z0), X(x1) - X(x0), Y(z1) - Y(z0));
    rect(-HALF_W, -HALF_L, HALF_W, HALF_L);
    g.beginPath(); g.moveTo(X(-HALF_W), Y(0)); g.lineTo(X(HALF_W), Y(0)); g.stroke();
    g.beginPath(); g.arc(X(0), Y(0), 5.2 * PPM, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(X(0), Y(0), 0.25 * PPM, 0, Math.PI * 2); g.fill();
    [-1, 1].forEach(end => {
      const gl = end * HALF_L, inward = -end;
      rect(-11.5, gl, 11.5, gl + inward * 9.4);
      rect(-5.25, gl, 5.25, gl + inward * 3.1);
      const spotZ = gl + inward * 6.3;
      g.beginPath(); g.arc(X(0), Y(spotZ), 0.22 * PPM, 0, Math.PI * 2); g.fill();
      // penalty arc: the part of the circle around the spot that lies outside the box
      const boxEdge = gl + inward * 9.4, r = 5.2, dz = Math.abs(boxEdge - spotZ), a = Math.acos(dz / r);
      const base = inward > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.beginPath(); g.arc(X(0), Y(spotZ), r * PPM, base - a, base + a); g.stroke();
      [-1, 1].forEach(side => {
        g.beginPath();
        g.arc(X(side * HALF_W), Y(gl), 0.6 * PPM, side < 0 ? (end < 0 ? 0 : -Math.PI / 2) : (end < 0 ? Math.PI / 2 : Math.PI), side < 0 ? (end < 0 ? Math.PI / 2 : 0) : (end < 0 ? Math.PI : Math.PI * 1.5));
        g.stroke();
      });
    });
  });
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_PLANE_W, PITCH_PLANE_L), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ color: '#25502a', roughness: 1 }));
  surround.rotation.x = -Math.PI / 2; surround.position.y = -0.02; surround.receiveShadow = true;
  scene.add(surround);

  // ── The path the player follows: a worn training lane with a dashed centre line ─
  function ribbonGeometry(width, samples, tile) {
    const pos = [], uv = [], nrm = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples, p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
      pos.push(p.x + side.x * width / 2, 0, p.z + side.z * width / 2, p.x - side.x * width / 2, 0, p.z - side.z * width / 2);
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
  const laneTex = canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(214,236,170,0)'); grd.addColorStop(0.2, 'rgba(214,236,170,0.55)');
    grd.addColorStop(0.8, 'rgba(214,236,170,0.55)'); grd.addColorStop(1, 'rgba(214,236,170,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { repeat: true });
  const lane = new THREE.Mesh(ribbonGeometry(2.6, 500, 4), new THREE.MeshStandardMaterial({ map: laneTex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  lane.position.y = 0.01; lane.receiveShadow = true;
  scene.add(lane);
  const dashTex = canvasTexture(64, 8, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w * 0.55, h); }, { repeat: true });
  const dashes = new THREE.Mesh(ribbonGeometry(0.14, 500, 1.6), new THREE.MeshBasicMaterial({ map: dashTex, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  dashes.position.y = 0.015;
  scene.add(dashes);

  // ── Stadium: tiered stands, a crowd, LED boards, floodlights ──────────
  const standMats = [new THREE.MeshStandardMaterial({ color: '#1b2234', roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: '#232c42', roughness: 0.9 })];
  const fanSpots = [];
  function stand(cx, cz, length, alongX, outward) {
    for (let tier = 0; tier < 4; tier++) {
      const depth = 2.2, rise = 1.3;
      const d = 6 + tier * depth;
      const box = new THREE.Mesh(new THREE.BoxGeometry(alongX ? length : depth, rise * (tier + 1), alongX ? depth : length), standMats[tier % 2]);
      const off = d + depth / 2;
      box.position.set(cx + (alongX ? 0 : outward * off), (rise * (tier + 1)) / 2, cz + (alongX ? outward * off : 0));
      box.receiveShadow = true;
      scene.add(box);
      for (let s = -length / 2 + 0.6; s < length / 2 - 0.4; s += 0.85) {
        fanSpots.push(new THREE.Vector3(
          cx + (alongX ? s : outward * (off - 0.3)), rise * (tier + 1), cz + (alongX ? outward * (off - 0.3) : s),
        ));
      }
    }
    // roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(alongX ? length + 4 : 10, 0.4, alongX ? 10 : length + 4), new THREE.MeshStandardMaterial({ color: '#0f1524', roughness: 0.6, metalness: 0.3 }));
    roof.position.set(cx + (alongX ? 0 : outward * 11), 9.5, cz + (alongX ? outward * 11 : 0));
    scene.add(roof);
  }
  stand(0, -HALF_L - 1, 52, true, -1);
  stand(0, HALF_L + 1, 52, true, 1);
  stand(-HALF_W - 1, 0, 70, false, -1);
  stand(HALF_W + 1, 0, 70, false, 1);

  const KIT_COLORS = ['#e5382f', '#ffffff', '#e5382f', '#ffd23f', '#e5382f', '#1f6fe5', '#ffffff'];
  const fans = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.42, 2, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), fanSpots.length);
  const fanPhase = new Float32Array(fanSpots.length);
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color();
  fanSpots.forEach((p, i) => {
    fanPhase[i] = Math.random() * Math.PI * 2;
    tmpM.makeTranslation(p.x, p.y + 0.4, p.z);
    fans.setMatrixAt(i, tmpM);
    fans.setColorAt(i, tmpC.set(KIT_COLORS[(i * 7 + (i >> 3)) % KIT_COLORS.length]));
  });
  scene.add(fans);
  const SKIN = ['#f1c7a3', '#d9a07a', '#a8714f', '#7a4a32', '#f6d7bd'];
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.7 }), fanSpots.length);
  fanSpots.forEach((p, i) => {
    tmpM.makeTranslation(p.x, p.y + 0.86, p.z); heads.setMatrixAt(i, tmpM);
    heads.setColorAt(i, tmpC.set(SKIN[(i * 3 + (i >> 2)) % SKIN.length]));
  });
  scene.add(heads);
  let cheer = 0;

  let boardTex = null;
  const drawBoardTex = () => canvasTexture(1024, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#0b3d91'); grd.addColorStop(0.5, '#1b6fe0'); grd.addColorStop(1, '#0b3d91');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.font = '800 40px "Big Shoulders Display", Impact, sans-serif'; g.textBaseline = 'middle';
    // A whole number of labels per tile, evenly spaced, so the repeat has no seam.
    const label = 'WAYPOINT  ·  EVERY GOAL, ONE PATH', count = Math.max(1, Math.floor(w / (g.measureText(label).width + 60))), step = w / count;
    for (let k = 0; k < count; k++) g.fillText(label, k * step + 30, h / 2 + 2);
  }, { repeat: true });
  function ledBoard(x, z, len, rotY) {
    boardTex = boardTex || drawBoardTex();
    const tex = boardTex.clone(); tex.needsUpdate = true; tex.repeat.set(len / 16, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.12), [
      new THREE.MeshStandardMaterial({ color: '#111' }), new THREE.MeshStandardMaterial({ color: '#111' }),
      new THREE.MeshStandardMaterial({ color: '#111' }), new THREE.MeshStandardMaterial({ color: '#111' }),
      new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.7 }),
      new THREE.MeshStandardMaterial({ color: '#111' }),
    ]);
    m.position.set(x, 0.45, z); m.rotation.y = rotY; m.castShadow = true;
    scene.add(m);
  }
  const glowTex = canvasTexture(128, 128, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,250,230,1)'); grd.addColorStop(0.25, 'rgba(255,240,200,0.55)'); grd.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const x = sx * (HALF_W + 16), z = sz * (HALF_L + 14);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 30, 8), new THREE.MeshStandardMaterial({ color: '#5b6476', metalness: 0.6, roughness: 0.4 }));
    mast.position.set(x, 15, z); scene.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 0.6), new THREE.MeshStandardMaterial({ color: '#2a3140', emissive: '#fff6d8', emissiveIntensity: 1.6 }));
    head.position.set(x, 30.5, z); head.lookAt(0, 0, 0); scene.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.position.set(x * 0.98, 30.5, z * 0.98); glow.scale.setScalar(26); scene.add(glow);
  });

  // ── The goal: posts, crossbar, and a net that can actually bulge ──────
  const goal = new THREE.Group();
  scene.add(goal);
  const postMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, emissive: '#ffffff', emissiveIntensity: 0.08 });
  function bar(a, b, r = 0.06) {
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), postMat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = true; goal.add(m);
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  bar(V(-GOAL_HALF, 0, GOAL_Z), V(-GOAL_HALF, GOAL_H, GOAL_Z));
  bar(V(GOAL_HALF, 0, GOAL_Z), V(GOAL_HALF, GOAL_H, GOAL_Z));
  bar(V(-GOAL_HALF - 0.06, GOAL_H, GOAL_Z), V(GOAL_HALF + 0.06, GOAL_H, GOAL_Z));
  [-1, 1].forEach(s => {
    bar(V(s * GOAL_HALF, GOAL_H, GOAL_Z), V(s * GOAL_HALF, 0, GOAL_Z - NET_D), 0.03);
    bar(V(s * GOAL_HALF, 0, GOAL_Z), V(s * GOAL_HALF, 0, GOAL_Z - NET_D), 0.03);
  });
  bar(V(-GOAL_HALF, 0, GOAL_Z - NET_D), V(GOAL_HALF, 0, GOAL_Z - NET_D), 0.03);

  const netTex = canvasTexture(64, 64, (g, w) => {
    g.clearRect(0, 0, w, w); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.moveTo(0, 0); g.lineTo(0, w); g.stroke();
  }, { repeat: true });
  const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 0.8 });
  // Net panels built directly in world space so one bulge function can push them all.
  const netMeshes = [];
  function netPanel(corner, uVec, vVec, nu, nv) {
    const pos = [], uv = [], idx = [];
    const lu = uVec.length(), lv = vVec.length();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const p = corner.clone().addScaledVector(uVec, i / nu).addScaledVector(vVec, j / nv);
      pos.push(p.x, p.y, p.z); uv.push((i / nu) * lu / 0.22, (j / nv) * lv / 0.22);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    geo.userData.base = Float32Array.from(pos);
    const m = new THREE.Mesh(geo, netMat); goal.add(m); netMeshes.push(m);
  }
  netPanel(V(-GOAL_HALF, 0, GOAL_Z - NET_D), V(GOAL_HALF * 2, 0, 0), V(0, GOAL_H, NET_D), 30, 14);   // back + top as one sloped sheet
  [-1, 1].forEach(s => netPanel(V(s * GOAL_HALF, 0, GOAL_Z), V(0, 0, -NET_D), V(0, GOAL_H, 0), 10, 12)); // sides
  let bulge = null; // { t, x, y }
  function updateNet(dt) {
    if (!bulge) return;
    bulge.t += dt;
    const amp = 0.9 * Math.exp(-bulge.t * 3.2) * Math.cos(bulge.t * 11);
    netMeshes.forEach(m => {
      const p = m.geometry.attributes.position, b = m.geometry.userData.base;
      for (let i = 0; i < p.count; i++) {
        const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2];
        const depth = Math.min(1, Math.max(0, (GOAL_Z - z) / NET_D));
        const fall = Math.exp(-(((x - bulge.x) ** 2) + ((y - bulge.y) ** 2)) / 1.6);
        p.setXYZ(i, x, y, z - amp * fall * depth);
      }
      p.needsUpdate = true;
    });
    if (bulge.t > 2) {
      netMeshes.forEach(m => { m.geometry.attributes.position.array.set(m.geometry.userData.base); m.geometry.attributes.position.needsUpdate = true; });
      bulge = null;
    }
  }

  // ── The ball ─────────────────────────────────────────────────────────
  const BALL_R = 0.15;
  const ballTex = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#f7f7f7'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16181d';
    const pent = (cx, cy, r) => { g.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fill(); };
    for (let k = 0; k < 5; k++) { pent((k + 0.5) * w / 5, h * 0.3, 26); pent(k * w / 5, h * 0.7, 26); }
    g.fillRect(0, 0, w, 18); g.fillRect(0, h - 18, w, 18);
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.45 }));
  ball.castShadow = true;
  scene.add(ball);
  const ballState = { mode: 'feet', flight: null, vel: new THREE.Vector3() };

  // ── Confetti ─────────────────────────────────────────────────────────
  const CONFETTI_MAX = 900;
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.15), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONFETTI_MAX);
  const bits = [];
  for (let i = 0; i < CONFETTI_MAX; i++) {
    bits.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() });
    confetti.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    confetti.setColorAt(i, tmpC.set('#ffffff'));
  }
  scene.add(confetti);
  let confettiNext = 0;
  const CONFETTI_COLORS = ['#e5382f', '#ffffff', '#ffd23f', '#2fd07f', '#1f6fe5', '#ff7ac6'];
  function burst(at, count = 80, power = 6) {
    if (reduceMotion || !celebrationsOn) return;
    for (let n = 0; n < count; n++) {
      const b = bits[confettiNext]; const i = confettiNext;
      confettiNext = (confettiNext + 1) % CONFETTI_MAX;
      b.life = 2.6 + Math.random();
      b.p.copy(at);
      const a = Math.random() * Math.PI * 2, up = 0.55 + Math.random() * 0.6;
      b.v.set(Math.cos(a) * (1 - up) * power, up * power, Math.sin(a) * (1 - up) * power);
      b.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      b.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      confetti.setColorAt(i, tmpC.set(CONFETTI_COLORS[n % CONFETTI_COLORS.length]));
    }
    confetti.instanceColor.needsUpdate = true;
  }
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(1, 1, 1);
  function updateConfetti(dt) {
    for (let i = 0; i < CONFETTI_MAX; i++) {
      const b = bits[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.v.y -= 6.5 * dt; b.v.multiplyScalar(1 - 1.6 * dt);
      b.p.addScaledVector(b.v, dt);
      if (b.p.y < 0.02) { b.p.y = 0.02; b.v.set(0, 0, 0); b.w.multiplyScalar(0.9); }
      b.r.x += b.w.x * dt; b.r.y += b.w.y * dt; b.r.z += b.w.z * dt;
      tmpS.setScalar(b.life > 0 ? Math.min(1, b.life * 2) : 0);
      confetti.setMatrixAt(i, tmpM.compose(b.p, tmpQ.setFromEuler(b.r), tmpS));
    }
    confetti.instanceMatrix.needsUpdate = true;
  }

  // ── Flags (one per task), beside the path ─────────────────────────────
  const stripeTex = canvasTexture(8, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e5382f'; g.fillRect(0, (i * h) / 8, w, h / 8 + 1); } });
  const flagMats = { done: new THREE.MeshStandardMaterial({ color: '#2fd07f', side: THREE.DoubleSide, roughness: 0.6 }), next: new THREE.MeshStandardMaterial({ color: '#f6b93b', side: THREE.DoubleSide, roughness: 0.6, emissive: '#f6b93b', emissiveIntensity: 0.25 }), pending: new THREE.MeshStandardMaterial({ color: '#cfd6e2', side: THREE.DoubleSide, roughness: 0.6 }) };
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 128, (g, w) => {
      g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
      g.fillStyle = fg; g.font = '900 72px "Big Shoulders Display", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, w / 2 + 4);
    });
  }
  const flags = [];
  function buildFlags() {
    flags.forEach(f => scene.remove(f.group));
    flags.length = 0;
    tasks.forEach((t, i) => {
      const u = checkpointFrac(i, tasks.length);
      const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const group = new THREE.Group();
      group.position.copy(p).addScaledVector(side, 1.7);
      group.rotation.y = Math.atan2(tan.x, tan.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 8), new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 }));
      pole.position.y = 0.8; pole.castShadow = true; group.add(pole);
      // the cloth: a strip of columns tapering to a point, re-shaped every frame to wave
      const cols = 10, pos = new Float32Array((cols + 1) * 2 * 3), idx = [];
      for (let c = 0; c < cols; c++) { const a = c * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
      const cloth = new THREE.Mesh(geo, flagMats.pending); cloth.castShadow = true; group.add(cloth);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      badge.position.set(0, 2.15, 0); badge.scale.setScalar(0.55); group.add(badge);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), new THREE.MeshBasicMaterial({ color: '#f6b93b', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.03, 0); group.add(ring);
      ring.position.copy(new THREE.Vector3().copy(side).multiplyScalar(-1.7).applyAxisAngle(new THREE.Vector3(0, 1, 0), -group.rotation.y)).setY(0.03);
      scene.add(group);
      flags.push({ group, cloth, badge, ring, pop: 0, status: '', phase: Math.random() * 6 });
    });
  }
  function waveCloth(f, time) {
    const pos = f.cloth.geometry.attributes.position, cols = 10, len = 0.62;
    for (let c = 0; c <= cols; c++) {
      const x = (c / cols) * len, half = 0.21 * (1 - c / cols);
      const z = Math.sin(time * 7 + f.phase - x * 9) * 0.07 * (x / len);
      pos.setXYZ(c * 2, x, 1.38 + half, z); pos.setXYZ(c * 2 + 1, x, 1.38 - half, z);
    }
    pos.needsUpdate = true; f.cloth.geometry.computeVertexNormals(); f.cloth.geometry.computeBoundingSphere();
  }
  function refreshFlags() {
    const doneCount = tasks.filter(t => t.done).length;
    tasks.forEach((t, i) => {
      const f = flags[i];
      const status = t.done ? 'done' : i === doneCount ? 'next' : 'pending';
      if (f.status === status) return;
      f.status = status;
      f.cloth.material = flagMats[status];
      f.badge.material.map = status === 'done' ? badgeTexture('✓', '#2fd07f', '#06301b') : badgeTexture(String(i + 1), status === 'next' ? '#f6b93b' : '#e6ebf3', '#1b2234');
      f.badge.material.needsUpdate = true;
      f.ring.visible = status === 'next';
    });
  }

  // ── Characters ───────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  let player = null, gltfSource = null;
  const walls = []; // { taskIndex, defenders: [{obj, mixer, actions, home, aside}], lock, ring, cleared, t }

  function makeCharacter(source, kitHex, shirtHex) {
    const obj = source === gltfSource.scene ? source : SkeletonUtils.clone(gltfSource.scene);
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const recolored = mats.map(m => {
        const c = m.clone();
        if (m.name === 'Main') c.color.set(kitHex);
        if (m.name === 'Grey') c.color.set(shirtHex);
        return c;
      });
      o.material = Array.isArray(o.material) ? recolored : recolored[0];
    });
    const box = new THREE.Box3().setFromObject(obj);
    obj.scale.multiplyScalar(PLAYER_H / (box.max.y - box.min.y));
    const holder = new THREE.Group(); holder.add(obj); scene.add(holder);
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {};
    gltfSource.animations.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
    ['ThumbsUp', 'Jump', 'Wave', 'Yes'].forEach(n => { if (actions[n]) { actions[n].clampWhenFinished = true; actions[n].loop = THREE.LoopOnce; } });
    return { holder, obj, mixer, actions, current: null };
  }
  function play(ch, name, fade = 0.25, timeScale = 1) {
    const next = ch.actions[name];
    if (!next) return;
    next.timeScale = timeScale;
    if (ch.current === next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (ch.current) ch.current.fadeOut(fade);
    ch.current = next;
  }

  // The kick: there's no kick clip, so the leg is driven procedurally on top of
  // the animation. Which bone axis swings the foot forward is measured once on load.
  let kickBone = null, kickAxis = new THREE.Vector3(1, 0, 0), kickSign = 1;
  function calibrateKick(ch) {
    ch.obj.traverse(o => { if (o.isBone && /^UpperLeg\.?R$/.test(o.name)) kickBone = o; });
    if (!kickBone) return;
    let foot = kickBone;
    kickBone.traverse(o => { if (o.isBone && /^Foot/.test(o.name)) foot = o; });
    ch.mixer.update(0); ch.holder.updateMatrixWorld(true);
    const fwd = o => { const v = new THREE.Vector3(); o.getWorldPosition(v); return v.z; };
    const base = fwd(foot);
    let best = -Infinity;
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)].forEach(axis => [1, -1].forEach(sign => {
      const q = kickBone.quaternion.clone();
      kickBone.rotateOnAxis(axis, 0.8 * sign); ch.holder.updateMatrixWorld(true);
      const gain = fwd(foot) - base;
      kickBone.quaternion.copy(q); ch.holder.updateMatrixWorld(true);
      if (gain > best) { best = gain; kickAxis = axis; kickSign = sign; }
    }));
  }

  // ── Player state: walking the real curve, stopping at flags ───────────
  const P = {
    frac: 0, speed: 0, heading: 0, targetHeading: 0,
    stops: [],          // [{ frac, events: [fn], pause }]
    pauseLeft: 0, mode: 'idle', // idle | run | pause | shoot | celebrate
    shotT: 0, celebrateT: 0, scored: false,
  };
  const celebrated = new Set(tasks.filter(t => t.done).map(t => t.id));

  function standingWallLimit() {
    // A blocker literally blocks the path: you can't run past an un-cleared wall.
    let limit = 1;
    walls.forEach(w => { if (!w.cleared && !w.open) limit = Math.min(limit, wallFrac(w.taskIndex) - 0.012); });
    return limit;
  }
  function targetFrac() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    return Math.min(progressToFrac(done, n), standingWallLimit());
  }
  function allDone() { return tasks.every(t => t.done); }

  // An obstacle ticked off on a task that's still open: the player
  // dribbles up to its rivals and takes them on with a step-over (fn(true)
  // when there, then a pause for the skill), and dribbles back to the
  // flag. With another wall in the way or the shot under way, fn(false)
  // runs at once and the rivals just leave.
  const pendingEngage = [];
  let excursionBack = null;
  function engage(i, fn, pause) {
    if (reduceMotion || P.mode === 'shoot' || P.mode === 'celebrate' || P.scored) { fn(false); return; }
    if (P.mode !== 'idle') { pendingEngage.push({ i, fn, pause }); return; }
    const at = wallFrac(i) - 0.012;
    const inTheWay = walls.some(w => w.taskIndex !== i && !w.cleared && !w.clearing && !w.open
      && wallFrac(w.taskIndex) - 0.012 > P.frac + 1e-4 && wallFrac(w.taskIndex) - 0.012 < at - 1e-4);
    if (inTheWay || at < P.frac - 1e-4) { fn(false); return; }
    excursionBack = P.frac;
    P.stops = [{ frac: at, events: [{ fn: () => fn(true), raw: fn, kind: 'engage' }], pause }, { frac: P.frac, events: [], pause: 0 }];
    P.mode = 'run'; cam.goalTime = 0;
  }
  function plan() {
    // Mid-excursion: carry on if nothing else changed; otherwise the rivals
    // leave where they stand and the run is planned as usual.
    const engaging = P.stops.flatMap(s => s.events).filter(e => e.kind === 'engage');
    if (excursionBack !== null && (engaging.length || P.stops.length)) {
      const n0 = tasks.length, done0 = tasks.filter(t => t.done).length;
      let to0 = progressToFrac(done0, n0);
      walls.forEach(w => { if (!w.cleared && !w.clearing && !w.open) to0 = Math.min(to0, wallFrac(w.taskIndex) - 0.012); });
      const fresh = tasks.some(t => t.done !== celebrated.has(t.id));
      if (!fresh && Math.abs(to0 - excursionBack) < 1e-4) return;
      engaging.forEach(e => e.raw(false));
      P.stops = [];
    }
    excursionBack = null;
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
          // no stopping: the player dribbles straight through the rivals
          events.push({ frac: wallFrac(i) - 0.012, fn: () => clearWall(wall), pause: 0, kind: 'wall', wall, through: true });
        }
        events.push({ frac: checkpointFrac(i, n), fn: () => popFlag(i, t.title), pause: 0.8, kind: 'flag', taskId: t.id });
      }
      if (!t.done) {
        celebrated.delete(t.id);
        if (wall && (wall.cleared || wall.clearing)) restoreWall(wall);
      }
    });
    if (!allDone() && P.scored) undoGoal();

    // Celebrations still waiting on an interrupted run are kept if still valid.
    const carried = P.stops.flatMap(s => s.events).filter(e =>
      e.kind === 'wall' ? e.wall.clearing && !e.wall.cleared
        : e.kind === 'flag' ? !!(tasks.find(t => t.id === e.taskId) || {}).done : false);
    const all = carried.concat(events);

    // How far the player may go: k done → k-th flag, but never past a defender
    // wall whose task is still blocked (one that's about to clear is fine).
    let to = progressToFrac(done, n);
    walls.forEach(w => { if (!w.cleared && !w.clearing && !w.open) to = Math.min(to, wallFrac(w.taskIndex) - 0.012); });
    if (allDone() && !P.scored && Math.abs(to - progressToFrac(n, n)) < 1e-6) all.push({ frac: to, fn: startShot, pause: 0, kind: 'shot' });

    const from = P.frac, dir = to >= from ? 1 : -1;
    const moving = Math.abs(to - from) > 1e-4;
    const onRoute = e => moving && (dir > 0 ? e.frac > from + 1e-4 && e.frac <= to + 1e-4 : e.frac < from - 1e-4 && e.frac >= to - 1e-4);
    const stops = [];
    all.filter(onRoute).sort((a, b) => dir * (a.frac - b.frac)).forEach(e => {
      const last = stops[stops.length - 1];
      if (last && Math.abs(last.frac - e.frac) < 1e-3) { last.events.push(e); last.pause = Math.max(last.pause, e.pause); last.through = last.through && !!e.through; }
      else stops.push({ frac: e.frac, events: [e], pause: e.pause, through: !!e.through });
    });
    if (moving && (!stops.length || Math.abs(stops[stops.length - 1].frac - to) > 1e-3)) stops.push({ frac: to, events: [], pause: 0 });
    // the last stop is where the player ends up, so it's never run through
    if (stops.length) stops[stops.length - 1].through = false;
    P.stops = stops;
    if (moving) { P.mode = 'run'; cam.goalTime = 0; } else if (P.mode === 'run') P.mode = 'idle';
    all.filter(e => !onRoute(e)).forEach(e => e.fn());

    if (reduceMotion) {
      P.stops.forEach(s => { P.frac = s.frac; s.events.forEach(e => e.fn()); });
      P.stops = []; if (P.mode === 'run') P.mode = 'idle';
      placePlayer(true);
    }
  }

  // Completed task titles, floating above their flag — world positions
  // re-projected to screen space every frame (see updateTaskLabels) so
  // they track their flag as the follow-cam moves, instead of a position
  // computed once at spawn that drifts off as soon as the camera pans.
  const activeLabels = [];
  // A completed task's title over "COMPLETED!" (in orange), or with kind
  // 'foe' a ticked-off obstacle's name over "ELIMINATED!" (in green).
  function spawnTaskLabel(worldPos, text, kind = 'done') {
    if (!text) return;
    const label = text.length > 28 ? text.slice(0, 27) + '…' : text;
    const outer = document.createElement('div');
    outer.className = 'j3d-task-label ' + (kind === 'foe' ? 'j3d-task-label-foe' : 'j3d-task-label-done');
    const inner = document.createElement('div');
    inner.className = 'j3d-task-label-inner';
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
    burst(f.group.position.clone().setY(1.6), 70, 5);
    if (player && P.mode !== 'shoot') { play(player, 'ThumbsUp', 0.2); }
    if (title) spawnTaskLabel(f.group.position.clone().setY(2.6), title);
  }

  // ── Defender walls (blocked tasks) ────────────────────────────────────
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6157'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  function buildWalls() {
    walls.forEach(w => { w.defenders.forEach(d => scene.remove(d.holder)); scene.remove(w.lock, w.ring, w.tag); });
    walls.length = 0;
    let budget = 12; // each defender is a skinned model; keep the cost bounded
    tasks.forEach((t, i) => {
      if (!t.foeList.length) return;
      const u = wallFrac(i), p = curve.getPointAt(u), tan = curve.getTangentAt(u);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const face = Math.atan2(-tan.x, -tan.z);
      // One rival per obstacle point, in rows of up to three across the
      // path, each row a step further toward the flag.
      const n = Math.max(0, Math.min(t.foeList.length, 5, budget));
      budget -= n;
      const owners = pickFoes(t.foeList, n);
      const defenders = Array.from({ length: n }, (_, k) => {
        const row = Math.floor(k / 3), inRow = Math.min(3, n - row * 3), col = k % 3;
        const o = (col - (inRow - 1) / 2) * 1.05;
        const d = makeCharacter(null, '#1f6fe5', '#eef2f7');
        const home = p.clone().addScaledVector(side, o + (row % 2 ? 0.5 : 0)).addScaledVector(tan, row * 1.3);
        const out = o === 0 ? (k % 2 ? -1 : 1) : Math.sign(o);
        const aside = home.clone().addScaledVector(side, out * (3.2 + Math.abs(o)));
        d.holder.position.copy(home); d.holder.rotation.y = face;
        play(d, 'Idle', 0); d.mixer.update(Math.random() * 2);
        // owner: the obstacle this rival stands for; gone once it's ticked off
        const gone = owners[k].resolved;
        if (gone) { d.holder.position.copy(aside); d.holder.visible = false; }
        return Object.assign(d, { home, aside, face, k, delay: k * 0.22, jumped: gone, owner: owners[k].id, gone, goneT: gone ? 99 : 0 });
      });
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.copy(p).setY(2.6); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
      tag.position.copy(p).setY(3.2); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.2, 48), new THREE.MeshBasicMaterial({ color: '#ff6157', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(p).setY(0.04); scene.add(ring);
      const w = { taskIndex: i, defenders, lock, tag, ring, cleared: !!t.done, t: t.done ? 99 : 0, open: !t.foes, fade: t.done || !t.foes ? 1 : 0, at: p.clone() };
      // Already-done obstacles start cleared: their rivals aren't on the pitch.
      if (w.cleared) { defenders.forEach(d => { d.holder.position.copy(d.aside); d.holder.visible = false; d.jumped = true; }); lock.visible = tag.visible = ring.visible = false; }
      walls.push(w);
    });
  }
  // Dribbling past: the player weaves through with the ball (see
  // dribbleOffset) as the rivals leap aside one after another.
  function clearWall(w) {
    if (w.cleared) return;
    w.cleared = true; w.t = 0;
    if (!reduceMotion) dribble.wall = w;
    burst(w.lock.position.clone(), 40, 4);
    notify();
  }
  function restoreWall(w) {
    w.cleared = false; w.clearing = false; w.t = 0;
    w.defenders.forEach(d => { if (!d.gone) reviveDefender(d); });
  }
  function reviveDefender(d) {
    d.gone = false; d.holder.visible = true; d.jumped = false;
    d.holder.position.copy(d.home); d.holder.rotation.y = d.face; play(d, 'Idle', 0.2);
  }
  // Swaps a wall's red tag for one naming only what's still pending.
  function retagWall(w) {
    const t = tasks[w.taskIndex];
    const tag = nameTagSprite(t.foes ? tagText(t) : 'Clear');
    tag.position.copy(w.tag.position); tag.material.opacity = w.tag.material.opacity; tag.visible = w.tag.visible;
    scene.remove(w.tag); w.tag.material.map.dispose(); w.tag.material.dispose();
    scene.add(tag); w.tag = tag;
  }
  // An obstacle ticked off (or unticked) on its own: the player dribbles up
  // and beats its rivals (see engageResolved), or they come back, and its
  // name pops up over the wall.
  function applyResolves(changes) {
    const engaging = [];
    changes.forEach((c, j) => {
      const w = walls.find(x => x.taskIndex === c.index);
      const at = w ? w.at.clone() : curve.getPointAt(wallFrac(c.index));
      const label = c.resolved ? () => spawnTaskLabel(at.clone().setY(3.8), c.name, 'foe') : null;
      const now = () => { if (label) { timers.push(setTimeout(label, j * 450)); peek.at.copy(at); peek.t = 3.4; } };
      let engagedHere = false;
      if (!w) { now(); return; }
      w.defenders.forEach(d => {
        if (d.owner !== c.id) return;
        if (c.resolved && !d.gone) {
          d.gone = true; d.goneT = 0; d.jumped = false;
          if (!reduceMotion && !w.cleared && d.holder.visible) { d.goneT = -1e9; engaging.push({ w, d, label: engagedHere ? null : label }); engagedHere = true; }
        } else if (!c.resolved && d.gone && !w.cleared) reviveDefender(d);
        else if (!c.resolved) d.gone = false;
      });
      if (!engagedHere) now();
    });
    walls.forEach(w => { w.open = !tasks[w.taskIndex].foes; });
    new Set(changes.map(c => c.index)).forEach(i => { const w = walls.find(x => x.taskIndex === i); if (w) retagWall(w); });
    engageResolved(engaging);
  }
  // The player dribbles up to a ticked-off obstacle's rivals, beats them
  // with a step-over each (they leap aside as it happens), then heads back.
  function engageResolved(list) {
    const byWall = new Map();
    list.forEach(e => { if (!byWall.has(e.w)) byWall.set(e.w, []); byWall.get(e.w).push(e); });
    byWall.forEach((items, w) => engage(w.taskIndex, near => {
      items.forEach((e, k) => { e.d.goneT = near ? -0.25 - k * 0.55 : 0; });
      if (near) { dribble.feint = { t: 0, n: items.length }; play(player, 'Running', 0.15, 1.3); }
      items.filter(e => e.label).forEach((e, k) => timers.push(setTimeout(e.label, k * 450 + (near ? 300 : 0))));
      peek.at.copy(w.at); peek.t = 3.4;
    }, 0.6 + 0.55 * items.length));
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      w.defenders.forEach(d => { if (d.holder.visible) d.mixer.update(dt); });
      if (w.cleared && w.t <= 60) w.t += dt;
      w.defenders.forEach(d => {
        // a rival whose own obstacle was ticked off runs its own clock;
        // the rest go when the whole wall clears
        let local;
        if (d.gone) { if (d.goneT > 60) return; d.goneT += dt; local = d.goneT; }
        else if (w.cleared) { if (w.t > 60) return; local = w.t - d.delay; }
        else return;
        if (!d.jumped && local >= 0) { d.jumped = true; play(d, 'Jump', 0.1); }
        const k = Math.min(1, Math.max(0, local / 0.75));
        d.holder.position.lerpVectors(d.home, d.aside, 1 - Math.pow(1 - k, 3));
        if (k >= 1 && d.current === d.actions.Jump && !d.actions.Jump.isRunning()) play(d, 'Idle', 0.3);
        // ticked-off rivals leave the pitch in a puff once they've landed
        if (d.gone && local >= 1.1 && d.holder.visible) { d.holder.visible = false; burst(d.holder.position.clone().setY(0.8), 24, 3); }
      });
      // the lock, tag and ring fade out once nothing is left blocking
      const shut = !w.cleared && !w.open;
      w.fade = THREE.MathUtils.clamp(w.fade + (shut ? -dt : dt) / 0.75, 0, 1);
      const e = w.fade;
      w.lock.material.opacity = 1 - e; w.tag.material.opacity = 1 - e;
      w.ring.material.opacity = (shut ? 0.35 + 0.25 * Math.sin(time * 4) : 0.55) * (1 - e);
      w.lock.visible = w.tag.visible = w.ring.visible = e < 1;
      if (shut) w.lock.position.y = 2.6 + Math.sin(time * 2.2) * 0.08;
    });
  }

  // ── Shot + celebration (all tasks done) ───────────────────────────────
  function startShot() {
    if (P.scored) return;
    if (reduceMotion) {
      ballState.flight = { to: new THREE.Vector3(1.9, BALL_R, GOAL_Z - NET_D + 0.3) };
      ball.position.copy(ballState.flight.to);
      scored();
      return;
    }
    P.mode = 'shoot'; P.shotT = 0;
    play(player, 'Idle', 0.2, 0.6);
  }
  function launchBall() {
    // Aim inside the net: just in front of the sloped back sheet at this height.
    const ty = 1.15, tz = GOAL_Z - NET_D + NET_D * (ty / GOAL_H) + 0.22;
    const target = new THREE.Vector3(1.9, ty, tz);
    ballState.mode = 'flight';
    ballState.flight = { t: 0, from: ball.position.clone(), to: target, dur: 0.62 };
  }
  function scored() {
    P.scored = true;
    bulge = { t: 0, x: ballState.flight.to.x, y: ballState.flight.to.y };
    ballState.mode = 'net'; ballState.vel.set(-0.6, 0, 0.8);
    if (celebrationsOn) {
      goalOverlay.hidden = false;
      const span = goalOverlay.firstChild; span.style.animation = 'none'; void span.offsetWidth; span.style.animation = '';
      timers.push(setTimeout(() => { goalOverlay.hidden = true; }, 2700));
      cheer = 1;
    }
    burst(new THREE.Vector3(0, 2.6, GOAL_Z - 0.5), 160, 8);
    burst(new THREE.Vector3(-HALF_W, 0.5, GOAL_Z + 2), 120, 11);
    burst(new THREE.Vector3(HALF_W, 0.5, GOAL_Z + 2), 120, 11);
    if (!reduceMotion) { P.mode = 'celebrate'; P.celebrateT = 0; play(player, 'Dance', 0.3); }
    if (celebrationsOn) cam.goalTime = 6.2;
    notify();
    // Let the shot/net/GOAL! moment actually land on screen before the
    // app's own "Project Complete" modal shows up over it.
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; setTimeout(cb, celebrationsOn ? 1800 : 0); }
  }
  function undoGoal() {
    P.scored = false; ballState.mode = 'feet'; bulge = null; cam.goalTime = 0;
    if (player) ball.position.copy(player.holder.position).setY(BALL_R);
    netMeshes.forEach(m => { m.geometry.attributes.position.array.set(m.geometry.userData.base); m.geometry.attributes.position.needsUpdate = true; });
  }

  // ── Placement helpers ────────────────────────────────────────────────
  const tmpV = new THREE.Vector3(), tmpT = new THREE.Vector3();
  // The dribble: running through a cleared wall the player weaves left
  // and right round the rivals (a slalom over DRIBBLE_LEN metres from just
  // before the wall), and a step-over feint (side-step and back) beats a
  // ticked-off rival. Both are sideways offsets from the path; the ball
  // follows the feet, so it weaves too.
  const DRIBBLE_LEN = 6.5;
  const dribble = { wall: null, feint: null, offset: 0 };
  function dribbleOffset(dt) {
    let off = 0;
    if (dribble.wall) {
      const sM = (P.frac - (wallFrac(dribble.wall.taskIndex) - 0.03)) * curveLen;
      if (sM > 0 && sM < DRIBBLE_LEN) off = Math.sin((sM / DRIBBLE_LEN) * Math.PI * 2) * 0.95 * Math.sin((sM / DRIBBLE_LEN) * Math.PI);
      else if (sM >= DRIBBLE_LEN || P.mode !== 'run') dribble.wall = null;
    }
    if (dribble.feint) {
      const f = dribble.feint; f.t += dt;
      const each = 0.55, k = f.t / each, i = Math.floor(k);
      if (i >= f.n) dribble.feint = null;
      else off = Math.sin((k - i) * Math.PI) * 0.8 * (i % 2 ? -1 : 1);
    }
    return off;
  }
  function placePlayer(snapHeading, dt = 0) {
    const p = curve.getPointAt(THREE.MathUtils.clamp(P.frac, 0, 1));
    player.holder.position.copy(p);
    const off = dribbleOffset(dt);
    if (off || dribble.offset) {
      const t = curve.getTangentAt(THREE.MathUtils.clamp(P.frac, 0, 1));
      player.holder.position.x += t.z * off; player.holder.position.z -= t.x * off;
      // lean the heading into each cut
      if (dt > 0 && P.mode === 'run') P.heading += Math.atan2(off - dribble.offset, Math.max(0.05, P.speed * dt)) * 0.12;
    }
    dribble.offset = off;
    if (snapHeading) {
      const t = curve.getTangentAt(THREE.MathUtils.clamp(P.frac, 0, 1));
      P.heading = P.targetHeading = Math.atan2(t.x, t.z);
    }
    player.holder.rotation.y = P.heading;
  }
  const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

  let rolled = 0;
  function updateBall(dt) {
    if (ballState.mode === 'feet') {
      const fwd = tmpV.set(Math.sin(P.heading), 0, Math.cos(P.heading));
      const target = tmpT.copy(player.holder.position).addScaledVector(fwd, 0.55 + (P.mode === 'run' ? Math.sin(rolled * 2.2) * 0.12 : 0)).setY(BALL_R);
      const moved = ball.position.distanceTo(target);
      ball.position.lerp(target, Math.min(1, dt * 14));
      if (moved > 1e-4 && moved < 2) {
        const axis = new THREE.Vector3(fwd.z, 0, -fwd.x).normalize();
        ball.rotateOnWorldAxis(axis, moved / BALL_R);
        rolled += moved;
      }
    } else if (ballState.mode === 'flight') {
      const f = ballState.flight; f.t += dt / f.dur;
      const t = Math.min(1, f.t);
      const mid = new THREE.Vector3().lerpVectors(f.from, f.to, 0.5).setY(Math.max(f.from.y, f.to.y) + 1.3);
      ball.position.set(
        (1 - t) ** 2 * f.from.x + 2 * (1 - t) * t * mid.x + t * t * f.to.x,
        (1 - t) ** 2 * f.from.y + 2 * (1 - t) * t * mid.y + t * t * f.to.y,
        (1 - t) ** 2 * f.from.z + 2 * (1 - t) * t * mid.z + t * t * f.to.z,
      );
      ball.rotateX(-dt * 28);
      if (t >= 1) scored();
    } else if (ballState.mode === 'net') {
      const v = ballState.vel; v.y -= 9.8 * dt;
      ball.position.addScaledVector(v, dt);
      if (ball.position.y < BALL_R) { ball.position.y = BALL_R; v.y = Math.abs(v.y) * 0.45; v.x *= 0.8; v.z *= 0.8; if (v.y < 0.4) v.y = 0; }
      ball.position.z = THREE.MathUtils.clamp(ball.position.z, GOAL_Z - NET_D + BALL_R, GOAL_Z - 0.4);
      ball.position.x = THREE.MathUtils.clamp(ball.position.x, -GOAL_HALF + BALL_R, GOAL_HALF - BALL_R);
      ball.rotateZ(v.x * dt * 3);
    }
  }

  let kickSaved = null;
  function updatePlayer(dt) {
    if (!player) return;
    // Undo last frame's procedural kick before the animation poses the leg again,
    // so the extra rotation never accumulates.
    if (kickSaved) { kickBone.quaternion.copy(kickSaved); kickSaved = null; }
    player.mixer.update(dt);
    const stop = P.stops[0];
    if (P.mode === 'run' && stop) {
      const dir = Math.sign(stop.frac - P.frac);
      const distM = Math.abs(stop.frac - P.frac) * curveLen;
      // brake only for a stop the player actually stops at
      const halt = P.stops.find(s => !s.through) || stop;
      const brake = Math.sqrt(2 * 7 * Math.abs(halt.frac - P.frac) * curveLen) + 0.3;
      P.speed = Math.min(RUN_SPEED, P.speed + 9 * dt, brake);
      const stepM = Math.min(distM, P.speed * dt);
      P.frac += dir * (stepM / curveLen);
      const t = curve.getTangentAt(THREE.MathUtils.clamp(P.frac, 0, 1));
      P.targetHeading = Math.atan2(t.x * dir, t.z * dir);
      P.heading = angleLerp(P.heading, P.targetHeading, Math.min(1, dt * 10));
      if (P.speed > 0.4) play(player, 'Running', 0.2, Math.max(0.6, P.speed / RUN_SPEED) * (dribble.wall ? 1.25 : 1));
      placePlayer(false, dt);
      if (distM - stepM < 0.005 && stop.through) {
        P.frac = stop.frac;
        stop.events.forEach(e => e.fn());
        P.stops.shift();
      } else if (distM - stepM < 0.005) {
        P.frac = stop.frac; P.speed = 0; placePlayer(false, dt);
        stop.events.forEach(e => e.fn());
        P.stops.shift();
        if (P.mode === 'shoot') return;
        if (stop.pause > 0) { P.mode = 'pause'; P.pauseLeft = stop.pause; if (!player.current || player.current === player.actions.Running) play(player, 'Idle', 0.2); }
        else if (!P.stops.length) { P.mode = 'idle'; play(player, 'Idle', 0.3); }
      }
    } else if (P.mode === 'run' && !stop) {
      P.mode = 'idle'; play(player, 'Idle', 0.3);
    } else if (P.mode === 'pause') {
      P.pauseLeft -= dt;
      if (dribble.feint) {
        placePlayer(false, dt);
        if (!dribble.feint && player.current === player.actions.Running) play(player, 'Idle', 0.2);
      }
      if (P.pauseLeft <= 0) P.mode = P.stops.length ? 'run' : 'idle';
    } else if (P.mode === 'shoot') {
      P.shotT += dt;
      const toGoal = Math.atan2(0 - player.holder.position.x, GOAL_Z - player.holder.position.z);
      P.heading = angleLerp(P.heading, toGoal, Math.min(1, dt * 6));
      player.holder.rotation.y = P.heading;
      // wind up 0.45–0.75s, strike 0.75–0.87s, follow through after
      const t = P.shotT;
      let ang = 0;
      if (t > 0.45 && t <= 0.75) ang = -0.75 * ((t - 0.45) / 0.3);
      else if (t > 0.75 && t <= 0.87) ang = -0.75 + 2.05 * ((t - 0.75) / 0.12);
      else if (t > 0.87) ang = 1.3 * Math.max(0, 1 - (t - 0.87) / 0.45);
      if (kickBone && ang) { kickSaved = kickBone.quaternion.clone(); kickBone.rotateOnAxis(kickAxis, ang * kickSign); }
      if (t > 0.8 && ballState.mode === 'feet') launchBall();
    } else if (P.mode === 'celebrate') {
      P.celebrateT += dt;
      if (cam.goalTime > 0 && cam.goalTime <= 4.6) {
        const face = Math.atan2(camera.position.x - player.holder.position.x, camera.position.z - player.holder.position.z);
        P.heading = angleLerp(P.heading, face, Math.min(1, dt * 4));
        player.holder.rotation.y = P.heading;
      }
      if (P.celebrateT > 5) { P.mode = 'idle'; play(player, 'Wave', 0.3); }
    } else if (P.mode === 'idle') {
      if (player.current && !player.current.isRunning()) play(player, 'Idle', 0.3);
      if (excursionBack !== null && !P.stops.length) excursionBack = null;
      if (pendingEngage.length) { const e = pendingEngage.shift(); engage(e.i, e.fn, e.pause); }
    }
  }

  // ── Camera: chase cam behind the player, overview, and a goal cam ─────
  const cam = { mode: 'follow', goalTime: 0, look: new THREE.Vector3(0, 1, 20) };
  const peek = { at: new THREE.Vector3(), t: 0 };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  function updateCamera(dt, time) {
    if (!player) return;
    const pp = player.holder.position;
    const fwd = new THREE.Vector3(Math.sin(P.heading), 0, Math.cos(P.heading));
    if (cam.goalTime > 4.6) {
      cam.goalTime -= dt;
      camDesired.set(pp.x + 3.2, 2.4, pp.z + 5.5);
      lookDesired.set(0, 1.1, GOAL_Z - 0.8);
    } else if (cam.goalTime > 0) {
      // celebration shot: in front of the player, looking back at them
      cam.goalTime -= dt;
      const toGoal = new THREE.Vector3(0 - pp.x, 0, GOAL_Z - pp.z).normalize();
      const perp = new THREE.Vector3(toGoal.z, 0, -toGoal.x);
      camDesired.copy(pp).addScaledVector(toGoal, 4.4).addScaledVector(perp, 2.2).setY(1.8);
      lookDesired.copy(pp).setY(1.05);
    } else if (cam.mode === 'overview') {
      camDesired.set(30, 34, 26);
      lookDesired.set(0, 0, -2);
    } else {
      const orbit = P.mode === 'idle' ? Math.sin(time * 0.25) * 1.6 : 0;
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      camDesired.copy(pp).addScaledVector(fwd, -6.5).addScaledVector(side, 1.8 + orbit).setY(3.4);
      lookDesired.copy(pp).addScaledVector(fwd, 3.5).setY(1.0);
      peekCamera(peek, pp, camDesired, lookDesired, dt);
    }
    const k = 1 - Math.exp(-dt * (cam.goalTime > 0 ? 2.2 : 3));
    camera.position.lerp(camDesired, k);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
  }

  // ── Crowd ─────────────────────────────────────────────────────────────
  function updateCrowd(dt, time) {
    if (reduceMotion) return;
    cheer = Math.max(0, cheer - dt * 0.18);
    const amp = 0.05 + cheer * 0.45, rate = 2.5 + cheer * 7;
    for (let i = 0; i < fanSpots.length; i++) {
      const p = fanSpots[i];
      const hop = Math.max(0, Math.sin(time * rate + fanPhase[i])) * amp;
      tmpM.makeTranslation(p.x, p.y + 0.4 + hop, p.z);
      fans.setMatrixAt(i, tmpM);
      tmpM.makeTranslation(p.x, p.y + 0.86 + hop, p.z);
      heads.setMatrixAt(i, tmpM);
    }
    fans.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  // ── Pace ghost (the app's "competitor" marker): a faded copy of the player
  // standing at the pace position, mapped onto the flags the same way.
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
    if (!gltfSource) return;
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) {
      ghost = makeCharacter(null, '#9aa5b1', '#cbd5e1');
      ghost.obj.traverse(o => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.transparent = true; m.opacity = 0.42; m.depthWrite = false; });
        o.castShadow = false;
      });
      play(ghost, 'Idle', 0);
    }
    const u = THREE.MathUtils.clamp(progressToPathFracSmooth(g.frac, tasks.length), 0, 1);
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    ghost.holder.visible = true;
    ghost.holder.position.copy(p).addScaledVector(new THREE.Vector3(-t.z, 0, t.x).normalize(), -0.9);
    ghost.holder.rotation.y = Math.atan2(t.x, t.z);
  }

  function updateLabel() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Football Journey: ${done} of ${n} tasks done.` : 'Football Journey: no tasks yet.';
    const blockedAhead = walls.find(w => !w.cleared && !w.clearing && !w.open && wallFrac(w.taskIndex) <= progressToFrac(done, n) + 1e-3);
    if (blockedAhead) text += ` Blocked by: ${tasks[blockedAhead.taskIndex].blocker}.`;
    if (n && done === n) text += P.scored ? ' Goal scored!' : '';
    root.setAttribute('aria-label', text);
  }

  // ── State from the app ───────────────────────────────────────────────
  let latestState = null, layoutSig = null;
  const toTasks = stageTasks;
  function applyState(state) {
    const next = toTasks(state);
    // Which tasks exist, in what order, and which are blocked decides where
    // flags and walls stand. When that changes, rebuild and place the player
    // directly; otherwise only statuses changed, and the player runs.
    const sig = layoutSignature(next);
    const structural = sig !== layoutSig;
    if (structural) {
      const firstBuild = layoutSig === null;
      layoutSig = sig;
      tasks = next;
      // A rebuild places everything directly, so nothing already done replays.
      celebrated.clear();
      tasks.forEach(t => { if (t.done) celebrated.add(t.id); });
      P.stops = []; P.speed = 0; P.mode = 'idle'; cam.goalTime = 0; pendingEngage.length = 0; excursionBack = null; dribble.wall = dribble.feint = null;
      buildFlags(); buildWalls(); refreshFlags();
      P.frac = targetFrac(); placePlayer(true); play(player, 'Idle', 0.2);
      if (allDone() && tasks.length) {
        // Already finished: show the result, don't replay the shot on load.
        P.scored = true; ballState.mode = 'net';
        ball.position.set(1.9, BALL_R, GOAL_Z - NET_D + 0.35);
        P.heading = Math.atan2(0 - player.holder.position.x, GOAL_Z - player.holder.position.z);
        player.holder.rotation.y = P.heading;
      } else {
        P.scored = false; ballState.mode = 'feet';
        ball.position.copy(player.holder.position).add(new THREE.Vector3(Math.sin(P.heading), 0, Math.cos(P.heading)).multiplyScalar(0.55)).setY(BALL_R);
      }
      if (firstBuild) snapCamera();
    } else {
      const changes = resolveChanges(tasks, next);
      next.forEach((t, i) => { tasks[i].done = t.done; tasks[i].title = t.title; tasks[i].blocker = t.blocker; tasks[i].foes = t.foes; tasks[i].foeList = t.foeList; });
      if (changes.length) applyResolves(changes);
      refreshFlags();
      plan();
    }
    updateGhost(state.ghost);
    updateLabel();
    onSummitCb = state.onSummit || null;
  }
  function snapCamera() {
    const fwd = new THREE.Vector3(Math.sin(P.heading), 0, Math.cos(P.heading));
    camera.position.copy(player.holder.position).addScaledVector(fwd, -6.5).setY(3.4);
    cam.look.copy(player.holder.position).addScaledVector(fwd, 3.5).setY(1);
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
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  const clock = new THREE.Clock();
  let simTime = 0, running = false, destroyed = false;
  function simulate(dt, time) {
    updatePlayer(dt);
    updateBall(dt);
    updateWalls(dt, time);
    updateNet(dt);
    updateConfetti(dt);
    updateCrowd(dt, time);
    flags.forEach(f => {
      waveCloth(f, time);
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); const s = 1 + Math.sin((1 - f.pop) * Math.PI) * 0.45; f.group.scale.setScalar(s); }
      if (f.ring.visible) { const s = 1 + 0.15 * Math.sin(time * 4); f.ring.scale.setScalar(s); f.ring.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); }
    });
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
    updateCamera(dt, time);
    updateTaskLabels();
  }
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    simTime += dt;
    simulate(dt, simTime);
    renderer.render(scene, camera);
  }
  function start() { if (running || destroyed || !player) return; running = true; clock.getDelta(); renderer.setAnimationLoop(frame); }
  function stop() { running = false; renderer.setAnimationLoop(null); }

  loader.load(MODEL_URL, gltf => {
    if (destroyed) return;
    ledBoard(0, -HALF_L - 2.2, 26, 0); ledBoard(0, HALF_L + 2.2, 40, Math.PI);
    ledBoard(-HALF_W - 2.2, 0, 56, Math.PI / 2); ledBoard(HALF_W + 2.2, 0, 56, -Math.PI / 2);
    gltfSource = gltf;
    player = makeCharacter(gltf.scene, '#e5382f', '#f2f4f8');
    calibrateKick(player);
    play(player, 'Idle', 0);
    loadingEl.hidden = true;
    if (latestState) applyState(latestState);
    start();
  }, undefined, () => {
    loadingEl.textContent = 'Couldn’t load the 3D player. Switch the scene to Football for the 2D version.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (player) applyState(state);
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
          m.dispose();
        });
      });
      if (scene.background && scene.background.isTexture) scene.background.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
      if (container.parentElement) container.parentElement.style.background = '';
    },
    // For automated checks.
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) { simTime += 1 / 30; simulate(1 / 30, simTime); } },
      get state() {
        return {
          ready: !!player, frac: P.frac, mode: P.mode, scored: P.scored, ball: ballState.mode, stops: P.stops.length,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)), walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared, defenders: w.defenders.length, gone: w.defenders.filter(d => d.gone).length, open: !!w.open })),
          ghost: ghost ? ghost.holder.visible : false, label: root.getAttribute('aria-label'),
          onPath: player ? (() => { let d = 1e9; for (let i = 0; i <= 400; i++) d = Math.min(d, curve.getPointAt(i / 400).distanceTo(player.holder.position)); return d; })() : null,
        };
      },
    },
  };
}
