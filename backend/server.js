// quiet: true suppresses dotenv's startup log line, which rotates through
// self-promotional "tips" for the maintainers' other products on every boot.
require('dotenv').config({ quiet: true });

const Sentry = require('@sentry/node');
// Error tracking is opt-in: with no SENTRY_DSN set, nothing is sent anywhere.
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development', sendDefaultPii: false, tracesSampleRate: 0 });
}

const express = require('express');
const session = require('express-session');
const compression = require('compression');
const path    = require('path');

const db = require('./db/connection');
const requireAuth = require('./middleware/requireAuth');
const SqliteStore = require('better-sqlite3-session-store')(session);
const { startDigestScheduler } = require('./email/digest');
const { startPushReminderScheduler } = require('./push/scheduler');
const { startCheckInScheduler } = require('./ai/checkIn');
const { startBackupScheduler } = require('./backup');

const showcase = require('./showcase');
const { renderLanding } = require('./landing');
const metrics = require('./metrics');

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
// No "X-Powered-By: Express" advert, and the standard protective headers:
// no MIME sniffing, no framing by other sites (clickjacking), referrers
// trimmed to the origin when leaving the site, and HTTPS pinned in
// production. The browser app and API share one origin, so no CORS
// headers are sent: other sites can't read the API from a visitor's browser.
app.disable('x-powered-by');
// Content Security Policy: everything loads from this site, except Google
// Fonts and the music services' embedded players. No plugins, no other
// site may frame the app, and forms only post here. Scripts still allow inline code: the
// app's markup uses inline event handlers throughout, so moving those to
// script files has to come before 'unsafe-inline' can be dropped.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://open.spotify.com", // Spotify's embed API, for pause and play
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.mzstatic.com https://i.scdn.co https://mosaic.scdn.co https://image-cdn-ak.spotifycdn.com https://image-cdn-fa.spotifycdn.com https://i.ytimg.com https://yt3.ggpht.com",
  "media-src 'self' blob:",
  "connect-src 'self' blob: data:", // 3D models unpack their textures through blob: URLs
  // The music services' own players for Your why.
  "frame-src 'self' https://open.spotify.com https://www.youtube-nocookie.com https://www.youtube.com https://embed.music.apple.com https://w.soundcloud.com https://widget.deezer.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});
// gzip: the app's scripts and page shrink to roughly a quarter of their size.
app.use(compression());
// Default (100kb) is far too small for the AI chat's file attachments,
// which travel as base64 inside the JSON body rather than multipart —
// base64 inflates a file by ~33%, so this covers the same ~15MB ceiling
// multer enforces on the plain file-upload endpoint.
// Stripe's webhook needs the raw body to check its signature, so it comes
// before the JSON parser and before sign-in.
const billingRoutes = require('./routes/billing');
app.post('/api/stripe/webhook', ...billingRoutes.webhook);
app.use(express.json({ limit: '20mb' }));
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
// Pages, scripts and styles must always be checked against the server, so
// a deploy shows up on the next load instead of a stale cached copy (the
// files keep their names between releases). Images and models can cache.
const NO_CACHE = /\.(html|js|mjs|css)$/;
const noCache = res => res.setHeader('Cache-Control', 'no-cache');
// The app page built for speed (backend/bundle.js): one minified script
// and stylesheet, hashed and cached for a year.
const bundle = require('./bundle');
const sendApp = (req, res) => bundle.sendPage(req, res, () => { noCache(res); res.sendFile(path.join(__dirname, '../frontend/index.html')); });
app.get('/build/:name', bundle.assetRoute);
// Rendered from product data, so it's handled before the static files.
app.get('/landing.html', (req, res) => { noCache(res); res.type('html').send(renderLanding()); });
app.use(express.static(path.join(__dirname, '../frontend'), {
  index: false,
  setHeaders(res, filePath) { if (NO_CACHE.test(filePath)) noCache(res); },
}));
// Three.js for the 3D Journey stage, served from the npm package so it's
// self-hosted and version-locked by package.json (only the two folders the
// browser imports from).
app.use('/vendor/three/build', express.static(path.join(__dirname, '../node_modules/three/build')));
app.use('/vendor/three/examples/jsm', express.static(path.join(__dirname, '../node_modules/three/examples/jsm')));

