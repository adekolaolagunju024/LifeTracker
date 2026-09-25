const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { v4: uuid } = require('uuid');
const { google } = require('googleapis');
const db = require('../db/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Google Sign-In reuses the same OAuth client (GOOGLE_CLIENT_ID/SECRET) as
// Drive backup, but with its own callback path and identity-only scopes —
// the redirect URI is built from the incoming request rather than a fixed
// env var, so the only extra setup is adding that URI as an additional
// Authorized redirect URI on the existing Google Cloud OAuth client.
function isGoogleLoginConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getGoogleLoginClient(req) {
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
}

// GET /api/auth/status — always public, tells the frontend whether a session is active
router.get('/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.userId) });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.getUserById(req.session.userId);
  res.json({ id: user.id, email: user.email });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.getUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists' });

  const user = db.createUser({
    id: uuid(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString(),
  });

  req.session.userId = user.id;
  res.status(201).json({ email: user.email });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.getUserByEmail(email);

  // Same error for unknown email vs wrong password — don't reveal which.
  const ok = user ? await bcrypt.compare(req.body.password || '', user.passwordHash) : false;
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password' });

  req.session.userId = user.id;
  // Unchecking "Keep me signed in" drops the Max-Age/Expires attribute
  // entirely, so the browser clears the cookie when it closes instead of
  // keeping the usual 30-day persistent session.
  if (req.body.remember === false) req.session.cookie.expires = false;
  res.json({ email: user.email });
});

// GET /api/auth/google/status — lets the frontend hide the button cleanly
router.get('/google/status', (req, res) => {
  res.json({ configured: isGoogleLoginConfigured() });
});

// GET /api/auth/google — redirects to Google's consent screen
router.get('/google', (req, res) => {
  if (!isGoogleLoginConfigured()) {
    return res.status(400).send('Sign in with Google is not configured on this server yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.');
  }
  const client = getGoogleLoginClient(req);
  const url = client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], prompt: 'select_account' });
  res.redirect(url);
});

// GET /api/auth/google/callback — Google redirects here after consent.
// Finds an existing account by email, or creates a new one (with an
// unusable random password hash — that account can only ever sign in via
// Google unless the user later sets a password from Settings).
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?auth=error');
  try {
    const client = getGoogleLoginClient(req);
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email || !payload.email_verified) return res.redirect('/?auth=error');

    let user = db.getUserByEmail(email);
    if (!user) {
      user = db.createUser({
        id: uuid(),
        email,
        passwordHash: await bcrypt.hash(crypto.randomUUID(), 10),
        createdAt: new Date().toISOString(),
      });
    }
    req.session.userId = user.id;
    res.redirect('/');
  } catch (e) {
    console.error('Google login error:', e.message);
    res.redirect('/?auth=error');
  }
});

// POST /api/auth/forgot-password — generates a reset link. There's no email
// service configured (would need a paid/third-party provider), so the link
// is logged server-side instead of sent — good enough for a self-hosted
// single-owner instance, and the account owner can read their own server
// logs. The response is identical whether or not the email exists, so this
// endpoint can't be used to discover registered emails.
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.getUserByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.setPasswordResetToken(user.id, token, expiresAt);
    const resetUrl = `${req.protocol}://${req.get('host')}/?resetToken=${token}`;
    console.log(`\n🔑 Password reset requested for ${email}\n   ${resetUrl}\n   (valid 1 hour)\n`);
  }
  res.json({ success: true });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const user = db.getUserByResetToken(token || '');
  if (!user || !user.resetTokenExpires || new Date(user.resetTokenExpires) < new Date()) {
    return res.status(400).json({ error: 'That reset link is invalid or has expired' });
  }

  db.setUserPasswordHash(user.id, await bcrypt.hash(newPassword, 10));
  db.clearPasswordResetToken(user.id);
  res.json({ success: true });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// PUT /api/auth/password — change password (must already be logged in;
// this router is mounted before the global auth gate, so check manually)
router.put('/password', async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });

  const user = db.getUserById(req.session.userId);
  const { currentPassword, newPassword } = req.body;
  const ok = await bcrypt.compare(currentPassword || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  db.setUserPasswordHash(user.id, await bcrypt.hash(newPassword, 10));
  res.json({ success: true });
});

// DELETE /api/auth/account — permanently deletes this account and every row
// that references it (profile, projects, tasks, integrations all cascade).
// Requires the current password as confirmation since there's no undo.
router.delete('/account', async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });

  const user = db.getUserById(req.session.userId);
  const ok = await bcrypt.compare(req.body.password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect password' });

  db.deleteUser(user.id);
  req.session.destroy(() => res.json({ success: true }));
});

module.exports = router;
