/* global icon, esc, API, APP, showToast, playJourneyFor, renderMountainScene, mountainState */
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
  async function openCreate(projectId) {
    if (!projectId) return;
    let name = '';
    try { name = (await API.getProfile()).name || ''; } catch { /* a blank name is fine */ }
    const min = dayKey(Date.now() + 86400000);
    const form = dialog(`${head('Race a friend')}
      <p class="fb-note">Everyone who joins gets their own copy of this goal's tasks. First to tick them all off wins.</p>
      <label for="race-end">Finish by</label>
      <input type="date" id="race-end" min="${min}" value="${dayKey(Date.now() + 14 * 86400000)}" required>
      <label for="race-stake">What's riding on it? <span class="opt">(optional)</span></label>
      <input type="text" id="race-stake" maxlength="140" placeholder="e.g. Loser buys dinner">
      <label for="race-name">Your name on the road</label>
      <input type="text" id="race-name" maxlength="24" value="${esc(name)}" placeholder="e.g. Ade" required>
      <p class="fb-note">A stake is a promise between you. Waypoint never takes or pays out money.</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Cancel</button><button type="submit" class="fb-send">${icon('flag', 'tiny')}Make the race</button></div>`);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('.fb-send');
      btn.disabled = true;
      try {
        const race = await API.createRace({
          projectId, endsAt: new Date(`${form.querySelector('#race-end').value}T23:59:00`).toISOString(),
          stake: form.querySelector('#race-stake').value, displayName: form.querySelector('#race-name').value,
        });
        showShare(race, true);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'Could not make the race', 'error');
      }
    });
  }

  // The link to send, with Copy and (on a phone) Share.
  function showShare(race, isNew) {
    const url = linkFor(race.joinToken);
    const me = race.players.find(p => p.you);
    const form = dialog(`${head(isNew ? 'Your race is ready' : 'Invite to the race')}
      <p class="fb-note">Send this link to the people you're racing. They'll see <b>${esc(race.title)}</b>${race.stake ? `, the stake (${esc(race.stake)})` : ''} and the finish date, ${esc(when(race.endsAt))}.</p>
      <div class="race-link"><input type="text" id="race-link" readonly value="${esc(url)}" aria-label="Race link"><button type="button" class="fb-cancel" id="race-copy">${icon('copy', 'tiny')}Copy</button></div>
      <div class="fb-foot">${navigator.share ? `<button type="button" class="fb-cancel" id="race-share">${icon('send', 'tiny')}Share</button>` : ''}
        <button type="submit" class="fb-send">${icon('play', 'tiny')}Go to my race</button></div>`);
    form.querySelector('#race-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(url); showToast('🔗 Link copied'); } catch { form.querySelector('#race-link').select(); }
    };
    const share = form.querySelector('#race-share');
    if (share) share.onclick = () => navigator.share({ title: `Race me: ${race.title}`, text: `Race me to finish "${race.title}" by ${when(race.endsAt)}${race.stake ? `. Stake: ${race.stake}` : ''}`, url }).catch(() => {});
    form.addEventListener('submit', e => { e.preventDefault(); close(); if (me && me.projectId) playJourneyFor(me.projectId); });
  }

  // ── Joining from a link (/app?race=…) ──
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
        if (note) { note.innerHTML = `${icon('flag', 'tiny')}<span><b>${esc(p.owner)}</b> challenged you to <b>${esc(p.title)}</b>. Sign in or create an account to join the race.</span>`; note.classList.remove('hidden'); }
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
    if (!p || !p.title) { showToast('That race link is not valid any more', 'error'); return; }
    let name = '';
    try { name = (await API.getProfile()).name || ''; } catch { /* blank */ }
    const form = dialog(`${head(`${p.owner} challenged you`)}
      <div class="race-invite"><span class="race-invite-ic">${esc(p.icon || '🏁')}</span><div><b>${esc(p.title)}</b><small>${p.taskCount} steps · finish by ${esc(when(p.endsAt))} · ${p.players} ${p.players === 1 ? 'player' : 'players'} so far</small></div></div>
      ${p.stake ? `<p class="race-stake">${icon('gift', 'tiny')}<span>Riding on it: <b>${esc(p.stake)}</b></span></p>` : ''}
      <label for="race-name">Your name on the road</label>
      <input type="text" id="race-name" maxlength="24" value="${esc(name)}" placeholder="e.g. Sam" required>
      <p class="fb-note">You get your own copy of the steps. Everyone sees how far along you are, never your other goals.</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Not now</button><button type="submit" class="fb-send" ${p.full ? 'disabled' : ''}>${icon('flag', 'tiny')}${p.full ? 'This race is full' : 'Join the race'}</button></div>`);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('.fb-send');
      btn.disabled = true;
      try {
        const r = await API.joinRace(token, form.querySelector('#race-name').value);
        close();
        showToast(r.already ? "You're already in this race" : `🏁 You're in. ${p.taskCount} steps to the finish`);
        playJourneyFor(r.projectId);
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'Could not join', 'error');
      }
    });
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
    if (race) {
      poll = setInterval(async () => {
        if (!document.getElementById('mountain-scene')?.offsetParent || !current) return;
        let fresh;
        try { fresh = await API.getRace(current.id); } catch { return; }
        const before = JSON.stringify(current.players.map(p => [p.name, p.done]));
        const moved = fresh.players.filter(p => !p.you && (current.players.find(q => q.userId === p.userId) || {}).done < p.done);
        current = fresh;
        paintStrip(document.getElementById('journey-race'));
        if (JSON.stringify(fresh.players.map(p => [p.name, p.done])) !== before) {
          renderMountainScene();
          moved.forEach(p => showToast(p.finished ? `🏁 ${p.name} finished the race` : `${p.name} is on step ${p.done} of ${p.total}`));
        }
      }, 45000);
    }
    return race;
  }
  // What the Journey draws: every other player, coloured, with pace.
  function rivals() {
    if (!current) return null;
    const leader = current.players[0];
    return current.players.filter(p => !p.you).map(p => ({ name: p.name, color: p.color, frac: p.frac, finished: p.finished, leader: p === leader && p.frac > 0 }));
  }
  const youColor = () => (current && (current.players.find(p => p.you) || {}).color) || null;

  function paintStrip(strip) {
    if (!strip) return;
    if (!current) { strip.classList.add('hidden'); strip.innerHTML = ''; return; }
    const r = current;
    // Calendar days to the finish date (a race ending a fortnight on reads "14 days").
    const midnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const daysLeft = Math.round((midnight(r.endsAt) - midnight(Date.now())) / 86400000);
    const head2 = r.winner ? `${icon('trophy', 'tiny')}<b>${r.winner.you ? 'You won!' : `${esc(r.winner.name)} won`}</b>`
      : r.over ? `${icon('flag', 'tiny')}<b>Time's up</b>` : `${icon('flag', 'tiny')}<b>Race</b> · ${daysLeft <= 0 ? 'ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`;
    strip.classList.remove('hidden');
    strip.innerHTML = `<div class="race-strip-top"><span class="race-strip-title">${head2}${r.stake ? ` <span class="race-strip-stake">· ${esc(r.stake)}</span>` : ''}</span>
        <span class="race-strip-actions"><button type="button" onclick="Race.invite()">${icon('user-plus', 'tiny')}Invite</button><button type="button" onclick="Race.leave()">Leave</button></span></div>
      <ol class="race-board">${r.players.map((p, i) => `<li class="${p.you ? 'you' : ''}"><span class="pos">${i + 1}</span><i style="background:${esc(p.color)}"></i><b>${p.you ? 'You' : esc(p.name)}</b>
        <span class="steps">${p.done}/${p.total}</span><span class="pace ${p.pace.replace(' ', '-')}">${p.finished ? 'finished' : p.pace}</span></li>`).join('')}</ol>`;
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

  return { openCreate, showShare, handleLink, offerPendingJoin, load, rivals, youColor, invite, leave, close, current: () => current };
})();
window.Race = Race;
