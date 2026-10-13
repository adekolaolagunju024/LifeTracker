/* global document, window, getComputedStyle, DayRoad, API, APP, showAuthView, openAddTask, saveTask, showPage -- these run inside the page (page.evaluate) */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../helpers/server');

// ── THE CORE FLOWS, IN A REAL BROWSER ───────────────────────────
// What a new person does on day one, at a phone's width and a computer's:
// sign up, plan today in the first run, start the first task, finish it,
// add another. Run with `npm run test:e2e`; CI runs it on every pull
// request. It needs Chrome or Chromium: CHROME_PATH, else the usual places.
const CHROME = [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find(p => p && fs.existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SIZES = [{ name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true }, { name: 'desktop', width: 1280, height: 900 }];

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

// A fresh page in its own browser context (no shared storage), failing the
// test on any uncaught error in the page.
async function freshPage(size) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(size);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  return { page, ctx, errors };
}
async function waitFor(page, fn, arg, what, ms = 15000) {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg); } catch {
    // A picture of where it stuck, for the CI artifact.
    try { fs.mkdirSync('test-results', { recursive: true }); await page.screenshot({ path: `test-results/stuck-${what.replace(/[^a-z0-9]+/gi, '-')}.png` }); } catch { /* best effort */ }
    assert.fail(`Timed out waiting for ${what}`);
  }
}

for (const size of SIZES) {
  test(`${size.name}: sign up, plan today, focus, finish, add a task`, { skip: !CHROME && 'no Chrome found (set CHROME_PATH)' }, async () => {
    const { page, ctx, errors } = await freshPage(size);
    const email = `e2e_${size.name}_${Date.now()}@example.com`;

    // Sign up through the real form.
    await page.goto(`${server.base}/app`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => showAuthView('register'));
    await page.type('#auth-register-email', email);
    await page.type('#auth-register-password', 'testpass123');
    await page.type('#auth-register-confirm', 'testpass123');
    await page.click('#auth-register-terms');
    await page.evaluate(() => document.querySelector('#auth-register-email').form.requestSubmit());

    // The first run opens: name, goal, three tasks, plan today.
    await waitFor(page, () => document.getElementById('onboarding-overlay')?.classList.contains('open'), null, 'the first run to open');
    await page.type('#onb-name', 'Robin');
    await page.click('.onb-kinds [data-kind="learning"]');
    await page.type('#onb-proj-title', 'Pass the statistics exam');
    await page.click('#onb-next-btn');
    await waitFor(page, () => document.getElementById('onb-step-2').classList.contains('active'), null, 'step 2');
    const suggested = await page.$$eval('#onb-tasks input', els => els.map(e => e.value));
    assert.equal(suggested.filter(Boolean).length, 3, 'three suggested tasks');
    await page.click('#onb-next-btn');
    await waitFor(page, () => document.querySelectorAll('#onb-plan li').length === 3, null, 'the plan for today');
    await page.click('#onb-next-btn');

    // The dashboard shows today's road and the way to start.
    await waitFor(page, () => !document.getElementById('onboarding-overlay').classList.contains('open')
      && window.DayRoad && DayRoad.state() && DayRoad.state().items.length === 3, null, "today's road with three stops");
    await waitFor(page, () => /Start the first task/.test(document.querySelector('.brief-go')?.textContent || ''), null, 'the Start the first task button');
    assert.match(await page.$eval('#page-dashboard', el => el.innerText), /Good (morning|afternoon|evening), Robin/);

    // Start the first task: the focus timer runs on it.
    await page.click('.brief-go');
    await waitFor(page, () => document.querySelector('#focus-hud .focus-time'), null, 'the focus timer');
    const focusing = await page.$eval('#focus-hud .focus-title', el => el.textContent);
    const first = await page.evaluate(() => DayRoad.state().items[0].task.title);
    assert.equal(focusing, first);

    // Finish it from today's road: one of three done, and the timer stops.
    await page.evaluate(() => DayRoad.toggleDone(DayRoad.state().items[0].taskId));
    await waitFor(page, () => DayRoad.state().items[0].done, null, 'the first task to be done');
    await waitFor(page, () => !document.querySelector('#focus-hud .focus-time') || /Focusing/.test(document.querySelector('#focus-hud .focus-kicker')?.textContent || '') === false, null, 'the timer to stop on the finished task');

    // Add a task through the task form; it shows in the project.
    const projectId = await page.evaluate(async () => (await API.getProjects())[0].id);
    await page.evaluate(id => openAddTask(id), projectId);
    await waitFor(page, () => document.getElementById('task-title-in')?.offsetParent, null, 'the task form');
    await page.type('#task-title-in', 'Book a study room');
    await page.evaluate(() => saveTask());
    await waitFor(page, async () => (await API.getTasks()).some(t => t.title === 'Book a study room'), null, 'the new task to save');
    await page.evaluate(id => showPage('project-detail', id), projectId);
    await waitFor(page, () => /Book a study room/.test(document.getElementById('task-table-body')?.innerText || ''), null, 'the new task in the project');

    assert.deepEqual(errors, [], 'no errors in the page');
    await ctx.close();
  });
}

