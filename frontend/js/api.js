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
    let message = text, code;
    let teamId;
    try { const j = JSON.parse(text); message = j.error || text; code = j.code; teamId = j.teamId; } catch {}

    // A session that expired mid-use — reload so app.js re-checks auth
    // and shows the login screen. Never do this for the auth endpoints
    // themselves, where a 401 just means "wrong password".
    if (res.status === 401 && !path.startsWith('/auth')) {
      window.location.reload();
    }
    const err = new Error(message);
    if (code) err.code = code; // e.g. BLOCKERS_PENDING, WAITING_ON_PREDECESSORS
    if (teamId) err.teamId = teamId; // TEAM_EXISTS: the team this goal already has
    throw err;
  }
  return res.json();
}

const API = {
  // ── PROFILE ──
  getProfile:    ()        => request('GET',    '/profile'),
  updateProfile: (data)    => request('PUT',    '/profile', data),
  getMotivation: ()        => request('GET',    '/motivation'),
  // Which features get used (backend/features.js): once a day each, quietly.
  trackFeature: (feature) => {
    const key = `wp-used:${feature}:${new Date().toISOString().slice(0, 10)}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* private mode */ }
    request('POST', '/admin/feature', { feature }).catch(() => {});
  },
  // reward pledges (backend/routes/pledges.js)
  getPledges:     (projectId)  => request('GET',    `/pledges?projectId=${encodeURIComponent(projectId)}`),
  getPledgeSummary: ()         => request('GET',    '/pledges/summary'),
  createPledgeLink: (projectId) => request('POST',  '/pledges/link', { projectId }),
  deletePledgeLink: (projectId) => request('DELETE', `/pledges/link/${projectId}`),
  addPledge:      (data)       => request('POST',   '/pledges', data),
  pledgeReceived: (id)         => request('PUT',    `/pledges/${id}/received`),
  pledgePayTo:    (id, payTo)  => request('PUT',    `/pledges/${id}/pay-to`, { payTo }),
  pledgeAskRelease: (id)       => request('POST',   `/pledges/${id}/ask-release`),
  pledgeMessages: (id)         => request('GET',    `/pledges/${id}/messages`),
  pledgeSay:      (id, text)   => request('POST',   `/pledges/${id}/messages`, { text }),
  deletePledge:   (id)         => request('DELETE', `/pledges/${id}`),
  musicTitle: (url)        => request('GET',    `/motivation/music-title?url=${encodeURIComponent(url)}`),
  getMusicAccounts: ()     => request('GET',    '/music/accounts'),
  getMusicPlaylists: (p)   => request('GET',    `/music/${p}/playlists`),
  disconnectMusic: (p)     => request('DELETE', `/music/${p}`),
  searchMusic: (q)         => request('GET',    `/motivation/music-search?q=${encodeURIComponent(q)}`),
  getBilling:    ()        => request('GET',    '/billing'),
  startCheckout: (interval) => request('POST',  '/billing/checkout', { interval }),
  openBillingPortal: ()    => request('POST',   '/billing/portal'),
  saveMotivation: (data)   => request('PUT',    '/motivation', data),
  whyInterview:  (messages) => request('POST', '/ai/why-interview', { messages }),

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
  // A step ticked in a race or group that asks for proof: Race asks for it.
  updateTask: async (id, d) => {
    const saved = await request('PUT', `/tasks/${id}`, d);
    if (d && 'status' in d && window.Race) Race.forgetPlan(); // the planner's team chips change with it
    // Finishing a goal opens the goals that were waiting on it.
    if (saved && saved.unlocked && saved.unlocked.length && window.showActionToast) {
      const g = saved.unlocked[0];
      setTimeout(() => showActionToast(`🔓 Unlocked: ${g.title}${saved.unlocked.length > 1 ? ` and ${saved.unlocked.length - 1} more` : ''}`, [{ label: 'Open it', run: () => showPage('project-detail', g.id) }], 'unlock'), 2600);
    }
    if (saved && saved.proofWanted && window.Race) setTimeout(() => Race.askProof(saved.proofWanted), 700);
    return saved;
  },
  deleteTask: (id)      => request('DELETE', `/tasks/${id}`),
  duplicateTask: (id)   => request('POST',   `/tasks/${id}/duplicate`),
  bumpTaskProgress: (id, delta) => request('POST', `/tasks/${id}/progress`, { delta }),
  reorderTasks: (projectId, taskIds) => request('PUT', '/tasks/reorder', { projectId, taskIds }),

  // ── AI INSIGHTS ──
  getAIStatus:   ()  => request('GET',  '/ai/status'),
  aiFill:        (data) => request('POST', '/ai/fill', data),
  // saved chats with the assistant
  getAssistantConversations: ()        => request('GET',    '/ai/conversations'),
  getAssistantConversation:  (id)      => request('GET',    `/ai/conversations/${id}`),
  saveAssistantConversation: (id, d)   => request('PUT',    `/ai/conversations/${id}`, d),
  deleteAssistantConversation: (id)    => request('DELETE', `/ai/conversations/${id}`),

  // ── GOOGLE DRIVE ──
  getDriveStatus:     ()  => request('GET',  '/drive/status'),
  backupToDrive:      ()  => request('POST', '/drive/backup'),
  backupToSheets:     ()  => request('POST', '/drive/backup/sheets'),
  backupToPdf:        ()  => request('POST', '/drive/backup/pdf'),
  backupProjectToDrive: (projectId) => request('POST', `/drive/backup/project/${projectId}`),
  disconnectDrive:    ()  => request('POST', '/drive/disconnect'),
  connectDriveUrl:    ()  => '/api/drive/connect',
  exportProjectUrl:   (projectId) => `/api/data/export/${projectId}`,

  // ── AUTH ──
  getAuthStatus:   ()        => request('GET',  '/auth/status'),
  getMe:           ()        => request('GET',  '/auth/me'),
  verifyEmail:     (token)   => request('POST', '/auth/verify-email', { token }),
  resendVerification: ()     => request('POST', '/auth/resend-verification', {}),
  sendFeedback:    (message, page) => request('POST', '/feedback', { message, page }),
  getAdminFeedback: ()       => request('GET', '/admin/feedback'),
  createRace:      (data)    => request('POST', '/challenges', data),
  joinRace:        (token, displayName) => request('POST', `/challenges/join/${encodeURIComponent(token)}`, { displayName }),
  getRace:         (id)      => request('GET', `/challenges/${id}`),
  getRaceForProject: (projectId) => request('GET', `/challenges/for-project/${projectId}`),
  leaveRace:       (id)      => request('POST', `/challenges/${id}/leave`),
  listRaces:       ()        => request('GET', '/challenges'),
  raceMessages:    (id)      => request('GET', `/challenges/${id}/messages`),
  sayInRace:       (id, text) => request('POST', `/challenges/${id}/messages`, { text }),
  cheerInRace:     (id, color, emoji) => request('POST', `/challenges/${id}/cheer`, { color, emoji }),
  raceCheersSeen:  (id)      => request('POST', `/challenges/${id}/cheers-seen`),
  clearRace:       (id)      => request('POST', `/challenges/${id}/clear`),
  unclearRace:     (id)      => request('DELETE', `/challenges/${id}/clear`),
  previewRaceCode: (code)    => request('GET', `/race-code/${encodeURIComponent(code)}`),
  remindRace:      (id)      => request('POST', `/challenges/${id}/remind`),
  assignRaceStep:  (id, taskId, color) => request('POST', `/challenges/${id}/assign`, { taskId, color }),
  claimRaceStep:   (id, taskId) => request('POST', `/challenges/${id}/claim`, { taskId }),
  splitRaceEvenly: (id)      => request('POST', `/challenges/${id}/split-evenly`),
  raceWeek:        ()        => request('GET', '/challenges/week'),
  helpPlaces:      (taskId)  => request('GET', `/challenges/help-places/${taskId}`),
  askRaceHelp:     (id, obstacleId, note) => request('POST', `/challenges/${id}/help`, { obstacleId, note }),
  offerRaceHelp:   (id, messageId) => request('POST', `/challenges/${id}/help/${messageId}/offer`),
  proveRaceStep:   (id, data) => request('POST', `/challenges/${id}/proof`, data),
  reviewRaceStep:  (id, data) => request('POST', `/challenges/${id}/review`, data),
  register:        (email, password, acceptTerms, ref) => request('POST', '/auth/register', { email, password, acceptTerms, ref }),
  getReferral:     ()        => request('GET',    '/referrals/me'),
  sendReferralInvite: (email) => request('POST', '/referrals/invite', { email }),
  login:           (email, password, remember = true) => request('POST', '/auth/login', { email, password, remember }),
  logout:          ()        => request('POST', '/auth/logout'),
  changePassword:  (currentPassword, newPassword) => request('PUT', '/auth/password', { currentPassword, newPassword }),
  deleteAccount:   (password) => request('DELETE', '/auth/account', { password }),
  forgotPassword:  (email)    => request('POST', '/auth/forgot-password', { email }),
  verify2fa:       (code)     => request('POST', '/auth/2fa/verify', { code }),
  get2faStatus:    ()         => request('GET',  '/auth/2fa/status'),
  setup2fa:        ()         => request('POST', '/auth/2fa/setup'),
  enable2fa:       (code)     => request('POST', '/auth/2fa/enable', { code }),
  disable2fa:      (password, code) => request('POST', '/auth/2fa/disable', { password, code }),
  newRecoveryCodes: (code)    => request('POST', '/auth/2fa/recovery-codes', { code }),
  resetPassword:   (token, newPassword) => request('POST', '/auth/reset-password', { token, newPassword }),
  getGoogleLoginStatus: ()   => request('GET',  '/auth/google/status'),
  getMicrosoftLoginStatus: () => request('GET', '/auth/microsoft/status'),

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
  getProjectTemplates: ()    => request('GET',    '/projects/templates'),
  createFromTemplate:  (data) => request('POST',  '/projects/from-template', data),
  getCalendarFeed:     ()    => request('GET',    '/calendar/feed'),
  getReportShare:      (id)  => request('GET',    `/reports/projects/${id}/share`),
  getReportMedia:      (id)  => request('GET',    `/reports/projects/${id}/media`),
  getProjectAttachments: (id) => request('GET',   `/reports/projects/${id}/attachments`),
  addReportMedia:      (id, data) => request('POST', `/reports/projects/${id}/media`, data),
  removeReportMedia:   (mediaId) => request('DELETE', `/reports/media/${mediaId}`),
  createReportShare:   (id)  => request('POST',   `/reports/projects/${id}/share`),
  deleteReportShare:   (id)  => request('DELETE', `/reports/projects/${id}/share`),
  resetCalendarFeed:   ()    => request('POST',   '/calendar/feed/reset'),
  purgeProjectForever: (id) => request('DELETE', `/trash/projects/${id}`),
  purgeTaskForever:    (id) => request('DELETE', `/trash/tasks/${id}`),
  purgeAllTrash:       ()   => request('DELETE', '/trash'),

  // ── COLLABORATION (project sharing, invites) ──
  getChatPreviews:      ()             => request('GET',    '/projects/chats'),
  getPendingInvites:    ()             => request('GET',    '/projects/invites'),
  acceptInvite:         (inviteId)     => request('POST',   `/projects/invites/${inviteId}/accept`),
  declineInvite:        (inviteId)     => request('POST',   `/projects/invites/${inviteId}/decline`),
  getCollaborators:     (projectId)    => request('GET',    `/projects/${projectId}/collaborators`),
  getJourneyGaming:     ()             => request('GET',    `/journey-gaming/me`),
  inviteCollaborator:   (projectId, email, role) => request('POST', `/projects/${projectId}/collaborators`, { email, role }),
  cancelEmailInvite:    (projectId, email) => request('DELETE', `/projects/${projectId}/email-invites`, { email }),
  updateCollaboratorRole: (projectId, userId, role) => request('PUT', `/projects/${projectId}/collaborators/${userId}`, { role }),
  removeCollaborator:   (projectId, userId) => request('DELETE', `/projects/${projectId}/collaborators/${userId}`),
  leaveProject:         (projectId) => request('POST', `/projects/${projectId}/leave`),

  // ── TASK COMMENTS ──
  getComments:    (taskId)       => request('GET',    `/tasks/${taskId}/comments`),
  addComment:     (taskId, text, attachmentId, replyToId) => request('POST', `/tasks/${taskId}/comments`, { text, attachmentId, replyToId }),
  deleteComment:  (commentId)    => request('DELETE', `/tasks/comments/${commentId}`),
  getStatusUpdates:   (taskId)       => request('GET',    `/tasks/${taskId}/status-updates`),
  addStatusUpdate:    (taskId, text, isBlocker) => request('POST', `/tasks/${taskId}/status-updates`, { text, isBlocker }),
  deleteStatusUpdate: (updateId)     => request('DELETE', `/tasks/status-updates/${updateId}`),
  // ── NATURAL VOICE (backend/voice.js) ──
  // Plain fetch, not request(): asked in the background, so a signed-out
  // answer must not trigger request()'s reload-to-sign-in.
  getVoices: async () => {
    const res = await fetch('/api/voice', { credentials: 'same-origin' });
    return res.ok ? res.json() : { available: false, voices: [] };
  },
  speakText: async (text, voice) => {
    const res = await fetch('/api/voice/speak', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }) });
    if (!res.ok) { const e = new Error((await res.json().catch(() => ({}))).error || 'Voice failed'); e.status = res.status; throw e; }
    return res.blob();
  },
  // ── TODAY'S PLAN (backend/dayPlan.js) ──
  getDayPlan:  (date)        => request('GET', `/day/plan/${date}`),
  saveDayPlan: (date, items) => request('PUT', `/day/plan/${date}`, { items }),
  getWake:     ()            => request('GET', '/day/wake'),
  setWake:     (time, tz)    => request('PUT', '/day/wake', { time, tz }),
  getObstacles:       (taskId)       => request('GET',    `/tasks/${taskId}/obstacles`),
  addObstacle:        (taskId, name, count) => request('POST', `/tasks/${taskId}/obstacles`, { name, count }),
  updateObstacle:     (obstacleId, changes) => request('PUT', `/tasks/obstacles/${obstacleId}`, changes),
  deleteObstacle:     (obstacleId)   => request('DELETE', `/tasks/obstacles/${obstacleId}`),
  setPredecessors:    (taskId, predecessorIds) => request('PUT', `/tasks/${taskId}/predecessors`, { predecessorIds }),
  nudgePredecessor:   (taskId, predecessorId) => request('POST', `/tasks/${taskId}/nudge`, { predecessorId }),

  // ── PROJECT CHAT (project-wide) ──
  getProjectMessages:   (projectId)       => request('GET',    `/projects/${projectId}/messages`),
  addProjectMessage:    (projectId, text, attachmentId, alsoEmail, ccEmails, replyToId) => request('POST', `/projects/${projectId}/messages`, { text, attachmentId, alsoEmail, ccEmails, replyToId }),
  deleteProjectMessage: (messageId)       => request('DELETE', `/projects/messages/${messageId}`),

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

  // ── PUSH REMINDERS ──
  getVapidPublicKey: ()         => request('GET',  '/push/vapid-public-key'),
  subscribePush:     (sub)      => request('POST', '/push/subscribe', sub),
  unsubscribePush:   (endpoint) => request('POST', '/push/unsubscribe', { endpoint }),
  testPush:          ()         => request('POST', '/push/test'),

  // ── OWNER METRICS ──
  getAdminMe:        ()                 => request('GET', '/admin/me'),
  getAdminMetrics:   ()                 => request('GET', '/admin/metrics'),

  // ── TASK REMINDERS (alarms) ──
  getReminders:      ()                 => request('GET', '/reminders'),
  setTaskReminder:   (taskId, data)     => request('PUT', `/reminders/task/${taskId}`, data),
  clearTaskReminder: (taskId)           => request('DELETE', `/reminders/task/${taskId}`),
  snoozeReminder:    (id, minutes)      => request('POST', `/reminders/${id}/snooze`, { minutes }),
  ackReminder:       (id)               => request('POST', `/reminders/${id}/ack`),
};