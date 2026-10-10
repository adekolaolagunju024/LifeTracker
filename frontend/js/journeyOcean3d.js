// ── JOURNEY 3D: OCEAN STAGE ("Deep Sea Treasure Dive", WebGL / three.js) ──
// A diver swims a sandy trail from a sunlit coral reef down into the deep,
// past one giant clam per task (it opens to show a glowing pearl when the
// task is done). A shark circles the trail at each blocked task until it's
// done, then darts away. At the bottom, by a sunken ship, the last task
// opens the treasure chest: a beam of light, a burst of gold coins, and the
// fish gather round. The water darkens the deeper the diver goes.
//
// Loaded on demand by journeyGame.js (the "Ocean 3D" theme), which falls
// back to the 2D Ocean stage without WebGL. Same sync() contract as the
// other 3D stages. The diver is the KayKit Knight (CC0) re-dressed in code:
// wetsuit colours, a glass helmet, air tanks and fins. Everything else is
// built here from primitives.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  createShell, createLoop, makeCanvasTexture, seededRandom, softDotTexture, Particles, particleScaleFor,
  loadGLTF, makeCharacter, play, finished, recolorCharacter, findBone, attachToBone,
  checkpointFracOf, progressToPathFracSmooth, angleLerp, createWalker,
  stageTasks, layoutSignature, nameTagSprite,
} from './journey3dKit.js';

const DIVER_URL = '/assets/models/Knight.glb';