test('phone: no page scrolls sideways', { skip: !CHROME && 'no Chrome found (set CHROME_PATH)' }, async () => {
  const { page, ctx, errors } = await freshPage(SIZES[0]);
  await page.goto(`${server.base}/app`, { waitUntil: 'networkidle0' });
  await page.evaluate(async email => { await API.register(email, 'testpass123', true); await API.updateProfile({ onboarded: true }); }, `e2e_wide_${Date.now()}@example.com`);
  await page.goto(`${server.base}/app`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => typeof APP !== 'undefined' && APP.currentPage === 'dashboard', null, 'the dashboard');
  const wide = [];
  for (const id of ['dashboard', 'projects', 'gantt', 'actions', 'calendar', 'chats', 'why', 'settings']) {
    await page.evaluate(p => showPage(p), id);
    await sleep(700);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 391) wide.push(`${id} (${w}px)`);
  }
  assert.deepEqual(wide, [], 'pages wider than the phone');
  assert.deepEqual(errors, [], 'no errors in the page');
  await ctx.close();
});

test('every button and field on the main pages has a name', { skip: !CHROME && 'no Chrome found (set CHROME_PATH)' }, async () => {
  const { page, ctx } = await freshPage(SIZES[1]);
  await page.goto(`${server.base}/app`, { waitUntil: 'networkidle0' });
  // The sign-in page first, before anyone is signed in.
  const unnamed = async where => (await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const name = el => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent
      || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest('label')?.textContent
      || el.getAttribute('title') || el.getAttribute('placeholder') || (/^(BUTTON|A)$/.test(el.tagName) || el.getAttribute('role') === 'button' ? el.textContent || [...el.querySelectorAll('img[alt]')].map(i => i.alt).join(' ') : '') || '').trim();
    return [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')]
      .filter(visible).filter(el => !name(el))
      .map(el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''}`);
  })).map(s => `${where}: ${s}`);
  const missing = await unnamed('sign-in');
  await page.evaluate(async email => { await API.register(email, 'testpass123', true); await API.updateProfile({ onboarded: true }); }, `e2e_a11y_${Date.now()}@example.com`);
  await page.goto(`${server.base}/app`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => typeof APP !== 'undefined' && APP.currentPage === 'dashboard', null, 'the dashboard');
  for (const id of ['dashboard', 'projects', 'gantt', 'actions', 'calendar', 'why', 'settings']) {
    await page.evaluate(p => showPage(p), id);
    await sleep(700);
    missing.push(...await unnamed(id));
  }
  assert.deepEqual([...new Set(missing)], [], 'controls a screen reader can only call "button"');
  await ctx.close();
});