// The marketing page is the front door for signed-out visitors; signed-in
// users (and the app's own login screen at /app) get the app itself. The
// landing page is filled in from frontend/data/product.json (see
// backend/landing.js), so it never goes stale.
app.get('/', (req, res) => {
  noCache(res);
  if (req.session && req.session.userId) return sendApp(req, res);
  try { metrics.countPageView('landing', req.get('user-agent')); } catch { /* counting never blocks the page */ }
  res.type('html').send(renderLanding());
});
// Live screenshots of the app for the landing page (backend/showcase.js).
app.get('/showcase/:file', (req, res) => {
  const file = showcase.showcaseFile(req.params.file);
  if (!file) return res.status(404).end();
  noCache(res);
  res.sendFile(file);
});
app.get('/app', sendApp);

// ── PUBLIC ROUTES ──
app.use('/api/auth', require('./routes/auth'));
// Railway's deploy health check (railway.json) and any uptime monitor
// call this: "ok" only when the database answers, so a deploy that can't
// reach its data never takes over from the one that can.
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    require('./db/connection').prepare('SELECT 1').get();
    res.json({ status: 'ok', timestamp: new Date() });
  } catch {
    res.status(503).json({ status: 'error', timestamp: new Date() });
  }
});
// Which build is running, so an open tab can tell it's out of date after a
// deploy (see checkForNewVersion in app.js): the deployed commit on Railway,
// else this process's start time.
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA || `boot-${Date.now()}`;
app.get('/api/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ version: BUILD_ID });
});

// A user's tasks as a subscribable calendar feed, behind a private token
// rather than a session (calendar apps can't sign in).
const calendar = require('./routes/calendar');
app.use('/calendar', calendar.publicRouter);
// Live progress reports shared by link (read-only, revocable).
app.use('/r', require('./routes/reports').publicRouter);
// Reward pledges: the goal's pledge page and each pledger's own page.
const pledgeRoutes = require('./routes/pledges');
app.use('/p', pledgeRoutes.publicRouter);

// ── AUTH GATE — everything else under /api requires a logged-in session ──
app.use('/api', requireAuth);

// ── PROTECTED ROUTES ──
app.use('/api/profile',  require('./routes/profile'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/drive',    require('./routes/drive'));
app.use('/api/ai',       require('./routes/ai'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/data',     require('./routes/data'));
app.use('/api/trash',    require('./routes/trash'));
app.use('/api/search',   require('./routes/search'));
app.use('/api/checklist', require('./routes/checklist'));
app.use('/api/tags',     require('./routes/tags'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/uploads',  require('./routes/uploads'));
app.use('/api/push',     require('./routes/push'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/day',      require('./routes/day'));
app.use('/api/voice',    require('./routes/voice'));
app.use('/api/motivation', require('./routes/motivation'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/pledges', pledgeRoutes);
app.use('/api/music', require('./routes/music'));
app.use('/api/billing', billingRoutes.router);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/journey-gaming', require('./routes/journeyGaming'));
app.use('/api/calendar', calendar.apiRouter);

// ── CATCH ALL — serve frontend ──
app.get('*', sendApp);

if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

// Build the app page now, so the first visitor doesn't wait for it.
bundle.current();
// Uploads saved before they moved onto the data volume come across first.
const adopted = require('./storage').adoptLegacyUploads();
if (adopted) console.log(`Copied ${adopted} uploaded file(s) onto the data volume`);

app.listen(PORT, () => {
  console.log(`\n🚀 Waypoint running at http://localhost:${PORT}\n`);
});

// The private copy started to photograph the app for the landing page
// (backend/showcase.js) runs no background jobs.
if (!process.env.SHOWCASE_CHILD) {
  startDigestScheduler();
  startPushReminderScheduler();
  startCheckInScheduler();
  startBackupScheduler();
  if (process.env.NODE_ENV === 'production' && process.env.SHOWCASE !== 'off') showcase.scheduleShowcase();
}
