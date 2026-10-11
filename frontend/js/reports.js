/* global API, APP, esc, showToast, openModal, closeModal, confirmAction, openProgressReport, reportProjectId */
// ── REPORTS: portfolio and photos ───────────────────────────────
// Two additions to the progress report (12-init.js):
// • a portfolio report across all projects, or the ones you pick, for a
//   board or team meeting (backend/reports/portfolio.js);
// • photos and files pinned to a project's report, each with a caption,
//   what it shows (progress, a blocker, general info) and optionally the
//   task it's about. They appear in the report, its PDF and share link.
const Reports = (() => {
  let mediaProjectId = null;
  let pickedAttachment = null; // an existing project file chosen instead of a new upload
  const isImage = m => /^image\//.test(m.mimetype || '');
  const KIND = { progress: 'Progress', blocker: 'Blocker', info: 'Info' };

  // ── Portfolio ──
  async function openPortfolioPicker() {
    const list = document.getElementById('portfolio-projects');
    list.innerHTML = '<p class="text-sm text-gray-400">Loading projects…</p>';
    openModal('modal-portfolio');
    try {
      const projects = (await API.getProjects()).filter(p => !p.parentId);
      list.innerHTML = projects.length ? projects.map(p => `
        <label class="flex items-center gap-3 py-2 border-b border-gray-100 cursor-pointer">
          <input type="checkbox" class="w-4 h-4 accent-teal" value="${p.id}" checked>
          <span class="text-lg" aria-hidden="true">${emojiIcon(p.icon || '📁')}</span>
          <span class="flex-1 min-w-0 text-sm font-semibold text-navy truncate">${esc(p.title)}</span>
          ${p.role && p.role !== 'owner' ? '<span class="text-[11px] font-bold text-gray-400">Shared</span>' : ''}
        </label>`).join('') : '<p class="text-sm text-gray-500">No projects yet.</p>';
    } catch (e) { list.innerHTML = `<p class="text-sm text-red-500">${esc(e.message || 'Could not load projects')}</p>`; }
  }
  function pickAll(on) { document.querySelectorAll('#portfolio-projects input[type=checkbox]').forEach(c => { c.checked = on; }); }
  function buildPortfolio() {
    const boxes = [...document.querySelectorAll('#portfolio-projects input[type=checkbox]')];
    const ids = boxes.filter(c => c.checked).map(c => c.value);
    if (!ids.length) { showToast('Pick at least one project'); return; }
    const all = ids.length === boxes.length;
    const title = document.getElementById('portfolio-title').value.trim();
    const q = new URLSearchParams();
    if (!all) q.set('ids', ids.join(','));
    if (title) q.set('title', title);
    closeModal('modal-portfolio');
    document.getElementById('report-heading').textContent = 'Portfolio report';
    document.getElementById('report-frame').src = `/api/reports/portfolio.html?${q}&t=${Date.now()}`;
    document.getElementById('report-pdf').href = `/api/reports/portfolio.pdf?${q}`;
    setReportMode('portfolio');
    openModal('modal-report');
  }
  // Share links and photos belong to a single project's report.
  function setReportMode(mode) {
    ['report-share-btn', 'report-media-btn', 'report-email-btn'].forEach(id => document.getElementById(id).classList.toggle('hidden', mode === 'portfolio'));
    if (mode === 'portfolio') document.getElementById('report-share-bar').classList.add('hidden');
  }

  // ── Photos and files ──
  async function openMedia(projectId, preset = {}) {
    mediaProjectId = projectId || reportProjectId;
    if (!mediaProjectId) return;
    pickedAttachment = null;
    document.getElementById('media-file').value = '';
    document.getElementById('media-chosen').textContent = '';
    document.getElementById('media-caption').value = preset.caption || '';
    setKind(preset.kind || 'progress');
    openModal('modal-report-media');
    await Promise.all([renderPinned(), renderExisting(), fillTaskPicker(preset.taskId || '')]);
  }
  function setKind(kind) {
    document.querySelectorAll('#media-kind button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === kind)));
    document.getElementById('media-kind').dataset.value = kind;
  }
  async function fillTaskPicker(selected) {
    const sel = document.getElementById('media-task');
    try {
      const [projects, tasks] = await Promise.all([API.getProjects(), API.getTasks()]);
      const tree = new Set(projects.filter(p => p.id === mediaProjectId || p.parentId === mediaProjectId).map(p => p.id));
      const mine = tasks.filter(t => tree.has(t.projectId));
      sel.innerHTML = '<option value="">Not about one task</option>' + mine.map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.title)}</option>`).join('');
    } catch { sel.innerHTML = '<option value="">Not about one task</option>'; }
  }
  async function renderPinned() {
    const box = document.getElementById('media-pinned');
    try {
      const items = await API.getReportMedia(mediaProjectId);
      box.innerHTML = items.length ? items.map(m => `
        <div class="media-item">
          ${isImage(m) ? `<img src="${API.attachmentUrl(m.attachmentId)}" alt="" loading="lazy">` : '<span class="media-file-icon" aria-hidden="true">' + icon('paperclip') + '</span>'}
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-navy truncate">${esc(m.caption || m.originalName)}</p>
            <p class="text-xs text-gray-500 truncate"><span class="media-kind k-${m.kind}">${KIND[m.kind] || 'Info'}</span>${m.taskTitle ? ' ' + esc(m.taskTitle) : ''}</p>
          </div>
          <button type="button" onclick="Reports.removeMedia('${m.id}')" class="text-xs font-semibold text-gray-400 hover:text-red-600 px-2" aria-label="Remove from report">Remove</button>
        </div>`).join('') : '<p class="text-sm text-gray-400">Nothing added yet. Photos of progress or of what’s in the way make a report far easier to follow.</p>';
    } catch (e) { box.innerHTML = `<p class="text-sm text-red-500">${esc(e.message || 'Could not load')}</p>`; }
  }
  async function renderExisting() {
    const box = document.getElementById('media-existing');
    try {
      const files = await API.getProjectAttachments(mediaProjectId);
      box.innerHTML = files.length ? files.slice(0, 24).map(f => `
        <button type="button" class="media-pick" onclick="Reports.pickExisting('${f.id}', this)" title="${esc(f.originalName)}" data-name="${esc(f.originalName)}">
          ${isImage(f) ? `<img src="${API.attachmentUrl(f.id)}" alt="${esc(f.originalName)}" loading="lazy">` : `<span>${icon('paperclip')}<small>${esc(f.originalName)}</small></span>`}
        </button>`).join('') : '<p class="text-xs text-gray-400" style="grid-column:1/-1">No files shared in this project yet.</p>';
    } catch { box.innerHTML = ''; }
  }
  function pickExisting(id, btn) {
    pickedAttachment = id;
    document.getElementById('media-file').value = '';
    document.querySelectorAll('.media-pick').forEach(b => b.classList.toggle('is-picked', b === btn));
    document.getElementById('media-chosen').textContent = `Chosen: ${btn.dataset.name}`;
  }
  function onFileChosen(input) {
    if (!input.files[0]) return;
    pickedAttachment = null;
    document.querySelectorAll('.media-pick').forEach(b => b.classList.remove('is-picked'));
    document.getElementById('media-chosen').textContent = `Chosen: ${input.files[0].name}`;
  }
  async function addMedia() {
    const btn = document.getElementById('media-add-btn');
    const file = document.getElementById('media-file').files[0];
    if (!file && !pickedAttachment) { showToast('Choose a photo or file first'); return; }
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      let attachmentId = pickedAttachment;
      if (file) attachmentId = (await API.uploadAttachment(mediaProjectId, file)).id;
      await API.addReportMedia(mediaProjectId, {
        attachmentId,
        caption: document.getElementById('media-caption').value,
        kind: document.getElementById('media-kind').dataset.value,
        taskId: document.getElementById('media-task').value || null,
      });
      showToast('📎 Added to the report');
      document.getElementById('media-file').value = '';
      document.getElementById('media-caption').value = '';
      document.getElementById('media-chosen').textContent = '';
      pickedAttachment = null;
      await Promise.all([renderPinned(), renderExisting()]);
      refreshReportFrame();
    } catch (e) { showToast('❌ ' + (e.message || 'Could not add it'), 'error'); }
    btn.disabled = false; btn.textContent = 'Add to report';
  }
  function removeMedia(id) {
    confirmAction('Take this out of the report? The file stays in the project.', async () => {
      try { await API.removeReportMedia(id); } catch (e) { showToast('❌ ' + (e.message || 'Could not remove it'), 'error'); return; }
      renderPinned();
      refreshReportFrame();
    });
  }
  function refreshReportFrame() {
    const frame = document.getElementById('report-frame');
    if (document.getElementById('modal-report').classList.contains('open') && frame.src) frame.src = frame.src.replace(/([?&])t=\d+/, `$1t=${Date.now()}`);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#media-kind button[data-value]');
    if (b) setKind(b.dataset.value);
  });

  return { openPortfolioPicker, pickAll, buildPortfolio, setReportMode, openMedia, pickExisting, onFileChosen, addMedia, removeMedia };
})();
window.Reports = Reports;
