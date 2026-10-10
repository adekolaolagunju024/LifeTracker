// ── JOURNEY 3D KIT ─────────────────────────────────────────────────────
// Shared pieces for the 3D Journey stages that came after Football and
// Castle (Ocean 3D, Space 3D): the DOM shell around the canvas (loading
// note, camera switch, finish banner, completed-task popups), the render
// loop and sizing, a small particle system, animation helpers, and the
// "walker" that moves the avatar along the stage's curve — stopping at each
// task's checkpoint, at obstacles for blocked tasks until they're done, and
// starting the stage's finale when every task is done.
//
// Each stage module builds its own world and avatar and passes hooks in;
// app.js's sync() contract is unchanged (see journey3d.js).
import * as THREE from 'three';

function injectKitStyles() {
  if (document.getElementById('journey3d-kit-styles')) return;
  const style = document.createElement('style');
  style.id = 'journey3d-kit-styles';
  style.textContent = `
    .jk-root { position: absolute; inset: 0; overflow: hidden; }
    .jk-root canvas { display: block; width: 100%; height: 100%; touch-action: pan-y; }
    .jk-cam { position: absolute; top: 10px; right: 10px; display: flex; padding: 3px; border-radius: 999px;
      background: rgba(8,14,30,.78); border: 1px solid rgba(214,226,255,.18); z-index: 2; }
    .jk-cam button { font: 600 12px system-ui, sans-serif; color: #b6c2d6; background: transparent; border: 0;
      border-radius: 999px; padding: 7px 11px; cursor: pointer; min-height: 30px; }
    .jk-cam button[aria-pressed="true"] { background: #f3f6fc; color: #0a1220; }
    .jk-cam button:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }
    .jk-win { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 3; text-align: center; padding: 0 12px; }
    .jk-win[hidden] { display: none; }
    .jk-win div { animation: jk-win-pop 4.2s cubic-bezier(.2,1.3,.4,1) both; }
    .jk-win strong { display: block; font: 900 clamp(30px, 7vw, 76px) "Arial Black", Impact, sans-serif; letter-spacing: .03em; line-height: 1;
      color: var(--jk-win-fill, #ffe39a); -webkit-text-stroke: 1.5px var(--jk-win-edge, #6b3a07);
      text-shadow: 0 4px 0 var(--jk-win-edge, #6b3a07), 0 12px 34px rgba(0,0,0,.6); text-transform: uppercase; }
    .jk-win span { display: block; margin-top: 8px; font: 700 clamp(13px, 2.4vw, 20px) system-ui, sans-serif; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,.75); }
    @keyframes jk-win-pop { 0% { transform: scale(.3); opacity: 0; } 12% { transform: scale(1.08); opacity: 1; } 22% { transform: scale(1); } 85% { opacity: 1; } 100% { transform: translateY(-12px); opacity: 0; } }
    .jk-loading { position: absolute; inset: 0; display: grid; place-items: center; color: #b6c2d6; font: 600 14px system-ui, sans-serif; z-index: 1; text-align: center; padding: 0 16px; }
    .jk-loading[hidden] { display: none; }
    .jk-labels { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
    .jk-task-label { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); }
    .jk-task-label-inner { display: block; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;
      background: rgba(255,255,255,.96); color: #1f2937; font: 800 13px system-ui, sans-serif; padding: 5px 10px; border-radius: 999px;
      box-shadow: 0 2px 6px rgba(0,0,0,.35); animation: jk-label-pop 2.2s ease-out both; }
    @keyframes jk-label-pop {
      0% { opacity: 0; transform: translateY(6px) scale(.85); }
      12% { opacity: 1; transform: translateY(0) scale(1); }
      72% { opacity: 1; transform: translateY(-4px) scale(1); }
      100% { opacity: 0; transform: translateY(-26px) scale(.96); }
    }
    @media (prefers-reduced-motion: reduce) { .jk-win div, .jk-task-label-inner { animation: none; } }
  `;
  document.head.appendChild(style);
}

