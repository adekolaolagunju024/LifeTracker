/* global API, esc, icon, showToast, showPage, Music */
// ── YOUR WHY ────────────────────────────────────────────────────
// What gets this particular person moving when they'd rather not
// (backend/motivation.js): why the goal matters, who they're becoming, a
// mentor and that mentor's routine, the quotes that move them, and the
// music they work to. Set up on the Your why page; shown where people give
// up: the dashboard, the alarm screen, a stuck task, phone nudges and the
// assistant's coaching.
const Why = (() => {
  let data = null;      // { motivation, library, mentors }
  let draft = null;     // the page's working copy
  let loading = null;

  async function load(force) {
    if (data && !force) return data;
    if (!loading) loading = API.getMotivation().then(d => { data = d; if (window.Music) Music.restore(d.motivation.playlists); return d; }).finally(() => { loading = null; });
    return loading;
  }
  const m = () => (data && data.motivation) || null;
  const isEmpty = x => !x || (!x.why && !x.becoming && !x.mentor.name && !x.quotes.length && !x.playlists.length);
  // Today's quote: a different one each day, picked at random (the same
  // all day) from their own quotes and the starter shelf, only from the
  // sources they chose, never one from a faith they didn't pick. With no
  // quotes and no sources chosen, the neutral books and speeches shelf.
  const localKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function quotePool(x) {
    if (!x) return [];
    const own = x.quotes || [];
    const groups = (x.sources && x.sources.length) ? x.sources : (own.length ? [] : ['Books and speeches']);
    const shelf = ((data && data.library) || []).filter(q => groups.includes(q.group) && !own.some(o => o.text === q.text));
    return [...own, ...shelf.map(q => ({ text: q.text, source: q.source }))];
  }
  function todaysQuote(x, date = new Date()) {
    const pool = quotePool(x);
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    const pick = d => hash(`${localKey(d)}:${pool.length}`) % pool.length;
    let i = pick(date);
    const yesterday = new Date(date); yesterday.setDate(yesterday.getDate() - 1);
    if (i === pick(yesterday)) i = (i + 1) % pool.length; // never the same two days running
    return pool[i];
  }
  const mentorOf = x => {
    if (!x || !x.mentor.name) return null;
    const preset = data.mentors.find(p => p.id === x.mentor.preset);
    return { name: x.mentor.name, routine: x.mentor.routine || (preset && preset.routine) || '', says: x.mentor.says || (preset && preset.says) || '' };
  };

  // Plays from their music library in the app's player (see Music below):
  // the default one, or the one at `index`.
  async function playMusic(index = 0) {
    try { await load(); } catch { /* offline: fall through */ }
    const x = m();
    const list = draft && document.getElementById('why-body')?.offsetParent ? draft.playlists : x ? x.playlists : [];
    if (!list.length) { showToast('Add your music in Your why first'); showPage('why'); return; }
    Music.start(list, Math.min(index, list.length - 1));
  }
  const musicButton = (cls = 'why-music') => {
    const x = m();
    return x && x.playlists.length ? `<button type="button" class="${cls}" onclick="Why.playMusic()">${icon('music')}Play ${esc(x.playlists[0].label || 'my music')}</button>` : '';
  };

  // ── Dashboard card ──
  async function renderDashboard() {
    const box = document.getElementById('dash-why');
    if (!box) return;
    try { await load(); } catch { box.classList.add('hidden'); return; }
    const x = m();
    if (isEmpty(x)) {
      box.classList.remove('hidden');
      box.innerHTML = `<div class="why-card is-empty">
        <span class="why-card-ic">${icon('heart')}</span>
        <div class="min-w-0 flex-1"><p class="why-card-title">What keeps you going?</p>
        <p class="why-card-sub">Add your reason, someone you look up to, a quote that moves you and your focus music. KolaWay shows them when you need them most.</p></div>
        <button type="button" class="why-card-cta" onclick="showPage('why')">Set up your why</button></div>`;
      return;
    }
    if (!x.show.dashboard) { box.classList.add('hidden'); return; }
    const q = todaysQuote(x);
    const mentor = mentorOf(x);
    box.classList.remove('hidden');
    box.innerHTML = `<div class="why-card">
      <div class="min-w-0 flex-1">
        ${q ? `<p class="why-quote">“${esc(q.text)}”</p>${q.source ? `<p class="why-source">${esc(q.source)}</p>` : ''}` : ''}
        ${x.why || x.becoming ? `<p class="why-line">${x.why ? `<b>Your why:</b> ${esc(x.why)}` : ''}${x.why && x.becoming ? ' · ' : ''}${x.becoming ? `<b>Becoming:</b> ${esc(x.becoming)}` : ''}</p>` : ''}
        ${mentor && mentor.routine ? `<p class="why-line">${icon('user', 'tiny mr-1')}<b>${esc(mentor.name)}:</b> ${esc(mentor.routine)}</p>` : ''}
      </div>
      <div class="why-actions">${musicButton()}<button type="button" class="why-edit" onclick="showPage('why')" aria-label="Edit your why">${icon('edit')}</button></div>
    </div>`;
  }

  // ── The alarm screen and a stuck task: the moments people give up ──
  function alarmHTML() {
    const x = m();
    if (isEmpty(x) || !x.show.alarms) return '';
    const q = todaysQuote(x);
    const mentor = mentorOf(x);
    return `<div class="alarm-why">
      ${mentor && mentor.says ? `<p class="alarm-why-mentor">${icon('user', 'tiny mr-1')}<b>${esc(mentor.name)}</b> would say: “${esc(mentor.says)}”</p>` : ''}
      ${q ? `<p class="alarm-why-quote">“${esc(q.text)}”${q.source ? ` <span>${esc(q.source)}</span>` : ''}</p>` : x.why ? `<p class="alarm-why-quote">Remember why: ${esc(x.why)}</p>` : ''}
      ${musicButton('alarm-music')}
    </div>`;
  }
  function stuckHTML() {
    const x = m();
    if (isEmpty(x)) return `<button type="button" class="why-link" onclick="showPage('why')">${icon('heart', 'tiny mr-1')}Add what keeps you going</button>`;
    const mentor = mentorOf(x);
    return `${mentor ? `<p class="why-stuck">What would <b>${esc(x.mentor.preset ? mentor.name.toLowerCase() : mentor.name)}</b> do? ${esc(mentor.says || mentor.routine)}</p>` : x.why ? `<p class="why-stuck">Remember why: ${esc(x.why)}</p>` : ''}${musicButton('why-music small')}`;
  }
  async function fillStuck() {
    const box = document.getElementById('td-why');
    if (!box) return;
    try { await load(); } catch { return; }
    box.innerHTML = stuckHTML();
  }

  // ── The Your why page ──
  // At a glance first (your why, who you're becoming, your mentor, today's
  // quote, your music), then one section at a time in tabs. The coach chat
  // opens on demand (by itself when there's nothing here yet). Everything
  // saves as you go: no Save button.
  const TABS = [['you', 'heart', 'About you'], ['mentor', 'user', 'Mentor'], ['quotes', 'book', 'Quotes'], ['music', 'music', 'Music'], ['reminders', 'bell', 'Reminders']];
  let tab = (() => { try { return localStorage.getItem('wp-why-tab') || 'you'; } catch { return 'you'; } })();
  async function renderPage() {
    API.trackFeature('why');
    const body = document.getElementById('why-body');
    body.innerHTML = '<p class="text-sm text-gray-400 py-10 text-center">Loading…</p>';
    try { await load(true); } catch (e) { body.innerHTML = `<p class="text-sm text-red-500">${esc(e.message || 'Could not load')}</p>`; return; }
    draft = JSON.parse(JSON.stringify(m()));
    accts = null; // check linked accounts afresh each visit
    const fresh = isEmpty(m());
    body.innerHTML = `
      <div class="why-bar">
        <button type="button" class="why-talk" id="why-talk-btn" onclick="Why.toggleChat()" aria-expanded="${fresh}">${icon('sparkles', 'tiny')}<span>${fresh ? "Let's find your why" : 'Talk it through'}</span></button>
        <span class="why-status" id="why-status" aria-live="polite"></span>
      </div>
      <section class="why-chat" id="why-chat" ${fresh ? '' : 'hidden'}>
        <div class="why-chat-head">
          <div class="brief-orb small" aria-hidden="true"><span></span></div>
          <div class="min-w-0 flex-1"><p class="why-chat-title">${fresh ? "Let's find your why" : 'Talk it through again'}</p><p class="why-chat-sub">A two-minute chat with your coach. Talk or type, and it fills this in for you.</p></div>
          ${fresh ? '' : `<button type="button" class="why-chat-x" onclick="Why.toggleChat(false)" aria-label="Close the chat">${icon('close')}</button>`}
        </div>
        <div class="why-chat-log" id="why-chat-log" aria-live="polite"></div>
        <form class="why-chat-input" onsubmit="event.preventDefault(); Why.interviewSend();">
          <button type="button" class="why-chat-mic" id="why-chat-mic" onclick="Why.interviewListen()" aria-label="Talk instead of typing">${icon('mic')}</button>
          <input id="why-chat-in" autocomplete="off" maxlength="1500" placeholder="Type your answer, or tap the mic">
          <button type="submit" class="why-chat-send" aria-label="Send">${icon('send')}</button>
        </form>
      </section>
      <div id="why-glance"></div>
      <div class="why-tabs" role="tablist" aria-label="Your why" id="why-tabs"></div>
      <div id="why-form" role="tabpanel"></div>`;
    interview = { messages: [{ role: 'assistant', content: fresh ? "Hi! What's the one goal you most want to reach right now?" : "What's changed? Tell me about the goal you're most focused on now." }] };
    renderChat();
    paint();
  }
  function toggleChat(open) {
    const chat = document.getElementById('why-chat');
    if (!chat) return;
    const show = open === undefined ? chat.hidden : open;
    chat.hidden = !show;
    document.getElementById('why-talk-btn')?.setAttribute('aria-expanded', String(show));
    if (show) setTimeout(() => document.getElementById('why-chat-in')?.focus(), 50);
  }
  function setTab(t) {
    tab = t;
    try { localStorage.setItem('wp-why-tab', t); } catch { /* private mode */ }
    paint();
  }

  // ── Saving as you go ──
  let saveTimer = null; let saving = null;
  function status(text) { const el = document.getElementById('why-status'); if (el) el.innerHTML = text; }
  async function saveNow() {
    clearTimeout(saveTimer);
    status(`<span class="why-saving">Saving…</span>`);
    const snapshot = JSON.parse(JSON.stringify(draft));
    saving = API.saveMotivation({ ...snapshot, playlist: null });
    try {
      const r = await saving;
      data.motivation = r.motivation;
      status(`${icon('check', 'tiny')} Saved`);
      paintGlance();
    } catch (e) { status(`<span class="why-err">Not saved. ${esc(e.message || 'Try again')}</span>`); }
    saving = null;
  }
  // Typing waits a moment; taps save straight away.
  function changed(repaint = true) {
    if (repaint) paint();
    clearTimeout(saveTimer);
    status('<span class="why-saving">Saving…</span>');
    saveTimer = setTimeout(saveNow, repaint ? 50 : 700);
  }

  // ── The interview ──
  let interview = null;
  let voiceTurn = false;
  function renderChat() {
    const log = document.getElementById('why-chat-log');
    if (!log) return;
    log.innerHTML = interview.messages.map(x => `<div class="why-msg ${x.role}">${esc(x.content)}</div>`).join('') + (interview.busy ? '<div class="why-msg assistant"><span class="asst-typing" role="status" aria-label="Thinking"><i></i><i></i><i></i></span></div>' : '');
    log.scrollTop = log.scrollHeight;
  }
  async function interviewSend() {
    API.trackFeature('why_coach');
    const input = document.getElementById('why-chat-in');
    const text = input.value.trim();
    if (!text || interview.busy) return;
    input.value = '';
    interview.messages.push({ role: 'user', content: text });
    interview.busy = true; renderChat();
    try {
      const r = await API.whyInterview(interview.messages);
      interview.busy = false;
      interview.messages.push({ role: 'assistant', content: r.text });
      renderChat();
      if (voiceTurn && window.Voice) Voice.speak(r.text);
      if (r.type === 'draft') applyDraft(r.draft);
    } catch (e) {
      interview.busy = false;
      interview.messages.push({ role: 'assistant', content: e.message || 'Something went wrong. You can fill it in yourself below.' });
      renderChat();
    }
    voiceTurn = false;
    input.focus();
  }
  // The coach's draft goes into the form for them to check, then Save.
  function applyDraft(d) {
    ['why', 'becoming'].forEach(k => { if (d[k]) draft[k] = d[k]; });
    if (d.sources && d.sources.length) draft.sources = d.sources;
    if (d.mentor && d.mentor.name) draft.mentor = d.mentor;
    d.quotes.forEach(q => { if (!draft.quotes.some(x => x.text === q.text) && draft.quotes.length < 12) draft.quotes.push(q); });
    d.playlists.forEach(p => { if (!draft.playlists.some(x => x.url === p.url) && draft.playlists.length < 12) draft.playlists.push(p); });
    tab = 'you';
    changed();
    showToast('Your coach filled this in and saved it. Change anything you like');
    setTimeout(() => document.getElementById('why-glance')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }
  function interviewListen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast('Voice isn\u2019t available in this browser. You can type instead'); return; }
    const rec = new SR();
    rec.lang = navigator.language || 'en-GB';
    rec.interimResults = true;
    const btn = document.getElementById('why-chat-mic');
    const input = document.getElementById('why-chat-in');
    btn.classList.add('on');
    let finalText = '';
    rec.onresult = ev => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript;
      }
      input.value = (finalText + interim).trim();
    };
    rec.onerror = () => btn.classList.remove('on');
    rec.onend = () => { btn.classList.remove('on'); if (finalText.trim()) { voiceTurn = true; interviewSend(); } };
    try { rec.start(); } catch { btn.classList.remove('on'); }
  }

  // At a glance: what you've got, each part a tap from its tab.
  function paintGlance() {
    const el = document.getElementById('why-glance');
    if (!el) return;
    const x = m();
    if (isEmpty(x)) { el.innerHTML = ''; return; }
    const q = todaysQuote(x);
    const mentor = mentorOf(x);
    const music = x.playlists[0];
    const chip = (t, ic, label, value) => `<button type="button" class="why-gl-chip" onclick="Why.setTab('${t}')">${icon(ic)}<span class="min-w-0"><small>${label}</small><b>${value}</b></span></button>`;
    el.innerHTML = `<div class="why-glance">
      ${x.why ? `<button type="button" class="why-gl-main" onclick="Why.setTab('you')"><small>Your why</small><span>${esc(x.why)}</span></button>` : `<button type="button" class="why-gl-main empty" onclick="Why.setTab('you')"><small>Your why</small><span>Add the real reason this matters</span></button>`}
      ${x.becoming ? `<p class="why-gl-becoming">Becoming <b>${esc(x.becoming)}</b></p>` : ''}
      <div class="why-gl-row">
        ${chip('mentor', 'user', 'Mentor', mentor ? esc(mentor.name) : 'Add one')}
        ${chip('quotes', 'book', "Today's quote", q ? `“${esc(q.text)}”` : 'Add one')}
        ${chip('music', 'music', 'Music', music ? esc(music.label || 'Your music') : 'Add some')}
      </div>
    </div>`;
  }

  function paint() {
    const body = document.getElementById('why-form');
    if (!body) return;
    paintGlance();
    const counts = { quotes: draft.quotes.length, music: draft.playlists.length };
    document.getElementById('why-tabs').innerHTML = TABS.map(([t, ic, label]) => `<button type="button" role="tab" aria-selected="${t === tab}" class="why-tab ${t === tab ? 'on' : ''}" onclick="Why.setTab('${t}')">${icon(ic, 'tiny')}<span>${label}</span>${counts[t] ? `<i>${counts[t]}</i>` : ''}</button>`).join('');
    const groups = [...new Set(data.library.map(q => q.group))];
    const has = q => draft.quotes.some(x => x.text === q.text);
    const sections = {
      you: `<section class="why-sec">
        <h3>${icon('heart')}Your why</h3>
        <p class="why-help">The real reason this matters. Say it the way you'd say it to a friend.</p>
        <textarea id="why-why" rows="2" maxlength="300" placeholder="e.g. So my kids grow up seeing me finish what I start" oninput="Why.set('why', this.value)">${esc(draft.why)}</textarea>
        <label class="why-label" for="why-becoming">Who you're becoming</label>
        <input id="why-becoming" maxlength="200" placeholder="e.g. someone who keeps promises to myself" value="${esc(draft.becoming)}" oninput="Why.set('becoming', this.value)">
      </section>`,
      mentor: `<section class="why-sec">
        <h3>${icon('user')}Your mentor</h3>
        <p class="why-help">Everyone has someone. A parent, a coach, a teacher, someone you've never met. When you're stuck, KolaWay asks what they would do.</p>
        <div class="why-chips">${data.mentors.map(p => `<button type="button" class="why-chip ${draft.mentor.preset === p.id ? 'on' : ''}" onclick="Why.pickMentor('${p.id}')">${esc(p.name)}</button>`).join('')}<button type="button" class="why-chip ${draft.mentor.name && !draft.mentor.preset ? 'on' : ''}" onclick="Why.pickMentor(null)">Someone I know</button></div>
        <div class="why-grid">
          <div><label class="why-label" for="why-mentor-name">Name</label>
          <input id="why-mentor-name" maxlength="80" placeholder="e.g. My mum, Coach Daniels" value="${esc(draft.mentor.name)}" oninput="Why.setMentor('name', this.value)"></div>
          <div><label class="why-label" for="why-mentor-says">What would they say to you right now?</label>
          <input id="why-mentor-says" maxlength="200" placeholder="e.g. Stop waiting to feel ready" value="${esc(draft.mentor.says)}" oninput="Why.setMentor('says', this.value)"></div>
        </div>
        <label class="why-label" for="why-mentor-routine">Their routine, or what they do that you admire</label>
        <textarea id="why-mentor-routine" rows="2" maxlength="400" placeholder="e.g. Up at 6, plans the day on paper, does the hardest call first" oninput="Why.setMentor('routine', this.value)">${esc(draft.mentor.routine)}</textarea>
      </section>`,
      quotes: `<section class="why-sec">
        <h3>${icon('book')}Words that move you</h3>
        <p class="why-help">From a book, a speech, the Bible, the Quran, a song or your gran. A different one shows each day, from yours and the shelves you pick.</p>
        <div id="why-quotes">${draft.quotes.length ? draft.quotes.map((q, i) => `<div class="why-q"><div class="min-w-0 flex-1"><p>“${esc(q.text)}”</p>${q.source ? `<span>${esc(q.source)}</span>` : ''}</div><button type="button" onclick="Why.removeQuote(${i})" aria-label="Remove this quote">${icon('trash')}</button></div>`).join('') : '<p class="why-none">No quotes yet. Add your own or pick from the shelf below.</p>'}</div>
        <div class="why-add">
          <input id="why-q-text" maxlength="300" placeholder="A quote or verse">
          <input id="why-q-source" maxlength="120" placeholder="Where it's from (optional)">
          <button type="button" onclick="Why.addOwnQuote()">${icon('plus')}Add</button>
        </div>
        <p class="why-label">Where do you draw strength from?</p>
        <p class="why-help">Pick any that are yours, or none. The starter shelf only shows what you choose.</p>
        <div class="why-chips">${data.sources.map(g => `<button type="button" class="why-chip ${draft.sources.includes(g) ? 'on' : ''}" aria-pressed="${draft.sources.includes(g)}" onclick="Why.toggleSource('${esc(g)}')">${esc(g)}</button>`).join('')}</div>
        ${draft.sources.length ? `<details class="why-shelf" ${shelfOpen ? 'open' : ''}><summary>${icon('book')}Starter shelf</summary>
          <p class="why-help">Every line here is quoted exactly, with its source.</p>
          ${groups.filter(g => draft.sources.includes(g)).map(g => `<p class="why-shelf-group">${esc(g)}</p>${data.library.filter(q => q.group === g).map(q => `
            <div class="why-q shelf"><div class="min-w-0 flex-1"><p>“${esc(q.text)}”</p><span>${esc(q.source)}</span></div>
            <button type="button" onclick="Why.addLibraryQuote('${q.id}')" ${has(q) ? 'disabled aria-label="Added"' : 'aria-label="Add this quote"'}>${icon(has(q) ? 'check' : 'plus')}</button></div>`).join('')}`).join('')}
        </details>` : ''}
      </section>`,
      music: `<section class="why-sec">
        <h3>${icon('music')}Your music</h3>
        <p class="why-help">The playlists and songs that get you going. They play right here in KolaWay and keep playing while you work and on your Journey.</p>
        <div class="music-lib">${draft.playlists.length ? draft.playlists.map((p, i) => `
          <div class="music-row ${i === 0 ? 'is-default' : ''}">
            <button type="button" class="music-row-play" onclick="Why.playMusic(${i})" aria-label="Play ${esc(p.label || 'this')}">${icon('play')}</button>
            <div class="min-w-0 flex-1"><p>${esc(p.label || 'Untitled')}</p><span>${esc(serviceOf(p.url))}${i === 0 ? ' · plays by default' : ''}</span></div>
            ${i === 0 ? '' : `<button type="button" class="music-row-btn" onclick="Why.makeDefault(${i})" title="Play this one by default" aria-label="Make default">${icon('star')}</button>`}
            <button type="button" class="music-row-btn" onclick="Why.removePlaylist(${i})" aria-label="Remove">${icon('trash')}</button>
          </div>`).join('') : '<p class="why-none">No music yet. Find some below.</p>'}</div>
        <div class="maccts" id="why-music-accounts"></div>
        <div class="msearch">
          <div class="msearch-box">${icon('search')}<input id="why-music-q" type="search" maxlength="100" placeholder="Search a song, artist or playlist" aria-label="Search for music" oninput="Why.musicSearch(this.value)" autocomplete="off"></div>
          <div class="msearch-results" id="why-music-results" aria-live="polite"></div>
        </div>
        ${(data.picks || []).length ? `<p class="why-label mt-3">Quick picks</p>
        <div class="why-chips">${data.picks.map((p, i) => { const on = draft.playlists.some(x => x.url === p.url); return `<button type="button" class="why-chip ${on ? 'on' : ''}" onclick="Why.addPick(${i})" ${on ? 'aria-pressed="true"' : ''}>${icon(on ? 'check' : 'plus', 'tiny')} ${esc(p.label)}</button>`; }).join('')}</div>` : ''}
        <div class="msearch-more">
          <button type="button" class="why-chip" onclick="Why.pasteLink()">${icon('clipboard', 'tiny')} Paste a link</button>
          <details class="msearch-link"><summary>Add by link</summary>
            <div class="why-add">
              <input id="why-music-url" type="url" maxlength="500" placeholder="Spotify, YouTube, Apple Music, SoundCloud or Deezer link">
              <input id="why-music-label" maxlength="60" placeholder="Name it, e.g. Deep focus">
              <button type="button" onclick="Why.addPlaylistFromForm()">${icon('plus')}Add</button>
            </div>
          </details>
        </div>
        <p class="why-help mt-2">${icon('smartphone', 'tiny')} On your phone, with KolaWay added to your home screen: tap <b>Share</b> in Spotify or YouTube and pick KolaWay.</p>
      </section>`,
      reminders: `<section class="why-sec">
        <h3>${icon('eye')}Where KolaWay reminds you</h3>
        ${[['dashboard', 'On the dashboard'], ['alarms', 'On the alarm screen when a task reminder rings'], ['nudges', 'In phone nudges'], ['assistant', 'In the assistant’s coaching']].map(([k, label]) => `
          <label class="why-toggle"><input type="checkbox" ${draft.show[k] ? 'checked' : ''} onchange="Why.setShow('${k}', this.checked)"> ${label}</label>`).join('')}
        <p class="why-help mt-2">Only you see this. Quotes from your faith stay private to you.</p>
        <button type="button" class="why-clear" onclick="Why.clearAll()">${icon('trash', 'tiny')} Clear everything on this page</button>
      </section>`,
    };
    body.innerHTML = sections[tab] || sections.you;
    if (tab === 'music') paintAccounts();
  }

  // ── Linked Spotify and YouTube accounts ──
  // Connect once on the service's own page; your playlists then show up
  // here, one tap to add. Only offered when the server is set up for it.
  let accts = null; const linked = {};
  async function paintAccounts() {
    const box = document.getElementById('why-music-accounts');
    if (!box) return;
    if (!accts) { try { accts = await API.getMusicAccounts(); } catch { accts = {}; } }
    const list = Object.entries(accts).filter(([, a]) => a.available || a.connected);
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = list.map(([k, a]) => `<div class="macct ${k}">
      <div class="macct-head">
        <span class="macct-logo ${k}" aria-hidden="true">${icon(k === 'spotify' ? 'music' : 'play')}</span>
        <div class="min-w-0 flex-1"><p class="macct-name">${esc(a.name)}</p><p class="macct-sub">${a.connected ? `Connected${a.account ? ` as ${esc(a.account)}` : ''}` : 'Bring in your own playlists'}</p></div>
        ${a.connected ? `<button type="button" class="macct-off" onclick="Why.disconnectMusic('${k}')">Disconnect</button>` : `<a class="macct-on" href="/api/music/${k}/connect">${icon('link', 'tiny')}Connect</a>`}
      </div>
      ${a.connected ? `<div class="macct-list" id="why-linked-${k}"><p class="msearch-note">Loading your playlists…</p></div>` : ''}
    </div>`).join('');
    list.filter(([, a]) => a.connected).forEach(([k]) => loadLinked(k));
  }
  async function loadLinked(k) {
    const box = document.getElementById(`why-linked-${k}`);
    try {
      if (!linked[k]) linked[k] = (await API.getMusicPlaylists(k)).playlists;
      paintLinked(k);
    } catch (e) {
      if (box) box.innerHTML = `<p class="msearch-note">${esc(e.message || 'Couldn’t load your playlists')}</p>`;
      if (/expired/i.test(e.message || '')) { accts = null; setTimeout(paintAccounts, 1500); }
    }
  }
  let showAll = {};
  function paintLinked(k) {
    const box = document.getElementById(`why-linked-${k}`);
    const all = linked[k] || [];
    if (!box) return;
    if (!all.length) { box.innerHTML = '<p class="msearch-note">No playlists on this account yet.</p>'; return; }
    const shown = showAll[k] ? all : all.slice(0, 5);
    box.innerHTML = shown.map((r, i) => {
      const on = draft.playlists.some(p => p.url === r.url);
      return `<div class="msearch-row">${r.art ? `<img src="${esc(r.art)}" alt="" loading="lazy">` : `<span class="msearch-art">${icon('music')}</span>`}
        <div class="min-w-0 flex-1"><p>${esc(r.title)}</p><span>${esc(r.by || '')}</span></div>
        <button type="button" class="msearch-add ${on ? 'on' : ''}" onclick="Why.addLinked('${k}', ${i})" ${on ? 'disabled aria-label="Added"' : `aria-label="Add ${esc(r.title)}"`}>${icon(on ? 'check' : 'plus')}${on ? 'Added' : 'Add'}</button></div>`;
    }).join('') + (all.length > 5 && !showAll[k] ? `<button type="button" class="macct-more" onclick="Why.showAllLinked('${k}')">Show all ${all.length}</button>` : '');
  }
  function addLinked(k, i) { const r = (linked[k] || [])[i]; if (r) quickAdd(r.url, r.title); }
  function showAllLinked(k) { showAll[k] = true; paintLinked(k); }
  async function disconnectMusic(k) {
    if (!window.confirm(`Disconnect ${accts && accts[k] ? accts[k].name : k}? Music you've already added stays.`)) return;
    await API.disconnectMusic(k).catch(() => {});
    accts = null; delete linked[k];
    paintAccounts();
  }
  // Back from Spotify or Google's sign-in page.
  function handleMusicReturn() {
    const qs = new URLSearchParams(location.search);
    const r = qs.get('music');
    if (!r) return;
    history.replaceState(null, '', location.pathname);
    const [k, result] = r.split('-');
    const name = k === 'spotify' ? 'Spotify' : 'YouTube';
    accts = null; delete linked[k];
    tab = 'music';
    try { localStorage.setItem('wp-why-tab', 'music'); } catch { /* private mode */ }
    if (result === 'connected') showToast(`${name} connected. Your playlists are in Your why → Music`);
    else if (result === 'cancelled') showToast(`${name} wasn't connected`);
    else showToast(`Couldn't connect ${name}. Try again`, 'error');
    showPage('why');
  }

  let shelfOpen = false;
  function toggleSource(g) {
    draft.sources = draft.sources.includes(g) ? draft.sources.filter(x => x !== g) : [...draft.sources, g];
    shelfOpen = true;
    changed();
  }
  const set = (k, v) => { draft[k] = v; changed(false); };
  const setMentor = (k, v) => { draft.mentor[k] = v; if (k === 'name' && draft.mentor.preset) { const p = data.mentors.find(x => x.id === draft.mentor.preset); if (!p || p.name !== v) draft.mentor.preset = null; } changed(false); };
  const serviceOf = url => { const e = Music.embedFor(url); return e ? e.service : 'Opens in a new tab'; };
  async function addPlaylistFromForm() {
    const typed = document.getElementById('why-music-url').value.trim();
    const url = Music.linkFrom(typed) || (/^https?:\/\//i.test(typed) ? typed : '');
    let label = document.getElementById('why-music-label').value.trim();
    if (!url) { showToast('Paste the share link from your music app (Spotify, YouTube, Apple Music, SoundCloud or Deezer)', 'error'); document.getElementById('why-music-url').focus(); return; }
    if (!label) label = await API.musicTitle(url).then(r => r.title || '').catch(() => '');
    if (draft.playlists.length >= 12) { showToast('That is 12 already. Remove one to add another', 'error'); return; }
    if (!draft.playlists.some(p => p.url === url)) draft.playlists.push({ url, label: label || serviceOf(url) });
    changed();
  }
  // ── Finding music without copying links ──
  // Search (Spotify's catalogue, or Apple's when Spotify isn't set up),
  // quick picks, one-tap paste and the phone's Share menu. Each adds and
  // saves straight away.
  let searchTimer = null; let searchSeq = 0; let lastResults = [];
  function musicSearch(q) {
    clearTimeout(searchTimer);
    const box = document.getElementById('why-music-results');
    if (!q.trim()) { box.innerHTML = ''; lastResults = []; return; }
    box.innerHTML = '<p class="msearch-note">Searching…</p>';
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const r = await API.searchMusic(q.trim());
        if (seq !== searchSeq) return;
        lastResults = r.results || [];
        API.trackFeature('music_search');
        paintResults(r.provider);
      } catch { if (seq === searchSeq) box.innerHTML = '<p class="msearch-note">Search isn\'t available right now. Paste a link instead.</p>'; }
    }, 350);
  }
  function paintResults(provider) {
    const box = document.getElementById('why-music-results');
    if (!box) return;
    box.innerHTML = lastResults.length ? lastResults.map((r, i) => {
      const on = draft.playlists.some(p => p.url === r.url);
      return `<div class="msearch-row">
        ${r.art ? `<img src="${esc(r.art)}" alt="" loading="lazy">` : `<span class="msearch-art">${icon('music')}</span>`}
        <div class="min-w-0 flex-1"><p>${esc(r.title)}</p><span>${r.service ? `<em class="msvc ${esc(r.service.split(' ')[0].toLowerCase())}">${esc(r.service)}</em>` : ''}${r.kind === 'playlist' ? 'Playlist · ' : ''}${esc(r.by || '')}</span></div>
        <button type="button" class="msearch-add ${on ? 'on' : ''}" onclick="Why.addResult(${i})" ${on ? 'disabled aria-label="Added"' : `aria-label="Add ${esc(r.title)}"`}>${icon(on ? 'check' : 'plus')}${on ? 'Added' : 'Add'}</button>
      </div>`;
    }).join('') + (provider ? `<p class="msearch-note">From ${esc(provider)}</p>` : '') : '<p class="msearch-note">Nothing found. Try another name.</p>';
  }
  async function quickAdd(url, label) {
    if (draft.playlists.some(p => p.url === url)) return;
    if (draft.playlists.length >= 12) { showToast('That is 12 already. Remove one to add another', 'error'); return; }
    draft.playlists.push({ url, label });
    await saveNow();
    showToast(`Added “${label}” to your music`);
    const q = document.getElementById('why-music-q')?.value || '';
    paint();
    const input = document.getElementById('why-music-q');
    if (input && q) { input.value = q; paintResults(); }
  }
  function addResult(i) { const r = lastResults[i]; if (r) quickAdd(r.url, r.kind === 'song' && r.by ? `${r.title} · ${r.by}` : r.title); }
  function addPick(i) { const p = (data.picks || [])[i]; if (p) quickAdd(p.url, p.label); }
  const findLink = text => Music.linkFrom(text);
  async function pasteLink() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* not allowed */ }
    const url = findLink(text);
    if (!url) {
      document.querySelector('.msearch-link')?.setAttribute('open', '');
      document.getElementById('why-music-url')?.focus();
      showToast(text ? "That isn't a link. Copy the share link from your music app" : 'Paste the link in the box', text ? 'error' : undefined);
      return;
    }
    const e = Music.embedFor(url);
    if (!e) { showToast('That link isn\'t from a music service KolaWay can play', 'error'); return; }
    const title = await API.musicTitle(url).then(r => r.title).catch(() => null);
    quickAdd(url, title || `From ${e.service}`);
  }
  // Shared from another app (the phone's Share menu, see manifest.json).
  async function handleShare() {
    const qs = new URLSearchParams(location.search);
    if (!qs.has('url') && !qs.has('text')) return; // the Share menu sends title, text and url
    history.replaceState(null, '', location.pathname);
    const url = findLink(qs.get('url')) || findLink(qs.get('text'));
    if (!url || !Music.embedFor(url)) { showToast('Share a Spotify, YouTube, Apple Music, SoundCloud or Deezer link to add it to your music', 'error'); return; }
    const label = (qs.get('title') || '').trim().slice(0, 60) || await API.musicTitle(url).then(r => r.title).catch(() => null) || `From ${Music.embedFor(url).service}`;
    try {
      await addPlaylist(url, label);
      showToast(`Added “${label}” to your music`);
      showPage('why');
    } catch { showToast('Could not add that', 'error'); }
  }
  function makeDefault(i) { const [p] = draft.playlists.splice(i, 1); draft.playlists.unshift(p); changed(); }
  function removePlaylist(i) { draft.playlists.splice(i, 1); changed(); }
  // From the assistant ("add this to my music"): saves straight away.
  async function addPlaylist(url, label) {
    await load();
    const cur = JSON.parse(JSON.stringify(m()));
    if (!cur.playlists.some(p => p.url === url)) cur.playlists.push({ url, label: label || serviceOf(url) });
    const r = await API.saveMotivation({ ...cur, playlist: null });
    data.motivation = r.motivation;
    return r.motivation.playlists.findIndex(p => p.url === url);
  }
  const setShow = (k, v) => { draft.show[k] = v; changed(false); };
  function pickMentor(id) {
    const p = data.mentors.find(x => x.id === id);
    draft.mentor = p ? { preset: p.id, name: p.name, routine: p.routine, says: p.says } : { preset: null, name: '', routine: '', says: '' };
    changed();
    if (!p) document.getElementById('why-mentor-name').focus();
  }
  function addOwnQuote() {
    const text = document.getElementById('why-q-text').value.trim();
    if (!text) { document.getElementById('why-q-text').focus(); return; }
    if (draft.quotes.length >= 12) { showToast('That is 12 already. Remove one to add another', 'error'); return; }
    draft.quotes.push({ text, source: document.getElementById('why-q-source').value.trim() });
    changed();
  }
  function addLibraryQuote(id) {
    const q = data.library.find(x => x.id === id);
    if (!q || draft.quotes.some(x => x.text === q.text)) return;
    if (draft.quotes.length >= 12) { showToast('That is 12 already. Remove one to add another', 'error'); return; }
    draft.quotes.push({ text: q.text, source: q.source });
    shelfOpen = !!document.querySelector('.why-shelf')?.open;
    changed();
  }
  function removeQuote(i) { draft.quotes.splice(i, 1); changed(); }
  const save = () => saveNow();
  function clearAll() {
    if (!window.confirm('Clear everything on this page: your why, mentor, quotes and music? This can’t be undone.')) return;
    draft = { sources: [], why: '', becoming: '', mentor: { preset: null, name: '', routine: '', says: '' }, quotes: [], playlists: [], playlist: { url: '', label: '' }, show: draft.show };
    changed();
  }

  // One short line for the calm screens (full-screen focus, the alarm), in
  // handwriting: today's quote if it's short, else their why, else ''.
  function scriptLine() {
    const x = m();
    if (!x || isEmpty(x)) return '';
    const q = todaysQuote(x);
    if (q && q.text.length <= 90) return q.text;
    if (x.becoming && x.becoming.length <= 70) return `You're becoming ${x.becoming.replace(/^(a|an|the)\s+/i, m0 => m0.toLowerCase())}`;
    return x.why && x.why.length <= 90 ? x.why : '';
  }
  return { scriptLine, todaysQuote: (date) => todaysQuote(m(), date), toggleChat, setTab, addLinked, showAllLinked, disconnectMusic, handleMusicReturn, musicSearch, addResult, addPick, pasteLink, handleShare, load, renderDashboard, alarmHTML, fillStuck, renderPage, interviewSend, interviewListen, toggleSource, playMusic, addPlaylist, addPlaylistFromForm, makeDefault, removePlaylist, set, setMentor, setShow, pickMentor, addOwnQuote, addLibraryQuote, removeQuote, save, clearAll, get: m, all: () => data };
})();
window.Why = Why;

