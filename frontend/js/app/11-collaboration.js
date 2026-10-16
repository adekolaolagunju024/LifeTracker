// KolaWay app, part 11 of 12: Sharing, chats, tags and checklists.
// The parts load in order as plain scripts from index.html (see the list
// there) and share one global scope, exactly as when they were one file.

// ── PROJECT SHARING (Google-Sheets-style collaborators) ───────────
async function openShareProject(projectId) {
  const p = await API.getProject(projectId);
  // The modal can now be opened for a project other than whatever page is
  // currently showing (e.g. from the chat panel) — remember which project
  // it's actually for, rather than assuming APP.currentProjectId.
  APP.shareModalProjectId = projectId;
  document.getElementById('share-project-title').textContent = '— ' + p.title;
  document.getElementById('share-email-input').value = '';
  document.getElementById('share-error').classList.add('hidden');
  // Only the owner can invite/remove people — a member sees a read-only list.
  document.getElementById('share-invite-section').classList.toggle('hidden', p.role !== 'owner');
  openModal('modal-share');
  renderShareCollaborators(projectId);
}

function presenceDot(lastActiveAt) {
  const active = lastActiveAt && (Date.now() - new Date(lastActiveAt).getTime()) < 5 * 60 * 1000;
  return `<span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${active ? '#22C55E' : '#D1D5DB'}" title="${active ? 'Active now' : 'Away'}"></span>`;
}

const ROLE_LABEL = { viewer: 'Viewer', commenter: 'Commenter', editor: 'Editor', owner: 'Owner' };

async function renderShareCollaborators(projectId) {
  const wrap = document.getElementById('share-collaborators-list');
  try {
    const [people, project] = await Promise.all([API.getCollaborators(projectId), API.getProject(projectId)]);
    const isOwner = project.role === 'owner';
    wrap.innerHTML = people.map(person => {
      const isMe = person.userId === APP.currentUserId;
      const canManage = isOwner && person.role !== 'owner';
      const pending = person.role !== 'owner' && !person.joinedAt;
      if (person.pendingSignup) {
        return `
        <div class="flex items-center gap-3 py-2">
          <span class="w-2 h-2 rounded-full flex-shrink-0 bg-amber-400" title="Waiting for them to sign up"></span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-navy truncate">${esc(person.email)}</p>
            <p class="text-xs text-gray-400 truncate">Invited · waiting for them to join KolaWay</p>
          </div>
          <span class="text-xs font-semibold text-gray-500 flex-shrink-0">${ROLE_LABEL[person.role] || person.role}</span>
          ${isOwner ? `<button onclick="cancelEmailInviteConfirm('${projectId}','${esc(person.email)}')" class="text-gray-300 hover:text-red-500 text-xs px-1 flex-shrink-0" title="Cancel invite" aria-label="Cancel the invite to ${esc(person.email)}">${icon('close')}</button>` : ''}
        </div>`;
      }
      const roleControl = canManage
        ? `<select onchange="changeCollaboratorRole('${projectId}','${person.userId}',this.value)" class="text-xs border border-gray-200 rounded-lg px-1.5 py-1 focus:outline-none focus:border-teal flex-shrink-0">
             <option value="viewer" ${person.role === 'viewer' ? 'selected' : ''}>Viewer</option>
             <option value="commenter" ${person.role === 'commenter' ? 'selected' : ''}>Commenter</option>
             <option value="editor" ${person.role === 'editor' ? 'selected' : ''}>Editor</option>
           </select>`
        : `<span class="text-xs font-semibold text-gray-500 flex-shrink-0">${ROLE_LABEL[person.role] || person.role}</span>`;
      return `
        <div class="flex items-center gap-3 py-2">
          ${presenceDot(person.lastActiveAt)}
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-navy truncate">${esc(person.name && person.name !== 'Your Name' ? person.name : person.email)}${isMe ? ' (you)' : ''}</p>
            <p class="text-xs text-gray-400 truncate">${esc(person.email)}${pending ? ' · Invited — pending' : ''}</p>
          </div>
          ${roleControl}
          ${canManage ? `<button onclick="removeCollaboratorConfirm('${projectId}','${person.userId}','${esc(person.name)}')" class="text-gray-300 hover:text-red-500 text-xs px-1 flex-shrink-0" title="Remove">${icon('trash')}</button>` : ''}
        </div>`;
    }).join('');
  } catch (e) { console.error('Collaborators error:', e); }
}

