// StartLine app, part 12 of 12: Export and import, start-up, version notice, shortcuts, progress reports.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── EXPORT / IMPORT ─────────────────────────────────────────────
async function exportData() {
  API.trackFeature('backup');
  try {
    const [profile, projects, tasks, why] = await Promise.all([
      API.getProfile(), API.getProjects(), API.getTasks(), API.getMotivation().catch(() => null),
    ]);
    const blob = new Blob(
      [JSON.stringify({ profile, projects, tasks, motivation: why && why.motivation }, null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'startline_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    showToast('✅ Data exported!');
  } catch (e) { showToast('❌ Export failed', 'error'); }
}

// Same idea as exportData(), but scoped to one project's own tree (itself,
// its sub-folders, and their tasks) rather than the whole account.
async function exportProjectData(projectId) {
  closeProjectDetailMenu();
  try {
    const res = await fetch(API.exportProjectUrl(projectId));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
    const snapshot = await res.json();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = snapshot.projects[0].title.replace(/[^\w\- ]+/g, '').trim() + '.json';
    a.click();
    showToast('✅ Project exported!');
  } catch (e) { showToast('❌ ' + (e.message || 'Export failed'), 'error'); }
}

// Saves one project's tree to Google Drive as a single JSON file that gets
// overwritten on every save (not a new dated copy each time) — the backup
// folder is created automatically the first time, same as the
// whole-account Drive backup in Settings.
async function saveProjectToDrive(projectId) {
  closeProjectDetailMenu();
  try {
    const status = await API.getDriveStatus();
    if (!status.connected) {
      showToast('☁️ Connect Google Drive in Settings first', 'error');
      return;
    }
    showToast('☁️ Saving to Drive…');
    await API.backupProjectToDrive(projectId);
    showToast('✅ Saved to Google Drive');
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to save to Drive'), 'error'); }
}

function importData() {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      let data;
      try { data = JSON.parse(ev.target.result); }
      catch { showToast('❌ Invalid file', 'error'); return; }

      const projCount = (data.projects || []).length;
      const taskCount = (data.tasks || []).length;
      confirmAction(
        `Import ${projCount} project${projCount === 1 ? '' : 's'} and ${taskCount} task${taskCount === 1 ? '' : 's'} from this file? This adds to what's already here — it won't replace or remove anything.`,
        () => runImportData(data)
      );
    };
    reader.readAsText(file);
  };
  input.click();
}

async function runImportData(data) {
  try {
    const result = await API.importData(data);
    showToast(`✅ Imported ${result.projects} project${result.projects === 1 ? '' : 's'}, ${result.tasks} task${result.tasks === 1 ? '' : 's'}`);
    if (APP.currentProjectId) renderProjectDetail(APP.currentProjectId);
    else await showPage(APP.currentPage);
    updateSidebar();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Import failed'), 'error');
  }
}

// ── INIT ─────────────────────────────────────────────────────────
async function init() {
  document.getElementById('topbar-date').textContent =
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  applyThemeIcon();
  handleDriveRedirect();
  handleAuthRedirect();
  if (handleResetTokenRedirect()) return;
  await handleVerifyTokenRedirect();
  if (window.Race) await Race.handleLink();
  const authed = await checkAuth();
  if (authed) await afterAuth();
  else if (new URLSearchParams(location.search).has('twofactor')) showAuthView('2fa'); // Google sign-in waiting on a code
  else handleJoinRedirect();
}

document.addEventListener('DOMContentLoaded', init);

// ── NEW VERSION NOTICE ──────────────────────────────────────────
// A tab left open keeps running the code it loaded, so after a deploy it
// would quietly show the old behaviour. Every few minutes (and whenever
// the tab comes back into view) it asks the server which build is live;
// if that's changed, a small notice offers a one-click reload.
let loadedVersion = null;
async function checkForNewVersion() {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!loadedVersion) { loadedVersion = version; return; }
    if (version !== loadedVersion) showNewVersionNotice();
  } catch { /* offline: try again later */ }
}
function showNewVersionNotice() {
  if (document.getElementById('new-version-notice')) return;
  const bar = document.createElement('div');
  bar.id = 'new-version-notice';
  bar.setAttribute('role', 'status');
  bar.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 bg-navy text-white text-sm font-semibold pl-4 pr-2 py-2 rounded-xl shadow-2xl';
  bar.innerHTML = '<span id="new-version-text">A new version of StartLine is ready.</span><button class="bg-teal hover:bg-teal/90 text-white text-xs font-bold px-3 py-1.5 rounded-lg" onclick="location.reload()">Reload</button><button class="text-white/60 hover:text-white text-lg leading-none px-1" aria-label="Dismiss" onclick="this.parentElement.remove()">×</button>';
  document.body.appendChild(bar);
  // Say what's new, from the same log the landing page shows
  // (frontend/data/product.json).
  fetch('/data/product.json', { cache: 'no-store' }).then(r => r.json()).then(p => {
    const latest = p && p.whatsNew && p.whatsNew[0];
    const text = document.getElementById('new-version-text');
    if (latest && text) text.textContent = `New in StartLine: ${latest.title}.`;
  }).catch(() => { /* the plain message stays */ });
}
checkForNewVersion();
setInterval(checkForNewVersion, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForNewVersion(); });
// ── KEYBOARD SHORTCUTS ─────────────────────────────────────────
// "/" jumps to search, "n" adds a task (to the open project, if any), "a"
// opens the assistant and "?" lists these. Ignored while typing, with a
// modifier held, or while a dialog is open.
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  const el = e.target;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  if (document.querySelector('.modal-overlay.open, .onboarding-overlay.open, .auth-overlay.open, .recap-overlay') || (document.getElementById('palette') && !document.getElementById('palette').classList.contains('hidden'))) return;
  const projectId = APP.currentPage === 'project-detail' ? APP.currentProjectId : undefined;
  if (e.key === '/') {
    const search = document.getElementById('global-search-input');
    if (search && search.offsetParent) { e.preventDefault(); search.focus(); }
  } else if (e.key === 'n') {
    e.preventDefault(); openAddTask(projectId);
  } else if (e.key === 'a') {
    e.preventDefault(); openAssistant(projectId);
  } else if (e.key === '?') {
    showToast('Shortcuts: ⌘K command palette · / search · n new task · a assistant · j talk · m pause music · Esc close');
  }
});

