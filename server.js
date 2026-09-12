// ═══════════════════════════════════════════════════════════════
// SERVER.JS — Main Express Backend
// Serves the API and static frontend files
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const projectsRouter  = require('./routes/projects');
const tasksRouter     = require('./routes/tasks');
const wealthRouter    = require('./routes/wealth');
const actionsRouter   = require('./routes/actions');
const profileRouter   = require('./routes/profile');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── SERVE FRONTEND ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API ROUTES ──────────────────────────────────────────────────
app.use('/api/profile',  profileRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/tasks',    tasksRouter);
app.use('/api/wealth',   wealthRouter);
app.use('/api/actions',  actionsRouter);

// ── HEALTH CHECK ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Life Tracker API running', timestamp: new Date() });
});

// ── CATCH-ALL — serve frontend for any non-API route ───────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── START ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Life Tracker running at http://localhost:${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`\nPress Ctrl+C to stop.\n`);
});