async function changeCollaboratorRole(projectId, userId, role) {
  try {
    await API.updateCollaboratorRole(projectId, userId, role);
    showToast('✅ Role updated');
    renderShareCollaborators(projectId);
    if (APP.currentProjectId === projectId) renderProjectDetail(projectId);
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to update role'), 'error');
    renderShareCollaborators(projectId);
  }
}

async function submitInviteCollaborator() {
  const input = document.getElementById('share-email-input');
  const errorEl = document.getElementById('share-error');
  errorEl.classList.add('hidden');
  const email = input.value.trim();
  if (!email) return;
  const role = document.getElementById('share-role-select').value;
  const projectId = APP.shareModalProjectId;
  try {
    const invite = await API.inviteCollaborator(projectId, email, role);
    input.value = '';
    showToast(invite.pendingSignup ? `✉️ ${email} doesn't have an account yet${invite.emailed ? ', so we emailed them an invite to join' : '. Share the app with them and the invite will be waiting when they sign up'}` : '✅ Invited ' + email);
    renderShareCollaborators(projectId);
  } catch (e) {
    errorEl.textContent = e.message || 'Failed to invite';
    errorEl.classList.remove('hidden');
  }
}

function cancelEmailInviteConfirm(projectId, email) {
  confirmAction(`Cancel the invite to ${email}?`, async () => {
    try { await API.cancelEmailInvite(projectId, email); showToast('Invite cancelled'); renderShareCollaborators(projectId); }
    catch (e) { showToast('❌ ' + (e.message || 'Failed to cancel'), 'error'); }
  });
}

