/* global icon, esc, API, APP, showToast, showActionToast, fireBigScreenConfetti, showPage, playJourneyFor, renderMountainScene, mountainState */
// ── RACE A FRIEND ───────────────────────────────────────────────
// Make a race from one of your goals, share the link, and everyone who
// joins races their own copy (backend/challenges.js). On the Journey every
// player stands on the same road with their name over their head
// (journeyGame.js drawRivals), and a strip above it is the scoreboard.
// A stake is a promise in words; Waypoint never takes or pays out money.
const Race = (() => {
  let lastFocus = null;
  let current = null; // the race on the Journey now
  let poll = null;

  const dayKey = d => new Date(d).toISOString().slice(0, 10);
  const when = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const linkFor = token => `${location.origin}/app?race=${token}`;
  const ordinal = n => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
  // A finishing place: a gold, silver or bronze cup for the podium, then
  // 4th, 5th… placeText is for plain text (toasts, shared results).
  // Each cup is filled in its metal, outlined a shade darker.
  const CUP = { 1: ['#F2C230', '#9A7209'], 2: ['#CDD3DA', '#6E7883'], 3: ['#D98C4A', '#8A4F1E'] };
  const cup = n => (CUP[n] ? icon('trophy', `place-cup place-cup-${n}`).replace('<svg ', `<svg style="color:${CUP[n][1]};fill:${CUP[n][0]}" aria-hidden="true" `) : '');
  const placeHtml = n => `<span class="place">${cup(n)}${ordinal(n)}</span>`;
  const placeText = n => ordinal(n);

  function dialog(html) {
    close();
    lastFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.id = 'race-dialog';
    wrap.className = 'fb-overlay';
    wrap.innerHTML = `<form class="fb-card race-card" role="dialog" aria-modal="true" aria-labelledby="race-title">${html}</form>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const first = wrap.querySelector('input, button.fb-send');
    if (first) first.focus();
    return wrap.querySelector('form');
  }
  function close() {
    const el = document.getElementById('race-dialog');
    if (!el) return;
    el.remove();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  const head = title => `<div class="fb-head"><h2 id="race-title">${icon('flag')}${esc(title)}</h2><button type="button" class="fb-x" aria-label="Close" onclick="Race.close()">${icon('close')}</button></div>`;

  // ── Making one ──
  // A race (first to finish wins) or together (a class or team: everyone
  // aims to finish; the organiser can run it without taking part, and
  // chooses how names show to everyone).
  async function openCreate(projectId) {
    if (!projectId) return;
    let name = '';
    try { name = (await API.getProfile()).name || ''; } catch { /* a blank name is fine */ }
    const min = dayKey(Date.now() + 86400000);
    const form = dialog(`${head('Make a challenge')}
      <div class="seg race-mode" role="radiogroup" aria-label="Kind of challenge">
        <button type="button" role="radio" data-mode="race" aria-checked="true">${icon('flag', 'tiny')}Race</button>
        <button type="button" role="radio" data-mode="together" aria-checked="false">${icon('users', 'tiny')}Class or team</button>
      </div>
      <p class="fb-note" id="race-mode-note"></p>
      <label for="race-end">Finish by</label>
      <input type="date" id="race-end" min="${min}" value="${dayKey(Date.now() + 14 * 86400000)}" required>
      <div class="race-only"><label for="race-stake">What's riding on it? <span class="opt">(optional)</span></label>
      <input type="text" id="race-stake" maxlength="140" placeholder="e.g. Loser buys dinner"></div>
      <div class="together-only hidden">
        <label class="race-check"><input type="checkbox" id="race-organise"> I'm organising this, not taking part</label>
        <label for="race-names">How names show to everyone</label>
        <select id="race-names"><option value="names">Their names</option><option value="first">First names only</option><option value="animals">Animal names (e.g. Swift Otter)</option></select>
      </div>
      <div id="race-name-wrap"><label for="race-name">Your name on the road</label>
      <input type="text" id="race-name" maxlength="24" value="${esc(name)}" placeholder="e.g. Ade"></div>
      <p class="fb-note race-only">A stake is a promise between you. Waypoint never takes or pays out money.</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Cancel</button><button type="submit" class="fb-send">${icon('flag', 'tiny')}<span id="race-make-label">Make the race</span></button></div>`);
    let mode = 'race';
    const paint = () => {
      form.querySelectorAll('.race-mode button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
      form.querySelectorAll('.race-only').forEach(el => el.classList.toggle('hidden', mode !== 'race'));
      form.querySelectorAll('.together-only').forEach(el => el.classList.toggle('hidden', mode !== 'together'));
      const organising = mode === 'together' && form.querySelector('#race-organise').checked;
      form.querySelector('#race-name-wrap').classList.toggle('hidden', organising);
      form.querySelector('#race-mode-note').textContent = mode === 'race'
        ? "Everyone who joins gets their own copy of this goal's steps. First to tick them all off wins."
        : 'Everyone gets their own copy and aims to finish by the date. You see who is on track and can nudge anyone behind. They join with a link or a code.';
      form.querySelector('#race-make-label').textContent = mode === 'race' ? 'Make the race' : 'Make the challenge';
    };
    form.querySelectorAll('.race-mode button').forEach(b => { b.onclick = () => { mode = b.dataset.mode; paint(); }; });
    form.querySelector('#race-organise').onchange = paint;
    paint();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const organising = mode === 'together' && form.querySelector('#race-organise').checked;
      const displayName = form.querySelector('#race-name').value.trim();
      if (!organising && !displayName) { form.querySelector('#race-name').focus(); return; }
      const btn = form.querySelector('.fb-send');
      btn.disabled = true;
      try {
        const race = await API.createRace({
          projectId, mode, organiserOnly: organising, nameMode: form.querySelector('#race-names').value,
          endsAt: new Date(`${form.querySelector('#race-end').value}T23:59:00`).toISOString(),
          stake: mode === 'race' ? form.querySelector('#race-stake').value : '', displayName,
        });
        showShare(race, true);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'Could not make it', 'error');
      }
    });
  }

  // The link and the code to send, with Copy and (on a phone) Share.
  function showShare(race, isNew) {
    const url = linkFor(race.joinToken);
    const me = race.players.find(p => p.you);
    const together = race.mode === 'together';
    const code = race.joinCode ? race.joinCode.replace(/(...)(...)/, '$1 $2') : '';
    const form = dialog(`${head(isNew ? (together ? 'Your challenge is ready' : 'Your race is ready') : 'Invite people')}
      <p class="fb-note">Send the link${code ? ', or read out the code' : ''}. They'll see <b>${esc(race.title)}</b>${race.stake ? `, the stake (${esc(race.stake)})` : ''} and the finish date, ${esc(when(race.endsAt))}.</p>
      ${code ? `<div class="race-code" aria-label="Join code ${esc(race.joinCode.split('').join(' '))}"><small>Join code</small><b>${esc(code)}</b><span>Challenges › Join with a code</span></div>` : ''}
      <div class="race-link"><input type="text" id="race-link" readonly value="${esc(url)}" aria-label="Join link"><button type="button" class="fb-cancel" id="race-copy">${icon('copy', 'tiny')}Copy</button></div>
      <div class="fb-foot">${navigator.share ? `<button type="button" class="fb-cancel" id="race-share">${icon('send', 'tiny')}Share</button>` : ''}
        <button type="submit" class="fb-send">${icon('play', 'tiny')}${me ? (together ? 'Go to my copy' : 'Go to my race') : 'See who has joined'}</button></div>`);
    form.querySelector('#race-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(url); showToast('🔗 Link copied'); } catch { form.querySelector('#race-link').select(); }
    };
    const share = form.querySelector('#race-share');
    if (share) share.onclick = () => navigator.share({ title: together ? `Join: ${race.title}` : `Race me: ${race.title}`, text: `${together ? 'Join' : 'Race me to finish'} "${race.title}" by ${when(race.endsAt)}${code ? ` (code ${race.joinCode})` : ''}${race.stake ? `. Stake: ${race.stake}` : ''}`, url }).catch(() => {});
    form.addEventListener('submit', e => {
      e.preventDefault(); close();
      if (me && me.projectId) playJourneyFor(me.projectId);
      else { showPage('challenges'); setTimeout(() => openDetail(race.id), 200); }
    });
  }

  // ── Joining: from a link (/app?race=…) or a code ──
  const PENDING = 'wp-race-join';
  // Before sign-in: remember the link, and tell them what it is.
  async function handleLink() {
    const params = new URLSearchParams(location.search);
    const token = params.get('race');
    if (!token) return;
    params.delete('race');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
    try { sessionStorage.setItem(PENDING, token); } catch { /* private mode: the join just won't survive sign-up */ }
    try {
      const p = await (await fetch(`/api/race-preview/${encodeURIComponent(token)}`)).json();
      if (p && p.title) {
        const note = document.getElementById('auth-race-note');
        if (note) { note.innerHTML = `${icon('flag', 'tiny')}<span><b>${esc(p.owner)}</b> ${p.mode === 'together' ? 'invited you to' : 'challenged you to'} <b>${esc(p.title)}</b>. Sign in or create an account to join.</span>`; note.classList.remove('hidden'); }
      }
    } catch { /* the join card after sign-in still works */ }
  }
  // After sign-in: offer the join.
  async function offerPendingJoin() {
    let token = null;
    try { token = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); } catch { /* none */ }
    if (!token) return;
    let p;
    try { p = await (await fetch(`/api/race-preview/${encodeURIComponent(token)}`)).json(); } catch { p = null; }
    if (!p || !p.title) { showToast('That link is not valid any more', 'error'); return; }
    joinCard(p, token);
  }
  // From a code typed on the Challenges page.
  async function joinWithCode(code) {
    const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 6) { showToast('A join code has 6 letters and numbers', 'error'); return; }
    let p;
    try { p = await API.previewRaceCode(clean); } catch (err) { showToast(err.message || "That code doesn't match a race or class", 'error'); return; }
    joinCard(p, p.token);
  }
  async function joinCard(p, token) {
    let name = '';
    try { name = (await API.getProfile()).name || ''; } catch { /* blank */ }
    const together = p.mode === 'together';
    const namesNote = p.nameMode === 'animals' ? 'Classmates see you by an animal name; the organiser sees your name.'
      : p.nameMode === 'first' ? 'Others see your first name only.' : 'Everyone sees the name you give here.';
    const form = dialog(`${head(together ? `${p.owner} invited you` : `${p.owner} challenged you`)}
      <div class="race-invite"><span class="race-invite-ic">${esc(p.icon || '🏁')}</span><div><b>${esc(p.title)}</b><small>${p.taskCount} steps · finish by ${esc(when(p.endsAt))} · ${p.players} ${p.players === 1 ? 'person' : 'people'} so far</small></div></div>
      ${p.stake ? `<p class="race-stake">${icon('gift', 'tiny')}<span>Riding on it: <b>${esc(p.stake)}</b></span></p>` : ''}
      <label for="race-name">Your name</label>
      <input type="text" id="race-name" maxlength="24" value="${esc(name)}" placeholder="e.g. Sam" required>
      <p class="fb-note">You get your own copy of the steps. ${together ? namesNote : 'Everyone sees how far along you are.'} No one sees your other goals.</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Not now</button><button type="submit" class="fb-send" ${p.full ? 'disabled' : ''}>${icon('flag', 'tiny')}${p.full ? 'It is full' : together ? 'Join' : 'Join the race'}</button></div>`);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('.fb-send');
      btn.disabled = true;
      try {
        const r = await API.joinRace(token, form.querySelector('#race-name').value);
        close();
        showToast(r.already ? "You're already in" : `🏁 You're in. ${p.taskCount} steps to the finish`);
        playJourneyFor(r.projectId);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'Could not join', 'error');
      }
    });
  }

  // ── The Challenges page: your races and classes, and joining by code ──
  let detailId = null;
  async function renderPage() {
    const box = document.getElementById('challenges-body');
    if (!box) return;
    detailId = null; // the Challenges link always opens on the list
    box.innerHTML = '<p class="text-sm text-gray-400 py-6">Loading…</p>';
    let list = [];
    try { list = await API.listRaces(); } catch { list = []; }
    const card = c => {
      const me = c.players.find(p => p.you);
      const line = c.mode === 'together'
        ? `${c.group.finished} of ${c.group.players} finished · ${c.group.stepsPct}% of steps`
        : c.yourPlace ? `You finished ${placeHtml(c.yourPlace)}` : c.winner ? `${esc(c.winner.name)} won` : me ? `You're ${ordinal(c.players.indexOf(me) + 1)} of ${c.players.length}` : `${c.players.length} racing`;
      return `<button type="button" class="ch-card" onclick="Race.openDetail('${c.id}')">
        <span class="ch-ic">${esc(c.icon || '🏁')}</span>
        <span class="ch-main"><b>${esc(c.title)}</b><small>${c.mode === 'together' ? (c.owner && c.organiserOnly ? 'You organise' : 'Class or team') : 'Race'} · ${c.over ? 'ended' : `finish by ${esc(when(c.endsAt))}`}</small></span>
        <span class="ch-line">${line}</span>${icon('chevron_right', 'tiny')}</button>`;
    };
    box.innerHTML = `<form class="ch-join" id="ch-join-form"><label for="join-code">Got a code?</label>
        <div><input type="text" id="join-code" maxlength="9" autocomplete="off" autocapitalize="characters" placeholder="e.g. K7M 2QP"><button type="submit">Join</button></div></form>
      ${list.length ? `<div class="ch-list">${list.map(card).join('')}</div>`
        : `<div class="ch-empty"><p><b>No races or classes yet.</b></p><p>Open any goal and choose <b>⋯ › Race a friend</b> to race someone, or to run a challenge for a class or team.</p></div>`}`;
    document.getElementById('ch-join-form').addEventListener('submit', e => { e.preventDefault(); joinWithCode(document.getElementById('join-code').value); });
  }
  const ago = iso => {
    if (!iso) return 'no steps yet';
    const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  };
  // One race or class: the scoreboard; for the organiser, a table with
  // when each person last ticked a step, and Remind those behind.
  async function openDetail(id) {
    detailId = id;
    const box = document.getElementById('challenges-body');
    if (!box) return;
    let c;
    try { c = await API.getRace(id); } catch (err) { detailId = null; showToast(err.message || 'Could not open it', 'error'); return renderPage(); }
    const me = c.players.find(p => p.you);
    const together = c.mode === 'together';
    const pct = c.group.players ? Math.round((c.group.finished / c.group.players) * 100) : 0;
    box.innerHTML = `<button type="button" class="ch-back" onclick="Race.backToList()">${icon('back', 'tiny')}All challenges</button>
      <div class="ch-head"><span class="ch-ic big">${esc(c.icon || '🏁')}</span><div class="min-w-0"><h3>${esc(c.title)}</h3>
        <p>${together ? 'Class or team' : 'Race'} · ${c.over ? 'ended' : `finish by ${esc(when(c.endsAt))}`}${c.stake ? ` · <span class="race-strip-stake">${esc(c.stake)}</span>` : ''}</p></div></div>
      <div class="ch-actions">
        <button type="button" onclick="Race.inviteFor('${c.id}')">${icon('user-plus', 'tiny')}Invite · <b>${esc(c.joinCode.replace(/(...)(...)/, '$1 $2'))}</b></button>
        ${me ? `<button type="button" onclick="playJourneyFor('${me.projectId}')">${icon('play', 'tiny')}My Journey</button>` : ''}
        ${!together && (c.winner || c.over) ? `<button type="button" onclick="Race.openReport('${c.id}')">${icon('trophy', 'tiny')}Scoreboard</button>` : ''}
        ${c.owner ? `<button type="button" id="ch-remind" onclick="Race.remind('${c.id}')" ${c.group.behind || c.players.some(p => !p.finished && p.done === 0) ? '' : 'disabled'}>${icon('bell', 'tiny')}Remind those behind</button>` : ''}
        ${me ? `<button type="button" class="quiet" onclick="Race.leaveFrom('${c.id}')">Leave</button>` : ''}
      </div>
      ${together ? `<div class="ch-group"><div class="ch-group-top"><b>${c.group.finished} of ${c.group.players} finished</b><span>${c.group.stepsPct}% of all steps done${c.group.behind ? ` · ${c.group.behind} behind` : ''}</span></div>
        <div class="ch-bar" role="img" aria-label="${pct}% finished"><i style="width:${pct}%"></i></div></div>` : ''}
      ${c.players.length ? `<div class="ch-table-wrap"><table class="ch-table"><thead><tr><th>${together ? '' : '#'}</th><th>Name</th><th>Steps</th><th>Pace</th>${c.owner ? '<th>Last step</th>' : ''}</tr></thead>
        <tbody>${c.players.map((p, i) => `<tr class="${p.you ? 'you' : ''}"><td class="pos">${together ? '' : p.place ? placeHtml(p.place) : i + 1}</td>
          <td><span class="dot" style="background:${esc(p.color)}"></span>${p.you ? `You${c.owner ? '' : ''}` : esc(p.name)}</td>
          <td><span class="ch-steps"><i style="width:${Math.round(p.frac * 100)}%"></i></span><span class="num">${p.done}/${p.total}</span></td>
          <td><span class="pace ${p.pace.replace(' ', '-')}">${p.finished ? 'finished' : p.pace}</span></td>
          ${c.owner ? `<td class="ago">${esc(ago(p.lastStepAt))}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
        : `<div class="ch-empty"><p><b>No one has joined yet.</b></p><p>Share the link or read out the code <b>${esc(c.joinCode)}</b>. People join from <b>Challenges › Join with a code</b>.</p></div>`}`;
  }
  function backToList() { detailId = null; renderPage(); }
  async function inviteFor(id) { try { showShare(await API.getRace(id), false); } catch (err) { showToast(err.message || 'Could not open it', 'error'); } }
  async function remind(id) {
    const btn = document.getElementById('ch-remind');
    if (btn) btn.disabled = true;
    try {
      const r = await API.remindRace(id);
      showToast(r.reminded ? `🔔 Reminded ${r.reminded} ${r.reminded === 1 ? 'person' : 'people'}` : 'Everyone is on track. No one to remind');
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(err.message || 'Could not send it', 'error');
    }
  }
  async function leaveFrom(id) {
    try { await API.leaveRace(id); } catch (err) { showToast(err.message || 'Could not leave', 'error'); return; }
    showToast('You left');
    backToList();
  }

  // ── On the Journey ──
  // The race this goal is your copy for, or null. Draws the scoreboard
  // strip and keeps it (and the road) up to date while it's on screen.
  async function load(projectId) {
    clearInterval(poll);
    current = null;
    const strip = document.getElementById('journey-race');
    let race = null;
    try { race = await API.getRaceForProject(projectId); } catch { race = null; }
    if (typeof mountainState === 'undefined' || !mountainState || mountainState.projectId !== projectId) return null;
    current = race;
    paintStrip(strip);
    announcePlace();
    if (race) {
      poll = setInterval(async () => {
        if (!document.getElementById('mountain-scene')?.offsetParent || !current) return;
        let fresh;
        try { fresh = await API.getRace(current.id); } catch { return; }
        const before = JSON.stringify(current.players.map(p => [p.name, p.done]));
        const moved = fresh.players.filter(p => !p.you && (current.players.find(q => q.userId === p.userId) || {}).done < p.done);
        current = fresh;
        paintStrip(document.getElementById('journey-race'));
        announcePlace();
        if (JSON.stringify(fresh.players.map(p => [p.name, p.done])) !== before) {
          renderMountainScene();
          moved.forEach(p => showToast(p.finished ? `${p.place ? `🏆 ${placeText(p.place)}` : '🏁'} ${p.name} finished` : `${p.name} is on step ${p.done} of ${p.total}`));
        }
      }, 45000);
    }
    return race;
  }
  // What the Journey draws: every other player, coloured, with pace.
  function rivals() {
    if (!current) return null;
    const leader = current.players[0];
    // Together (a class or team) has no winner, so no places and no leader.
    const racing = current.mode !== 'together';
    return current.players.filter(p => !p.you).map(p => {
      const isLeader = racing && !p.finished && p === leader && p.frac > 0;
      return { name: p.name, color: p.color, frac: p.frac, finished: p.finished, leader: isLeader, place: p.place || 0, badge: p.place ? placeText(p.place) : isLeader ? 'leading' : '' };
    });
  }
  const youColor = () => (current && (current.players.find(p => p.you) || {}).color) || null;
  const youBadge = () => (current && current.yourPlace ? placeText(current.yourPlace) : '');

  function paintStrip(strip) {
    if (!strip) return;
    if (!current) { strip.classList.add('hidden'); strip.innerHTML = ''; return; }
    const r = current;
    // Calendar days to the finish date (a race ending a fortnight on reads "14 days").
    const midnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const daysLeft = Math.round((midnight(r.endsAt) - midnight(Date.now())) / 86400000);
    const head2 = r.mode === 'together' ? `${icon('users', 'tiny')}<b>${r.group.finished} of ${r.group.players} finished</b> · ${r.over ? 'ended' : daysLeft <= 0 ? 'ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`
      : r.winner ? `${icon('trophy', 'tiny')}<b>${r.winner.you ? 'You won!' : `${esc(r.winner.name)} won`}</b>${r.yourPlace && r.yourPlace > 1 ? ` · you finished ${placeHtml(r.yourPlace)}` : ''}`
      : r.over ? `${icon('flag', 'tiny')}<b>Time's up</b>` : `${icon('flag', 'tiny')}<b>Race</b> · ${daysLeft <= 0 ? 'ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`;
    strip.classList.remove('hidden');
    strip.innerHTML = `<div class="race-strip-top"><span class="race-strip-title">${head2}${r.stake ? ` <span class="race-strip-stake">· ${esc(r.stake)}</span>` : ''}</span>
        <span class="race-strip-actions">${r.mode !== 'together' && (r.winner || r.over) ? `<button type="button" onclick="Race.openReport('${r.id}')">${icon('trophy', 'tiny')}Scoreboard</button>` : ''}<button type="button" onclick="Race.invite()">${icon('user-plus', 'tiny')}Invite</button><button type="button" onclick="Race.leave()">Leave</button></span></div>
      <ol class="race-board">${r.players.map((p, i) => `<li class="${p.you ? 'you' : ''}"><span class="pos">${r.mode === 'together' ? '' : p.place ? placeHtml(p.place) : i + 1}</span><i style="background:${esc(p.color)}"></i><b>${p.you ? 'You' : esc(p.name)}</b>
        <span class="steps">${p.done}/${p.total}</span><span class="pace ${p.pace.replace(' ', '-')}">${p.finished ? 'finished' : p.pace}</span></li>`).join('')}</ol>`;
  }
  // Your finishing place, said once per race (with confetti on the podium),
  // then the report a tap away.
  function announcePlace() {
    const r = current;
    if (!r || r.mode === 'together' || !r.yourPlace) return;
    const key = `wp-race-placed:${r.id}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* say it anyway */ }
    if (r.yourPlace <= 3 && typeof fireBigScreenConfetti === 'function') fireBigScreenConfetti();
    showActionToast(`🏆 You finished ${r.yourPlace === 1 ? 'first' : ordinal(r.yourPlace)} in ${r.title}`, [{ label: 'Scoreboard', run: () => openReport(r.id) }]);
  }

  // ── The race report: a podium and the full scoreboard ──
  // Places, when each person finished and how long they took from joining,
  // and the stake with whose turn it is. Shareable as text.
  const took = (from, to) => {
    const m = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
  };
  const at = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  async function openReport(id) {
    let r;
    try { r = await API.getRace(id); } catch (err) { showToast(err.message || 'Could not open the scoreboard', 'error'); return; }
    const finishers = r.players.filter(p => p.finished);
    const still = r.players.filter(p => !p.finished);
    const done = !still.length || r.over;
    const nameOf = p => (p.you ? 'You' : esc(p.name));
    const podium = [2, 1, 3].map(n => finishers.find(p => p.place === n)).map((p, i) => {
      const n = [2, 1, 3][i];
      return `<div class="rr-step rr-${n}${p ? '' : ' empty'}"><span class="rr-medal">${cup(n)}</span>
        <b>${p ? nameOf(p) : '–'}</b><small>${p ? took(p.joinedAt, p.finishedAt) : ''}</small><i style="${p ? `background:${esc(p.color)}` : ''}">${ordinal(n)}</i></div>`;
    }).join('');
    // Whose turn the stake is: the last to finish once it's over.
    const last = done && r.players.length > 1 ? r.players[r.players.length - 1] : null;
    const rows = r.players.map((p, i) => `<tr class="${p.you ? 'you' : ''}">
        <td class="pos">${p.place ? placeHtml(p.place) : `<span class="dnf">${r.over ? 'DNF' : '–'}</span>`}</td>
        <td><span class="dot" style="background:${esc(p.color)}"></span>${nameOf(p)}</td>
        <td class="num">${p.done}/${p.total}</td>
        <td class="rr-when">${p.finished ? esc(at(p.finishedAt)) : r.over ? 'Did not finish' : 'Still racing'}</td>
        <td class="num">${p.finished ? took(p.joinedAt, p.finishedAt) : r.over ? 'DNF' : 'racing'}</td></tr>`).join('');
    const text = `${r.title} race${done ? ' results' : ' so far'}: ${r.players.map((p, i) => `${p.place ? ordinal(p.place) : r.over ? 'DNF' : `${p.done}/${p.total}`} ${p.you ? 'me' : p.name}${p.finished ? ` (${took(p.joinedAt, p.finishedAt)})` : ''}`).join(', ')}${r.stake ? `. Stake: ${r.stake}` : ''}`;
    const form = dialog(`${head('Scoreboard')}
      <div class="rr-title"><span>${esc(r.icon || '🏁')}</span><div><b>${esc(r.title)}</b><small>Started ${esc(when(r.startsAt))} · finish by ${esc(when(r.endsAt))} · ${r.players.length} ${r.players.length === 1 ? 'racer' : 'racers'}${done ? '' : ` · ${still.length} still racing`}</small></div></div>
      <div class="rr-podium" aria-label="Podium">${podium}</div>
      ${r.stake ? `<p class="race-stake">${icon('gift', 'tiny')}<span>Riding on it: <b>${esc(r.stake)}</b>${last ? ` · <b>${last.you ? "that's you" : `over to ${esc(last.name)}`}</b>` : ''}</span></p>` : ''}
      <div class="ch-table-wrap"><table class="ch-table rr-table"><thead><tr><th>Place</th><th>Name</th><th>Steps</th><th class="rr-when">Finished</th><th>Took</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="fb-foot"><button type="button" class="fb-cancel" id="rr-copy">${icon('copy', 'tiny')}Copy results</button>${navigator.share ? `<button type="button" class="fb-cancel" id="rr-share">${icon('send', 'tiny')}Share</button>` : ''}<button type="submit" class="fb-send">Done</button></div>`);
    form.classList.add('race-report');
    form.querySelector('#rr-copy').onclick = async () => { try { await navigator.clipboard.writeText(text); showToast('📋 Results copied'); } catch { showToast(text); } };
    const share = form.querySelector('#rr-share');
    if (share) share.onclick = () => navigator.share({ title: `${r.title}: race results`, text }).catch(() => {});
    form.addEventListener('submit', e => { e.preventDefault(); close(); });
  }

  // The "you did it" celebration for a goal that was your copy in a race:
  // your place, out of how many, and who won; in a class, how many of the
  // group have finished. It counts as the place announcement.
  async function fillCelebration(projectId) {
    let r = null;
    try { r = await API.getRaceForProject(projectId); } catch { return; }
    if (!r) return;
    const el = id => document.getElementById(id);
    const msg = el('project-complete-message');
    if (!msg) return;
    old(); // a previous race line, if the sheet was shown before
    const line = document.createElement('div');
    line.id = 'project-complete-race';
    line.className = 'pc-race';
    if (r.mode === 'together') {
      line.innerHTML = `${icon('users', 'tiny')}<span>You're one of <b>${r.group.finished} of ${r.group.players}</b> to finish ${esc(r.title)}.</span>`;
    } else if (r.yourPlace) {
      const place = r.yourPlace;
      el('project-complete-heading').textContent = place === 1 ? 'You won the race!' : `You finished ${ordinal(place)}!`;
      const others = r.players.length - 1;
      line.innerHTML = `${icon('trophy', 'tiny')}<span><b>${placeHtml(place)}</b> of ${r.players.length} in the race${place > 1 && r.winner ? `. ${esc(r.winner.name)} won` : others ? `. ${others} still behind you` : ''}.</span>
        <button type="button" onclick="dismissProjectCompleteOverlay(); Race.openReport('${r.id}')">Scoreboard</button>`;
      try { localStorage.setItem(`wp-race-placed:${r.id}`, '1'); } catch { /* fine */ }
    } else return;
    msg.insertAdjacentElement('afterend', line);
    function old() { document.getElementById('project-complete-race')?.remove(); }
  }

  // The Journey's "you reached the target" message in a race: your place,
  // out of how many, who won. Null when it isn't a race you've finished.
  async function finishMessage(projectId) {
    let r = null;
    try { r = await API.getRaceForProject(projectId); } catch { return null; }
    if (!r) return null;
    current = r;
    paintStrip(document.getElementById('journey-race'));
    if (r.mode === 'together') {
      return { heading: 'You finished!', emoji: '🏁', message: `You're one of ${r.group.finished} of ${r.group.players} to finish “${r.title}”.` };
    }
    if (!r.yourPlace) return null;
    try { localStorage.setItem(`wp-race-placed:${r.id}`, '1'); } catch { /* fine */ }
    const place = r.yourPlace;
    if (place <= 3 && typeof fireBigScreenConfetti === 'function') fireBigScreenConfetti();
    return {
      heading: place === 1 ? 'You won the race!' : `You finished ${ordinal(place)}!`,
      emoji: '🏆',
      message: `${place === 1 ? 'Gold' : place === 2 ? 'Silver' : place === 3 ? 'Bronze' : ordinal(place)}${place <= 3 ? ` cup, ${ordinal(place)}` : ''} of ${r.players.length} in “${r.title}”.${place > 1 && r.winner ? ` ${r.winner.name} won.` : ''}${r.stake && place === 1 ? ` Riding on it: ${r.stake}.` : ''}`,
    };
  }

  function invite() { if (current) showShare(current, false); }
  async function leave() {
    if (!current) return;
    const form = dialog(`${head('Leave the race?')}
      <p class="fb-note">You'll come off the road and the scoreboard. Your copy of the goal and its tasks stay yours.</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Stay in</button><button type="submit" class="fb-send">Leave</button></div>`);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      try { await API.leaveRace(current.id); } catch (err) { showToast(err.message || 'Could not leave', 'error'); return; }
      close();
      current = null;
      clearInterval(poll);
      paintStrip(document.getElementById('journey-race'));
      renderMountainScene();
      showToast('You left the race');
    });
  }

  return { youBadge, finishMessage, openReport, fillCelebration, openCreate, showShare, handleLink, offerPendingJoin, joinWithCode, renderPage, openDetail, backToList, inviteFor, remind, leaveFrom, load, rivals, youColor, invite, leave, close, current: () => current };
})();
window.Race = Race;
