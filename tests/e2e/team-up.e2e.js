/* global document, API, showPage, APP */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../helpers/server');

// ── TEAM UP: ONE DOOR ───────────────────────────────────────────
// Bringing people onto a goal is one button, Team up, with three ways
// (collaborate, group, challenge) and plain view or edit
// access by email inside it. Someone the goal is shared with sees People.
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

test('team up: one button, three ways, email access inside it', { skip: !CHROME && 'no Chrome found (set CHROME_PATH)' }, async () => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${server.base}/app`, { waitUntil: 'networkidle0' });
  const gid = await page.evaluate(async () => {
    await API.register(`team_${Date.now()}@example.com`, 'testpass123', true);
    await API.updateProfile({ name: 'Ada', onboarded: true });
    const g = await API.addProject({ title: 'Charity fun run', isGoal: true });
    await API.addTask({ projectId: g.id, title: 'Book the park', status: 'Not Started', priority: 'Medium' });
    return g.id;
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(id => showPage('project-detail', id), gid);
  await page.waitForFunction(() => document.getElementById('btn-share-label').textContent === 'Team up', { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.getElementById('btn-race-friend').textContent.trim()), 'Team up');
  // the old phone-only Share item is gone from the menu
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#detail-more-menu button')].filter(b => /openShareProject/.test(b.getAttribute('onclick') || '')).length), 0);

  await page.click('#btn-share-project');
  await page.waitForSelector('.race-mode [data-mode="split"]', { timeout: 15000 });
  const modes = await page.evaluate(() => [...document.querySelectorAll('.race-mode button')].map(b => [b.textContent.trim(), b.getAttribute('aria-checked')]));
  assert.deepEqual(modes, [['Collaborate', 'true'], ['Group', 'false'], ['Challenge', 'false']]);
  // email access is inside: it opens the share list for this goal
  await page.click('#team-email');
  // openShareProject fetches the goal first, so wait for it to settle
  await page.waitForFunction(id => APP.shareModalProjectId === id && !document.getElementById('modal-share').classList.contains('hidden'), { timeout: 15000 }, gid);
  await sleep(200);
  assert.deepEqual(errors, []);
  await ctx.close();
});
