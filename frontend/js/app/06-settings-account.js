// Waypoint app, part 6 of 12: Settings, trash, notifications, push, sign-in, onboarding, Google Drive.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── SETTINGS ────────────────────────────────────────────────────
async function renderSettings() {
  try {
    const p = await API.getProfile();
    document.getElementById('set-name').value     = profileName(p);
    loadCalendarFeed();
    loadTwoFactorStatus();
    document.getElementById('set-tagline').value  = p.tagline;
    const cur = document.getElementById('set-currency');
    if (p.currency && ![...cur.options].some(o => o.value === p.currency)) cur.add(new Option(p.currency, p.currency));
    cur.value = p.currency || '£';
    const longest = p.longestStreak || 0;
    document.getElementById('set-display-stats').textContent = p.currentStreak ? `${p.currentStreak}-day streak${longest > p.currentStreak ? ` · best ${longest}` : ''}` : (longest ? `Best streak: ${longest} days` : 'Finish a task today to start a streak');
    previewProfile();
    showSettingsTab(APP.settingsTab || (() => { try { return localStorage.getItem('settingsTab'); } catch { return null; } })() || 'profile');
    setEmailDigestButton(p.emailDigestEnabled);
    setPushRemindersButton(p);
    setActivityEmailsButton(p.activityEmailsEnabled);
    setAiCheckInsButton(p.aiCheckInsEnabled);
    setCelebrationEffectsButton(p.celebrationEffectsEnabled);
    APP.profile = p;
    loadReferralCard();
    renderSettingsDrive();
    renderSettingsOneDrive();
    API.getMe().then(me => {
      document.getElementById('account-email').textContent = me.email;
      document.getElementById('set-display-email').textContent = me.email;
    }).catch(() => {});
  } catch (e) { console.error('Settings error:', e); }
}

