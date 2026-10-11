// Waypoint app, part 11 of 12: Sharing, chats, live calls, statuses, tags and checklists.
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

const ROLE_LABEL = { viewer: '👁 Viewer', commenter: '💬 Commenter', editor: '✏️ Editor', owner: '👑 Owner' };

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
            <p class="text-xs text-gray-400 truncate">Invited · waiting for them to join Waypoint</p>
          </div>
          <span class="text-xs font-semibold text-gray-500 flex-shrink-0">${ROLE_LABEL[person.role] || person.role}</span>
          ${isOwner ? `<button onclick="cancelEmailInviteConfirm('${projectId}','${esc(person.email)}')" class="text-gray-300 hover:text-red-500 text-xs px-1 flex-shrink-0" title="Cancel invite" aria-label="Cancel the invite to ${esc(person.email)}">✕</button>` : ''}
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
          ${canManage ? `<button onclick="removeCollaboratorConfirm('${projectId}','${person.userId}','${esc(person.name)}')" class="text-gray-300 hover:text-red-500 text-xs px-1 flex-shrink-0" title="Remove">🗑️</button>` : ''}
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
    const chats = await API.getChatPreviews();
    wrap.innerHTML = chats.length
      ? chats.map(c => {
          const last = c.lastMessage;
          const preview = last
            ? `${last.isMe ? 'You: ' : ''}${esc(last.text || '📎 Attachment')}`
            : `<span class="text-gray-400">No messages yet — say hi 👋</span>`;
          return `
            <button onclick="openProjectChat('${c.projectId}')" class="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 text-left">
              <span class="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0" style="background:${c.color}1A">${esc(c.icon)}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <p class="font-bold text-sm text-navy truncate">${esc(c.title)}</p>
                  ${last ? `<span class="text-[10px] text-gray-400 flex-shrink-0">${chatPreviewTime(last.createdAt)}</span>` : ''}
                </div>
                <p class="text-xs text-gray-500 truncate mt-0.5">${preview}</p>
              </div>
            </button>`;
        }).join('')
      : `<p class="text-center text-gray-400 text-sm py-10">No shared projects yet — share a project (👥 Share) or accept an invite to start chatting with your team.</p>`;
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
    document.getElementById('team-chat-project-title').textContent = proj.title;
    const canComment = proj.role === 'owner' || proj.role === 'editor' || proj.role === 'commenter';
    document.getElementById('team-chat-input-box').classList.toggle('hidden', !canComment);
    document.getElementById('team-chat-viewonly').classList.toggle('hidden', canComment);
    APP.chatProjectId = projectId;
    APP.chatIsOwner = proj.role === 'owner';
    APP.chatCanComment = canComment;
    APP.chatCanEdit = proj.role === 'owner' || proj.role === 'editor';
    APP.liveJoined = false;
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
    await Promise.all([renderProjectChat(projectId), renderStatusTray(projectId), checkLiveStatus(projectId)]);
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(() => { renderProjectChat(projectId); renderStatusTray(projectId); checkLiveStatus(projectId); }, CHAT_POLL_MS);
  } catch (e) { console.error('Project chat error:', e); }
}

function closeProjectChat() {
  document.getElementById('project-chat-backdrop').classList.add('hidden');
  document.getElementById('project-chat-panel').classList.add('translate-x-full');
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  APP.chatProjectId = null;
  clearTeamChatAttachment();
  closeStatusViewer();
  closeModal('modal-status-composer');
  document.getElementById('chat-also-email').checked = false;
  document.getElementById('chat-cc-input').value = '';
  document.getElementById('chat-cc-row').classList.add('hidden');
  // Closing the panel should stop your camera/mic immediately, not leave
  // a hidden iframe quietly still broadcasting.
  document.getElementById('live-video-iframe').src = '';
  APP.liveJoined = false;
}

