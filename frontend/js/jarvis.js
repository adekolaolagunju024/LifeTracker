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
// ── The assistant's voice ──
// Uses the voices the device has (no audio leaves it). The person picks
// one, or "JARVIS-style": the calmest British voice we can find on this
// device. Speed is theirs to set. Every place the assistant speaks uses it.
const Voice = (() => {
  const KEY = 'wp-voice';
  const prefs = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const save = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } };
  const all = () => ('speechSynthesis' in window ? speechSynthesis.getVoices() : []);
  // Best British (then any English) male-sounding voice, by known names.
  const JARVIS_NAMES = [/daniel/i, /google uk english male/i, /ryan/i, /thomas/i, /george/i, /arthur/i, /oliver/i, /alfie/i, /harry/i, /malcolm/i, /en-gb.*male/i];
  function jarvisVoice() {
    const voices = all();
    for (const re of JARVIS_NAMES) { const v = voices.find(x => re.test(x.name) && /^en(-|_)gb/i.test(x.lang)); if (v) return v; }
    for (const re of JARVIS_NAMES) { const v = voices.find(x => re.test(x.name)); if (v) return v; }
    return voices.find(x => /^en(-|_)gb/i.test(x.lang)) || voices.find(x => /^en/i.test(x.lang)) || null;
  }
  function current() {
    const p = prefs();
    const voices = all();
    if (!p.voice || p.voice === 'jarvis') return jarvisVoice();
    if (p.voice === 'default') return null;
    return voices.find(v => v.voiceURI === p.voice) || jarvisVoice();
  }
  const rate = () => Math.min(1.4, Math.max(0.7, Number(prefs().rate) || 1));
  // Speaks text sentence by sentence (long single utterances get dropped by
  // some browsers); resolves when done, or after a safety timeout.
  function speak(text) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window) || !String(text || '').trim()) return resolve();
      const sentences = (String(text).match(/[^.!?]+[.!?]*/g) || [text]).map(x => x.trim()).filter(Boolean);
      let finished = false;
      const finish = () => { if (!finished) { finished = true; clearTimeout(guard); resolve(); } };
      const guard = setTimeout(finish, Math.max(4000, text.length * 95 / rate() + 3000));
      speechSynthesis.cancel();
      const v = current();
      sentences.forEach((sentence, i) => {
        const u = new SpeechSynthesisUtterance(sentence);
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = navigator.language || 'en-GB';
        u.rate = rate();
        if (i === sentences.length - 1) { u.onend = finish; u.onerror = finish; }
        speechSynthesis.speak(u);
      });
    });
  }
  // Settings → Appearance: the voice picker.
  function renderSettings() {
    const sel = document.getElementById('voice-select');
    if (!sel) return;
    if (!('speechSynthesis' in window)) { sel.closest('[data-voice-row]')?.classList.add('hidden'); return; }
    const p = prefs();
    const voices = all();
    const english = voices.filter(v => /^en/i.test(v.lang));
    const others = voices.filter(v => !/^en/i.test(v.lang));
    const jv = jarvisVoice();
    const opt = v => `<option value="${esc(v.voiceURI)}" ${p.voice === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`;
    sel.innerHTML = `<option value="jarvis" ${!p.voice || p.voice === 'jarvis' ? 'selected' : ''}>JARVIS-style${jv ? `: ${esc(jv.name)}` : ''}</option>`
      + `<option value="default" ${p.voice === 'default' ? 'selected' : ''}>This device's default</option>`
      + (english.length ? `<optgroup label="English">${english.map(opt).join('')}</optgroup>` : '')
      + (others.length ? `<optgroup label="Other languages">${others.map(opt).join('')}</optgroup>` : '');
    const r = document.getElementById('voice-rate');
    r.value = String(rate());
    document.getElementById('voice-rate-out').textContent = `${rate().toFixed(1)}×`;
  }
  function setVoice(value) { save({ ...prefs(), voice: value }); preview(); }
  function setRate(value) { save({ ...prefs(), rate: Number(value) }); document.getElementById('voice-rate-out').textContent = `${Number(value).toFixed(1)}×`; }
  const preview = () => speak("Good morning. Here's your day. You're on a three-day streak. Shall we start with the first thing?");
  if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', renderSettings);
  return { speak, renderSettings, setVoice, setRate, preview, current };
})();
window.Voice = Voice;

