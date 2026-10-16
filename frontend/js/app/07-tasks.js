// Waypoint app, part 7 of 12: The task panel: predecessors, blockers, updates, comments, replies, just start.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── TASK DETAIL SIDE PANEL ───────────────────────────────────────
let APP_currentDetailTaskId = null;

// Renders a comment/chat message's optional attachment — an inline
// preview for images/video, a download chip for everything else.
function renderAttachmentHTML(item) {
  if (!item.attachmentId) return '';
  const url = API.attachmentUrl(item.attachmentId);
  const mt = item.attachmentMimetype || '';
  const name = esc(item.attachmentName || 'Attachment');
  if (mt.startsWith('image/')) {
    return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="max-w-full max-h-48 rounded-lg mt-1.5 border border-gray-200" alt="${name}"></a>`;
  }
  if (mt.startsWith('video/')) {
    return `<video src="${url}" controls class="max-w-full max-h-48 rounded-lg mt-1.5 border border-gray-200"></video>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener" class="flex items-center gap-2 mt-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-navy hover:bg-gray-100 w-fit max-w-full">
    <span>${icon('paperclip')}</span><span class="truncate">${name}</span>
  </a>`;
}

async function openTaskDetail(id) {
  try {
    const t = await API.getTask(id);
    const proj = t.projectId ? await API.getProject(t.projectId).catch(() => null) : null;
    APP_currentDetailTaskId = id;
    APP.detailTaskProjectId = t.projectId;

    document.getElementById('td-project-icon').innerHTML    = proj ? emojiIcon(proj.icon) : '';
    document.getElementById('td-project-title').textContent = proj ? proj.title : '';
    document.getElementById('td-title').innerHTML = esc(t.title) + watchSlot(id);
    APP.detailTask = t;
    APP.detailProject = proj;
    const reminder = window.Reminders && Reminders.forTask(id);
    const remindBtn = document.getElementById('td-reminder-btn');
    remindBtn.innerHTML = `${icon('alarm')} ${reminder ? esc(Reminders.fmt(reminder.remindAt)) : 'Remind me'}`;
    remindBtn.classList.toggle('hidden', t.status === 'Completed');
    document.getElementById('td-progress').innerHTML = taskProgressPanelHTML(t);
    document.getElementById('td-progress').classList.toggle('hidden', !t.targetCount);
    document.getElementById('td-facts').innerHTML = taskFactsHTML(t);
    document.getElementById('td-notes').textContent     = t.notes && t.notes.trim() ? t.notes : 'No notes for this task yet.';

    // Google-Drive style: editor/owner can edit the task, commenter can
    // only comment, viewer can only look.
    const canEdit    = proj && (proj.role === 'owner' || proj.role === 'editor');
    if (window.TaskActions) TaskActions.renderPanel(t, !!canEdit); // what it's for: open the right app
    const canComment = proj && (proj.role === 'owner' || proj.role === 'editor' || proj.role === 'commenter');
    document.getElementById('btn-edit-task-detail').classList.toggle('hidden', !canEdit);
    // Status: tap-to-change chips for editors, a plain badge for others.
    const seg = document.getElementById('td-status-seg');
    seg.classList.toggle('hidden', !canEdit);
    seg.querySelectorAll('button[data-value]').forEach(b => {
      const on = b.dataset.value === t.status;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    document.getElementById('td-badges').innerHTML = (canEdit ? '' : statusBadge(t.status)) + priorityBadge(t.priority);
    syncDetailPrimary(t, canEdit);
    document.getElementById('td-comment-box').classList.toggle('hidden', !canComment);
    document.getElementById('td-comment-viewonly').classList.toggle('hidden', canComment);
    document.getElementById('td-status-update-box').classList.toggle('hidden', !canComment);
    document.getElementById('td-obstacle-box').classList.toggle('hidden', !canComment);
    APP.taskObstaclesCanEdit = canComment;
    document.getElementById('td-status-update-viewonly').classList.toggle('hidden', canComment);
    APP.taskCommentCanReply = canComment;
    cancelCommentReply();
    resetTinyStepUI(t, canEdit);

    document.getElementById('task-detail-backdrop').classList.remove('hidden');
    document.getElementById('task-detail-panel').classList.remove('translate-x-full');
    // Cached once per panel-open rather than refetched per keystroke — the
    // @mention picker just filters this list client-side.
    APP.taskCommentPeopleNames = [];
    if (t.projectId) {
      API.getCollaborators(t.projectId).then(people => {
        APP.taskCommentPeopleNames = people.filter(p => p.joinedAt).map(p => p.name).filter(Boolean);
      }).catch(() => {});
    }
    renderTaskComments(id);
    renderStatusUpdates(id);
    renderObstacles(id, t.obstacles || []);
    APP.taskPredecessorsCanEdit = canEdit;
    document.getElementById('td-predecessor-box').classList.toggle('hidden', !canEdit);
    renderPredecessors(t);
  } catch (e) { console.error('Task detail error:', e); }
}

// Reports and their photos live on the top-level project.
function topProjectIdOf(projectId) {
  return (APP.detailProject && APP.detailProject.id === projectId && APP.detailProject.parentId) || projectId;
}
// The task panel's key facts: when it's due (with how long left, or how
// late), when it starts, who's on it, and cost or repeat only when set.
function taskFactsHTML(t) {
  const todayKey = localDateKey(new Date());
  const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  const facts = [];
  const due = (t.endDate || '').slice(0, 10);
  if (due) {
    const d = days(todayKey, due);
    const late = t.status !== 'Completed' && d < 0;
    const when = t.status === 'Completed' ? '' : late ? `${-d} day${d === -1 ? '' : 's'} late` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
    facts.push([late ? 'is-late' : d <= 2 && t.status !== 'Completed' ? 'is-soon' : '', 'Due', `${esc(formatDateShort(t.endDate))}${when ? `<small>${when}</small>` : ''}`]);
  } else facts.push(['', 'Due', 'No date']);
  facts.push(['', 'Starts', t.startDate ? esc(formatDateShort(t.startDate)) : 'Any time']);
  facts.push(['', 'Who', esc(t.assigneeName || 'Unassigned')]);
  if ((t.cost || 0) > 0) facts.push(['', 'Cost', esc(money(t.cost))]);
  if (t.recurrence && t.recurrence !== 'none') facts.push(['', 'Repeats', esc(t.recurrence[0].toUpperCase() + t.recurrence.slice(1))]);
  return facts.map(([cls, k, v]) => `<div class="td-fact ${cls}"><p class="k">${k}</p><p class="v">${v}</p></div>`).join('');
}
// The panel's main button follows the task: Start it, Mark it done, or
// Reopen it. Locked (with the reason) while blockers or predecessors stand.
function syncDetailPrimary(t, canEdit) {
  const btn = document.getElementById('td-primary-btn');
  btn.classList.toggle('hidden', !canEdit);
  const blockers = (t.obstacles || []).filter(o => !o.resolved).length;
  const waiting = waitingOn(t).length;
  btn.disabled = false; btn.title = '';
  if (t.status === 'Completed') { btn.innerHTML = `${icon('undo')} Reopen`; btn.dataset.next = 'In Progress'; return; }
  if (t.status === 'Not Started') {
    btn.innerHTML = waiting ? `${icon('lock')} Waiting on another task` : `${icon('play')} Start`;
    btn.dataset.next = 'In Progress';
    if (waiting) { btn.disabled = true; btn.title = 'It starts once the tasks it waits on are done'; }
    return;
  }
  btn.dataset.next = 'Completed';
  btn.innerHTML = blockers ? `${icon('lock')} Clear ${blockers} blocker${blockers === 1 ? '' : 's'} first` : `${icon('check')} Mark done`;
  if (blockers) { btn.disabled = true; btn.title = 'Tick off its blockers below first'; }
}
function detailPrimaryAction() {
  const btn = document.getElementById('td-primary-btn');
  if (!btn.disabled && btn.dataset.next) setDetailStatus(btn.dataset.next);
}
async function setDetailStatus(status) {
  const id = APP_currentDetailTaskId;
  if (!id || (APP.detailTask && APP.detailTask.status === status)) return;
  try {
    const saved = await API.updateTask(id, { status });
    if (status === 'Completed') {
      if (saved && saved.journeyReward) announceJourneyReward(saved.journeyReward);
      else Sfx.play('complete');
      showToast('✅ Done!');
    }
  } catch (e) { taskErrorToast(e, 'Could not change the status', { taskId: id, status }); return; }
  await openTaskDetail(id);
  rerenderCurrentPage();
}
function openTaskProject() {
  const pid = APP.detailTaskProjectId;
  if (!pid) return;
  closeTaskDetail();
  showPage('project-detail', pid);
}
// Refreshes whatever page is behind the panel after a change made in it.
function rerenderCurrentPage() {
  const page = APP.currentPage;
  if (page === 'dashboard') renderDashboard();
  else if (page === 'gantt') renderGantt();
  else if (page === 'actions') renderActions();
  else if (page === 'calendar') renderCalendar();
  else if (page === 'project-detail' && APP.currentProjectId) renderProjectDetail(APP.currentProjectId);
  updateSidebar();
}

// ── TASK PREDECESSORS (side panel) ─────────────────────────────────
// Finish-to-start dependencies: this task can't start until each of these
// is done. Chips show each one's state; the picker offers the other tasks
// in the same project.
async function renderPredecessors(t) {
  const wrap = document.getElementById('td-predecessors');
  const canEdit = !!APP.taskPredecessorsCanEdit;
  const preds = t.predecessors || [];
  wrap.innerHTML = preds.length ? preds.map(p => {
    const done = p.status === 'Completed';
    return `<span class="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 ${done ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-amber-50 text-amber-800 border border-amber-100'}" title="${done ? 'Done' : 'Not done yet'}">
      ${done ? '✓' : icon('waiting')} ${esc(p.title)}${!done && p.assigneeId && p.assigneeId !== APP.currentUserId ? `<span class="font-normal opacity-80">· ${esc(p.assigneeName)}</span>
      <button type="button" onclick="nudgeWaitingOn('${t.id}','${p.id}', this)" class="underline font-bold ml-0.5" title="Nudge ${esc(p.assigneeName)}">Nudge</button>` : ''}
      ${canEdit ? `<button onclick="removePredecessor('${p.id}')" class="ml-0.5 opacity-60 hover:opacity-100" aria-label="Remove ${esc(p.title)} as a predecessor">×</button>` : ''}
    </span>`;
  }).join('') : `<p class="text-xs text-gray-400">None. This task can start any time.</p>`;
  APP.detailPredecessorIds = preds.map(p => p.id);
  syncPredecessorsToViews(t.id, preds);
  if (!canEdit) return;
  const pick = document.getElementById('td-predecessor-pick');
  try {
    const [allProjects, allTasks] = await Promise.all([API.getProjects(), API.getTasks()]);
    const proj = allProjects.find(p => p.id === t.projectId);
    const root = proj && proj.parentId ? proj.parentId : t.projectId;
    const candidates = tasksInProjectTree(root, allProjects, allTasks)
      .filter(c => c.id !== t.id && !APP.detailPredecessorIds.includes(c.id));
    pick.innerHTML = `<option value="">${candidates.length ? 'Add a task this one waits on…' : 'No other tasks in this project'}</option>`
      + candidates.map(c => `<option value="${c.id}">${c.status === 'Completed' ? '✓ ' : ''}${esc(c.title)}</option>`).join('');
  } catch (e) { console.error('Predecessor picker error:', e); }
}
// Keeps the Journey and the cached task lists in step without a reload.
function syncPredecessorsToViews(taskId, preds) {
  if (!mountainState) return;
  const t = mountainState.tasks.find(x => x.id === taskId);
  if (t && JSON.stringify(t.predecessors || []) !== JSON.stringify(preds)) { t.predecessors = preds; renderMountainTaskList(); }
}
async function savePredecessors(ids) {
  try {
    const t = await API.setPredecessors(APP_currentDetailTaskId, ids);
    renderPredecessors(t);
    if (APP.currentPage === 'gantt') renderGantt();
    else if (APP.currentPage === 'project-detail') renderProjectDetail(APP.currentProjectId);
  } catch (e) { showToast('🔗 ' + (e.message || 'Could not update the predecessors'), 'error'); }
}
function addPredecessor() {
  const pick = document.getElementById('td-predecessor-pick');
  if (!pick.value || !APP_currentDetailTaskId) { pick.focus(); return; }
  savePredecessors([...(APP.detailPredecessorIds || []), pick.value]);
}
function removePredecessor(predId) {
  savePredecessors((APP.detailPredecessorIds || []).filter(id => id !== predId));
}

// ── TASK OBSTACLES (side panel) ────────────────────────────────────
// Named obstacles with a count — on the Journey each becomes that many
// enemies on the road before this task's flag (rival players, mini-bosses,
// sharks, asteroids...), cleared when the task is done.
function renderObstacles(taskId, obstacles) {
  const wrap = document.getElementById('td-obstacles');
  const canEdit = !!APP.taskObstaclesCanEdit;
  wrap.innerHTML = obstacles.length
    ? obstacles.map(o => `
        <div class="flex flex-wrap items-center gap-2 ${o.resolved ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'} border rounded-lg px-2.5 py-1.5">
          <input type="checkbox" ${o.resolved ? 'checked' : ''} ${canEdit ? '' : 'disabled'} onchange="toggleObstacleResolved('${o.id}', this.checked)" class="w-4 h-4 accent-green-600 flex-shrink-0" title="${o.resolved ? 'Cleared. Untick if it is back in the way' : 'Tick when this blocker is cleared'}" aria-label="${esc(o.name)} cleared">
          <span class="flex-1 min-w-0 text-sm truncate ${o.resolved ? 'line-through text-gray-400' : 'text-gray-800'}" title="${esc(o.name)}">${o.resolved ? '' : icon('blocker', 'tiny mr-1 text-red-600')}${esc(o.name)}</span>
          ${canEdit && !o.resolved ? `
            <button onclick="changeObstacleCount('${o.id}', ${o.count - 1})" ${o.count <= 1 ? 'disabled' : ''} class="w-6 h-6 rounded-md text-gray-600 hover:bg-white disabled:opacity-30" aria-label="Smaller blocker" title="Smaller (fewer enemies on the Journey)">−</button>
            <span class="text-xs font-bold text-red-700 w-6 text-center" aria-label="Size ${o.count}">×${o.count}</span>
            <button onclick="changeObstacleCount('${o.id}', ${o.count + 1})" ${o.count >= 5 ? 'disabled' : ''} class="w-6 h-6 rounded-md text-gray-600 hover:bg-white disabled:opacity-30" aria-label="Bigger blocker" title="Bigger (more enemies on the Journey)">+</button>
            <button onclick="Reports.openMedia(topProjectIdOf(APP.detailTaskProjectId), { kind: 'blocker', taskId: '${taskId}', caption: ${esc(JSON.stringify(o.name))} })" class="text-gray-400 hover:text-teal text-sm px-1" title="Add a photo of this blocker to the project report" aria-label="Add a photo of this blocker to the report">${icon('camera')}</button>
            <span data-help-slot="${o.id}" data-name="${esc(o.name)}"></span>
            <button onclick="removeObstacle('${o.id}')" class="text-gray-300 hover:text-red-500 text-xs px-1" aria-label="Remove blocker">${icon('trash')}</button>`
          : `<span class="text-xs font-bold ${o.resolved ? 'text-green-700' : 'text-red-700'}">×${o.count}</span>${canEdit ? `
            <button onclick="removeObstacle('${o.id}')" class="text-gray-300 hover:text-red-500 text-xs px-1" aria-label="Remove blocker">${icon('trash')}</button>` : ''}`}
        </div>`).join('')
    : `<p class="text-xs text-gray-400">Nothing in the way. Add a blocker if something is stopping you.</p>`;
  syncObstaclesToJourney(taskId, obstacles);
  if (window.Race && canEdit) Race.fillHelpSlots(taskId, wrap);
  // Ticking the last blocker off unlocks "Mark done" right away.
  if (APP.detailTask && APP.detailTask.id === taskId) {
    APP.detailTask.obstacles = obstacles;
    const p = APP.detailProject;
    syncDetailPrimary(APP.detailTask, !!(p && (p.role === 'owner' || p.role === 'editor')));
  }
}
// Keeps the Journey (and the cached task lists) in step without a reload.
function syncObstaclesToJourney(taskId, obstacles) {
  if (mountainState) {
    const t = mountainState.tasks.find(x => x.id === taskId);
    if (t && JSON.stringify(t.obstacles || []) !== JSON.stringify(obstacles)) {
      t.obstacles = obstacles;
      renderMountainScene();
      renderMountainTaskList();
    }
  }
}
async function refreshObstacles(taskId) {
  try {
    const list = await API.getObstacles(taskId);
    renderObstacles(taskId, list);
    syncBlockerCopies(taskId, list); // the board, table and Journey behind the panel
  } catch (e) { console.error('Obstacles error:', e); }
}
async function submitObstacle() {
  const nameEl = document.getElementById('td-obstacle-name'), countEl = document.getElementById('td-obstacle-count');
  const name = nameEl.value.trim();
  if (!name || !APP_currentDetailTaskId) { nameEl.focus(); return; }
  try {
    await API.addObstacle(APP_currentDetailTaskId, name, Number(countEl.value));
    nameEl.value = ''; countEl.value = '1';
    refreshObstacles(APP_currentDetailTaskId);
  } catch (e) { showToast('❌ ' + (e.message || 'Could not add the blocker'), 'error'); }
}
async function toggleObstacleResolved(obstacleId, resolved) {
  try {
    await API.updateObstacle(obstacleId, { resolved });
    await refreshObstacles(APP_currentDetailTaskId);
    // The Gantt, Kanban and table badges count only pending obstacles.
    if (APP.currentPage === 'gantt') renderGantt();
    else if (APP.currentPage === 'project-detail') renderProjectDetail(APP.currentProjectId);
  } catch (e) { showToast('❌ ' + (e.message || 'Could not update the blocker'), 'error'); }
}
async function changeObstacleCount(obstacleId, count) {
  if (count < 1 || count > 5) return;
  try {
    await API.updateObstacle(obstacleId, { count });
    refreshObstacles(APP_currentDetailTaskId);
  } catch (e) { showToast('❌ ' + (e.message || 'Could not change the blocker'), 'error'); }
}
function removeObstacle(obstacleId) {
  confirmAction('Remove this blocker?', async () => {
    try {
      await API.deleteObstacle(obstacleId);
      refreshObstacles(APP_currentDetailTaskId);
    } catch (e) { showToast('❌ ' + (e.message || 'Could not remove the obstacle'), 'error'); }
  });
}

// ── TASK STATUS UPDATES (side panel) ───────────────────────────────
// A separate, scannable log of "why it's still at this status" notes —
// distinct from the freeform Comments thread below it — rendered with the
// task's status at post time so the trail reads like "Not Started" ->
// "In Progress" -> ... even once the task itself has moved on.
async function renderStatusUpdates(taskId) {
  const wrap = document.getElementById('td-status-updates');
  try {
    const updates = await API.getStatusUpdates(taskId);
    const names = APP.taskCommentPeopleNames || [];
    wrap.innerHTML = updates.length
      ? updates.map(u => `
          <div class="group">
            <div class="flex items-center justify-between gap-2">
              <span class="flex items-center gap-1.5 flex-wrap">
                <p class="text-xs font-semibold text-navy">${esc(u.authorName)}</p>
                ${statusBadge(u.status)}
                ${u.isBlocker ? `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">${icon('construction')} Blocker</span>` : ''}
              </span>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="text-[10px] text-gray-400">${new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                ${u.userId === APP.currentUserId ? `<button onclick="deleteStatusUpdateConfirm('${u.id}','${taskId}')" class="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100">${icon('trash')}</button>` : ''}
              </div>
            </div>
            <p class="text-sm text-gray-700 whitespace-pre-wrap mt-0.5">${renderMentionText(u.text, names)}</p>
          </div>`).join('')
      : `<p class="text-xs text-gray-400">No status updates yet — post one to tell the team why this is still here.</p>`;
  } catch (e) { console.error('Status updates error:', e); }
}

async function submitStatusUpdate() {
  const input = document.getElementById('td-status-update-input');
  const blockerCheckbox = document.getElementById('td-status-update-blocker');
  const text = input.value.trim();
  if (!text || !APP_currentDetailTaskId) return;
  try {
    await API.addStatusUpdate(APP_currentDetailTaskId, text, blockerCheckbox.checked);
    input.value = '';
    blockerCheckbox.checked = false;
    renderStatusUpdates(APP_currentDetailTaskId);
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to post update'), 'error'); }
}

function deleteStatusUpdateConfirm(updateId, taskId) {
  confirmAction('Delete this status update?', async () => {
    try {
      await API.deleteStatusUpdate(updateId);
      renderStatusUpdates(taskId);
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to delete'), 'error'); }
  });
}

// ── TASK COMMENTS (side panel) ────────────────────────────────────
async function renderTaskComments(taskId) {
  const wrap = document.getElementById('td-comments');
  try {
    const comments = await API.getComments(taskId);
    const names = APP.taskCommentPeopleNames || [];
    wrap.innerHTML = comments.length
      ? comments.map(c => `
          <div class="group">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs font-semibold text-navy">${esc(c.authorName)}</p>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="text-[10px] text-gray-400">${new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                ${APP.taskCommentCanReply ? `<button onclick="replyToComment('${c.id}','${esc(c.authorName).replace(/'/g, "\\'")}','${esc(c.text).replace(/'/g, "\\'")}')" class="text-gray-300 hover:text-teal text-xs opacity-0 group-hover:opacity-100" title="Reply">↩</button>` : ''}
                ${c.userId === APP.currentUserId ? `<button onclick="deleteCommentConfirm('${c.id}','${taskId}')" class="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100">${icon('trash')}</button>` : ''}
              </div>
            </div>
            ${c.replyToId ? `<div class="border-l-2 border-gray-200 pl-2 mb-1 text-xs text-gray-400 truncate">↩ ${esc(c.replyToAuthorName || 'a deleted comment')}${c.replyToText ? ': ' + esc(c.replyToText.length > 60 ? c.replyToText.slice(0, 60) + '…' : c.replyToText) : ''}</div>` : ''}
            <p class="text-sm text-gray-700 whitespace-pre-wrap">${renderMentionText(c.text, names)}</p>
            ${renderAttachmentHTML(c)}
          </div>`).join('')
      : `<p class="text-xs text-gray-400">No comments yet.</p>`;
  } catch (e) { console.error('Comments error:', e); }
}

// A comment/message someone tagged you in should read as unmistakably
// theirs to you, not blend into ordinary text — matched against the
// project's own collaborator names rather than a generic @word regex, so
// an email address pasted into a comment is never mistaken for a mention.
function renderMentionText(text, names) {
  let html = esc(text);
  if (!names || !names.length) return html;
  [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length).forEach(name => {
    const escName = esc(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp('@' + escName + '\\b', 'g'), `<span class="font-semibold text-teal">@${esc(name)}</span>`);
  });
  return html;
}

// ── @MENTIONS input helper (task comments + project chat) ─────────
// Typing "@" opens a small picker of people with access to the project;
// picking one inserts their name at the cursor. Shared by both inputs —
// which project's people list to filter against is inferred from the
// input's own id.
async function onMentionInput(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  const pos = input.selectionStart;
  const match = input.value.slice(0, pos).match(/@([A-Za-z][\w ]{0,30})$/);
  if (!match) { list.classList.add('hidden'); return; }
  const query = match[1].toLowerCase();
  const names = inputId === 'team-chat-input' ? (APP.chatPeopleNames || []) : (APP.taskCommentPeopleNames || []);
  const filtered = names.filter(n => n.toLowerCase().includes(query));
  if (!filtered.length) { list.classList.add('hidden'); return; }
  list.innerHTML = filtered.map(n =>
    `<button type="button" onmousedown="event.preventDefault();insertMention('${inputId}','${listId}','${esc(n).replace(/'/g, "\\'")}')" class="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">${esc(n)}</button>`
  ).join('');
  list.classList.remove('hidden');
}
// A click on a dropdown option is preventDefault'd on mousedown precisely
// so it fires before this blur — but a click anywhere else (dismissing the
// picker without choosing) needs its own way to close it.
function hideMentionListDelayed(listId) {
  setTimeout(() => document.getElementById(listId)?.classList.add('hidden'), 150);
}
function insertMention(inputId, listId, name) {
  const input = document.getElementById(inputId);
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos).replace(/@([A-Za-z][\w ]{0,30})$/, '@' + name + ' ');
  input.value = before + input.value.slice(pos);
  document.getElementById(listId).classList.add('hidden');
  input.focus();
  input.setSelectionRange(before.length, before.length);
}

