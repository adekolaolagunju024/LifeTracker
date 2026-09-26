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
  duplicateProject: (id)   => request('POST',   `/projects/${id}/duplicate`),

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
  duplicateTask: (id)   => request('POST',   `/tasks/${id}/duplicate`),
  bumpTaskProgress: (id, delta) => request('POST', `/tasks/${id}/progress`, { delta }),
  reorderTasks: (projectId, taskIds) => request('PUT', '/tasks/reorder', { projectId, taskIds }),

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
  backupProjectToDrive: (projectId) => request('POST', `/drive/backup/project/${projectId}`),
  disconnectDrive:    ()  => request('POST', '/drive/disconnect'),
  connectDriveUrl:    ()  => '/api/drive/connect',
  exportProjectUrl:   (projectId) => `/api/data/export/${projectId}`,

  // ── AUTH ──
  getAuthStatus:   ()        => request('GET',  '/auth/status'),
  getMe:           ()        => request('GET',  '/auth/me'),
  register:        (email, password) => request('POST', '/auth/register', { email, password }),
  login:           (email, password, remember = true) => request('POST', '/auth/login', { email, password, remember }),
  logout:          ()        => request('POST', '/auth/logout'),
  changePassword:  (currentPassword, newPassword) => request('PUT', '/auth/password', { currentPassword, newPassword }),
  deleteAccount:   (password) => request('DELETE', '/auth/account', { password }),
  forgotPassword:  (email)    => request('POST', '/auth/forgot-password', { email }),
  resetPassword:   (token, newPassword) => request('POST', '/auth/reset-password', { token, newPassword }),
  getGoogleLoginStatus: ()   => request('GET',  '/auth/google/status'),

  // ── DATA IMPORT ──
  importData: (data) => request('POST', '/data/import', data),

  // ── TAGS ──
  getTags:      ()          => request('GET',    '/tags'),
  addTag:       (data)      => request('POST',   '/tags', data),
  updateTag:    (id, data)  => request('PUT',    `/tags/${id}`, data),
  deleteTag:    (id)        => request('DELETE', `/tags/${id}`),
  setTaskTags:  (taskId, tagIds) => request('PUT', `/tasks/${taskId}/tags`, { tagIds }),

  // ── CHECKLIST (subtasks) ──
  getChecklist:         (taskId)      => request('GET',    `/checklist/${taskId}`),
  addChecklistItem:     (taskId, title) => request('POST', `/checklist/${taskId}`, { title }),
  updateChecklistItem:  (id, patch)    => request('PUT',    `/checklist/item/${id}`, patch),
  deleteChecklistItem:  (id)           => request('DELETE', `/checklist/item/${id}`),

  // ── TRASH ──
  getTrash:            ()   => request('GET',    '/trash'),
  restoreProject:      (id) => request('POST',   `/trash/projects/${id}/restore`),
  restoreTask:         (id) => request('POST',   `/trash/tasks/${id}/restore`),
  purgeProjectForever: (id) => request('DELETE', `/trash/projects/${id}`),
  purgeTaskForever:    (id) => request('DELETE', `/trash/tasks/${id}`),
  purgeAllTrash:       ()   => request('DELETE', '/trash'),

  // ── COLLABORATION (project sharing, invites) ──
  getChatPreviews:      ()             => request('GET',    '/projects/chats'),
  getPendingInvites:    ()             => request('GET',    '/projects/invites'),
  acceptInvite:         (inviteId)     => request('POST',   `/projects/invites/${inviteId}/accept`),
  declineInvite:        (inviteId)     => request('POST',   `/projects/invites/${inviteId}/decline`),
  getCollaborators:     (projectId)    => request('GET',    `/projects/${projectId}/collaborators`),
  inviteCollaborator:   (projectId, email, role) => request('POST', `/projects/${projectId}/collaborators`, { email, role }),
  updateCollaboratorRole: (projectId, userId, role) => request('PUT', `/projects/${projectId}/collaborators/${userId}`, { role }),
  removeCollaborator:   (projectId, userId) => request('DELETE', `/projects/${projectId}/collaborators/${userId}`),
  leaveProject:         (projectId) => request('POST', `/projects/${projectId}/leave`),

  // ── TASK COMMENTS ──
  getComments:    (taskId)       => request('GET',    `/tasks/${taskId}/comments`),
  addComment:     (taskId, text, attachmentId, replyToId) => request('POST', `/tasks/${taskId}/comments`, { text, attachmentId, replyToId }),
  deleteComment:  (commentId)    => request('DELETE', `/tasks/comments/${commentId}`),

  // ── PROJECT CHAT (project-wide) ──
  getProjectMessages:   (projectId)       => request('GET',    `/projects/${projectId}/messages`),
  addProjectMessage:    (projectId, text, attachmentId, alsoEmail, ccEmails, replyToId) => request('POST', `/projects/${projectId}/messages`, { text, attachmentId, alsoEmail, ccEmails, replyToId }),
  deleteProjectMessage: (messageId)       => request('DELETE', `/projects/messages/${messageId}`),

  // ── GO LIVE (embedded video walkthrough) ──
  getLiveStatus:   (projectId) => request('GET',  `/projects/${projectId}/live`),
  startLiveSession: (projectId) => request('POST', `/projects/${projectId}/live/start`),
  endLiveSession:   (projectId) => request('POST', `/projects/${projectId}/live/end`),

  // ── PROJECT STATUS (WhatsApp-style, 24h) ──
  getStatuses:    (projectId)       => request('GET',    `/projects/${projectId}/statuses`),
  addStatus:      (projectId, text, attachmentId) => request('POST', `/projects/${projectId}/statuses`, { text, attachmentId }),
  deleteStatus:   (statusId)        => request('DELETE', `/projects/statuses/${statusId}`),

  // ── ATTACHMENTS (media/files in chat + comments) ──
  uploadAttachment: async (projectId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', projectId);
    const res = await fetch('/api/uploads', { method: 'POST', body: formData });
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try { message = JSON.parse(text).error || text; } catch {}
      throw new Error(message);
    }
    return res.json();
  },
  attachmentUrl: (attachmentId) => `/api/uploads/${attachmentId}`,

  // ── NOTIFICATIONS ──
  getNotifications:      ()  => request('GET',  '/notifications'),
  markNotificationsRead: ()  => request('POST', '/notifications/read'),
};