function removeCollaboratorConfirm(projectId, userId, name) {
  confirmAction(`Remove ${name} from this project? They'll lose access immediately.`, async () => {
    try {
      await API.removeCollaborator(projectId, userId);
      showToast('Removed ' + name);
      renderShareCollaborators(projectId);
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to remove'), 'error'); }
  });
}

// ── CHATS INBOX (WhatsApp-style list of every shared project's chat) ──
function chatPreviewTime(iso) {
  const d = new Date(iso);
  const today = localDateKey(new Date());
  if (localDateKey(d) === today) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

async function renderChats() {
  const wrap = document.getElementById('chats-list');
  try {
    const [allChats, races] = await Promise.all([API.getChatPreviews(), API.listRaces().catch(() => [])]);
    // A "Split the work" team's goal is shared with the team, so it would
    // show twice: once here as a team, once as a shared project. It's the team.
    const teamGoals = new Set(races.filter(r => r.mode === 'split').flatMap(r => [r.goalId, ...r.players.filter(p => p.you).map(p => p.projectId)]).filter(Boolean));
    const chats = allChats.filter(c => !teamGoals.has(c.projectId));
    // Races and groups first: each has its own chat (js/race.js).
    const raceRows = races.slice().sort((a, b) => ((b.chat && b.chat.last && b.chat.last.createdAt) || b.startsAt || '').localeCompare((a.chat && a.chat.last && a.chat.last.createdAt) || a.startsAt || '')).map(r => {
      const last = r.chat && r.chat.last;
      return `<button onclick="Race.openChat('${r.id}')" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 text-left">
          <span class="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0 bg-teal/10 text-teal">${icon((r.mode === 'together' || r.mode === 'split') ? 'users' : 'flag')}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <p class="font-bold text-sm text-navy truncate">${esc(r.title)} <span class="font-semibold text-gray-400">· ${r.mode === 'split' ? 'Team' : r.mode === 'together' ? 'Group' : 'Race'}</span></p>
              ${last ? `<span class="text-[10px] text-gray-400 flex-shrink-0">${chatPreviewTime(last.createdAt)}</span>` : ''}
            </div>
            <p class="text-xs text-gray-500 truncate mt-0.5">${last ? esc(last.text) : '<span class="text-gray-400">No messages yet. Wish everyone luck</span>'}</p>
          </div>
          ${r.chat && r.chat.unread ? `<span class="rc-unread" aria-label="${r.chat.unread} unread">${r.chat.unread > 9 ? '9+' : r.chat.unread}</span>` : ''}
        </button>`;
    }).join('');
    wrap.innerHTML = (raceRows ? `<p class="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Teams and races</p>${raceRows}${chats.length ? '<p class="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">Shared projects</p>' : ''}` : '') + (chats.length
      ? chats.map(c => {
          const last = c.lastMessage;
          const preview = last
            ? `${last.isMe ? 'You: ' : ''}${esc(last.text || 'Attachment')}`
            : `<span class="text-gray-400">No messages yet — say hi ${icon('hand')}</span>`;
          return `
            <button onclick="openProjectChat('${c.projectId}')" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 text-left">
              <span class="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0" style="background:${c.color}1A">${emojiIcon(c.icon)}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <p class="font-bold text-sm text-navy truncate">${esc(c.title)}</p>
                  ${last ? `<span class="text-[10px] text-gray-400 flex-shrink-0">${chatPreviewTime(last.createdAt)}</span>` : ''}
                </div>
                <p class="text-xs text-gray-500 truncate mt-0.5">${preview}</p>
              </div>
            </button>`;
        }).join('')
      : raceRows ? '' : `<p class="text-center text-gray-400 text-sm py-10">No chats yet. Share a project (${icon('users')} Share), or Team up on a goal, to start chatting.</p>`);
    // Visiting the inbox is "reading your mail" — clears the unread badge,
    // same as opening the notification bell does.
    await API.markNotificationsRead();
    refreshNotificationBadge();
  } catch (e) { console.error('Chats inbox error:', e); }
}

// ── PROJECT CHAT (project-wide, polled for a "live" feel) ─────────
const CHAT_POLL_MS = 4000;
let chatPollTimer = null;

async function openProjectChat(projectId) {
  try {
    const proj = await API.getProject(projectId);
    // A "Split the work" team's goal: its chat is the team's (one place to
    // talk, with the team's events and nudges in it too).
    if (window.Race) {
      const team = await API.getRaceForProject(proj.parentId || proj.id).catch(() => null);
      if (team && team.mode === 'split') { Race.openChat(team.id); return; }
    }
    document.getElementById('team-chat-project-title').textContent = proj.title;
    const canComment = proj.role === 'owner' || proj.role === 'editor' || proj.role === 'commenter';
    document.getElementById('team-chat-input-box').classList.toggle('hidden', !canComment);
    document.getElementById('team-chat-viewonly').classList.toggle('hidden', canComment);
    APP.chatProjectId = projectId;
    APP.chatIsOwner = proj.role === 'owner';
    APP.chatCanComment = canComment;
    APP.chatCanEdit = proj.role === 'owner' || proj.role === 'editor';
    cancelChatReply();
    document.getElementById('project-chat-backdrop').classList.remove('hidden');
    document.getElementById('project-chat-panel').classList.remove('translate-x-full');
    // Cached once per panel-open rather than refetched per keystroke — the
    // @mention picker and the message-list mention highlighting both just
    // filter/match against this list client-side.
    try {
      const people = await API.getCollaborators(projectId);
      APP.chatPeopleNames = people.filter(p => p.joinedAt).map(p => p.name).filter(Boolean);
    } catch { APP.chatPeopleNames = []; }
    await renderProjectChat(projectId);
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(() => renderProjectChat(projectId), CHAT_POLL_MS);
  } catch (e) { console.error('Project chat error:', e); }
}

function closeProjectChat() {
  document.getElementById('project-chat-backdrop').classList.add('hidden');
  document.getElementById('project-chat-panel').classList.add('translate-x-full');
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  APP.chatProjectId = null;
  clearTeamChatAttachment();
  document.getElementById('chat-also-email').checked = false;
  document.getElementById('chat-cc-input').value = '';
  toggleChatEmailOptions();
  closeChatPlus();
}

// WhatsApp/iMessage-style bubbles: your own messages sit right-aligned in
// teal, everyone else's sit left-aligned in gray with their name + an
// initial avatar — so who sent what is obvious at a glance instead of
// having to read a "(you)" label on an otherwise identical row. Consecutive
// messages from the same sender only repeat the name/avatar once (grouped),
// same as any real chat app.
async function renderProjectChat(projectId) {
  const wrap = document.getElementById('team-chat-messages');
  // Don't yank the scroll position/focus out from under someone mid-read —
  // only auto-scroll to the bottom if they were already there.
  const wasAtBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 40;
  try {
    const messages = await API.getProjectMessages(projectId);
    const names = APP.chatPeopleNames || [];
    const dayKey = d => new Date(d).toDateString();
    const dayLabel = d => {
      const k = dayKey(d); const y = new Date(); y.setDate(y.getDate() - 1);
      return k === new Date().toDateString() ? 'Today' : k === y.toDateString() ? 'Yesterday' : new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    };
    wrap.innerHTML = messages.length
      ? messages.map((m, i) => {
          const newDay = !messages[i - 1] || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt);
          const isMe = m.userId === APP.currentUserId;
          const canDelete = isMe || APP.chatIsOwner;
          const prev = messages[i - 1];
          const showHeader = !prev || prev.userId !== m.userId || newDay;
          const time = new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          const initial = (m.authorName || '?').trim().charAt(0).toUpperCase();
          const replyQuote = m.replyToId ? `<div class="border-l-2 ${isMe ? 'border-white/40' : 'border-gray-300'} pl-1.5 mb-1 text-[10px] ${isMe ? 'text-white/70' : 'text-gray-400'} truncate max-w-[200px]">↩ ${esc(m.replyToAuthorName || 'a deleted message')}${m.replyToText ? ': ' + esc(m.replyToText.length > 40 ? m.replyToText.slice(0, 40) + '…' : m.replyToText) : ''}</div>` : '';
          return `${newDay ? `<div class="chat-day"><span>${dayLabel(m.createdAt)}</span></div>` : ''}
            <div class="group flex items-end gap-1.5 ${isMe ? 'justify-end' : 'justify-start'} ${showHeader ? 'mt-3' : 'mt-0.5'}">
              ${!isMe ? `<span class="w-6 h-6 rounded-full bg-teal/15 text-teal text-[10px] font-bold flex items-center justify-center flex-shrink-0 self-end ${showHeader ? '' : 'invisible'}" title="${esc(m.authorName)}">${esc(initial)}</span>` : ''}
              <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]">
                ${showHeader && !isMe ? `<p class="text-[10px] font-semibold text-gray-400 mb-0.5 ml-1">${esc(m.authorName)}</p>` : ''}
                <div class="rounded-2xl px-3.5 py-2 ${isMe ? 'bg-teal text-white rounded-br-md' : 'bg-gray-100 text-gray-700 rounded-bl-md'}">
                  ${replyQuote}
                  ${m.text ? `<p class="text-sm whitespace-pre-wrap break-words">${renderMentionText(m.text, names)}</p>` : ''}
                  ${renderAttachmentHTML(m)}
                </div>
                <p class="text-[9px] text-gray-400 mt-0.5 ${isMe ? 'mr-1' : 'ml-1'}">${isMe ? 'You · ' : ''}${time}</p>
              </div>
              ${APP.chatCanComment ? `<button onclick="replyToChatMessage('${m.id}','${esc(m.authorName).replace(/'/g, "\\'")}','${esc(m.text).replace(/'/g, "\\'")}')" class="text-gray-300 hover:text-teal text-xs opacity-0 group-hover:opacity-100 self-center flex-shrink-0" title="Reply">↩</button>` : ''}
              ${canDelete ? `<button onclick="deleteProjectChatMessageConfirm('${m.id}','${projectId}')" class="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 self-center flex-shrink-0">${icon('trash')}</button>` : ''}
            </div>`;
        }).join('')
      : `<p class="text-xs text-gray-400 text-center py-6">No messages yet — say hi ${icon('hand')}</p>`;
    if (wasAtBottom) wrap.scrollTop = wrap.scrollHeight;
  } catch (e) { console.error('Chat load error:', e); }
}

// ── REPLY (project chat) ────────────────────────────────────────────
let APP_chatReplyTo = null;
function replyToChatMessage(id, authorName, text) {
  APP_chatReplyTo = { id, authorName, text };
  document.getElementById('team-chat-reply-author').textContent = authorName;
  document.getElementById('team-chat-reply-snippet').textContent = text.length > 60 ? text.slice(0, 60) + '…' : text;
  document.getElementById('team-chat-reply-chip').classList.remove('hidden');
  document.getElementById('team-chat-reply-chip').classList.add('flex');
  document.getElementById('team-chat-input').focus();
}
function cancelChatReply() {
  APP_chatReplyTo = null;
  document.getElementById('team-chat-reply-chip').classList.add('hidden');
  document.getElementById('team-chat-reply-chip').classList.remove('flex');
}

// Picked from the "+" menu, pasted or dropped: uploads straight away and
// shows a preview (a thumbnail for photos and videos) until it's sent.
let chatPreviewUrl = null;
async function onTeamChatFileSelected(file) {
  if (!file || !APP.chatProjectId) return;
  const chip = document.getElementById('team-chat-attachment-chip');
  const thumb = document.getElementById('team-chat-attachment-thumb');
  const name = document.getElementById('team-chat-attachment-name');
  if (chatPreviewUrl) URL.revokeObjectURL(chatPreviewUrl);
  chatPreviewUrl = /^image\/|^video\//.test(file.type) ? URL.createObjectURL(file) : null;
  thumb.innerHTML = chatPreviewUrl ? (file.type.startsWith('video/') ? `<video src="${chatPreviewUrl}" muted></video>` : `<img src="${chatPreviewUrl}" alt="">`) : icon('paperclip');
  name.textContent = `Uploading ${file.name}…`;
  chip.classList.remove('hidden'); chip.classList.add('flex');
  APP.teamChatPendingAttachment = null;
  chatInputChanged();
  try {
    const attachment = await API.uploadAttachment(APP.chatProjectId, file);
    APP.teamChatPendingAttachment = attachment;
    name.textContent = attachment.originalName;
    document.getElementById('team-chat-input').focus();
  } catch (e) {
    clearTeamChatAttachment();
    showToast('❌ ' + (e.message || 'Failed to upload'), 'error');
  } finally {
    document.getElementById('team-chat-file-input').value = '';
    chatInputChanged();
  }
}

function clearTeamChatAttachment() {
  APP.teamChatPendingAttachment = null;
  if (chatPreviewUrl) { URL.revokeObjectURL(chatPreviewUrl); chatPreviewUrl = null; }
  document.getElementById('team-chat-attachment-chip').classList.add('hidden');
  document.getElementById('team-chat-attachment-chip').classList.remove('flex');
  chatInputChanged();
}

// The "+" menu.
function toggleChatPlus() {
  const menu = document.getElementById('chat-plus-menu');
  const open = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !open);
  document.getElementById('chat-plus').setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => document.addEventListener('click', closeChatPlusOutside), 0);
}
function closeChatPlus() {
  document.getElementById('chat-plus-menu')?.classList.add('hidden');
  document.getElementById('chat-plus')?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', closeChatPlusOutside);
}
function closeChatPlusOutside(e) { if (!e.target.closest('#chat-plus-menu, #chat-plus')) closeChatPlus(); }
function chatPick(inputId) { closeChatPlus(); document.getElementById(inputId).click(); }
function chatPaste(e) {
  const file = [...(e.clipboardData?.files || [])][0];
  if (file) { e.preventDefault(); onTeamChatFileSelected(file); }
}
// The box grows with what you type, and Send lights up when there's
// something to send.
function chatInputChanged() {
  const input = document.getElementById('team-chat-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight + 2, 140) + 'px';
  const btn = document.getElementById('chat-send');
  if (btn) btn.disabled = !input.value.trim() && !APP.teamChatPendingAttachment;
}
// Drop a photo or file anywhere on the chat.
(() => {
  const panel = document.getElementById('project-chat-panel');
  if (!panel) return;
  let depth = 0;
  panel.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files') && APP.chatCanComment) { depth++; panel.classList.add('chat-drop'); } });
  panel.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) panel.classList.remove('chat-drop'); });
  panel.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  panel.addEventListener('drop', e => {
    depth = 0; panel.classList.remove('chat-drop');
    const file = [...(e.dataTransfer?.files || [])][0];
    if (file && APP.chatCanComment) { e.preventDefault(); onTeamChatFileSelected(file); }
  });
})();

// Emailing a message is an opt-in per message (from the "+" menu), with an
// optional CC; most messages are just chat.
function chatToggleEmail(on) {
  const box = document.getElementById('chat-also-email');
  box.checked = on === undefined ? !box.checked : on;
  toggleChatEmailOptions();
}
function toggleChatEmailOptions() {
  const on = document.getElementById('chat-also-email').checked;
  document.getElementById('chat-cc-row').classList.toggle('hidden', !on);
  document.getElementById('chat-cc-row').classList.toggle('flex', on);
  const item = document.getElementById('chat-email-item');
  if (item) item.textContent = on ? "Don't email this" : 'Email this to the team';
}

async function submitProjectChatMessage() {
  const input = document.getElementById('team-chat-input');
  const text = input.value.trim();
  const attachment = APP.teamChatPendingAttachment;
  const projectId = APP.chatProjectId;
  const alsoEmail = document.getElementById('chat-also-email').checked;
  const ccEmails = document.getElementById('chat-cc-input').value.split(',').map(s => s.trim()).filter(Boolean);
  if ((!text && !attachment) || !projectId) return;
  try {
    const result = await API.addProjectMessage(projectId, text, attachment ? attachment.id : null, alsoEmail, ccEmails, APP_chatReplyTo?.id || null);
    API.trackFeature('chat');
    input.value = '';
    clearTeamChatAttachment();
    cancelChatReply();
    chatInputChanged();
    if (alsoEmail) {
      document.getElementById('chat-also-email').checked = false;
      document.getElementById('chat-cc-input').value = '';
      toggleChatEmailOptions();
      if (result.email?.sent) showToast(`✅ Sent — emailed ${result.email.recipients} ${result.email.recipients === 1 ? 'person' : 'people'}`);
      else showToast('⚠️ Posted to chat, but email failed: ' + (result.email?.reason || 'unknown error'), 'error');
    }
    await renderProjectChat(projectId);
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to send'), 'error'); }
}

function deleteProjectChatMessageConfirm(messageId, projectId) {
  confirmAction('Delete this message?', async () => {
    try {
      await API.deleteProjectMessage(messageId);
      renderProjectChat(projectId);
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to delete'), 'error'); }
  });
}

// TASK MODAL
async function openAddTask(projectId) {
  document.getElementById('modal-task-title').textContent = 'New Task';
  document.getElementById('task-delete-btn').classList.add('hidden');
  document.getElementById('task-ai-btn').classList.add('hidden');
  document.getElementById('task-id').value         = '';
  document.getElementById('task-title-in').value   = '';
  document.getElementById('task-status').value     = 'Not Started';
  document.getElementById('task-priority').value   = 'High';
  document.getElementById('task-start').value      = '';
  document.getElementById('task-end').value        = '';
  document.getElementById('task-cost').value       = '';
  document.getElementById('task-notes').value      = '';
  document.getElementById('task-recurrence').value = 'none';
  document.getElementById('task-target-count').value = '';
  document.getElementById('task-target-unit').value  = '';
  document.getElementById('task-progress-current-row').classList.add('hidden');
  document.getElementById('task-checklist-section').classList.add('hidden');
  APP.taskModalTagIds = [];
  await renderTaskTagPicker();
  await populateProjectSelect(projectId);
  await populateAssigneeSelect(projectId, '');
  openModal('modal-task');
}

async function editTask(id) {
  const t = await API.getTask(id);
  document.getElementById('modal-task-title').textContent = 'Edit Task';
  document.getElementById('task-delete-btn').classList.remove('hidden');
  document.getElementById('task-ai-btn').classList.remove('hidden');
  document.getElementById('task-id').value         = id;
  document.getElementById('task-title-in').value   = t.title;
  document.getElementById('task-status').value     = t.status;
  document.getElementById('task-priority').value   = t.priority;
  document.getElementById('task-start').value      = t.startDate || '';
  document.getElementById('task-end').value        = t.endDate || '';
  document.getElementById('task-cost').value       = t.cost || '';
  document.getElementById('task-notes').value      = t.notes || '';
  document.getElementById('task-recurrence').value = t.recurrence || 'none';
  document.getElementById('task-target-count').value = t.targetCount || '';
  document.getElementById('task-target-unit').value  = t.targetUnit || '';
  document.getElementById('task-progress-current').value = t.progressCount || 0;
  document.getElementById('task-progress-current-row').classList.toggle('hidden', !t.targetCount);
  document.getElementById('task-checklist-section').classList.remove('hidden');
  renderTaskChecklist(id);
  APP.taskModalTagIds = (t.tags || []).map(tag => tag.id);
  await renderTaskTagPicker();
  await populateProjectSelect(t.projectId);
  await populateAssigneeSelect(t.projectId, t.assigneeId || '');
  openModal('modal-task');
}

// ── TAGS (task modal picker) ────────────────────────────────────
async function renderTaskTagPicker() {
  const wrap = document.getElementById('task-tag-picker');
  try {
    const tags = await API.getTags();
    wrap.innerHTML = tags.length
      ? tags.map(tag => {
          const on = (APP.taskModalTagIds || []).includes(tag.id);
          return `<button type="button" onclick="toggleTaskModalTag('${tag.id}')"
            class="text-xs font-semibold px-2.5 py-1 rounded-full border transition-all"
            style="${on ? `background:${tag.color};border-color:${tag.color};color:#fff` : `background:transparent;border-color:${tag.color};color:${tag.color}`}">${esc(tag.label)}</button>`;
        }).join('')
      : `<p class="text-xs text-gray-400">No tags yet — create one below</p>`;
  } catch (e) { console.error('Tags error:', e); }
}

function toggleTaskModalTag(id) {
  APP.taskModalTagIds = APP.taskModalTagIds || [];
  const i = APP.taskModalTagIds.indexOf(id);
  if (i === -1) APP.taskModalTagIds.push(id); else APP.taskModalTagIds.splice(i, 1);
  renderTaskTagPicker();
}

async function createTagFromTaskModal() {
  const labelEl = document.getElementById('task-new-tag-label');
  const label = labelEl.value.trim();
  if (!label) return;
  const color = document.getElementById('task-new-tag-color').value;
  try {
    const tag = await API.addTag({ label, color });
    labelEl.value = '';
    APP.taskModalTagIds = APP.taskModalTagIds || [];
    APP.taskModalTagIds.push(tag.id);
    renderTaskTagPicker();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to create tag'), 'error'); }
}

// ── CHECKLIST (subtasks within a task) ──────────────────────────
async function renderTaskChecklist(taskId) {
  const wrap = document.getElementById('task-checklist-items');
  try {
    const items = await API.getChecklist(taskId);
    const done = items.filter(i => i.completed).length;
    document.getElementById('task-checklist-count').textContent = items.length ? `(${done}/${items.length})` : '';
    wrap.innerHTML = items.map(i => `
      <div class="flex items-center gap-2 group">
        <input type="checkbox" ${i.completed ? 'checked' : ''} onchange="toggleTaskChecklistItem('${i.id}', this.checked, '${taskId}')">
        <span class="flex-1 text-sm ${i.completed ? 'line-through text-gray-400' : 'text-navy'}">${esc(i.title)}</span>
        <button onclick="removeTaskChecklistItem('${i.id}', '${taskId}')" class="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 px-1">${icon('trash')}</button>
      </div>`).join('');
    refreshTaskListsAfterChecklistChange();
  } catch (e) { console.error('Checklist error:', e); }
}

async function addTaskChecklistItem() {
  const taskId = document.getElementById('task-id').value;
  const input = document.getElementById('task-checklist-input');
  const title = input.value.trim();
  if (!taskId || !title) return;
  await API.addChecklistItem(taskId, title);
  input.value = '';
  renderTaskChecklist(taskId);
}

async function toggleTaskChecklistItem(id, completed, taskId) {
  await API.updateChecklistItem(id, { completed });
  renderTaskChecklist(taskId);
}

async function removeTaskChecklistItem(id, taskId) {
  await API.deleteChecklistItem(id);
  renderTaskChecklist(taskId);
}

// The checklist badge shown on task rows/cards is only as fresh as the
// last full render — refresh whichever list is currently on screen after
// a checklist edit so the "n/m" count doesn't go stale while the modal's
// still open.
function refreshTaskListsAfterChecklistChange() {
  if (APP.currentPage === 'project-detail') renderTaskTable(APP.currentProjectId);
  if (APP.currentPage === 'gantt') renderGantt();
}

// Only relevant once a target is set — an already-open Edit form flips the
// current-progress row in/out live as the target is added or cleared,
// rather than requiring a reopen.
function onTaskTargetCountChange() {
  const hasTarget = !!document.getElementById('task-target-count').value;
  const row = document.getElementById('task-progress-current-row');
  row.classList.toggle('hidden', !hasTarget);
  if (hasTarget && !row.querySelector('input').value) row.querySelector('input').value = 0;
}

let _projectStartDates = {};

function onTaskProjectChange() {
  const projectId = document.getElementById('task-project').value;
  document.getElementById('task-start').min = _projectStartDates[projectId] || '';
  // Switching projects changes who can be assigned — a different project
  // may have a different (or no) set of collaborators.
  populateAssigneeSelect(projectId, '');
}

// Whoever has access to the project — owner plus accepted collaborators —
// is a valid assignee. Re-populated whenever the selected project changes.
async function populateAssigneeSelect(projectId, selectedId) {
  const sel = document.getElementById('task-assignee');
  if (!projectId) { sel.innerHTML = '<option value="">Unassigned</option>'; return; }
  try {
    const people = await API.getCollaborators(projectId);
    sel.innerHTML = '<option value="">Unassigned</option>' + people
      .filter(p => p.joinedAt) // exclude a pending (not-yet-accepted) invite
      .map(p => `<option value="${p.userId}" ${p.userId === selectedId ? 'selected' : ''}>${esc(p.name)}${p.userId === APP.currentUserId ? ' (you)' : ''}</option>`)
      .join('');
  } catch (e) {
    console.error('Assignee list error:', e);
    sel.innerHTML = '<option value="">Unassigned</option>';
  }
}

// Projects can have one level of sub-folders — group the dropdown by
// top-level project, with its sub-folders nested under it, so a task can be
// assigned either straight to a project or to one of its sub-folders.
async function populateProjectSelect(selectedId) {
  const allProjects = await API.getProjects();
  _projectStartDates = Object.fromEntries(allProjects.map(p => [p.id, p.startDate || '']));
  document.getElementById('task-start').min = _projectStartDates[selectedId] || '';

  document.getElementById('task-project').innerHTML = projectOptionsHTML(allProjects, selectedId);
  ProjectPicker.attach(document.getElementById('task-project'), allProjects);
}

async function saveTask() {
  const id = document.getElementById('task-id').value;

  const data = {
    projectId: document.getElementById('task-project').value,
    title:     document.getElementById('task-title-in').value.trim(),
    status:    document.getElementById('task-status').value,
    priority:  document.getElementById('task-priority').value,
    startDate: document.getElementById('task-start').value,
    endDate:   document.getElementById('task-end').value,
    cost:      parseFloat(document.getElementById('task-cost').value) || 0,
    notes:     document.getElementById('task-notes').value.trim(),
    recurrence: document.getElementById('task-recurrence').value,
    assigneeId: document.getElementById('task-assignee').value || null,
    targetCount: parseInt(document.getElementById('task-target-count').value, 10) || null,
    targetUnit: document.getElementById('task-target-unit').value.trim(),
    progressCount: parseInt(document.getElementById('task-progress-current').value, 10) || 0,
  };
  if (!data.title)     { showToast('Task title is required', 'error'); return; }
  if (!data.projectId) { showToast('Please select a project', 'error'); return; }
  try {
    let taskId = id;
    if (id) {
      const wasCompleted = (await API.getTask(id)).status === 'Completed';
      await API.updateTask(id, data);
      const justRecurred = !wasCompleted && data.status === 'Completed' && data.recurrence !== 'none';
      showToast(justRecurred ? '✅ Task completed — next occurrence scheduled' : '✅ Task updated');
    } else {
      const created = await API.addTask(data);
      taskId = created.id;
      showToast('✅ Task added');
    }
    await API.setTaskTags(taskId, APP.taskModalTagIds || []);
    closeModal('modal-task');
    if (APP.currentProjectId) renderTaskTable(APP.currentProjectId);
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  } catch (e) { taskErrorToast(e, 'Failed to save task', id ? { taskId: id, status: data.status } : {}); }
}

// Deleting a task is instant, with Undo in the toast (it goes to Trash, so
// nothing is lost either way), instead of an "are you sure?" first.
async function deleteTaskConfirm(id, projectId) {
  const t = await API.getTask(id).catch(() => null);
  try {
    await API.deleteTask(id);
  } catch (e) { showToast('❌ ' + (e.message || 'Could not delete the task'), 'error'); return; }
  if (APP_currentDetailTaskId === id) closeTaskDetail();
  refreshTaskViews(projectId);
  showUndoToast(`🗑️ "${t?.title || 'Task'}" moved to Trash`, async () => {
    await API.restoreTask(id);
    refreshTaskViews(projectId);
  });
}

// Non-destructive, so no confirmation needed — same instant feedback as
// any other quick action.
async function duplicateTaskAction(id, projectId) {
  try {
    await API.duplicateTask(id);
    showToast('✅ Task duplicated');
    if (projectId) renderTaskTable(projectId);
    if (APP.currentPage === 'gantt') renderGantt();
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to duplicate'), 'error'); }
}

// Logs one unit toward a task's progress target ("+1" tap) — refreshes
// whichever view is on screen, same pattern as every other quick action,
// and flags it when that tap just auto-completed the task.
async function bumpTaskProgressAction(id, delta, projectId) {
  try {
    const updated = await API.bumpTaskProgress(id, delta);
    showToast(updated.status === 'Completed' ? '🎉 Target reached — task completed!' : '✅ Progress logged');
    if (projectId) renderTaskTable(projectId);
    if (APP.currentPage === 'gantt') renderGantt();
    if (APP_currentDetailTaskId === id) openTaskDetail(id);
    updateSidebar();
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to log progress'), 'error'); }
}