const Jarvis = (() => {
  const say = text => { Voice.speak(text); };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ── Focus sessions ──
  // A countdown on one task (or none), with their music if they want it,
  // and a check-in at the end. Survives a reload.
  let focus = null;
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function startFocus({ taskId = null, title = '', minutes = 25, music = true, isBreak = false } = {}) {
    stopFocus(true);
    const total = Math.min(90, Math.max(5, minutes)) * 60000;
    // A new session keeps the size they last chose for the timer.
    const prev = store.get('wp-focus-view') || {};
    focus = { taskId, title, total, ends: Date.now() + total, paused: null, isBreak, min: !!prev.min };
    store.set('wp-focus', focus);
    if (music && window.Why && !(window.Music && Music.isPlaying() && !Music.isPaused())) Why.playMusic().catch?.(() => {});
    paintFocus();
    showToast(isBreak ? `☕ Break for ${Math.round(total / 60000)} minutes` : `⏱ Focus for ${Math.round(total / 60000)} minutes${title ? `: ${title}` : ''}`);
  }
  const save = () => store.set('wp-focus', { ...focus, tick: undefined });
  function stopFocus(silent) {
    clearInterval(focus && focus.tick);
    focus = null;
    store.set('wp-focus', null);
    document.getElementById('focus-hud')?.remove();
    if (window.TopDock) TopDock.set('focus', null);
    if (!silent) showToast('Focus session ended');
  }
  function togglePause() {
    if (!focus) return;
    if (focus.paused) { focus.ends = Date.now() + focus.paused; focus.paused = null; }
    else focus.paused = focus.ends - Date.now();
    store.set('wp-focus', { ...focus, tick: undefined });
    paintFocus();
  }
  // What the timer says when time is up: did you finish, and once you have,
  // what's next on today's plan.
  function doneHTML() {
    const nx = focus.next;
    const startNext = nx ? `<button type="button" class="focus-yes" onclick="Jarvis.startNext()">${icon('play')}Start next</button>` : '';
    if (focus.isBreak) {
      return `<div class="focus-hud-main"><p class="focus-kicker">Break's over</p>
        <p class="focus-title">${nx ? `Next up: “${esc(nx.title)}”` : 'Ready when you are.'}</p>
        <div class="focus-actions">${startNext}<button type="button" onclick="Jarvis.stopFocus()">Finish for now</button></div></div>`;
    }
    if (focus.completed) {
      return `<div class="focus-hud-main"><p class="focus-kicker">Done</p>
        <p class="focus-title">${nx ? `Nice work. Next up: “${esc(nx.title)}”` : "That's today's plan done. Great work."}</p>
        <div class="focus-actions">${startNext}${nx ? `<button type="button" onclick="Jarvis.takeBreak()">${icon('coffee')}5-min break</button>` : ''}
          <button type="button" onclick="Jarvis.stopFocus()">${nx ? 'Finish for now' : 'Close'}</button></div></div>`;
    }
    return `<div class="focus-hud-main"><p class="focus-kicker">Time</p>
      <p class="focus-title">${focus.title ? `Did you finish “${esc(focus.title)}”?` : 'Nice work. How did it go?'}</p>
      <div class="focus-actions">
        ${focus.taskId ? `<button type="button" class="focus-yes" onclick="Jarvis.focusDone()">${icon('check')}Done it</button>` : ''}
        <button type="button" onclick="Jarvis.extend(10)">${icon('plus')}10 more min</button>
        <button type="button" onclick="Jarvis.stopFocus()">Stop</button>
      </div></div>`;
  }
  // Hidden: nothing on screen, still counting; it comes back when time is
  // up, and the Today card can bring it back sooner.
  function hideTimer() {
    if (!focus) return;
    focus.hidden = true; save(); paintFocus();
    showToast("Timer hidden in the top bar. It comes back when time is up");
    if (APP.currentPage === 'dashboard') renderBriefing();
  }
  function showTimer() {
    if (!focus) return;
    focus.hidden = false; focus.min = false; save(); paintFocus();
    if (APP.currentPage === 'dashboard') renderBriefing();
  }
  // Shrinks the timer to a small ring and the time left, out of the way.
  // It still counts, and it opens up again by itself when time is up.
  function toggleMin() {
    if (!focus) return;
    focus.min = !focus.min;
    store.set('wp-focus-view', { min: focus.min });
    save();
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
      if (focus.hidden && window.TopDock) TopDock.set('focus', `<button type="button" onclick="Jarvis.showTimer()" title="${esc(focus.title || 'Focus')}. Show the timer" aria-label="Show the focus timer, ${fmt(left)} left">${icon(focus.paused != null ? 'pause' : 'timer')}${fmt(left)}</button>`);
    };
    const min = focus.min && !focus.done;
    const hidden = focus.hidden && !focus.done;
    hud.className = 'focus-hud' + (focus.done ? ' is-done' : '') + (min ? ' is-min' : '') + (hidden ? ' is-hidden' : '');
    if (!hidden && window.TopDock) TopDock.set('focus', null);
    hud.innerHTML = focus.done ? doneHTML() : `
      <svg class="focus-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" class="focus-ring-bg"/><circle cx="20" cy="20" r="18" class="focus-ring-fg" stroke-dasharray="113.1" stroke-dashoffset="113.1"/></svg>
      <div class="focus-hud-main" ${focus.taskId ? `onclick="openTaskDetail('${focus.taskId}')" role="button" tabindex="0"` : ''}>
        <p class="focus-kicker">${focus.paused != null ? 'Paused' : 'Focusing'}</p>
        <p class="focus-title">${esc(focus.title || 'Deep work')}</p>
      </div>
      <span class="focus-time">${fmt(focus.paused != null ? focus.paused : focus.ends - Date.now())}</span>
      ${min ? `<button type="button" class="focus-btn" onclick="Jarvis.toggleMin()" aria-label="Show the focus timer" title="Show">${icon('maximize-2')}</button>
      <button type="button" class="focus-btn" onclick="Jarvis.hideTimer()" aria-label="Hide the timer. It keeps counting and comes back when time is up" title="Hide (keeps counting)">${icon('eye-off')}</button>` : `
      <button type="button" class="focus-btn" onclick="Jarvis.togglePause()" aria-label="${focus.paused != null ? 'Resume' : 'Pause'}">${icon(focus.paused != null ? 'play' : 'pause')}</button>
      <button type="button" class="focus-btn" onclick="Jarvis.toggleMin()" aria-label="Minimise the focus timer" title="Minimise (keeps counting)">${icon('minimize-2')}</button>
      <button type="button" class="focus-btn" onclick="Jarvis.hideTimer()" aria-label="Hide the timer. It keeps counting" title="Hide (keeps counting)">${icon('eye-off')}</button>
      <button type="button" class="focus-btn" onclick="Jarvis.stopFocus()" aria-label="End focus session">${icon('close')}</button>`}`;
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
      // Straight on to what's next on today's plan, if there is one.
      const nx = await nextInPlan().catch(() => null);
      if (nx || planGet()) {
        focus.completed = true; focus.next = nx; save(); paintFocus();
        say(nx ? `Nice work. Next up: ${nx.title}.` : "That's today's plan done. Great work.");
      } else stopFocus(true);
      if (APP.currentPage === 'dashboard' && typeof renderDashboard === 'function') renderDashboard(); // eslint-disable-line no-undef
    } catch (e) { taskErrorToast(e, 'Could not finish that task'); }
  }
  function startNext() {
    const nx = focus && focus.next;
    if (!nx) { stopFocus(true); return; }
    const plan = planGet();
    startFocus({ taskId: nx.id, title: nx.title, minutes: plan ? plan.minutes : 25, music: true });
  }
  function takeBreak() {
    const nx = focus && focus.next;
    startFocus({ title: 'Break', minutes: 5, music: false, isBreak: true });
    focus.next = nx; save();
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

  // ── Today ──
  // The top of the dashboard: the greeting, what's late or due, your
  // streak, today's quote from Your why, and one tap to start the first
  // thing (with your music), talk to the assistant, play your music, or
  // hear it all read out.
  let brief = null;
  async function renderBriefing() {
    const box = document.getElementById('dash-brief');
    if (!box) return;
    const today = localDateKey(new Date());
    let tasks, profile;
    try { [tasks, profile] = await Promise.all([API.getTasks(), API.getProfile()]); } catch { return; }
    const open = tasks.filter(t => t.status !== 'Completed');
    const due = t => (t.endDate || '').slice(0, 10);
    const late = open.filter(t => due(t) && due(t) < today);
    const todays = open.filter(t => due(t) === today);
    const blocked = open.filter(t => (t.obstacles || []).some(o => !o.resolved));
    const rank = t => (late.includes(t) ? 0 : todays.includes(t) ? 1 : t.status === 'In Progress' ? 2 : t.priority === 'High' ? 3 : 4);
    const top = open.filter(t => !blocked.includes(t)).sort((a, b) => rank(a) - rank(b) || (due(a) || '9999').localeCompare(due(b) || '9999'))[0] || null;
    const name = profile && profile.name && profile.name !== 'Your Name' ? profile.name.split(' ')[0] : '';
    const h = new Date().getHours();
    const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const why = window.Why ? await Why.load().then(() => Why.get()).catch(() => null) : null;
    const quote = why && window.Why && Why.todaysQuote ? Why.todaysQuote() : null; // a different one each day
    const music = why && why.playlists.length ? why.playlists[0] : null;
    const counts = [late.length && `${late.length} overdue`, todays.length && `${todays.length} due today`, blocked.length && `${blocked.length} blocked`].filter(Boolean);
    brief = {
      top,
      spoken: [
        `${hello}${name ? `, ${name}` : ''}.`,
        counts.length ? `You have ${counts.join(', ')}.` : 'Nothing is late. A good day to get ahead.',
        top ? `First up: ${top.title}.` : '',
        profile && profile.currentStreak ? `You're on a ${profile.currentStreak}-day streak.` : '',
        quote ? `And remember: ${quote.text}` : why && why.why ? `Remember why: ${why.why}.` : '',
      ].filter(Boolean).join(' '),
    };
    const dateText = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const plan = planGet();
    const planDone = plan ? plan.ids.filter(id => tasks.some(t => t.id === id && t.status === 'Completed')).length : 0;
    const planNext = plan ? await nextInPlan(tasks) : null;
    const taskLink = t => `<button type="button" onclick="openTaskDetail('${t.id}')">${esc(t.title)}</button>`;
    const sum = plan ? (planNext ? `Today's plan: ${planDone} of ${plan.ids.length} done · Next: ${taskLink(planNext)}` : `Today's plan is done: ${planDone} of ${plan.ids.length}. Great work.`)
      : top ? `First up: ${taskLink(top)}`
        : counts.length ? esc(counts.join(' · ')) : 'Nothing late. A good day to get ahead.';
    const running = focus && !focus.done && !focus.isBreak;
    const mainBtn = running ? (focus.hidden || focus.min ? `<button type="button" class="brief-go" onclick="Jarvis.showTimer()">${icon('timer')}Show timer</button>` : '')
      : plan && planNext ? `<button type="button" class="brief-go" onclick="Jarvis.startDay()">${icon('play')}Keep going</button>`
        : plan ? `<button type="button" class="brief-go" onclick="Jarvis.openPlanner()">${icon('list-checks')}Plan more</button>`
          : open.length ? `<button type="button" class="brief-go" onclick="Jarvis.startDay()">${icon('play')}Start my day</button>` : '';
    // The date row's pills come along into this card; put them back first
    // so redrawing the card doesn't lose them.
    const pills = ['streak-badge', 'dash-level-pill'].map(id => document.getElementById(id)).filter(Boolean);
    const home = document.getElementById('dash-head-pills');
    if (home) pills.forEach(p => home.appendChild(p));
    const line = quote ? `<figure class="brief-quote"><blockquote>“${esc(quote.text)}”</blockquote>${quote.source ? `<figcaption>${esc(quote.source)}</figcaption>` : ''}</figure>`
      : why && why.why ? `<figure class="brief-quote"><blockquote>Remember why: ${esc(why.why)}</blockquote></figure>`
        : `<button type="button" class="brief-add" onclick="showPage('why')">${icon('heart', 'tiny')} Add a quote or reason that keeps you going</button>`;
    const tool = (onclick, ic, label, title, extra = '') => `<button type="button" class="brief-tool" onclick="${onclick}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}>${icon(ic)}<span>${esc(label)}</span></button>`;
    box.innerHTML = `<div class="brief-card">
      <div class="brief-top">
        <p class="brief-date"><span class="brief-orb" aria-hidden="true"><span></span></span>${esc(dateText)}</p>
        <div class="brief-pills"></div>
      </div>
      <p class="brief-hello">${esc(hello)}${name ? `, ${esc(name)}` : ''}.</p>
      <p class="brief-sum">${sum}</p>
      ${line}
      <div class="brief-actions">
        ${mainBtn ? `<div class="brief-main">${mainBtn}${plan ? `<button type="button" class="brief-plan" onclick="Jarvis.openPlanner()" aria-label="Change today's plan" title="Change today's plan">${icon('list-checks')}</button>` : ''}</div>` : ''}
        <div class="brief-tools">
          ${tool('Jarvis.talk()', 'mic', 'Talk', 'Talk to your assistant (J)')}
          ${music ? tool('Why.playMusic()', 'music', 'Music', `Play ${music.label || 'your music'}`) : tool("showPage('why')", 'music', 'Music', 'Add your music')}
          ${tool('Jarvis.hear()', 'volume', 'Listen', 'Read today out loud')}
        </div>
      </div>
    </div>`;
    const slot = box.querySelector('.brief-pills');
    pills.forEach(p => slot.appendChild(p));
    document.getElementById('dash-head')?.classList.add('hidden');
  }
  const hear = () => brief && say(brief.spoken);

  // ── Start my day: sort today, then get going ──
  // A short sheet: the tasks that matter today (late, due today, in
  // progress, high priority soon), ticked for you; untick, add one, pick a
  // session length, go. Late ones you keep move to today. The first starts
  // straight away with your music, and each one you finish hands you the
  // next. The plan is kept on this device for the day.
  const PLAN_KEY = 'wp-today';
  function planGet() {
    const p = store.get(PLAN_KEY);
    return p && p.date === localDateKey(new Date()) ? p : null;
  }
  async function nextInPlan(tasks) {
    const plan = planGet();
    if (!plan) return null;
    const list = tasks || await API.getTasks();
    const open = new Map(list.filter(t => t.status !== 'Completed').map(t => [t.id, t]));
    const id = plan.ids.find(i => open.has(i) && i !== (focus && focus.completed ? focus.taskId : null));
    return id ? { id, title: open.get(id).title } : null;
  }
  async function startDay() {
    const plan = planGet();
    if (plan) {
      const nx = await nextInPlan().catch(() => null);
      if (nx) { startFocus({ taskId: nx.id, title: nx.title, minutes: plan.minutes, music: true }); return; }
    }
    openPlanner();
  }
  let planner = null;
  async function openPlanner() {
    let tasks, projects;
    try { [tasks, projects] = await Promise.all([API.getTasks(), API.getProjects()]); } catch { showToast('Could not load your tasks', 'error'); return; }
    const today = localDateKey(new Date());
    const soon = localDateKey(new Date(Date.now() + 3 * 86400000));
    const byId = Object.fromEntries(projects.map(p => [p.id, p]));
    const due = t => (t.endDate || '').slice(0, 10);
    const blocked = t => (t.obstacles || []).some(o => !o.resolved);
    const rank = t => (due(t) && due(t) < today ? 0 : due(t) === today ? 1 : t.status === 'In Progress' ? 2 : due(t) && due(t) <= soon ? 3 : 4);
    const open = tasks.filter(t => t.status !== 'Completed')
      .sort((a, b) => rank(a) - rank(b) || (due(a) || '9999').localeCompare(due(b) || '9999') || (a.priority === 'High' ? -1 : b.priority === 'High' ? 1 : 0));
    const list = open.slice(0, 8);
    const plan = planGet();
    const chosen = new Set(plan ? plan.ids.filter(id => list.some(t => t.id === id))
      : list.filter(t => !blocked(t) && rank(t) <= 2).slice(0, 3).map(t => t.id));
    if (!chosen.size) list.filter(t => !blocked(t)).slice(0, 3).forEach(t => chosen.add(t.id));
    const editable = id => { const r = (byId[id] || {}).role; return r === 'owner' || r === 'editor'; };
    const home = list.find(t => editable(t.projectId))?.projectId || projects.find(p => p.role === 'owner' && !p.parentId)?.id;
    planner = { list, chosen, byId, today, minutes: plan ? plan.minutes : (store.get('wp-focus-len') || 25), music: true, home };
    const hasMusic = window.Why && Why.get && (Why.get() || { playlists: [] }).playlists.length;

    document.getElementById('day-plan')?.remove();
    const el = document.createElement('div');
    el.id = 'day-plan';
    el.className = 'dayplan-overlay';
    el.innerHTML = `<div class="dayplan" role="dialog" aria-modal="true" aria-labelledby="dayplan-title">
      <div class="dayplan-head">
        <div><p class="dayplan-kicker">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
        <h3 id="dayplan-title">Let's sort today</h3>
        <p class="dayplan-sub">Pick what you'll get done. We'll start with the first and hand you the next as you go.</p></div>
        <button type="button" class="dayplan-x" onclick="Jarvis.closePlanner()" aria-label="Close">${icon('close')}</button>
      </div>
      <div class="dayplan-list" id="dayplan-list"></div>
      ${home ? `<form class="dayplan-add" onsubmit="event.preventDefault(); Jarvis.plannerAdd()">
        <input id="dayplan-new" maxlength="200" placeholder="Something else for today…" aria-label="Add a task for today">
        <button type="submit">${icon('plus')}Add</button></form>` : ''}
      <div class="dayplan-opts">
        <span class="dayplan-label">Each session</span>
        <div class="dayplan-len" role="radiogroup" aria-label="Session length">${[25, 45, 60].map(m => `<button type="button" role="radio" data-m="${m}" onclick="Jarvis.plannerLen(${m})">${m} min</button>`).join('')}</div>
        ${hasMusic ? `<label class="dayplan-music"><input type="checkbox" id="dayplan-music" checked> ${icon('music', 'tiny')} Play my music</label>` : ''}
      </div>
      <div class="dayplan-foot">
        <button type="button" class="dayplan-ai" onclick="Jarvis.plannerAsk()">${icon('sparkles', 'tiny')} Plan it with the assistant</button>
        <button type="button" class="dayplan-go" id="dayplan-go" onclick="Jarvis.plannerGo()"></button>
      </div>
    </div>`;
    el.addEventListener('click', e => { if (e.target === el) closePlanner(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') closePlanner(); });
    document.body.appendChild(el);
    paintPlanner();
    setTimeout(() => el.querySelector('#dayplan-go')?.focus(), 50);
  }
  function paintPlanner() {
    const P = planner;
    const box = document.getElementById('dayplan-list');
    if (!P || !box) return;
    const blocked = t => (t.obstacles || []).some(o => !o.resolved);
    const due = t => (t.endDate || '').slice(0, 10);
    // Ticked ones first, in the order they'll be done.
    const rows = [...P.list.filter(t => P.chosen.has(t.id)), ...P.list.filter(t => !P.chosen.has(t.id))];
    box.innerHTML = rows.length ? rows.map(t => {
      const late = due(t) && due(t) < P.today;
      const when = late ? 'Late, moves to today' : due(t) === P.today ? 'Today' : t.status === 'In Progress' ? 'In progress' : due(t) ? new Date(due(t) + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
      const b = blocked(t);
      const order = P.chosen.has(t.id) ? [...P.chosen].filter(id => rows.some(r => r.id === id)).indexOf(t.id) + 1 : 0;
      return `<label class="dayplan-row ${P.chosen.has(t.id) ? 'on' : ''} ${b ? 'is-blocked' : ''}">
        <input type="checkbox" ${P.chosen.has(t.id) ? 'checked' : ''} ${b ? 'disabled' : ''} onchange="Jarvis.plannerToggle('${t.id}')">
        <span class="dayplan-n">${order || ''}</span>
        <span class="min-w-0 flex-1"><span class="dayplan-t">${esc(t.title)}</span>
        <span class="dayplan-m">${esc((P.byId[t.projectId] || {}).title || '')}${b ? ' · blocked, clear it first' : ''}</span></span>
        <span class="dayplan-when ${late ? 'late' : ''}">${esc(when)}</span>
      </label>`;
    }).join('') : '<p class="dayplan-empty">Nothing open yet. Add the first thing you want to get done today.</p>';
    document.querySelectorAll('#day-plan .dayplan-len button').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.m) === P.minutes)));
    const n = P.chosen.size;
    const go = document.getElementById('dayplan-go');
    go.disabled = !n;
    go.innerHTML = `${icon('play')}${n ? `Start · ${n} ${n === 1 ? 'task' : 'tasks'}` : 'Pick at least one'}`;
  }
  function plannerToggle(id) {
    if (!planner) return;
    if (planner.chosen.has(id)) planner.chosen.delete(id); else planner.chosen.add(id);
    paintPlanner();
  }
  function plannerLen(m) { if (planner) { planner.minutes = m; paintPlanner(); } }
  async function plannerAdd() {
    const input = document.getElementById('dayplan-new');
    const title = input.value.trim();
    if (!title || !planner || !planner.home) return;
    input.disabled = true;
    try {
      const t = await API.addTask({ projectId: planner.home, title, status: 'Not Started', priority: 'Medium', startDate: planner.today, endDate: planner.today });
      planner.list.unshift(t);
      planner.chosen.add(t.id);
      input.value = '';
      paintPlanner();
    } catch (e) { showToast(e.message || 'Could not add that', 'error'); }
    input.disabled = false; input.focus();
  }
  function plannerAsk() {
    closePlanner();
    if (typeof paletteAsk === 'function') paletteAsk("Help me plan my day. Look at what's late, due and in progress, and tell me what to do first, second and third."); // eslint-disable-line no-undef
    else openAssistant();
  }
  function closePlanner() { document.getElementById('day-plan')?.remove(); planner = null; }
  async function plannerGo() {
    const P = planner;
    if (!P || !P.chosen.size) return;
    const btn = document.getElementById('dayplan-go');
    btn.disabled = true;
    const ids = [...P.chosen];
    const chosen = ids.map(id => P.list.find(t => t.id === id)).filter(Boolean);
    // Late ones they kept move to today.
    const editable = t => { const r = (P.byId[t.projectId] || {}).role; return r === 'owner' || r === 'editor'; };
    const late = chosen.filter(t => (t.endDate || '').slice(0, 10) && t.endDate.slice(0, 10) < P.today && editable(t));
    await Promise.all(late.map(t => API.updateTask(t.id, { endDate: P.today }).catch(() => null)));
    store.set(PLAN_KEY, { date: P.today, ids, minutes: P.minutes });
    store.set('wp-focus-len', P.minutes);
    const music = !!document.getElementById('dayplan-music')?.checked;
    closePlanner();
    const first = chosen[0];
    startFocus({ taskId: first.id, title: first.title, minutes: P.minutes, music });
    say(`Today: ${ids.length} ${ids.length === 1 ? 'thing' : 'things'}. First up: ${first.title}. Let's go.`);
    if (APP.currentPage === 'dashboard' && typeof renderDashboard === 'function') renderDashboard(); // eslint-disable-line no-undef
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

  return { startFocus, stopFocus, togglePause, toggleMin, hideTimer, showTimer, startNext, takeBreak, openPlanner, closePlanner, plannerToggle, plannerLen, plannerAdd, plannerAsk, plannerGo, extend, focusDone, resumeFocus, handle, renderBriefing, hear, startDay, talk, isFocusing: () => !!focus };
})();
window.Jarvis = Jarvis;
