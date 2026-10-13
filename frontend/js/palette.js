/* global APP, API, esc, showPage, openAddTask, openAddProject, openAssistant, toggleTheme, showToast,
   sendAssistantMessage, openTaskDetail, openWeeklyRecap, setJourneyTheme, localDateKey, formatDateShort,
   renderTaskTable, openProgressReport */
// ── COMMAND PALETTE (⌘K / Ctrl+K) ──────────────────────────────
// One box to do anything, like Linear, Raycast or Notion: jump to any
// page, project or task, run an action, add a task straight from what you
// typed, or hand it to the assistant. Arrow keys to move, Enter to run,
// Esc to close. Also opened from the ⌘ button in the top bar.

const PALETTE_PAGES = [
  ['dashboard', '🏠', 'Dashboard'], ['gantt', '📊', 'Planner'], ['actions', '✅', 'Actions'],
  ['calendar', '📅', 'Calendar'], ['chats', '💬', 'Chats'], ['projects', '📁', 'All projects'], ['settings', '⚙️', 'Settings'],
];
const PALETTE_STAGES = [['football', '⚽', 'Football'], ['space', '🚀', 'Space'], ['castle', '🏰', 'Castle'], ['construction', '🏗️', 'Construction']];

let paletteData = { projects: [], tasks: [] };
let paletteItems = [];
let paletteIndex = 0;

// How well `query` matches `text`: every word must appear (any order);
// earlier and word-start matches rank higher. 0 means no match.
function paletteScore(text, query) {
  const hay = text.toLowerCase();
  let score = 1;
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = hay.indexOf(word);
    if (at < 0) return 0;
    score += 10 - Math.min(at, 9) + (at === 0 || hay[at - 1] === ' ' ? 5 : 0);
  }
  return score;
}

function paletteActions() {
  const here = APP.currentPage === 'project-detail' ? APP.currentProjectId : undefined;
  return [
    { icon: '➕', label: here ? 'New task in this project' : 'New task', hint: 'N', run: () => openAddTask(here) },
    { icon: '📁', label: 'New project', run: () => { showPage('projects'); openAddProject(); } },
    { icon: '🧩', label: 'New project from a template', run: () => { showPage('projects'); openAddProject(); } },
    { icon: '✨', label: 'Open the assistant', hint: 'A', run: () => openAssistant(here) },
    { icon: '🎬', label: 'My week in review', run: () => openWeeklyRecap() },
    { icon: '❤️', label: 'Your why: what keeps you going', run: () => showPage('why') },
    { icon: '⏱', label: 'Start a 25-minute focus session', run: () => Jarvis.startFocus({ minutes: 25, music: true }) },
    { icon: '🔊', label: "Read today's briefing out loud", run: () => { showPage('dashboard'); setTimeout(() => Jarvis.hear(), 900); } },
    { icon: '🎤', label: 'Talk to the assistant', hint: 'J', run: () => Jarvis.talk() },
    ...(window.Voice && Voice.setEnabled ? [{ icon: Voice.enabled() ? '🔇' : '🔊', label: Voice.enabled() ? "Turn the assistant's voice off" : "Turn the assistant's voice on", run: () => Voice.setEnabled(!Voice.enabled()) }] : []),
    { icon: '🔊', label: "Change the assistant's voice", run: () => { showPage('settings'); setTimeout(() => showSettingsTab('appearance'), 200); } },
    ...(window.Music && Music.isPlaying() ? [{ icon: '🎵', label: Music.isPaused() ? 'Play the music' : 'Pause the music', hint: 'M', run: () => Music.togglePause() }] : []),
    ...(window.Why && Why.get() ? Why.get().playlists.map((p, i) => ({ icon: '🎵', label: `Play ${p.label || 'my music'}`, run: () => Why.playMusic(i) })) : []),
    ...(here ? [{ icon: '📄', label: 'Progress report for this project', run: () => openProgressReport(here) }] : []),
    { icon: '🌗', label: 'Switch light / dark mode', run: () => toggleTheme() },
    { icon: '⌨️', label: 'Keyboard shortcuts', hint: '?', run: () => showToast('⌨️ Shortcuts: ⌘K command palette · / search · n new task · a assistant · Esc close') },
    ...PALETTE_PAGES.map(([id, icon, name]) => ({ icon, label: `Go to ${name}`, run: () => showPage(id) })),
    ...PALETTE_STAGES.map(([id, icon, name]) => ({ icon, label: `Journey stage: ${name}`, run: () => { setJourneyTheme(id); showPage('gantt'); document.querySelector('#gantt-page-view-toggle [data-pageview="journey"]')?.click(); } })),
  ];
}

