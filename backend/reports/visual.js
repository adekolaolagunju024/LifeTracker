const fs   = require('fs');
const puppeteer = require('puppeteer-core');

// Finds a locally installed Chromium-family browser so we don't need to
// bundle/download one. Set PUPPETEER_EXECUTABLE_PATH to override (needed
// on most cloud hosts — see .env.example).
function findBrowser() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) {
    throw new Error('No local Chromium/Chrome/Edge found for PDF/image export. Set PUPPETEER_EXECUTABLE_PATH in .env to a browser binary.');
  }
  return found;
}

const esc = s => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n, cur = '£') => cur + Math.round(n || 0).toLocaleString();
const pct = (a, b) => b > 0 ? Math.min(Math.round((a / b) * 100), 100) : 0;

function reportHtml(snapshot) {
  const { profile, projects, tasks, wealth } = snapshot;
  const done  = tasks.filter(t => t.status === 'Completed').length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdueCount = tasks.filter(t => t.status !== 'Completed' && t.endDate && new Date(t.endDate) < today).length;
  const cur     = profile.currency || '£';
  const goalsPct = pct(done, tasks.length);

  const projectRows = projects.map(p => {
    const pts = tasks.filter(t => t.projectId === p.id);
    const pdone = pts.filter(t => t.status === 'Completed').length;
    return `<tr>
      <td>${esc(p.icon)} ${esc(p.title)}</td>
      <td>${pts.length}</td>
      <td>${pdone}</td>
      <td>${pct(pdone, pts.length)}%</td>
    </tr>`;
  }).join('') || `<tr><td colspan="4" class="muted">No projects yet</td></tr>`;

  const logRows = (wealth.monthlyLog || []).slice(0, 6).map(e => `
    <tr>
      <td>${esc(e.month)}</td>
      <td>${money(e.income, cur)}</td>
      <td>${money(e.business, cur)}</td>
      <td>${money(e.expenses, cur)}</td>
      <td>${money(e.saved, cur)}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted">No monthly entries yet</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; margin: 0; padding: 32px; color: #0D1B2A; background: #fff; width: 900px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .sub { color: #6B7280; font-size: 12px; margin-bottom: 20px; }
  .kpis { display: flex; gap: 12px; margin-bottom: 20px; }
  .kpi { flex: 1; border: 1px solid #E5E7EB; border-radius: 10px; padding: 12px; }
  .kpi .label { font-size: 10px; color: #9CA3AF; font-weight: 600; text-transform: uppercase; }
  .kpi .value { font-size: 22px; font-weight: 800; font-family: 'JetBrains Mono', monospace; margin-top: 4px; }
  .hero { background: linear-gradient(135deg, #0D1B2A, #1B3A5C); color: #fff; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; }
  .hero .label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,.5); }
  .hero .value { font-size: 28px; font-weight: 800; font-family: monospace; margin: 4px 0; }
  .bar-track { background: rgba(255,255,255,.15); border-radius: 6px; height: 8px; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg,#0A7E8C,#C49A00); }
  h2 { font-size: 14px; margin: 24px 0 8px; color: #1B3A5C; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #0D1B2A; color: #fff; padding: 8px 10px; font-size: 10px; text-transform: uppercase; }
  td { padding: 7px 10px; border-bottom: 1px solid #F3F4F6; }
  .muted { color: #9CA3AF; text-align: center; padding: 16px; }
  .footer { margin-top: 24px; font-size: 10px; color: #9CA3AF; }
</style></head>
<body>
  <h1>${esc(profile.name)}'s Waypoint Report</h1>
  <p class="sub">Generated ${new Date().toLocaleString()}</p>

  <div class="kpis">
    <div class="kpi"><div class="label">Total Tasks</div><div class="value">${tasks.length}</div></div>
    <div class="kpi"><div class="label">Completed</div><div class="value">${done}</div></div>
    <div class="kpi"><div class="label">Projects</div><div class="value">${projects.length}</div></div>
  </div>

  <div class="hero">
    <div class="label">Goals Progress</div>
    <div class="value">${goalsPct}%</div>
    <div class="bar-track"><div class="bar-fill" style="width:${goalsPct}%"></div></div>
    <p class="sub" style="color:rgba(255,255,255,.4);margin:6px 0 0">${done} of ${tasks.length} tasks complete</p>
  </div>

  <h2>Projects</h2>
  <table>
    <tr><th>Project</th><th>Tasks</th><th>Done</th><th>Complete</th></tr>
    ${projectRows}
  </table>

  <h2>Recent Monthly Log</h2>
  <table>
    <tr><th>Month</th><th>Job Income</th><th>Business</th><th>Expenses</th><th>Saved</th></tr>
    ${logRows}
  </table>

  <p class="footer">${overdueCount} task${overdueCount === 1 ? '' : 's'} overdue · Waypoint</p>
</body></html>`;
}

// Most container hosts (Railway, Render, Docker generally) run the process
// as root with no user-namespace sandbox available, which Chromium refuses
// to start under without --no-sandbox. Harmless here since we only ever
// load our own trusted, server-rendered pages — never arbitrary user URLs.
function launchBrowser() {
  return puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

async function withReportPage(snapshot, fn) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(reportHtml(snapshot), { waitUntil: 'load' });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function renderReportPdf(snapshot) {
  return withReportPage(snapshot, page => page.pdf({ format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px' } }));
}

async function renderReportImage(snapshot) {
  return withReportPage(snapshot, page => page.screenshot({ fullPage: true }));
}

// Screenshots the Gantt chart exactly as the user has it (same filter/zoom)
// by loading the real running app as a real browser, rather than
// re-implementing the chart's CSS Grid layout — html2canvas's manual
// DOM-to-canvas renderer clips flex-centered text inside CSS Grid rows, a
// known limitation; a real browser has no such issue.
async function renderGanttImage(cookieHeader, baseUrl) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    if (cookieHeader) await page.setExtraHTTPHeaders({ Cookie: cookieHeader });
    await page.goto(baseUrl + '/', { waitUntil: 'networkidle0' });
    // Defensively dismiss anything that could sit on top of the chart —
    // e.g. an un-onboarded account's onboarding wizard opens automatically
    // on login, which would otherwise get captured instead of the chart.
    await page.evaluate(() => {
      document.getElementById('onboarding-overlay')?.classList.remove('open');
      document.querySelectorAll('.modal-overlay.open').forEach(el => el.classList.remove('open'));
    });
    await page.evaluate(() => showPage('gantt'));
    await page.waitForSelector('.gantt-cat-row', { timeout: 10000 });
    await page.evaluate(() => document.getElementById('gantt-chart-card').classList.add('gantt-exporting'));
    await new Promise(r => setTimeout(r, 300)); // let the un-frozen layout settle

    // The viewport must be tall enough that the page never needs to
    // scroll — the app's topbar is position:sticky, and once the page
    // scrolls it stays pinned over the same screen region the (now
    // scrolled) card occupies, corrupting the crop. Sizing to the whole
    // page's height rather than just the card's avoids that entirely.
    //
    // Width can't be read off the card itself: .gantt-exporting sets the
    // scroll panes to overflow:visible so the full timeline isn't clipped,
    // but a visible-overflow child spills outside its parent without the
    // parent's own scrollWidth growing to match — the inner wrapper divs
    // (which carry the real width as an explicit inline min-width) are
    // measured directly instead.
    const box = await page.evaluate(() => {
      const innerWidth = Math.max(
        document.getElementById('gantt-timeline-wrapper')?.scrollWidth || 0,
        document.getElementById('gantt-rows-wrapper')?.scrollWidth || 0,
      );
      return {
        width: Math.ceil(innerWidth),
        pageHeight: Math.ceil(document.documentElement.scrollHeight),
      };
    });
    await page.setViewport({ width: box.width + 280, height: box.pageHeight + 40 });

    const element = await page.$('#gantt-chart-card');
    return await element.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

module.exports = { renderReportPdf, renderReportImage, renderGanttImage };
