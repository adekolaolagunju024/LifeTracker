const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const db = require('../db/db');
const { buildWorkbook } = require('../reports/excel');
const { renderReportPdf, renderReportImage } = require('../reports/visual');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

// GET /api/drive/status
router.get('/status', (req, res) => {
  const drive = db.getGoogleDrive(req.session.userId);
  res.json({
    configured: isConfigured(),
    connected: drive.connected,
    folderName: drive.folderName,
    lastBackupAt: drive.lastBackupAt,
  });
});

// GET /api/drive/connect — redirects to Google's consent screen.
// The session cookie survives the round trip through Google, so
// /callback below still knows which user this is for.
router.get('/connect', (req, res) => {
  if (!isConfigured()) {
    return res.status(400).send('Google Drive is not configured on this server yet. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in .env.');
  }
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
  res.redirect(url);
});

// GET /api/drive/callback — Google redirects here after consent
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?drive=error');
  if (!req.session || !req.session.userId) return res.redirect('/?drive=error');
  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    const current = db.getGoogleDrive(req.session.userId);
    db.setGoogleDrive(req.session.userId, {
      connected: true,
      refreshToken: tokens.refresh_token || current.refreshToken,
    });
    res.redirect('/?drive=connected');
  } catch (e) {
    console.error('Drive OAuth callback error:', e.message);
    res.redirect('/?drive=error');
  }
});

// POST /api/drive/disconnect
router.post('/disconnect', (req, res) => {
  const folderName = db.getGoogleDrive(req.session.userId).folderName;
  db.setGoogleDrive(req.session.userId, { connected: false, refreshToken: null, folderId: null, folderName, lastBackupAt: null });
  res.json({ success: true });
});

async function getDriveClient(userId) {
  const drive = db.getGoogleDrive(userId);
  if (!drive.connected || !drive.refreshToken) throw new Error('Google Drive is not connected');
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: drive.refreshToken });
  return { drive: google.drive({ version: 'v3', auth: oauth2Client }), sheets: google.sheets({ version: 'v4', auth: oauth2Client }) };
}

