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
        <p class="why-card-sub">Add your reason, someone you look up to, a quote that moves you and your focus music. Waypoint shows them when you need them most.</p></div>
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
  async function renderPage() {
    const body = document.getElementById('why-body');
    body.innerHTML = '<p class="text-sm text-gray-400 py-10 text-center">Loading…</p>';
    try { await load(true); } catch (e) { body.innerHTML = `<p class="text-sm text-red-500">${esc(e.message || 'Could not load')}</p>`; return; }
    draft = JSON.parse(JSON.stringify(m()));
    const fresh = isEmpty(m());
    body.innerHTML = `
      <section class="why-chat" id="why-chat">
        <div class="why-chat-head">
          <div class="brief-orb small" aria-hidden="true"><span></span></div>
          <div class="min-w-0"><p class="why-chat-title">${fresh ? "Let's find your why" : 'Talk it through again'}</p><p class="why-chat-sub">A two-minute chat with your coach. Talk or type, and it fills this in for you.</p></div>
        </div>
        <div class="why-chat-log" id="why-chat-log" aria-live="polite"></div>
        <form class="why-chat-input" onsubmit="event.preventDefault(); Why.interviewSend();">
          <button type="button" class="why-chat-mic" id="why-chat-mic" onclick="Why.interviewListen()" aria-label="Talk instead of typing">${icon('mic')}</button>
          <input id="why-chat-in" autocomplete="off" maxlength="1500" placeholder="Type your answer, or tap the mic">
          <button type="submit" class="why-chat-send" aria-label="Send">${icon('send')}</button>
        </form>
      </section>
      <details class="why-form-wrap" id="why-form-wrap" ${fresh ? '' : 'open'}>
        <summary>${fresh ? 'Or fill it in yourself' : 'Your why'}</summary>
        <div id="why-form"></div>
      </details>`;
    interview = { messages: [{ role: 'assistant', content: fresh ? "Hi! What's the one goal you most want to reach right now?" : "What's changed? Tell me about the goal you're most focused on now." }] };
    renderChat();
    paint();
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
      document.getElementById('why-form-wrap').open = true;
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
    const wrap = document.getElementById('why-form-wrap');
    wrap.open = true;
    wrap.querySelector('summary').textContent = 'Your why: check it, then save';
    paint();
    document.getElementById('why-save-btn')?.classList.add('pulse');
    setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
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

  function paint() {
    const body = document.getElementById('why-form');
    const groups = [...new Set(data.library.map(q => q.group))];
    const has = q => draft.quotes.some(x => x.text === q.text);
    body.innerHTML = `
      <section class="why-sec">
        <h3>${icon('heart')}Your why</h3>
        <p class="why-help">The real reason this matters. Say it the way you'd say it to a friend.</p>
        <textarea id="why-why" rows="2" maxlength="300" placeholder="e.g. So my kids grow up seeing me finish what I start" oninput="Why.set('why', this.value)">${esc(draft.why)}</textarea>
        <label class="why-label" for="why-becoming">Who you're becoming</label>
        <input id="why-becoming" maxlength="200" placeholder="e.g. someone who keeps promises to myself" value="${esc(draft.becoming)}" oninput="Why.set('becoming', this.value)">
      </section>

      <section class="why-sec">
        <h3>${icon('user')}Your mentor</h3>
        <p class="why-help">Everyone has someone. A parent, a coach, a teacher, someone you've never met. When you're stuck, Waypoint asks what they would do.</p>
        <div class="why-chips">${data.mentors.map(p => `<button type="button" class="why-chip ${draft.mentor.preset === p.id ? 'on' : ''}" onclick="Why.pickMentor('${p.id}')">${esc(p.name)}</button>`).join('')}<button type="button" class="why-chip ${draft.mentor.name && !draft.mentor.preset ? 'on' : ''}" onclick="Why.pickMentor(null)">Someone I know</button></div>
        <div class="why-grid">
          <div><label class="why-label" for="why-mentor-name">Name</label>
          <input id="why-mentor-name" maxlength="80" placeholder="e.g. My mum, Coach Daniels" value="${esc(draft.mentor.name)}" oninput="Why.setMentor('name', this.value)"></div>
          <div><label class="why-label" for="why-mentor-says">What would they say to you right now?</label>
          <input id="why-mentor-says" maxlength="200" placeholder="e.g. Stop waiting to feel ready" value="${esc(draft.mentor.says)}" oninput="Why.setMentor('says', this.value)"></div>
        </div>
        <label class="why-label" for="why-mentor-routine">Their routine, or what they do that you admire</label>
        <textarea id="why-mentor-routine" rows="2" maxlength="400" placeholder="e.g. Up at 6, plans the day on paper, does the hardest call first" oninput="Why.setMentor('routine', this.value)">${esc(draft.mentor.routine)}</textarea>
      </section>

      <section class="why-sec">
        <h3>${icon('book')}Words that move you</h3>
        <p class="why-help">From a book, a speech, the Bible, the Quran, a song or your gran. One shows each day.</p>
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
      </section>

      <section class="why-sec">
        <h3>${icon('music')}Your music</h3>
        <p class="why-help">The playlists and songs that get you going. They play right here in Waypoint and keep playing while you work and on your Journey.</p>
        <div class="music-lib">${draft.playlists.length ? draft.playlists.map((p, i) => `
          <div class="music-row ${i === 0 ? 'is-default' : ''}">
            <button type="button" class="music-row-play" onclick="Why.playMusic(${i})" aria-label="Play ${esc(p.label || 'this')}">${icon('play')}</button>
            <div class="min-w-0 flex-1"><p>${esc(p.label || 'Untitled')}</p><span>${esc(serviceOf(p.url))}${i === 0 ? ' · plays by default' : ''}</span></div>
            ${i === 0 ? '' : `<button type="button" class="music-row-btn" onclick="Why.makeDefault(${i})" title="Play this one by default" aria-label="Make default">${icon('star')}</button>`}
            <button type="button" class="music-row-btn" onclick="Why.removePlaylist(${i})" aria-label="Remove">${icon('trash')}</button>
          </div>`).join('') : '<p class="why-none">No music yet. Find some below.</p>'}</div>
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
        <p class="why-help mt-2">${icon('smartphone', 'tiny')} On your phone, with Waypoint added to your home screen: tap <b>Share</b> in Spotify or YouTube and pick Waypoint.</p>
      </section>

      <section class="why-sec">
        <h3>${icon('eye')}Where Waypoint reminds you</h3>
        ${[['dashboard', 'On the dashboard'], ['alarms', 'On the alarm screen when a task reminder rings'], ['nudges', 'In phone nudges'], ['assistant', 'In the assistant’s coaching']].map(([k, label]) => `
          <label class="why-toggle"><input type="checkbox" ${draft.show[k] ? 'checked' : ''} onchange="Why.setShow('${k}', this.checked)"> ${label}</label>`).join('')}
        <p class="why-help mt-2">Only you see this. Quotes from your faith stay private to you, and you can clear everything here at any time.</p>
      </section>

      <div class="why-save">
        <button type="button" class="why-clear" onclick="Why.clearAll()">Clear all</button>
        <button type="button" class="why-save-btn" id="why-save-btn" onclick="Why.save()">${icon('check')}Save</button>
      </div>`;
  }

  let shelfOpen = false;
  function toggleSource(g) {
    draft.sources = draft.sources.includes(g) ? draft.sources.filter(x => x !== g) : [...draft.sources, g];
    shelfOpen = true;
    paint();
  }
  const set = (k, v) => { draft[k] = v; };
  const setMentor = (k, v) => { draft.mentor[k] = v; if (k === 'name' && draft.mentor.preset) { const p = data.mentors.find(x => x.id === draft.mentor.preset); if (!p || p.name !== v) draft.mentor.preset = null; } };
  const serviceOf = url => { const e = Music.embedFor(url); return e ? e.service : 'Opens in a new tab'; };
  function addPlaylistFromForm() {
    const url = document.getElementById('why-music-url').value.trim();
    const label = document.getElementById('why-music-label').value.trim();
    if (!/^https?:\/\//i.test(url)) { showToast('Paste a link that starts with https://', 'error'); document.getElementById('why-music-url').focus(); return; }
    if (draft.playlists.length >= 12) { showToast('That is 12 already. Remove one to add another', 'error'); return; }
    if (!draft.playlists.some(p => p.url === url)) draft.playlists.push({ url, label: label || serviceOf(url) });
    paint();
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
        <div class="min-w-0 flex-1"><p>${esc(r.title)}</p><span>${r.kind === 'playlist' ? 'Playlist · ' : ''}${esc(r.by || '')}</span></div>
        <button type="button" class="msearch-add ${on ? 'on' : ''}" onclick="Why.addResult(${i})" ${on ? 'disabled aria-label="Added"' : `aria-label="Add ${esc(r.title)}"`}>${icon(on ? 'check' : 'plus')}${on ? 'Added' : 'Add'}</button>
      </div>`;
    }).join('') + (provider ? `<p class="msearch-note">From ${esc(provider)}</p>` : '') : '<p class="msearch-note">Nothing found. Try another name.</p>';
  }
  async function quickAdd(url, label) {
    if (draft.playlists.some(p => p.url === url)) return;
    if (draft.playlists.length >= 12) { showToast('That is 12 already. Remove one to add another', 'error'); return; }
    draft.playlists.push({ url, label });
    try {
      await addPlaylist(url, label);
      showToast(`Added “${label}” to your music`);
    } catch { draft.playlists = draft.playlists.filter(p => p.url !== url); showToast('Could not add that', 'error'); }
    const q = document.getElementById('why-music-q')?.value || '';
    paint();
    const input = document.getElementById('why-music-q');
    if (input && q) { input.value = q; paintResults(); }
  }
  function addResult(i) { const r = lastResults[i]; if (r) quickAdd(r.url, r.kind === 'song' && r.by ? `${r.title} · ${r.by}` : r.title); }
  function addPick(i) { const p = (data.picks || [])[i]; if (p) quickAdd(p.url, p.label); }
  const findLink = text => (String(text || '').match(/https?:\/\/[^\s"'<>]+/) || [])[0] || '';
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
    if (!e) { showToast('That link isn\'t from a music service Waypoint can play', 'error'); return; }
    quickAdd(url, e.service === 'Spotify' ? 'From Spotify' : `From ${e.service}`);
  }
  // Shared from another app (the phone's Share menu, see manifest.json).
  async function handleShare() {
    const qs = new URLSearchParams(location.search);
    if (!qs.has('url') && !qs.has('text')) return; // the Share menu sends title, text and url
    history.replaceState(null, '', location.pathname);
    const url = findLink(qs.get('url')) || findLink(qs.get('text'));
    if (!url || !Music.embedFor(url)) { showToast('Share a Spotify, YouTube, Apple Music, SoundCloud or Deezer link to add it to your music', 'error'); return; }
    const label = (qs.get('title') || '').trim().slice(0, 60) || `From ${Music.embedFor(url).service}`;
    try {
      await addPlaylist(url, label);
      showToast(`Added “${label}” to your music`);
      showPage('why');
    } catch { showToast('Could not add that', 'error'); }
  }
  function makeDefault(i) { const [p] = draft.playlists.splice(i, 1); draft.playlists.unshift(p); paint(); }
  function removePlaylist(i) { draft.playlists.splice(i, 1); paint(); }
  // From the assistant ("add this to my music"): saves straight away.
  async function addPlaylist(url, label) {
    await load();
    const cur = JSON.parse(JSON.stringify(m()));
    if (!cur.playlists.some(p => p.url === url)) cur.playlists.push({ url, label: label || serviceOf(url) });
    const r = await API.saveMotivation({ ...cur, playlist: null });
    data.motivation = r.motivation;
    return r.motivation.playlists.findIndex(p => p.url === url);
  }
  const setShow = (k, v) => { draft.show[k] = v; };
  function pickMentor(id) {
    const p = data.mentors.find(x => x.id === id);
    draft.mentor = p ? { preset: p.id, name: p.name, routine: p.routine, says: p.says } : { preset: null, name: '', routine: '', says: '' };
    paint();
    if (!p) document.getElementById('why-mentor-name').focus();
  }
  function addOwnQuote() {
    const text = document.getElementById('why-q-text').value.trim();
    if (!text) { document.getElementById('why-q-text').focus(); return; }
    if (draft.quotes.length >= 12) { showToast('That is 12 already. Remove one to add another', 'error'); return; }
    draft.quotes.push({ text, source: document.getElementById('why-q-source').value.trim() });
    paint();
  }
  function addLibraryQuote(id) {
    const q = data.library.find(x => x.id === id);
    if (!q || draft.quotes.some(x => x.text === q.text)) return;
    if (draft.quotes.length >= 12) { showToast('That is 12 already. Remove one to add another', 'error'); return; }
    draft.quotes.push({ text: q.text, source: q.source });
    shelfOpen = !!document.querySelector('.why-shelf')?.open;
    paint();
  }
  function removeQuote(i) { draft.quotes.splice(i, 1); paint(); }
  async function save() {
    const btn = document.getElementById('why-save-btn');
    btn.disabled = true;
    try {
      const r = await API.saveMotivation({ ...draft, playlist: null });
      data.motivation = r.motivation; draft = JSON.parse(JSON.stringify(r.motivation));
      showToast('✅ Saved. Waypoint will remind you of this when it counts');
      paint();
    } catch (e) { showToast('❌ ' + (e.message || 'Could not save'), 'error'); }
    btn.disabled = false;
  }
  function clearAll() {
    draft = { sources: [], why: '', becoming: '', mentor: { preset: null, name: '', routine: '', says: '' }, quotes: [], playlists: [], playlist: { url: '', label: '' }, show: draft.show };
    paint();
  }

  return { todaysQuote: (date) => todaysQuote(m(), date), musicSearch, addResult, addPick, pasteLink, handleShare, load, renderDashboard, alarmHTML, fillStuck, renderPage, interviewSend, interviewListen, toggleSource, playMusic, addPlaylist, addPlaylistFromForm, makeDefault, removePlaylist, set, setMentor, setShow, pickMentor, addOwnQuote, addLibraryQuote, removeQuote, save, clearAll, get: m, all: () => data };
})();
window.Why = Why;

// ── FOCUS MUSIC, IN THE APP ──
// Their playlist plays in a small dock inside Waypoint (the services' own
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
  // Turns a sharing link into the service's embed address, or null.
  function embedFor(raw) {
    let u;
    try { u = new URL(raw); } catch { return null; }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'open.spotify.com') {
      const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist|episode|show)\/([A-Za-z0-9]+)/);
      return m ? { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=waypoint`, height: 152, service: 'Spotify', open: raw, control: 'spotify', uri: `spotify:${m[1]}:${m[2]}` } : null;
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
    showToast(unsupported && repeat !== 'off' ? `${REPEAT[repeat][1]}. ${current.service} can't tell Waypoint when it ends, so this works with Spotify, YouTube and SoundCloud` : REPEAT[repeat][1]);
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
  function show() {
    const d = dock(); if (!d) return;
    d.classList.remove('is-hidden');
    if (queue[at]) remember({ url: queue[at].url, min: d.classList.contains('is-min') });
    TopDock.set('music', null);
  }
  function paintDockButton() {
    const d = dock();
    if (!d || !d.classList.contains('is-hidden')) { TopDock.set('music', null); return; }
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

  return { embedFor, start, go, next, prev, hide, show, toggleMin, toggleLib, togglePause, setPaused, seek, cycleRepeat, stop, isPlaying, restore, isPaused: () => !!(current && current.paused), repeatMode: () => repeat, _ended: ended };
})();
window.Music = Music;