// ── REPLY (task comments) ──────────────────────────────────────────
let APP_commentReplyTo = null;
function replyToComment(id, authorName, text) {
  APP_commentReplyTo = { id, authorName, text };
  document.getElementById('td-comment-reply-author').textContent = authorName;
  document.getElementById('td-comment-reply-snippet').textContent = text.length > 60 ? text.slice(0, 60) + '…' : text;
  document.getElementById('td-comment-reply-chip').classList.remove('hidden');
  document.getElementById('td-comment-reply-chip').classList.add('flex');
  document.getElementById('td-comment-input').focus();
}
function cancelCommentReply() {
  APP_commentReplyTo = null;
  document.getElementById('td-comment-reply-chip').classList.add('hidden');
  document.getElementById('td-comment-reply-chip').classList.remove('flex');
}

async function onCommentFileSelected(file) {
  if (!file || !APP.detailTaskProjectId) return;
  try {
    const attachment = await API.uploadAttachment(APP.detailTaskProjectId, file);
    APP.commentPendingAttachment = attachment;
    document.getElementById('td-comment-attachment-name').textContent = attachment.originalName;
    document.getElementById('td-comment-attachment-chip').classList.remove('hidden');
    document.getElementById('td-comment-attachment-chip').classList.add('flex');
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to upload'), 'error');
  } finally {
    document.getElementById('td-comment-file-input').value = '';
  }
}

