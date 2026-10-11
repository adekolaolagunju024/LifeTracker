const { getTransporter } = require('./mailer');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The "reset your password" email. Returns false when email isn't set up
// on this server, so the caller can fall back to logging the link.
async function sendPasswordResetEmail(toEmail, resetUrl) {
  const transporter = getTransporter();
  if (!transporter) return false;
  await transporter.sendMail({
    to: toEmail,
    subject: 'Reset your Waypoint password',
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;">
        <p style="font-size:16px;font-weight:700;color:#0D1B2A;margin:0 0 12px;">Reset your password</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px;">Someone (hopefully you) asked to reset the password for this Waypoint account. The link below works for one hour.</p>
        <a href="${esc(resetUrl)}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">Choose a new password</a>
        <p style="font-size:12px;color:#6B7280;line-height:1.6;margin:20px 0 0;">If you didn't ask for this, you can ignore this email and your password will stay the same.</p>
      </div>
    </body></html>`,
  });
  return true;
}

module.exports = { sendPasswordResetEmail };