// ── GO LIVE (embedded Jitsi Meet walkthrough) ──────────────────────
// Reuses the project's own chat for comments rather than a separate
// live-only comment stream — the video sits above the existing thread,
// which already has @mentions and replies.
async function checkLiveStatus(projectId) {
  try {
    const status = await API.getLiveStatus(projectId);
    const area = document.getElementById('live-session-area');
    const goLiveBtn = document.getElementById('btn-go-live');
    if (!status.live) {
      area.classList.add('hidden');
      area.classList.remove('flex');
      goLiveBtn.classList.toggle('hidden', !APP.chatCanEdit);
      document.getElementById('live-video-iframe').src = '';
      APP.liveJoined = false;
      return;
    }
    goLiveBtn.classList.add('hidden');
    area.classList.remove('hidden');
    area.classList.add('flex');
    document.getElementById('live-session-label').textContent = `${status.startedByName} is live`;
    document.getElementById('btn-end-live').classList.toggle('hidden', !APP.chatCanEdit);
    document.getElementById('btn-join-live').classList.toggle('hidden', APP.liveJoined);
    document.getElementById('live-video-wrap').classList.toggle('hidden', !APP.liveJoined);
    if (APP.liveJoined) {
      const iframe = document.getElementById('live-video-iframe');
      if (!iframe.src.includes(status.roomName)) iframe.src = `https://meet.jit.si/${status.roomName}`;
    }
  } catch (e) { console.error('Live status error:', e); }
}

