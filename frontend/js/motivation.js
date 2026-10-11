/* global API, esc, icon, showToast, showPage, APP */
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
    if (!loading) loading = API.getMotivation().then(d => { data = d; return d; }).finally(() => { loading = null; });
    return loading;
  }
  const m = () => (data && data.motivation) || null;
  const isEmpty = x => !x || (!x.why && !x.becoming && !x.mentor.name && !x.quotes.length && !x.playlist.url);
  const dayIndex = () => Math.floor(Date.now() / 86400000);
  const todaysQuote = x => (x && x.quotes.length ? x.quotes[dayIndex() % x.quotes.length] : null);
  const mentorOf = x => {
    if (!x || !x.mentor.name) return null;
    const preset = data.mentors.find(p => p.id === x.mentor.preset);
    return { name: x.mentor.name, routine: x.mentor.routine || (preset && preset.routine) || '', says: x.mentor.says || (preset && preset.says) || '' };
  };
  const musicLabel = x => x.playlist.label || (/spotify/i.test(x.playlist.url) ? 'Spotify' : /music\.apple/i.test(x.playlist.url) ? 'Apple Music' : /youtu/i.test(x.playlist.url) ? 'YouTube' : 'my playlist');

  // Opens their playlist (the music app on a phone, a new tab on a computer).
  function playMusic() {
    const x = m();
    if (!x || !x.playlist.url) { showPage('why'); return; }
    window.open(x.playlist.url, '_blank', 'noopener');
  }
  const musicButton = (cls = 'why-music') => {
    const x = m();
    return x && x.playlist.url ? `<button type="button" class="${cls}" onclick="Why.playMusic()">${icon('music')}Play ${esc(musicLabel(x))}</button>` : '';
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
    paint();
  }

  function paint() {
    const body = document.getElementById('why-body');
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
        <details class="why-shelf"><summary>${icon('book')}Starter shelf</summary>
          <p class="why-help">Every line here is quoted exactly, with its source.</p>
          ${groups.map(g => `<p class="why-shelf-group">${esc(g)}</p>${data.library.filter(q => q.group === g).map(q => `
            <div class="why-q shelf"><div class="min-w-0 flex-1"><p>“${esc(q.text)}”</p><span>${esc(q.source)}</span></div>
            <button type="button" onclick="Why.addLibraryQuote('${q.id}')" ${has(q) ? 'disabled aria-label="Added"' : 'aria-label="Add this quote"'}>${icon(has(q) ? 'check' : 'plus')}</button></div>`).join('')}`).join('')}
        </details>
      </section>

      <section class="why-sec">
        <h3>${icon('music')}Your focus music</h3>
        <p class="why-help">A Spotify, Apple Music or YouTube playlist link. One tap plays it when you start a task or an alarm rings.</p>
        <div class="why-grid">
          <div><label class="why-label" for="why-music-url">Playlist link</label>
          <input id="why-music-url" type="url" maxlength="500" placeholder="https://open.spotify.com/playlist/…" value="${esc(draft.playlist.url)}" oninput="Why.setMusic('url', this.value)"></div>
          <div><label class="why-label" for="why-music-label">Name it (optional)</label>
          <input id="why-music-label" maxlength="60" placeholder="e.g. Deep work" value="${esc(draft.playlist.label)}" oninput="Why.setMusic('label', this.value)"></div>
        </div>
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

  const set = (k, v) => { draft[k] = v; };
  const setMentor = (k, v) => { draft.mentor[k] = v; if (k === 'name' && draft.mentor.preset) { const p = data.mentors.find(x => x.id === draft.mentor.preset); if (!p || p.name !== v) draft.mentor.preset = null; } };
  const setMusic = (k, v) => { draft.playlist[k] = v; };
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
    const open = document.querySelector('.why-shelf')?.open;
    paint();
    if (open) document.querySelector('.why-shelf').open = true;
  }
  function removeQuote(i) { draft.quotes.splice(i, 1); paint(); }
  async function save() {
    const btn = document.getElementById('why-save-btn');
    if (draft.playlist.url && !/^https?:\/\//i.test(draft.playlist.url)) { showToast('The playlist link should start with https://', 'error'); return; }
    btn.disabled = true;
    try {
      const r = await API.saveMotivation(draft);
      data.motivation = r.motivation; draft = JSON.parse(JSON.stringify(r.motivation));
      showToast('✅ Saved. Waypoint will remind you of this when it counts');
      paint();
    } catch (e) { showToast('❌ ' + (e.message || 'Could not save'), 'error'); }
    btn.disabled = false;
  }
  function clearAll() {
    draft = { why: '', becoming: '', mentor: { preset: null, name: '', routine: '', says: '' }, quotes: [], playlist: { url: '', label: '' }, show: draft.show };
    paint();
  }

  return { load, renderDashboard, alarmHTML, fillStuck, renderPage, playMusic, set, setMentor, setMusic, setShow, pickMentor, addOwnQuote, addLibraryQuote, removeQuote, save, clearAll, get: m, all: () => data };
})();
window.Why = Why;
