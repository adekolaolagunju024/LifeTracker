const { getTransporter } = require('./mailer');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A personal one-off invite the user asked to send. It isn't gated on the
// recipient's settings, because the recipient has never used Waypoint.
async function sendReferralInvite({ toEmail, inviterName, link }) {
  const transporter = getTransporter();
  if (!transporter) throw new Error('Email is not configured on this server.');
  await transporter.sendMail({
    to: toEmail,
    subject: `${inviterName} invited you to Waypoint`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;">
        <p style="font-size:15px;color:#0D1B2A;margin:0 0 12px;"><strong>${esc(inviterName)}</strong> thought you'd like Waypoint.</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px;">Waypoint turns a goal into a plan, then helps you stick to it with reminders, a streak, and a weekly check-in. Sign up with this link and you both get extra AI credits once you create your first goal.</p>
        <a href="${esc(link)}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">Join Waypoint</a>
        <p style="font-size:11px;color:#9CA3AF;margin:24px 0 0;">You're receiving this because ${esc(inviterName)} sent you a personal invite. It's a single message and nothing else will be sent to you.</p>
      </div>
    </body></html>`,
  });
}

module.exports = { sendReferralInvite };
