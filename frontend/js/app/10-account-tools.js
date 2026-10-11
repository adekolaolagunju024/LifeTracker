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

// The template gallery at the top of New Project (backend/templates.js):
// one tap creates the whole plan, dated from today, and opens it.
let projectTemplatesCache = null;
async function renderProjectTemplates() {
  const wrap = document.getElementById('proj-templates');
  wrap.classList.remove('hidden');
  const list = document.getElementById('proj-template-list');
  try {
    projectTemplatesCache = projectTemplatesCache || await API.getProjectTemplates();
  } catch { wrap.classList.add('hidden'); return; }
  list.innerHTML = projectTemplatesCache.map(t => `
    <button type="button" onclick="startProjectFromTemplate('${t.id}', this)" title="${esc(t.description)}"
      class="text-left border border-gray-200 hover:border-teal hover:bg-teal/5 rounded-xl px-3 py-2.5 transition">
      <span class="block text-sm font-bold text-navy truncate">${t.icon} ${esc(t.title)}</span>
      <span class="block text-[11px] text-gray-500 mt-0.5">${t.phases} phases · ${t.tasks} tasks · ${Math.round(t.days / 7)} weeks</span>
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
  document.getElementById('modal-project-title').textContent = 'New Sub-folder';
  document.getElementById('project-ai-btn').classList.add('hidden');
  document.getElementById('proj-templates').classList.add('hidden');
  document.getElementById('proj-invite-wrap').classList.add('hidden');
  document.getElementById('proj-id').value     = '';
  document.getElementById('proj-parent').value = parentId;
  document.getElementById('proj-title').value  = '';
  document.getElementById('proj-desc').value   = '';
  document.getElementById('proj-icon').value   = '📁';
  document.getElementById('proj-color').value  = '#0A7E8C';
  document.getElementById('proj-start').value  = '';
  document.getElementById('proj-type').value   = 'career';
  document.getElementById('proj-type-wrap').classList.add('hidden');
  openModal('modal-project');
}

async function editProject(id) {
  const p = await API.getProject(id);
  document.getElementById('modal-project-title').textContent = p.parentId ? 'Edit Sub-folder' : 'Edit Project';
  document.getElementById('proj-templates').classList.add('hidden');
  document.getElementById('proj-invite-wrap').classList.add('hidden');
  document.getElementById('project-ai-btn').classList.toggle('hidden', !(p.role === 'owner' || p.role === 'editor'));
  document.getElementById('proj-id').value     = id;
  document.getElementById('proj-parent').value = p.parentId || '';
  document.getElementById('proj-title').value  = p.title;
  document.getElementById('proj-desc').value   = p.description || '';
  document.getElementById('proj-icon').value   = p.icon;
  document.getElementById('proj-color').value  = p.color;
  document.getElementById('proj-start').value  = p.startDate || '';
  document.getElementById('proj-type').value   = p.type || 'career';
  document.getElementById('proj-type-wrap').classList.toggle('hidden', !!p.parentId);
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
  if (!data.title) { showToast('Project title is required', 'error'); return; }
  try {
    if (id) { await API.updateProject(id, data); showToast('✅ Project updated'); }
    else {
      const created = await API.addProject(data);
      const invited = data.parentId ? '' : await inviteFromNewProject(created.id);
      showToast((data.parentId ? '✅ Sub-folder created' : '✅ Project created') + invited);
    }
    closeModal('modal-project');
    if (APP.currentProjectId) renderProjectDetail(APP.currentProjectId);
    else renderProjects();
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to save project'), 'error'); }
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