// The DOM and renderer around a stage: a root element filling the
// container, the WebGL canvas, a loading note, a Follow/Overview camera
// switch, a finish banner, and completed-task popups that track a world
// position. Throws if WebGL can't start (journeyGame.js falls back to 2D).
export function createShell(container, { label, background, loadingText, winTitle, winText, winFill, winEdge }) {
  injectKitStyles();
  const root = document.createElement('div');
  root.className = 'jk-root';
  root.style.background = background;
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', label);
  const loadingEl = document.createElement('div');
  loadingEl.className = 'jk-loading';
  loadingEl.textContent = loadingText;
  const cam = { mode: 'follow' };
  const camBar = document.createElement('div');
  camBar.className = 'jk-cam';
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
  const labelLayer = document.createElement('div');
  labelLayer.className = 'jk-labels';
  const winEl = document.createElement('div');
  winEl.className = 'jk-win'; winEl.hidden = true;
  if (winFill) winEl.style.setProperty('--jk-win-fill', winFill);
  if (winEdge) winEl.style.setProperty('--jk-win-edge', winEdge);
  const inner = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = winTitle;
  const span = document.createElement('span'); span.textContent = winText;
  inner.append(strong, span); winEl.appendChild(inner);
  root.append(loadingEl, camBar, labelLayer, winEl);
  container.appendChild(root);
  if (container.parentElement) container.parentElement.style.background = background;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.insertBefore(renderer.domElement, loadingEl);

  const timers = [];
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function showWin() {
    winEl.hidden = false;
    inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = '';
    timers.push(setTimeout(() => { winEl.hidden = true; }, 4300));
  }

  // Completed task titles float above their checkpoint, re-projected to
  // the screen every frame so they stay put as the camera moves.
  const activeLabels = [];
  function spawnTaskLabel(worldPos, text) {
    if (!text) return;
    const outer = document.createElement('div');
    outer.className = 'jk-task-label';
    const li = document.createElement('div');
    li.className = 'jk-task-label-inner';
    li.textContent = text.length > 28 ? text.slice(0, 27) + '…' : text;
    outer.appendChild(li);
    labelLayer.appendChild(outer);
    const rec = { el: outer, pos: worldPos.clone() };
    activeLabels.push(rec);
    timers.push(setTimeout(() => {
      outer.remove();
      const idx = activeLabels.indexOf(rec);
      if (idx >= 0) activeLabels.splice(idx, 1);
    }, 2200));
  }
  const tmp = new THREE.Vector3();
  function updateTaskLabels(camera) {
    if (!activeLabels.length) return;
    const w = root.clientWidth, h = root.clientHeight;
    activeLabels.forEach(rec => {
      const v = tmp.copy(rec.pos).project(camera);
      rec.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
      rec.el.style.top = ((1 - (v.y * 0.5 + 0.5)) * h) + 'px';
      rec.el.style.opacity = v.z > 1 ? '0' : '1';
    });
  }

  return { root, loadingEl, cam, winEl, renderer, timers, reduceMotion, showWin, spawnTaskLabel, updateTaskLabels };
}

// Sizes the renderer to the shell's own root (not the container, whose
// layout classes may not have applied yet), and runs the frame loop.
export function createLoop(shell, camera, scene, step, onResize) {
  const { root, renderer } = shell;
  function resize() {
    const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 62 : 50;
    camera.updateProjectionMatrix();
    if (onResize) onResize(w, h);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();
  const clock = new THREE.Clock();
  let running = false, destroyed = false, ready = false;
  function frame() {
    step(Math.min(clock.getDelta(), 1 / 20));
    renderer.render(scene, camera);
  }
  const loop = {
    resize,
    setReady() { ready = true; },
    start() { if (running || destroyed || !ready) return; running = true; clock.getDelta(); renderer.setAnimationLoop(frame); },
    stop() { running = false; renderer.setAnimationLoop(null); },
    destroy(container) {
      destroyed = true;
      loop.stop();
      ro.disconnect();
      shell.timers.forEach(clearTimeout);
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(m => {
          Object.values(m).forEach(v => { if (v && v.isTexture) v.dispose(); });
          if (m.uniforms) Object.values(m.uniforms).forEach(u => { if (u && u.value && u.value.isTexture) u.value.dispose(); });
          m.dispose();
        });
      });
      if (scene.background && scene.background.isTexture) scene.background.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
      if (container.parentElement) container.parentElement.style.background = '';
    },
    get destroyed() { return destroyed; },
  };
  return loop;
}

export function makeCanvasTexture(renderer) {
  return function canvasTexture(w, h, draw, opts = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  };
}

