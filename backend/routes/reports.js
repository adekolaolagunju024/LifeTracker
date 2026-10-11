const express = require('express');
const router  = express.Router();
const db = require('../db/db');
const { renderGanttImage, renderHtmlPdf } = require('../reports/visual');
const { buildProgressReport, renderProgressReportHtml } = require('../reports/progress');

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
  res.json(report);
});
router.get('/projects/:id/progress.html', (req, res) => {
  const report = buildProgressReport(req.session.userId, req.params.id);
  if (!report) return res.status(404).send('Project not found');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderProgressReportHtml(report, { appUrl: appUrl(req) }));
});
router.get('/projects/:id/progress.pdf', async (req, res) => {
  const report = buildProgressReport(req.session.userId, req.params.id);
  if (!report) return res.status(404).json({ error: 'Project not found' });
  try {
    const pdf = await renderHtmlPdf(renderProgressReportHtml(report, { appUrl: appUrl(req) }));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${fileName(report.project.title)}-progress-${report.today}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('Progress report PDF error:', e.message);
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
  res.type('html').send(renderProgressReportHtml(report, { live: true, appUrl: appUrl(req) }));
});

module.exports = router;
module.exports.publicRouter = publicRouter;
