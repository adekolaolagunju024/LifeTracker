// Waypoint app, part 10 of 12: Two-step sign-in, calendar feed, templates and project forms.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── TWO-STEP SIGN-IN (Settings → Account & Security) ──
let twoFactorCodes = [];
async function loadTwoFactorStatus() {
  try {
    const st = await API.get2faStatus();
    document.getElementById('twofa-enable-btn').classList.toggle('hidden', st.enabled);
    document.getElementById('twofa-disable-btn').classList.toggle('hidden', !st.enabled);
    document.getElementById('twofa-codes-btn').classList.toggle('hidden', !st.enabled);
    document.getElementById('twofa-status-text').textContent = st.enabled
      ? `On since ${formatDateShort(st.enabledAt.slice(0, 10))}. ${st.recoveryCodesLeft} recovery code${st.recoveryCodesLeft === 1 ? '' : 's'} left.`
      : 'Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password) as well as your password.';
  } catch { /* leave the card as it is */ }
}
async function startTwoFactorSetup() {
  try {
    const { secret, qrSvg } = await API.setup2fa();
    document.getElementById('twofa-qr').innerHTML = qrSvg; // SVG made by our own server from the secret
    document.getElementById('twofa-secret').textContent = secret.replace(/(.{4})/g, '$1 ').trim();
    document.getElementById('twofa-code').value = '';
    document.getElementById('twofa-error').classList.add('hidden');
    document.getElementById('twofa-step-scan').classList.remove('hidden');
    document.getElementById('twofa-step-codes').classList.add('hidden');
    openModal('modal-2fa');
    setTimeout(() => document.getElementById('twofa-code').focus(), 100);
  } catch (e) { showToast('❌ ' + (e.message || 'Could not start set-up'), 'error'); }
}
function showRecoveryCodes(codes) {
  twoFactorCodes = codes;
  document.getElementById('twofa-codes').innerHTML = codes.map(c => `<span>${esc(c)}</span>`).join('');
  document.getElementById('twofa-step-scan').classList.add('hidden');
  document.getElementById('twofa-step-codes').classList.remove('hidden');
  openModal('modal-2fa');
}
async function confirmTwoFactorSetup() {
  const err = document.getElementById('twofa-error');
  try {
    const { recoveryCodes } = await API.enable2fa(document.getElementById('twofa-code').value.trim());
    showRecoveryCodes(recoveryCodes);
    loadTwoFactorStatus();
  } catch (e) { err.textContent = e.message || 'That code did not work'; err.classList.remove('hidden'); }
}
function copyRecoveryCodes() {
  navigator.clipboard.writeText(twoFactorCodes.join('\n')).then(() => showToast('📋 Recovery codes copied'), () => showToast('Select the codes and copy them'));
}
function downloadRecoveryCodes() {
  const blob = new Blob([`Waypoint recovery codes (each works once)\n\n${twoFactorCodes.join('\n')}\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'waypoint-recovery-codes.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function disableTwoFactor() {
  const password = prompt('To turn off two-step sign-in, enter your password:');
  if (!password) return;
  const code = prompt('And a code from your authenticator app (or a recovery code):');
  if (!code) return;
  try { await API.disable2fa(password, code.trim()); showToast('Two-step sign-in is off'); loadTwoFactorStatus(); }
  catch (e) { showToast('❌ ' + (e.message || 'Could not turn it off'), 'error'); }
}
async function regenerateRecoveryCodes() {
  const code = prompt('Enter a code from your authenticator app to make new recovery codes (the old ones stop working):');
  if (!code) return;
  try { const { recoveryCodes } = await API.newRecoveryCodes(code.trim()); showRecoveryCodes(recoveryCodes); loadTwoFactorStatus(); }
  catch (e) { showToast('❌ ' + (e.message || 'Could not make new codes'), 'error'); }
}

// ── NEW / EDIT PROJECT WINDOW ──
// One window for a new project, a new sub-folder and editing either. A new
// project starts one of three ways: blank, from a template, or described in
// a sentence for the assistant to draft. Icon, colour and area of life are
// chip pickers over hidden inputs (the .seg[data-seg-for] pattern), so
// saveProject reads plain values.
const PROJECT_MODES = { new: ['New project', 'A home for one goal: its phases, tasks and people.', 'Create project'],
  sub: ['New sub-folder', 'Group related tasks inside this project.', 'Create sub-folder'],
  edit: ['Edit project', '', 'Save changes'], 'edit-sub': ['Edit sub-folder', '', 'Save changes'] };
let projectWindowKind = 'new';
let projectStartMode = 'blank';

function fillProjectForm(p, kind) {
  projectWindowKind = kind;
  const [title, sub, cta] = PROJECT_MODES[kind];
  document.getElementById('modal-project-title').textContent = title;
  const subEl = document.getElementById('modal-project-sub');
  subEl.textContent = sub; subEl.classList.toggle('hidden', !sub);
  document.getElementById('proj-save-btn').textContent = cta;
  document.getElementById('project-ai-btn').classList.toggle('hidden', !(kind.startsWith('edit') && (p.role === 'owner' || p.role === 'editor')));
  document.getElementById('proj-mode-wrap').classList.toggle('hidden', kind !== 'new');
  document.getElementById('proj-invite-wrap').classList.toggle('hidden', kind !== 'new');
  document.getElementById('proj-invite-wrap').open = false;
  document.getElementById('proj-type-wrap').classList.toggle('hidden', kind === 'sub' || kind === 'edit-sub');
  document.getElementById('proj-id').value     = p.id || '';
  document.getElementById('proj-parent').value = p.parentId || '';
  document.getElementById('proj-title').value  = p.title || '';
  document.getElementById('proj-desc').value   = p.description || '';
  document.getElementById('proj-icon').value   = p.icon || '📁';
  document.getElementById('proj-color').value  = p.color || '#0A7E8C';
  document.getElementById('proj-start').value  = p.startDate || '';
  document.getElementById('proj-type').value   = p.type || 'career';
  document.getElementById('proj-icon-own').value = '';
  document.getElementById('proj-look').classList.add('hidden');
  document.getElementById('proj-look-btn').setAttribute('aria-expanded', 'false');
  if (kind !== 'new') setProjectStartMode('blank');
  syncProjectLook();
}

function setProjectStartMode(mode) {
  projectStartMode = mode;
  document.querySelectorAll('#proj-mode-wrap button[data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  document.getElementById('proj-form').classList.toggle('hidden', mode !== 'blank');
  document.getElementById('proj-templates').classList.toggle('hidden', mode !== 'template');
  document.getElementById('proj-ai-pane').classList.toggle('hidden', mode !== 'ai');
  document.getElementById('proj-form').parentElement.scrollTop = 0;
  const btn = document.getElementById('proj-save-btn');
  btn.classList.toggle('hidden', mode === 'template'); // a template card creates the project itself
  btn.innerHTML = mode === 'ai' ? `${icon('sparkles')}Plan it with AI` : esc(PROJECT_MODES[projectWindowKind][2]);
  setTimeout(() => {
    const focus = mode === 'blank' ? document.getElementById('proj-title') : mode === 'ai' ? document.getElementById('proj-ai-text') : null;
    if (focus && !focus.value) focus.focus();
  }, 60);
}

// The icon tile beside the name shows the chosen icon on its colour.
function syncProjectLook() {
  const iconVal = document.getElementById('proj-icon').value || '📁';
  const color = document.getElementById('proj-color').value || '#0A7E8C';
  const tile = document.getElementById('proj-look-btn');
  document.getElementById('proj-look-icon').textContent = iconVal;
  tile.style.background = color + '22';
  tile.style.color = color;
  document.getElementById('proj-color-custom').value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#0A7E8C';
  syncSegs(document.getElementById('modal-project'));
}
function toggleProjectLook() {
  const look = document.getElementById('proj-look');
  look.classList.toggle('hidden');
  document.getElementById('proj-look-btn').setAttribute('aria-expanded', String(!look.classList.contains('hidden')));
}
function setProjectColor(value) {
  document.getElementById('proj-color').value = value;
  syncProjectLook();
}
['proj-icon', 'proj-color'].forEach(id => document.getElementById(id)?.addEventListener('change', syncProjectLook));

function useProjectExample(btn) {
  const box = document.getElementById('proj-ai-text');
  box.value = btn.textContent;
  box.focus();
}

// The footer button: create or save, or hand the sentence to the assistant.
function submitProjectModal() {
  if (projectWindowKind === 'new' && projectStartMode === 'ai') {
    const text = document.getElementById('proj-ai-text').value.trim();
    if (!text) { showToast('Describe your goal in a sentence first', 'error'); document.getElementById('proj-ai-text').focus(); return; }
    closeModal('modal-project');
    paletteAsk(`Plan a new goal for me: ${text}`);
    return;
  }
  saveProject();
}

// The template gallery (backend/templates.js): one tap creates the whole
// plan, dated from today, and opens it.
let projectTemplatesCache = null;
async function renderProjectTemplates() {
  const list = document.getElementById('proj-template-list');
  try {
    projectTemplatesCache = projectTemplatesCache || await API.getProjectTemplates();
  } catch {
    list.innerHTML = '<p class="text-sm text-gray-500">Templates are not available right now. Start blank or describe it instead.</p>';
    return;
  }
  list.innerHTML = projectTemplatesCache.map(t => `
    <button type="button" onclick="startProjectFromTemplate('${t.id}', this)" class="proj-tpl">
      <span class="proj-tpl-ic" aria-hidden="true">${esc(t.icon)}</span>
      <span class="min-w-0">
        <span class="block text-sm font-bold text-navy">${esc(t.title)}</span>
        <span class="block text-xs text-gray-500 mt-0.5 line-clamp-2">${esc(t.description || '')}</span>
        <span class="block text-[11px] font-semibold text-teal mt-1">${t.phases} phases · ${t.tasks} tasks · ${Math.round(t.days / 7)} weeks</span>
      </span>
    </button>`).join('');
}
async function startProjectFromTemplate(templateId, btn) {
  const buttons = document.querySelectorAll('#proj-template-list button');
  buttons.forEach(b => { b.disabled = true; });
  btn.classList.add('opacity-60');
  try {
    const project = await API.createFromTemplate({ templateId, startDate: localDateKey(new Date()) });
    const invited = await inviteFromNewProject(project.id);
    closeModal('modal-project');
    await updateSidebar();
    await showPage('project-detail', project.id);
    showToast(`🎉 "${project.title}" is ready.${invited}`);
  } catch (e) {
    showToast('❌ ' + (e.message || 'Could not create the project'), 'error');
  } finally {
    buttons.forEach(b => { b.disabled = false; });
    btn.classList.remove('opacity-60');
  }
}

function openAddSubfolder(parentId) {
  fillProjectForm({ parentId }, 'sub');
  openModal('modal-project');
}

async function editProject(id) {
  const p = await API.getProject(id);
  fillProjectForm({ ...p, id }, p.parentId ? 'edit-sub' : 'edit');
  openModal('modal-project');
}

async function saveProject() {
  const id   = document.getElementById('proj-id').value;
  const data = {
    title:       document.getElementById('proj-title').value.trim(),
    description: document.getElementById('proj-desc').value.trim(),
    icon:        document.getElementById('proj-icon').value.trim() || '📁',
    color:       document.getElementById('proj-color').value,
    startDate:   document.getElementById('proj-start').value,
    parentId:    document.getElementById('proj-parent').value || null,
    type:        document.getElementById('proj-parent').value ? undefined : document.getElementById('proj-type').value,
  };
  if (!data.title) { showToast('Give it a name first', 'error'); document.getElementById('proj-title').focus(); return; }
  const btn = document.getElementById('proj-save-btn');
  btn.disabled = true;
  try {
    if (id) { await API.updateProject(id, data); showToast('✅ Project updated'); }
    else {
      const created = await API.addProject(data);
      const invited = data.parentId ? '' : await inviteFromNewProject(created.id);
      showToast((data.parentId ? '✅ Sub-folder created' : '✅ Project created') + invited);
      // A new project opens straight away, ready for its first task.
      if (!data.parentId) {
        closeModal('modal-project');
        await updateSidebar();
        await showPage('project-detail', created.id);
        return;
      }
    }
    closeModal('modal-project');
    if (APP.currentProjectId) renderProjectDetail(APP.currentProjectId);
    else renderProjects();
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to save project'), 'error'); }
  finally { btn.disabled = false; }
}

async function deleteProjectConfirm(id) {
  const p = await API.getProject(id);
  const isSubfolder = !!p?.parentId;
  confirmAction(`Move "${p?.title}" to Trash? ${isSubfolder ? 'All its tasks' : 'All its sub-folders and tasks'} will go with it. You can restore it from Settings within 30 days.`, async () => {
    await API.deleteProject(id);
    showUndoToast(`🗑️ "${p?.title || 'Project'}" moved to Trash`, async () => {
      await API.restoreProject(id);
      if (APP.currentPage === 'projects') renderProjects();
      else if (APP.currentProjectId) renderProjectDetail(APP.currentProjectId);
      if (APP.currentPage === 'gantt') renderGantt();
      updateSidebar();
    });
    if (APP.currentProjectId === id) {
      // Was viewing the thing we just deleted — go up to its parent, or the flat list if it was top-level.
      if (isSubfolder) await showPage('project-detail', p.parentId);
      else await showPage('projects');
    } else if (APP.currentProjectId) {
      renderProjectDetail(APP.currentProjectId); // deleted a sibling sub-folder while viewing its parent
    } else {
      renderProjects();
    }
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  });
}

// The other side of removeCollaborator — a collaborator taking themselves
// off someone else's project, no owner approval needed. Confirmed first
// since it's not easily undoable from this side (the owner would need to
// re-invite); leaving from a sub-folder still leaves the whole shared tree,
// same as every other sharing action.
async function leaveProjectConfirm(id) {
  const p = await API.getProject(id);
  confirmAction(`Leave "${p?.title}"? You'll lose access to it${p?.ownerName ? ` — ${p.ownerName} would need to re-invite you to see it again` : ''}.`, async () => {
    try {
      await API.leaveProject(id);
      showToast('🚪 Left "' + p.title + '"');
      await showPage('projects');
      updateSidebar();
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to leave project'), 'error'); }
  });
}

// Non-destructive and doesn't touch the original at all (or its sharing),
// so no confirmation needed — jumps straight to the new copy so it's
// obvious it worked and ready to edit right away.
async function duplicateProjectAction(projectId) {
  closeProjectDetailMenu();
  try {
    const copy = await API.duplicateProject(projectId);
    showToast('✅ Duplicated as "' + copy.title + '"');
    updateSidebar();
    await showPage('project-detail', copy.id);
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to duplicate'), 'error'); }
}
