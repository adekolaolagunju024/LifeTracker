/* global document, APP, showPage, setJourneyTheme, setJourneyView, openAssistant, renderAssistantEdits */
// Live product screenshots for the landing page, so it always shows the
// app as it is today rather than a recording that goes stale.
//
// After each deploy the server starts a private copy of itself with a
// throwaway database (never the real one), fills it with a demo goal
// through the ordinary API, opens the real app in Chromium (the same one
// the Gantt image export uses) and screenshots it: the Journey, every
// stage, the Planner, a project, the assistant and the phone layout. The
// pictures are served at /showcase/<name>.webp; until they exist (or if
// this fails, or on a machine without Chromium) the copies committed in
// frontend/media/showcase are served instead.
//
// `npm run showcase` refreshes those committed copies.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const GENERATED_DIR = process.env.SHOWCASE_DIR || path.join(os.tmpdir(), 'waypoint-showcase');
const FALLBACK_DIR = path.join(__dirname, '../frontend/media/showcase');
const STAGES = require('../frontend/data/product.json').stages.map(s => s.id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Where a showcase picture is served from: this deploy's fresh capture if
// there is one, else the committed fallback. Null for anything else.
function showcaseFile(name) {
  if (!/^[a-z0-9-]+\.webp$/.test(name)) return null;
  for (const dir of [GENERATED_DIR, FALLBACK_DIR]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

// A private copy of the server on its own port and its own database, with
// every outside service switched off (no email, AI, push or backups).
async function startPrivateServer() {
  const port = await freePort();
  const dbPath = path.join(os.tmpdir(), `waypoint-showcase-${process.pid}-${Date.now()}.sqlite`);
  const env = { ...process.env, PORT: String(port), DB_PATH: dbPath, SHOWCASE_CHILD: '1', NODE_ENV: 'showcase', SESSION_SECRET: crypto.randomBytes(16).toString('hex') };
  for (const key of ['SENTRY_DSN', 'RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) delete env[key];
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  const stop = () => {
    child.kill();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  };
  return { base, stop };
}

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// A believable goal: a few phases, some tasks done, blockers (some cleared),
// a dependency and a short assistant chat. Returns the session cookie and ids.
async function seedDemo(base) {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  await call('POST', '/api/auth/register', { email: `showcase-${Date.now()}@example.com`, password: crypto.randomBytes(12).toString('hex'), acceptTerms: true });
  await call('PUT', '/api/profile', { name: 'Alex Morgan', tagline: 'One step at a time', onboarded: true, celebrationEffectsEnabled: false });

  const goal = await call('POST', '/api/projects', { title: 'Open a neighbourhood bakery', icon: '🥐', color: '#0A7E8C', startDate: day(-21) });
  const phase = async title => call('POST', '/api/projects', { title, parentId: goal.id, icon: '📁', color: '#0A7E8C' });
  const prep = await phase('Groundwork');
  const fitOut = await phase('Fit-out');
  const launch = await phase('Opening');
  const task = (projectId, title, startDate, endDate, extra = {}) => call('POST', '/api/tasks', { projectId, title, startDate, endDate, priority: 'Medium', ...extra });

  const plan = await task(prep.id, 'Write the business plan', day(-21), day(-14), { priority: 'High' });
  const lease = await task(prep.id, 'Sign the lease', day(-14), day(-6), { priority: 'High' });
  const loan = await task(prep.id, 'Secure the start-up loan', day(-12), day(-1));
  const kitchen = await task(fitOut.id, 'Install the kitchen', day(-2), day(9), { priority: 'High' });
  const hygiene = await task(fitOut.id, 'Pass the hygiene inspection', day(6), day(12));
  const bakers = await task(fitOut.id, 'Hire two bakers', day(2), day(14), { targetCount: 2, targetUnit: 'bakers' });
  const menu = await task(launch.id, 'Test the opening menu', day(10), day(18));
  const opening = await task(launch.id, 'Opening day', day(20), day(21), { priority: 'High' });

  for (const t of [plan, lease, loan]) await call('PUT', `/api/tasks/${t.id}`, { status: 'Completed' });
  await call('PUT', `/api/tasks/${kitchen.id}/predecessors`, { predecessorIds: [lease.id] });
  await call('PUT', `/api/tasks/${hygiene.id}/predecessors`, { predecessorIds: [kitchen.id] });
  await call('PUT', `/api/tasks/${opening.id}/predecessors`, { predecessorIds: [hygiene.id, bakers.id] });
  await call('PUT', `/api/tasks/${kitchen.id}`, { status: 'In Progress' });
  const oven = await call('POST', `/api/tasks/${kitchen.id}/obstacles`, { name: 'Oven delivery late', count: 2 });
  await call('POST', `/api/tasks/${kitchen.id}/obstacles`, { name: 'Electrician booked', count: 1 });
  await call('PUT', `/api/tasks/obstacles/${oven.id}`, { resolved: true });
  await call('POST', `/api/tasks/${hygiene.id}/obstacles`, { name: 'Permit pending', count: 2 });
  await call('POST', `/api/tasks/${opening.id}/obstacles`, { name: 'Staff not trained', count: 3 });
  await call('PUT', `/api/tasks/${bakers.id}`, { progressCount: 1 });
  await call('PUT', `/api/ai/conversations/showcase-chat-0001`, { projectId: goal.id, messages: [
    { role: 'user', content: 'The oven is late. Push the hygiene inspection back a week and add a task to book the electrician.' },
    { role: 'assistant', content: 'Here are the changes I suggest. Tick the ones you want and press Apply.' },
  ] });
  return { cookie, projectId: goal.id, ids: { menuId: menu.id, hygieneId: hygiene.id, kitchenId: kitchen.id, fitOutId: fitOut.id, later: day(13), laterDue: day(19), soon: day(3) } };
}

async function capture({ base, cookie, projectId, ids }, outDir) {
  const puppeteer = require('puppeteer-core');
  const { findBrowser } = require('./reports/visual');
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--lang=en-GB'],
  });
  const [name, value] = cookie.split('=');
  const written = [];
  const save = async (target, file) => {
    const out = path.join(outDir, file);
    await target.screenshot({ path: out, type: 'webp', quality: 82 });
    written.push(file);
  };
  try {
    const page = await browser.newPage();
    await page.setCookie({ name, value, url: base });
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'language', { get: () => 'en-GB' });
      try { localStorage.setItem('journeyView', '2d'); localStorage.setItem('journeyTheme', 'football'); } catch { /* storage off */ }
    });
    await page.goto(`${base}/app`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.getElementById('auth-overlay').classList.contains('open'), { timeout: 20000 });
    await sleep(800);
    const hideChrome = () => page.evaluate(() => {
      document.querySelectorAll('.onboarding-overlay.open, #new-version-notice, #toast').forEach(el => el.remove());
    });

    // Planner (Gantt) and the project page
    const pickProject = id => { const sel = document.getElementById('gantt-project-filter'); sel.value = id; sel.dispatchEvent(new Event('change')); };
    await page.evaluate(() => showPage('gantt'));
    await sleep(1000);
    await page.evaluate(pickProject, projectId);
    await sleep(1500); await hideChrome();
    await save(page, 'planner.webp');
    await page.evaluate(id => showPage('project-detail', id), projectId);
    await sleep(1500); await hideChrome();
    await save(page, 'project.webp');

    // The assistant, reopening the seeded chat
    // ...showing the kind of change list it proposes, ready to approve
    await page.evaluate(id => openAssistant(id), projectId);
    await sleep(1500);
    await page.evaluate(ids => {
      APP.assistantMessages.pop();
      document.querySelector('#assistant-chat > :last-child')?.remove();
      renderAssistantEdits({ summary: 'Here are the changes I suggest. Tick the ones you want and press Apply.', operations: [
        { type: 'updateTask', taskId: ids.hygieneId, currentTitle: 'Pass the hygiene inspection', fields: { startDate: ids.later, endDate: ids.laterDue }, reason: 'The kitchen needs the oven before the inspection.' },
        { type: 'addTask', phaseId: ids.fitOutId, task: { title: 'Book the electrician', priority: 'High', endDate: ids.soon }, reason: 'Needed before the oven can be fitted.' },
        { type: 'addPredecessor', taskId: ids.menuId, taskTitle: 'Test the opening menu', predecessorId: ids.kitchenId, predecessorTitle: 'Install the kitchen', reason: 'You need the ovens to test the menu.' },
      ] });
    }, ids);
    await sleep(600); await hideChrome();
    await save(page, 'assistant.webp');
    await page.evaluate(() => document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')));

    // The Journey: every stage in 2D, then the hero shot in 3D
    await page.evaluate(id => { showPage('gantt'); document.querySelector('#gantt-page-view-toggle [data-pageview="journey"]').click(); const sel = document.getElementById('gantt-project-filter'); sel.value = id; sel.dispatchEvent(new Event('change')); }, projectId);
    await sleep(2500);
    for (const stage of STAGES) {
      await page.evaluate(s => setJourneyTheme(s), stage);
      await sleep(2200); await hideChrome();
      const scene = await page.$('#mountain-scene-wrap');
      if (scene) await save(scene, `stage-${stage}.webp`);
    }
    await page.evaluate(() => { setJourneyTheme('launch'); setJourneyView('3d', 'follow'); });
    try {
      await page.waitForFunction(() => { const c = document.getElementById('mountain-scene'); return c._j3d && c._j3d._debug.state.ready; }, { timeout: 90000 });
      await sleep(2500);
    } catch {
      await page.evaluate(() => setJourneyView('2d'));
      await sleep(2000);
    }
    await hideChrome();
    const hud = await page.$('#journey-hud');
    if (hud) await save(hud, 'journey.webp');
    await page.evaluate(() => setJourneyView('2d'));

    // The phone layout
    const phone = await browser.newPage();
    await phone.setCookie({ name, value, url: base });
    await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await phone.goto(`${base}/app`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    await phone.evaluate(() => document.querySelectorAll('.onboarding-overlay.open, #new-version-notice, #toast').forEach(el => el.remove()));
    await save(phone, 'phone.webp');
  } finally {
    await browser.close();
  }
  return written;
}

// Captures everything into `outDir`. Each picture is written in place as
// it's taken, so a failure part-way leaves the earlier ones (and the
// committed fallbacks cover the rest).
async function generateShowcase(outDir = GENERATED_DIR) {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await startPrivateServer();
  try {
    const demo = await seedDemo(server.base);
    return await capture({ base: server.base, ...demo }, outDir);
  } finally {
    server.stop();
  }
}

// Called once after the real server starts in production.
function scheduleShowcase() {
  setTimeout(() => {
    const started = Date.now();
    generateShowcase()
      .then(files => console.log(`📸 Landing page screenshots refreshed (${files.length} in ${Math.round((Date.now() - started) / 1000)}s)`))
      .catch(e => console.error('Landing page screenshots failed (the committed ones are used instead):', e.message));
  }, 20000).unref();
}

module.exports = { showcaseFile, generateShowcase, scheduleShowcase, STAGES };

if (require.main === module) {
  const outDir = process.argv[2] || FALLBACK_DIR;
  generateShowcase(outDir).then(files => { console.log(`Wrote ${files.length} screenshots to ${outDir}:`, files.join(', ')); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
