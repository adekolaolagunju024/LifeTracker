// Waypoint app, part 3 of 12: The project page and its bulk task actions.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── PROJECT DETAIL ──────────────────────────────────────────────
async function renderProjectDetail(projectId) {
  try {
    const [proj, children, allTasks] = await Promise.all([
      API.getProject(projectId),
      API.getProjects({ parentId: projectId }),
      API.getTasks(),
    ]);

    document.getElementById('detail-icon').textContent      = proj.icon;
    document.getElementById('detail-title').textContent     = proj.title;
    document.getElementById('detail-desc').textContent      = proj.description || '';
    document.getElementById('detail-color').style.background = proj.color;
    document.getElementById('topbar-title').textContent     = proj.title;

    // Sub-folders can't themselves have sub-folders (one level of nesting only)
    const canEdit = proj.role === 'owner' || proj.role === 'editor';
    APP.detailCanEdit = canEdit;
    document.getElementById('btn-new-subfolder').classList.toggle('hidden', !!proj.parentId || !canEdit);
    document.getElementById('btn-add-task-header').classList.toggle('hidden', !canEdit);
    document.getElementById('btn-edit-project').classList.toggle('hidden', !canEdit);
    // a sub-folder's plan lives in its top-level project; openAssistantFor
    // works on that one
    document.getElementById('btn-assistant-project').classList.toggle('hidden', !canEdit);

    // Chat only makes sense once there's someone else to talk to.
    document.getElementById('btn-project-chat').classList.toggle('hidden', proj.role === 'owner' && !proj.collaboratorCount);

    // Deleting a project (and managing who's on it, inside the Share
    // modal) is owner-only — a collaborator who could delete it could
    // lock everyone else out.
    document.getElementById('btn-delete-project').classList.toggle('hidden', proj.role !== 'owner');
    // The flip side of delete: a collaborator (any role) can remove
    // themselves from someone else's project — the owner can't leave
    // their own project, so these two are always mutually exclusive.
    document.getElementById('btn-leave-project').classList.toggle('hidden', proj.role === 'owner');
    document.getElementById('btn-share-label').textContent = proj.role === 'owner' ? 'Share' : 'People';

    // "No way to know who sent it" — a shared project now says whose it is,
    // right next to its name.
    const sharedBadge = document.getElementById('detail-shared-badge');
    if (proj.role !== 'owner' && proj.ownerName) {
      sharedBadge.textContent = '👤 Shared by ' + proj.ownerName;
      sharedBadge.classList.remove('hidden');
    } else {
      sharedBadge.classList.add('hidden');
    }

    // A collaborator (not the owner) sees their own access level, Google
    // Drive style — viewer/commenter/editor.
    const roleBadge = document.getElementById('detail-role-badge');
    if (proj.role !== 'owner') {
      roleBadge.textContent = ROLE_LABEL[proj.role] || proj.role;
      roleBadge.classList.remove('hidden');
    } else {
      roleBadge.classList.add('hidden');
    }

    // Breadcrumb — only shown for a sub-folder (a project with a parent)
    const crumb = document.getElementById('detail-breadcrumb');
    if (proj.parentId) {
      const parent = await API.getProject(proj.parentId).catch(() => null);
      crumb.classList.remove('hidden');
      crumb.classList.add('flex');
      crumb.innerHTML = parent
        ? `<button class="hover:text-teal font-semibold" onclick="showPage('project-detail','${parent.id}')">${parent.icon} ${esc(parent.title)}</button><span>/</span><span class="text-gray-600 font-semibold">${esc(proj.title)}</span>`
        : '';
    } else {
      crumb.classList.add('hidden');
      crumb.classList.remove('flex');
    }

    // Sub-folders — only shown when this project actually has any
    const subSection = document.getElementById('detail-subfolders-section');
    if (children.length) {
      subSection.classList.remove('hidden');
      document.getElementById('detail-subfolders-grid').innerHTML = children.map(sub => {
        const pts = allTasks.filter(t => t.projectId === sub.id);
        const pdone = pts.filter(t => t.status === 'Completed').length;
        const pp = ProgressMath.progressPct(pts);
        return `
          <div class="bg-white rounded-2xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 p-4 cursor-pointer project-card"
            style="border-top: 3px solid ${sub.color}" onclick="showPage('project-detail','${sub.id}')">
            <div class="flex items-center justify-between mb-2">
              <span class="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style="background:${sub.color}1A">${sub.icon}</span>
              <div class="project-card-actions flex gap-1 opacity-0 transition-opacity">
                <button onclick="event.stopPropagation();editProject('${sub.id}')" class="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 text-xs">✏️</button>
                <button onclick="event.stopPropagation();deleteProjectConfirm('${sub.id}')" class="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 text-xs">🗑️</button>
              </div>
            </div>
            <p class="font-bold text-sm text-navy mb-1">${esc(sub.title)}</p>
            <p class="text-xs text-gray-400 mb-2">${pts.length} tasks · ${pdone} done</p>
            <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div class="h-full rounded-full" style="width:${pp}%;background:${sub.color}"></div>
            </div>
          </div>`;
      }).join('');
    } else {
      subSection.classList.add('hidden');
    }

    renderTaskTable(projectId);

  } catch (e) { console.error('Project detail error:', e); }
}

