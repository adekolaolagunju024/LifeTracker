const db = require('../db/db');
const { getTransporter } = require('./mailer');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function wrapEmailHtml({ heading, bodyHtml }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;">
      <tr><td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;">
          <tr><td style="background:linear-gradient(135deg,#0D1B2A,#1B3A5C);padding:22px 26px;">
            <div style="color:#fff;font-weight:800;font-size:15px;">Waypoint</div>
          </td></tr>
          <tr><td style="padding:24px 26px 28px;">
            <div style="font-size:15px;font-weight:700;color:#0D1B2A;margin-bottom:10px;">${heading}</div>
            ${bodyHtml}
            <div style="margin-top:22px;">
              <a href="${APP_URL}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;">Open Waypoint →</a>
            </div>
            <p style="margin-top:22px;font-size:11px;color:#9CA3AF;">
              You're getting this because activity emails are turned on in your Waypoint Settings. Turn them off any time from there.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function taskCardHtml(task, projectTitle) {
  return `<div style="margin-top:4px;padding:12px 14px;background:#F8FAFC;border-radius:10px;">
    <div style="font-size:13px;font-weight:600;color:#0D1B2A;">${esc(task.title)}</div>
    <div style="font-size:11px;color:#9CA3AF;margin-top:2px;">${esc(projectTitle)}</div>
  </div>`;
}

// A no-op if the recipient hasn't opted in, or Gmail isn't configured on
// the server — same two guards as the daily digest, checked fresh per-send
// rather than cached, since either can change anytime. Logged either way
// (not just on failure) so "nothing arrived" is diagnosable from server
// logs alone — was it skipped, attempted-and-failed, or sent fine?
async function sendActivityEmail(userId, { subject, heading, bodyHtml }) {
  const profile = db.getProfile(userId);
  if (!profile.activityEmailsEnabled) {
    console.log(`Activity email skipped for user ${userId}: activityEmailsEnabled is off.`);
    return;
  }
  const transporter = getTransporter();
  if (!transporter) {
    console.log('Activity email skipped: RESEND_API_KEY not set.');
    return;
  }
  const user = db.getUserById(userId);
  if (!user) return;
  try {
    await transporter.sendMail({
      to: user.email,
      subject,
      html: wrapEmailHtml({ heading, bodyHtml }),
    });
    console.log(`Activity email sent to ${user.email}: ${subject}`);
  } catch (e) {
    console.error(`Activity email failed for ${user.email}:`, e.message);
  }
}

async function notifyAssigned(userId, task, projectTitle, assignedByName) {
  await sendActivityEmail(userId, {
    subject: `📌 You were assigned: ${task.title}`,
    heading: `${esc(assignedByName)} assigned you a task`,
    bodyHtml: taskCardHtml(task, projectTitle),
  });
}

async function notifyMentioned(userId, mentionerName, text, { taskTitle, projectTitle }) {
  const where = taskTitle ? `on "${esc(taskTitle)}"` : `in the ${esc(projectTitle)} chat`;
  await sendActivityEmail(userId, {
    subject: `💬 ${mentionerName} mentioned you`,
    heading: `${esc(mentionerName)} mentioned you ${where}`,
    bodyHtml: `<div style="margin-top:4px;padding:12px 14px;background:#F8FAFC;border-radius:10px;font-size:13px;color:#374151;white-space:pre-wrap;">${esc(text)}</div>`,
  });
}

async function notifyTaskComment(userId, commenterName, task, projectTitle, text) {
  await sendActivityEmail(userId, {
    subject: `💬 New comment on "${task.title}"`,
    heading: `${esc(commenterName)} commented on a task you're on`,
    bodyHtml: taskCardHtml(task, projectTitle) + `<div style="margin-top:8px;font-size:13px;color:#374151;white-space:pre-wrap;">${esc(text)}</div>`,
  });
}

async function notifyInvited(userId, inviterName, projectTitle) {
  await sendActivityEmail(userId, {
    subject: `👥 ${inviterName} invited you to "${projectTitle}"`,
    heading: `${esc(inviterName)} invited you to a project`,
    bodyHtml: `<div style="margin-top:4px;padding:12px 14px;background:#F8FAFC;border-radius:10px;font-size:13px;font-weight:600;color:#0D1B2A;">${esc(projectTitle)}</div>`,
  });
}

async function notifyCheckIn(userId, { projectTitle, message }) {
  await sendActivityEmail(userId, {
    subject: `🎯 Check-in: ${projectTitle}`,
    heading: `Your weekly check-in on "${esc(projectTitle)}"`,
    bodyHtml: `<div style="margin-top:4px;padding:12px 14px;background:#F8FAFC;border-radius:10px;font-size:13px;color:#374151;white-space:pre-wrap;">${esc(message)}</div>`,
  });
}

module.exports = { notifyAssigned, notifyMentioned, notifyTaskComment, notifyInvited, notifyCheckIn };