async function ensureBackupFolder(userId, driveClient) {
  const current = db.getGoogleDrive(userId);
  if (current.folderId) return current.folderId;

  const folderName = current.folderName || 'Waypoint Backups';
  const found = await driveClient.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });
  let folderId;
  if (found.data.files && found.data.files.length) {
    folderId = found.data.files[0].id;
  } else {
    const created = await driveClient.files.create({
      resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    folderId = created.data.id;
  }
  db.setGoogleDrive(userId, { folderId });
  return folderId;
}

function markBackedUp(userId) {
  db.setGoogleDrive(userId, { lastBackupAt: new Date().toISOString() });
}

// Creates the file if it doesn't exist yet in this folder, otherwise
// overwrites its content in place — one always-current file per project
// rather than piling up a new dated copy on every save.
async function upsertDriveFile(drive, folderId, fileName, mimeType, body) {
  const found = await drive.files.list({
    q: `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
  });
  const media = { mimeType, body };
  if (found.data.files && found.data.files.length) {
    const fileId = found.data.files[0].id;
    const updated = await drive.files.update({ fileId, media, fields: 'id, webViewLink' });
    return updated.data;
  }
  const created = await drive.files.create({
    resource: { name: fileName, parents: [folderId] },
    media,
    fields: 'id, webViewLink',
  });
  return created.data;
}

// POST /api/drive/backup/project/:projectId — JSON snapshot of one
// project's whole tree, upserted to "<Project Title>.json" in the same
// auto-created backup folder as the whole-account exports.
router.post('/backup/project/:projectId', async (req, res) => {
  const userId = req.session.userId;
  try {
    const snapshot = db.getProjectSnapshot(userId, req.params.projectId);
    if (!snapshot) return res.status(404).json({ error: 'Project not found' });
    const { drive } = await getDriveClient(userId);
    const folderId = await ensureBackupFolder(userId, drive);
    const fileName = `${snapshot.projects[0].title}.json`;

    const file = await upsertDriveFile(drive, folderId, fileName, 'application/json', JSON.stringify(snapshot, null, 2));

    markBackedUp(userId);
    res.json({ success: true, fileId: file.id, link: file.webViewLink });
  } catch (e) {
    console.error('Project drive backup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/drive/backup — JSON snapshot
router.post('/backup', async (req, res) => {
  const userId = req.session.userId;
  try {
    const { drive } = await getDriveClient(userId);
    const folderId = await ensureBackupFolder(userId, drive);
    const snapshot = db.getFullSnapshot(userId);
    const fileName = `waypoint_backup_${new Date().toISOString().slice(0, 10)}.json`;

    const upload = await drive.files.create({
      resource: { name: fileName, parents: [folderId] },
      media: { mimeType: 'application/json', body: JSON.stringify(snapshot, null, 2) },
      fields: 'id, webViewLink',
    });

    markBackedUp(userId);
    res.json({ success: true, fileId: upload.data.id, link: upload.data.webViewLink });
  } catch (e) {
    console.error('Drive backup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/drive/backup/sheets — live Google Sheet
router.post('/backup/sheets', async (req, res) => {
  const userId = req.session.userId;
  try {
    const { drive, sheets } = await getDriveClient(userId);
    const folderId = await ensureBackupFolder(userId, drive);
    const snapshot = db.getFullSnapshot(userId);

    const created = await sheets.spreadsheets.create({
      resource: { properties: { title: `Waypoint Export ${new Date().toISOString().slice(0, 10)}` } },
    });
    const spreadsheetId = created.data.spreadsheetId;

    // Move it into the backups folder (Sheets API creates in root by default)
    await drive.files.update({ fileId: spreadsheetId, addParents: folderId, fields: 'id, parents' });

    const projectTitleById = Object.fromEntries(snapshot.projects.map(p => [p.id, p.title]));
    const taskRows = [
      ['Title', 'Project', 'Category', 'Status', 'Priority', 'Start', 'Due', 'Cost', 'Notes'],
      ...snapshot.tasks.map(t => [t.title, projectTitleById[t.projectId] || '', t.category, t.status, t.priority, t.startDate, t.endDate, t.cost, t.notes]),
    ];
    const projectRows = [
      ['Title', 'Description', 'Icon', 'Color'],
      ...snapshot.projects.map(p => [p.title, p.description, p.icon, p.color]),
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          { updateSheetProperties: { properties: { sheetId: 0, title: 'Tasks' }, fields: 'title' } },
          { addSheet: { properties: { title: 'Projects' } } },
        ],
      },
    });

    await sheets.spreadsheets.values.update({ spreadsheetId, range: 'Tasks!A1', valueInputOption: 'RAW', resource: { values: taskRows } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: 'Projects!A1', valueInputOption: 'RAW', resource: { values: projectRows } });

    markBackedUp(userId);
    res.json({ success: true, spreadsheetId, link: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` });
  } catch (e) {
    console.error('Sheets export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/drive/backup/excel — .xlsx workbook
router.post('/backup/excel', async (req, res) => {
  const userId = req.session.userId;
  try {
    const { drive } = await getDriveClient(userId);
    const folderId = await ensureBackupFolder(userId, drive);
    const snapshot = db.getFullSnapshot(userId);
    const buffer = await buildWorkbook(snapshot);
    const fileName = `waypoint_export_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const upload = await drive.files.create({
      resource: { name: fileName, parents: [folderId] },
      media: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: require('stream').Readable.from(buffer) },
      fields: 'id, webViewLink',
    });

    markBackedUp(userId);
    res.json({ success: true, fileId: upload.data.id, link: upload.data.webViewLink });
  } catch (e) {
    console.error('Excel export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/drive/backup/pdf — visual summary report as PDF
router.post('/backup/pdf', async (req, res) => {
  const userId = req.session.userId;
  try {
    const { drive } = await getDriveClient(userId);
    const folderId = await ensureBackupFolder(userId, drive);
    const snapshot = db.getFullSnapshot(userId);
    const buffer = await renderReportPdf(snapshot);
    const fileName = `waypoint_report_${new Date().toISOString().slice(0, 10)}.pdf`;

    const upload = await drive.files.create({
      resource: { name: fileName, parents: [folderId] },
      media: { mimeType: 'application/pdf', body: require('stream').Readable.from(buffer) },
      fields: 'id, webViewLink',
    });

    markBackedUp(userId);
    res.json({ success: true, fileId: upload.data.id, link: upload.data.webViewLink });
  } catch (e) {
    console.error('PDF export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/drive/backup/image — visual summary report as PNG
router.post('/backup/image', async (req, res) => {
  const userId = req.session.userId;
  try {
    const { drive } = await getDriveClient(userId);
    const folderId = await ensureBackupFolder(userId, drive);
    const snapshot = db.getFullSnapshot(userId);
    const buffer = await renderReportImage(snapshot);
    const fileName = `waypoint_report_${new Date().toISOString().slice(0, 10)}.png`;

    const upload = await drive.files.create({
      resource: { name: fileName, parents: [folderId] },
      media: { mimeType: 'image/png', body: require('stream').Readable.from(buffer) },
      fields: 'id, webViewLink',
    });

    markBackedUp(userId);
    res.json({ success: true, fileId: upload.data.id, link: upload.data.webViewLink });
  } catch (e) {
    console.error('Image export error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