// ── PROGRESS REPORT ────────────────────────────────────────────
// A shareable report on one project or goal (backend/reports/progress.js):
// previewed here, downloadable as a PDF, printable, and shareable as a
// live read-only link that its owner or an editor can turn off again.
let reportProjectId = null;
let reportShareUrl = null;
async function openProgressReport(projectId) {
  API.trackFeature('report');
  if (!projectId) return;
  reportProjectId = projectId;
  document.getElementById('report-heading').textContent = 'Progress report';
  if (window.Reports) Reports.setReportMode('project');
  document.getElementById('report-frame').src = `/api/reports/projects/${projectId}/progress.html?t=${Date.now()}`;
  document.getElementById('report-pdf').href = `/api/reports/projects/${projectId}/progress.pdf`;
  openModal('modal-report');
  reportShareUrl = null;
  showReportShareBar(null, false);
  try {
    const share = await API.getReportShare(projectId);
    reportShareUrl = share.url;
    document.getElementById('report-share-btn').classList.toggle('hidden', !share.canManage && !share.url);
    showReportShareBar(share.url, share.canManage);
  } catch { /* preview, PDF and print still work */ }
}
function showReportShareBar(url, canManage) {
  document.getElementById('report-share-bar').classList.toggle('hidden', !url);
  document.getElementById('report-share-url').value = url || '';
  document.getElementById('report-stop-btn').classList.toggle('hidden', !canManage);
}
async function ensureReportShareUrl() {
  if (reportShareUrl) return reportShareUrl;
  const { url } = await API.createReportShare(reportProjectId);
  reportShareUrl = url;
  showReportShareBar(url, true);
  return url;
}
async function shareProgressReport() {
  let url;
  try { url = await ensureReportShareUrl(); } catch (e) { showToast('❌ ' + (e.message || 'Could not share the report'), 'error'); return; }
  const title = document.getElementById('report-frame').contentDocument?.title || 'Progress report';
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  copyProgressReportLink();
}
async function copyProgressReportLink() {
  const url = reportShareUrl || document.getElementById('report-share-url').value;
  if (!url) return;
  try { await navigator.clipboard.writeText(url); showToast('📋 Report link copied'); }
  catch { document.getElementById('report-share-url').select(); showToast('Select the link and copy it'); }
}
function stopSharingProgressReport() {
  confirmAction('Stop sharing this report? Anyone with the link will no longer be able to open it.', async () => {
    try { await API.deleteReportShare(reportProjectId); reportShareUrl = null; showReportShareBar(null, true); showToast('🔒 The report link is turned off'); }
    catch (e) { showToast('❌ ' + (e.message || 'Could not stop sharing'), 'error'); }
  });
}
function printProgressReport() {
  const frame = document.getElementById('report-frame');
  try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(frame.src, '_blank'); }
}
async function emailProgressReport() {
  let url;
  try { url = await ensureReportShareUrl(); } catch { url = ''; }
  const doc = document.getElementById('report-frame').contentDocument;
  const title = doc?.title || 'Progress report';
  const summary = doc?.querySelector('.summary')?.textContent || '';
  const body = `${summary}\n\n${url ? `See the live report: ${url}` : ''}`;
  window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
// On a phone the header search box is narrow: a short placeholder
// rather than one cut off mid-word.
{
  const search = document.getElementById('global-search-input');
  const phone = window.matchMedia('(max-width: 639px)');
  const fit = () => { if (search) search.placeholder = phone.matches ? 'Search…' : 'Search projects & tasks…'; };
  fit();
  phone.addEventListener('change', fit);
}
