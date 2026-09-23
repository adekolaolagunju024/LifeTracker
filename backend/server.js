// quiet: true suppresses dotenv's startup log line, which rotates through
// self-promotional "tips" for the maintainers' other products on every boot.
require('dotenv').config({ quiet: true });

const express = require('express');
const session = require('express-session');
const cors    = require('cors');
const path    = require('path');

const db = require('./db/connection');
const requireAuth = require('./middleware/requireAuth');
const SqliteStore = require('better-sqlite3-session-store')(session);
const { startDigestScheduler } = require('./email/digest');

const app  = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy (Railway, Render, Heroku, etc.) the connection to
// this process is plain HTTP even when the public-facing request was HTTPS
// — without this, req.protocol always reports "http", which breaks the
// dynamically-built Google OAuth redirect URI and the Gantt image export's
// internal loopback URL.
app.set('trust proxy', 1);

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET is not set in .env — using an insecure development default. Set one before deploying.');
}

// ── MIDDLEWARE ──
app.use(cors());
app.use(express.json());
app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: process.env.SESSION_SECRET || 'waypoint-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
}));

// ── SERVE FRONTEND (public — the login screen itself lives here) ──
app.use(express.static(path.join(__dirname, '../frontend')));

// ── PUBLIC ROUTES ──
app.use('/api/auth', require('./routes/auth'));
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ── AUTH GATE — everything else under /api requires a logged-in session ──
app.use('/api', requireAuth);

// ── PROTECTED ROUTES ──
app.use('/api/profile',  require('./routes/profile'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/wealth',   require('./routes/wealth'));
app.use('/api/drive',    require('./routes/drive'));
app.use('/api/ai',       require('./routes/ai'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/data',     require('./routes/data'));
app.use('/api/trash',    require('./routes/trash'));
app.use('/api/search',   require('./routes/search'));

// ── CATCH ALL — serve frontend ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Waypoint running at http://localhost:${PORT}\n`);
});

startDigestScheduler();