// A seeded random source, so scenery lands in the same place every build.
export function seededRandom(seed = 7) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function softDotTexture(canvasTexture) {
  return canvasTexture(64, 64, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
}

// CPU-driven point sprites: size and colour (with alpha) per particle,
// fading in fast and out slowly, optionally through a three-stop colour ramp.
export class Particles {
  constructor(scene, max, { additive = true, map, scale }) {
    this.max = max; this.next = 0;
    this.items = Array.from({ length: max }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 1, s1: 1, c0: new THREE.Color(), c1: new THREE.Color(), c2: null, a: 1, g: 0, drag: 0 }));
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: map }, uScale: scale },
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
    this.tmp = new THREE.Color();
    scene.add(this.points);
  }
  emit(o) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.max;
    it.max = it.life = o.life; it.p.copy(o.pos); if (o.vel) it.v.copy(o.vel); else it.v.set(0, 0, 0);
    it.s0 = o.size[0]; it.s1 = o.size[1]; it.c0.set(o.color[0]); it.c1.set(o.color[1] ?? o.color[0]);
    it.c2 = o.color[2] ? (it.c2 || new THREE.Color()).set(o.color[2]) : null;
    it.a = o.alpha ?? 1; it.g = o.gravity ?? 0; it.drag = o.drag ?? 0;
  }
  update(dt) {
    const c = this.tmp;
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (it.life <= 0) { this.size[i] = 0; continue; }
      it.life -= dt;
      it.v.y -= it.g * dt; it.v.multiplyScalar(Math.max(0, 1 - it.drag * dt));
      it.p.addScaledVector(it.v, dt);
      const t = 1 - Math.max(0, it.life) / it.max;
      this.pos[i * 3] = it.p.x; this.pos[i * 3 + 1] = it.p.y; this.pos[i * 3 + 2] = it.p.z;
      this.size[i] = it.life > 0 ? it.s0 + (it.s1 - it.s0) * t : 0;
      if (it.c2) { if (t < 0.5) c.copy(it.c0).lerp(it.c1, t * 2); else c.copy(it.c1).lerp(it.c2, (t - 0.5) * 2); }
      else c.copy(it.c0).lerp(it.c1, t);
      const alpha = it.a * Math.min(1, t * 8) * Math.pow(1 - t, 1.3);
      this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = alpha;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = true;
  }
}
// The point-size scale for Particles: pixels per world unit at distance 1.
export function particleScaleFor(renderer, camera, heightPx) {
  return (heightPx * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

// ── Characters (rigged glTF + animation clips) ───────────────────────────
export function loadGLTF(loader, url) {
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}
export function makeCharacter(scene, obj, clips, height) {
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  const box = new THREE.Box3().setFromObject(obj);
  obj.scale.multiplyScalar(height / (box.max.y - box.min.y));
  const tilt = new THREE.Group(); tilt.add(obj);
  const holder = new THREE.Group(); holder.add(tilt); scene.add(holder);
  const mixer = new THREE.AnimationMixer(obj);
  const actions = {};
  clips.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
  return { holder, tilt, obj, mixer, actions, current: null };
}
export function play(ch, name, { fade = 0.25, timeScale = 1, once = false } = {}) {
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
export const finished = ch => !!ch.current && ch.current.loop === THREE.LoopOnce && !ch.current.isRunning();

// Re-dyes a character's texture atlas: `rule(h, s, l)` gets each pixel's
// hue (degrees), saturation and lightness and returns a new [h, s, l]
// (h in degrees) or null to leave it. Works on the gradient atlases the
// KayKit characters use.
export function recolorCharacter(obj, rule) {
  let mat = null;
  obj.traverse(o => { if (o.isMesh && !mat && o.material && o.material.map) mat = o.material; });
  if (!mat || !mat.map.image) return;
  const img = mat.map.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data, hsl = {}, col = new THREE.Color(), o = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < px.length; i += 4) {
    col.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
    const out = rule(hsl.h * 360, hsl.s, hsl.l);
    if (!out) continue;
    col.setHSL(((out[0] % 360) + 360) % 360 / 360, THREE.MathUtils.clamp(out[1], 0, 1), THREE.MathUtils.clamp(out[2], 0, 1), THREE.SRGBColorSpace).getRGB(o, THREE.SRGBColorSpace);
    px[i] = o.r * 255; px[i + 1] = o.g * 255; px[i + 2] = o.b * 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = mat.map.flipY; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = mat.map.wrapS; t.wrapT = mat.map.wrapT;
  t.magFilter = mat.map.magFilter; t.minFilter = mat.map.minFilter;
  const m2 = mat.clone(); m2.map = t;
  obj.traverse(o2 => { if (o2.isMesh && o2.material === mat) o2.material = m2; });
}
export function findBone(obj, name) {
  let bone = null;
  obj.traverse(o => { if (!bone && o.isBone && o.name === name) bone = o; });
  return bone;
}
// Attaches `piece` (built in world units) to a bone at a world position.
export function attachToBone(obj, bone, piece, worldPos) {
  obj.updateMatrixWorld(true);
  const ws = new THREE.Vector3(); bone.getWorldScale(ws);
  bone.add(piece);
  piece.position.copy(bone.worldToLocal(worldPos.clone()));
  piece.scale.setScalar(1 / ws.x);
}

// ── Progress → path position ──────────────────────────────────────────────
export const checkpointFracOf = (i, n) => (n > 1 ? 0.06 + (i / (n - 1)) * 0.86 : 0.5);
// k tasks done → stand at the k-th checkpoint (fractional for the pace ghost).
export function progressToPathFracSmooth(p, n) {
  if (!n) return 0;
  const knots = [[0, 0]];
  for (let k = 1; k <= n; k++) knots.push([k / n, checkpointFracOf(k - 1, n)]);
  const q = Math.max(0, Math.min(1, p));
  for (let j = 1; j < knots.length; j++) {
    const [p0, f0] = knots[j - 1], [p1, f1] = knots[j];
    if (q <= p1) return f0 + (f1 - f0) * ((q - p0) / ((p1 - p0) || 1));
  }
  return knots[knots.length - 1][1];
}
export const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// ── The walker ────────────────────────────────────────────────────────────
// Moves the avatar along `curve` the way every 3D stage does: k tasks done
// → the k-th checkpoint; an uncleared obstacle (a blocked task that isn't
// done) stops it short; tasks completed since the last sync get their
// celebrations on arrival, in path order; all done → the stage's finale.
//
// The stage supplies the obstacles list (objects with taskIndex, cleared,
// clearing) and hooks:
//   place(frac, moving)        put the avatar at frac (heading is in P)
//   runAnim(speedFrac)         moving animation
//   idleAnim()                 resting animation
//   onFlag(i, task)            arrived at a newly completed task
//   clearWall(w) / restoreWall(w)
//   stopFrac(i)                where to stop in front of task i's obstacle
//   startFinale() / undoFinale() / updateFinale(dt) / updateVictory(dt)
export function createWalker({ curve, speed = 4, accel = 9, brakeDecel = 7, reduceMotion, getTasks, walls, hooks }) {
  const curveLen = curve.getLength();
  const P = {
    frac: 0, speed: 0, heading: 0, pitch: 0, stops: [], pauseLeft: 0,
    mode: 'idle', // idle | run | pause | finale | victory
    finT: 0, won: false, fin: {},
  };
  const celebrated = new Set();
  const progressToFrac = (done, n) => (!n || done <= 0 ? 0 : checkpointFracOf(Math.min(done, n) - 1, n));
  const allDone = () => getTasks().every(t => t.done);
  function targetFrac() {
    const tasks = getTasks(), n = tasks.length, done = tasks.filter(t => t.done).length;
    let to = progressToFrac(done, n);
    walls.forEach(w => { if (!w.cleared) to = Math.min(to, hooks.stopFrac(w.taskIndex)); });
    return to;
  }
  function plan() {
    const tasks = getTasks();
    if (P.mode === 'finale' || P.mode === 'victory') {
      if (allDone()) return;
      hooks.undoFinale();
    }
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    const events = [];
    tasks.forEach((t, i) => {
      const wall = walls.find(w => w.taskIndex === i);
      if (t.done && !celebrated.has(t.id)) {
        celebrated.add(t.id);
        if (wall && !wall.cleared && !wall.clearing) {
          wall.clearing = true;
          events.push({ frac: hooks.stopFrac(i), fn: () => hooks.clearWall(wall), pause: 1.35, kind: 'wall', wall });
        }
        events.push({ frac: checkpointFracOf(i, n), fn: () => hooks.onFlag(i, t), pause: 0.9, kind: 'flag', taskId: t.id });
      }
      if (!t.done) {
        celebrated.delete(t.id);
        if (wall && (wall.cleared || wall.clearing)) hooks.restoreWall(wall);
      }
    });
    const carried = P.stops.flatMap(s => s.events).filter(e =>
      e.kind === 'wall' ? e.wall.clearing && !e.wall.cleared
        : e.kind === 'flag' ? !!(tasks.find(t => t.id === e.taskId) || {}).done : false);
    const all = carried.concat(events);
    let to = progressToFrac(done, n);
    walls.forEach(w => { if (!w.cleared && !w.clearing) to = Math.min(to, hooks.stopFrac(w.taskIndex)); });
    if (n && allDone() && !P.won && Math.abs(to - progressToFrac(n, n)) < 1e-6) all.push({ frac: to, fn: hooks.startFinale, pause: 0, kind: 'finale' });

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
    all.filter(e => !onRoute(e)).forEach(e => e.fn());
    if (reduceMotion) {
      P.stops.forEach(s => { P.frac = s.frac; s.events.forEach(e => e.fn()); });
      P.stops = []; if (P.mode === 'run') P.mode = 'idle';
      snapHeading(); hooks.place(P.frac, false);
    }
  }
  function snapHeading() {
    const t = curve.getTangentAt(THREE.MathUtils.clamp(P.frac, 0, 1));
    P.heading = Math.atan2(t.x, t.z);
    P.pitch = Math.asin(THREE.MathUtils.clamp(t.y, -1, 1));
  }
  function update(dt) {
    const stop = P.stops[0];
    if (P.mode === 'run' && stop) {
      const dir = Math.sign(stop.frac - P.frac);
      const distM = Math.abs(stop.frac - P.frac) * curveLen;
      const brake = Math.sqrt(2 * brakeDecel * distM) + 0.3;
      P.speed = Math.min(speed, P.speed + accel * dt, brake);
      const stepM = Math.min(distM, P.speed * dt);
      P.frac += dir * (stepM / curveLen);
      const t = curve.getTangentAt(THREE.MathUtils.clamp(P.frac, 0, 1));
      P.heading = angleLerp(P.heading, Math.atan2(t.x * dir, t.z * dir), Math.min(1, dt * 10));
      P.pitch += (Math.asin(THREE.MathUtils.clamp(t.y * dir, -1, 1)) - P.pitch) * Math.min(1, dt * 6);
      if (P.speed > 0.4) hooks.runAnim(P.speed / speed);
      hooks.place(P.frac, true);
      if (distM - stepM < 0.005) {
        P.frac = stop.frac; P.speed = 0; hooks.place(P.frac, false);
        P.stops.shift();
        stop.events.forEach(e => e.fn());
        if (P.mode === 'finale') return;
        if (stop.pause > 0) { P.mode = 'pause'; P.pauseLeft = stop.pause; hooks.idleAnim(true); }
        else if (!P.stops.length) { P.mode = 'idle'; hooks.idleAnim(false); }
      }
    } else if (P.mode === 'run' && !stop) {
      P.mode = 'idle'; hooks.idleAnim(false);
    } else if (P.mode === 'pause') {
      P.pauseLeft -= dt;
      hooks.place(P.frac, false);
      if (P.pauseLeft <= 0) P.mode = P.stops.length ? 'run' : 'idle';
    } else if (P.mode === 'finale') {
      hooks.updateFinale(dt);
    } else if (P.mode === 'victory') {
      hooks.updateVictory(dt);
    } else {
      hooks.place(P.frac, false);
      if (P.mode === 'idle') hooks.idleAnim(false, true);
    }
  }
  // A rebuild (tasks added/removed/reordered, blockers changed): jump
  // straight to the right place, with nothing already done replaying.
  function reset() {
    const tasks = getTasks();
    celebrated.clear();
    tasks.forEach(t => { if (t.done) celebrated.add(t.id); });
    P.stops = []; P.speed = 0; P.mode = 'idle';
    P.frac = targetFrac(); snapHeading(); hooks.place(P.frac, false);
  }
  return { P, plan, update, reset, targetFrac, snapHeading, curveLen, progressToFrac, allDone };
}
