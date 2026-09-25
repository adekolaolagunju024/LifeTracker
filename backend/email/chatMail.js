const db = require('../db/db');
const { getTransporter } = require('./mailer');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Emails a chat message out to the project's team (plus anyone extra CC'd
// by the sender) — an explicit opt-in per message, not every message.
// Returns a small status object the route hands back to the frontend so
// it can show an accurate toast ("emailed 3 people" vs "not configured").
async function sendChatMessageEmail(senderId, projectId, message, ccEmails = []) {
  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: 'Email is not configured on this server' };

  const project = db.getProjectById(senderId, projectId);
  if (!project) return { sent: false, reason: 'Project not found' };

  const sender = db.getProfile(senderId);
  const collaborators = db.listCollaborators(projectId).filter(p => p.joinedAt);
  const recipients = new Set(collaborators.filter(p => p.userId !== senderId).map(p => p.email));
  (ccEmails || []).forEach(raw => {
    const email = String(raw || '').trim();
    if (EMAIL_RE.test(email)) recipients.add(email);
  });
  if (!recipients.size) return { sent: false, reason: 'No one to email — invite teammates or add someone to CC' };

  try {
    await transporter.sendMail({
      from: `"Waypoint" <${process.env.GMAIL_USER}>`,
      to: [...recipients].join(', '),
      subject: `💬 ${sender.name} in ${project.title}`,
      html: `<!doctype html><html><body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;">
          <tr><td align="center">
            <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;">
              <tr><td style="background:#0D1B2A;padding:20px 24px;">
                <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5EEAD4;">Waypoint · ${esc(project.title)}</p>
              </td></tr>
              <tr><td style="padding:24px;">
                <p style="margin:0 0 12px;font-size:14px;color:#0D1B2A;"><strong>${esc(sender.name)}</strong> posted in the project chat:</p>
                <p style="margin:0;font-size:15px;line-height:1.5;color:#1B3A5C;background:#F3F4F6;border-radius:10px;padding:14px 16px;white-space:pre-wrap;">${esc(message.text) || '📎 Sent a photo/file'}</p>
                <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;">Reply from inside Waypoint — <a href="${APP_URL}" style="color:#0A7E8C;">open the app</a></p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body></html>`,
    });
    return { sent: true, recipients: recipients.size };
  } catch (e) {
    console.error('Chat message email failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { sendChatMessageEmail };
