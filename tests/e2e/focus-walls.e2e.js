/* global document, API, Jarvis */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { startServer } = require('../helpers/server');

// ── FOCUS WALLPAPERS ────────────────────────────────────────────
// The full-screen timer has a wallpaper picker: their stage, or calm,
// sunrise, forest, ocean, night sky or plain. The pick sticks.
const CHROME = [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find(p => p && fs.existsSync(p));

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

test('focus wallpapers: pick one and it sticks', { skip: !CHROME && 'no Chrome found (set CHROME_PATH)' }, async () => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${server.base}/app`, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    await API.register(`walls_${Date.now()}@example.com`, 'testpass123', true);
    await API.updateProfile({ name: 'Ada', onboarded: true });
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => { Jarvis.freeFocus(25); Jarvis.fullOpen(); });
  await page.waitForSelector('#focus-full.wall-journey', { timeout: 15000 });
  await page.click('.ff-wall-btn');
  const names = await page.evaluate(() => [...document.querySelectorAll('.ff-walls [role=radio]')].map(b => b.textContent.trim()));
  assert.deepEqual(names, ['My stage', 'Calm', 'Sunrise', 'Forest', 'Ocean', 'Night sky', 'Plain']);
  await page.click('.ff-wall-night');
  await page.waitForSelector('#focus-full.wall-night.ff-dark .ff-sky', { timeout: 15000 });
  // it sticks across a reload
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => Jarvis.fullOpen());
  await page.waitForSelector('#focus-full.wall-night', { timeout: 15000 });
  // with the game layer hidden, their stage isn't offered and calm stands in
  await page.evaluate(() => { localStorage.setItem('wp-focus-wall', '"journey"'); document.documentElement.classList.add('focus-mode'); Jarvis.setWall('journey'); });
  await page.waitForSelector('#focus-full.wall-calm', { timeout: 15000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});