function buildPaletteItems(query) {
  const q = query.trim();
  const items = [];
  const add = (group, list, cap) => {
    const ranked = q ? list.map(it => ({ ...it, score: paletteScore(it.label, q) })).filter(it => it.score > 0).sort((a, b) => b.score - a.score) : list;
    ranked.slice(0, cap).forEach(it => items.push({ ...it, group }));
  };
  add('Actions', paletteActions(), q ? 6 : 7);
  add('Projects', paletteData.projects.map(p => ({ icon: p.icon || '📁', label: p.title, sub: p.parentTitle || '', run: () => showPage('project-detail', p.id) })), q ? 5 : 4);
  if (q) {
    add('Tasks', paletteData.tasks.map(t => ({
      icon: t.status === 'Completed' ? '✅' : '◻️', label: t.title, sub: [t.projectTitle, t.endDate ? `due ${formatDateShort(t.endDate)}` : ''].filter(Boolean).join(' · '),
      run: () => openTaskDetail(t.id),
    })), 6);
    // Nothing has to match: what was typed can always become a task, or a
    // request to the assistant.
    const here = APP.currentPage === 'project-detail' ? APP.currentProjectId : null;
    items.push({ group: 'Create', icon: '⚡', label: `Add task “${q}”${here ? ' to this project' : ''}`, run: () => paletteQuickAdd(q, here) });
    items.push({ group: 'Create', icon: '✨', label: `Ask the assistant: “${q}”`, run: () => paletteAsk(q, here) });
  }
  return items;
}

// Quick add: into the open project, else the first project you have. A
// trailing "today", "tomorrow" or "next week" becomes the due date.
async function paletteQuickAdd(text, projectId) {
  let title = text;
  let due = '';
  const when = { today: 0, tomorrow: 1, 'next week': 7 };
  for (const [word, days] of Object.entries(when)) {
    const m = title.match(new RegExp(`\\s+(${word})$`, 'i'));
    if (m) { title = title.slice(0, m.index); const d = new Date(); d.setDate(d.getDate() + days); due = localDateKey(d); break; }
  }
  const target = projectId || (paletteData.projects.find(p => !p.parentId && p.canEdit) || {}).id;
  if (!target) { openAddTask(); return; }
  try {
    const task = await API.addTask({ projectId: target, title: title.trim(), endDate: due, startDate: due });
    showToast(`⚡ Added “${task.title}”${due ? ` (due ${formatDateShort(due)})` : ''}`);
    if (APP.currentPage === 'project-detail' && typeof renderTaskTable === 'function') renderTaskTable(APP.currentProjectId);
  } catch (e) { showToast('❌ ' + (e.message || 'Could not add the task'), 'error'); }
}
function paletteAsk(text, projectId) {
  openAssistant(projectId || undefined);
  setTimeout(() => {
    const input = document.getElementById('assistant-input');
    if (!input) return;
    input.value = text;
    sendAssistantMessage();
  }, 400);
}

