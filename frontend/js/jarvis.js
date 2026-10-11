/* global API, APP, esc, icon, showToast, showPage, openTaskDetail, Why, Music, localDateKey, openAssistant, toggleAssistantListening, Reminders, taskGateMessage, taskErrorToast, Sfx */
// ── YOUR PERSONAL ASSISTANT ─────────────────────────────────────
// The assistant as a personal assistant, not only a chat window: it briefs
// you each morning, acts around the app when you ask (backend/ai/day.js),
// runs focus sessions with your music and checks in when they end, and is
// one key away (J) on every page.
//
// It moves you around the app, starts focus sessions and plays music
// straight away. Anything that changes your data (finishing a task,
// setting a reminder, adding a task) comes back as a button you tap.
const Jarvis = (() => {
  const say = text => {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || 'en-GB';
    u.rate = 1.02;
    speechSynthesis.speak(u);
  };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ── Focus sessions ──
  // A countdown on one task (or none), with their music if they want it,
  // and a check-in at the end. Survives a reload.
  let focus = null;
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function startFocus({ taskId = null, title = '', minutes = 25, music = true } = {}) {
    stopFocus(true);
    const total = Math.min(90, Math.max(5, minutes)) * 60000;
    focus = { taskId, title, total, ends: Date.now() + total, paused: null };
    store.set('wp-focus', focus);
    if (music && window.Why) Why.playMusic().catch?.(() => {});
    paintFocus();
    showToast(`⏱ Focus for ${Math.round(total / 60000)} minutes${title ? `: ${title}` : ''}`);
  }
  function stopFocus(silent) {
    clearInterval(focus && focus.tick);
    focus = null;
    store.set('wp-focus', null);
    document.getElementById('focus-hud')?.remove();
    if (!silent) showToast('Focus session ended');
  }
  function togglePause() {
    if (!focus) return;
    if (focus.paused) { focus.ends = Date.now() + focus.paused; focus.paused = null; }
    else focus.paused = focus.ends - Date.now();
    store.set('wp-focus', { ...focus, tick: undefined });
    paintFocus();
  }
  function extend(minutes) {
    if (!focus) return;
    focus.total += minutes * 60000; focus.ends = Date.now() + minutes * 60000; focus.done = false;
    store.set('wp-focus', { ...focus, tick: undefined });
    paintFocus();
  }
  function paintFocus() {
    if (!focus) return;
    let hud = document.getElementById('focus-hud');
    if (!hud) { hud = document.createElement('div'); hud.id = 'focus-hud'; hud.setAttribute('role', 'timer'); document.body.appendChild(hud); }
    clearInterval(focus.tick);
    const draw = () => {
      if (!focus) return;
      const left = focus.paused != null ? focus.paused : focus.ends - Date.now();
      if (left <= 0 && !focus.done) { focus.done = true; finished(); return; }
      const pct = 1 - Math.max(0, left) / focus.total;
      const ring = hud.querySelector('.focus-ring-fg');
      if (ring) ring.style.strokeDashoffset = String(113.1 * (1 - pct));
      const t = hud.querySelector('.focus-time');
      if (t) t.textContent = fmt(left);
    };
    hud.className = 'focus-hud' + (focus.done ? ' is-done' : '');
    hud.innerHTML = focus.done ? `
      <div class="focus-hud-main">
        <p class="focus-kicker">Time</p>
        <p class="focus-title">${focus.title ? `Did you finish “${esc(focus.title)}”?` : 'Nice work. How did it go?'}</p>
        <div class="focus-actions">
          ${focus.taskId ? `<button type="button" class="focus-yes" onclick="Jarvis.focusDone()">${icon('check')}Done it</button>` : ''}
          <button type="button" onclick="Jarvis.extend(10)">${icon('plus')}10 more min</button>
          <button type="button" onclick="Jarvis.stopFocus()">Stop</button>
        </div>
      </div>` : `
      <svg class="focus-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" class="focus-ring-bg"/><circle cx="20" cy="20" r="18" class="focus-ring-fg" stroke-dasharray="113.1" stroke-dashoffset="113.1"/></svg>
      <div class="focus-hud-main" ${focus.taskId ? `onclick="openTaskDetail('${focus.taskId}')" role="button" tabindex="0"` : ''}>
        <p class="focus-kicker">${focus.paused != null ? 'Paused' : 'Focusing'}</p>
        <p class="focus-title">${esc(focus.title || 'Deep work')}</p>
      </div>
      <span class="focus-time">${fmt(focus.ends - Date.now())}</span>
      <button type="button" class="focus-btn" onclick="Jarvis.togglePause()" aria-label="${focus.paused != null ? 'Resume' : 'Pause'}">${icon(focus.paused != null ? 'play' : 'pause')}</button>
      <button type="button" class="focus-btn" onclick="Jarvis.stopFocus()" aria-label="End focus session">${icon('close')}</button>`;
    if (!focus.done) { draw(); focus.tick = setInterval(draw, 1000); }
  }
  function finished() {
    try { if (window.Sfx) Sfx.play('quest'); } catch { /* no sound */ }
    store.set('wp-focus', { ...focus, tick: undefined });
    paintFocus();
    say(focus.title ? `Time's up. Did you finish ${focus.title}?` : "Time's up. Nice work.");
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Focus session done', { body: focus.title ? `Did you finish “${focus.title}”?` : 'Nice work.' }); } catch { /* not allowed */ }
    }
  }
  async function focusDone() {
    if (!focus || !focus.taskId) return;
    const id = focus.taskId;
    try {
      const task = await API.getTask(id);
      const gate = taskGateMessage(task, 'Completed');
      if (gate) { showToast(gate, 'error'); return; }
      await API.updateTask(id, { status: 'Completed' });
      stopFocus(true);
      if (APP.currentPage === 'dashboard' && typeof renderDashboard === 'function') renderDashboard(); // eslint-disable-line no-undef
    } catch (e) { taskErrorToast(e, 'Could not finish that task'); }
  }
  function resumeFocus() {
    const saved = store.get('wp-focus');
    if (!saved || focus) return;
    if (!saved.paused && saved.ends < Date.now() - 6 * 3600000) { store.set('wp-focus', null); return; }
    focus = saved;
    paintFocus();
  }

  // ── Acting on the assistant's actions ──
  const WRITE = new Set(['complete_task', 'set_reminder', 'add_task']);
  function runNow(a) {
    if (a.type === 'open_page') showPage(a.page);
    else if (a.type === 'open_project') showPage('project-detail', a.projectId);
    else if (a.type === 'open_task') openTaskDetail(a.taskId);
    else if (a.type === 'start_focus') startFocus(a);
  }
  const whenText = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  const writeLabel = a => (a.type === 'complete_task' ? `Mark “${a.title}” done`
    : a.type === 'set_reminder' ? `Remind me about “${a.title}” · ${whenText(a.at)}`
      : `Add “${a.title}”${a.endDate ? ` · due ${a.endDate}` : ''}`);
  async function runWrite(a) {
    if (a.type === 'complete_task') {
      const task = await API.getTask(a.taskId);
      const gate = taskGateMessage(task, 'Completed');
      if (gate) throw new Error(gate.replace(/^\S+\s/, ''));
      await API.updateTask(a.taskId, { status: 'Completed' });
    } else if (a.type === 'set_reminder') {
      await API.setTaskReminder(a.taskId, { remindAt: a.at, nag: true });
      if (window.Reminders) Reminders.load();
    } else if (a.type === 'add_task') {
      const today = localDateKey(new Date());
      await API.addTask({ projectId: a.projectId, title: a.title, status: 'Not Started', priority: 'Medium', startDate: today, endDate: a.endDate || today });
    }
  }
  // Runs the safe ones now; the rest become buttons under the reply.
  function handle(body, bubble) {
    const now = body.actions.filter(a => !WRITE.has(a.type));
    const asks = body.actions.filter(a => WRITE.has(a.type));
    if (now.length) {
      // Leave the panel so they can see where they've been taken.
      if (now.some(a => a.type !== 'start_focus') && typeof closeAssistant === 'function') closeAssistant(); // eslint-disable-line no-undef
      now.forEach(runNow);
    }
    if (!asks.length || !bubble) return;
    const row = document.createElement('div');
    row.className = 'asst-music-actions';
    row.innerHTML = asks.map((a, i) => `<button type="button" class="asst-music-yes" data-i="${i}">${icon(a.type === 'complete_task' ? 'check' : a.type === 'set_reminder' ? 'alarm' : 'plus')}${esc(writeLabel(a))}</button>`).join('')
      + (asks.length > 1 ? `<button type="button" class="asst-music-yes" data-all="1">${icon('check')}Do all</button>` : '')
      + '<button type="button" class="asst-music-no">Not now</button>';
    const doIt = async (list, btns) => {
      btns.forEach(b => { b.disabled = true; });
      for (const a of list) {
        try { await runWrite(a); a.done = true; } catch (e) { showToast('❌ ' + (e.message || 'Could not do that'), 'error'); }
      }
      const doneCount = asks.filter(a => a.done).length;
      if (asks.every(a => a.done)) row.innerHTML = `<span class="asst-music-done">${icon('check')}Done</span>`;
      else btns.forEach(b => { b.disabled = false; });
      if (doneCount && typeof refreshTaskViews === 'function') refreshTaskViews(); // eslint-disable-line no-undef
    };
    row.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => doIt([asks[+b.dataset.i]], [b]); });
    row.querySelector('[data-all]')?.addEventListener('click', e => doIt(asks.filter(a => !a.done), [...row.querySelectorAll('button')].filter(x => x !== row.querySelector('.asst-music-no')) || [e.target]));
    row.querySelector('.asst-music-no').onclick = () => row.remove();
    bubble.appendChild(row);
  }

  // ── Morning briefing ──
  // Once a day on the dashboard: what matters today, read out on request,
  // and one tap to start the first thing with your music on.
  let brief = null;
  async function renderBriefing(force) {
    const box = document.getElementById('dash-brief');
    if (!box) return;
    const today = localDateKey(new Date());
    if (!force && store.get('wp-briefed') === today) { box.classList.add('hidden'); return; }
    let tasks, profile;
    try { [tasks, profile] = await Promise.all([API.getTasks(), API.getProfile()]); } catch { return; }
    const open = tasks.filter(t => t.status !== 'Completed');
    const due = t => (t.endDate || '').slice(0, 10);
    const late = open.filter(t => due(t) && due(t) < today);
    const todays = open.filter(t => due(t) === today);
    const blocked = open.filter(t => (t.obstacles || []).some(o => !o.resolved));
    const rank = t => (late.includes(t) ? 0 : todays.includes(t) ? 1 : t.status === 'In Progress' ? 2 : t.priority === 'High' ? 3 : 4);
    const top = open.filter(t => !blocked.includes(t)).sort((a, b) => rank(a) - rank(b) || (due(a) || '9999').localeCompare(due(b) || '9999')).slice(0, 3);
    const name = profile && profile.name && profile.name !== 'Your Name' ? profile.name.split(' ')[0] : '';
    const h = new Date().getHours();
    const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const why = window.Why ? await Why.load().then(() => Why.get()).catch(() => null) : null;
    const quote = why && why.quotes.length ? why.quotes[Math.floor(Date.now() / 86400000) % why.quotes.length] : null;
    const counts = [late.length && `${late.length} overdue`, todays.length && `${todays.length} due today`, blocked.length && `${blocked.length} blocked`].filter(Boolean);
    const spoken = [
      `${hello}${name ? `, ${name}` : ''}.`,
      counts.length ? `You have ${counts.join(', ')}.` : 'Nothing is late. A good day to get ahead.',
      top.length ? `First up: ${top[0].title}.` : '',
      profile && profile.currentStreak ? `You're on a ${profile.currentStreak}-day streak.` : '',
      quote ? `And remember: ${quote.text}` : why && why.why ? `Remember why: ${why.why}.` : '',
    ].filter(Boolean).join(' ');
    brief = { top, spoken };
    box.classList.remove('hidden');
    box.innerHTML = `<div class="brief-card">
      <div class="brief-orb" aria-hidden="true"><span></span></div>
      <div class="min-w-0 flex-1">
        <p class="brief-hello">${esc(hello)}${name ? `, ${esc(name)}` : ''}. Here's your day.</p>
        <p class="brief-sum">${counts.length ? esc(counts.join(' · ')) : 'Nothing late. A good day to get ahead.'}${profile && profile.currentStreak ? ` · ${icon('flame', 'tiny')} ${profile.currentStreak}-day streak` : ''}</p>
        ${top.length ? `<ol class="brief-list">${top.map(t => `<li><button type="button" onclick="openTaskDetail('${t.id}')">${esc(t.title)}</button></li>`).join('')}</ol>` : ''}
        <div class="brief-actions">
          ${top.length ? `<button type="button" class="brief-go" onclick="Jarvis.startDay()">${icon('play')}Start my day</button>` : ''}
          <button type="button" onclick="Jarvis.hear()">${icon('volume')}Hear it</button>
          <button type="button" onclick="Jarvis.talk()">${icon('mic')}Talk to me</button>
        </div>
      </div>
      <button type="button" class="brief-x" onclick="Jarvis.dismissBriefing()" aria-label="Hide today's briefing">${icon('close')}</button>
    </div>`;
  }
  const hear = () => brief && say(brief.spoken);
  function startDay() {
    if (!brief || !brief.top.length) return;
    const t = brief.top[0];
    startFocus({ taskId: t.id, title: t.title, minutes: 25, music: true });
    dismissBriefing();
  }
  function dismissBriefing() {
    store.set('wp-briefed', localDateKey(new Date()));
    document.getElementById('dash-brief')?.classList.add('hidden');
  }

  // ── Always one key away ──
  async function talk() {
    await openAssistant(APP.currentPage === 'project-detail' ? APP.currentProjectId : undefined);
    setTimeout(() => { if (typeof toggleAssistantListening === 'function') toggleAssistantListening(); }, 250);
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'j' || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (document.querySelector('.modal-overlay.open')) return;
    e.preventDefault();
    talk();
  });

  return { startFocus, stopFocus, togglePause, extend, focusDone, resumeFocus, handle, renderBriefing, hear, startDay, dismissBriefing, talk, isFocusing: () => !!focus };
})();
window.Jarvis = Jarvis;
