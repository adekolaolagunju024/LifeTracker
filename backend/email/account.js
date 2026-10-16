const { getTransporter } = require('./mailer');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// The "reset your password" email. Returns false when email isn't set up
// on this server, so the caller can fall back to logging the link.
async function sendPasswordResetEmail(toEmail, resetUrl) {
  const transporter = getTransporter();
  if (!transporter) return false;
  await transporter.sendMail({
    to: toEmail,
    subject: 'Reset your KolaWay password',
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;">
        <p style="font-size:16px;font-weight:700;color:#0D1B2A;margin:0 0 12px;">Reset your password</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px;">Someone (hopefully you) asked to reset the password for this KolaWay account. The link below works for one hour.</p>
        <a href="${esc(resetUrl)}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">Choose a new password</a>
        <p style="font-size:12px;color:#6B7280;line-height:1.6;margin:20px 0 0;">If you didn't ask for this, you can ignore this email and your password will stay the same.</p>
      </div>
    </body></html>`,
  });
  return true;
}

// "Confirm your email" for a new email sign-up. False when email isn't set
// up here, so the caller logs the link instead.
async function sendVerifyEmail(toEmail, verifyUrl) {
  const transporter = getTransporter();
  if (!transporter) return false;
  await transporter.sendMail({
    to: toEmail,
    subject: 'Confirm your email for KolaWay',
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;">
        <p style="font-size:16px;font-weight:700;color:#0D1B2A;margin:0 0 12px;">Confirm your email</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px;">Thanks for joining KolaWay. Tap below to confirm this is your address, so password resets and invites reach you. The link works for two days.</p>
        <a href="${esc(verifyUrl)}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">Confirm my email</a>
        <p style="font-size:12px;color:#6B7280;line-height:1.6;margin:20px 0 0;">If you didn't sign up for KolaWay, you can ignore this email.</p>
      </div>
    </body></html>`,
  });
  return true;
}

// An invite to a project for someone without an account yet. The link
// opens sign-up with their email filled in; signing up with it brings the
// invite in for them to accept.
async function sendProjectInviteEmail({ toEmail, inviterName, projectTitle, joinUrl }) {
  const transporter = getTransporter();
  if (!transporter) return false;
  await transporter.sendMail({
    to: toEmail,
    subject: `${inviterName} invited you to "${projectTitle}" on KolaWay`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F5F7;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:20px;padding:28px;border:1px solid #E3E6EA;">
        <p style="font-size:16px;font-weight:700;color:#0D1B2A;margin:0 0 12px;">${esc(inviterName)} invited you to plan together</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px;">You've been invited to the project <strong>${esc(projectTitle)}</strong> on KolaWay, a planner that turns goals into plans and makes finishing them a game. Create a free account with this email address and the project will be waiting for you to accept.</p>
        <a href="${esc(joinUrl)}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 22px;border-radius:10px;">Join the project</a>
        <p style="font-size:12px;color:#6B7280;line-height:1.6;margin:20px 0 0;">If you weren't expecting this, you can ignore this email.</p>
      </div>
    </body></html>`,
  });
  return true;
}

module.exports = { sendPasswordResetEmail, sendVerifyEmail, sendProjectInviteEmail };