function renderPalette() {
  const list = document.getElementById('palette-list');
  if (!paletteItems.length) { list.innerHTML = '<p class="px-4 py-6 text-sm text-gray-400 text-center">Nothing matches</p>'; return; }
  let group = '';
  list.innerHTML = paletteItems.map((it, i) => {
    const head = it.group !== group ? `<p class="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">${esc((group = it.group))}</p>` : '';
    return `${head}<button type="button" role="option" id="palette-opt-${i}" aria-selected="${i === paletteIndex}" data-i="${i}"
      class="palette-item w-full flex items-center gap-3 px-4 py-2 text-left text-sm">
      <span class="w-5 flex justify-center flex-shrink-0">${emojiIcon(it.icon)}</span>
      <span class="min-w-0 flex-1"><span class="block truncate font-medium">${esc(it.label)}</span>${it.sub ? `<span class="block truncate text-[11px] text-gray-400">${esc(it.sub)}</span>` : ''}</span>
      ${it.hint ? `<kbd class="text-[10px] font-mono text-gray-400 border border-gray-200 rounded px-1.5">${esc(it.hint)}</kbd>` : ''}
    </button>`;
  }).join('');
  document.getElementById('palette-input').setAttribute('aria-activedescendant', `palette-opt-${paletteIndex}`);
  document.getElementById(`palette-opt-${paletteIndex}`)?.scrollIntoView({ block: 'nearest' });
}

function updatePalette() {
  paletteItems = buildPaletteItems(document.getElementById('palette-input').value);
  paletteIndex = 0;
  renderPalette();
}

function runPaletteItem(i) {
  const it = paletteItems[i];
  if (!it) return;
  closePalette();
  it.run();
}

async function openPalette() {
  API.trackFeature('palette');
  let wrap = document.getElementById('palette');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'palette';
    wrap.className = 'fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 pt-[12vh]';
    wrap.innerHTML = `
      <div class="palette-panel w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="flex items-center gap-3 px-4 border-b border-gray-100">
          <span class="text-gray-400">⌘</span>
          <input id="palette-input" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-list"
            placeholder="Search, jump to, or type a new task…" class="flex-1 py-4 text-base bg-transparent focus:outline-none">
          <kbd class="text-[10px] font-mono text-gray-400 border border-gray-200 rounded px-1.5">Esc</kbd>
        </div>
        <div id="palette-list" role="listbox" class="max-h-[60vh] overflow-y-auto pb-2"></div>
        <p class="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">↑↓ to move · Enter to run · type anything to add it as a task or ask the assistant</p>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) closePalette(); });
    wrap.querySelector('#palette-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-i]');
      if (btn) runPaletteItem(Number(btn.dataset.i));
    });
    const input = wrap.querySelector('#palette-input');
    input.addEventListener('input', updatePalette);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        paletteIndex = (paletteIndex + (e.key === 'ArrowDown' ? 1 : -1) + paletteItems.length) % Math.max(paletteItems.length, 1);
        renderPalette();
      } else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(paletteIndex); }
      else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    });
  }
  wrap.classList.remove('hidden');
  const input = document.getElementById('palette-input');
  input.value = '';
  updatePalette();
  input.focus();
  // Fresh projects and tasks each time it opens (quick, and never stale).
  try {
    const [projects, tasks] = await Promise.all([API.getProjects(), API.getTasks()]);
    const byId = Object.fromEntries(projects.map(p => [p.id, p]));
    paletteData = {
      projects: projects.map(p => ({ ...p, parentTitle: p.parentId && byId[p.parentId] ? byId[p.parentId].title : '', canEdit: p.role === 'owner' || p.role === 'editor' })),
      tasks: tasks.map(t => ({ ...t, projectTitle: (byId[t.projectId] || {}).title || '' })),
    };
    if (!wrap.classList.contains('hidden')) { const keep = paletteIndex; updatePalette(); paletteIndex = Math.min(keep, paletteItems.length - 1); renderPalette(); }
  } catch { /* actions still work without the lists */ }
}
function closePalette() {
  document.getElementById('palette')?.classList.add('hidden');
}

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const open = document.getElementById('palette') && !document.getElementById('palette').classList.contains('hidden');
    if (open) closePalette(); else if (!document.querySelector('.auth-overlay.open')) openPalette();
  }
});
