const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/connection');
const { rateLimit } = require('../middleware/rateLimit');
const { getTransporter } = require('../email/mailer');

// ── REPORT A PROBLEM ────────────────────────────────────────────
// From the app's "Report a problem": saved, and emailed to whoever looks
// after this KolaWay (SUPPORT_EMAIL, else ADMIN_EMAILS, else the first
// account), with reply-to set to the person so answering is one click.
// The owner also sees them on the Metrics page.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const limit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: req => `fb:${req.session.userId}`, message: "That's a lot of reports in an hour. Please wait a little and send the rest together." });

function ownerEmails() {
  const list = String(process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (list.length) return list;
  const first = db.prepare('SELECT email FROM users ORDER BY createdAt ASC LIMIT 1').get();
  return first ? [first.email] : [];
}

// POST /api/feedback {message, page}
router.post('/', limit, async (req, res) => {
  const message = String((req.body || {}).message || '').trim();
  if (message.length < 3) return res.status(400).json({ error: 'Tell us a little about what happened' });
  if (message.length > 4000) return res.status(400).json({ error: 'That is very long. Please keep it under 4,000 characters' });
  const page = String((req.body || {}).page || '').slice(0, 200);
  const userAgent = String(req.get('user-agent') || '').slice(0, 300);
  const row = { id: crypto.randomUUID(), userId: req.session.userId, message, page, userAgent, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO feedback (id, userId, message, page, userAgent, createdAt) VALUES (@id, @userId, @message, @page, @userAgent, @createdAt)').run(row);

  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId) || {};
  const to = ownerEmails();
  const mail = getTransporter();
  if (mail && to.length) {
    mail.sendMail({
      to, replyTo: user.email,
      subject: `KolaWay problem report: ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#0D1B2A;line-height:1.6">
        <p style="white-space:pre-wrap;margin:0 0 16px">${esc(message)}</p>
        <p style="color:#556270;font-size:12px;margin:0">From ${esc(user.email || 'unknown')} · page: ${esc(page || '?')}<br>${esc(userAgent)}<br>${esc(row.createdAt)}</p>
      </div>`,
    }).catch(e => console.error('Problem report email failed:', e.message));
  } else {
    console.log(`\n📝 Problem report from ${user.email || req.session.userId} (${page}): ${message}\n`);
  }
  res.status(201).json({ success: true });
});

module.exports = router;
module.exports.ownerEmails = ownerEmails;