async function startGoLive() {
  if (!APP.chatProjectId) return;
  try {
    await API.startLiveSession(APP.chatProjectId);
    APP.liveJoined = true; // starting it is intending to broadcast right away
    await checkLiveStatus(APP.chatProjectId);
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to go live'), 'error'); }
}

function joinGoLive() {
  APP.liveJoined = true;
  checkLiveStatus(APP.chatProjectId);
}

function endGoLiveConfirm() {
  if (!APP.chatProjectId) return;
  confirmAction('End the live session for everyone?', async () => {
    try {
      await API.endLiveSession(APP.chatProjectId);
      APP.liveJoined = false;
      await checkLiveStatus(APP.chatProjectId);
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to end'), 'error'); }
  });
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
    wrap.innerHTML = messages.length
      ? messages.map((m, i) => {
          const isMe = m.userId === APP.currentUserId;
          const canDelete = isMe || APP.chatIsOwner;
          const prev = messages[i - 1];
          const showHeader = !prev || prev.userId !== m.userId;
          const time = new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          const initial = (m.authorName || '?').trim().charAt(0).toUpperCase();
          const replyQuote = m.replyToId ? `<div class="border-l-2 ${isMe ? 'border-white/40' : 'border-gray-300'} pl-1.5 mb-1 text-[10px] ${isMe ? 'text-white/70' : 'text-gray-400'} truncate max-w-[200px]">↩ ${esc(m.replyToAuthorName || 'a deleted message')}${m.replyToText ? ': ' + esc(m.replyToText.length > 40 ? m.replyToText.slice(0, 40) + '…' : m.replyToText) : ''}</div>` : '';
          return `
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
              ${canDelete ? `<button onclick="deleteProjectChatMessageConfirm('${m.id}','${projectId}')" class="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 self-center flex-shrink-0">🗑️</button>` : ''}
            </div>`;
        }).join('')
      : `<p class="text-xs text-gray-400 text-center py-6">No messages yet — say hi 👋</p>`;
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

async function onTeamChatFileSelected(file) {
  if (!file || !APP.chatProjectId) return;
  try {
    const attachment = await API.uploadAttachment(APP.chatProjectId, file);
    APP.teamChatPendingAttachment = attachment;
    document.getElementById('team-chat-attachment-name').textContent = attachment.originalName;
    document.getElementById('team-chat-attachment-chip').classList.remove('hidden');
    document.getElementById('team-chat-attachment-chip').classList.add('flex');
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to upload'), 'error');
  } finally {
    document.getElementById('team-chat-file-input').value = '';
  }
}

function clearTeamChatAttachment() {
  APP.teamChatPendingAttachment = null;
  document.getElementById('team-chat-attachment-chip').classList.add('hidden');
  document.getElementById('team-chat-attachment-chip').classList.remove('flex');
}

// Toggling "Also email this" reveals an optional CC field — most messages
// are just chat, so this is an explicit opt-in per message, not a setting.
function toggleChatEmailOptions() {
  const on = document.getElementById('chat-also-email').checked;
  document.getElementById('chat-cc-row').classList.toggle('hidden', !on);
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
    input.value = '';
    clearTeamChatAttachment();
    cancelChatReply();
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

// ── STATUS TRAY (WhatsApp-style, per project, expires after 24h) ──
async function renderStatusTray(projectId) {
  const wrap = document.getElementById('status-tray');
  try {
    const groups = await API.getStatuses(projectId);
    APP.statusGroups = groups;
    APP.statusTrayProjectId = projectId;
    const myRing = APP.chatCanComment
      ? `<button onclick="openStatusComposer()" class="flex flex-col items-center gap-1 flex-shrink-0 w-14" title="Add status">
           <span class="w-12 h-12 rounded-full border-2 border-dashed border-teal text-teal flex items-center justify-center text-lg">➕</span>
           <span class="text-[10px] text-gray-500 truncate w-full text-center">You</span>
         </button>`
      : '';
    const rings = groups.map((g, i) => {
      const initial = (g.authorName || '?').trim().charAt(0).toUpperCase();
      const isMe = g.userId === APP.currentUserId;
      return `
        <button onclick="openStatusViewer(${i})" class="flex flex-col items-center gap-1 flex-shrink-0 w-14" title="${esc(g.authorName)}">
          <span class="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white" style="background:conic-gradient(#0A7E8C 0% 100%);padding:2px">
            <span class="w-full h-full rounded-full bg-teal flex items-center justify-center">${esc(initial)}</span>
          </span>
          <span class="text-[10px] text-gray-500 truncate w-full text-center">${isMe ? 'You' : esc(g.authorName.split(' ')[0])}</span>
        </button>`;
    }).join('');
    wrap.innerHTML = myRing + rings;
    wrap.classList.toggle('hidden', !myRing && !rings);
  } catch (e) { console.error('Status tray error:', e); }
}

// ── STATUS COMPOSER ────────────────────────────────────────────────
function openStatusComposer() {
  document.getElementById('status-text-input').value = '';
  clearStatusAttachment();
  openModal('modal-status-composer');
}

async function onStatusFileSelected(file) {
  if (!file || !APP.statusTrayProjectId) return;
  try {
    const attachment = await API.uploadAttachment(APP.statusTrayProjectId, file);
    APP.statusPendingAttachment = attachment;
    document.getElementById('status-file-picker-btn').classList.add('hidden');
    const wrap = document.getElementById('status-file-preview-wrap');
    wrap.classList.remove('hidden');
    wrap.classList.add('flex');
    const img = document.getElementById('status-file-preview-img');
    const video = document.getElementById('status-file-preview-video');
    const url = API.attachmentUrl(attachment.id);
    if (attachment.mimetype.startsWith('video/')) {
      video.src = url; video.classList.remove('hidden'); img.classList.add('hidden');
    } else {
      img.src = url; img.classList.remove('hidden'); video.classList.add('hidden');
    }
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed to upload'), 'error');
  } finally {
    document.getElementById('status-file-input').value = '';
  }
}

function clearStatusAttachment() {
  APP.statusPendingAttachment = null;
  document.getElementById('status-file-picker-btn').classList.remove('hidden');
  const wrap = document.getElementById('status-file-preview-wrap');
  wrap.classList.add('hidden');
  wrap.classList.remove('flex');
}

async function submitStatus() {
  const text = document.getElementById('status-text-input').value.trim();
  const attachment = APP.statusPendingAttachment;
  const projectId = APP.statusTrayProjectId;
  if ((!text && !attachment) || !projectId) return;
  try {
    await API.addStatus(projectId, text, attachment ? attachment.id : null);
    closeModal('modal-status-composer');
    showToast('✅ Status posted — visible for 24h');
    renderStatusTray(projectId);
  } catch (e) { showToast('❌ ' + (e.message || 'Failed to post status'), 'error'); }
}

// ── STATUS VIEWER (story-style, one author at a time) ──────────────
function openStatusViewer(authorIdx) {
  APP.statusViewerAuthorIdx = authorIdx;
  APP.statusViewerIdx = 0;
  document.getElementById('status-viewer').classList.remove('hidden');
  document.getElementById('status-viewer').classList.add('flex');
  renderStatusViewerCurrent();
}

function closeStatusViewer() {
  document.getElementById('status-viewer').classList.add('hidden');
  document.getElementById('status-viewer').classList.remove('flex');
}

function statusViewerPrev() {
  if (APP.statusViewerIdx > 0) { APP.statusViewerIdx--; renderStatusViewerCurrent(); return; }
  if (APP.statusViewerAuthorIdx > 0) { APP.statusViewerAuthorIdx--; APP.statusViewerIdx = APP.statusGroups[APP.statusViewerAuthorIdx].statuses.length - 1; renderStatusViewerCurrent(); return; }
  closeStatusViewer();
}

function statusViewerNext() {
  const group = APP.statusGroups[APP.statusViewerAuthorIdx];
  if (APP.statusViewerIdx < group.statuses.length - 1) { APP.statusViewerIdx++; renderStatusViewerCurrent(); return; }
  if (APP.statusViewerAuthorIdx < APP.statusGroups.length - 1) { APP.statusViewerAuthorIdx++; APP.statusViewerIdx = 0; renderStatusViewerCurrent(); return; }
  closeStatusViewer();
}

function renderStatusViewerCurrent() {
  const group = APP.statusGroups[APP.statusViewerAuthorIdx];
  const status = group.statuses[APP.statusViewerIdx];
  document.getElementById('status-viewer-avatar').textContent = (group.authorName || '?').trim().charAt(0).toUpperCase();
  document.getElementById('status-viewer-name').textContent = group.authorName + (group.userId === APP.currentUserId ? ' (you)' : '');
  document.getElementById('status-viewer-time').textContent = new Date(status.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  document.getElementById('status-viewer-caption').textContent = status.text || '';
  document.getElementById('status-viewer-caption').classList.toggle('hidden', !status.text);

  const progress = document.getElementById('status-viewer-progress');
  progress.innerHTML = group.statuses.map((_, i) =>
    `<div class="flex-1 h-1 rounded-full ${i <= APP.statusViewerIdx ? 'bg-white' : 'bg-white/30'}"></div>`).join('');

  const content = document.getElementById('status-viewer-content');
  if (status.attachmentId) {
    const url = API.attachmentUrl(status.attachmentId);
    content.innerHTML = (status.attachmentMimetype || '').startsWith('video/')
      ? `<video src="${url}" controls autoplay class="max-w-full max-h-full rounded-lg"></video>`
      : `<img src="${url}" class="max-w-full max-h-full rounded-lg object-contain">`;
  } else {
    content.innerHTML = `<p class="text-white text-2xl font-bold text-center px-8">${esc(status.text)}</p>`;
  }

  const canDelete = group.userId === APP.currentUserId || APP.chatIsOwner;
  const delBtn = document.getElementById('status-viewer-delete-btn');
  delBtn.classList.toggle('hidden', !canDelete);
  delBtn.dataset.statusId = status.id;
}

function deleteStatusFromViewer() {
  const statusId = document.getElementById('status-viewer-delete-btn').dataset.statusId;
  confirmAction('Delete this status?', async () => {
    try {
      await API.deleteStatus(statusId);
      closeStatusViewer();
      renderStatusTray(APP.statusTrayProjectId);
    } catch (e) { showToast('❌ ' + (e.message || 'Failed to delete'), 'error'); }
  });
}

// TASK MODAL
async function openAddTask(projectId) {
  document.getElementById('modal-task-title').textContent = 'New Task';
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
        <button onclick="removeTaskChecklistItem('${i.id}', '${taskId}')" class="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 px-1">🗑️</button>
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

  const topLevel = allProjects.filter(p => !p.parentId);
  const childrenOf = pid => allProjects.filter(p => p.parentId === pid);

  document.getElementById('task-project').innerHTML = topLevel.map(top => {
    const kids = childrenOf(top.id);
    const topOption = `<option value="${top.id}" ${top.id === selectedId ? 'selected' : ''}>${top.icon} ${esc(top.title)}</option>`;
    if (!kids.length) return topOption;
    const kidOptions = kids.map(k =>
      `<option value="${k.id}" ${k.id === selectedId ? 'selected' : ''}>${k.icon} ${esc(k.title)}</option>`
    ).join('');
    return `<optgroup label="${esc(top.title)}">${topOption}${kidOptions}</optgroup>`;
  }).join('');
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
  } catch (e) { taskErrorToast(e, 'Failed to save task'); }
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