// Settings show one section at a time (tabs); the last one opened is
// remembered on this device. showSettingsTab('data') from anywhere jumps
// straight to Trash.
function showSettingsTab(key) {
  if (!document.querySelector(`[data-settings-panel="${key}"]`)) key = 'profile';
  APP.settingsTab = key;
  try { localStorage.setItem('settingsTab', key); } catch { /* storage off */ }
  document.querySelectorAll('[data-settings-panel]').forEach(p => { p.hidden = p.dataset.settingsPanel !== key; });
  if (key === 'appearance' && window.Voice) Voice.renderSettings();
  if (key === 'profile' && window.Billing) Billing.render();
  document.querySelectorAll('.settings-tabs [data-tab]').forEach(b => {
    const on = b.dataset.tab === key;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  if (key === 'data') renderTrash();
}
// Arrow keys move between the tabs, as a tab list should.
document.addEventListener('keydown', e => {
  if (!e.target.closest || !e.target.closest('.settings-tabs') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const tabs = [...document.querySelectorAll('.settings-tabs [data-tab]')];
  const i = tabs.indexOf(e.target);
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  showSettingsTab(next.dataset.tab); next.focus();
});
// The avatar and name at the top of Profile follow the name as it's typed.
function previewProfile() {
  const name = document.getElementById('set-name').value.trim();
  const initials = name ? name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '';
  document.getElementById('set-avatar').innerHTML = initials ? esc(initials) : icon('user');
  document.getElementById('set-display-name').textContent = name || 'Add your name';
}

// ── TRASH ────────────────────────────────────────────────────────
// Grouped by project: a deleted project carries its folders and tasks as
// one entry (restoring it brings them all back), and tasks deleted on their
// own sit under the project they came from. Groups open to show what's in
// them, each item still restorable on its own.
async function renderTrash() {
  const list = document.getElementById('trash-list');
  try {
    const [{ projects, tasks }, activeProjects] = await Promise.all([API.getTrash(), API.getProjects()]);
    document.getElementById('btn-empty-trash').classList.toggle('hidden', !projects.length && !tasks.length);
    if (!projects.length && !tasks.length) {
      list.innerHTML = `<p class="text-center text-gray-400 text-sm py-6">Trash is empty</p>`;
      return;
    }
    const trashedById = Object.fromEntries(projects.map(p => [p.id, p]));
    const activeById = Object.fromEntries(activeProjects.map(p => [p.id, p]));
    const daysLeft = deletedAt => Math.max(0, 30 - Math.floor((Date.now() - new Date(deletedAt)) / 86400000));
    const purgeText = d => `purges in ${daysLeft(d)} day${daysLeft(d) === 1 ? '' : 's'}`;
    // The trashed project a project belongs under: its trashed parent, else itself.
    const rootOf = p => (p.parentId && trashedById[p.parentId]) ? trashedById[p.parentId] : p;
    const groups = new Map(); // key -> { project, trashed, folders: [], tasks: [] }
    const groupFor = (key, project, trashed) => {
      if (!groups.has(key)) groups.set(key, { project, trashed, folders: [], tasks: [] });
      return groups.get(key);
    };
    projects.forEach(p => {
      const root = rootOf(p);
      const g = groupFor(root.id, root, true);
      if (root.id !== p.id) g.folders.push(p);
    });
    tasks.forEach(t => {
      const own = trashedById[t.projectId];
      if (own) { groupFor(rootOf(own).id, rootOf(own), true).tasks.push(t); return; }
      const live = activeById[t.projectId];
      const top = live && live.parentId && activeById[live.parentId] ? activeById[live.parentId] : live;
      groupFor('live:' + (top ? top.id : 'none'), top || { title: 'Unknown project', icon: '📄' }, false).tasks.push({ ...t, folder: live && top && live.id !== top.id ? live.title : '' });
    });
    const iconBtn = (label, onclick, danger) => `<button type="button" onclick="${onclick}" class="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 ${danger ? 'text-red-600 hover:bg-red-50' : 'text-teal hover:bg-teal/10'}">${label}</button>`;
    const sorted = [...groups.values()].sort((a, b) => (b.trashed - a.trashed) || String(b.project.deletedAt || '').localeCompare(String(a.project.deletedAt || '')));
    const nT = tasks.length, nP = projects.filter(p => !p.parentId || !trashedById[p.parentId]).length;
    list.innerHTML = `<p class="text-xs font-semibold text-gray-500 mb-3">${nP ? `${nP} project${nP === 1 ? '' : 's'}` : ''}${nP && nT ? ' · ' : ''}${nT ? `${nT} task${nT === 1 ? '' : 's'}` : ''}</p>` + sorted.map(g => {
      const p = g.project;
      const counts = [g.folders.length ? `${g.folders.length} folder${g.folders.length === 1 ? '' : 's'}` : '', g.tasks.length ? `${g.tasks.length} task${g.tasks.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      const sub = g.trashed ? `${p.parentId ? 'Folder' : 'Project'}${counts ? ' · ' + counts : ''} · ${purgeText(p.deletedAt)}` : `Deleted from this project, which is still active · ${counts}`;
      const ids = g.tasks.map(t => t.id).join(',');
      const actions = g.trashed
        ? iconBtn('Restore all', `event.preventDefault(); restoreProjectFromTrash('${p.id}')`) + iconBtn('Delete forever', `event.preventDefault(); purgeProjectFromTrash('${p.id}','${esc(p.title).replace(/'/g, '&#39;')}')`, true)
        : iconBtn('Restore all', `event.preventDefault(); restoreTasksFromTrash('${ids}')`);
      const items = [
        ...g.folders.map(f => `<div class="flex items-center gap-2 py-2"><span>${icon('folder')}</span><div class="flex-1 min-w-0"><p class="text-sm font-semibold text-navy truncate">${esc(f.title)}</p><p class="text-[11px] text-gray-400">Folder · ${purgeText(f.deletedAt)}</p></div>${iconBtn('Restore', `restoreProjectFromTrash('${f.id}')`)}</div>`),
        ...g.tasks.map(t => `<div class="flex items-center gap-2 py-2"><span class="text-gray-300">•</span><div class="flex-1 min-w-0"><p class="text-sm text-navy truncate">${esc(t.title)}</p><p class="text-[11px] text-gray-400">${t.folder ? esc(t.folder) + ' · ' : ''}${purgeText(t.deletedAt)}</p></div>${iconBtn('Restore', `restoreTaskFromTrash('${t.id}')`)}${iconBtn('Delete', `purgeTaskFromTrash('${t.id}','${esc(t.title).replace(/'/g, '&#39;')}')`, true)}</div>`),
      ].join('');
      return `<details class="trash-group">
        <summary><span class="chev" aria-hidden="true">▶</span><span class="text-lg flex-shrink-0">${emojiIcon(p.icon || '📁')}</span>
          <span class="flex-1 min-w-0"><span class="block text-sm font-bold text-navy truncate">${esc(p.title)}</span><span class="block text-xs text-gray-400 truncate">${sub}</span></span>
          <span class="flex flex-wrap justify-end gap-1">${actions}</span></summary>
        ${items ? `<div class="trash-items">${items}</div>` : ''}
      </details>`;
    }).join('');
  } catch (e) {
    console.error('Trash error:', e);
    list.innerHTML = `<p class="text-center text-red-400 text-sm py-6">Failed to load Trash</p>`;
  }
}

async function restoreTasksFromTrash(idList) {
  try {
    for (const id of idList.split(',').filter(Boolean)) await API.restoreTask(id);
    showToast('✅ Restored');
    renderTrash();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to restore'), 'error'); }
}

async function restoreProjectFromTrash(id) {
  try {
    await API.restoreProject(id);
    showToast('✅ Restored');
    renderTrash();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to restore'), 'error'); }
}

async function restoreTaskFromTrash(id) {
  try {
    await API.restoreTask(id);
    showToast('✅ Restored');
    renderTrash();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to restore'), 'error'); }
}

function purgeProjectFromTrash(id, title) {
  confirmAction(`Permanently delete "${title}" and everything in it? This cannot be undone.`, async () => {
    await API.purgeProjectForever(id);
    showToast('🗑️ Permanently deleted');
    renderTrash();
  });
}

function purgeTaskFromTrash(id, title) {
  confirmAction(`Permanently delete "${title}"? This cannot be undone.`, async () => {
    await API.purgeTaskForever(id);
    showToast('🗑️ Permanently deleted');
    renderTrash();
  });
}

function purgeAllTrashConfirm() {
  confirmAction('Permanently delete everything in Trash? This cannot be undone.', async () => {
    try {
      await API.purgeAllTrash();
      showToast('🗑️ Trash emptied');
      renderTrash();
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to empty Trash'), 'error'); }
  });
}

async function saveSettings() {
  try {
    await API.updateProfile({
      name:           document.getElementById('set-name').value,
      tagline:        document.getElementById('set-tagline').value,
      currency:       document.getElementById('set-currency').value,
    });
    updateSidebar();
    showToast('✅ Profile saved');
  } catch (e) { showToast('❌ Failed to save', 'error'); }
}

function setEmailDigestButton(enabled) {
  const btn = document.getElementById('email-digest-btn');
  btn.classList.toggle('on', enabled);
  btn.dataset.enabled = enabled ? '1' : '0';
}

async function toggleEmailDigest() {
  const btn = document.getElementById('email-digest-btn');
  const next = btn.dataset.enabled !== '1';
  try {
    await API.updateProfile({ emailDigestEnabled: next });
    setEmailDigestButton(next);
    showToast(next ? '✅ Daily digest emails turned on' : 'Daily digest emails turned off');
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to update'), 'error'); }
}

// ── ACTIVITY EMAILS (instant per-event — assigned/mentioned/commented/invited) ──
function setActivityEmailsButton(enabled) {
  const btn = document.getElementById('activity-emails-btn');
  btn.classList.toggle('on', enabled);
  btn.dataset.enabled = enabled ? '1' : '0';
}
async function toggleActivityEmails() {
  const btn = document.getElementById('activity-emails-btn');
  const next = btn.dataset.enabled !== '1';
  try {
    await API.updateProfile({ activityEmailsEnabled: next });
    setActivityEmailsButton(next);
    showToast(next ? '✅ Activity emails turned on' : 'Activity emails turned off');
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to update'), 'error'); }
}

// ── CELEBRATION EFFECTS (confetti/balloons/the full-screen project-complete
// page) — one blanket on/off switch; APP.profile is kept in sync so every
// celebration call site (anywhere in the app, including Journey's own
// Phaser scene) can check it without a fresh fetch each time.
function setCelebrationEffectsButton(enabled) {
  const btn = document.getElementById('celebration-effects-btn');
  btn.classList.toggle('on', enabled);
  btn.dataset.enabled = enabled ? '1' : '0';
}
function celebrationsEnabled() {
  return !APP.profile || APP.profile.celebrationEffectsEnabled !== false;
}
async function toggleCelebrationEffects() {
  const btn = document.getElementById('celebration-effects-btn');
  const next = btn.dataset.enabled !== '1';
  try {
    const profile = await API.updateProfile({ celebrationEffectsEnabled: next });
    APP.profile = profile;
    setCelebrationEffectsButton(next);
    showToast(next ? '✅ Celebration effects turned on' : 'Celebration effects turned off');
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to update'), 'error'); }
}

// ── WEEKLY AI GOAL CHECK-INS (read-only status check, not plan edits) ──
function setAiCheckInsButton(enabled) {
  const btn = document.getElementById('ai-checkins-btn');
  btn.classList.toggle('on', enabled);
  btn.dataset.enabled = enabled ? '1' : '0';
}
async function toggleAiCheckIns() {
  const btn = document.getElementById('ai-checkins-btn');
  const next = btn.dataset.enabled !== '1';
  try {
    await API.updateProfile({ aiCheckInsEnabled: next });
    setAiCheckInsButton(next);
    showToast(next ? '✅ Weekly AI check-ins turned on' : 'Weekly AI check-ins turned off');
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to update'), 'error'); }
}

// ── PUSH REMINDERS (real OS-level notifications on this device) ──
// The Settings toggle reflects — and drives — THIS device's own browser
// subscription, not just a database flag: turning it on actually requests
// Notification permission and registers a service worker, since a
// "reminders enabled" account flag with no device actually subscribed
// would silently send nothing.
// profile is the full /api/profile object — the master switch's own on/off
// state plus the three per-type toggles and focus-nudge timing all live
// there, so one render call keeps all of it in sync rather than threading
// four separate booleans through every call site.
function setPushRemindersButton(profile) {
  const enabled = profile.pushRemindersEnabled;
  const btn = document.getElementById('push-reminders-btn');
  btn.classList.toggle('on', enabled);
  btn.dataset.enabled = enabled ? '1' : '0';
  document.getElementById('push-reminders-test-row').classList.toggle('hidden', !enabled);
  document.getElementById('push-reminders-status').textContent = '';
  document.getElementById('push-type-settings').classList.toggle('hidden', !enabled);
  if (!enabled) return;

  setPushTypeButton('push-type-overdue-btn', profile.pushOverdueEnabled);
  setPushTypeButton('push-type-duetoday-btn', profile.pushDueTodayEnabled);
  setPushTypeButton('push-type-focusnudge-btn', profile.pushFocusNudgeEnabled);
  setPushTypeButton('push-type-streak-btn', profile.pushStreakEnabled);
  document.getElementById('focus-nudge-timing-row').classList.toggle('hidden', !profile.pushFocusNudgeEnabled);

  populateHourSelect('focus-nudge-start', profile.focusNudgeStartHour ?? 9);
  populateHourSelect('focus-nudge-end', profile.focusNudgeEndHour ?? 18);
  document.getElementById('focus-nudge-interval').value = String(profile.focusNudgeIntervalMinutes ?? 120);
}

function setPushTypeButton(id, enabled) {
  const btn = document.getElementById(id);
  btn.classList.toggle('on', enabled);
  btn.dataset.enabled = enabled ? '1' : '0';
}

function populateHourSelect(id, selectedHour) {
  const sel = document.getElementById(id);
  const label = h => h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
  sel.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === selectedHour ? 'selected' : ''}>${label(h)}</option>`).join('');
}

async function togglePushType(field) {
  const idMap = { pushOverdueEnabled: 'push-type-overdue-btn', pushDueTodayEnabled: 'push-type-duetoday-btn', pushFocusNudgeEnabled: 'push-type-focusnudge-btn', pushStreakEnabled: 'push-type-streak-btn' };
  const btn = document.getElementById(idMap[field]);
  const next = btn.dataset.enabled !== '1';
  try {
    const profile = await API.updateProfile({ [field]: next });
    setPushRemindersButton(profile);
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to update'), 'error'); }
}

async function saveFocusNudgeTiming() {
  try {
    await API.updateProfile({
      focusNudgeStartHour: parseInt(document.getElementById('focus-nudge-start').value, 10),
      focusNudgeEndHour: parseInt(document.getElementById('focus-nudge-end').value, 10),
      focusNudgeIntervalMinutes: parseInt(document.getElementById('focus-nudge-interval').value, 10),
    });
    showToast('✅ Focus nudge timing saved');
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to update'), 'error'); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Pulled out of togglePushReminders() so it can also be called from
// contexts that don't have the Settings page's own toggle button in view
// (e.g. the one-time nudge after creating a goal via AI chat) — it doesn't
// read or depend on any Settings-page DOM state.
async function enablePushReminders() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error("Push notifications aren't supported in this browser");
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await API.getVapidPublicKey();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await API.subscribePush(subscription.toJSON());
  const profile = await API.updateProfile({ pushRemindersEnabled: true });
  setPushRemindersButton(profile);
  return profile;
}

async function togglePushReminders() {
  const btn = document.getElementById('push-reminders-btn');
  const turningOn = btn.dataset.enabled !== '1';
  try {
    if (turningOn) {
      await enablePushReminders();
      showToast('✅ Push reminders turned on');
    } else {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await API.unsubscribePush(subscription.endpoint).catch(() => {});
        await subscription.unsubscribe();
      }
      const profile = await API.updateProfile({ pushRemindersEnabled: false });
      setPushRemindersButton(profile);
      showToast('Push reminders turned off');
    }
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to update push reminders'), 'error');
  }
}

async function sendTestPush() {
  const statusEl = document.getElementById('push-reminders-status');
  statusEl.textContent = 'Sending…';
  try {
    await API.testPush();
    statusEl.textContent = 'Sent — check your notifications.';
  } catch (e) {
    statusEl.textContent = '' + (e.message || 'Failed to send');
  }
}

// ── AUTH ────────────────────────────────────────────────────────
async function checkAuth() {
  const status = await API.getAuthStatus();
  if (!status.authenticated) {
    showAuthView('login');
    return false;
  }
  return true;
}

function showAuthView(view) {
  document.getElementById('auth-overlay').classList.add('open');
  document.getElementById('auth-view-login').classList.toggle('active', view === 'login');
  document.getElementById('auth-view-register').classList.toggle('active', view === 'register');
  document.getElementById('auth-view-forgot').classList.toggle('active', view === 'forgot');
  document.getElementById('auth-view-reset').classList.toggle('active', view === 'reset');
  document.getElementById('auth-view-2fa').classList.toggle('active', view === '2fa');
  if (view === '2fa') setTimeout(() => document.getElementById('auth-2fa-code').focus(), 50);
  // One-tap sign-in buttons: each shows only when its provider is set up
  // on this server, and the block (with its "or" divider) only if any is.
  Promise.all([API.getGoogleLoginStatus().catch(() => ({})), API.getMicrosoftLoginStatus().catch(() => ({}))]).then(([g, m]) => {
    ['login', 'register'].forEach(v => {
      document.getElementById(`google-${v}-only`).classList.toggle('hidden', !g.configured);
      document.getElementById(`ms-${v}-only`).classList.toggle('hidden', !m.configured);
      document.getElementById(`google-${v}-btn`).classList.toggle('hidden', !g.configured && !m.configured);
    });
  });
}

function closeAuth() {
  document.getElementById('auth-overlay').classList.remove('open');
}

function showAuthError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.remove('hidden');
}

// Lets the browser's native password manager offer to save the credential
// (works even in an SPA with no full-page navigation) on browsers that
// support the Credential Management API — a no-op everywhere else.
function offerToSaveCredential(email, password) {
  if (!window.PasswordCredential) return;
  try {
    navigator.credentials.store(new PasswordCredential({ id: email, password, name: email }));
  } catch { /* best-effort only */ }
}

function handleAuthRegisterSubmit(event) {
  event.preventDefault();
  submitAuthRegister();
  return false;
}

function handleAuthLoginSubmit(event) {
  event.preventDefault();
  submitAuthLogin();
  return false;
}

async function submitAuthRegister() {
  const email    = document.getElementById('auth-register-email').value.trim();
  const password = document.getElementById('auth-register-password').value;
  const confirm  = document.getElementById('auth-register-confirm').value;
  if (password.length < 8) return showAuthError('auth-register-error', 'Password must be at least 8 characters');
  if (password !== confirm) return showAuthError('auth-register-error', 'Passwords do not match');
  const acceptTerms = document.getElementById('auth-register-terms').checked;
  if (!acceptTerms) return showAuthError('auth-register-error', 'Please agree to the Terms and Privacy Policy to create an account');
  let ref = null;
  try { ref = localStorage.getItem('waypointRef'); } catch {}
  try {
    await API.register(email, password, acceptTerms, ref || undefined);
    try { localStorage.removeItem('waypointRef'); } catch {}
    offerToSaveCredential(email, password);
    closeAuth();
    await afterAuth();
  } catch (e) { showAuthError('auth-register-error', e.message); }
}

async function submitAuthLogin() {
  const email    = document.getElementById('auth-login-email').value.trim();
  const password = document.getElementById('auth-login-password').value;
  const remember = document.getElementById('auth-login-remember').checked;
  try {
    const result = await API.login(email, password, remember);
    offerToSaveCredential(email, password);
    if (result && result.twoFactorRequired) {
      document.getElementById('auth-2fa-code').value = '';
      document.getElementById('auth-2fa-error').classList.add('hidden');
      showAuthView('2fa');
      return;
    }
    closeAuth();
    await afterAuth();
  } catch (e) { showAuthError('auth-login-error', e.message); }
}

function handleAuth2faSubmit(event) {
  event.preventDefault();
  submitAuth2fa();
  return false;
}
async function submitAuth2fa() {
  const code = document.getElementById('auth-2fa-code').value.trim();
  if (!code) return;
  try {
    await API.verify2fa(code);
    closeAuth();
    if (new URLSearchParams(location.search).has('twofactor')) history.replaceState(null, '', '/app');
    await afterAuth();
  } catch (e) { showAuthError('auth-2fa-error', e.message); }
}

function handleAuthForgotSubmit(event) {
  event.preventDefault();
  submitAuthForgot();
  return false;
}

function handleAuthResetSubmit(event) {
  event.preventDefault();
  submitAuthReset();
  return false;
}

async function submitAuthForgot() {
  const email = document.getElementById('auth-forgot-email').value.trim();
  try {
    await API.forgotPassword(email);
    document.getElementById('auth-forgot-success').classList.remove('hidden');
  } catch {
    // Same response either way — this endpoint never reveals whether the email exists.
    document.getElementById('auth-forgot-success').classList.remove('hidden');
  }
}

let pendingResetToken = null;

async function submitAuthReset() {
  const password = document.getElementById('auth-reset-password').value;
  const confirm  = document.getElementById('auth-reset-confirm').value;
  if (password.length < 8) return showAuthError('auth-reset-error', 'Password must be at least 8 characters');
  if (password !== confirm) return showAuthError('auth-reset-error', 'Passwords do not match');
  try {
    await API.resetPassword(pendingResetToken, password);
    showToast('Password updated — log in with your new password.', 'success');
    // Drop the token from the URL so a refresh/back doesn't re-show the reset form.
    window.history.replaceState({}, '', window.location.pathname);
    showAuthView('login');
  } catch (e) { showAuthError('auth-reset-error', e.message); }
}

function startMicrosoftLogin() { window.location.href = '/api/auth/microsoft'; }

async function startGoogleLogin() {
  try {
    const status = await API.getGoogleLoginStatus();
    if (!status.configured) {
      showToast('Sign in with Google isn\'t configured on this server yet.', 'error');
      return;
    }
    window.location.href = '/api/auth/google';
  } catch {
    showToast('Sign in with Google isn\'t available right now.', 'error');
  }
}

async function afterAuth() {
  try { APP.currentUserId = (await API.getMe()).id; } catch (e) { console.error('getMe error:', e); }
  const showingOnboarding = await checkOnboarding();
  if (!showingOnboarding) await showPage('dashboard');
  checkDailyDigest();
  checkPendingInvites();
  refreshNotificationBadge();
  setInterval(refreshNotificationBadge, 60000); // a periodic check, not a live socket — same pattern as presence
  if (window.Reminders) Reminders.boot();
  if (window.Metrics) Metrics.initNav();
  if (window.Why) Why.load().catch(() => {}); // ready for the alarm screen
  if (window.Jarvis) Jarvis.resumeFocus(); // a focus session survives a reload
  if (window.Billing) Billing.handleReturn(); // back from Stripe's checkout
  if (window.Why) Why.handleShare(); // shared in from another app (manifest share_target)
  if (window.Why) Why.handleMusicReturn(); // back from linking Spotify or YouTube
}

// Pending project-share invites — checked once per login (not re-dismissed
// per day like the digest banner, since an invite needs an actual
// accept/decline, not just "seen it").
async function checkPendingInvites() {
  try {
    const invites = await API.getPendingInvites();
    if (!invites.length) { document.getElementById('invites-banner').classList.add('hidden'); return; }
    document.getElementById('invites-banner-text').innerHTML =
      `<strong>${invites.length}</strong> project invitation${invites.length === 1 ? '' : 's'} waiting on you.`;
    document.getElementById('invites-banner').classList.remove('hidden');
  } catch (e) { console.error('Invites check error:', e); }
}

// ── NOTIFICATION BELL (invites + assigned tasks + chat/comment activity) ──
function notificationCount(data) {
  return data.invites.length + data.assignedTasks.length + data.chatActivity.length + data.commentActivity.length;
}

async function refreshNotificationBadge() {
  try {
    const data = await API.getNotifications();
    const count = notificationCount(data);
    const badge = document.getElementById('notif-badge-count');
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.classList.toggle('hidden', count === 0);

    // Chats nav item — like an unread mail count, total unseen messages
    // across every project chat (not just how many projects have activity).
    const chatCount = data.chatActivity.reduce((sum, c) => sum + c.count, 0);
    const chatBadge = document.getElementById('nav-chats-badge');
    chatBadge.textContent = chatCount > 99 ? '99+' : String(chatCount);
    chatBadge.classList.toggle('hidden', chatCount === 0);
  } catch (e) { console.error('Notifications badge error:', e); }
}

async function toggleNotifications(e) {
  e.stopPropagation();
  const dropdown = document.getElementById('notif-dropdown');
  const opening = dropdown.classList.contains('hidden');
  if (!opening) { closeNotifications(); return; }
  dropdown.classList.remove('hidden');
  try {
    const data = await API.getNotifications();
    renderNotificationsList(data);
    // Marking read happens after we've captured what to show, so this
    // open still displays everything that was new — only the NEXT open
    // (or badge refresh) reflects the drop to zero.
    await API.markNotificationsRead();
    refreshNotificationBadge();
  } catch (e) { console.error('Notifications error:', e); }
}

function closeNotifications() {
  document.getElementById('notif-dropdown').classList.add('hidden');
}

function renderNotificationsList(data) {
  const wrap = document.getElementById('notif-list');
  const rows = [];

  data.invites.forEach(inv => rows.push(`
    <button onclick="closeNotifications(); openInvitesModal();" class="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3">
      <span class="text-lg leading-none flex-shrink-0">${icon('send')}</span>
      <span class="text-sm text-navy min-w-0"><strong>${esc(inv.ownerName || 'Someone')}</strong> invited you to <strong>${esc(inv.projectTitle)}</strong></span>
    </button>`));

  data.assignedTasks.forEach(t => rows.push(`
    <button onclick="closeNotifications(); openTaskDetail('${t.id}');" class="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3">
      <span class="text-lg leading-none flex-shrink-0">${icon('done')}</span>
      <span class="text-sm text-navy min-w-0">You were assigned <strong>${esc(t.title)}</strong> in ${esc(t.projectIcon || '')} ${esc(t.projectTitle)}</span>
    </button>`));

  data.chatActivity.forEach(c => rows.push(`
    <button onclick="closeNotifications(); showPage('project-detail','${c.projectId}'); openProjectChat('${c.projectId}');" class="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3">
      <span class="text-lg leading-none flex-shrink-0">${icon('chat')}</span>
      <span class="text-sm text-navy min-w-0">${c.count} new message${c.count === 1 ? '' : 's'} in ${esc(c.projectIcon || '')} <strong>${esc(c.projectTitle)}</strong> chat</span>
    </button>`));

  data.commentActivity.forEach(c => rows.push(`
    <button onclick="closeNotifications(); showPage('project-detail','${c.projectId}'); openTaskDetail('${c.taskId}');" class="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3">
      <span class="text-lg leading-none flex-shrink-0">${icon('message-square')}</span>
      <span class="text-sm text-navy min-w-0">${c.count} new comment${c.count === 1 ? '' : 's'} on <strong>${esc(c.taskTitle)}</strong></span>
    </button>`));

  wrap.innerHTML = rows.length ? rows.join('') : `<p class="text-sm text-gray-400 text-center py-8">You're all caught up ${icon('party')}</p>`;
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('notif-dropdown');
  const btn = document.getElementById('notif-bell-btn');
  if (dropdown && !dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !btn.contains(e.target)) {
    closeNotifications();
  }
});

function openInvitesModal() {
  openModal('modal-invites');
  renderInvitesModal();
}

async function renderInvitesModal() {
  const wrap = document.getElementById('invites-list');
  try {
    const invites = await API.getPendingInvites();
    wrap.innerHTML = invites.length
      ? invites.map(inv => `
          <div class="flex items-center gap-3 border border-gray-200 rounded-lg p-3">
            <span class="text-xl flex-shrink-0">${esc(inv.projectIcon || '📁')}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy truncate">${esc(inv.projectTitle)}</p>
              <p class="text-xs text-gray-400 truncate">Invited by ${esc(inv.ownerName)}</p>
            </div>
            <button onclick="respondToInvite('${inv.id}', true)" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0">Accept</button>
            <button onclick="respondToInvite('${inv.id}', false)" class="bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0">Decline</button>
          </div>`).join('')
      : `<p class="text-center text-gray-400 text-sm py-6">No pending invitations</p>`;
  } catch (e) { console.error('Invites modal error:', e); }
}

async function respondToInvite(inviteId, accept) {
  try {
    if (accept) { await API.acceptInvite(inviteId); showToast('✅ Joined the project'); }
    else { await API.declineInvite(inviteId); showToast('Invitation declined'); }
    renderInvitesModal();
    checkPendingInvites();
    updateSidebar();
    if (APP.currentPage === 'dashboard') renderDashboard();
    if (APP.currentPage === 'projects') renderProjects();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to respond'), 'error'); }
}

// Proactive nudge: a dismissible banner on open if anything's overdue or due
// today. There's no email/push service configured (would need a paid
// provider), so "proactive" here means "surfaced the moment you open the
// app" rather than delivered to you outside it. Shows at most once per
// calendar day per browser (tracked in localStorage) so it doesn't nag on
// every page load.
// Local (not UTC) YYYY-MM-DD — endDate is stored as a plain date string, and
// new Date('2026-09-15') parses as UTC midnight, which is a different
// instant from local midnight in any non-UTC timezone. Comparing everything
// as local date strings instead of Date objects sidesteps that entirely.
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function checkDailyDigest() {
  try {
    const todayKey = localDateKey(new Date());
    let dismissedDay = null;
    try { dismissedDay = localStorage.getItem('digestDismissedDate'); } catch { /* private mode etc */ }
    if (dismissedDay === todayKey) return;

    const tasks = await API.getTasks();
    let overdueCount = 0, dueTodayCount = 0;
    tasks.forEach(t => {
      if (t.status === 'Completed' || !t.endDate) return;
      const dueKey = t.endDate.slice(0, 10);
      if (dueKey < todayKey) overdueCount++;
      else if (dueKey === todayKey) dueTodayCount++;
    });
    if (!overdueCount && !dueTodayCount) return;

    const parts = [];
    if (overdueCount) parts.push(`<strong>${overdueCount}</strong> task${overdueCount === 1 ? '' : 's'} overdue`);
    if (dueTodayCount) parts.push(`<strong>${dueTodayCount}</strong> due today`);
    document.getElementById('digest-banner-text').innerHTML =
      `${parts.join(' · ')}. <button onclick="showPage('actions')" class="underline font-semibold hover:no-underline">View in Actions →</button>`;
    document.getElementById('digest-banner').classList.remove('hidden');
  } catch (e) { console.error('Digest error:', e); }
}

function dismissDigestBanner() {
  document.getElementById('digest-banner').classList.add('hidden');
  try { localStorage.setItem('digestDismissedDate', localDateKey(new Date())); } catch { /* private mode etc */ }
}

async function logout() {
  await API.logout();
  window.location.reload();
}

async function submitChangePassword() {
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword     = document.getElementById('pw-new').value;
  if (newPassword.length < 8) return showToast('New password must be at least 8 characters', 'error');
  try {
    await API.changePassword(currentPassword, newPassword);
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value      = '';
    showToast('✅ Password changed');
  } catch (e) { showToast('❌ ' + e.message, 'error'); }
}

function deleteAccountConfirm() {
  const password = document.getElementById('delete-account-password').value;
  if (!password) { showToast('Enter your password to confirm', 'error'); return; }
  confirmAction(
    'Permanently delete your account and everything in it? This cannot be undone.',
    async () => {
      try {
        await API.deleteAccount(password);
        window.location.reload();
      } catch (e) { showToast('❌ ' + (e.message || 'Failed to delete account'), 'error'); }
    }
  );
}

// ── ONBOARDING WIZARD ──────────────────────────────────────────
async function checkOnboarding() {
  const profile = await API.getProfile();
  if (!profile.onboarded) {
    startOnboarding();
    return true;
  }
  return false;
}

function startOnboarding() {
  APP.onboardingStep = 1;
  document.getElementById('onb-name').value     = '';
  document.getElementById('onb-tagline').value  = '';
  document.getElementById('onb-proj-title').value = '';
  document.getElementById('onb-proj-icon').value  = '📁';
  document.getElementById('onb-proj-color').value = '#0A7E8C';
  document.getElementById('onboarding-overlay').classList.add('open');
  renderOnboardingStep();
}

function renderOnboardingStep() {
  for (let i = 1; i <= ONBOARDING_STEPS; i++) {
    document.getElementById('onb-step-' + i).classList.toggle('active', i === APP.onboardingStep);
    const dot = document.getElementById('onb-dot-' + i);
    dot.classList.toggle('active', i === APP.onboardingStep);
    dot.classList.toggle('done', i < APP.onboardingStep);
  }
  document.getElementById('onb-back-btn').style.visibility = APP.onboardingStep === 1 ? 'hidden' : 'visible';
  document.getElementById('onb-next-btn').textContent = APP.onboardingStep === ONBOARDING_STEPS ? 'Finish' : 'Next';

  if (APP.onboardingStep === 3) renderOnboardingDriveStatus();
}

function onboardingBack() {
  if (APP.onboardingStep === 1) return;
  APP.onboardingStep--;
  renderOnboardingStep();
}

async function onboardingNext() {
  if (APP.onboardingStep < ONBOARDING_STEPS) {
    APP.onboardingStep++;
    renderOnboardingStep();
  } else {
    await finishOnboarding();
  }
}

async function skipOnboarding() {
  await API.updateProfile({ onboarded: true });
  await closeOnboarding();
  showToast('👋 Setup skipped — you can change anything in Settings');
}

async function finishOnboarding() {
  try {
    await API.updateProfile({
      name:      document.getElementById('onb-name').value.trim(),
      tagline:   document.getElementById('onb-tagline').value.trim() || 'Every Goal, One Path',
      onboarded: true,
    });

    const projTitle = document.getElementById('onb-proj-title').value.trim();
    if (projTitle) {
      await API.addProject({
        title:       projTitle,
        description: '',
        icon:        document.getElementById('onb-proj-icon').value.trim() || '📁',
        color:       document.getElementById('onb-proj-color').value,
      });
    }

    await closeOnboarding();
    showToast('✅ All set up — welcome to Waypoint!');
  } catch (e) {
    showToast('❌ Something went wrong finishing setup', 'error');
  }
}

async function closeOnboarding() {
  document.getElementById('onboarding-overlay').classList.remove('open');
  await showPage('dashboard');
}

async function rerunOnboarding() {
  await API.updateProfile({ onboarded: false });
  startOnboarding();
}

// ── GOOGLE DRIVE ────────────────────────────────────────────────
async function connectDrive() {
  window.location.href = API.connectDriveUrl();
}

async function renderOnboardingDriveStatus() {
  try {
    const status = await API.getDriveStatus();
    const textEl = document.getElementById('onb-drive-text');
    const btnEl  = document.getElementById('onb-drive-connect-btn');
    if (!status.configured) {
      textEl.textContent = 'Google Drive backup isn’t configured on this server yet. You can set it up later in Settings.';
      btnEl.style.display = 'none';
    } else if (status.connected) {
      textEl.textContent = 'Connected — your data can now be backed up to Drive any time.';
      btnEl.style.display = 'none';
    } else {
      textEl.textContent = 'Not connected yet.';
      btnEl.style.display = 'inline-block';
    }
  } catch (e) { console.error('Drive status error:', e); }
}

async function renderSettingsDrive() {
  try {
    const status = await API.getDriveStatus();
    const textEl    = document.getElementById('settings-drive-text');
    const subEl     = document.getElementById('settings-drive-sub');
    const actionsEl = document.getElementById('settings-drive-actions');
    const formatsEl = document.getElementById('settings-drive-formats');

    if (!status.configured) {
      textEl.textContent = 'Google Drive backup isn\'t available yet.';
      subEl.textContent  = 'You can still download everything any time from Data and Trash.';
      actionsEl.innerHTML = '';
      formatsEl.classList.add('hidden');
      return;
    }

    if (status.connected) {
      textEl.textContent = 'Connected to Google Drive';
      subEl.textContent  = status.lastBackupAt
        ? `Last backup: ${new Date(status.lastBackupAt).toLocaleString()}`
        : 'No backups yet — click "Backup Now" to create your first one.';
      actionsEl.innerHTML = `
        <button onclick="backupAs('json')" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-4 py-2 rounded-lg">${icon('cloud')} Backup Now (JSON)</button>
        <button onclick="disconnectDriveConfirm()" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-semibold px-4 py-2 rounded-lg">Disconnect</button>`;
      formatsEl.classList.remove('hidden');
    } else {
      textEl.textContent = 'Not connected';
      subEl.textContent  = 'Connect your Google Drive to save backups of your data with one click.';
      actionsEl.innerHTML = `
        <button onclick="connectDrive()" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-4 py-2 rounded-lg">Connect Google Drive</button>`;
      formatsEl.classList.add('hidden');
    }
  } catch (e) { console.error('Settings Drive error:', e); }
}

// OneDrive (Microsoft): the same card, its own row.
async function renderSettingsOneDrive() {
  const textEl = document.getElementById('onedrive-text');
  if (!textEl) return;
  const subEl = document.getElementById('onedrive-sub');
  const actionsEl = document.getElementById('onedrive-actions');
  try {
    const s = await API.getOneDriveStatus();
    if (!s.configured) {
      textEl.textContent = 'OneDrive backup isn\'t available yet.';
      subEl.textContent = 'You can still download everything any time from Data and Trash.';
      actionsEl.innerHTML = '';
      return;
    }
    if (s.connected) {
      textEl.textContent = `Connected${s.account ? ' as ' + s.account : ''}`;
      subEl.textContent = (s.lastBackupAt ? `Last backup: ${new Date(s.lastBackupAt).toLocaleString()}. ` : '') + 'Saved to OneDrive → Apps → Waypoint.';
      actionsEl.innerHTML = `
        <button onclick="backupToOneDrive('json')" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-4 py-2 rounded-lg">${icon('cloud')} Back up now</button>
        <button onclick="backupToOneDrive('excel')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-4 py-2 rounded-lg">${icon('book')} Excel (.xlsx)</button>
        <button onclick="backupToOneDrive('pdf')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-4 py-2 rounded-lg">${icon('file')} PDF report</button>
        <button onclick="disconnectOneDriveConfirm()" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-semibold px-4 py-2 rounded-lg">Disconnect</button>`;
    } else {
      textEl.textContent = 'Not connected';
      subEl.textContent = 'Back up to your Microsoft OneDrive (personal, work or school). Waypoint only gets its own app folder, never your other files.';
      actionsEl.innerHTML = '<button onclick="window.location.href=\'/api/onedrive/connect\'" class="bg-teal hover:bg-teal/90 text-white text-xs font-semibold px-4 py-2 rounded-lg">Connect OneDrive</button>';
    }
  } catch (e) { console.error('OneDrive status error:', e); }
}
async function backupToOneDrive(format) {
  API.trackFeature('backup');
  showToast('☁️ Saving to OneDrive…');
  try {
    const r = await API.backupToOneDrive(format);
    showToast(`✅ Saved ${r.name} to OneDrive`);
    renderSettingsOneDrive();
  } catch (e) { showToast('❌ ' + (e.message || 'OneDrive backup failed'), 'error'); }
}
function disconnectOneDriveConfirm() {
  confirmAction('Disconnect OneDrive? Backups already saved stay in your OneDrive.', async () => {
    await API.disconnectOneDrive();
    showToast('OneDrive disconnected');
    renderSettingsOneDrive();
  });
}

const BACKUP_FNS = {
  json:   API => API.backupToDrive,
  sheets: API => API.backupToSheets,
  excel:  API => API.backupToExcel,
  pdf:    API => API.backupToPdf,
  image:  API => API.backupToImage,
};
const BACKUP_LABELS = { json: 'JSON backup', sheets: 'Google Sheet', excel: 'Excel workbook', pdf: 'PDF report', image: 'Image report' };

async function backupAs(format) {
  API.trackFeature('backup');
  showToast(`⏳ Creating ${BACKUP_LABELS[format]}…`);
  try {
    const result = await BACKUP_FNS[format](API)();
    showToast(`✅ ${BACKUP_LABELS[format]} saved to Drive`);
    if (result.link) window.open(result.link, '_blank');
    renderSettingsDrive();
    renderSettingsOneDrive();
  } catch (e) { showToast(`❌ ${BACKUP_LABELS[format]} failed — ${e.message}`, 'error'); }
}

function disconnectDriveConfirm() {
  confirmAction('Disconnect Google Drive? You can reconnect any time.', async () => {
    await API.disconnectDrive();
    showToast('🔌 Google Drive disconnected');
    renderSettingsDrive();
    renderSettingsOneDrive();
  });
}

function handleDriveRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('drive') && !params.has('onedrive')) return;
  if (params.get('onedrive') === 'connected') showToast('✅ OneDrive connected');
  if (params.get('onedrive') === 'error') showToast('❌ OneDrive connection failed', 'error');
  // Back from Microsoft: Settings opens on Connected apps next time.
  if (params.has('onedrive')) { APP.settingsTab = 'apps'; window.history.replaceState({}, '', window.location.pathname); return; }
  if (params.get('drive') === 'connected') showToast('✅ Google Drive connected');
  if (params.get('drive') === 'error')     showToast('❌ Google Drive connection failed', 'error');
  window.history.replaceState({}, '', window.location.pathname);
}

function handleAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('auth')) return;
  if (params.get('auth') === 'error') showToast('❌ Sign-in didn\'t work. Please try again.', 'error');
  if (params.get('auth') === 'unverified') showToast('Your organisation hasn\'t verified this email with Microsoft, so it can\'t be used to sign in. Sign up with email and password instead.', 'error');
  window.history.replaceState({}, '', window.location.pathname);
}

// Left in the URL (not cleared) until the reset form is actually submitted,
// so a page reload while the reset view is open doesn't lose the token.
// A project invite email links to /app?join=<email>: open sign-up with that
// email filled in, so the invite is waiting the moment they're in.
function handleJoinRedirect() {
  const email = new URLSearchParams(window.location.search).get('join');
  if (!email) return;
  showAuthView('register');
  const input = document.getElementById('auth-register-email');
  if (input) input.value = email;
}
function handleResetTokenRedirect() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('resetToken');
  if (!token) return false;
  pendingResetToken = token;
  showAuthView('reset');
  return true;
}
