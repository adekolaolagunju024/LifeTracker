const cron = require('node-cron');
const db = require('../db/db');
const { getTransporter } = require('./mailer');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Local (not UTC) date key — matches the same technique used client-side
// for the in-app daily digest banner, for the same reason: a task's due
// date is a plain "YYYY-MM-DD" string, and comparing it against a
// UTC-derived date can put a task in the wrong bucket by a day depending
// on the server's timezone offset.
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_COLOR = { 'Not Started': '#6B7280', 'In Progress': '#C0642A', 'Completed': '#1A7A4A' };

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function taskRowHtml(t, breadcrumb) {
  const color = STATUS_COLOR[t.status] || '#6B7280';
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #F3F4F6;">
        <span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.03em;color:${color};background:${color}17;border-radius:999px;padding:2px 8px;text-transform:uppercase;">${esc(t.status)}</span>
        <div style="margin-top:6px;font-size:14px;font-weight:600;color:#0D1B2A;">${esc(t.title)}</div>
        <div style="margin-top:2px;font-size:12px;color:#9CA3AF;">${breadcrumb}</div>
      </td>
    </tr>`;
}

function sectionHtml(title, emoji, rows) {
  if (!rows.length) return '';
  return `
    <tr><td style="padding:20px 0 4px;">
      <div style="font-size:13px;font-weight:700;color:#1B3A5C;">${emoji} ${title} (${rows.length})</div>
      <table width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>
    </td></tr>`;
}

function buildDigestHtml({ name, overdueRows, todayRows, tomorrowRows }) {
  const firstName = esc((name || 'there').split(' ')[0]);
  const body = [
    sectionHtml('Overdue', '🔴', overdueRows),
    sectionHtml('Due Today', '🟡', todayRows),
    sectionHtml('Due Tomorrow', '🔵', tomorrowRows),
  ].join('');

  return `<!doctype html><html><body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;">
          <tr><td style="background:linear-gradient(135deg,#0D1B2A,#1B3A5C);padding:24px 28px;">
            <div style="color:#fff;font-weight:800;font-size:16px;">Waypoint</div>
            <div style="color:rgba(255,255,255,.5);font-size:12px;margin-top:2px;">Your daily digest, ${firstName}</div>
          </td></tr>
          <tr><td style="padding:8px 28px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0">${body}</table>
            <div style="margin-top:24px;text-align:center;">
              <a href="${APP_URL}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;">Open Waypoint →</a>
            </div>
            <p style="margin-top:24px;font-size:11px;color:#9CA3AF;text-align:center;">
              You're getting this because email digests are turned on in your Waypoint Settings. Turn them off any time from there.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

// Builds a "Project title" or "Parent > Sub-folder" breadcrumb for a task.
function breadcrumbFor(task, projectById) {
  const proj = projectById[task.projectId];
  if (!proj) return '';
  const icon = esc(proj.icon || '📁');
  if (proj.parentId && projectById[proj.parentId]) {
    return `${icon} ${esc(projectById[proj.parentId].title)} › ${esc(proj.title)}`;
  }
  return `${icon} ${esc(proj.title)}`;
}

function buildDigestForUser(userId, name) {
  const tasks = db.listTasks(userId);
  const projects = db.listProjects(userId);
  const projectById = Object.fromEntries(projects.map(p => [p.id, p]));

  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const todayKey = localDateKey(today);
  const tomorrowKey = localDateKey(tomorrow);

  const overdueRows = [], todayRows = [], tomorrowRows = [];
  tasks.forEach(t => {
    if (t.status === 'Completed' || !t.endDate) return;
    const dueKey = t.endDate.slice(0, 10);
    const row = taskRowHtml(t, breadcrumbFor(t, projectById));
    if (dueKey < todayKey) overdueRows.push(row);
    else if (dueKey === todayKey) todayRows.push(row);
    else if (dueKey === tomorrowKey) tomorrowRows.push(row);
  });

  if (!overdueRows.length && !todayRows.length && !tomorrowRows.length) return null;
  return buildDigestHtml({ name, overdueRows, todayRows, tomorrowRows });
}

async function runDailyDigest() {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('Email digest: GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping.');
    return;
  }

  const todayKey = localDateKey(new Date());
  const users = db.listUsersForDigest();
  for (const u of users) {
    if (u.lastDigestSentDate === todayKey) continue; // already handled today
    try {
      const html = buildDigestForUser(u.userId, u.name);
      if (html) {
        await transporter.sendMail({
          from: `"Waypoint" <${process.env.GMAIL_USER}>`,
          to: u.email,
          subject: '📋 Your Waypoint digest',
          html,
        });
        console.log(`Digest email sent to ${u.email}`);
      }
    } catch (e) {
      console.error(`Digest email failed for ${u.email}:`, e.message);
    }
    db.setLastDigestSentDate(u.userId, todayKey); // mark checked either way, so a re-run today doesn't reprocess
  }
}

// Runs once a day at 07:00 server time. Skipped entirely (with a log line)
// if Gmail credentials aren't configured, so this is a no-op until the
// account owner opts in by setting them.
function startDigestScheduler() {
  cron.schedule('0 7 * * *', () => { runDailyDigest().catch(e => console.error('Digest run failed:', e.message)); });
}

module.exports = { startDigestScheduler, runDailyDigest };