export function createOcean3D(container) {
  const shell = createShell(container, {
    label: 'Ocean Journey in 3D', background: '#04263d', loadingText: 'Filling the ocean…',
    winTitle: 'Treasure Found!', winText: 'You reached the bottom of the sea', winFill: '#ffe08a', winEdge: '#0b3a5c',
  });
  const { renderer, reduceMotion, timers } = shell;
  renderer.toneMappingExposure = 1.05;
  const canvasTexture = makeCanvasTexture(renderer);
  const rnd = seededRandom(11);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3();

  let tasks = [];
  let celebrationsOn = true;
  let onSummitCb = null;
  const uTime = { value: 0 };

  // ── The seabed: a sloping floor from a shallow reef (south) to the deep (north) ─
  const SURFACE_Y = 15;
  const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const slope = z => 3.5 - 8.5 * smooth(36, -40, z);
  const PATH_XZ = [[-8, 36], [2, 30], [8, 22], [0, 15], [-8, 8], [-3, 0], [6, -6], [3, -14], [-6, -20], [-4, -28], [3, -33], [0, -38]];
  const flatCurve = new THREE.CatmullRomCurve3(PATH_XZ.map(([x, z]) => V(x, 0, z)), false, 'catmullrom', 0.5);
  const PATH_SAMPLES = Array.from({ length: 321 }, (_, i) => flatCurve.getPointAt(i / 320));
  function distToPath(x, z) {
    let d = Infinity;
    for (const p of PATH_SAMPLES) { const dx = p.x - x, dz = p.z - z, q = dx * dx + dz * dz; if (q < d) d = q; }
    return Math.sqrt(d);
  }
  function groundHeight(x, z, dp = distToPath(x, z)) {
    const dunes = (vnoise(x * 0.06, z * 0.06) - 0.5) * 2.4 + (vnoise(x * 0.18 + 3, z * 0.18) - 0.5) * 0.7;
    const ridges = Math.max(0, vnoise(x * 0.025 + 9, z * 0.025) - 0.55) * 14;
    return slope(z) + dunes * (0.15 + 0.85 * smooth(3, 12, dp)) + ridges * smooth(8, 22, dp);
  }
  const SWIM_Y = 1.25;
  // The swim line: a few metres above the trail, following the floor.
  const curve = new THREE.CatmullRomCurve3(
    PATH_XZ.map(([x, z]) => V(x, groundHeight(x, z, 0) + SWIM_Y, z)), false, 'catmullrom', 0.5,
  );
  const curveLen = curve.getLength();
  const checkpointFrac = (i, n) => checkpointFracOf(i, n);
  const wallFrac = i => checkpointFrac(i, tasks.length) - 0.03;
  const sharkStopFrac = i => wallFrac(i) - 2.4 / curveLen;

  // ── Scene, light and water ──────────────────────────────────────────
  const scene = new THREE.Scene();
  const WATER_SHALLOW = new THREE.Color('#1a8fb0'), WATER_DEEP = new THREE.Color('#06243f');
  scene.background = WATER_SHALLOW.clone();
  scene.fog = new THREE.FogExp2(WATER_SHALLOW.clone(), 0.026);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(-10, 8, 44);

  const hemi = new THREE.HemisphereLight('#bff3ff', '#2a5a5a', 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#e6fbff', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sunDir = V(-0.3, 1, 0.25).normalize();

  // Caustics: dancing light patterns on everything lit from above, added in
  // the material's shader so they follow the world, not the texture.
  function addCaustics(material, strength = 0.55) {
    material.onBeforeCompile = shader => {
      shader.uniforms.uTime = uTime;
      shader.uniforms.uCaus = { value: strength };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCausPos;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 causWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            causWp = instanceMatrix * causWp;
          #endif
          vCausPos = (modelMatrix * causWp).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCausPos; uniform float uTime; uniform float uCaus;
          float causticAt(vec2 p, float t) {
            float a = sin(p.x * 1.7 + t * 1.1) + sin(p.y * 1.9 - t * 0.9) + sin((p.x + p.y) * 1.3 + t * 1.4) + sin((p.x - p.y) * 2.1 - t * 0.7);
            return pow(clamp(1.0 - abs(a) * 0.55, 0.0, 1.0), 6.0);
          }`)
        .replace('#include <opaque_fragment>', `
          float causDepth = clamp((vCausPos.y + 8.0) / 14.0, 0.15, 1.0);
          outgoingLight += vec3(0.75, 0.95, 1.0) * uCaus * causDepth * causticAt(vCausPos.xz * 0.55, uTime) * (0.6 + 0.4 * diffuseColor.r);
          #include <opaque_fragment>`);
    };
    return material;
  }

  {
    const SIZE = 300, SEG = 130;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
    const sand1 = new THREE.Color('#e3cf9c'), sand2 = new THREE.Color('#c9b07a'), deep = new THREE.Color('#8b8a74'), rock = new THREE.Color('#7d7f78');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), dp = distToPath(x, z), h = groundHeight(x, z, dp);
      pos.setY(i, h);
      c.copy(sand1).lerp(sand2, vnoise(x * 0.08, z * 0.08));
      c.lerp(deep, smooth(10, -40, z) * 0.55);
      if (h - slope(z) > 2.5) c.lerp(rock, Math.min(1, (h - slope(z) - 2.5) / 3));
      cols.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const rippleTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = `rgba(150,120,70,${0.08 + rnd() * 0.1})`; g.lineWidth = 2 + rnd() * 2;
        const y = rnd() * h;
        g.beginPath(); for (let x = -10; x <= w + 10; x += 8) g.lineTo(x, y + Math.sin(x * 0.06 + i) * 4); g.stroke();
      }
    }, { repeat: true });
    rippleTex.repeat.set(40, 40);
    const ground = new THREE.Mesh(geo, addCaustics(new THREE.MeshStandardMaterial({ map: rippleTex, vertexColors: true, roughness: 1 }), 0.65));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // The water surface seen from below: a bright, rippling ceiling.
  const surfaceTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#5cc8e6'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(230,255,255,${0.15 + rnd() * 0.35})`;
      g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 20, 3 + rnd() * 8, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
  }, { repeat: true });
  surfaceTex.repeat.set(18, 18);
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ map: surfaceTex, side: THREE.DoubleSide, transparent: true, opacity: 0.85, fog: false }));
  surface.rotation.x = Math.PI / 2; surface.position.y = SURFACE_Y;
  scene.add(surface);

  // Light shafts slanting down from the surface.
  const shafts = [];
  {
    const shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime, uStrength: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uStrength;
        void main(){ float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
          float fade = smoothstep(0.0, 0.9, vUv.y); float flick = 0.75 + 0.25 * sin(uTime * 0.8 + vUv.x * 6.0);
          gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * edge * fade * flick * 0.16 * uStrength, 1.0); }`,
    });
    for (let i = 0; i < 14; i++) {
      const p = flatCurve.getPointAt(rnd()), w = 2 + rnd() * 3;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, SURFACE_Y + 6, 1, 1), shaftMat);
      m.position.set(p.x + (rnd() - 0.5) * 24, SURFACE_Y / 2 - 1, p.z + (rnd() - 0.5) * 24);
      m.rotation.set(0.18, rnd() * Math.PI, -0.22);
      m.renderOrder = 4;
      scene.add(m); shafts.push({ m, ph: rnd() * 6 });
    }
  }

  // ── The trail: a pale sand ribbon over the floor, edged with pebbles ───
  function ribbonGeometry(width, samples, tile, lift) {
    const pos = [], uv = [], nrm = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples, p = flatCurve.getPointAt(u), t = flatCurve.getTangentAt(u);
      const side = V(-t.z, 0, t.x).normalize();
      const a = p.clone().addScaledVector(side, width / 2), b = p.clone().addScaledVector(side, -width / 2);
      pos.push(a.x, groundHeight(a.x, a.z) + lift, a.z, b.x, groundHeight(b.x, b.z) + lift, b.z);
      nrm.push(0, 1, 0, 0, 1, 0);
      uv.push((u * curveLen) / tile, 0, (u * curveLen) / tile, 1);
      if (i < samples) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }
  const trailTex = canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,246,220,0)'); grd.addColorStop(0.2, 'rgba(255,246,220,0.75)');
    grd.addColorStop(0.8, 'rgba(255,246,220,0.75)'); grd.addColorStop(1, 'rgba(255,246,220,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { repeat: true });
  const trail = new THREE.Mesh(ribbonGeometry(3, 400, 4, 0.06), addCaustics(new THREE.MeshStandardMaterial({ map: trailTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 }), 0.5));
  trail.receiveShadow = true; scene.add(trail);
  {
    const N = 260, pebbles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.12, 0), flat('#ffffff'), N);
    for (let i = 0; i < N; i++) {
      const u = (i / N) + rnd() * 0.002, p = flatCurve.getPointAt(Math.min(1, u)), t = flatCurve.getTangentAt(Math.min(1, u));
      const side = V(-t.z, 0, t.x).normalize().multiplyScalar((i % 2 ? 1 : -1) * (1.55 + rnd() * 0.3));
      const x = p.x + side.x, z = p.z + side.z, s = 0.6 + rnd() * 0.9;
      pebbles.setMatrixAt(i, tmpM.compose(V(x, groundHeight(x, z) + 0.05, z), tmpQ.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), V(s * 1.3, s * 0.6, s)));
      pebbles.setColorAt(i, tmpC.set(['#f4efe4', '#d9cbb2', '#b9a98c', '#e8d6c0'][i % 4]));
    }
    pebbles.receiveShadow = true; scene.add(pebbles);
  }

  // ── Particles: glow (sparkles, beams) and bubbles ───────────────────
  const scaleU = { value: 400 };
  const glowTex = softDotTexture(canvasTexture);
  const bubbleTex = canvasTexture(64, 64, (g, w) => {
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4;
    g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(w * 0.36, w * 0.34, 6, 0, Math.PI * 2); g.fill();
  });
  const sparks = new Particles(scene, 1800, { additive: true, map: glowTex, scale: scaleU });
  const bubbles = new Particles(scene, 900, { additive: false, map: bubbleTex, scale: scaleU });
  const rand3 = (s = 1) => V((rnd() - 0.5) * s, (rnd() - 0.5) * s, (rnd() - 0.5) * s);
  function bubble(at, n = 1, spread = 0.15, size = 0.12) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) bubbles.emit({ pos: at.clone().add(rand3(spread)), vel: V((rnd() - 0.5) * 0.3, 1.2 + rnd() * 0.9, (rnd() - 0.5) * 0.3), life: 2.2 + rnd() * 1.6, size: [size, size * 1.6], color: ['#e8fbff'], alpha: 0.85 });
  }
  function sparkle(at, n = 40, colors = ['#fff3b0', '#ffffff'], power = 3) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const d = V(rnd() - 0.5, rnd() * 0.9 + 0.1, rnd() - 0.5).normalize().multiplyScalar(power * (0.4 + rnd() * 0.8));
      sparks.emit({ pos: at.clone(), vel: d, life: 0.9 + rnd() * 0.8, size: [0.3, 0.05], color: [colors[i % colors.length], '#7fe7ff'], gravity: 0.5, drag: 2 });
    }
  }
  // Marine snow: tiny motes drifting around the camera, the strongest depth cue.
  const SNOW = 500;
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW * 3);
  for (let i = 0; i < SNOW; i++) snowPos.set([(rnd() - 0.5) * 30, (rnd() - 0.5) * 18, (rnd() - 0.5) * 30], i * 3);
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: '#e8f8ff', size: 0.06, transparent: true, opacity: 0.6, depthWrite: false }));
  snow.frustumCulled = false; scene.add(snow);

  // ── Reef life: kelp, corals, anemones, rocks, starfish ────────────────
  function scatter(count, minDist, maxDist, accept = () => true) {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 40; tries++) {
      const x = (rnd() - 0.5) * 160, z = (rnd() - 0.5) * 160 - 2;
      const dp = distToPath(x, z);
      if (dp < minDist || dp > maxDist) continue;
      if (Math.hypot(x - 2, z + 47) < 12) continue; // the wreck
      if (!accept(x, z, dp)) continue;
      out.push({ x, z, y: groundHeight(x, z, dp), dp });
    }
    return out;
  }
  // Swaying instanced geometry: bends more the higher up each vertex is.
  function addSway(material, height, amp, speed = 1.2) {
    // Parameters go in as uniforms: three.js caches compiled programs by
    // this function's source, so values inlined in the shader text would
    // leak from one swaying material into the next.
    const sway = { value: new THREE.Vector3(height, amp, speed) };
    material.onBeforeCompile = shader => {
      shader.uniforms.uTime = uTime;
      shader.uniforms.uSway = sway;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uSway;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float swayPh = 0.0;
          #ifdef USE_INSTANCING
            swayPh = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
          #endif
          float swayK = pow(clamp(position.y / uSway.x, 0.0, 1.0), 1.6);
          transformed.x += sin(uTime * uSway.z + swayPh) * swayK * uSway.y;
          transformed.z += cos(uTime * uSway.z * 0.8 + swayPh * 1.3) * swayK * uSway.y * 0.6;`);
    };
    return material;
  }
  {
    const kelpGeo = (() => {
      const g = new THREE.PlaneGeometry(0.55, 7, 1, 12); g.translate(0, 3.5, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - y / 9) + Math.sin(y * 0.9) * 0.15); }
      g.computeVertexNormals();
      return mergeGeometries([g, g.clone().rotateY(Math.PI / 2)]);
    })();
    const kelpSpots = [];
    scatter(40, 6, 40, (x, z) => z > -30).forEach(c => { for (let k = 0; k < 7; k++) kelpSpots.push({ x: c.x + (rnd() - 0.5) * 3, z: c.z + (rnd() - 0.5) * 3 }); });
    const kelp = new THREE.InstancedMesh(kelpGeo, addSway(new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.7 }), 7, 0.9), kelpSpots.length);
    kelpSpots.forEach((k, i) => {
      const s = 0.7 + rnd() * 0.8;
      kelp.setMatrixAt(i, tmpM.compose(V(k.x, groundHeight(k.x, k.z) - 0.1, k.z), tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * 6), V(s, s * (0.8 + rnd() * 0.6), s)));
      kelp.setColorAt(i, tmpC.set(['#5d8a2e', '#7a9a32', '#4f7d35', '#8aa13a'][i % 4]));
    });
    kelp.castShadow = true; scene.add(kelp);

    const branchGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.08, 0.14, 1.2, 6).translate(0, 0.6, 0),
      new THREE.CylinderGeometry(0.06, 0.1, 0.9, 6).rotateZ(0.6).translate(0.3, 1.0, 0),
      new THREE.CylinderGeometry(0.06, 0.1, 0.8, 6).rotateZ(-0.7).translate(-0.28, 0.95, 0.05),
      new THREE.CylinderGeometry(0.05, 0.08, 0.7, 6).rotateX(0.6).translate(0, 1.05, 0.25),
      new THREE.SphereGeometry(0.1, 6, 5).translate(0, 1.22, 0), new THREE.SphereGeometry(0.08, 6, 5).translate(0.55, 1.3, 0), new THREE.SphereGeometry(0.08, 6, 5).translate(-0.52, 1.25, 0.05),
    ]);
    const brainGeo = new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const fanGeo = new THREE.CircleGeometry(0.55, 14, 0, Math.PI).translate(0, 0.05, 0);
    const tubeGeo = mergeGeometries([0, 1, 2, 3].map(k => new THREE.CylinderGeometry(0.12, 0.16, 0.7 + k * 0.25, 8, 1, true).translate(Math.cos(k * 1.7) * 0.22, (0.7 + k * 0.25) / 2, Math.sin(k * 1.7) * 0.22)));
    const anemoneGeo = mergeGeometries([new THREE.CylinderGeometry(0.22, 0.28, 0.3, 8).translate(0, 0.15, 0),
      ...Array.from({ length: 12 }, (_, k) => new THREE.ConeGeometry(0.04, 0.5, 4).translate(0, 0.25, 0).rotateZ(0.5).rotateY((k / 12) * Math.PI * 2).translate(0, 0.3, 0))]);
    const corals = scatter(320, 2.6, 26, (x, z, dp) => rnd() < (z > -15 ? 1 : 0.45) * (dp < 10 ? 1 : 0.6));
    const kinds = [
      { geo: branchGeo, colors: ['#ff7a8a', '#ff9e5e', '#f06292', '#ffb74d'], sway: false },
      { geo: brainGeo, colors: ['#c9a16b', '#e3b26a', '#a8c46b', '#d08bb0'], sway: false },
      { geo: fanGeo, colors: ['#a855f7', '#e879f9', '#f472b6', '#c084fc'], sway: true, double: true },
      { geo: tubeGeo, colors: ['#fbbf24', '#f97316', '#60a5fa', '#34d399'], sway: false, double: true },
      { geo: anemoneGeo, colors: ['#f472b6', '#fb7185', '#fda4af', '#a78bfa'], sway: true },
    ];
    kinds.forEach((k, ki) => {
      const list = corals.filter((_, i) => i % kinds.length === ki);
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, side: k.double ? THREE.DoubleSide : THREE.FrontSide });
      const m = new THREE.InstancedMesh(k.geo, k.sway ? addSway(mat, 1, 0.12, 1.6) : addCaustics(mat, 0.35), list.length);
      list.forEach((c, i) => {
        const s = 0.7 + rnd() * 1.1;
        m.setMatrixAt(i, tmpM.compose(V(c.x, c.y - 0.05, c.z), tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * 6), V(s, s, s)));
        m.setColorAt(i, tmpC.set(k.colors[Math.floor(rnd() * k.colors.length)]));
      });
      m.castShadow = true; m.receiveShadow = true; scene.add(m);
    });
    const rocks = scatter(110, 3.2, 60);
    const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.8, 1), addCaustics(flat('#ffffff'), 0.5), rocks.length);
    rocks.forEach((r, i) => {
      const s = 0.5 + rnd() * 1.6;
      rockMesh.setMatrixAt(i, tmpM.compose(V(r.x, r.y, r.z), tmpQ.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), V(s * 1.3, s * 0.7, s)));
      rockMesh.setColorAt(i, tmpC.set(['#6f7a78', '#5d6766', '#818b84'][i % 3]));
    });
    rockMesh.castShadow = true; rockMesh.receiveShadow = true; scene.add(rockMesh);
    const seaweed = scatter(700, 1.8, 30);
    const weedGeo = mergeGeometries([0, 1, 2].map(k => new THREE.ConeGeometry(0.05, 0.6 + k * 0.15, 3).translate(0, 0.3 + k * 0.07, 0).rotateZ((k - 1) * 0.3)));
    const weeds = new THREE.InstancedMesh(weedGeo, addSway(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), 0.9, 0.12, 1.8), seaweed.length);
    seaweed.forEach((s2, i) => {
      weeds.setMatrixAt(i, tmpM.compose(V(s2.x, s2.y, s2.z), tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * 6), V(1, 0.7 + rnd() * 0.8, 1)));
      weeds.setColorAt(i, tmpC.set(rnd() < 0.5 ? '#3f8f5a' : '#6aa84f'));
    });
    scene.add(weeds);
    // starfish and shells by the trail
    const star = (() => {
      const shape = new THREE.Shape();
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, r = k % 2 ? 0.07 : 0.2; shape[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      return new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }).rotateX(-Math.PI / 2);
    })();
    const stars = scatter(70, 1.7, 6);
    const starMesh = new THREE.InstancedMesh(star, flat('#ffffff'), stars.length);
    stars.forEach((s2, i) => {
      starMesh.setMatrixAt(i, tmpM.compose(V(s2.x, s2.y + 0.04, s2.z), tmpQ.setFromAxisAngle(V(0, 1, 0), rnd() * 6), V(1, 1, 1).multiplyScalar(0.8 + rnd() * 0.8)));
      starMesh.setColorAt(i, tmpC.set(['#ff8a4c', '#f43f5e', '#fbbf24', '#e879f9'][i % 4]));
    });
    scene.add(starMesh);
  }

  // ── Fish schools ──────────────────────────────────────────────────────
  const fishGeo = mergeGeometries([
    new THREE.SphereGeometry(0.16, 8, 6).scale(0.55, 0.9, 1.4),
    new THREE.ConeGeometry(0.13, 0.22, 4).rotateX(Math.PI / 2).scale(0.3, 1, 1).translate(0, 0, -0.3),
  ]);
  const fishMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.2 });
  fishMat.onBeforeCompile = shader => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fph = 0.0;
        #ifdef USE_INSTANCING
          fph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].y * 1.7;
        #endif
        transformed.x += sin(uTime * 11.0 + fph + position.z * 6.0) * 0.06 * smoothstep(0.1, -0.35, position.z);`);
  };
  const SCHOOLS = [
    { n: 34, colors: ['#ffd23f', '#ffe066', '#ffb703'], center: V(-4, 0, 26), rad: 7, h: 3.2, sp: 0.35 },
    { n: 30, colors: ['#4cc9f0', '#90e0ef', '#48cae4'], center: V(4, 0, 4), rad: 8, h: 4, sp: -0.3 },
    { n: 26, colors: ['#ff6b6b', '#ff8fa3', '#ffa07a'], center: V(-3, 0, -16), rad: 6, h: 3, sp: 0.4 },
    { n: 26, colors: ['#c0c6d0', '#e0e6ee', '#a8b2c0'], center: V(2, 0, -32), rad: 7, h: 4.2, sp: -0.32 },
  ];
  const fishTotal = SCHOOLS.reduce((a, s) => a + s.n, 0);
  const fish = new THREE.InstancedMesh(fishGeo, fishMat, fishTotal);
  fish.frustumCulled = false;
  const fishData = [];
  SCHOOLS.forEach((s, si) => {
    s.home = s.center.clone(); s.target = s.center.clone(); s.cur = s.center.clone();
    for (let k = 0; k < s.n; k++) {
      fishData.push({ si, off: V((rnd() - 0.5) * 3, (rnd() - 0.5) * 1.6, (rnd() - 0.5) * 3), ph: rnd() * 6, sc: 0.8 + rnd() * 0.6 });
      fish.setColorAt(fishData.length - 1, tmpC.set(s.colors[k % s.colors.length]));
    }
  });
  scene.add(fish);
  const fishPrev = fishData.map(() => new THREE.Vector3());
  function updateFish(time, dt) {
    SCHOOLS.forEach(s => { s.cur.lerp(s.target, Math.min(1, dt * 0.6)); });
    fishData.forEach((f, i) => {
      const s = SCHOOLS[f.si], a = time * s.sp + f.ph * 0.15;
      const base = tmpV.set(s.cur.x + Math.cos(a) * s.rad, groundHeight(s.cur.x, s.cur.z, 10) + s.h, s.cur.z + Math.sin(a) * s.rad);
      const p = base.add(f.off).add(V(Math.sin(time * 0.8 + f.ph) * 0.4, Math.sin(time * 1.1 + f.ph) * 0.25, Math.cos(time * 0.7 + f.ph) * 0.4));
      const prev = fishPrev[i];
      const dir = V(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      const yaw = dir.lengthSq() > 1e-8 ? Math.atan2(dir.x, dir.z) : 0;
      prev.copy(p);
      fish.setMatrixAt(i, tmpM.compose(p, tmpQ.setFromEuler(new THREE.Euler(0, yaw, 0)), V(f.sc, f.sc, f.sc)));
    });
    fish.instanceMatrix.needsUpdate = true;
  }

  // A sea turtle and a manta ray gliding past, and a few jellyfish.
  function buildTurtle() {
    const g = new THREE.Group();
    const shellM = flat('#5f8f4e'), skin = flat('#a6c48a');
    const shellMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), shellM); shellMesh.scale.set(1, 0.55, 1.2); g.add(shellMesh);
    const belly = new THREE.Mesh(new THREE.CircleGeometry(0.6, 10), flat('#e8dca0', { side: THREE.DoubleSide })); belly.rotation.x = Math.PI / 2; belly.scale.set(1, 1.2, 1); g.add(belly);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), skin); head.position.set(0, 0.05, 0.85); head.scale.set(1, 0.8, 1.2); g.add(head);
    const flippers = [];
    [[-1, 0.35], [1, 0.35], [-1, -0.5], [1, -0.5]].forEach(([s, z], k) => {
      const pv = new THREE.Group(); pv.position.set(s * 0.5, 0, z); g.add(pv);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 5), skin); f.scale.set(k < 2 ? 1.6 : 0.9, 0.15, 0.6); f.position.x = s * (k < 2 ? 0.4 : 0.2); pv.add(f);
      flippers.push({ pv, s, front: k < 2 });
    });
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    return { g, flippers };
  }
  const turtle = buildTurtle();
  function buildManta() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.1); shape.quadraticCurveTo(1.6, 0.3, 2.2, -0.2); shape.quadraticCurveTo(1, -0.4, 0.3, -0.8);
    shape.lineTo(0, -0.9); shape.lineTo(-0.3, -0.8); shape.quadraticCurveTo(-1, -0.4, -2.2, -0.2); shape.quadraticCurveTo(-1.6, 0.3, 0, 1.1);
    const geo = new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, -Math.abs(p.getX(i)) * 0.05);
    const mat = new THREE.MeshStandardMaterial({ color: '#2b3a4a', roughness: 0.6, side: THREE.DoubleSide });
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uTime * 2.2) * pow(abs(position.x) / 2.2, 1.5) * 0.7;');
    };
    const m = new THREE.Mesh(geo, mat); m.castShadow = true;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 1.6, 4), mat); tail.rotation.x = Math.PI / 2; tail.position.z = 1.6; m.add(tail);
    m.scale.setScalar(1.4);
    scene.add(m);
    return m;
  }
  const manta = buildManta();
  const jellies = [];
  {
    const bellMat = new THREE.MeshStandardMaterial({ color: '#f5b8ff', emissive: '#a855f7', emissiveIntensity: 0.4, transparent: true, opacity: 0.55, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
    const tentMat = new THREE.LineBasicMaterial({ color: '#f0abfc', transparent: true, opacity: 0.6 });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), bellMat); g.add(bell);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2, pts = [];
        for (let j = 0; j <= 8; j++) pts.push(V(Math.cos(a) * 0.2 + Math.sin(j * 0.9 + k) * 0.05, -j * 0.14, Math.sin(a) * 0.2));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), tentMat));
      }
      const p = flatCurve.getPointAt(0.1 + rnd() * 0.85);
      g.position.set(p.x + (rnd() - 0.5) * 20, 0, p.z + (rnd() - 0.5) * 20);
      g.userData = { ph: rnd() * 6, base: g.position.clone(), h: 5 + rnd() * 5 };
      scene.add(g); jellies.push({ g, bell });
    }
  }
  function updateCritters(time) {
    const ta = time * 0.12;
    turtle.g.position.set(Math.sin(ta) * 14, slope(Math.cos(ta) * 20) + 4.5 + Math.sin(time * 0.5) * 0.4, Math.cos(ta) * 20);
    turtle.g.rotation.y = ta + Math.PI / 2;
    turtle.flippers.forEach(f => { f.pv.rotation.z = f.s * Math.sin(time * (f.front ? 2.4 : 2.4) + (f.front ? 0 : 1)) * (f.front ? 0.6 : 0.3); });
    const ma = -time * 0.07 + 2;
    manta.position.set(Math.sin(ma) * 22 + 4, slope(Math.cos(ma) * 28 - 6) + 7, Math.cos(ma) * 28 - 6);
    manta.rotation.set(0, ma - Math.PI / 2, Math.sin(time * 0.4) * 0.15);
    jellies.forEach(({ g, bell }) => {
      const d = g.userData, pulse = Math.sin(time * 2.4 + d.ph);
      bell.scale.set(1 + pulse * 0.12, 1 - pulse * 0.15, 1 + pulse * 0.12);
      g.position.y = slope(d.base.z) + d.h + Math.sin(time * 0.4 + d.ph) * 0.8;
    });
  }

  // ── The wreck and the treasure chest (the finish) ─────────────────────
  const endP = curve.getPointAt(1), endT = curve.getTangentAt(1);
  const endFlat = V(endT.x, 0, endT.z).normalize();
  const chestPos = V(endP.x, 0, endP.z).addScaledVector(endFlat, 2.6);
  chestPos.y = groundHeight(chestPos.x, chestPos.z);
  const chestFace = Math.atan2(-endFlat.x, -endFlat.z);
  const chestFront = chestPos.clone().addScaledVector(endFlat, -1.5);
  {
    const wreck = new THREE.Group();
    const wood = addCaustics(flat('#5b4330'), 0.45), dark = flat('#3a2a1e');
    // hull: a ship-shaped cross-section (wide deck, narrow keel) extruded
    // along its length, with a pointed bow
    const section = new THREE.Shape();
    section.moveTo(-2.3, 2.2); section.lineTo(2.3, 2.2); section.quadraticCurveTo(2.2, 0.6, 0.5, 0); section.lineTo(-0.5, 0); section.quadraticCurveTo(-2.2, 0.6, -2.3, 2.2);
    const hullGeo = new THREE.ExtrudeGeometry(section, { depth: 9, bevelEnabled: false, steps: 6 });
    const hp = hullGeo.attributes.position;
    for (let i = 0; i < hp.count; i++) { const z = hp.getZ(i); const k = z > 6.5 ? 1 - (z - 6.5) / 3.2 : 1; hp.setX(i, hp.getX(i) * Math.max(0.05, k)); }
    hullGeo.computeVertexNormals(); hullGeo.translate(0, 0, -4.5);
    const hull = new THREE.Mesh(hullGeo, wood); wreck.add(hull);
    for (let k = 0; k < 5; k++) { const plank = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 8), dark); plank.position.set(2.05 - k * 0.02, 0.6 + k * 0.35, -0.6); wreck.add(plank); }
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.8, 10), new THREE.MeshBasicMaterial({ color: '#0b1a22' })); hole.position.set(2.12, 1.0, 1.5); hole.rotation.y = Math.PI / 2; wreck.add(hole);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.15, 9), dark); deck.position.y = 2.15; wreck.add(deck);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.8, 2.6), wood); cabin.position.set(0, 3.1, -3); wreck.add(cabin);
    for (let k = 0; k < 4; k++) { const ph = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), new THREE.MeshStandardMaterial({ color: '#2b4a55', emissive: '#7fe7ff', emissiveIntensity: 0.35 })); ph.position.set(1.72, 3.2, -3.9 + k * 0.6); ph.rotation.y = Math.PI / 2; wreck.add(ph); }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 8, 8), dark); mast.position.set(0, 6.1, 1); mast.rotation.z = 0.25; wreck.add(mast);
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), dark); yard.rotation.z = Math.PI / 2 + 0.25; yard.position.set(-1.5, 8.6, 1); wreck.add(yard);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3, 6, 6), addSway(new THREE.MeshStandardMaterial({ color: '#d8ccb0', side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), 3, 0.35, 0.9));
    sail.position.set(-1.4, 6.9, 1.05); sail.rotation.z = 0.25; wreck.add(sail);
    wreck.position.set(chestPos.x + 1.5, groundHeight(chestPos.x + 1.5, chestPos.z - 8) - 0.6, chestPos.z - 8);
    wreck.rotation.set(0.05, 0.5, 0.3);
    wreck.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(wreck);
  }
  const chest = new THREE.Group();
  const chestLid = new THREE.Group();
  {
    const wood = flat('#7a4b2a'), band = new THREE.MeshStandardMaterial({ color: '#e7b443', metalness: 0.8, roughness: 0.3 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1), wood); box.position.y = 0.45; chest.add(box);
    [-0.6, 0.6].forEach(x => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.92, 1.02), band); b.position.set(x, 0.45, 0); chest.add(b); });
    const gold = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.8), new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb000', emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.3 }));
    gold.position.y = 0.86; chest.add(gold);
    chestLid.position.set(0, 0.9, -0.5); chest.add(chestLid);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.34, 1), wood); lid.position.set(0, 0.17, 0.5); chestLid.add(lid);
    [-0.6, 0.6].forEach(x => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 1.02), band); b.position.set(x, 0.17, 0.5); chestLid.add(b); });
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.08), band); lock.position.set(0, 0.02, 1.02); chestLid.add(lock);
    chest.traverse(o => { if (o.isMesh) o.castShadow = true; });
    chest.position.copy(chestPos); chest.rotation.y = chestFace;
    scene.add(chest);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.2, 14, 16, 1, true), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime, uStrength: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uStrength;
      void main(){ float fade = smoothstep(1.0, 0.0, vUv.y); float flick = 0.8 + 0.2 * sin(uTime * 3.0 + vUv.x * 12.0);
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.4) * fade * flick * 0.55 * uStrength, 1.0); }`,
  }));
  beam.position.copy(chestPos).add(V(0, 7.6, 0)); beam.renderOrder = 5; beam.visible = false;
  scene.add(beam);
  const chestGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffd27a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
  chestGlow.position.copy(chestPos).add(V(0, 1.2, 0)); chestGlow.scale.setScalar(5); scene.add(chestGlow);
  // gold coins that spill out and settle on the sand
  const COINS = 90;
  const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 12), new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#b8860b', emissiveIntensity: 0.4, metalness: 0.9, roughness: 0.25 }), COINS);
  const coinState = Array.from({ length: COINS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), rest: false }));
  coins.visible = false; coins.castShadow = true; scene.add(coins);
  function spillCoins(instant) {
    coins.visible = true;
    coinState.forEach(c => {
      const a = rnd() * Math.PI * 2, r = 0.3 + rnd() * (instant ? 2.2 : 0.4);
      c.p.copy(chestPos).add(V(Math.cos(a) * r, instant ? 0.03 : 1.0, Math.sin(a) * r));
      c.v.set(Math.cos(a) * (1 + rnd() * 2.5), 2.5 + rnd() * 3, Math.sin(a) * (1 + rnd() * 2.5));
      c.r.set(rnd() * 6, rnd() * 6, rnd() * 6); c.w.set((rnd() - 0.5) * 10, (rnd() - 0.5) * 10, (rnd() - 0.5) * 10);
      c.rest = !!instant;
      if (instant) { c.p.y = groundHeight(c.p.x, c.p.z) + 0.02; c.r.set(0, rnd() * 6, 0); }
    });
    updateCoins(0);
  }
  function updateCoins(dt) {
    if (!coins.visible) return;
    coinState.forEach((c, i) => {
      if (!c.rest) {
        c.v.y -= 2.4 * dt; c.v.multiplyScalar(1 - 1.4 * dt);
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
        const gy = groundHeight(c.p.x, c.p.z) + 0.02;
        if (c.p.y <= gy) { c.p.y = gy; c.rest = true; c.r.x = 0; c.r.z = 0; }
      }
      coins.setMatrixAt(i, tmpM.compose(c.p, tmpQ.setFromEuler(c.r), V(1, 1, 1)));
    });
    coins.instanceMatrix.needsUpdate = true;
  }

  // ── Checkpoints: one giant clam (and a marker float) per task ─────────
  const STATUS = { done: '#10b981', next: '#fbbf24', pending: '#cbd5e1' };
  function badgeTexture(text, bg, fg) {
    return canvasTexture(128, 128, (g, w) => {
      g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
      g.fillStyle = fg; g.font = '900 68px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, w / 2 + 4);
    });
  }
  const shellMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#b48ad6', roughness: 0.55, flatShading: true }), 0.4);
  const shellInner = new THREE.MeshStandardMaterial({ color: '#ffe4f2', roughness: 0.3, side: THREE.BackSide });
  const shellGeo = (() => {
    const g = new THREE.SphereGeometry(0.75, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x); const k = 1 + 0.08 * Math.cos(a * 8); p.setX(i, x * k); p.setZ(i, z * k); }
    g.scale(1, 0.45, 0.85); g.computeVertexNormals();
    return g;
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
      const gp = p.clone().addScaledVector(side, 2.3);
      group.position.set(gp.x, groundHeight(gp.x, gp.z), gp.z);
      group.rotation.y = Math.atan2(-side.x, -side.z);
      const bottom = new THREE.Mesh(shellGeo, shellMat); bottom.rotation.x = Math.PI; bottom.position.y = 0.32; group.add(bottom);
      const bottomIn = new THREE.Mesh(shellGeo, shellInner); bottomIn.rotation.x = Math.PI; bottomIn.position.y = 0.32; group.add(bottomIn);
      const hinge = new THREE.Group(); hinge.position.set(0, 0.32, -0.62); group.add(hinge);
      const top = new THREE.Mesh(shellGeo, shellMat); top.position.z = 0.62; hinge.add(top);
      const topIn = new THREE.Mesh(shellGeo, shellInner); topIn.position.z = 0.62; hinge.add(topIn);
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e0f7ff', emissiveIntensity: 0, roughness: 0.1, metalness: 0.3 }));
      pearl.position.set(0, 0.42, 0.05); group.add(pearl);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#bff4ff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
      glow.position.set(0, 0.6, 0); glow.scale.setScalar(2.6); group.add(glow);
      group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      // marker float on a line, coloured by status
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.6, 4), new THREE.MeshStandardMaterial({ color: '#e5e7eb' }));
      line.position.set(0.9, 1.3, 0); group.add(line);
      const floatMat = new THREE.MeshStandardMaterial({ color: STATUS.pending, roughness: 0.35 });
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), floatMat); fl.position.set(0.9, 2.75, 0); fl.castShadow = true; group.add(fl);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true }));
      badge.position.set(0.9, 3.4, 0); badge.scale.setScalar(0.55); group.add(badge);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 40), new THREE.MeshBasicMaterial({ color: STATUS.next, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; group.add(ring);
      scene.add(group);
      flags.push({ group, hinge, pearl, glow, fl, floatMat, badge, ring, open: 0.12, openTarget: 0.12, pop: 0, status: '' });
    });
  }
  function refreshFlags() {
    const doneCount = tasks.filter(t => t.done).length;
    tasks.forEach((t, i) => {
      const f = flags[i];
      const status = t.done ? 'done' : i === doneCount ? 'next' : 'pending';
      if (f.status === status) return;
      f.status = status;
      f.floatMat.color.set(STATUS[status]);
      f.badge.material.map = status === 'done' ? badgeTexture('✓', STATUS.done, '#06301b') : badgeTexture(String(i + 1), status === 'next' ? STATUS.next : '#eef2f7', '#0b2534');
      f.badge.material.needsUpdate = true;
      f.ring.visible = status === 'next';
      if (status !== 'done') f.openTarget = status === 'next' ? 0.32 : 0.12;
    });
  }
  function openClam(f, instant) {
    f.openTarget = 1.05;
    if (instant) f.open = f.openTarget;
  }

  // ── Sharks (blocked tasks): circle the trail until the task is done ────
  function buildShark() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const skin = flat('#6b7f93'), belly = flat('#e8eef3'), dark = flat('#4a5b6d');
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), skin); torso.scale.set(0.75, 0.75, 2.4); body.add(torso);
    const under = new THREE.Mesh(new THREE.SphereGeometry(0.47, 12, 8), belly); under.scale.set(0.7, 0.55, 2.2); under.position.y = -0.12; body.add(under);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 7), skin); snout.scale.set(0.9, 0.7, 1.4); snout.position.set(0, 0.04, 1.05); body.add(snout);
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 4), dark); dorsal.scale.set(0.25, 1, 1); dorsal.rotation.x = -0.4; dorsal.position.set(0, 0.6, 0.1); body.add(dorsal);
    [-1, 1].forEach(s => {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 4), dark); fin.scale.set(1, 1, 0.2); fin.rotation.set(0.2, 0, s * 1.9); fin.position.set(s * 0.55, -0.15, 0.35); body.add(fin);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), flat('#111111')); eye.position.set(s * 0.26, 0.12, 1.15); body.add(eye);
      for (let k = 0; k < 3; k++) { const gill = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.03), dark); gill.position.set(s * 0.36, 0.0, 0.7 - k * 0.1); body.add(gill); }
    });
    const tail = new THREE.Group(); tail.position.z = -1.1; body.add(tail);
    const stalk = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), skin); stalk.scale.set(0.6, 0.7, 1.8); stalk.position.z = -0.25; tail.add(stalk);
    const fluke1 = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 4), dark); fluke1.scale.set(0.2, 1, 1); fluke1.rotation.x = -0.9; fluke1.position.set(0, 0.35, -0.65); tail.add(fluke1);
    const fluke2 = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 4), dark); fluke2.scale.set(0.2, 1, 1); fluke2.rotation.x = -2.3; fluke2.position.set(0, -0.25, -0.6); tail.add(fluke2);
    const mats = [];
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); mats.push(o.material); } });
    g.scale.setScalar(1.25);
    scene.add(g);
    return { kind: 'shark', g, body, tail, mats };
  }
  const lockTex = canvasTexture(128, 128, (g, w) => {
    g.fillStyle = '#ff6b5e'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(38, 58, 52, 40);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
  });
  // Jellyfish swarms: a few translucent bells drifting together.
  const foeBellMat = new THREE.MeshStandardMaterial({ color: '#ff9de2', emissive: '#d946ef', emissiveIntensity: 0.5, transparent: true, opacity: 0.6, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
  function buildJellySwarm() {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const bells = [];
    for (let k = 0; k < 4; k++) {
      const j = new THREE.Group();
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), foeBellMat.clone()); j.add(bell);
      for (let m = 0; m < 5; m++) {
        const a = (m / 5) * Math.PI * 2, pts = [];
        for (let q = 0; q <= 7; q++) pts.push(V(Math.cos(a) * 0.18 + Math.sin(q + m) * 0.04, -q * 0.13, Math.sin(a) * 0.18));
        j.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#f5b8ff', transparent: true, opacity: 0.6 })));
      }
      j.position.set((rnd() - 0.5) * 1.4, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 1.4);
      body.add(j); bells.push({ j, bell, ph: rnd() * 6 });
    }
    scene.add(g);
    return { kind: 'jelly', g, body, bells, mats: bells.map(b => b.bell.material) };
  }
  // Every task's obstacles: one predator per obstacle point (sharks and
  // jellyfish swarms in turn), circling the trail in front of the clam.
  const walls = [];
  function buildWalls() {
    walls.forEach(w => { w.foes.forEach(f => scene.remove(f.g)); scene.remove(w.lock, w.ring, w.tag); });
    walls.length = 0;
    tasks.forEach((t, i) => {
      if (!t.foes) return;
      const u = wallFrac(i), p = curve.getPointAt(u);
      const ground = groundHeight(p.x, p.z);
      const n = Math.min(t.foes, 5);
      const foes = Array.from({ length: n }, (_, k) => {
        const f = k % 2 === 0 ? buildShark() : buildJellySwarm();
        return Object.assign(f, { r: 2.4 + (k % 3) * 0.9, angle: (k / n) * Math.PI * 2, h: 0.2 + (k % 2) * 0.9, sp: 0.5 + (k % 3) * 0.12, ph: rnd() * 6, delay: k * 0.45, flee: null, gone: false });
      });
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true }));
      lock.position.set(p.x, ground + 3.8, p.z); lock.scale.setScalar(0.6); scene.add(lock);
      const tag = nameTagSprite(`${t.blocker}${t.foes > 1 ? ` ×${t.foes}` : ''}`);
      tag.position.set(p.x, ground + 4.45, p.z); scene.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 48), new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, ground + 0.1, p.z); scene.add(ring);
      const w = { taskIndex: i, foes, lock, tag, ring, center: V(p.x, p.y + 0.4, p.z), cleared: !!t.done, clearing: false, t: t.done ? 99 : 0 };
      if (w.cleared) { foes.forEach(f => { f.g.visible = false; f.gone = true; }); lock.visible = tag.visible = ring.visible = false; }
      walls.push(w);
    });
  }
  const wallPause = w => 0.9 + 0.45 * Math.max(1, w.foes.length);
  function clearWall(w) {
    if (w.cleared) return;
    w.cleared = true; w.t = 0;
    if (diver) {
      P.heading = Math.atan2(w.center.x - diver.holder.position.x, w.center.z - diver.holder.position.z);
      play(diver, 'Interact', { fade: 0.15, once: true, timeScale: 1.2 });
      bubble(diverHeadPos(), 14, 0.3, 0.16);
    }
    if (reduceMotion) { w.t = 99; w.foes.forEach(f => { f.g.visible = false; f.gone = true; }); }
    notify();
  }
  function restoreWall(w) {
    w.cleared = false; w.clearing = false; w.t = 0;
    w.foes.forEach(f => { f.flee = null; f.gone = false; f.g.visible = true; f.mats.forEach(m => { m.transparent = f.kind === 'jelly'; m.opacity = f.kind === 'jelly' ? 0.6 : 1; }); });
  }
  function circleFoe(w, f, dt, time) {
    f.angle += dt * f.sp;
    f.g.position.set(w.center.x + Math.cos(f.angle) * f.r, w.center.y + f.h + Math.sin(time * 0.9 + f.ph) * 0.3, w.center.z + Math.sin(f.angle) * f.r);
    if (f.kind === 'shark') f.g.rotation.set(0, Math.atan2(-Math.sin(f.angle), Math.cos(f.angle)), -0.25);
  }
  function updateWalls(dt, time) {
    walls.forEach(w => {
      w.foes.forEach(f => {
        if (f.kind === 'shark') {
          f.tail.rotation.y = Math.sin(time * (f.flee ? 14 : 5) + f.ph) * 0.45;
          f.body.rotation.y = Math.sin(time * (f.flee ? 14 : 5) + f.ph + 1.2) * 0.08;
        } else {
          f.bells.forEach(b => { const q = Math.sin(time * 2.6 + b.ph); b.bell.scale.set(1 + q * 0.12, 1 - q * 0.15, 1 + q * 0.12); b.j.position.y += Math.sin(time * 1.2 + b.ph) * 0.002; });
        }
      });
      if (!w.cleared) {
        w.foes.forEach(f => circleFoe(w, f, dt, time));
        w.lock.visible = w.tag.visible = w.ring.visible = true;
        w.ring.material.opacity = 0.3 + 0.2 * Math.sin(time * 4);
        w.lock.position.y = w.center.y + 2.4 + Math.sin(time * 2.2) * 0.08;
        return;
      }
      if (w.t > 60) return;
      w.t += dt;
      const e = Math.min(1, w.t / 0.6);
      w.lock.material.opacity = w.tag.material.opacity = 1 - e; w.ring.material.opacity = 0.5 * (1 - e);
      if (w.t > 0.6) w.lock.visible = w.tag.visible = w.ring.visible = false;
      // one after another, each predator turns tail and flees into the blue
      w.foes.forEach(f => {
        if (f.gone) return;
        const lt = w.t - f.delay - 0.3;
        if (lt < 0) { circleFoe(w, f, dt, time); return; }
        if (!f.flee) {
          const away = f.g.position.clone().sub(w.center).setY(0).normalize();
          f.flee = { dir: away.lengthSq() ? away : V(1, 0, 0), speed: 2 };
          bubble(f.g.position.clone(), 10, 0.4, 0.14);
        }
        f.flee.speed = Math.min(14, f.flee.speed + dt * 18);
        if (f.kind === 'shark') {
          const want = Math.atan2(f.flee.dir.x, f.flee.dir.z);
          f.g.rotation.y = angleLerp(f.g.rotation.y, want, Math.min(1, dt * 6));
          f.g.rotation.z *= 0.9;
          f.g.position.addScaledVector(V(Math.sin(f.g.rotation.y), 0.12, Math.cos(f.g.rotation.y)), f.flee.speed * dt);
        } else {
          f.g.position.addScaledVector(f.flee.dir.clone().setY(1.2).normalize(), f.flee.speed * 0.4 * dt);
        }
        const fade = Math.max(0, 1 - (lt - 1.2) / 1.4);
        f.mats.forEach(m => { m.transparent = true; m.opacity = fade * (f.kind === 'jelly' ? 0.6 : 1); });
        if (fade <= 0) { f.gone = true; f.g.visible = false; }
      });
    });
  }

  // ── The diver ────────────────────────────────────────────────────────
  const loader = new GLTFLoader();
  let diver = null, clips = [], headBone = null;
  const DIVER_H = 1.55, CENTER = DIVER_H * 0.5;
  function dressDiver(obj) {
    ['Knight_Helmet', 'Knight_Cape', '1H_Sword', 'Badge_Shield'].forEach(n => { const o = obj.getObjectByName(n); if (o) o.removeFromParent(); });
    // armour greys → a navy wetsuit; reds → orange trim
    recolorCharacter(obj, (h, s, l) => {
      if (s < 0.16 && l > 0.16 && l < 0.86) return [205, 0.55, 0.1 + l * 0.22];
      if ((h > 340 || h < 12) && s > 0.4) return [26, 0.95, Math.min(0.6, l + 0.12)];
      return null;
    });
  }
  function rigDiver(ch) {
    const obj = ch.obj;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    headBone = findBone(obj, 'head');
    const glassMat = new THREE.MeshStandardMaterial({ color: '#d8f6ff', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
    const brass = new THREE.MeshStandardMaterial({ color: '#c99a3c', metalness: 0.85, roughness: 0.3 });
    if (headBone) {
      const hp = new THREE.Vector3(); headBone.getWorldPosition(hp);
      const top = box.max.y, r = (top - hp.y) * 0.62;
      const helmet = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), glassMat); glass.renderOrder = 6; helmet.add(glass);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(r * 1.002, 24, 16, 0.6, 0.8, 0.5, 0.6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
      helmet.add(shine);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, r * 0.12, 8, 24), brass); collar.rotation.x = Math.PI / 2; collar.position.y = -r * 0.78; helmet.add(collar);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.2, r * 0.3, 10), brass); lamp.rotation.x = Math.PI / 2; lamp.position.set(0, r * 0.8, r * 0.45); helmet.add(lamp);
      attachToBone(obj, headBone, helmet, V(hp.x, hp.y + r * 0.82, hp.z + r * 0.04));
    }
    const chestBone = findBone(obj, 'chest');
    if (chestBone) {
      const cp = new THREE.Vector3(); chestBone.getWorldPosition(cp);
      const tanks = new THREE.Group(), tankMat = new THREE.MeshStandardMaterial({ color: '#ffcc33', metalness: 0.5, roughness: 0.35 });
      [-1, 1].forEach(s => {
        const t = new THREE.Mesh(new THREE.CapsuleGeometry(DIVER_H * 0.06, DIVER_H * 0.26, 4, 10), tankMat); t.position.x = s * DIVER_H * 0.065; tanks.add(t);
        const v = new THREE.Mesh(new THREE.CylinderGeometry(DIVER_H * 0.018, DIVER_H * 0.018, DIVER_H * 0.06, 6), brass); v.position.set(s * DIVER_H * 0.065, DIVER_H * 0.21, 0); tanks.add(v);
      });
      tanks.traverse(o => { if (o.isMesh) o.castShadow = true; });
      attachToBone(obj, chestBone, tanks, V(cp.x, cp.y + DIVER_H * 0.02, cp.z - DIVER_H * 0.2));
    }
    ['foot.l', 'foot.r'].forEach(n => {
      const b = findBone(obj, n); if (!b) return;
      const fp = new THREE.Vector3(); b.getWorldPosition(fp);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(DIVER_H * 0.11, DIVER_H * 0.015, DIVER_H * 0.26), new THREE.MeshStandardMaterial({ color: '#ffcc33', roughness: 0.5 }));
      fin.castShadow = true;
      attachToBone(obj, b, fin, V(fp.x, fp.y - DIVER_H * 0.02, fp.z + DIVER_H * 0.1));
    });
    // pivot the body around its middle so swimming tilts it forward in place
    obj.position.y = -CENTER; ch.tilt.position.y = CENTER;
  }
  function diverHeadPos() {
    const p = new THREE.Vector3();
    if (headBone) headBone.getWorldPosition(p); else p.copy(diver.holder.position).add(V(0, DIVER_H, 0));
    return p.add(V(0, 0.3, 0));
  }

  // ── Walking (swimming) the trail ──────────────────────────────────────
  const walker = createWalker({
    curve, speed: 3.4, accel: 6, brakeDecel: 5, reduceMotion, getTasks: () => tasks, walls,
    hooks: {
      stopFrac: sharkStopFrac, wallPause,
      place(frac, moving) {
        const p = curve.getPointAt(THREE.MathUtils.clamp(frac, 0, 1));
        swim.moving = moving;
        diver.holder.position.set(p.x, p.y - CENTER, p.z);
        diver.holder.rotation.y = P.heading;
      },
      runAnim(k) { play(diver, 'Running_A', { fade: 0.3, timeScale: 0.45 + k * 0.2 }); },
      idleAnim(pause, tick) {
        if (tick) { if (finished(diver)) play(diver, 'Idle', { fade: 0.4, timeScale: 0.7 }); return; }
        if (pause && diver.current !== diver.actions.Running_A) return;
        play(diver, 'Idle', { fade: 0.35, timeScale: 0.7 });
      },
      onFlag(i, t) {
        const f = flags[i];
        if (!f) return;
        openClam(f); f.pop = 1;
        const at = f.group.position.clone().add(V(0, 0.8, 0));
        sparkle(at, 40, ['#e0f7ff', '#ffffff', '#fff3b0'], 3);
        bubble(at, 12, 0.4, 0.14);
        if (P.mode !== 'finale') play(diver, 'Cheer', { fade: 0.2, once: true, timeScale: 1.2 });
        shell.spawnTaskLabel(f.group.position.clone().add(V(0, 3.9, 0)), t.title);
      },
      clearWall, restoreWall,
      startFinale, undoFinale: undoVictory, updateFinale, updateVictory,
    },
  });
  const P = walker.P;
  const swim = { moving: false, tilt: 0, bob: 0 };
  function updateDiver(dt, time) {
    if (!diver) return;
    diver.mixer.update(dt);
    walker.update(dt);
    const swimming = (P.mode === 'run' && swim.moving) || (P.mode === 'finale' && P.fin.swimming);
    const wantTilt = swimming ? 1.2 - P.pitch : 0.12;
    swim.tilt += (wantTilt - swim.tilt) * Math.min(1, dt * 3);
    diver.tilt.rotation.x = swim.tilt;
    diver.tilt.position.y = CENTER + (swimming ? 0 : Math.sin(time * 1.6) * 0.08);
    if (!reduceMotion && Math.floor(time / 1.7) !== Math.floor((time - dt) / 1.7)) bubble(diverHeadPos(), 4, 0.06, 0.1);
  }

  // ── Finale: open the treasure ─────────────────────────────────────────
  let lidOpen = 0;
  function once(key, fn) { if (!P.fin.steps.has(key)) { P.fin.steps.add(key); fn(); } }
  function startFinale() {
    if (P.won) return;
    P.mode = 'finale'; P.finT = 0;
    const from = diver.holder.position.clone();
    const to = chestFront.clone().add(V(0, 0.15, 0));
    P.fin = { from, to, steps: new Set(), swimming: true };
    if (reduceMotion) { settleWon(); victory(); }
  }
  function updateFinale(dt) {
    const t = (P.finT += dt), F = P.fin;
    const toChest = Math.atan2(chestPos.x - diver.holder.position.x, chestPos.z - diver.holder.position.z);
    P.heading = angleLerp(P.heading, toChest, Math.min(1, dt * 4)); diver.holder.rotation.y = P.heading;
    if (t < 1.6) {
      once('swim', () => play(diver, 'Running_A', { fade: 0.3, timeScale: 0.5 }));
      diver.holder.position.lerpVectors(F.from, F.to, smooth(0, 1.6, t));
    } else {
      F.swimming = false;
      once('reach', () => play(diver, 'Interact', { fade: 0.25, once: true }));
    }
    if (t > 2.0) { lidOpen = smooth(2.0, 3.0, t); chestLid.rotation.x = -lidOpen * 1.9; }
    if (t > 2.4) once('beam', () => {
      beam.visible = true; cam.shake = 0.15;
      sparkle(chestPos.clone().add(V(0, 1.2, 0)), 120, ['#ffe28a', '#ffd23f', '#ffffff'], 5);
      bubble(chestPos.clone().add(V(0, 1, 0)), 40, 0.6, 0.18);
      spillCoins(false);
      SCHOOLS.forEach(s => { s.target = chestPos.clone().add(V((rnd() - 0.5) * 4, 0, (rnd() - 0.5) * 4)); });
    });
    if (beam.visible) {
      beam.material.uniforms.uStrength.value = Math.min(1, beam.material.uniforms.uStrength.value + dt);
      chestGlow.material.opacity = Math.min(0.9, chestGlow.material.opacity + dt);
      if (!reduceMotion && rnd() < dt * 20) sparkle(chestPos.clone().add(V((rnd() - 0.5), 1 + rnd() * 2, (rnd() - 0.5))), 2, ['#ffe28a'], 1.5);
    }
    if (t > 3.6) once('win', victory);
  }
  function victory() {
    P.won = true;
    if (celebrationsOn) shell.showWin();
    play(diver, 'Cheer', { fade: 0.3 });
    P.mode = 'victory'; P.vicT = 0;
    notify();
    if (onSummitCb) { const cb = onSummitCb; onSummitCb = null; timers.push(setTimeout(cb, celebrationsOn ? 1800 : 0)); }
  }
  function updateVictory(dt) {
    P.vicT = (P.vicT || 0) + dt;
    const toCam = Math.atan2(camera.position.x - diver.holder.position.x, camera.position.z - diver.holder.position.z);
    P.heading = angleLerp(P.heading, toCam, Math.min(1, dt * 2.5)); diver.holder.rotation.y = P.heading;
    if (P.vicT > 6 && diver.current === diver.actions.Cheer) play(diver, 'Idle', { fade: 0.5, timeScale: 0.7 });
    if (!reduceMotion && celebrationsOn && rnd() < dt * 6) sparkle(chestPos.clone().add(V((rnd() - 0.5), 1 + rnd() * 2, (rnd() - 0.5))), 2, ['#ffe28a'], 1.2);
  }
  function settleWon() {
    diver.holder.position.copy(chestFront).add(V(0, 0.15, 0));
    lidOpen = 1; chestLid.rotation.x = -1.9;
    beam.visible = true; beam.material.uniforms.uStrength.value = 0.8; chestGlow.material.opacity = 0.8;
    spillCoins(true);
    P.fin = { steps: new Set(['swim', 'reach', 'beam', 'win']), swimming: false };
    P.won = true; P.mode = 'victory'; P.vicT = 99;
    play(diver, 'Idle', { fade: 0, timeScale: 0.7 });
  }
  function undoVictory() {
    P.won = false; P.mode = 'idle'; P.fin = {}; shell.winEl.hidden = true;
    lidOpen = 0; chestLid.rotation.x = 0;
    beam.visible = false; beam.material.uniforms.uStrength.value = 0; chestGlow.material.opacity = 0;
    coins.visible = false;
    SCHOOLS.forEach(s => { s.target = s.home.clone(); });
    play(diver, 'Idle', { fade: 0.2, timeScale: 0.7 });
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  const cam = { look: V(0, 1, 20), shake: 0 };
  const camDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
  function updateCamera(dt) {
    if (!diver) return;
    const dp = diver.holder.position;
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading));
    let rate = 3;
    if (P.mode === 'finale' || P.mode === 'victory') {
      const perp = V(endFlat.z, 0, -endFlat.x);
      camDesired.copy(chestPos).addScaledVector(endFlat, -6.5).addScaledVector(perp, 2.6).setY(chestPos.y + 2.8);
      lookDesired.copy(chestPos).addScaledVector(endFlat, -1).setY(chestPos.y + 1.4);
      rate = 1.8;
    } else if (shell.cam.mode === 'overview') {
      camDesired.set(34, SURFACE_Y - 1.5, 26);
      lookDesired.set(0, -2, -4);
    } else {
      const side = V(fwd.z, 0, -fwd.x);
      camDesired.copy(dp).addScaledVector(fwd, -5.6).addScaledVector(side, 1.4).setY(dp.y + 2.6);
      lookDesired.copy(dp).addScaledVector(fwd, 3).setY(dp.y + 0.8);
    }
    camDesired.y = Math.min(camDesired.y, SURFACE_Y - 0.8);
    const k = 1 - Math.exp(-dt * rate);
    camera.position.lerp(camDesired, k);
    cam.look.lerp(lookDesired, k);
    camera.lookAt(cam.look);
    if (cam.shake > 0 && !reduceMotion) { camera.position.add(rand3(cam.shake * 0.25)); cam.shake = Math.max(0, cam.shake - dt); }
    // water colour: bright near the surface, deep blue at the bottom
    const depth = THREE.MathUtils.clamp((slope(dp.z) - 3.5) / -8.5, 0, 1);
    scene.fog.color.copy(WATER_SHALLOW).lerp(WATER_DEEP, depth * 0.85);
    scene.background.copy(scene.fog.color);
    scene.fog.density = 0.024 + depth * 0.018;
    hemi.intensity = 1.2 - depth * 0.45;
    sun.intensity = 2.2 - depth * 0.9;
    sun.target.position.copy(dp); sun.position.copy(dp).addScaledVector(sunDir, 40);
    snow.position.copy(camera.position);
  }

  // ── Ghost, label, state ──────────────────────────────────────────────
  let ghost = null;
  function updateGhost(g) {
    if (!diver) return;
    if (!g || g.frac === null || g.frac === undefined) { if (ghost) ghost.holder.visible = false; return; }
    if (!ghost) {
      const obj = SkeletonUtils.clone(diver.obj);
      obj.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        Object.assign(o.material, { transparent: true, opacity: 0.35, depthWrite: false });
        o.castShadow = false;
      });
      const tilt = new THREE.Group(); tilt.add(obj); tilt.position.y = CENTER; tilt.rotation.x = 0.12;
      const holder = new THREE.Group(); holder.add(tilt); scene.add(holder);
      const mixer = new THREE.AnimationMixer(obj);
      const actions = {}; clips.forEach(c => { actions[c.name] = mixer.clipAction(c); });
      ghost = { holder, obj, mixer, actions, current: null };
      play(ghost, 'Idle', { fade: 0, timeScale: 0.7 });
    }
    const u = THREE.MathUtils.clamp(progressToPathFracSmooth(g.frac, tasks.length), 0, 1);
    const p = curve.getPointAt(u), t = curve.getTangentAt(u);
    ghost.holder.visible = true;
    ghost.holder.position.set(p.x, p.y - CENTER, p.z).addScaledVector(V(-t.z, 0, t.x).normalize(), -1.1);
    ghost.holder.rotation.y = Math.atan2(t.x, t.z);
  }
  function notify() {
    const n = tasks.length, done = tasks.filter(t => t.done).length;
    let text = n ? `Ocean Journey: ${done} of ${n} tasks done.` : 'Ocean Journey: no tasks yet.';
    const blocked = walls.find(w => !w.cleared && !w.clearing && wallFrac(w.taskIndex) <= walker.progressToFrac(done, n) + 1e-3);
    if (blocked) text += ` A shark blocks the way: ${tasks[blocked.taskIndex].blocker}.`;
    if (n && done === n) text += P.won ? ' The treasure is found!' : ' Opening the treasure chest.';
    shell.root.setAttribute('aria-label', text);
  }
  let latestState = null, layoutSig = null;
  const toTasks = stageTasks;
  function snapCamera() {
    const fwd = V(Math.sin(P.heading), 0, Math.cos(P.heading)), dp = diver.holder.position;
    camera.position.copy(dp).addScaledVector(fwd, -5.6).setY(Math.min(dp.y + 2.6, SURFACE_Y - 0.8));
    cam.look.copy(dp).addScaledVector(fwd, 3).setY(dp.y + 0.8);
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
      tasks.forEach((t, i) => { if (t.done) openClam(flags[i], true); });
      walker.reset();
      play(diver, 'Idle', { fade: 0.2, timeScale: 0.7 });
      if (n && tasks.every(t => t.done)) settleWon();
      if (firstBuild) snapCamera();
    } else {
      next.forEach((t, i) => { tasks[i].done = t.done; tasks[i].title = t.title; tasks[i].blocker = t.blocker; tasks[i].foes = t.foes; });
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
    updateDiver(dt, time);
    updateWalls(dt, time);
    updateFish(time, dt);
    updateCritters(time);
    updateCoins(dt);
    flags.forEach(f => {
      f.open += (f.openTarget - f.open) * Math.min(1, dt * 3);
      f.hinge.rotation.x = -f.open;
      const lit = THREE.MathUtils.clamp((f.open - 0.5) / 0.5, 0, 1);
      f.pearl.material.emissiveIntensity = lit * 1.4;
      f.glow.material.opacity = lit * (0.7 + Math.sin(time * 2 + f.group.position.x) * 0.15);
      f.fl.position.y = 2.75 + Math.sin(time * 1.3 + f.group.position.z) * 0.08;
      if (f.pop > 0) { f.pop = Math.max(0, f.pop - dt * 1.6); f.group.scale.setScalar(1 + Math.sin((1 - f.pop) * Math.PI) * 0.25); }
      if (f.ring.visible) { f.ring.scale.setScalar(1 + 0.15 * Math.sin(time * 4)); f.ring.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4)); }
    });
    // vents on the floor breathe streams of bubbles
    if (!reduceMotion && rnd() < dt * 6) vents.forEach(v => bubble(v, 1, 0.1, 0.1 + rnd() * 0.08));
    shafts.forEach(s => { s.m.rotation.z = -0.22 + Math.sin(time * 0.2 + s.ph) * 0.06; });
    surfaceTex.offset.set(time * 0.01, time * 0.006);
    const sp = snow.geometry.attributes.position;
    for (let i = 0; i < SNOW; i++) { let y = sp.getY(i) - dt * 0.15; if (y < -9) y += 18; sp.setY(i, y); }
    sp.needsUpdate = true;
    sparks.update(dt); bubbles.update(dt);
    if (ghost && ghost.holder.visible) ghost.mixer.update(dt);
    updateCamera(dt);
    shell.updateTaskLabels(camera);
  }
  const vents = [];
  for (let k = 0; k < 6; k++) { const p = flatCurve.getPointAt(0.1 + k * 0.15); const x = p.x + (k % 2 ? 4 : -4.5), z = p.z + (rnd() - 0.5) * 3; vents.push(V(x, groundHeight(x, z) + 0.1, z)); }
  const loop = createLoop(shell, camera, scene, simulate, (w, h) => { scaleU.value = particleScaleFor(renderer, camera, h); });

  loadGLTF(loader, DIVER_URL).then(gltf => {
    if (loop.destroyed) return;
    clips = gltf.animations;
    dressDiver(gltf.scene);
    diver = makeCharacter(scene, gltf.scene, clips, DIVER_H);
    rigDiver(diver);
    play(diver, 'Idle', { fade: 0, timeScale: 0.7 });
    shell.loadingEl.hidden = true;
    loop.setReady();
    if (latestState) applyState(latestState);
    loop.start();
  }).catch(err => {
    console.error('Ocean 3D: could not load the diver', err);
    shell.loadingEl.textContent = 'Couldn’t load the 3D diver. Switch the scene to Ocean for the 2D version.';
  });

  return {
    sync(state) {
      latestState = state;
      celebrationsOn = state.celebrationsEnabled !== false;
      if (diver) applyState(state);
    },
    pause: loop.stop,
    resume: loop.start,
    destroy() { loop.destroy(container); },
    _debug: {
      step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) simulate(1 / 30); },
      get state() {
        return {
          ready: !!diver, frac: P.frac, mode: P.mode, won: P.won, stops: P.stops.length, finT: P.finT,
          flagFracs: tasks.map((t, i) => checkpointFrac(i, tasks.length)), walls: walls.map(w => ({ task: w.taskIndex, cleared: w.cleared })),
          lid: +lidOpen.toFixed(2), coins: coins.visible, ghost: ghost ? ghost.holder.visible : false, label: shell.root.getAttribute('aria-label'),
          clams: flags.map(f => +f.open.toFixed(2)),
          onPath: diver && P.mode !== 'finale' && P.mode !== 'victory' ? (() => { let d = 1e9; for (let i = 0; i <= 400; i++) d = Math.min(d, curve.getPointAt(i / 400).distanceTo(tmpV.copy(diver.holder.position).add(V(0, CENTER, 0)))); return d; })() : 0,
        };
      },
    },
  };
}
