/* global document, window, API, Replays, showPage, playJourneyFor */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../helpers/server');

// ── REPLAYS ANYWHERE ────────────────────────────────────────────
// A step or a blocker ticked off away from the Journey plays (or offers)
// its moment on the goal's world: Settings → Replays (play / ask / off),
// a goal's own Quiet / Always, the finish of a whole goal, and nothing
// at all while that goal's Journey is the thing on screen.
const CHROME = [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find(p => p && fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let server;
let browser;
before(async () => {
  if (!CHROME) return;
  server = await startServer();
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await server.stop();
});

async function waitFor(page, fn, arg, what, ms = 20000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg); } catch {
    try { fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: `test-results/stuck-${what.replace(/[^a-z0-9]+/gi, '-')}.png` }); } catch { /* best effort */ }
    assert.fail(`Timed out waiting for ${what}`);
  }
}

// Signed in, on the dashboard, with a goal of four steps; the third has a blocker.
async function setUp(width = 1280, height = 900) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${server.base}/app`, { waitUntil: 'networkidle0' });
  const ids = await page.evaluate(async () => {
    await API.register(`replay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`, 'testpass123', true);
    await API.updateProfile({ name: 'Ada', onboarded: true });
    localStorage.setItem('journeyView', '2d');
    const g = await API.addProject({ title: 'Run a 5K', isGoal: true });
    const ids = [];
    for (const title of ['Buy shoes', 'Run 3K', 'Run 4K', 'Race day']) ids.push((await API.addTask({ projectId: g.id, title, status: 'Not Started', priority: 'Medium' })).id);
    const ob = await API.addObstacle(ids[2], 'Sore knee', 1);
    return { gid: g.id, ids, ob: ob.id };
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => showPage('dashboard'));
  return { page, ctx, errors, ids };
}
const miniUp = page => page.evaluate(() => !!document.getElementById('replay-mini'));
const toastText = page => page.evaluate(() => (document.getElementById('undo-toast') || {}).textContent || '');

test('replays: ask offers Watch, play plays in the corner, off and a quiet goal stay still', { skip: !CHROME && 'no Chrome found (set CHROME_PATH)' }, async () => {
  const { page, ctx, errors, ids } = await setUp();

  // Ask (the default): a blocker ticked off away from the Journey offers Watch.
  assert.equal(await page.evaluate(() => Replays.mode()), 'ask');
  await page.evaluate(ob => API.updateObstacle(ob, { resolved: true }), ids.ob);
  await waitFor(page, () => /Knocked out “Sore knee”/.test((document.getElementById('undo-toast') || {}).textContent || ''), null, 'the Watch toast');
  assert.equal(await miniUp(page), false, 'nothing plays until asked');
  await page.evaluate(() => [...document.querySelectorAll('#undo-toast button')].find(b => /watch/i.test(b.textContent)).click());
  await waitFor(page, () => !!document.querySelector('#replay-mini #replay-mini-scene svg'), null, 'the corner player with its world');
  await waitFor(page, () => /Sore knee/.test(document.querySelector('#replay-mini .replay-mini-cap').textContent), null, 'the knockout caption');
  await page.evaluate(() => Replays.close());

  // Play: a step done plays straight away, no toast needed.
  await page.evaluate(() => Replays.setMode('play'));
  await page.evaluate(id => API.updateTask(id, { status: 'Completed' }), ids.ids[0]);
  await waitFor(page, () => /Buy shoes/.test((document.querySelector('#replay-mini .replay-mini-cap') || {}).textContent || ''), null, 'the step playing in the corner');
  assert.doesNotMatch(await toastText(page), /Watch/i);
  await page.evaluate(() => Replays.close());

  // Off: nothing.
  await page.evaluate(() => Replays.setMode('off'));
  await page.evaluate(id => API.updateTask(id, { status: 'Completed' }), ids.ids[1]);
  await sleep(2500);
  assert.equal(await miniUp(page), false, 'off plays nothing');
  assert.doesNotMatch(await toastText(page), /Watch/i);

  // A quiet goal stays still even with replays set to play.
  await page.evaluate(gid => { Replays.setMode('play'); Replays.setGoalMode(gid, 'quiet'); }, ids.gid);
  await page.evaluate(id => API.updateTask(id, { status: 'In Progress' }).then(() => API.updateTask(id, { status: 'Not Started' })), ids.ids[1]);
  await page.evaluate(id => API.updateTask(id, { status: 'Completed' }), ids.ids[1]);
  await sleep(2500);
  assert.equal(await miniUp(page), false, 'a quiet goal plays nothing');

  // …and "always" plays even with replays off.
  await page.evaluate(gid => { Replays.setMode('off'); Replays.setGoalMode(gid, 'always'); }, ids.gid);
  await page.evaluate(id => API.updateTask(id, { status: 'Not Started' }).then(() => API.updateTask(id, { status: 'Completed' })), ids.ids[1]);
  await waitFor(page, () => !!document.getElementById('replay-mini'), null, 'an always goal playing with replays off');
  await page.evaluate(() => Replays.close());

  assert.deepEqual(errors, []);
  await ctx.close();
});

test('replays: finishing a goal runs to the line, then "You did it" with Watch the finish', { skip: !CHROME && 'no Chrome found (set CHROME_PATH)' }, async () => {
  const { page, ctx, errors, ids } = await setUp(390, 844);
  await page.evaluate(async ({ ids, ob }) => { await API.updateObstacle(ob, { resolved: true }); for (const id of ids.slice(0, 3)) await API.updateTask(id, { status: 'Completed' }); }, ids);
  await sleep(1500);
  await page.evaluate(() => { Replays.close(); Replays.setMode('play'); });
  await page.evaluate(id => API.updateTask(id, { status: 'Completed' }), ids.ids[3]);
  await waitFor(page, () => !!document.getElementById('replay-mini'), null, 'the finish replay');
  assert.equal(await page.evaluate(() => document.getElementById('project-complete-overlay').classList.contains('hidden')), true, '"You did it" waits for the replay');
  await waitFor(page, () => !document.getElementById('project-complete-overlay').classList.contains('hidden'), null, '"You did it" after the finish', 45000);
  assert.equal(await page.evaluate(() => document.getElementById('project-complete-watch').classList.contains('hidden')), false, 'it offers Watch the finish');
  // On a phone the player is a card at the top right, clear of the bottom bar and toasts.
  await page.evaluate(() => document.getElementById('project-complete-watch').click());
  await waitFor(page, () => !!document.getElementById('replay-mini'), null, 'watching the finish again');
  await sleep(600); // past its slide-in
  const box = await page.evaluate(() => { const r = document.getElementById('replay-mini').getBoundingClientRect(); return { top: r.top, right: window.innerWidth - r.right, width: r.width, bottom: window.innerHeight - r.bottom }; });
  assert.ok(box.top >= 60 && box.right <= 12 && box.width <= 200 && box.bottom > 200, JSON.stringify(box));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('replays: nothing plays while that goal’s Journey is on screen', { skip: !CHROME && 'no Chrome found (set CHROME_PATH)' }, async () => {
  const { page, ctx, errors, ids } = await setUp();
  await page.evaluate(gid => { Replays.setMode('play'); playJourneyFor(gid); }, ids.gid);
  await waitFor(page, () => !!document.querySelector('#mountain-scene svg'), null, 'the Journey');
  await page.evaluate(id => API.updateTask(id, { status: 'Completed' }), ids.ids[0]);
  await sleep(2500);
  assert.equal(await miniUp(page), false, 'the Journey already shows it');
  assert.deepEqual(errors, []);
  await ctx.close();
});
