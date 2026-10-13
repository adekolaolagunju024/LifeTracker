const express = require('express');
const { rateLimit, byIp, byIpAndEmail } = require('../middleware/rateLimit');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { v4: uuid } = require('uuid');
const { google } = require('googleapis');
const microsoft = require('../microsoft');
const db = require('../db/db');
const { sendPasswordResetEmail, sendVerifyEmail } = require('../email/account');
const twofactor = require('../twofactor');
const QRCode = require('qrcode');

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
  res.json({ id: user.id, email: user.email, emailVerified: !!user.emailVerifiedAt });
});

const MIN_PASSWORD = 8;
const tooShort = p => !p || String(p).length < MIN_PASSWORD;
const FIFTEEN_MIN = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const loginLimit = rateLimit({ windowMs: FIFTEEN_MIN, max: 10, key: byIpAndEmail, message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
const registerLimit = rateLimit({ windowMs: HOUR, max: 30, key: byIp, message: 'Too many accounts created from this connection. Please try again later.' });
const forgotLimit = rateLimit({ windowMs: HOUR, max: 5, key: byIpAndEmail, message: 'Too many reset requests. Please check your inbox, or try again in an hour.' });
const resetLimit = rateLimit({ windowMs: FIFTEEN_MIN, max: 20, key: byIp, message: 'Too many attempts. Please wait a few minutes and try again.' });

// Starts a fresh session for a user who has just signed in, so a session id
// planted before sign-in (session fixation) is never the one that's trusted.
function signIn(req, userId) {
  return new Promise((resolve, reject) => req.session.regenerate(err => {
    if (err) return reject(err);
    req.session.userId = userId;
    resolve();
  }));
}

// Emails a fresh "confirm your email" link (two days). Where email isn't
// set up the link goes to the server log, as with password resets.
async function sendVerification(req, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.setVerifyToken(user.id, token, new Date(Date.now() + 48 * HOUR).toISOString());
  const url = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/app?verifyToken=${token}`;
  try {
    const sent = await sendVerifyEmail(user.email, url);
    if (!sent) console.log(`\n✉️  Confirm-email link for ${user.email} (email is not set up, so here it is)\n   ${url}\n`);
  } catch (e) {
    console.error('Verification email failed:', e.message);
  }
}
const verifyLimit = rateLimit({ windowMs: FIFTEEN_MIN, max: 20, key: byIp, message: 'Too many attempts. Please wait a few minutes and try again.' });
const resendLimit = rateLimit({ windowMs: HOUR, max: 3, key: byIp, message: 'We have sent a few already. Please check your inbox and spam folder, or try again in an hour.' });

// POST /api/auth/verify-email {token}: the link from the email. Works
// whether or not they're signed in on this device.
router.post('/verify-email', verifyLimit, (req, res) => {
  const user = db.getUserByVerifyToken(String((req.body || {}).token || ''));
  if (!user) return res.status(400).json({ error: 'That link has already been used or is not valid. Sign in to send a new one.' });
  if (!user.verifyTokenExpires || new Date(user.verifyTokenExpires) < new Date()) {
    return res.status(400).json({ error: 'That link has expired. Sign in and we can send a new one.' });
  }
  db.markEmailVerified(user.id);
  res.json({ success: true, email: user.email });
});

// POST /api/auth/resend-verification: a new link to the signed-in account.
router.post('/resend-verification', resendLimit, async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.getUserById(req.session.userId);
  if (user.emailVerifiedAt) return res.json({ success: true, alreadyVerified: true });
  await sendVerification(req, user);
  res.json({ success: true });
});

// POST /api/auth/register
router.post('/register', registerLimit, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (tooShort(password)) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  if (req.body.acceptTerms !== true) return res.status(400).json({ error: 'Please agree to the Terms and Privacy Policy to create an account' });
  if (db.getUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists' });

  const user = db.createUser({
    id: uuid(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString(),
    acceptedTermsAt: new Date().toISOString(),
  });
  db.logEvent(user.id, 'user_registered');
  db.attachReferral(user.id, req.body.ref);
  await sendVerification(req, user);

  await signIn(req, user.id);
  res.status(201).json({ email: user.email });
});

// POST /api/auth/login
router.post('/login', loginLimit, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.getUserByEmail(email);

  // Same error for unknown email vs wrong password — don't reveal which.
  const ok = user ? await bcrypt.compare(req.body.password || '', user.passwordHash) : false;
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password' });

  // Two-step sign-in on: hold the sign-in until the code is checked.
  if (user.totpEnabledAt) {
    req.session.pending2fa = { userId: user.id, remember: req.body.remember !== false, until: Date.now() + 5 * 60 * 1000 };
    return res.json({ twoFactorRequired: true });
  }
  await signIn(req, user.id);
  // Unchecking "Keep me signed in" drops the Max-Age/Expires attribute
  // entirely, so the browser clears the cookie when it closes instead of
  // keeping the usual 30-day persistent session.
  if (req.body.remember === false) req.session.cookie.expires = false;
  res.json({ email: user.email });
});

// ── TWO-STEP SIGN-IN (backend/twofactor.js) ──
const twoFactorLimit = rateLimit({ windowMs: FIFTEEN_MIN, max: 8, key: req => `${req.ip}|${(req.session && req.session.pending2fa && req.session.pending2fa.userId) || ''}`, message: 'Too many codes tried. Please wait 15 minutes and try again.' });
const signedInUser = req => (req.session && req.session.userId ? db.getUserById(req.session.userId) : null);
// A six-digit app code (not reused) or an unused recovery code.
function checkSecondFactor(user, code) {
  const clean = String(code || '').trim();
  const step = twofactor.verifyCode(user.totpSecret, clean, user.totpLastStep);
  if (step !== null) return db.claimTotpStep(user.id, step);
  if (/[a-z]/i.test(clean)) return db.useTotpRecoveryCode(user.id, twofactor.hashRecovery(clean));
  return false;
}

// POST /api/auth/2fa/verify — { code } finishes a sign-in held for a code
router.post('/2fa/verify', twoFactorLimit, async (req, res) => {
  const pending = req.session && req.session.pending2fa;
  if (!pending || pending.until < Date.now()) return res.status(401).json({ error: 'Your sign-in timed out. Please enter your password again.' });
  const user = db.getUserById(pending.userId);
  if (!user || !user.totpEnabledAt || !checkSecondFactor(user, req.body.code)) return res.status(401).json({ error: "That code didn't work. Check your authenticator app and try again." });
  await signIn(req, user.id);
  if (!pending.remember) req.session.cookie.expires = false;
  res.json({ email: user.email });
});

// GET /api/auth/2fa/status
router.get('/2fa/status', (req, res) => {
  const user = signedInUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const left = user.totpRecoveryHashes ? JSON.parse(user.totpRecoveryHashes).length : 0;
  res.json({ enabled: !!user.totpEnabledAt, enabledAt: user.totpEnabledAt || null, recoveryCodesLeft: left });
});

// POST /api/auth/2fa/setup — a new secret to scan (not active until /enable)
router.post('/2fa/setup', async (req, res) => {
  const user = signedInUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.totpEnabledAt) return res.status(400).json({ error: 'Two-step sign-in is already on' });
  const secret = twofactor.newSecret();
  db.setTotpPendingSecret(user.id, secret);
  const url = twofactor.otpauthUrl(secret, user.email);
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0D1B2A', light: '#FFFFFF' } });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ secret, otpauthUrl: url, qrSvg });
});

// POST /api/auth/2fa/enable — { code } from the app proves it's set up;
// returns the recovery codes, shown this once.
router.post('/2fa/enable', twoFactorLimit, (req, res) => {
  const user = signedInUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!user.totpPendingSecret) return res.status(400).json({ error: 'Start the set-up again' });
  const step = twofactor.verifyCode(user.totpPendingSecret, req.body.code);
  if (step === null) return res.status(400).json({ error: "That code didn't match. Make sure your phone's clock is right and try the newest code." });
  const codes = twofactor.newRecoveryCodes();
  db.enableTotp(user.id, user.totpPendingSecret, step, codes.map(twofactor.hashRecovery));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ enabled: true, recoveryCodes: codes });
});

// POST /api/auth/2fa/disable — { password, code }
router.post('/2fa/disable', twoFactorLimit, async (req, res) => {
  const user = signedInUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!user.totpEnabledAt) return res.json({ enabled: false });
  const ok = await bcrypt.compare(req.body.password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect password' });
  if (!checkSecondFactor(user, req.body.code)) return res.status(401).json({ error: "That code didn't work" });
  db.disableTotp(user.id);
  res.json({ enabled: false });
});

// POST /api/auth/2fa/recovery-codes — { code } replaces the recovery codes
router.post('/2fa/recovery-codes', twoFactorLimit, (req, res) => {
  const user = signedInUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!user.totpEnabledAt) return res.status(400).json({ error: 'Two-step sign-in is off' });
  if (!checkSecondFactor(user, req.body.code)) return res.status(401).json({ error: "That code didn't work" });
  const codes = twofactor.newRecoveryCodes();
  db.setTotpRecoveryHashes(user.id, codes.map(twofactor.hashRecovery));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ recoveryCodes: codes });
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
  if (error || !code) return res.redirect('/app?auth=error');
  try {
    const client = getGoogleLoginClient(req);
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email || !payload.email_verified) return res.redirect('/app?auth=error');

    let user = db.getUserByEmail(email);
    if (!user) {
      // Google sign-in has no in-app checkbox; the sign-in buttons carry a
      // "by continuing you agree to the Terms and Privacy Policy" notice, and
      // that's recorded here as acceptance at account creation.
      user = db.createUser({
        id: uuid(),
        email,
        passwordHash: await bcrypt.hash(crypto.randomUUID(), 10),
        createdAt: new Date().toISOString(),
        acceptedTermsAt: new Date().toISOString(),
      });
      db.logEvent(user.id, 'user_registered');
    }
    db.markEmailVerified(user.id); // Google has confirmed the address
    if (user.totpEnabledAt) {
      req.session.pending2fa = { userId: user.id, remember: true, until: Date.now() + 5 * 60 * 1000 };
      return res.redirect('/app?twofactor=1');
    }
    await signIn(req, user.id);
    res.redirect('/');
  } catch (e) {
    console.error('Google login error:', e.message);
    res.redirect('/app?auth=error');
  }
});

// ── Continue with Microsoft (backend/microsoft.js) ──
// GET /api/auth/microsoft/status
router.get('/microsoft/status', (req, res) => {
  res.json({ configured: microsoft.isConfigured() });
});

// GET /api/auth/microsoft — to Microsoft's sign-in page
router.get('/microsoft', (req, res) => {
  if (!microsoft.isConfigured()) return res.status(400).send('Sign in with Microsoft is not set up on this server yet.');
  res.redirect(microsoft.authUrl(req, { scopes: microsoft.SIGN_IN_SCOPES, path: '/api/auth/microsoft/callback', stateKey: 'msLoginState' }));
});

// GET /api/auth/microsoft/callback — same account rules as Google: an
// existing account with that email signs in, otherwise one is created.
// Only an email Microsoft has verified can do either (see
// identityFromClaims), so a work account can't claim someone else's.
router.get('/microsoft/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code || !microsoft.checkState(req, 'msLoginState')) return res.redirect('/app?auth=error');
  try {
    const tokens = await microsoft.exchangeCode(req, { code, scopes: microsoft.SIGN_IN_SCOPES, path: '/api/auth/microsoft/callback' });
    const who = microsoft.identityFromClaims(microsoft.readIdToken(tokens.id_token));
    if (!who.email) return res.redirect('/app?auth=error');
    if (!who.verified) return res.redirect('/app?auth=unverified');

    let user = db.getUserByEmail(who.email);
    if (!user) {
      // As with Google, the buttons carry the "by continuing you agree"
      // notice, recorded as acceptance at account creation.
      user = db.createUser({
        id: uuid(),
        email: who.email,
        passwordHash: await bcrypt.hash(crypto.randomUUID(), 10),
        createdAt: new Date().toISOString(),
        acceptedTermsAt: new Date().toISOString(),
      });
      db.logEvent(user.id, 'user_registered');
      if (who.name) { try { db.updateProfile(user.id, { name: who.name }); } catch { /* name is optional */ } }
    }
    db.markEmailVerified(user.id); // Microsoft has confirmed the address
    if (user.totpEnabledAt) {
      req.session.pending2fa = { userId: user.id, remember: true, until: Date.now() + 5 * 60 * 1000 };
      return res.redirect('/app?twofactor=1');
    }
    await signIn(req, user.id);
    res.redirect('/');
  } catch (e) {
    console.error('Microsoft login error:', e.message);
    res.redirect('/app?auth=error');
  }
});

// POST /api/auth/forgot-password — emails a reset link (through Resend,
// the same service as the other emails). Where email isn't set up the link
// is written to the server log instead, so a self-hosted owner can still
// get back in. The response is the same whether or not the email exists,
// so this endpoint can't be used to discover registered emails.
router.post('/forgot-password', forgotLimit, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.getUserByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.setPasswordResetToken(user.id, token, expiresAt);
    const resetUrl = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/app?resetToken=${token}`;
    try {
      const sent = await sendPasswordResetEmail(email, resetUrl);
      if (!sent) console.log(`\n🔑 Password reset requested for ${email} (email is not set up, so here is the link)\n   ${resetUrl}\n   (valid 1 hour)\n`);
    } catch (e) {
      console.error('Password reset email failed:', e.message);
    }
  }
  res.json({ success: true });
});

// POST /api/auth/reset-password
router.post('/reset-password', resetLimit, async (req, res) => {
  const { token, newPassword } = req.body;
  if (tooShort(newPassword)) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });

  const user = db.getUserByResetToken(token || '');
  if (!user || !user.resetTokenExpires || new Date(user.resetTokenExpires) < new Date()) {
    return res.status(400).json({ error: 'That reset link is invalid or has expired' });
  }

  db.setUserPasswordHash(user.id, await bcrypt.hash(newPassword, 10));
  db.clearPasswordResetToken(user.id);
  db.markEmailVerified(user.id); // the reset link reached their inbox, which proves it's theirs
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
  if (tooShort(newPassword)) return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters` });

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
