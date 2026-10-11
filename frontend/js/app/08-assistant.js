// Waypoint app, part 8 of 12: Planning with AI, the Waypoint assistant and referrals.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── CREATE PROJECT VIA AI CHAT (with an optional attached file) ────
// One merged flow — like Claude's own chat — instead of a separate
// "upload a file" tab that skipped the conversation entirely. The
// frontend keeps the whole history in APP.projectChat and resends it
// every turn (the /project-chat endpoint is stateless); Claude either
// replies with a normal chat message to keep asking questions, or calls
// propose_project once it has enough, whether that came from the
// conversation, an attached file, or both.

function resetProjectChat() {
  APP.projectChat = [];
  clearChatAttachment();
  const wrap = document.getElementById('chat-messages');
  wrap.innerHTML = '';
  document.getElementById('chat-input').value = '';
  addChatBubble('assistant', "Hi! What goal are you working towards? Tell me a bit about it, or attach a plan, checklist, spreadsheet or image — I'll help shape it into a project.");
}

function addChatBubble(role, text, pending) {
  const wrap = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'max-w-[85%] text-sm rounded-2xl px-3 py-2 whitespace-pre-wrap ' +
    (role === 'user' ? 'self-end bg-teal text-white rounded-br-sm' : 'self-start bg-gray-100 text-navy rounded-bl-sm');
  if (pending) el.classList.add('opacity-60');
  el.textContent = text;
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
  return el;
}

const CHAT_ATTACHMENT_MIME_FALLBACK = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
};

