const { getTransporter } = require('./mailer');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Tells someone they've been given a seat on a Team plan. A one-off
// message the team's owner caused, like a referral invite.
async function sendTeamSeatEmail({ toEmail, teamName, ownerName, hasAccount, link }) {
  const transporter = getTransporter();
  if (!transporter) return false;
  await transporter.sendMail({
    to: toEmail,
    subject: `${ownerName} gave you KolaWay Pro`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;">
        <p style="font-size:15px;color:#0D1B2A;margin:0 0 12px;"><strong>${esc(ownerName)}</strong> added you to <strong>${esc(teamName)}</strong> on KolaWay.</p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px;">Your seat comes with Pro, paid for by the team, so there is nothing for you to pay. ${hasAccount ? 'It is already on your account.' : 'Sign up with this email address and it will be waiting for you.'}</p>
        <a href="${esc(link)}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">${hasAccount ? 'Open KolaWay' : 'Join KolaWay'}</a>
        <p style="font-size:11px;color:#9CA3AF;margin:24px 0 0;">You're receiving this because ${esc(ownerName)} gave this address a seat on their team. It's a single message.</p>
      </div>
    </body></html>`,
  });
  return true;
}

module.exports = { sendTeamSeatEmail };