async function renderTaskTable(projectId) {
  try {
    const [allTags, rawTasks, project] = await Promise.all([
      API.getTags(),
      API.getTasks({
        projectId,
        status:   APP.filters.status   || undefined,
        priority: APP.filters.priority || undefined,
        search:   APP.filters.search   || undefined,
      }),
      API.getProject(projectId),
    ]);
    const minStart = project.startDate || '';

    const tagFilterSel = document.getElementById('filter-tag');
    tagFilterSel.innerHTML = '<option value="">All Tags</option>' +
      allTags.map(tg => `<option value="${tg.id}" ${APP.filters.tag === tg.id ? 'selected' : ''}>${esc(tg.label)}</option>`).join('');

    // Tag isn't a query-string filter on the API (no clean way to pass a
    // tag id list through GET params the way status/priority do) — filter
    // client-side on the tags array the API already returns per task.
    const tasks = APP.filters.tag ? rawTasks.filter(t => (t.tags || []).some(tg => tg.id === APP.filters.tag)) : rawTasks;

    const done = tasks.filter(t => t.status === 'Completed').length;
    const inp  = tasks.filter(t => t.status === 'In Progress').length;
    const cost = tasks.reduce((s, t) => s + (t.cost || 0), 0);

    document.getElementById('detail-stats').innerHTML = `
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex-1">
        <p class="text-xs text-gray-400 font-semibold">Tasks</p>
        <p class="text-2xl font-black font-mono text-navy mt-1">${tasks.length}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex-1">
        <p class="text-xs text-gray-400 font-semibold">Done</p>
        <p class="text-2xl font-black font-mono text-green-600 mt-1">${done}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex-1">
        <p class="text-xs text-gray-400 font-semibold">Active</p>
        <p class="text-2xl font-black font-mono text-orange-500 mt-1">${inp}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 flex-1">
        <p class="text-xs text-gray-400 font-semibold">Est. Cost</p>
        <p class="text-2xl font-black font-mono text-yellow-600 mt-1">${money(cost)}</p>
      </div>`;

    document.getElementById('bulk-select-all').checked = false;
    clearBulkSelection();

    // Viewer/commenter get a read-only table — no bulk-select column, no
    // inline status/priority/date editing, no edit/delete icons.
    const canEdit = project.role === 'owner' || project.role === 'editor';
    document.getElementById('th-bulk-select').classList.toggle('hidden', !canEdit);

    document.getElementById('task-table-body').innerHTML = tasks.length
      ? tasks.map(t => `
          <tr class="border-b border-gray-100 hover:bg-gray-50">
            ${canEdit ? `<td class="tt-sel px-4 py-3"><input type="checkbox" class="bulk-task-checkbox" data-task-id="${t.id}" onchange="updateBulkActionsBar()" aria-label="Select ${esc(t.title)}"></td>` : ''}
            <td class="tt-title px-4 py-3 text-sm font-semibold max-w-xs cursor-pointer hover:text-teal border-l-4" style="border-left-color:${priorityBorderColor(t.priority)}" onclick="openTaskDetail('${t.id}')">
              <div>${esc(t.title)}${t.recurrence && t.recurrence !== 'none' ? ` <span class="text-gray-400 font-normal text-xs" title="Repeats ${t.recurrence}">🔁</span>` : ''}${t.checklistTotal ? ` <span class="text-gray-400 font-normal text-xs" title="Checklist">☑️ ${t.checklistDone}/${t.checklistTotal}</span>` : ''}${t.commentCount ? ` <span class="text-gray-400 font-normal text-xs" title="${t.commentCount} comment${t.commentCount === 1 ? '' : 's'}">💬 ${t.commentCount}</span>` : ''}${statusUpdateBadge(t)} ${obstacleBadge(t)} ${waitingBadge(t)}</div>
              ${blockerChecklist(t, canEdit, 'board')}
              ${(t.tags || []).length ? `<div class="flex flex-wrap gap-1 mt-1">${t.tags.map(tag => `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style="background:${tag.color}22;color:${tag.color}">${esc(tag.label)}</span>`).join('')}</div>` : ''}
              ${taskProgressBarHTML(t)}
            </td>
            <td class="tt-status px-4 py-3">
              ${statusChipHTML(t, canEdit, projectId)}
            </td>
            <td class="tt-priority px-4 py-3">
              ${priorityChipHTML(t, canEdit, projectId)}
            </td>
            <td class="tt-assignee px-4 py-3">${assigneeAvatar(t.assigneeName)}</td>
            <td class="tt-start px-4 py-3">
              <input type="date" aria-label="Start date of ${esc(t.title)}" value="${t.startDate || ''}" min="${minStart}" class="rounded-lg px-2 py-1 text-xs border border-gray-200 focus:outline-none focus:border-teal w-full" ${canEdit ? '' : 'disabled'}
                onchange="updateTaskStartDate('${t.id}', this.value, '${projectId}')">
            </td>
            <td class="tt-due px-4 py-3 text-xs text-gray-400 whitespace-nowrap" data-label="Due">${formatDateShort(t.endDate)}</td>
            <td class="tt-cost px-4 py-3 text-xs font-mono font-semibold ${(t.cost || 0) > 0 ? 'text-green-600' : 'text-gray-300'}">
              ${(t.cost || 0) > 0 ? money(t.cost) : '—'}
            </td>
            <td class="tt-actions px-4 py-3">
              <div class="flex gap-1">
                <button onclick="addTaskToGoogleCalendar('${t.id}')" title="Add to Google Calendar" aria-label="Add ${esc(t.title)} to Google Calendar"
                  class="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 text-sm opacity-60 hover:opacity-100">📅</button>
                ${canEdit ? `
                <button onclick="editTask('${t.id}')" title="Edit" aria-label="Edit ${esc(t.title)}"
                  class="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 text-sm opacity-60 hover:opacity-100">✏️</button>
                <button onclick="duplicateTaskAction('${t.id}','${projectId}')" title="Duplicate" aria-label="Duplicate ${esc(t.title)}"
                  class="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 text-sm opacity-60 hover:opacity-100">⧉</button>
                <button onclick="deleteTaskConfirm('${t.id}','${projectId}')" title="Delete" aria-label="Delete ${esc(t.title)}"
                  class="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 text-sm opacity-60 hover:opacity-100">🗑️</button>` : ''}
              </div>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="9" class="px-4 py-10 text-center text-gray-400 text-sm">
          No tasks match your filters.
          <button onclick="clearFilters('${projectId}')" class="text-teal underline ml-1">Clear filters</button>
          ${canEdit ? `or <button onclick="openAddTask('${projectId}')" class="text-teal underline">add a task</button>.` : ''}
        </td></tr>`;

  } catch (e) { console.error('Task table error:', e); }
}

// ── BULK TASK ACTIONS (project detail table) ────────────────────
function getSelectedTaskIds() {
  return [...document.querySelectorAll('.bulk-task-checkbox:checked')].map(cb => cb.dataset.taskId);
}

function toggleSelectAllTasks(checked) {
  document.querySelectorAll('.bulk-task-checkbox').forEach(cb => { cb.checked = checked; });
  updateBulkActionsBar();
}

function updateBulkActionsBar() {
  const ids = getSelectedTaskIds();
  const bar = document.getElementById('bulk-actions-bar');
  bar.classList.toggle('hidden', ids.length === 0);
  bar.classList.toggle('flex', ids.length > 0);
  document.getElementById('bulk-actions-count').textContent = `${ids.length} selected`;
  const allCbs = document.querySelectorAll('.bulk-task-checkbox');
  document.getElementById('bulk-select-all').checked = allCbs.length > 0 && ids.length === allCbs.length;
}

function clearBulkSelection() {
  document.querySelectorAll('.bulk-task-checkbox').forEach(cb => { cb.checked = false; });
  updateBulkActionsBar();
}

async function bulkSetStatus(status) {
  const ids = getSelectedTaskIds();
  if (!ids.length) return;
  try {
    const results = await Promise.allSettled(ids.map(id => API.updateTask(id, { status })));
    const failed = results.filter(r => r.status === 'rejected');
    const ok = ids.length - failed.length;
    if (ok) showToast(`✅ Updated ${ok} task${ok === 1 ? '' : 's'} to ${status}`);
    if (failed.length) taskErrorToast(failed[0].reason, 'Bulk update failed');
    renderTaskTable(APP.currentProjectId);
    if (APP.currentPage === 'gantt') renderGantt();
  } catch (e) { taskErrorToast(e, 'Bulk update failed'); }
}

async function bulkSetPriority(priority) {
  const ids = getSelectedTaskIds();
  if (!ids.length) return;
  try {
    await Promise.all(ids.map(id => API.updateTask(id, { priority })));
    showToast(`✅ Set ${ids.length} task${ids.length === 1 ? '' : 's'} to ${priority} priority`);
    renderTaskTable(APP.currentProjectId);
    if (APP.currentPage === 'gantt') renderGantt();
  } catch (e) { showToast('❌ ' + (e.message || 'Bulk update failed'), 'error'); }
}

async function bulkDeleteConfirm() {
  const ids = getSelectedTaskIds();
  if (!ids.length) return;
  try {
    await Promise.all(ids.map(id => API.deleteTask(id)));
  } catch (e) { showToast('❌ ' + (e.message || 'Bulk delete failed'), 'error'); }
  refreshTaskViews(APP.currentProjectId);
  showUndoToast(`🗑️ Moved ${ids.length} task${ids.length === 1 ? '' : 's'} to Trash`, async () => {
    await Promise.all(ids.map(id => API.restoreTask(id)));
    refreshTaskViews(APP.currentProjectId);
  });
}

async function updateTaskStatus(id, status, projectId) {
  const before = await API.getTask(id);
  try { await API.updateTask(id, { status }); } catch (e) { taskErrorToast(e, 'Could not update the status'); renderTaskTable(projectId); return; }
  if (before.status !== 'Completed' && status === 'Completed' && before.recurrence && before.recurrence !== 'none') {
    showToast('✅ Completed — next occurrence scheduled');
  }
  renderTaskTable(projectId);
  updateSidebar();
}

async function updateTaskPriority(id, priority, projectId) {
  await API.updateTask(id, { priority });
  renderTaskTable(projectId);
}

async function updateGanttTaskDate(id, field, value) {
  try {
    await API.updateTask(id, { [field]: value });
    showToast('✅ ' + (field === 'startDate' ? 'Start' : 'Due') + ' date updated');
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
  }
  renderGantt(); // re-render either way so a rejected edit reverts to the saved value
}

async function updateGanttTaskStatus(id, status) {
  try {
    const before = await API.getTask(id);
    await API.updateTask(id, { status });
    if (before.status !== 'Completed' && status === 'Completed' && before.recurrence && before.recurrence !== 'none') {
      showToast('✅ Completed — next occurrence scheduled');
    } else {
      showToast('✅ Status updated');
    }
  } catch (e) {
    taskErrorToast(e);
  }
  renderGantt();
}

async function updateTaskStartDate(id, startDate, projectId) {
  try {
    await API.updateTask(id, { startDate });
    showToast('✅ Start date updated');
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
  }
  renderTaskTable(projectId); // re-render either way so a rejected edit reverts to the saved value
}

function applyFilters(projectId) {
  APP.filters.status   = document.getElementById('filter-status').value;
  APP.filters.priority = document.getElementById('filter-priority').value;
  APP.filters.search   = document.getElementById('filter-search').value;
  APP.filters.tag      = document.getElementById('filter-tag').value;
  renderTaskTable(projectId);
}

function clearFilters(projectId) {
  APP.filters = { status: '', priority: '', search: '', tag: '' };
  ['filter-status','filter-priority','filter-search','filter-tag']
    .forEach(id => { document.getElementById(id).value = ''; });
  renderTaskTable(projectId);
}