// Reads the file entirely client-side (FileReader, base64) rather than a
// multipart upload — it travels inside the same JSON body as the chat
// message so it can sit in APP.projectChat's history like any other turn.
async function onChatFileSelected(file) {
  if (!file) return;
  const errorEl = document.getElementById('import-error');
  errorEl.classList.add('hidden');
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  if (!CHAT_ATTACHMENT_MIME_FALLBACK[ext]) {
    errorEl.textContent = 'Unsupported file type. Attach a .xlsx, .pdf, .png, or .jpg.';
    errorEl.classList.remove('hidden');
    document.getElementById('chat-file-input').value = '';
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    errorEl.textContent = 'That file is too large (max 15MB).';
    errorEl.classList.remove('hidden');
    document.getElementById('chat-file-input').value = '';
    return;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
  APP.chatPendingAttachment = { name: file.name, mimetype: file.type || CHAT_ATTACHMENT_MIME_FALLBACK[ext], dataBase64: dataUrl.split(',')[1] };

  document.getElementById('chat-attachment-name').textContent = file.name;
  document.getElementById('chat-attachment-chip').classList.remove('hidden');
  document.getElementById('chat-attachment-chip').classList.add('flex');
}

function clearChatAttachment() {
  APP.chatPendingAttachment = null;
  document.getElementById('chat-file-input').value = '';
  document.getElementById('chat-attachment-chip').classList.add('hidden');
  document.getElementById('chat-attachment-chip').classList.remove('flex');
}

async function sendProjectChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  const attachment = APP.chatPendingAttachment;
  if (!text && !attachment) return;

  const sendBtn = document.getElementById('chat-send-btn');
  const userMsg = { role: 'user', content: text };
  if (attachment) userMsg.attachment = attachment;
  APP.projectChat.push(userMsg);
  addChatBubble('user', (attachment ? 'Attached: ' + attachment.name + (text ? '\n' : '') : '') + text);
  input.value = '';
  clearChatAttachment();
  input.disabled = true;
  sendBtn.disabled = true;
  const typingEl = addChatBubble('assistant', attachment ? 'Reading the attachment…' : 'Thinking…', true);

  try {
    const res = await fetch('/api/ai/project-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: APP.projectChat }),
    });
    const body = await res.json();
    typingEl.remove();
    if (!res.ok) throw new Error(body.error || 'Chat failed');

    if (body.type === 'proposal') {
      addChatBubble('assistant', "Here's a plan I've put together — review and edit it below.");
      showImportPreview(body.proposal);
    } else {
      APP.projectChat.push({ role: 'assistant', content: body.message });
      addChatBubble('assistant', body.message);
    }
  } catch (e) {
    typingEl.remove();
    addChatBubble('assistant', (e.message || 'Something went wrong — try again'));
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function showImportPreview(body) {
  document.getElementById('import-proj-icon').value  = body.icon || '📁';
  document.getElementById('import-proj-title').value = body.title || '';
  document.getElementById('import-proj-desc').value  = body.description || '';
  // Older/degenerate responses might still come back as a flat `tasks`
  // array (e.g. a proposal with no phases at all) — normalize into one
  // phase so the renderer only ever has to handle the phases shape.
  const phases = body.phases && body.phases.length ? body.phases : [{ title: body.title || '', tasks: body.tasks || [] }];
  renderImportTasksList(phases);

  document.getElementById('import-step-upload').classList.add('hidden');
  document.getElementById('import-upload-actions').classList.add('hidden');
  document.getElementById('import-upload-actions').classList.remove('flex');
  document.getElementById('import-step-preview').classList.remove('hidden');
  document.getElementById('import-preview-actions').classList.remove('hidden');
  document.getElementById('import-preview-actions').classList.add('flex');
}

const IMPORT_PRIORITIES = ['High', 'Medium', 'Low'];
const IMPORT_STATUSES   = ['Not Started', 'In Progress', 'Completed'];

function importTaskRowHtml(t, globalIndex) {
  return `
    <div class="border border-gray-200 rounded-lg p-3" data-task-index="${globalIndex}">
      <div class="flex items-start gap-2 mb-2">
        <input type="text" class="import-task-title flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-teal" value="${esc(t.title || '')}">
        <button onclick="this.closest('[data-task-index]').remove(); updateImportTaskCount();" class="text-gray-300 hover:text-red-500 text-sm p-1.5 rounded hover:bg-red-50">${icon('trash')}</button>
      </div>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <select class="import-task-priority border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-teal">
          ${IMPORT_PRIORITIES.map(p => `<option ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <select class="import-task-status border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-teal">
          ${IMPORT_STATUSES.map(s => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <input type="date" class="import-task-start border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-teal" value="${t.startDate || ''}">
        <input type="date" class="import-task-end border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-teal" value="${t.endDate || ''}">
      </div>
    </div>`;
}

// A single phase renders as a flat task list, exactly like before phases
// existed — only 2+ phases get a visible, editable phase header, so a
// simple goal's preview looks unchanged. Every task row carries a
// data-phase-index so createImportedProject() can regroup them later even
// after rows are deleted or reordered by hand.
function renderImportTasksList(phases) {
  let globalIndex = 0;
  let totalTasks = 0;
  const showHeaders = phases.length > 1;

  const html = phases.map((phase, phaseIndex) => {
    const rows = (phase.tasks || []).map(t => importTaskRowHtml(t, globalIndex++)).join('');
    totalTasks += (phase.tasks || []).length;
    const header = showHeaders ? `
      <div class="flex items-center gap-2 mb-2 ${phaseIndex > 0 ? 'mt-4' : ''}">
        <span class="text-xs flex-shrink-0">${icon('goal')}</span>
        <input type="text" class="import-phase-title flex-1 text-xs font-semibold text-gray-600 bg-transparent border-b border-dashed border-gray-300 focus:outline-none focus:border-teal py-1" value="${esc(phase.title || '')}">
      </div>` : '';
    return `<div data-phase-group="${phaseIndex}">${header}<div class="space-y-2">${rows}</div></div>`;
  }).join('');

  document.getElementById('import-task-count').textContent = totalTasks;
  document.getElementById('import-tasks-list').innerHTML = totalTasks
    ? html
    : `<p class="text-xs text-gray-400 text-center py-4">No tasks found — you can still create the project and add tasks manually.</p>`;
}

function updateImportTaskCount() {
  document.getElementById('import-task-count').textContent = document.querySelectorAll('#import-tasks-list [data-task-index]').length;
}

async function createImportedProject() {
  const title = document.getElementById('import-proj-title').value.trim();
  if (!title) { showToast('Project title is required', 'error'); return; }

  const btn = document.getElementById('import-create-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const proj = await API.addProject({
      title,
      icon: document.getElementById('import-proj-icon').value.trim() || '📁',
      description: document.getElementById('import-proj-desc').value.trim(),
      isGoal: true,
    });

    const phaseGroups = document.querySelectorAll('#import-tasks-list [data-phase-group]');
    const nonEmptyGroups = Array.from(phaseGroups).filter(g => g.querySelector('[data-task-index]'));
    let taskCount = 0;

    for (const group of nonEmptyGroups) {
      // One phase (the common case for a simple goal) — attach its tasks
      // straight to the main project, no sub-folder needed. Multiple
      // phases become one sub-project per phase, same as a user manually
      // organizing work into sub-folders elsewhere in the app.
      let targetProjectId = proj.id;
      if (nonEmptyGroups.length > 1) {
        const phaseTitleInput = group.querySelector('.import-phase-title');
        const phaseTitle = (phaseTitleInput?.value || '').trim() || 'Untitled Phase';
        const subProj = await API.addProject({ title: phaseTitle, parentId: proj.id });
        targetProjectId = subProj.id;
      }

      const rows = group.querySelectorAll('[data-task-index]');
      for (const row of rows) {
        const taskTitle = row.querySelector('.import-task-title').value.trim();
        if (!taskTitle) continue;
        await API.addTask({
          projectId: targetProjectId,
          title: taskTitle,
          priority: row.querySelector('.import-task-priority').value,
          status: row.querySelector('.import-task-status').value,
          startDate: row.querySelector('.import-task-start').value,
          endDate: row.querySelector('.import-task-end').value,
        });
        taskCount++;
      }
    }

    closeModal('modal-import');
    showToast(`✅ Created "${title}" with ${taskCount} task${taskCount === 1 ? '' : 's'}`);
    if (APP.currentProjectId) renderProjectDetail(APP.currentProjectId); else renderProjects();
    updateSidebar();
    maybeNudgePushReminders();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to create project'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// A goal's tasks only get overdue/due-today/focus-nudge pushes if the
// account already has Push Reminders on — easy to miss since it's a
// separate opt-in from creating the goal itself. One soft, dismissible
// nudge right after creation beats silently getting zero follow-through.
async function maybeNudgePushReminders() {
  try {
    const profile = await API.getProfile();
    if (profile.pushRemindersEnabled) return;
    document.getElementById('push-nudge-banner').classList.remove('hidden');
  } catch (e) { /* non-critical — skip the nudge rather than surface an error for it */ }
}

function dismissPushNudgeBanner() {
  document.getElementById('push-nudge-banner').classList.add('hidden');
}

async function enablePushRemindersFromNudge() {
  try {
    await enablePushReminders();
    dismissPushNudgeBanner();
    showToast('✅ Push reminders turned on');
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to turn on push reminders'), 'error');
  }
}

const REVISE_LABELS = {
  updateTask: 'Change task',
  addTask: 'Add task',
  moveTask: 'Move task',
  deleteTask: 'Delete task',
  renamePhase: 'Rename phase',
  addPhase: 'Add phase',
  addBlocker: 'Add blocker',
  updateBlocker: 'Change blocker',
  removeBlocker: 'Remove blocker',
  addPredecessor: 'Add predecessor',
  removePredecessor: 'Remove predecessor',
};

const REVISE_FIELD_LABELS = { startDate: 'start', endDate: 'due', targetCount: 'target', targetUnit: 'target unit' };

function describeReviseOp(op) {
  if (op.type === 'updateTask') {
    const fields = { ...op.fields };
    // Show a target as one change ("target → 20 pages"), not two.
    if (fields.targetCount && fields.targetUnit) { fields.targetCount = `${fields.targetCount} ${fields.targetUnit}`; delete fields.targetUnit; }
    const changes = Object.entries(fields).map(([k, v]) => `${REVISE_FIELD_LABELS[k] || k} → ${v || 'none'}`).join(', ');
    return `"${esc(op.currentTitle)}": ${esc(changes)}`;
  }
  if (op.type === 'addTask') return `"${esc(op.task.title)}" (${esc(op.task.priority)}${op.task.endDate ? ', due ' + esc(op.task.endDate) : ''})`;
  if (op.type === 'deleteTask') return `"${esc(op.currentTitle)}" (moves to Trash, where you can restore it)`;
  if (op.type === 'addPredecessor') return `"${esc(op.taskTitle)}" waits for "${esc(op.predecessorTitle)}" to finish`;
  if (op.type === 'removePredecessor') return `"${esc(op.taskTitle)}" no longer waits for "${esc(op.predecessorTitle)}"`;
  if (op.type === 'moveTask') return `"${esc(op.currentTitle)}" to "${esc(op.toPhaseTitle)}"`;
  if (op.type === 'renamePhase') return `to "${esc(op.title)}"`;
  if (op.type === 'addBlocker') return `${icon('blocker')} "${esc(op.blocker.name)}" ×${op.blocker.count} on "${esc(op.taskTitle)}"`;
  if (op.type === 'removeBlocker') return `${icon('blocker')} "${esc(op.currentName)}" from "${esc(op.taskTitle)}"`;
  if (op.type === 'updateBlocker') {
    const changes = Object.entries(op.changes).map(([k, v]) => k === 'resolved' ? (v ? 'ticked off as cleared' : 'back to pending') : `${k} → ${k === 'count' ? '×' + v : v}`).join(', ');
    return `${icon('blocker')} "${esc(op.currentName)}" on "${esc(op.taskTitle)}": ${esc(changes)}`;
  }
  return `"${esc(op.title)}" with ${op.tasks.length} task${op.tasks.length === 1 ? '' : 's'}`;
}

// Applies reviewed operations through the same endpoints the manual UI uses,
// so permissions and validation still apply. Shared by the revise panel and
// the assistant.
async function applyOperations(projectId, ops) {
  for (const op of ops) {
    if (op.type === 'updateTask') {
      await API.updateTask(op.taskId, op.fields);
    } else if (op.type === 'moveTask') {
      await API.updateTask(op.taskId, { projectId: op.toPhaseId });
    } else if (op.type === 'deleteTask') {
      await API.deleteTask(op.taskId);
    } else if (op.type === 'addTask') {
      await API.addTask({ ...op.task, projectId: op.phaseId });
    } else if (op.type === 'renamePhase') {
      await API.updateProject(op.phaseId, { title: op.title });
    } else if (op.type === 'addPhase') {
      const phase = await API.addProject({ title: op.title, parentId: projectId });
      for (const task of op.tasks) await API.addTask({ ...task, projectId: phase.id });
    } else if (op.type === 'addBlocker') {
      await API.addObstacle(op.taskId, op.blocker.name, op.blocker.count);
    } else if (op.type === 'updateBlocker') {
      await API.updateObstacle(op.blockerId, op.changes);
    } else if (op.type === 'removeBlocker') {
      await API.deleteObstacle(op.blockerId);
    } else if (op.type === 'addPredecessor' || op.type === 'removePredecessor') {
      // The endpoint replaces the whole list, so read the current one first
      // (an earlier op in this batch may have changed it).
      const task = await API.getTask(op.taskId);
      const ids = (task.predecessors || []).map(p => p.id).filter(id => id !== op.predecessorId);
      if (op.type === 'addPredecessor') ids.push(op.predecessorId);
      await API.setPredecessors(op.taskId, ids);
    }
  }
}

// ── WAYPOINT ASSISTANT ─────────────────────────────────────────
// One conversation that can propose a new goal or changes to the open project.
// Every proposal is shown for approval; the assistant never writes on its own.
const ASSISTANT_SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let assistantRecognition = null;

// Opening the assistant picks up the latest chat for the same project (or
// the latest general one), so closing the window never loses a
// conversation; 🕘 History lists every saved chat, ＋ New starts one.
// Each exchange is saved to the server (see saveAssistantChat).
async function openAssistant(projectId, opts = {}) {
  APP.assistantProjectId = projectId || null;
  APP.assistantTaskId = opts.taskId || null;
  APP.assistantTaskTitle = opts.taskTitle || '';
  clearAssistantAttachment();
  document.getElementById('assistant-input').value = '';
  document.getElementById('assistant-mic').classList.toggle('hidden', !ASSISTANT_SpeechRecognition);
  let speak = false;
  let autoSend = false;
  try {
    speak = localStorage.getItem('assistantSpeak') === '1';
    autoSend = localStorage.getItem('assistantAutoSend') === '1';
  } catch {}
  document.getElementById('assistant-speak').checked = speak;
  document.getElementById('assistant-autosend').checked = autoSend;
  showAssistantPane('chat');
  updateAssistantContext();
  openModal('modal-assistant');
  let resumed = false;
  try {
    const latest = (await API.getAssistantConversations()).find(c => (c.projectId || null) === APP.assistantProjectId);
    if (latest) resumed = await loadAssistantConversation(latest.id, { keepFocus: true });
  } catch { /* offline or signed out: a fresh chat still works */ }
  if (!resumed) startNewAssistantChat({ keepFocus: true });
  document.getElementById('assistant-input').focus();
}

// From a project or task page: a sub-folder's plan lives in its top-level
// project, so the assistant works on that, focused on the task if any.
async function openAssistantFor({ projectId = null, taskId = null, taskTitle = '' } = {}) {
  let pid = projectId;
  if (pid) {
    try { const p = await API.getProject(pid); if (p.parentId) pid = p.parentId; } catch { /* keep the id we have */ }
  }
  return openAssistant(pid, { taskId, taskTitle });
}
async function askAIAboutTask(taskId) {
  const id = taskId || document.getElementById('task-id').value;
  if (!id) return;
  let task;
  try { task = await API.getTask(id); } catch (e) { showToast('❌ ' + (e.message || 'Could not open that task'), 'error'); return; }
  closeModal('modal-task');
  if (!document.getElementById('task-detail-panel').classList.contains('translate-x-full')) closeTaskDetail();
  openAssistantFor({ projectId: task.projectId, taskId: task.id, taskTitle: task.title });
}
function askAIAboutProject() {
  const id = document.getElementById('proj-id').value;
  if (!id) return;
  closeModal('modal-project');
  openAssistantFor({ projectId: id });
}

const newAssistantId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
function assistantGreeting() {
  if (APP.assistantTaskId) return `What would you like to do with "${APP.assistantTaskTitle}"? I can change it, split it up, add a blocker, or delete it. Nothing changes until you approve it.`;
  if (APP.assistantProjectId) return 'What would you like to change in this project? I can add, edit, move or delete tasks. Nothing changes until you approve it.';
  return 'Hi! Tell me what you want to achieve, or what to change. You can type or tap the mic.';
}
function startNewAssistantChat({ keepFocus = false } = {}) {
  if (!keepFocus) { APP.assistantTaskId = null; APP.assistantTaskTitle = ''; }
  APP.assistantConversationId = newAssistantId();
  APP.assistantMessages = [];
  showAssistantPane('chat');
  document.getElementById('assistant-chat').innerHTML = '';
  updateAssistantContext();
  renderAssistantWelcome();
  renderAssistantSuggestions();
}
// A fresh chat opens on a welcome card: what the assistant can do here and
// four one-tap starters. It goes as soon as the first message is sent.
function renderAssistantWelcome() {
  const wrap = document.getElementById('assistant-chat');
  const el = document.createElement('div');
  el.className = 'asst-welcome';
  el.innerHTML = `<span class="asst-mark" style="margin:0 auto;width:48px;height:48px;border-radius:16px" aria-hidden="true"><svg viewBox="0 0 24 24" style="width:26px;height:26px"><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/></svg></span>
    <h4>${APP.assistantTaskId ? 'About this task' : APP.assistantProjectId ? 'Shape this project' : 'What are we working towards?'}</h4>
    <p>${esc(assistantGreeting())}</p>
    <div class="asst-starters">${assistantIdeas().slice(0, 4).map(([ideaIcon, text]) =>
      `<button type="button" class="asst-starter" onclick="useAssistantSuggestion(this.dataset.text)" data-text="${esc(text)}"><span aria-hidden="true">${emojiIcon(ideaIcon)}</span>${esc(text)}</button>`).join('')}</div>`;
  wrap.appendChild(el);
}
function clearAssistantWelcome() {
  document.querySelector('#assistant-chat .asst-welcome')?.remove();
}
async function loadAssistantConversation(id, { keepFocus = false } = {}) {
  const convo = await API.getAssistantConversation(id);
  if (!convo) return false;
  if (!keepFocus) { APP.assistantTaskId = null; APP.assistantTaskTitle = ''; }
  APP.assistantConversationId = convo.id;
  APP.assistantProjectId = convo.projectId || null;
  APP.assistantMessages = convo.messages.map(m => ({ ...m, content: m.content || (m.attachmentName ? `(attached ${m.attachmentName})` : '') }));
  showAssistantPane('chat');
  const wrap = document.getElementById('assistant-chat');
  wrap.innerHTML = '';
  convo.messages.forEach(m => {
    if (m.role === 'user') assistantBubble('user', (m.attachmentName ? 'Attached: ' + m.attachmentName + (m.content ? '\n' : '') : '') + (m.content || ''));
    else {
      assistantBubble('assistant', m.content);
      if (m.kind === 'edits') assistantNote('These were suggested changes. Ask again to see them to approve.');
    }
  });
  if (APP.assistantTaskId) assistantBubble('assistant', assistantGreeting());
  updateAssistantContext();
  renderAssistantSuggestions();
  return true;
}
function assistantNote(text) {
  const wrap = document.getElementById('assistant-chat');
  const el = document.createElement('p');
  el.className = 'asst-note';
  el.textContent = text;
  wrap.appendChild(el);
}
// Saves the whole chat after each exchange; file contents are never kept,
// only their names.
function saveAssistantChat() {
  if (!APP.assistantConversationId || !APP.assistantMessages.some(m => m.role === 'user')) return;
  const messages = APP.assistantMessages.map(m => ({ role: m.role, content: m.content, kind: m.kind, attachmentName: m.attachment ? m.attachment.name : m.attachmentName }));
  API.saveAssistantConversation(APP.assistantConversationId, { projectId: APP.assistantProjectId, messages }).catch(() => { /* the chat itself still works */ });
}
function updateAssistantContext() {
  document.getElementById('assistant-context').textContent = APP.assistantProjectId
    ? 'Working on this project. Changes are shown for approval first.'
    : 'Create a goal, or ask for changes. Nothing changes until you approve it.';
  const focus = document.getElementById('assistant-focus');
  focus.classList.toggle('hidden', !APP.assistantTaskId);
  focus.classList.toggle('flex', !!APP.assistantTaskId);
  document.getElementById('assistant-focus-text').textContent = APP.assistantTaskId ? `About the task "${APP.assistantTaskTitle}"` : '';
}
function clearAssistantFocus() {
  APP.assistantTaskId = null; APP.assistantTaskTitle = '';
  updateAssistantContext();
  renderAssistantSuggestions();
}
// One-tap starters that fit where the assistant was opened from.
function assistantIdeas() {
  return APP.assistantTaskId
    ? [['✂️', 'Split it into smaller tasks'], ['📅', 'Push the due date back a week'], ['🎯', 'Set a target count for it'], ['🔗', 'Make it wait on another task'], ['🧱', 'Add a blocker to it'], ['🗑️', 'Delete this task']]
    : APP.assistantProjectId
      ? [['🧭', 'What should I do next?'], ['➕', 'Add any missing tasks'], ['🔗', 'Link tasks in the right order'], ['📅', 'Spread the due dates out'], ['🗑️', 'Delete tasks I no longer need']]
      : [['✨', 'Plan a new goal for me'], ['📋', 'Help me prioritise this week'], ['🏃', 'Plan a 10k training block'], ['🎓', 'Plan my exam revision']];
}
// The chips above the input stay hidden while the welcome card shows the
// same starters.
function renderAssistantSuggestions() {
  const box = document.getElementById('assistant-suggestions');
  const welcome = document.querySelector('#assistant-chat .asst-welcome');
  box.classList.toggle('hidden', !!welcome);
  box.innerHTML = welcome ? '' : assistantIdeas().map(([, text]) =>
    `<button type="button" onclick="useAssistantSuggestion(this.textContent)" class="asst-chip">${esc(text)}</button>`).join('');
}
function useAssistantSuggestion(text) {
  const input = document.getElementById('assistant-input');
  input.value = text;
  sendAssistantMessage();
}
function showAssistantPane(which) {
  const history = which === 'history';
  document.getElementById('assistant-chat').classList.toggle('hidden', history);
  document.getElementById('assistant-history').classList.toggle('hidden', !history);
  document.getElementById('assistant-composer').classList.toggle('hidden', history);
  document.getElementById('assistant-focus').classList.toggle('invisible', history);
  document.getElementById('assistant-history-btn').classList.toggle('text-teal', history);
}
// 🕘 History: every saved chat, newest first, with its project; tap one to
// carry on where it left off.
async function toggleAssistantHistory() {
  if (!document.getElementById('assistant-history').classList.contains('hidden')) { showAssistantPane('chat'); return; }
  showAssistantPane('history');
  const box = document.getElementById('assistant-history');
  box.innerHTML = '<p class="text-sm text-gray-400 px-2 py-6 text-center">Loading your chats…</p>';
  let list = [];
  try { list = await API.getAssistantConversations(); } catch (e) { box.innerHTML = `<p class="text-sm text-red-500 px-2 py-6 text-center">${esc(e.message || 'Could not load your chats')}</p>`; return; }
  if (!list.length) { box.innerHTML = '<p class="text-sm text-gray-400 px-2 py-8 text-center">No saved chats yet. Your conversations will show up here.</p>'; return; }
  const when = iso => {
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  box.innerHTML = '<p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-2">Your chats</p>' + list.map(c => `
    <div class="group flex items-start gap-2 rounded-xl px-3 py-2.5 mb-1 cursor-pointer hover:bg-gray-50 ${c.id === APP.assistantConversationId ? 'bg-teal/5 ring-1 ring-teal/30' : ''}" onclick="openSavedAssistantChat('${c.id}')">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-navy truncate">${esc(c.title || 'New chat')}</p>
        <p class="text-xs text-gray-400 truncate">${c.projectTitle ? icon('folder', 'tiny mr-0.5') + esc(c.projectTitle) + ' · ' : ''}${esc(when(c.updatedAt))} · ${c.count} message${c.count === 1 ? '' : 's'}</p>
        ${c.preview ? `<p class="text-xs text-gray-500 truncate mt-0.5">${esc(c.preview)}</p>` : ''}
      </div>
      <button onclick="event.stopPropagation(); deleteSavedAssistantChat('${c.id}')" title="Delete this chat" aria-label="Delete this chat" class="text-gray-300 hover:text-red-500 px-1 text-sm flex-shrink-0">${icon('trash')}</button>
    </div>`).join('');
}
async function openSavedAssistantChat(id) {
  try { await loadAssistantConversation(id); } catch (e) { showToast('❌ ' + (e.message || 'Could not open that chat'), 'error'); }
}
function deleteSavedAssistantChat(id) {
  confirmAction('Delete this chat? This can\'t be undone.', async () => {
    try { await API.deleteAssistantConversation(id); } catch (e) { showToast('❌ ' + (e.message || 'Could not delete that chat'), 'error'); return; }
    if (id === APP.assistantConversationId) startNewAssistantChat();
    showAssistantPane('chat');
    toggleAssistantHistory();
  });
}

function closeAssistant() {
  if (assistantRecognition) assistantRecognition.stop();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  closeModal('modal-assistant');
}

function assistantBubble(role, text) {
  const wrap = document.getElementById('assistant-chat');
  const el = document.createElement('div');
  el.className = 'asst-msg ' + (role === 'user' ? 'user' : 'assistant');
  el.textContent = text;
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
  return el;
}

function setAssistantAutoSend(on) {
  try { localStorage.setItem('assistantAutoSend', on ? '1' : '0'); } catch {}
}

function setAssistantSpeak(on) {
  try { localStorage.setItem('assistantSpeak', on ? '1' : '0'); } catch {}
  if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
}

// Resolves when the reply has finished being spoken (or straight away when
// speech is off), so the microphone can reopen without picking up the reply.
// Replies are spoken when the user asked for it, and always after a spoken
// message, so a voice conversation talks back without extra setup.
// Some browsers drop long utterances or never fire their end event, so the
// reply is spoken sentence by sentence and a timer always resolves the wait.
function speakAssistant(text) {
  return new Promise(resolve => {
    const wanted = document.getElementById('assistant-speak').checked || APP.assistantVoiceTurn;
    if (!wanted || !('speechSynthesis' in window) || !text.trim()) return resolve();
    const sentences = (text.match(/[^.!?]+[.!?]*/g) || [text]).map(s => s.trim()).filter(Boolean);
    let finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(guard); resolve(); } };
    const guard = setTimeout(finish, Math.max(4000, text.length * 90 + 3000));
    speechSynthesis.cancel();
    sentences.forEach((sentence, i) => {
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = navigator.language || 'en-US';
      if (i === sentences.length - 1) {
        utterance.onend = finish;
        utterance.onerror = finish;
      }
      speechSynthesis.speak(utterance);
    });
  });
}

// Hands-free: after a spoken message, keep listening for the next one.
// Waits a moment after the reply so the microphone doesn't hear the end of it.
function resumeAssistantListening() {
  setTimeout(() => {
    const open = document.getElementById('modal-assistant').classList.contains('open');
    if (open && APP.assistantVoiceTurn && document.getElementById('assistant-autosend').checked && !assistantRecognition) {
      toggleAssistantListening();
    }
  }, 1000);
}

// While the mic is on, a listening panel (a pulsing orb and moving sound
// bars, like Shazam's) shows above the box with the words as they're
// heard, and the mic button glows red; tap either to stop.
//
// Wireless earbuds (AirPods and the like) only switch their microphone on
// when a page opens it, which takes a second or two; speech recognition
// started straight away hears nothing in that gap and gives up. So the
// mic is opened first ("Connecting your microphone…"), given a moment,
// and on most browsers held open while listening so the earbuds stay on
// their mic (iPhone and iPad only allow one at a time, so there it's
// released before listening starts). Listening carries on through short
// pauses and stops after you've finished talking; if nothing at all was
// heard at the start, it quietly tries once more before giving up.
const ASSISTANT_IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ASSISTANT_MIC_ERRORS = {
  'not-allowed': 'Microphone access is blocked for this site. Allow it in your browser (the padlock or ⓘ next to the address), then tap the mic again.',
  'service-not-allowed': 'Speech recognition isn\'t allowed in this browser. Try Chrome, Edge or Safari, or type instead.',
  'audio-capture': 'I couldn\'t find a microphone. Check your earbuds or headset are connected and chosen as the input, then try again.',
  'no-speech': 'I didn\'t hear anything. With wireless earbuds, wait a second after tapping the mic, then speak. You can always type instead.',
  'network': 'Speech recognition needs an internet connection. Check you\'re online, or type instead.',
};
let assistantMicStream = null;
function releaseAssistantMic() {
  if (assistantMicStream) { assistantMicStream.getTracks().forEach(t => t.stop()); assistantMicStream = null; }
}
function setAssistantListeningUI(on, status = 'Speak now') {
  document.getElementById('assistant-mic').classList.toggle('is-listening', on);
  document.getElementById('assistant-mic').setAttribute('aria-label', on ? 'Stop listening' : 'Speak');
  document.getElementById('assistant-listening').classList.toggle('is-on', on);
  document.getElementById('assistant-suggestions').classList.toggle('hidden', on);
  if (on) document.getElementById('assistant-listening-text').textContent = status;
}
async function toggleAssistantListening() {
  if (!ASSISTANT_SpeechRecognition) return;
  if (assistantRecognition) { assistantRecognition.stop(); return; }
  if (APP.assistantMicStarting) return;
  APP.assistantMicStarting = true;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setAssistantListeningUI(true, 'Connecting your microphone…');
  if (navigator.vibrate) navigator.vibrate(30);
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (ASSISTANT_IS_IOS) stream.getTracks().forEach(t => t.stop()); else assistantMicStream = stream;
      await new Promise(r => setTimeout(r, 700)); // earbuds switching to their mic
    } catch (e) {
      APP.assistantMicStarting = false;
      setAssistantListeningUI(false);
      const key = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'not-allowed' : e && (e.name === 'NotFoundError' || e.name === 'NotReadableError') ? 'audio-capture' : null;
      assistantBubble('assistant', key ? ASSISTANT_MIC_ERRORS[key] : 'I couldn\'t open the microphone. You can type instead.');
      return;
    }
  }
  APP.assistantMicStarting = false;
  // closed while the mic was waking up
  if (!document.getElementById('modal-assistant').classList.contains('open')) { releaseAssistantMic(); setAssistantListeningUI(false); return; }
  const input = document.getElementById('assistant-input');
  listenForAssistant(input, input.value ? input.value + ' ' : '', 1);
}
function listenForAssistant(input, base, retriesLeft) {
  const rec = new ASSISTANT_SpeechRecognition();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  let heard = '', errorCode = null, retrying = false, silence = null;
  const rawStop = rec.stop.bind(rec);
  // stop once there's been a pause after some words, or if nothing comes at all
  const armSilence = ms => { clearTimeout(silence); silence = setTimeout(() => { try { rawStop(); } catch { /* already stopped */ } }, ms); };
  rec.onstart = () => { setAssistantListeningUI(true, 'Speak now'); armSilence(9000); };
  rec.onresult = e => {
    heard = Array.from(e.results).map(r => r[0].transcript).join('');
    input.value = base + heard;
    document.getElementById('assistant-listening-text').textContent = heard || 'Speak now';
    armSilence(1800);
  };
  rec.onerror = e => { errorCode = e && e.error; };
  rec.onend = () => {
    clearTimeout(silence);
    // nothing heard at the very start (earbuds still waking up): one quiet retry
    if (!heard.trim() && (errorCode === 'no-speech' || !errorCode) && retriesLeft > 0 && assistantRecognition === rec && !rec.stoppedByUser) {
      retrying = true;
      assistantRecognition = null;
      setAssistantListeningUI(true, 'Still listening… speak now');
      listenForAssistant(input, base, retriesLeft - 1);
      return;
    }
    if (!retrying) {
      assistantRecognition = null;
      releaseAssistantMic();
      setAssistantListeningUI(false);
      if (errorCode && errorCode !== 'aborted' && !heard.trim()) assistantBubble('assistant', ASSISTANT_MIC_ERRORS[errorCode] || 'I could not hear that. You can type instead.');
      else if (!heard.trim() && !rec.stoppedByUser) assistantBubble('assistant', ASSISTANT_MIC_ERRORS['no-speech']);
      if (document.getElementById('assistant-autosend').checked && input.value.trim()) sendAssistantMessage(true);
    }
  };
  rec.stop = () => { rec.stoppedByUser = true; rawStop(); }; // a tap on Stop (or closing the window)
  assistantRecognition = rec;
  try { rec.start(); } catch { assistantRecognition = null; releaseAssistantMic(); setAssistantListeningUI(false); assistantBubble('assistant', 'I couldn\'t start listening. Try again, or type instead.'); }
}

// Reads an attached plan, spreadsheet, or photo into the message, the same way
// the old goal chat did, so the assistant can build a goal from it.
async function onAssistantFileSelected(file) {
  if (!file) return;
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  if (!CHAT_ATTACHMENT_MIME_FALLBACK[ext]) { assistantBubble('assistant', 'Unsupported file type. Attach a .xlsx, .pdf, .png, or .jpg.'); clearAssistantFileInput(); return; }
  if (file.size > 15 * 1024 * 1024) { assistantBubble('assistant', 'That file is too large (max 15MB).'); clearAssistantFileInput(); return; }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
  APP.assistantAttachment = { name: file.name, mimetype: file.type || CHAT_ATTACHMENT_MIME_FALLBACK[ext], dataBase64: dataUrl.split(',')[1] };
  document.getElementById('assistant-attachment-name').textContent = file.name;
  document.getElementById('assistant-attachment-chip').classList.remove('hidden');
  document.getElementById('assistant-attachment-chip').classList.add('flex');
}

function clearAssistantFileInput() {
  document.getElementById('assistant-file-input').value = '';
}

function clearAssistantAttachment() {
  APP.assistantAttachment = null;
  clearAssistantFileInput();
  document.getElementById('assistant-attachment-chip').classList.add('hidden');
  document.getElementById('assistant-attachment-chip').classList.remove('flex');
}

async function sendAssistantMessage(viaVoice = false) {
  const input = document.getElementById('assistant-input');
  const text = input.value.trim();
  const attachment = APP.assistantAttachment;
  if (!text && !attachment) return;
  APP.assistantVoiceTurn = viaVoice;
  input.value = '';
  const message = { role: 'user', content: text };
  if (attachment) message.attachment = attachment;
  APP.assistantMessages.push(message);
  clearAssistantWelcome();
  renderAssistantSuggestions();
  assistantBubble('user', (attachment ? 'Attached: ' + attachment.name + (text ? '\n' : '') : '') + text);
  clearAssistantAttachment();
  const sendBtn = document.getElementById('assistant-send');
  input.disabled = true;
  sendBtn.disabled = true;
  const thinking = assistantBubble('assistant', '');
  thinking.innerHTML = '<span class="asst-typing" role="status" aria-label="Thinking"><i></i><i></i><i></i></span>';
  try {
    const res = await fetch('/api/ai/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: APP.assistantMessages, projectId: APP.assistantProjectId, taskId: APP.assistantTaskId, today: localDateKey(new Date()) }),
    });
    const body = await res.json();
    thinking.remove();
    if (!res.ok) throw new Error(body.error || 'The assistant could not respond');
    if (body.type === 'message') {
      APP.assistantMessages.push({ role: 'assistant', content: body.text });
      saveAssistantChat();
      assistantBubble('assistant', body.text);
      speakAssistant(body.text).then(resumeAssistantListening);
    } else if (body.type === 'proposal') {
      const title = body.proposal.title || 'your goal';
      APP.assistantMessages.push({ role: 'assistant', content: `I drafted a goal: ${title}.`, kind: 'proposal' });
      saveAssistantChat();
      assistantBubble('assistant', `I've drafted "${title}". Review it, then create it when you're happy.`);
      speakAssistant(`I've drafted ${title}. Review it, then create it when you're happy.`);
      closeModal('modal-assistant');
      openModal('modal-import');
      showImportPreview(body.proposal);
    } else if (body.type === 'edits') {
      renderAssistantEdits(body);
    } else if (body.type === 'music') {
      renderAssistantMusic(body);
    } else if (body.type === 'actions') {
      APP.assistantMessages.push({ role: 'assistant', content: body.text });
      saveAssistantChat();
      const bubble = assistantBubble('assistant', body.text);
      speakAssistant(body.text).then(resumeAssistantListening);
      Jarvis.handle(body, bubble);
    }
  } catch (e) {
    thinking.remove();
    saveAssistantChat(); // keep what was asked, even when the reply failed
    assistantBubble('assistant', (e.message || 'Something went wrong. Try again.'));
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// The assistant and your music (Your why): it plays a saved playlist, or
// offers to add a link you pasted to your library. Adding waits for a tap.
function renderAssistantMusic(body) {
  APP.assistantMessages.push({ role: 'assistant', content: body.text });
  saveAssistantChat();
  const el = assistantBubble('assistant', body.text);
  speakAssistant(body.text);
  if (body.action === 'play') { Why.playMusic(body.index || 0); return; }
  const row = document.createElement('div');
  row.className = 'asst-music-actions';
  if (body.action === 'save') {
    row.innerHTML = `<button type="button" class="asst-music-yes">${icon('plus')}Add to my music and play</button><button type="button" class="asst-music-no">Not now</button>`;
    row.querySelector('.asst-music-yes').onclick = async () => {
      row.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        const i = await Why.addPlaylist(body.url, body.label);
        row.innerHTML = `<span class="asst-music-done">${icon('check')}Added to your music</span>`;
        Why.playMusic(Math.max(0, i));
      } catch (e) { showToast('❌ ' + (e.message || 'Could not save it'), 'error'); row.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
    };
    row.querySelector('.asst-music-no').onclick = () => row.remove();
  } else {
    row.innerHTML = `<button type="button" class="asst-music-yes">${icon('music')}Add music in Your why</button>`;
    row.querySelector('.asst-music-yes').onclick = () => { closeModal('modal-assistant'); showPage('why'); };
  }
  el.appendChild(row);
}

function renderAssistantEdits(body) {
  APP.assistantEdits = body.operations;
  const summary = body.summary || 'Here are the changes I suggest.';
  APP.assistantMessages.push({ role: 'assistant', content: summary, kind: 'edits' });
  saveAssistantChat();
  const wrap = document.getElementById('assistant-chat');
  const card = document.createElement('div');
  card.className = 'asst-changes';
  const n = body.operations.length;
  const rows = body.operations.map((op, i) => `
    <label class="asst-change">
      <input type="checkbox" class="assistant-check" data-op-index="${i}" checked>
      <span class="min-w-0">
        <span class="kind">${REVISE_LABELS[op.type]}</span>
        <span class="block">${describeReviseOp(op)}</span>
      </span>
    </label>`).join('');
  card.innerHTML = `<p class="font-semibold">${esc(summary)}</p>` + (n
    ? `<p class="text-xs text-gray-500 -mt-1">${n} suggested change${n === 1 ? '' : 's'}. Untick any you don't want.</p>` + rows + '<button onclick="applyAssistantEdits(this)" class="asst-apply">Apply selected</button>'
    : '<p class="text-gray-500">Nothing needed changing. Tell me more about what to change.</p>');
  wrap.appendChild(card);
  wrap.scrollTop = wrap.scrollHeight;
  speakAssistant(summary).then(resumeAssistantListening);
}

async function applyAssistantEdits(btn) {
  const card = btn.closest('div');
  const ops = Array.from(card.querySelectorAll('.assistant-check:checked')).map(c => APP.assistantEdits[Number(c.dataset.opIndex)]);
  if (!ops.length) { showToast('Tick at least one change to apply'); return; }
  btn.disabled = true;
  btn.textContent = 'Applying…';
  const projectId = APP.assistantProjectId;
  try {
    await applyOperations(projectId, ops);
    btn.remove();
    card.querySelectorAll('input').forEach(i => { i.disabled = true; });
    assistantBubble('assistant', `Applied ${ops.length} change${ops.length === 1 ? '' : 's'}.`);
    if (APP.currentProjectId === projectId) renderProjectDetail(projectId);
    updateSidebar();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Apply selected';
    showToast('❌ ' + (e.message || 'Some changes could not be applied'), 'error');
  }
}

// ── REFERRALS (invite friends, earn AI credits) ─────────────────
let referralLink = '';

async function loadReferralCard() {
  try {
    const r = await API.getReferral();
    // Shown on whatever address this app is actually served from.
    referralLink = r.link.replace(/^https?:\/\/[^/]+/, location.origin);
    document.getElementById('referral-link').value = referralLink;
    document.getElementById('referral-stats').textContent =
      `${r.joined} joined · ${r.rewarded} rewarded · ${r.bonusCredits} bonus credits · ${r.invitesLeftToday} invites left today`;
    document.getElementById('referral-share-btn').classList.toggle('hidden', !navigator.share);
  } catch {
    // The card stays empty if the server can't be reached; nothing else depends on it.
  }
}

async function copyReferralLink() {
  try {
    await navigator.clipboard.writeText(referralLink);
    showToast('✅ Link copied');
  } catch {
    document.getElementById('referral-link').select();
    showToast('Press Ctrl+C to copy the link');
  }
}

async function shareReferralLink() {
  try {
    await navigator.share({ title: 'Waypoint', text: 'Join me on Waypoint', url: referralLink });
  } catch {
    // Cancelled by the user; nothing to report.
  }
}

async function sendReferralInvite() {
  const input = document.getElementById('referral-email');
  const status = document.getElementById('referral-status');
  const btn = document.getElementById('referral-send');
  const email = input.value.trim();
  if (!email) { status.textContent = 'Enter an email address.'; return; }
  btn.disabled = true;
  status.textContent = 'Sending…';
  try {
    const r = await API.sendReferralInvite(email);
    input.value = '';
    status.textContent = `Invite sent. ${r.invitesLeftToday} left today.`;
    loadReferralCard();
  } catch (e) {
    status.textContent = '' + (e.message || 'Could not send the invite');
  } finally {
    btn.disabled = false;
  }
}

// A friend's invite link opens the app with ?ref=CODE. Keep the code until
// they sign up, so the signup can credit whoever invited them.
try {
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref) localStorage.setItem('waypointRef', ref);
} catch {}
