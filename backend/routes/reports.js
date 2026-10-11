const express = require('express');
const router  = express.Router();
const db = require('../db/db');
const { renderGanttImage, renderHtmlPdf } = require('../reports/visual');
const fs = require('fs');
const path = require('path');
const { buildProgressReport, renderProgressReportHtml } = require('../reports/progress');
const { buildPortfolioReport, renderPortfolioHtml } = require('../reports/portfolio');

// How report photos are shown. In the app the page loads them through the
// signed-in /api/uploads route; a PDF or a public share link carries them
// inside the page (data URIs, images up to 4MB, at most 12) so nothing
// private has to be reachable from outside.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const appMediaSrc = m => `/api/uploads/${m.attachmentId}`;
function embeddedMediaSrc() {
  let used = 0;
  return m => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(m.mimetype) || m.size > 4 * 1024 * 1024 || used >= 12) return null;
    try {
      const data = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(m.filename)));
      used++;
      return `data:${m.mimetype};base64,${data.toString('base64')}`;
    } catch { return null; }
  };
}
// The JSON shape never includes the stored filename.
const withoutFile = m => { const copy = { ...m }; delete copy.filename; return copy; };
const publicMedia = r => ({ ...r, media: (r.media || []).map(withoutFile) });
const parseIds = q => String(q || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);

const appUrl = req => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
const fileName = title => String(title || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'project';

// GET /api/reports/gantt-image — screenshots the Gantt chart exactly as the
// user currently has it (same project filter / zoom level), by driving a
// real headless browser against this same server rather than
// re-implementing the chart's layout. Forwards the caller's own session
// cookie so the headless page loads already logged in as them.
router.get('/gantt-image', async (req, res) => {
  try {
    // Loop back to this same process directly on its own bound port, not
    // the public-facing host from the request — on a platform like Railway
    // that's a different domain behind a proxy/CDN, and routing the
    // internal Puppeteer request back out through it is unreliable (or
    // blocked outright) and always slower than talking to localhost.
    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    const buffer = await renderGanttImage(req.headers.cookie, baseUrl);
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="gantt-chart_${new Date().toISOString().slice(0, 10)}.png"`);
    res.send(buffer);
  } catch (e) {
    console.error('Gantt image export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PROGRESS REPORTS ──
// GET /api/reports/projects/:id/progress(.html|.pdf) — anyone who can see
// the project. The share link is managed by its owner and editors.
router.get('/projects/:id/progress', (req, res) => {
  const report = buildProgressReport(req.session.userId, req.params.id);
  if (!report) return res.status(404).json({ error: 'Project not found' });
  res.json(publicMedia(report));
});
router.get('/projects/:id/progress.html', (req, res) => {
  const report = buildProgressReport(req.session.userId, req.params.id);
  if (!report) return res.status(404).send('Project not found');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderProgressReportHtml(report, { appUrl: appUrl(req), mediaSrc: appMediaSrc }));
});
router.get('/projects/:id/progress.pdf', async (req, res) => {
  const report = buildProgressReport(req.session.userId, req.params.id);
  if (!report) return res.status(404).json({ error: 'Project not found' });
  try {
    const pdf = await renderHtmlPdf(renderProgressReportHtml(report, { appUrl: appUrl(req), mediaSrc: embeddedMediaSrc() }));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${fileName(report.project.title)}-progress-${report.today}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('Progress report PDF error:', e.message);
    res.status(500).json({ error: 'Could not make the PDF. Try Print instead.' });
  }
});
// ── PHOTOS AND FILES IN REPORTS ──
// GET /api/reports/projects/:id/media — what's pinned to the report
router.get('/projects/:id/media', (req, res) => {
  const media = db.listReportMedia(req.session.userId, req.params.id);
  if (!media) return res.status(404).json({ error: 'Project not found' });
  res.json(media.map(withoutFile));
});
// GET /api/reports/projects/:id/attachments — files already in the project
router.get('/projects/:id/attachments', (req, res) => {
  const files = db.listProjectAttachments(req.session.userId, req.params.id);
  if (!files) return res.status(404).json({ error: 'Project not found' });
  res.json(files);
});
// POST /api/reports/projects/:id/media — { attachmentId, caption, kind, taskId }
router.post('/projects/:id/media', (req, res) => {
  if (!db.getProjectById(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Project not found' });
  try {
    res.status(201).json(withoutFile(db.addReportMedia(req.session.userId, req.params.id, req.body || {})));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// DELETE /api/reports/media/:id
router.delete('/media/:id', (req, res) => {
  try {
    if (!db.removeReportMedia(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// ── PORTFOLIO REPORT (several projects at once) ──
// GET /api/reports/portfolio(.html|.pdf)?ids=a,b — all your projects, or the chosen ones
router.get('/portfolio', (req, res) => {
  const r = buildPortfolioReport(req.session.userId, parseIds(req.query.ids));
  res.json({ ...r, media: r.media.map(withoutFile) });
});
router.get('/portfolio.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderPortfolioHtml(buildPortfolioReport(req.session.userId, parseIds(req.query.ids)), { appUrl: appUrl(req), mediaSrc: appMediaSrc, title: String(req.query.title || '').slice(0, 80) }));
});
router.get('/portfolio.pdf', async (req, res) => {
  try {
    const r = buildPortfolioReport(req.session.userId, parseIds(req.query.ids));
    const pdf = await renderHtmlPdf(renderPortfolioHtml(r, { appUrl: appUrl(req), mediaSrc: embeddedMediaSrc(), title: String(req.query.title || '').slice(0, 80) }));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="portfolio-report-${r.today}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('Portfolio PDF error:', e.message);
    res.status(500).json({ error: 'Could not make the PDF. Try Print instead.' });
  }
});

const shareUrl = (req, token) => `${appUrl(req)}/r/${token}`;
router.get('/projects/:id/share', (req, res) => {
  if (!db.getProjectById(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Project not found' });
  const link = db.getReportLink(req.params.id);
  res.json({ url: link ? shareUrl(req, link.token) : null, canManage: db.canEditProject(req.session.userId, req.params.id) });
});
router.post('/projects/:id/share', (req, res) => {
  if (!db.getProjectById(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Project not found' });
  if (!db.canEditProject(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Only the owner or an editor can share this report' });
  res.status(201).json({ url: shareUrl(req, db.createReportLink(req.session.userId, req.params.id).token) });
});
router.delete('/projects/:id/share', (req, res) => {
  if (!db.getProjectById(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Project not found' });
  if (!db.canEditProject(req.session.userId, req.params.id)) return res.status(403).json({ error: 'Only the owner or an editor can stop sharing this report' });
  db.deleteReportLink(req.params.id);
  res.json({ success: true });
});

// Public: GET /r/<token> — the live report behind a share link, as its
// owner sees it. Read-only, not indexed, gone as soon as sharing stops.
const publicRouter = express.Router();
publicRouter.get('/:token', (req, res) => {
  const target = db.getReportLinkTarget(req.params.token);
  const report = target && buildProgressReport(target.ownerId, target.projectId);
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  if (!report) return res.status(404).type('text/plain').send('This report link has been turned off or does not exist.');
  res.type('html').send(renderProgressReportHtml(report, { live: true, appUrl: appUrl(req), mediaSrc: embeddedMediaSrc() }));
});

module.exports = router;
module.exports.publicRouter = publicRouter;
