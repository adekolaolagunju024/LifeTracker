// ═══════════════════════════════════════════════════════════════
// API.JS — Frontend Service Layer
// All fetch() calls to the backend.
// app.js calls these — never fetch() directly.
// ═══════════════════════════════════════════════════════════════

const BASE = '/api';

async function request(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);

  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error || text; } catch {}

    // A session that expired mid-use — reload so app.js re-checks auth
    // and shows the login screen. Never do this for the auth endpoints
    // themselves, where a 401 just means "wrong password".
    if (res.status === 401 && !path.startsWith('/auth')) {
      window.location.reload();
    }
    throw new Error(message);
  }
  return res.json();
}

const API = {
  // ── PROFILE ──
  getProfile:    ()        => request('GET',    '/profile'),
  updateProfile: (data)    => request('PUT',    '/profile', data),

  // ── PROJECTS ──
  getProjects:   (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/projects${qs ? '?' + qs : ''}`);
  },
  getProject:    (id)      => request('GET',    `/projects/${id}`),
  addProject:    (data)    => request('POST',   '/projects', data),
  updateProject: (id, d)   => request('PUT',    `/projects/${id}`, d),
  deleteProject: (id)      => request('DELETE', `/projects/${id}`),

  // ── TASKS ──
  getTasks: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v))
    ).toString();
    return request('GET', `/tasks${qs ? '?' + qs : ''}`);
  },
  getTask:    (id)      => request('GET',    `/tasks/${id}`),
  addTask:    (data)    => request('POST',   '/tasks', data),
  updateTask: (id, d)   => request('PUT',    `/tasks/${id}`, d),
  deleteTask: (id)      => request('DELETE', `/tasks/${id}`),

  // ── WEALTH ──
  getWealth:          ()       => request('GET',    '/wealth'),
  updateWealthEntry:  (data)   => request('PUT',    '/wealth/entries', data),
  addWealthCategory:  (data)   => request('POST',   '/wealth/targets', data),
  updateWealthCategory: (key, data) => request('PUT',    `/wealth/targets/${key}`, data),
  deleteWealthCategory: (key)  => request('DELETE', `/wealth/targets/${key}`),
  getMonthlyLog:      ()       => request('GET',    '/wealth/log'),
  addMonthlyEntry:    (data)   => request('POST',   '/wealth/log', data),
  deleteMonthlyEntry: (id)     => request('DELETE', `/wealth/log/${id}`),

  // ── AI INSIGHTS ──
  getAIStatus:   ()  => request('GET',  '/ai/status'),
  getAIInsights: ()  => request('POST', '/ai/insights'),

  // ── GOOGLE DRIVE ──
  getDriveStatus:     ()  => request('GET',  '/drive/status'),
  backupToDrive:      ()  => request('POST', '/drive/backup'),
  backupToSheets:     ()  => request('POST', '/drive/backup/sheets'),
  backupToExcel:      ()  => request('POST', '/drive/backup/excel'),
  backupToPdf:        ()  => request('POST', '/drive/backup/pdf'),
  backupToImage:      ()  => request('POST', '/drive/backup/image'),
  disconnectDrive:    ()  => request('POST', '/drive/disconnect'),
  connectDriveUrl:    ()  => '/api/drive/connect',

  // ── AUTH ──
  getAuthStatus:   ()        => request('GET',  '/auth/status'),
  getMe:           ()        => request('GET',  '/auth/me'),
  register:        (email, password) => request('POST', '/auth/register', { email, password }),
  login:           (email, password) => request('POST', '/auth/login', { email, password }),
  logout:          ()        => request('POST', '/auth/logout'),
  changePassword:  (currentPassword, newPassword) => request('PUT', '/auth/password', { currentPassword, newPassword }),
};