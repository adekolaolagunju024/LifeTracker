const { Resend } = require('resend');

// Shared by the daily digest, activity emails, and chat-message emails.
// Sends over plain HTTPS (Resend's API), not SMTP — Railway (and several
// other PaaS hosts) blocks outbound SMTP entirely below their paid tiers,
// so a nodemailer+Gmail transport can't reach Gmail's servers at all from
// a deployment there, regardless of how correct the credentials are.
//
// Without a verified sending domain, Resend's sandbox sender
// (onboarding@resend.dev) only delivers to the Resend account's own
// email address — fine for the digest/activity emails this account gets
// about its own tasks, but emailing other collaborators (chat email-out,
// invites, mentions) needs a verified domain (RESEND_FROM_EMAIL set to an
// address on it). See resend.com/docs/dashboard/domains/introduction.
function getTransporter() {
  if (!process.env.RESEND_API_KEY) return null;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM_EMAIL || 'Waypoint <onboarding@resend.dev>';
  return {
    sendMail: async ({ to, subject, html }) => {
      const { error } = await resend.emails.send({ from, to, subject, html });
      if (error) throw new Error(error.message || 'Resend send failed');
    },
  };
}

module.exports = { getTransporter };
