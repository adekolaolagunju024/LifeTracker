/* global API, APP, esc, icon, DayRoad, showToast, showPage, openTaskDetail, Why, Music, localDateKey, openAssistant, toggleAssistantListening, Reminders, taskGateMessage, taskErrorToast, Sfx */
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
// Two kinds. Natural voices (backend/voice.js) sound like a real person:
// the text is sent to a speech service and comes back as audio. They're
// offered when the server has a key, and are the default then. Device
// voices are the ones built into the phone or computer (no audio leaves
// it), with "JARVIS-style" picking the calmest British one. If a natural
// voice can't be reached, the device voice takes over. Speed is theirs to
// set. Every place the assistant speaks uses this.
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
    if (!p.voice || p.voice === 'jarvis' || String(p.voice).startsWith('ai:')) return jarvisVoice();
    if (p.voice === 'default') return null;
    return voices.find(v => v.voiceURI === p.voice) || jarvisVoice();
  }
  const rate = () => Math.min(1.4, Math.max(0.7, Number(prefs().rate) || 1));

  // Natural voices: what the server offers, asked once.
  let natural = null; let naturalOff = false;
  async function loadNatural() {
    if (natural) return natural;
    if (!APP.currentUserId) return { available: false, voices: [] }; // not signed in yet: ask later
    try { natural = await API.getVoices(); } catch { natural = { available: false, voices: [] }; }
    return natural;
  }
  // The natural voice to use, or null for the device's.
  function naturalChoice() {
    if (naturalOff || !natural || !natural.available || !natural.voices.length) return null;
    const p = prefs().voice;
    if (!p) return natural.voices[0].id; // the default when it's there
    if (String(p).startsWith('ai:')) { const id = p.slice(3); return natural.voices.some(v => v.id === id) ? id : natural.voices[0].id; }
    return null;
  }

  let audio = null; let audioUrl = null;
  function stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (audio) { audio.pause(); audio.onended = null; audio = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  }
  // Device voice: sentence by sentence (long single utterances get dropped
  // by some browsers); resolves when done, or after a safety timeout.
  function speakDevice(text) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) return resolve();
      const sentences = (String(text).match(/[^.!?]+[.!?]*/g) || [text]).map(x => x.trim()).filter(Boolean);
      let finished = false;
      const finish = () => { if (!finished) { finished = true; clearTimeout(guard); resolve(); } };
      const guard = setTimeout(finish, Math.max(4000, text.length * 95 / rate() + 3000));
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
  async function speakNatural(text, id) {
    const blob = await API.speakText(text, id);
    stop();
    audioUrl = URL.createObjectURL(blob);
    audio = new Audio(audioUrl);
    audio.playbackRate = rate();
    const mine = audio;
    await mine.play();
    await new Promise(resolve => {
      const guard = setTimeout(resolve, Math.max(6000, text.length * 110 / rate() + 4000));
      mine.onended = () => { clearTimeout(guard); resolve(); };
      mine.onerror = () => { clearTimeout(guard); resolve(); };
    });
  }
  async function speak(text) {
    text = String(text || '').trim();
    if (!text) return;
    stop();
    await loadNatural();
    const id = naturalChoice();
    if (id) {
      try { await speakNatural(text, id); return; } catch (e) {
        // Out of today's allowance, not set up, or audio blocked: the
        // device voice carries on for the rest of this visit.
        if (e && (e.status === 429 || e.status === 503)) naturalOff = true;
      }
    }
    await speakDevice(text);
  }
  // Settings → Appearance: the voice picker.
  async function renderSettings() {
    const sel = document.getElementById('voice-select');
    if (!sel) return;
    await loadNatural();
    const hasDevice = 'speechSynthesis' in window;
    if (!hasDevice && !(natural && natural.available)) { sel.closest('[data-voice-row]')?.classList.add('hidden'); return; }
    const p = prefs();
    const voices = all();
    const english = voices.filter(v => /^en/i.test(v.lang));
    const others = voices.filter(v => !/^en/i.test(v.lang));
    const jv = jarvisVoice();
    const nat = naturalChoice();
    const opt = v => `<option value="${esc(v.voiceURI)}" ${p.voice === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`;
    sel.innerHTML = (natural && natural.available ? `<optgroup label="Natural voices">${natural.voices.map(v => `<option value="ai:${esc(v.id)}" ${nat === v.id ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</optgroup>` : '')
      + (hasDevice ? `<optgroup label="This device's voices"><option value="jarvis" ${!nat && (!p.voice || p.voice === 'jarvis') ? 'selected' : ''}>JARVIS-style${jv ? `: ${esc(jv.name)}` : ''}</option>`
        + `<option value="default" ${p.voice === 'default' ? 'selected' : ''}>This device's default</option></optgroup>`
        + (english.length ? `<optgroup label="English">${english.map(opt).join('')}</optgroup>` : '')
        + (others.length ? `<optgroup label="Other languages">${others.map(opt).join('')}</optgroup>` : '') : '');
    const note = document.getElementById('voice-note');
    if (note) note.textContent = natural && natural.available
      ? 'Natural voices sound like a real person: what is read out is sent to a speech service to turn it into audio. Device voices stay on this device.'
      : 'Uses the voices on this device.';
    const r = document.getElementById('voice-rate');
    r.value = String(rate());
    document.getElementById('voice-rate-out').textContent = `${rate().toFixed(1)}×`;
  }
  function setVoice(value) { naturalOff = false; save({ ...prefs(), voice: value }); preview(); }
  function setRate(value) { save({ ...prefs(), rate: Number(value) }); document.getElementById('voice-rate-out').textContent = `${Number(value).toFixed(1)}×`; }
  const preview = () => speak("Good morning. Here's your day. You're on a three-day streak. Shall we start with the first thing?");
  if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', renderSettings);
  return { speak, stop, renderSettings, setVoice, setRate, preview, current };
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
    API.trackFeature('focus');
    stopFocus(true);
    const total = Math.min(240, Math.max(5, minutes)) * 60000;
    // A new session keeps the size they last chose for the timer.
    const prev = store.get('wp-focus-view') || {};
    focus = { taskId, title, total, ends: Date.now() + total, paused: null, isBreak, min: !!prev.min };
    store.set('wp-focus', focus);
    if (music && window.Why && !(window.Music && Music.isPlaying() && !Music.isPaused())) Why.playMusic().catch?.(() => {});
    paintFocus();
    if (window.DayRoad) DayRoad.refresh();
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
    const extra = !min && !hidden;
    hud.className = 'focus-hud' + (focus.done ? ' is-done' : '') + (min ? ' is-min' : '') + (hidden ? ' is-hidden' : '') + (extra ? ' has-extra' : '');
    if (!hidden && window.TopDock) TopDock.set('focus', null);
    hud.innerHTML = focus.done ? doneHTML() + (extra ? '<div class="focus-extra"><div data-dayroad="panel" class="hidden"></div></div>' : '') : `<div class="focus-row">
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
      <button type="button" class="focus-btn" onclick="Jarvis.stopFocus()" aria-label="End focus session">${icon('close')}</button>`}</div>
      ${extra ? `<div class="focus-extra"><div data-dayroad="panel" class="hidden"></div><div class="focus-music" id="focus-music">${musicHTML()}</div></div>` : ''}`;
    if (window.DayRoad) DayRoad.render();
    if (!focus.done) {
      draw();
      let beat = 0;
      focus.tick = setInterval(() => { draw(); if (++beat % 3 === 0) syncMusic(); }, 1000);
    }
  }

  // ── The focus panel's music row ──
  // What's playing with pause and next, or play your music; and Add music,
  // a quick search that saves the pick to Your why and plays it.
  let musicSig = '';
  function musicHTML() {
    const now = window.Music && Music.now ? Music.now() : null;
    const lists = (window.Why && Why.get && (Why.get() || {}).playlists) || [];
    musicSig = now ? `${now.label}|${now.paused}` : `none|${lists.length}`;
    const add = `<button type="button" class="fm-btn" onclick="Jarvis.musicAdd()" title="Find a song or playlist and play it">${icon('plus')}<span>Add music</span></button>`;
    if (now) {
      return `<span class="fm-ic">${icon('music')}</span><span class="fm-name" title="${esc(now.label)}">${esc(now.label)}</span>
        <button type="button" class="fm-icon" onclick="Music.togglePause(); setTimeout(() => Jarvis.syncMusic(true), 300)" aria-label="${now.paused ? 'Play' : 'Pause'} the music">${icon(now.paused ? 'play' : 'pause')}</button>
        ${now.many ? `<button type="button" class="fm-icon" onclick="Music.next(); setTimeout(() => Jarvis.syncMusic(true), 400)" aria-label="Next">${icon('skip-forward')}</button>` : ''}${add}`;
    }
    return `<span class="fm-ic">${icon('music')}</span>${lists.length ? `<button type="button" class="fm-btn fm-play" onclick="Why.playMusic(); setTimeout(() => Jarvis.syncMusic(true), 500)">${icon('play')}<span>Play ${esc(lists[0].label || 'my music')}</span></button>` : '<span class="fm-name muted">No music yet</span>'}${add}`;
  }
  function syncMusic(force) {
    const box = document.getElementById('focus-music');
    if (!box || box.classList.contains('adding')) return;
    const now = window.Music && Music.now ? Music.now() : null;
    const lists = (window.Why && Why.get && (Why.get() || {}).playlists) || [];
    const sig = now ? `${now.label}|${now.paused}` : `none|${lists.length}`;
    if (force || sig !== musicSig) box.innerHTML = musicHTML();
  }
  let addTimer = null; let addResults = [];
  function musicAdd() {
    const box = document.getElementById('focus-music');
    if (!box) return;
    box.classList.add('adding');
    box.innerHTML = `<div class="fm-search">
        <input id="fm-q" type="search" maxlength="500" placeholder="Search, or paste a Spotify or YouTube link" aria-label="Search for music, or paste a link" oninput="Jarvis.musicSearch(this.value)" onkeydown="if(event.key==='Escape')Jarvis.musicClose()">
        <button type="button" class="fm-icon" onclick="Jarvis.musicClose()" aria-label="Close the search">${icon('close')}</button>
      </div><div class="fm-results" id="fm-results"></div>`;
    document.getElementById('fm-q').focus();
  }
  function musicClose() {
    const box = document.getElementById('focus-music');
    if (!box) return;
    box.classList.remove('adding');
    box.innerHTML = musicHTML();
  }
  function musicSearch(q) {
    clearTimeout(addTimer);
    const out = document.getElementById('fm-results');
    if (!out) return;
    if (!q.trim()) { out.innerHTML = ''; return; }
    // A pasted link (a YouTube playlist, a Spotify album…) is added as it
    // is rather than searched for.
    const link = window.Music && Music.linkFrom(q);
    if (link) {
      const e = Music.embedFor(link);
      if (!e) { out.innerHTML = '<p class="fm-note">That link isn\'t from Spotify, YouTube, Apple Music, SoundCloud or Deezer.</p>'; return; }
      addResults = [{ url: link, title: `${e.service} link`, service: e.service, kind: /[?&]list=|\/playlist\/|\/sets\//.test(link) ? 'playlist' : 'link' }];
      const paint = () => { out.innerHTML = `<button type="button" class="fm-hit" onclick="Jarvis.musicPick(0)"><span class="fm-art">${icon('music')}</span>
          <span class="min-w-0 flex-1"><b>${esc(addResults[0].title)}</b><small>${esc([e.service, addResults[0].kind === 'playlist' ? 'Playlist' : ''].filter(Boolean).join(' · '))} · tap to play and save</small></span>${icon('play')}</button>`; };
      paint();
      API.musicTitle(link).then(r => { if (r && r.title && addResults[0] && addResults[0].url === link) { addResults[0].title = r.title; paint(); } }).catch(() => {});
      return;
    }
    out.innerHTML = '<p class="fm-note">Searching…</p>';
    addTimer = setTimeout(async () => {
      try {
        const r = await API.searchMusic(q.trim());
        addResults = (r.results || []).slice(0, 5);
        API.trackFeature('music_search');
        out.innerHTML = addResults.length ? addResults.map((x, i) => `<button type="button" class="fm-hit" onclick="Jarvis.musicPick(${i})">
            ${x.art ? `<img src="${esc(x.art)}" alt="" loading="lazy">` : `<span class="fm-art">${icon('music')}</span>`}
            <span class="min-w-0 flex-1"><b>${esc(x.title)}</b><small>${esc([x.service, x.kind === 'playlist' ? 'Playlist' : '', x.by].filter(Boolean).join(' · '))}</small></span>${icon('play')}</button>`).join('')
          : '<p class="fm-note">Nothing found. Try another name.</p>';
      } catch { out.innerHTML = '<p class="fm-note">Search isn\'t available right now.</p>'; }
    }, 350);
  }
  async function musicPick(i) {
    const x = addResults[i];
    if (!x || !window.Why) return;
    const label = x.kind === 'song' && x.by ? `${x.title} · ${x.by}` : x.title;
    try {
      const at = await Why.addPlaylist(x.url, label);
      await Why.playMusic(Math.max(0, at));
      showToast(`Playing “${label}”. Saved to your music`);
    } catch { showToast('Could not add that', 'error'); }
    musicClose();
  }
  // The minimised timer shows a dot: ahead of, on or behind plan.
  function paceChanged(r) {
    const hud = document.getElementById('focus-hud');
    if (hud) hud.dataset.pace = r ? r.state : '';
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
      if (window.DayRoad) DayRoad.refresh();
      if (APP.currentPage === 'dashboard' && typeof renderDashboard === 'function') renderDashboard(); // eslint-disable-line no-undef
    } catch (e) { taskErrorToast(e, 'Could not finish that task'); }
  }
  function startNext() {
    const nx = focus && focus.next;
    if (!nx) { stopFocus(true); return; }
    startFocus({ taskId: nx.id, title: nx.title, minutes: planMins(nx.id), music: true });
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
  // The top of the dashboard, kept light: the greeting, today's plan with
  // the time of what's next, and one tap to Start my day. The quote, the
  // music and reading the day out live in the morning flow instead.
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
    // A plan made on another device (or last night) comes from the server.
    if (!planGet()) {
      try {
        const sp = await API.getDayPlan(today);
        if (sp && sp.items && sp.items.length) store.set(PLAN_KEY, { date: today, ids: sp.items.map(i => i.taskId), minutes: sp.items[0].minutes, mins: Object.fromEntries(sp.items.map(i => [i.taskId, i.minutes])), starts: Object.fromEntries(sp.items.map(i => [i.taskId, i.start])) });
      } catch { /* offline */ }
    }
    const plan = planGet();
    const planDone = plan ? plan.ids.filter(id => tasks.some(t => t.id === id && t.status === 'Completed')).length : 0;
    const planNext = plan ? await nextInPlan(tasks) : null;
    const taskLink = t => `<button type="button" onclick="openTaskDetail('${t.id}')">${esc(t.title)}</button>`;
    const at = planNext && plan.starts && plan.starts[planNext.id] ? ` at ${plan.starts[planNext.id]}` : '';
    const sum = plan ? (planNext ? `Today's plan: ${planDone} of ${plan.ids.length} done · Next${at}: ${taskLink(planNext)}` : `Today's plan is done: ${planDone} of ${plan.ids.length}. Great work.`)
      : open.length ? '' // Your focus, right under this, lists what's first
        : 'Nothing open. A good day to plan the next goal.';
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
    box.innerHTML = `<div class="brief-card">
      <div class="brief-top">
        <p class="brief-date"><span class="brief-orb" aria-hidden="true"><span></span></span>${esc(dateText)}</p>
        <div class="brief-pills"></div>
      </div>
      <p class="brief-hello">${esc(hello)}${name ? `, ${esc(name)}` : ''}.</p>
      ${sum ? `<p class="brief-sum">${sum}</p>` : ''}
      <div data-dayroad="card" class="hidden"></div>
      ${mainBtn ? `<div class="brief-actions"><div class="brief-main">${mainBtn}${plan ? `<button type="button" class="brief-plan" onclick="Jarvis.openPlanner()" aria-label="Change today's plan" title="Change today's plan">${icon('list-checks')}</button>` : ''}</div></div>` : ''}
    </div>`;
    const slot = box.querySelector('.brief-pills');
    pills.forEach(p => slot.appendChild(p));
    document.getElementById('dash-head')?.classList.add('hidden');
    if (window.DayRoad) { DayRoad.render(); DayRoad.refresh(); }
  }
  const hear = () => { API.trackFeature('listen'); if (brief) say(brief.spoken); };

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
    API.trackFeature('start_day');
    const plan = planGet();
    if (plan) {
      const nx = await nextInPlan().catch(() => null);
      if (nx) { startFocus({ taskId: nx.id, title: nx.title, minutes: planMins(nx.id, plan), music: true }); return; }
    }
    openPlanner();
  }
  // ── The morning: a timetable, blockers, a song, then go ──
  // Start my day is three short steps. 1, Your day: the tasks for today
  // as a timetable, each with a start time and a length, worked out from
  // when you start (reorder, change lengths, add or drop). 2, Anything in
  // the way: the blockers already on today's tasks, and room to add one.
  // 3, A song to start: pick from your music or skip. Then today's quote
  // shows for a moment and fades, and the first task starts. The plan is
  // kept on the server (backend/dayPlan.js) so the evening report and the
  // Pacer can use it, and on this device so focus sessions chain.
  const LENGTHS = [15, 30, 45, 60, 90, 120];
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const fromMin = m => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const lenText = m => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);
  const planMins = (id, plan = planGet()) => (plan && plan.mins && plan.mins[id]) || (plan && plan.minutes) || 25;
  const nextQuarter = () => { const d = new Date(); return fromMin(Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15); };

  let planner = null;
  async function openPlanner() {
    let tasks, projects, saved = null;
    try { [tasks, projects] = await Promise.all([API.getTasks(), API.getProjects()]); } catch { showToast('Could not load your tasks', 'error'); return; }
    const today = localDateKey(new Date());
    try { saved = await API.getDayPlan(today); } catch { /* offline: start fresh */ }
    const soon = localDateKey(new Date(Date.now() + 3 * 86400000));
    const byId = Object.fromEntries(projects.map(p => [p.id, p]));
    const due = t => (t.endDate || '').slice(0, 10);
    const blocked = t => (t.obstacles || []).some(o => !o.resolved);
    const rank = t => (due(t) && due(t) < today ? 0 : due(t) === today ? 1 : t.status === 'In Progress' ? 2 : due(t) && due(t) <= soon ? 3 : 4);
    const open = tasks.filter(t => t.status !== 'Completed')
      .sort((a, b) => rank(a) - rank(b) || (due(a) || '9999').localeCompare(due(b) || '9999') || (a.priority === 'High' ? -1 : b.priority === 'High' ? 1 : 0));
    const byTask = Object.fromEntries(open.map(t => [t.id, t]));
    const guess = t => (t.priority === 'High' ? 60 : 30);
    let items, start;
    if (saved && saved.items && saved.items.length) {
      items = saved.items.filter(i => byTask[i.taskId]).map(i => ({ id: i.taskId, minutes: i.minutes }));
      start = saved.items[0].start;
    } else {
      items = open.filter(t => !blocked(t) && rank(t) <= 2).slice(0, 3).map(t => ({ id: t.id, minutes: guess(t) }));
      if (!items.length) items = open.filter(t => !blocked(t)).slice(0, 3).map(t => ({ id: t.id, minutes: guess(t) }));
      start = nextQuarter();
    }
    const editable = id => { const r = (byId[id] || {}).role; return r === 'owner' || r === 'editor'; };
    const home = open.find(t => editable(t.projectId))?.projectId || projects.find(p => p.role === 'owner' && !p.parentId)?.id;
    planner = { open, byTask, items, start, byId, today, home, step: 1, song: null, guess };

    document.getElementById('day-plan')?.remove();
    const el = document.createElement('div');
    el.id = 'day-plan';
    el.className = 'dayplan-overlay';
    el.innerHTML = `<div class="dayplan" role="dialog" aria-modal="true" aria-labelledby="dayplan-title">
      <div class="dayplan-head">
        <div><p class="dayplan-kicker">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
        <h3 id="dayplan-title"></h3>
        <p class="dayplan-sub" id="dayplan-sub"></p></div>
        <button type="button" class="dayplan-x" onclick="Jarvis.closePlanner()" aria-label="Close">${icon('close')}</button>
      </div>
      <ol class="dayplan-steps" aria-label="Steps">${['Your day', 'Blockers', 'Music'].map((n, i) => `<li data-s="${i + 1}">${n}</li>`).join('')}</ol>
      <div id="dayplan-body"></div>
      <div class="dayplan-foot" id="dayplan-foot"></div>
    </div>`;
    el.addEventListener('click', e => { if (e.target === el) closePlanner(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') closePlanner(); });
    document.body.appendChild(el);
    paintPlanner();
    setTimeout(() => el.querySelector('.dayplan-go')?.focus(), 50);
  }
  // Start times follow from the first one and each task's length.
  function timesFor(P) {
    let at = toMin(P.start);
    return P.items.map(i => { const s = fromMin(at); at += i.minutes; return s; });
  }
  function paintPlanner() {
    const P = planner;
    const body = document.getElementById('dayplan-body');
    if (!P || !body) return;
    document.querySelectorAll('#day-plan .dayplan-steps li').forEach(li => {
      const n = Number(li.dataset.s);
      li.className = n === P.step ? 'on' : n < P.step ? 'done' : '';
      if (n === P.step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    const title = document.getElementById('dayplan-title');
    const sub = document.getElementById('dayplan-sub');
    const foot = document.getElementById('dayplan-foot');
    const blockedNow = t => (t.obstacles || []).filter(o => !o.resolved);
    const proj = t => esc((P.byId[t.projectId] || {}).title || '');
    if (P.step === 1) {
      title.textContent = P.items.length ? "Here's your day" : "Let's plan your day";
      sub.textContent = 'Times follow from when you start and how long each takes. Move things up or down, or change a length.';
      const times = timesFor(P);
      const end = P.items.length ? fromMin(toMin(P.start) + P.items.reduce((n, i) => n + i.minutes, 0)) : null;
      const rest = P.open.filter(t => !P.items.some(i => i.id === t.id)).slice(0, 6);
      body.innerHTML = `
        <label class="dayplan-start">${icon('clock', 'tiny')}Start at <input type="time" id="dayplan-start" value="${P.start}" onchange="Jarvis.plannerStart(this.value)"></label>
        <ol class="dayplan-tt">${P.items.map((it, i) => {
          const t = P.byTask[it.id];
          const b = blockedNow(t).length;
          return `<li class="dayplan-slot">
            <span class="dayplan-time">${times[i]}</span>
            <span class="min-w-0 flex-1"><span class="dayplan-t">${esc(t.title)}</span>
            <span class="dayplan-m">${proj(t)}${b ? ` · <b class="dayplan-blk">${icon('blocker', 'tiny')}${b} ${b === 1 ? 'blocker' : 'blockers'}</b>` : ''}</span></span>
            <select class="dayplan-mins" aria-label="How long for ${esc(t.title)}" onchange="Jarvis.plannerLen(${i}, this.value)">${[...new Set([...LENGTHS, it.minutes])].sort((a, z) => a - z).map(m => `<option value="${m}" ${m === it.minutes ? 'selected' : ''}>${lenText(m)}</option>`).join('')}</select>
            <span class="dayplan-move">
              <button type="button" onclick="Jarvis.plannerMove(${i}, -1)" ${i ? '' : 'disabled'} aria-label="Earlier">${icon('chevron_up')}</button>
              <button type="button" onclick="Jarvis.plannerMove(${i}, 1)" ${i < P.items.length - 1 ? '' : 'disabled'} aria-label="Later">${icon('chevron_down')}</button>
            </span>
            <button type="button" class="dayplan-drop" onclick="Jarvis.plannerToggle('${it.id}')" aria-label="Take ${esc(t.title)} out of today">${icon('close')}</button>
          </li>`;
        }).join('') || '<li class="dayplan-empty">Nothing planned yet. Add something below.</li>'}</ol>
        ${end ? `<p class="dayplan-end">${P.items.length} ${P.items.length === 1 ? 'task' : 'tasks'} · done by about <b>${end}</b></p>` : ''}
        ${rest.length ? `<p class="dayplan-label">Add from your list</p><div class="dayplan-more">${rest.map(t => `<button type="button" onclick="Jarvis.plannerToggle('${t.id}')">${icon('plus', 'tiny')}<span>${esc(t.title)}</span></button>`).join('')}</div>` : ''}
        ${P.home ? `<form class="dayplan-add" onsubmit="event.preventDefault(); Jarvis.plannerAdd()">
          <input id="dayplan-new" maxlength="200" placeholder="Something new for today…" aria-label="Add a new task for today">
          <button type="submit">${icon('plus')}Add</button></form>` : ''}`;
      foot.innerHTML = `<div class="dayplan-tools">
          <button type="button" class="dayplan-ai" onclick="Jarvis.plannerHear()">${icon('volume', 'tiny')} Read my day out</button>
          <button type="button" class="dayplan-ai" onclick="Jarvis.plannerAsk()">${icon('sparkles', 'tiny')} Plan it with the assistant</button>
        </div>
        <button type="button" class="dayplan-go" onclick="Jarvis.plannerStep(2)" ${P.items.length ? '' : 'disabled'}>Next ${icon('chevron_right')}</button>`;
    } else if (P.step === 2) {
      title.textContent = 'Anything in your way today?';
      sub.textContent = 'Name what could hold you up, so you can deal with it early.';
      const known = P.items.flatMap(it => blockedNow(P.byTask[it.id]).map(o => ({ o, t: P.byTask[it.id] })));
      body.innerHTML = `${known.length ? `<ul class="dayplan-blockers">${known.map(({ o, t }) => `<li>${icon('blocker', 'tiny')}<span><b>${esc(o.name)}</b>${o.count > 1 ? ` ×${o.count}` : ''}<small>${esc(t.title)}</small></span></li>`).join('')}</ul>`
        : `<p class="dayplan-clear">${icon('check', 'tiny')}No blockers on today's tasks yet.</p>`}
        <form class="dayplan-add dayplan-addblk" onsubmit="event.preventDefault(); Jarvis.plannerBlocker()">
          <select id="dayplan-blk-task" aria-label="Which task">${P.items.map(it => `<option value="${it.id}">${esc(P.byTask[it.id].title)}</option>`).join('')}</select>
          <input id="dayplan-blk" maxlength="120" placeholder="e.g. Waiting on a reply" aria-label="What's in the way">
          <button type="submit">${icon('plus')}Add</button>
        </form>`;
      foot.innerHTML = `<button type="button" class="dayplan-back" onclick="Jarvis.plannerStep(1)">${icon('chevron_left')}Back</button>
        <button type="button" class="dayplan-go" onclick="Jarvis.plannerStep(3)">${known.length ? 'Next' : 'Nothing, next'} ${icon('chevron_right')}</button>`;
    } else {
      title.textContent = 'Start with a song?';
      sub.textContent = 'It plays while you work on the first task.';
      const lists = (window.Why && Why.get && (Why.get() || {}).playlists) || [];
      body.innerHTML = lists.length ? `<div class="dayplan-songs">${lists.slice(0, 4).map((l, i) => `<button type="button" onclick="Jarvis.plannerGo(${i})">${icon('music')}<span>${esc(l.label || 'My music')}</span>${icon('play', 'tiny')}</button>`).join('')}</div>`
        : `<p class="dayplan-clear">${icon('music', 'tiny')}No music saved yet. You can add some in Your why later.</p>`;
      foot.innerHTML = `<button type="button" class="dayplan-back" onclick="Jarvis.plannerStep(2)">${icon('chevron_left')}Back</button>
        <button type="button" class="dayplan-go" onclick="Jarvis.plannerGo(-1)">${icon('play')}${lists.length ? 'No music, start' : 'Start my day'}</button>`;
    }
  }
  function plannerStep(n) { if (planner && (n === 1 || planner.items.length)) { planner.step = n; paintPlanner(); document.querySelector('#day-plan .dayplan-go')?.focus(); } }
  function plannerStart(v) { if (planner && /^\d{2}:\d{2}$/.test(v)) { planner.start = v; paintPlanner(); } }
  function plannerToggle(id) {
    const P = planner;
    if (!P) return;
    const i = P.items.findIndex(x => x.id === id);
    if (i >= 0) P.items.splice(i, 1);
    else if (P.byTask[id]) P.items.push({ id, minutes: P.guess(P.byTask[id]) });
    paintPlanner();
  }
  function plannerLen(i, m) { if (planner && planner.items[i]) { planner.items[i].minutes = Number(m); paintPlanner(); } }
  function plannerMove(i, d) {
    const L = planner && planner.items;
    if (!L || !L[i] || !L[i + d]) return;
    [L[i], L[i + d]] = [L[i + d], L[i]];
    paintPlanner();
  }
  async function plannerAdd() {
    const input = document.getElementById('dayplan-new');
    const title = input.value.trim();
    if (!title || !planner || !planner.home) return;
    input.disabled = true;
    try {
      const t = await API.addTask({ projectId: planner.home, title, status: 'Not Started', priority: 'Medium', startDate: planner.today, endDate: planner.today });
      planner.open.unshift(t);
      planner.byTask[t.id] = t;
      planner.items.push({ id: t.id, minutes: 30 });
      paintPlanner();
      document.getElementById('dayplan-new')?.focus();
    } catch (e) { showToast(e.message || 'Could not add that', 'error'); input.disabled = false; }
  }
  async function plannerBlocker() {
    const P = planner;
    const input = document.getElementById('dayplan-blk');
    const taskId = document.getElementById('dayplan-blk-task').value;
    const name = input.value.trim();
    if (!P || !name || !P.byTask[taskId]) return;
    input.disabled = true;
    try {
      const o = await API.addObstacle(taskId, name, 1);
      const t = P.byTask[taskId];
      t.obstacles = [...(t.obstacles || []), { ...o, name, resolved: false }];
      paintPlanner();
      document.getElementById('dayplan-blk')?.focus();
    } catch (e) { showToast(e.message || 'Could not add that blocker', 'error'); input.disabled = false; }
  }
  function plannerHear() {
    const P = planner;
    if (!P || !P.items.length) return;
    API.trackFeature('listen');
    const times = timesFor(P);
    say(`Here's your day. ${P.items.map((it, i) => `At ${times[i]}, ${P.byTask[it.id].title}, ${lenText(it.minutes).replace('min', 'minutes').replace(' h', ' hours')}.`).join(' ')}`);
  }
  function plannerAsk() {
    closePlanner();
    if (typeof paletteAsk === 'function') paletteAsk("Help me plan my day. Look at what's late, due and in progress, and tell me what to do first, second and third, with a time for each."); // eslint-disable-line no-undef
    else openAssistant();
  }
  function closePlanner() { document.getElementById('day-plan')?.remove(); planner = null; }
  async function plannerGo(song) {
    const P = planner;
    if (!P || !P.items.length) return;
    document.querySelectorAll('#day-plan button').forEach(b => { b.disabled = true; });
    const times = timesFor(P);
    const items = P.items.map((it, i) => ({ taskId: it.id, start: times[i], minutes: it.minutes }));
    // Late ones they kept move to today.
    const editable = t => { const r = (P.byId[t.projectId] || {}).role; return r === 'owner' || r === 'editor'; };
    const late = P.items.map(it => P.byTask[it.id]).filter(t => (t.endDate || '').slice(0, 10) && t.endDate.slice(0, 10) < P.today && editable(t));
    await Promise.all([
      ...late.map(t => API.updateTask(t.id, { endDate: P.today }).catch(() => null)),
      API.saveDayPlan(P.today, items).catch(() => null),
    ]);
    store.set(PLAN_KEY, { date: P.today, ids: items.map(i => i.taskId), minutes: items[0].minutes, mins: Object.fromEntries(items.map(i => [i.taskId, i.minutes])), starts: Object.fromEntries(items.map(i => [i.taskId, i.start])) });
    const first = P.byTask[items[0].taskId];
    const firstMins = items[0].minutes;
    closePlanner();
    if (song >= 0 && window.Why) Why.playMusic(song).catch?.(() => {});
    await showQuote();
    startFocus({ taskId: first.id, title: first.title, minutes: firstMins, music: false });
    say(`Today: ${items.length} ${items.length === 1 ? 'thing' : 'things'}, done by about ${fromMin(toMin(items[0].start) + items.reduce((n, i) => n + i.minutes, 0))}. First up: ${first.title}. Let's go.`);
    if (APP.currentPage === 'dashboard' && typeof renderDashboard === 'function') renderDashboard(); // eslint-disable-line no-undef
  }
  // Today's quote, full screen for a moment, then it fades and the day
  // begins. A tap skips it. Nothing to show, nothing waits.
  function showQuote() {
    const why = window.Why && Why.get ? Why.get() : null;
    const q = window.Why && Why.todaysQuote ? Why.todaysQuote() : null;
    const text = q ? q.text : why && why.why ? `Remember why: ${why.why}` : '';
    if (!text) return Promise.resolve();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.className = 'day-quote';
      el.setAttribute('role', 'status');
      el.innerHTML = `<figure><blockquote>“${esc(text.replace(/^Remember why: /, ''))}”</blockquote>${q && q.source ? `<figcaption>${esc(q.source)}</figcaption>` : text.startsWith('Remember why') ? '<figcaption>Your why</figcaption>' : ''}</figure><p class="day-quote-skip">Tap to start</p>`;
      document.body.appendChild(el);
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        el.classList.add('out');
        setTimeout(() => { el.remove(); resolve(); }, reduce ? 0 : 600);
      };
      el.addEventListener('click', finish);
      setTimeout(finish, reduce ? 3500 : 4200);
    });
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

  return { startFocus, stopFocus, togglePause, toggleMin, hideTimer, showTimer, startNext, takeBreak, openPlanner, closePlanner, plannerToggle, plannerLen, plannerMove, plannerStart, plannerStep, plannerBlocker, plannerHear, plannerAdd, plannerAsk, plannerGo, extend, focusDone, resumeFocus, handle, renderBriefing, musicAdd, musicClose, musicSearch, musicPick, syncMusic, paceChanged, hear, startDay, talk, isFocusing: () => !!focus };
})();
window.Jarvis = Jarvis;