function clearCommentAttachment() {
  APP.commentPendingAttachment = null;
  document.getElementById('td-comment-attachment-chip').classList.add('hidden');
  document.getElementById('td-comment-attachment-chip').classList.remove('flex');
}

async function submitTaskComment() {
  const input = document.getElementById('td-comment-input');
  const text = input.value.trim();
  const attachment = APP.commentPendingAttachment;
  if ((!text && !attachment) || !APP_currentDetailTaskId) return;
  try {
    await API.addComment(APP_currentDetailTaskId, text, attachment ? attachment.id : null, APP_commentReplyTo?.id || null);
    input.value = '';
    clearCommentAttachment();
    cancelCommentReply();
    renderTaskComments(APP_currentDetailTaskId);
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to post comment'), 'error'); }
}

function deleteCommentConfirm(commentId, taskId) {
  confirmAction('Delete this comment?', async () => {
    try {
      await API.deleteComment(commentId);
      renderTaskComments(taskId);
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to delete'), 'error'); }
  });
}

function closeTaskDetail() {
  document.getElementById('task-detail-backdrop').classList.add('hidden');
  document.getElementById('task-detail-panel').classList.add('translate-x-full');
  APP_currentDetailTaskId = null;
  clearCommentAttachment();
  stopTinyStepTimer();
}

// ── "JUST START" (2-minute timer + optional AI tiny-step suggestion) ──
// Only for a task someone can edit that hasn't been started yet — the
// whole point is lowering the activation energy to START, so it has
// nothing to offer once a task is already In Progress or Completed.
function resetTinyStepUI(task, canEdit) {
  stopTinyStepTimer();
  const show = canEdit && task.status === 'Not Started';
  document.getElementById('td-tiny-step').classList.toggle('hidden', !show);
  if (show && window.Why) Why.fillStuck();
  if (!show) return;
  document.getElementById('td-tiny-step-suggestion').classList.add('hidden');
  document.getElementById('td-tiny-step-suggestion').textContent = '';
  document.getElementById('td-timer-start-btn').classList.remove('hidden');
  document.getElementById('td-timer-display').classList.add('hidden');
  document.getElementById('td-timer-done-btn').classList.add('hidden');
}

function stopTinyStepTimer() {
  if (APP.tinyStepTimerHandle) { clearInterval(APP.tinyStepTimerHandle); APP.tinyStepTimerHandle = null; }
}

function startTwoMinuteTimer() {
  document.getElementById('td-timer-start-btn').classList.add('hidden');
  const display = document.getElementById('td-timer-display');
  display.classList.remove('hidden');
  let secondsLeft = 120;
  const render = () => { display.textContent = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`; };
  render();
  APP.tinyStepTimerHandle = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      stopTinyStepTimer();
      display.textContent = 'Nice — you started.';
      document.getElementById('td-timer-done-btn').classList.remove('hidden');
      return;
    }
    render();
  }, 1000);
}

async function markStartedFromTimer() {
  if (!APP_currentDetailTaskId) return;
  await updateTaskStatus(APP_currentDetailTaskId, 'In Progress', APP.detailTaskProjectId);
  openTaskDetail(APP_currentDetailTaskId);
}

async function suggestTinyStep() {
  const btn = document.getElementById('td-tiny-step-suggest-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  try {
    const res = await fetch('/api/ai/tiny-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: APP_currentDetailTaskId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not get a suggestion');
    const el = document.getElementById('td-tiny-step-suggestion');
    el.textContent = body.suggestion || "Couldn't come up with one — just try the 2-minute timer instead.";
    el.classList.remove('hidden');
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to get a suggestion'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function editTaskFromDetail() {
  const id = APP_currentDetailTaskId;
  closeTaskDetail();
  if (id) editTask(id);
}

function duplicateTaskFromDetail() {
  const id = APP_currentDetailTaskId;
  const projectId = APP.detailTaskProjectId;
  closeTaskDetail();
  if (id) duplicateTaskAction(id, projectId);
}

// ── GOOGLE CALENDAR ──────────────────────────────────────────────
// Uses Google's public "render" link (no OAuth, no setup needed) — opens a
// pre-filled event that the user reviews and saves themselves, in contrast
// to the Drive integration which needs GOOGLE_CLIENT_ID/SECRET configured.
async function addTaskToGoogleCalendar(taskId) {
  if (!taskId) return;
  try {
    const t = await API.getTask(taskId);
    const start = t.startDate || t.endDate;
    const end   = t.endDate   || t.startDate;
    if (!start) { showToast('Set a start or due date on this task first', 'error'); return; }

    // Google Calendar's all-day "dates" range is start-inclusive, end-exclusive.
    const gcalStart = start.replace(/-/g, '');
    const gcalEnd   = addDaysToDateStr(end, 1).replace(/-/g, '');

    const details = [
      t.priority ? `Priority: ${t.priority}` : '',
      t.notes || '',
    ].filter(Boolean).join('\n');

    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE');
    url.searchParams.set('text', t.title);
    url.searchParams.set('dates', `${gcalStart}/${gcalEnd}`);
    if (details) url.searchParams.set('details', details);

    window.open(url.toString(), '_blank');
  } catch (e) {
    showToast('❌ Could not open Google Calendar', 'error');
  }
}

// ── MODALS ───────────────────────────────────────────────────────
function openModal(id)  {
  document.getElementById(id).classList.add('open');
  if (id === 'modal-task') prepareTaskForm();
}
// The task form's chips mirror its status/priority selects (still the
// source of truth for saveTask), and "More options" opens itself when any
// of repeat, target or cost holds a value.
function syncSegs(root = document) {
  root.querySelectorAll('.seg[data-seg-for]').forEach(seg => {
    const sel = document.getElementById(seg.dataset.segFor);
    seg.querySelectorAll('button[data-value]').forEach(b => {
      const on = sel && sel.value === b.dataset.value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  });
}
function prepareTaskForm() {
  syncSegs(document.getElementById('modal-task'));
  const more = document.getElementById('task-more');
  const filled = document.getElementById('task-recurrence').value !== 'none'
    || document.getElementById('task-target-count').value
    || Number(document.getElementById('task-cost').value) > 0;
  more.open = !!filled;
  if (!document.getElementById('task-id').value) setTimeout(() => document.getElementById('task-title-in').focus(), 60);
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.seg[data-seg-for] button[data-value]');
  if (!b) return;
  const seg = b.closest('.seg');
  const sel = document.getElementById(seg.dataset.segFor);
  sel.value = b.dataset.value;
  sel.dispatchEvent(new Event('change'));
  syncSegs(seg.parentElement);
});
// Arrow keys move the choice within a chip group, as a radio group should.
document.addEventListener('keydown', e => {
  const b = e.target.closest && e.target.closest('.seg button[data-value]');
  if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const items = [...b.closest('.seg').querySelectorAll('button[data-value]:not(:disabled)')];
  const next = items[(items.indexOf(b) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
  e.preventDefault(); next.focus(); next.click();
});
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// PROJECT MODAL
