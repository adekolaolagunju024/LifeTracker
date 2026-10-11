const express = require('express');
const router  = express.Router();
const db = require('../db/db');
const microsoft = require('../microsoft');
const { buildWorkbook } = require('../reports/excel');
const { renderReportPdf } = require('../reports/visual');

// OneDrive backup, the Microsoft twin of Google Drive (routes/drive.js).
// Files go to Waypoint's own app folder (OneDrive → Apps → Waypoint);
// the permission asked for covers only that folder.
const CALLBACK = '/api/onedrive/callback';

// GET /api/onedrive/status
router.get('/status', (req, res) => {
  const od = db.getOneDrive(req.session.userId);
  res.json({ configured: microsoft.isConfigured(), connected: od.connected, account: od.account, lastBackupAt: od.lastBackupAt });
});

// GET /api/onedrive/connect — to Microsoft's consent page
router.get('/connect', (req, res) => {
  if (!microsoft.isConfigured()) return res.status(400).send('OneDrive is not set up on this server yet.');
  res.redirect(microsoft.authUrl(req, { scopes: microsoft.ONEDRIVE_SCOPES, path: CALLBACK, stateKey: 'oneDriveState', prompt: 'consent' }));
});

// GET /api/onedrive/callback
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code || !microsoft.checkState(req, 'oneDriveState')) return res.redirect('/app?onedrive=error');
  try {
    const tokens = await microsoft.exchangeCode(req, { code, scopes: microsoft.ONEDRIVE_SCOPES, path: CALLBACK });
    if (!tokens.refresh_token) throw new Error('Microsoft did not grant offline access');
    const me = await microsoft.graph(tokens.access_token, '/me?$select=mail,userPrincipalName');
    db.setOneDrive(req.session.userId, { connected: true, refreshToken: tokens.refresh_token, account: me.mail || me.userPrincipalName || '' });
    res.redirect('/app?onedrive=connected');
  } catch (e) {
    console.error('OneDrive connect error:', e.message);
    res.redirect('/app?onedrive=error');
  }
});

// POST /api/onedrive/disconnect
router.post('/disconnect', (req, res) => {
  db.setOneDrive(req.session.userId, { connected: false, refreshToken: null, account: '', lastBackupAt: null });
  res.json({ success: true });
});

// A fresh access token, saving the rotated refresh token.
async function accessToken(userId) {
  const od = db.getOneDrive(userId);
  if (!od.connected || !od.refreshToken) throw new Error('OneDrive is not connected');
  const tokens = await microsoft.refreshAccess(od.refreshToken, microsoft.ONEDRIVE_SCOPES);
  if (tokens.refresh_token) db.setOneDrive(userId, { refreshToken: tokens.refresh_token });
  return tokens.access_token;
}
// Uploads (or replaces) a file in the app folder; returns its web link.
async function upload(userId, fileName, mimeType, body) {
  const token = await accessToken(userId);
  const item = await microsoft.graph(token, `/me/drive/special/approot:/${encodeURIComponent(fileName)}:/content`, {
    method: 'PUT', headers: { 'Content-Type': mimeType }, body,
  });
  db.setOneDrive(userId, { lastBackupAt: new Date().toISOString() });
  return item.webUrl;
}

const today = () => new Date().toISOString().slice(0, 10);
const FORMATS = {
  json: async snap => [`waypoint_backup_${today()}.json`, 'application/json', JSON.stringify(snap, null, 2)],
  excel: async snap => [`waypoint_export_${today()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await buildWorkbook(snap)],
  pdf: async snap => [`waypoint_report_${today()}.pdf`, 'application/pdf', await renderReportPdf(snap)],
};

// POST /api/onedrive/backup — { format: json | excel | pdf }
router.post('/backup', async (req, res) => {
  const make = FORMATS[(req.body && req.body.format) || 'json'];
  if (!make) return res.status(400).json({ error: 'Unknown format' });
  try {
    const [name, type, body] = await make(db.getFullSnapshot(req.session.userId));
    const link = await upload(req.session.userId, name, type, body);
    res.json({ success: true, link, name });
  } catch (e) {
    console.error('OneDrive backup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