// ── FOCUS MUSIC, IN THE APP ──
// Their playlist plays in a small dock inside KolaWay (the services' own
// embed players), so it keeps going while they move between pages and
// play the Journey. Minimising tucks the player away without stopping it;
// closing stops it. Links we can't embed open in a new tab instead.
// ── The top bar's dock ──
// Floating things (the music player, the focus timer) can be hidden; while
// hidden they wait as a small button in the top bar.
const TopDock = {
  set(key, html) {
    const bar = document.getElementById('topdock');
    if (!bar) return;
    let el = bar.querySelector(`[data-dock="${key}"]`);
    if (!html) { el?.remove(); return; }
    if (!el) { el = document.createElement('span'); el.dataset.dock = key; bar.appendChild(el); }
    if (el.innerHTML !== html) el.innerHTML = html;
  },
};
window.TopDock = TopDock;

const Music = (() => {
  // The music link in some pasted text: a full https:// link, or a bare
  // one copied without it ("youtube.com/playlist?list=…").
  const MUSIC_HOSTS = /^(?:www\.|m\.)?(?:youtube\.com|music\.youtube\.com|youtu\.be|open\.spotify\.com|music\.apple\.com|soundcloud\.com|(?:www\.)?deezer\.com)\//i;
  function linkFrom(text) {
    const t = String(text || '').trim();
    const full = t.match(/https?:\/\/[^\s"'<>]+/);
    if (full) return full[0];
    const bare = t.split(/\s+/).find(w => MUSIC_HOSTS.test(w));
    return bare ? `https://${bare}` : '';
  }
  // Turns a sharing link into the service's embed address, or null.
  function embedFor(raw) {
    let u;
    try { u = new URL(linkFrom(raw) || raw); } catch { return null; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'open.spotify.com') {
      const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist|episode|show)\/([A-Za-z0-9]+)/);
      return m ? { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=kolaway`, height: 152, service: 'Spotify', open: raw, control: 'spotify', uri: `spotify:${m[1]}:${m[2]}` } : null;
    }
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
      const list = u.searchParams.get('list');
      const video = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
      const base = 'https://www.youtube-nocookie.com/embed/';
      const api = `&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
      if (video && /^[\w-]{6,}$/.test(video)) return { src: `${base}${video}?autoplay=1${api}${list ? `&list=${encodeURIComponent(list)}` : ''}`, height: 170, service: 'YouTube', open: raw, control: 'youtube' };
      if (list) return { src: `${base}videoseries?autoplay=1${api}&list=${encodeURIComponent(list)}`, height: 170, service: 'YouTube', open: raw, control: 'youtube' };
      return null;
    }
    if (host === 'music.apple.com') return { src: `https://embed.music.apple.com${u.pathname}${u.search}`, height: 175, service: 'Apple Music', open: raw };
    if (host === 'soundcloud.com') return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(raw)}&auto_play=true&visual=false`, height: 166, service: 'SoundCloud', open: raw, control: 'soundcloud' };
    if (host === 'deezer.com') {
      const m = u.pathname.match(/\/(playlist|album|track)\/(\d+)/);
      return m ? { src: `https://widget.deezer.com/widget/dark/${m[1]}/${m[2]}?autoplay=true`, height: 150, service: 'Deezer', open: raw } : null;
    }
    return null;
  }

  let queue = [];   // the library being played
  let at = -1;      // which one is playing
  const dock = () => document.getElementById('music-dock');

  // Plays queue[index] in the dock; links we can't embed open in a tab.
  function start(list, index = 0) {
    API.trackFeature('music');
    queue = list.slice(); at = -1;
    go(index);
  }
  function go(index) {
    if (!queue.length) return;
    const i = ((index % queue.length) + queue.length) % queue.length;
    const item = queue[i];
    const e = embedFor(item.url);
    if (!e) { window.open(item.url, '_blank', 'noopener'); return; }
    let d = dock();
    if (d && at === i) { show(); d.classList.remove('is-min'); return; } // already playing: just show it
    if (!d) { d = document.createElement('div'); d.id = 'music-dock'; d.className = 'music-dock'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Your music'); document.body.appendChild(d); }
    at = i;
    remember({ url: item.url, min: false });
    const label = item.label || e.service;
    d.classList.remove('is-min', 'show-lib', 'is-hidden');
    d.classList.toggle('is-tucked', tucked);
    TopDock.set('music', null);
    d.innerHTML = `
      <div class="music-bar">
        <span class="music-bar-ic">${icon('music')}</span>
        <span class="music-bar-text"><b>${esc(label)}</b><small>${esc(e.service)}${queue.length > 1 ? ` · ${i + 1} of ${queue.length}` : ''}</small></span>
        <button type="button" class="music-btn music-pp music-minonly" onclick="Music.togglePause()" aria-label="Pause or play (M)" title="Pause / play (M)">${icon('pause')}</button>
        <button type="button" class="music-btn music-full music-rep" onclick="Music.cycleRepeat()"></button>
        ${queue.length > 1 ? `<button type="button" class="music-btn music-full" onclick="Music.toggleLib()" aria-label="Your music library" title="Library">${icon('list-music')}</button>` : ''}
        <button type="button" class="music-btn music-minbtn" onclick="Music.toggleMin()" aria-label="Minimise the player" title="Minimise (keeps playing)">${icon('chevron_down')}</button>
        <button type="button" class="music-btn" onclick="Music.hide()" aria-label="Hide the player. The music keeps playing" title="Hide (keeps playing)">${icon('eye-off')}</button>
        <button type="button" class="music-btn music-full" onclick="Music.stop()" aria-label="Stop the music" title="Stop">${icon('close')}</button>
      </div>
      ${transportHTML(e)}
      <div class="music-libpick">${queue.map((q, j) => `<button type="button" class="${j === i ? 'on' : ''}" onclick="Music.go(${j})">${icon(j === i ? 'volume' : 'play', 'tiny')}<span>${esc(q.label || 'Untitled')}</span></button>`).join('')}</div>
      <div class="music-frame" style="height:${e.height}px">
        <iframe src="${esc(e.src)}" title="${esc(label)} on ${esc(e.service)}" allow="autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
      </div>
      <a class="music-open" href="${esc(item.url)}" target="_blank" rel="noopener">${isPhone() ? `Keep playing in ${esc(e.service)} when you leave` : `Open in ${esc(e.service)}`} ${icon('external', 'tiny')}</a>`;
    current = { ...e, paused: false, pos: 0 };
    spotify = null;
    syncRepeat();
    if (e.control === 'spotify') attachSpotify(d.querySelector('.music-frame iframe'), e.uri);
    else if (e.control === 'youtube' || e.control === 'soundcloud') {
      // Ask the player to tell us when it finishes, for repeat.
      d.querySelector('.music-frame iframe').addEventListener('load', () => {
        if (e.control === 'youtube') { post({ event: 'listening', id: 1 }); if (repeat === 'one') post({ event: 'command', func: 'setLoop', args: [true] }); }
        else { post({ method: 'addEventListener', value: 'finish' }); post({ method: 'addEventListener', value: 'playProgress' }); }
      });
    }
  }

  // ── Back, forward and skipping ──
  // Under the title: 10 seconds back, previous, play/pause, next, 10 seconds
  // on. Previous and next move through the songs inside a YouTube or
  // SoundCloud playlist; Spotify's player can't skip songs from outside, so
  // there (and for Apple Music and Deezer) they move through your library.
  // Apple Music and Deezer can't be told to jump, so they get no 10s buttons.
  const canSeek = e => !!e.control;
  const hasTracks = e => (e.control === 'youtube' && /[?&]list=/.test(e.src)) || (e.control === 'soundcloud' && /\/sets\//.test(decodeURIComponent(e.src)));
  function transportHTML(e) {
    const skips = hasTracks(e) || queue.length > 1;
    const what = hasTracks(e) ? 'song' : 'playlist';
    const btn = (cls, fn, ic, label, extra = '') => `<button type="button" class="music-tbtn ${cls}" onclick="Music.${fn}" aria-label="${label}" title="${label}">${icon(ic)}${extra}</button>`;
    return `<div class="music-transport">
      ${canSeek(e) ? btn('music-seek', 'seek(-10)', 'rewind', 'Back 10 seconds', '<span>10</span>') : ''}
      ${skips ? btn('', 'prev()', 'skip-back', `Previous ${what}`) : ''}
      ${btn('music-pp music-pp-big', 'togglePause()', 'pause', 'Pause or play (M)')}
      ${skips ? btn('', 'next()', 'skip-forward', `Next ${what}`) : ''}
      ${canSeek(e) ? btn('music-seek', 'seek(10)', 'fast-forward', 'Forward 10 seconds', '<span>10</span>') : ''}
    </div>`;
  }
  // Jumps by a number of seconds from where it is now.
  function seek(seconds) {
    if (!current || !canSeek(current)) return;
    const to = Math.max(0, (current.pos || 0) + seconds);
    if (current.control === 'spotify' && spotify) spotify.seek(to);
    else if (current.control === 'youtube') post({ event: 'command', func: 'seekTo', args: [to, true] });
    else if (current.control === 'soundcloud') post({ method: 'seekTo', value: Math.round(to * 1000) });
    current.pos = to;
  }
  function next() {
    if (current && hasTracks(current)) {
      if (current.control === 'youtube') post({ event: 'command', func: 'nextVideo', args: [] });
      else post({ method: 'next' });
      current.pos = 0;
      if (current.paused) { current.paused = false; syncPP(); }
    } else if (queue.length > 1) go(at + 1);
  }
  // Like any music app: a few seconds in, previous starts this one again.
  function prev() {
    if (current && current.control && (current.pos || 0) > 3) { seek(-current.pos); return; }
    if (current && hasTracks(current)) {
      if (current.control === 'youtube') post({ event: 'command', func: 'previousVideo', args: [] });
      else post({ method: 'prev' });
      current.pos = 0;
    } else if (queue.length > 1) go(at - 1);
  }

  // ── Repeat: off, all (loop the library), one (replay this one) ──
  // Spotify, YouTube and SoundCloud say when they finish; Apple Music and
  // Deezer don't, so repeat can't follow them.
  let repeat = (() => { try { return localStorage.getItem('wp-music-repeat') || 'off'; } catch { return 'off'; } })();
  const REPEAT = { off: ['repeat', 'Repeat is off'], all: ['repeat', 'Repeating all your music'], one: ['repeat-1', 'Repeating this one'] };
  function cycleRepeat() {
    repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    try { localStorage.setItem('wp-music-repeat', repeat); } catch { /* private mode */ }
    if (current && current.control === 'youtube') post({ event: 'command', func: 'setLoop', args: [repeat !== 'off'] });
    syncRepeat();
    const unsupported = current && !current.control;
    showToast(unsupported && repeat !== 'off' ? `${REPEAT[repeat][1]}. ${current.service} can't tell KolaWay when it ends, so this works with Spotify, YouTube and SoundCloud` : REPEAT[repeat][1]);
  }
  function syncRepeat() {
    const b = document.querySelector('#music-dock .music-rep');
    if (!b) return;
    b.innerHTML = icon(REPEAT[repeat][0]);
    b.classList.toggle('on', repeat !== 'off');
    b.setAttribute('aria-label', `${REPEAT[repeat][1]}. Change repeat`);
    b.title = REPEAT[repeat][1];
  }
  // What to do when the current one finishes.
  function ended() {
    if (!current || current.endedAt > Date.now() - 3000) return; // one finish, one action
    current.endedAt = Date.now();
    if (repeat === 'one') restartCurrent();
    else if (queue.length > 1 && (repeat === 'all' || at < queue.length - 1)) go(at + 1);
    else if (repeat === 'all') restartCurrent();
  }
  function restartCurrent() {
    if (!current) return;
    if (current.control === 'spotify' && spotify) { spotify.seek(0); spotify.resume(); }
    else if (current.control === 'youtube') { post({ event: 'command', func: 'seekTo', args: [0, true] }); post({ event: 'command', func: 'playVideo', args: [] }); }
    else if (current.control === 'soundcloud') { post({ method: 'seekTo', value: 0 }); post({ method: 'play' }); }
  }
  window.addEventListener('message', ev => {
    if (!current || !/youtube|soundcloud/.test(ev.origin)) return;
    let msg = ev.data;
    try { if (typeof msg === 'string') msg = JSON.parse(msg); } catch { return; }
    if (!msg) return;
    if (current.control === 'youtube' && msg.event === 'onStateChange') {
      if (msg.info === 0) ended();
      else if (msg.info === 1 || msg.info === 2) { current.paused = msg.info === 2; syncPP(); }
    }
    if (current.control === 'youtube' && msg.event === 'infoDelivery' && msg.info) {
      if (typeof msg.info.currentTime === 'number') current.pos = msg.info.currentTime;
      if (msg.info.playerState === 0) ended();
    }
    if (current.control === 'soundcloud' && msg.method === 'finish') ended();
    if (current.control === 'soundcloud' && msg.method === 'playProgress' && msg.value) current.pos = (msg.value.currentPosition || 0) / 1000;
  });

  // ── Pause and play ──
  // Spotify through its embed API, YouTube and SoundCloud by message; Apple
  // Music and Deezer have no way to be controlled from outside, so pausing
  // them stops the player and playing again starts it afresh.
  let current = null;
  let spotify = null;
  const isPhone = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  function loadSpotifyApi() {
    if (window.__spotifyApi) return window.__spotifyApi;
    window.__spotifyApi = new Promise((resolve, reject) => {
      window.onSpotifyIframeApiReady = api => resolve(api);
      const sc = document.createElement('script');
      sc.src = 'https://open.spotify.com/embed/iframe-api/v1';
      sc.async = true;
      sc.onerror = () => { window.__spotifyApi = null; reject(new Error('Spotify player unavailable')); };
      document.head.appendChild(sc);
      setTimeout(() => reject(new Error('Spotify player slow')), 8000);
    });
    return window.__spotifyApi;
  }
  function attachSpotify(frame, uri) {
    loadSpotifyApi().then(api => {
      if (!frame.isConnected) return;
      const holder = document.createElement('div');
      frame.replaceWith(holder);
      api.createController(holder, { uri, width: '100%', height: current ? current.height : 152 }, ctrl => {
        spotify = ctrl;
        ctrl.addListener('playback_update', ev => {
          if (!current || !ev.data) return;
          current.paused = !!ev.data.isPaused; syncPP();
          const { position, duration } = ev.data;
          if (typeof position === 'number') current.pos = position / 1000;
          if (duration && position >= duration - 800 && ev.data.isPaused) ended();
        });
        try { ctrl.play(); } catch { /* they tap play */ }
      });
    }).catch(() => { /* the plain player still works */ });
  }
  const post = msg => { const f = document.querySelector('#music-dock .music-frame iframe'); if (f && f.contentWindow) f.contentWindow.postMessage(JSON.stringify(msg), '*'); };
  function setPaused(p) {
    if (!current) return;
    if (current.control === 'spotify' && spotify) { if (p) spotify.pause(); else spotify.resume(); }
    else if (current.control === 'youtube') post({ event: 'command', func: p ? 'pauseVideo' : 'playVideo', args: [] });
    else if (current.control === 'soundcloud') post({ method: p ? 'pause' : 'play' });
    else {
      const f = document.querySelector('#music-dock .music-frame iframe');
      if (f) f.src = p ? 'about:blank' : current.src;
    }
    current.paused = p;
    syncPP();
  }
  function togglePause() { if (current) setPaused(!current.paused); }
  function syncPP() {
    const bs = document.querySelectorAll('#music-dock .music-pp');
    if (!bs.length || !current) return;
    bs.forEach(b => {
      b.innerHTML = icon(current.paused ? 'play' : 'pause');
      b.setAttribute('aria-label', current.paused ? 'Play (M)' : 'Pause (M)');
      b.title = current.paused ? 'Play (M)' : 'Pause (M)';
    });
    document.getElementById('music-dock').classList.toggle('is-paused', current.paused);
    paintDockButton();
  }
  // M pauses or plays the music from anywhere in the app.
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'm' || ev.metaKey || ev.ctrlKey || ev.altKey || !current || !document.getElementById('music-dock')) return;
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    ev.preventDefault();
    togglePause();
    showToast(current.paused ? '⏸ Music paused (M to play)' : '▶ Music playing');
  });
  function toggleMin() { const d = dock(); if (!d) return; d.classList.toggle('is-min'); if (queue[at]) remember({ url: queue[at].url, min: d.classList.contains('is-min') }); }
  // Hidden: off screen but still playing, with a small button in the top
  // bar to bring it back.
  function hide() {
    const d = dock(); if (!d) return;
    d.classList.add('is-hidden');
    if (queue[at]) remember({ url: queue[at].url, min: d.classList.contains('is-min'), hidden: true });
    paintDockButton();
  }
  // Tucked: while the focus timer's panel is open its music row has the
  // controls, so the player steps off screen (still playing) rather than
  // a second dark panel sitting on the page. One floating thing at a time.
  let tucked = false;
  function tuck(on) {
    tucked = !!on;
    const d = dock(); if (!d) return;
    d.classList.toggle('is-tucked', tucked);
    paintDockButton();
  }
  function show() {
    const d = dock(); if (!d) return;
    // Asked for the player (the video, the library) while it's tucked:
    // the focus timer shrinks to its small ring to make room.
    if (tucked && window.Jarvis && Jarvis.makeRoom) Jarvis.makeRoom();
    d.classList.remove('is-hidden');
    if (queue[at]) remember({ url: queue[at].url, min: d.classList.contains('is-min') });
    TopDock.set('music', null);
  }
  function paintDockButton() {
    const d = dock();
    if (!d || !d.classList.contains('is-hidden') || tucked) { TopDock.set('music', null); return; }
    const label = (queue[at] && queue[at].label) || 'Music';
    TopDock.set('music', `<button type="button" onclick="Music.show()" title="${esc(label)}. Show the player (M pauses)" aria-label="Show the music player"><span class="eq ${current && current.paused ? 'paused' : ''}"><i></i><i></i><i></i></span><span class="hidden sm:inline">Music</span></button>`);
  }
  function toggleLib() { const d = dock(); if (d) d.classList.toggle('show-lib'); }
  function stop() { const d = dock(); if (d) d.remove(); at = -1; current = null; spotify = null; remember(null); TopDock.set('music', null); }
  // Music keeps going while they use the app, until they stop it. After a
  // reload the player comes back ready (browsers need one tap to play).
  function remember(state) { try { if (state) localStorage.setItem('wp-music', JSON.stringify(state)); else localStorage.removeItem('wp-music'); } catch { /* private mode */ } }
  function restore(list) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('wp-music') || 'null'); } catch { saved = null; }
    if (!saved || dock() || !list.length) return;
    const i = list.findIndex(p => p.url === saved.url);
    if (i >= 0) { start(list, i); dock()?.classList.toggle('is-min', !!saved.min); if (saved.hidden) hide(); }
  }
  const isPlaying = () => !!dock();

  // What's playing, for the focus timer's music row.
  const now = () => (current && queue[at] ? { label: queue[at].label || current.service, service: current.service, paused: !!current.paused, many: queue.length > 1 } : null);
  return { embedFor, linkFrom, start, go, next, prev, hide, show, tuck, toggleMin, toggleLib, togglePause, setPaused, seek, cycleRepeat, stop, isPlaying, restore, now, isPaused: () => !!(current && current.paused), repeatMode: () => repeat, _ended: ended };
})();
window.Music = Music;
