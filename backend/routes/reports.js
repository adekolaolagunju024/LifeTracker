const express = require('express');
const router  = express.Router();
const { renderGanttImage } = require('../reports/visual');

// GET /api/reports/gantt-image — screenshots the Gantt chart exactly as the
// user currently has it (same project filter / zoom level), by driving a
// real headless browser against this same server rather than
// re-implementing the chart's layout. Forwards the caller's own session
// cookie so the headless page loads already logged in as them.
router.get('/gantt-image', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const buffer = await renderGanttImage(req.headers.cookie, baseUrl);
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="gantt-chart_${new Date().toISOString().slice(0, 10)}.png"`);
    res.send(buffer);
  } catch (e) {
    console.error('Gantt image export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
