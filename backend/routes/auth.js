const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/auth/status — always public, tells the frontend whether a session is active
router.get('/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.userId) });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.getUserById(req.session.userId);
  res.json({ email: user.email });
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
  res.json({ email: user.email });
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

module.exports = router;
