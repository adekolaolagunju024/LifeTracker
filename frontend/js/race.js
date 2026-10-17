/* global AIFill, showUndoToast, openProjectChat, renderGantt, icon, esc, API, APP, showToast, showActionToast, fireBigScreenConfetti, showPage, playJourneyFor, renderMountainScene, mountainState */
// ── RACE A FRIEND ───────────────────────────────────────────────
// Make a race from one of your goals, share the link, and everyone who
// joins races their own copy (backend/challenges.js). On the Journey every
// player stands on the same road with their name over their head
// (journeyGame.js drawRivals), and a strip above it is the scoreboard.
// A stake is a promise in words; KolaWay never takes or pays out money.
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

  // Who leads a group, and the words that follow from it: a coach's squad
  // of players, a trainer's clients, a teacher's class of pupils…
  const ROLES = {
    coach: { label: 'Coach', kind: 'Squad', group: 'squad', people: 'players' },
    trainer: { label: 'Trainer', kind: 'Client group', group: 'clients', people: 'clients' },
    teacher: { label: 'Teacher', kind: 'Class', group: 'class', people: 'pupils' },
    manager: { label: 'Manager', kind: 'Team', group: 'team', people: 'team members' },
    leader: { label: 'Team leader', kind: 'Team', group: 'team', people: 'members' },
    organiser: { label: 'Organiser', kind: 'Group', group: 'group', people: 'members' },
  };
  const roleOf = c => ROLES[c && c.leaderRole] || ROLES.leader;
  // A group has a leader and no winner: a class or squad, each on their own
  // copy ('together'), or a team splitting one shared goal ('split').
  const isGrp = c => !!c && (c.mode === 'together' || c.mode === 'split');
  const kindOf = c => (isGrp(c) ? roleOf(c).kind : 'Race');

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
  const head = (title, ic = 'flag') => `<div class="fb-head"><h2 id="race-title">${icon(ic)}${esc(title)}</h2><button type="button" class="fb-x" aria-label="Close" onclick="Race.close()">${icon('close')}</button></div>`;

  // How steps are checked, so no one can just tick everything to win.
  const CHECKS_NOTE = {
    none: () => 'Every tick counts straight away. Best between friends. A burst of steps ticked in under a minute is pointed out in the chat.',
    proof: () => 'A tick counts once there is a photo or a few words to show it. Everyone sees the proof in the chat.',
    leader: role => `A tick counts once the ${role.label.toLowerCase()} approves it. A photo or a note helps them decide.`,
    milestones: role => `Most steps count when ticked. The ones you mark as milestones wait for sign-off: by the lead of their phase, or the ${role.label.toLowerCase()}.`,
  };
  const checksLabel = c => ({ proof: 'proof for each step', leader: `${roleOf(c).label.toLowerCase()} signs off`, milestones: 'milestones signed off' })[c.checks] || '';
  // A split team's sign-off, as the leader can change it on the team page.
  const SPLIT_CHECKS = [['none', 'No sign-off'], ['milestones', 'Sign off milestones'], ['leader', 'Sign off every step'], ['proof', 'Proof for every step']];
  const signsOff = c => c.checks === 'leader' || c.checks === 'milestones';

  // ── Making one ──
  // Team up: lead a group (a squad, clients, a class, a team: everyone aims
  // to finish; the leader can run it without taking part, and chooses how
  // names show) or race friends (first to finish wins).
  async function openCreate(projectId) {
    if (!projectId) return;
    // A goal already in a running team: that team, not a second one (which
    // would read as a duplicate in Teams, Chats and your goals).
    try {
      const top = (await API.getProject(projectId)).parentId || projectId;
      const existing = await API.getRaceForProject(top);
      // (who can see or edit it by email stays a tap away)
      if (existing && !existing.over) { showActionToast(`Opening the team “${existing.title}”`, [{ label: 'Who can see it', run: () => openShareProject(projectId) }], 'users'); openTeam(existing.id); return; }
    } catch { /* no team yet */ }
    let name = '';
    try { name = (await API.getProfile()).name || ''; } catch { /* a blank name is fine */ }
    // You take part on this goal as it is (no duplicate), unless it's a
    // race and you've already ticked steps: then a fresh copy, so everyone
    // starts level.
    let ticked = 0;
    try { ticked = (await API.getTasks()).filter(t => t.projectId === projectId && t.status === 'Completed').length; } catch { /* none */ }
    const min = dayKey(Date.now() + 86400000);
    const fill = window.AIFill ? AIFill.button({
      form: 'Teaming up on a goal: a race between friends, or a group someone leads',
      projectId: () => projectId,
      context: () => (mode === 'race' ? 'They are racing friends to finish it first.' : `They lead a group (as ${(ROLES[form.querySelector('#race-role').value] || ROLES.leader).label}) through it.`),
      fields: [
        { key: 'end', label: 'Finish by date', type: 'date', el: '#race-end', hint: 'Realistic for the steps left in the goal', get: () => (form.querySelector('#race-end').dataset.touched ? form.querySelector('#race-end').value : '') },
        { key: 'stake', label: "What's riding on it", type: 'text', el: '#race-stake', when: () => mode === 'race', hint: 'A light-hearted promise between friends, like who buys dinner. Never money' },
      ],
    }) : '';
    // Who it's already shared with by email, for the line under the choices.
    let shared = 0;
    try { shared = (await API.getCollaborators(projectId)).filter(c => c.role !== 'owner').length; } catch { /* none */ }
    // One door for bringing people in: the three ways below, and plain view
    // or edit access by email for someone who only needs to see it.
    const form = dialog(`${head('Team up', 'users')}
      <p class="fb-note team-ask">How will you work on this?</p>
      <div class="seg race-mode" role="radiogroup" aria-label="How you team up">
        <button type="button" role="radio" data-mode="split" aria-checked="true">${icon('users', 'tiny')}Collaborate</button>
        <button type="button" role="radio" data-mode="together" aria-checked="false">${icon('layers', 'tiny')}Group</button>
        <button type="button" role="radio" data-mode="race" aria-checked="false">${icon('flag', 'tiny')}Challenge</button>
      </div>
      <div class="together-only"><label for="race-role">You're the</label>
        <select id="race-role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === 'leader' ? ' selected' : ''}>${r.label}</option>`).join('')}</select></div>
      <p class="fb-note" id="race-mode-note"></p>
      ${fill ? `<div class="ai-fill-row">${fill}</div>` : ''}
      <label for="race-checks">How steps are checked</label>
      <select id="race-checks"></select>
      <p class="fb-note" id="race-checks-note"></p>
      <label for="race-end">Finish by</label>
      <input type="date" id="race-end" min="${min}" value="${dayKey(Date.now() + 14 * 86400000)}" required oninput="this.dataset.touched = '1'">
      <div class="race-only"><label for="race-stake">What's riding on it? <span class="opt">(optional)</span></label>
      <input type="text" id="race-stake" maxlength="140" placeholder="e.g. Loser buys dinner"></div>
      <div class="together-only hidden">
        <label class="race-check organise-only"><input type="checkbox" id="race-organise"> I'm leading, not taking part</label>
        <label for="race-names">How names show to everyone</label>
        <select id="race-names"><option value="names">Their names</option><option value="first">First names only</option><option value="animals">Animal names (e.g. Swift Otter)</option></select>
      </div>
      <div id="race-name-wrap"><label for="race-name">Your name on the road</label>
      <input type="text" id="race-name" maxlength="24" value="${esc(name)}" placeholder="e.g. Ade"></div>
      <p class="fb-note race-only">A stake is a promise between you. KolaWay never takes or pays out money.</p>
      <p class="fb-note team-access">${icon('lock', 'tiny')}Need to give someone view or edit access only? <button type="button" class="ch-link" id="team-email">Grant access by email</button>${shared ? ` · shared with ${shared} ${shared === 1 ? 'person' : 'people'}` : ''}</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Cancel</button><button type="submit" class="fb-send">${icon('users', 'tiny')}<span id="race-make-label">Set up the team</span></button></div>`);
    form.querySelector('#team-email').onclick = () => { close(); openShareProject(projectId); };
    let mode = 'split';
    let organiseTouched = false;
    const checksSel = form.querySelector('#race-checks');
    const paintChecks = role => {
      const was = checksSel.value;
      const lead = [['leader', `The ${role.label.toLowerCase()} signs each step off`], ['proof', 'A photo or note for each step'], ['none', 'Trust everyone']];
      // a team splitting work trusts each other unless the leader says otherwise
      const opts = mode === 'race' ? [['none', 'Trust everyone'], ['proof', 'A photo or note for each step']] : mode === 'split' ? [lead[2], ['milestones', 'Only the milestones are signed off'], lead[0], lead[1]] : lead;
      checksSel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
      checksSel.value = opts.some(o => o[0] === was) && checksSel.dataset.touched ? was : opts[0][0];
      form.querySelector('#race-checks-note').textContent = CHECKS_NOTE[checksSel.value](role);
    };
    checksSel.onchange = () => { checksSel.dataset.touched = '1'; paint(); };
    const paint = () => {
      const role = ROLES[form.querySelector('#race-role').value] || ROLES.leader;
      paintChecks(role);
      // A coach, trainer or teacher usually leads without doing the steps.
      if (!organiseTouched) form.querySelector('#race-organise').checked = ['Coach', 'Trainer', 'Teacher'].includes(role.label);
      form.querySelectorAll('.race-mode button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
      form.querySelectorAll('.race-only').forEach(el => el.classList.toggle('hidden', mode !== 'race'));
      form.querySelectorAll('.together-only').forEach(el => el.classList.toggle('hidden', mode === 'race'));
      form.querySelectorAll('.organise-only').forEach(el => el.classList.toggle('hidden', mode !== 'together'));
      const organising = mode === 'together' && form.querySelector('#race-organise').checked;
      form.querySelector('#race-name-wrap').classList.toggle('hidden', organising);
      form.querySelector('#race-mode-note').textContent = mode === 'split'
        ? `One shared goal for the whole ${role.group}. Assign each step, or let people claim one, and everyone's part adds up to the finish. They work on this goal itself, not a copy, and you see who owns what and who is behind.`
        : mode === 'race'
        ? `Each participant gets their own copy of this goal's steps. The first to complete them all wins. ${ticked ? `You've ticked ${ticked} already, so you'll race on a fresh copy and everyone starts level.` : 'You race on this goal as it is.'}`
        : `Each of your ${role.people} works through their own copy of these steps towards the same date, as in a class or a coaching programme. You see who is on track and can nudge anyone behind. They join with a link or a code.${organising ? '' : ' You take part on this goal as it is.'}`;
      form.querySelector('#race-make-label').textContent = mode === 'race' ? 'Make the race' : `Set up the ${role.kind.toLowerCase()}`;
    };
    form.querySelectorAll('.race-mode button').forEach(b => { b.onclick = () => { mode = b.dataset.mode; paint(); }; });
    form.querySelector('#race-organise').onchange = () => { organiseTouched = true; paint(); };
    form.querySelector('#race-role').onchange = paint;
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
          projectId, mode, organiserOnly: organising, nameMode: form.querySelector('#race-names').value, leaderRole: form.querySelector('#race-role').value, checks: checksSel.value,
          endsAt: new Date(`${form.querySelector('#race-end').value}T23:59:00`).toISOString(),
          stake: mode === 'race' ? form.querySelector('#race-stake').value : '', displayName,
        });
        showShare(race, true);
      } catch (err) {
        btn.disabled = false;
        if (err.code === 'TEAM_EXISTS' && err.teamId) { close(); showActionToast('This goal already has a team', [{ label: 'Open it', run: () => openTeam(err.teamId) }], 'users'); return; }
        showToast(err.message || 'Could not make it', 'error');
      }
    });
  }

  // A join code onto the clipboard, as typed in Teams › Join with a code.
  async function copyCode(code) {
    try { await navigator.clipboard.writeText(code); showToast(`📋 Code ${code} copied`); } catch { showToast(`Join code: ${code}`); }
  }

  // The link and the code to send, with Copy and (on a phone) Share.
  function showShare(race, isNew) {
    const url = linkFor(race.joinToken);
    const me = race.players.find(p => p.you);
    const together = isGrp(race);
    const code = race.joinCode ? race.joinCode.replace(/(...)(...)/, '$1 $2') : '';
    const form = dialog(`${head(isNew ? (together ? `Your ${roleOf(race).group} is ready` : 'Your race is ready') : 'Invite people', together ? 'users' : 'flag')}
      <p class="fb-note">Send the link${code ? ', or read out the code' : ''}. They'll see <b>${esc(race.title)}</b>${race.stake ? `, the stake (${esc(race.stake)})` : ''} and the finish date, ${esc(when(race.endsAt))}.</p>
      ${code ? `<div class="race-code"><small>Join code</small><b aria-label="Join code ${esc(race.joinCode.split('').join(' '))}">${esc(code)}</b><span>Teams › Join with a code</span><button type="button" id="race-code-copy">${icon('copy', 'tiny')}Copy code</button></div>` : ''}
      <div class="race-link"><input type="text" id="race-link" readonly value="${esc(url)}" aria-label="Join link"><button type="button" class="fb-cancel" id="race-copy">${icon('copy', 'tiny')}Copy</button></div>
      <div class="fb-foot">${navigator.share ? `<button type="button" class="fb-cancel" id="race-share">${icon('send', 'tiny')}Share</button>` : ''}
        <button type="submit" class="fb-send">${icon('play', 'tiny')}${me ? (together ? 'Go to my goal' : 'Go to my race') : 'See who has joined'}</button></div>`);
    const codeBtn = form.querySelector('#race-code-copy');
    if (codeBtn) codeBtn.onclick = () => copyCode(race.joinCode);
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
        if (note) { note.innerHTML = `${icon('flag', 'tiny')}<span><b>${esc(p.owner)}</b> ${isGrp(p) ? 'invited you to' : 'challenged you to'} <b>${esc(p.title)}</b>. Sign in or create an account to join.</span>`; note.classList.remove('hidden'); }
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
  // From a code typed on the Teams page.
  async function joinWithCode(code) {
    const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 6) { showToast('A join code has 6 letters and numbers', 'error'); return; }
    let p;
    try { p = await API.previewRaceCode(clean); } catch (err) { showToast(err.message || "That code doesn't match a team or race", 'error'); return; }
    joinCard(p, p.token);
  }
  async function joinCard(p, token) {
    let name = '';
    try { name = (await API.getProfile()).name || ''; } catch { /* blank */ }
    const together = isGrp(p);
    const role = roleOf(p);
    const namesNote = p.nameMode === 'animals' ? `The others see you by an animal name; the ${role.label.toLowerCase()} sees your name.`
      : p.nameMode === 'first' ? 'Others see your first name only.' : 'Everyone sees the name you give here.';
    const form = dialog(`${head(together ? `${role.label} ${p.owner} invited you to the ${role.group}` : `${p.owner} challenged you to a race`, together ? 'users' : 'flag')}
      <div class="race-invite"><span class="race-invite-ic">${esc(p.icon || '🏁')}</span><div><b>${esc(p.title)}</b><small>${p.taskCount} steps · finish by ${esc(when(p.endsAt))} · ${p.players} ${p.players === 1 ? 'person' : 'people'} so far</small></div></div>
      ${p.stake ? `<p class="race-stake">${icon('gift', 'tiny')}<span>Riding on it: <b>${esc(p.stake)}</b></span></p>` : ''}
      <label for="race-name">Your name</label>
      <input type="text" id="race-name" maxlength="24" value="${esc(name)}" placeholder="e.g. Sam" required>
      <p class="fb-note">${p.mode === 'split' ? `You join the goal itself, shared with you, and take on some of its steps. ${namesNote}` : `You get your own copy of the steps. ${together ? namesNote : 'Everyone sees how far along you are.'}`} No one sees your other goals.</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Not now</button><button type="submit" class="fb-send" ${p.full ? 'disabled' : ''}>${icon(together ? 'users' : 'flag', 'tiny')}${p.full ? 'It is full' : together ? `Join the ${role.group}` : 'Join the race'}</button></div>`);
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

  // ── The Teams page: groups you lead or are in, races, joining by code ──
  let detailId = null;
  async function renderPage() {
    const box = document.getElementById('challenges-body');
    if (!box) return;
    detailId = null; // the Teams link always opens on the list
    box.innerHTML = '<p class="text-sm text-gray-400 py-6">Loading…</p>';
    let list = [];
    try { list = await API.listRaces(); } catch { list = []; }
    const card = c => {
      const me = c.players.find(p => p.you);
      const line = c.mode === 'split'
        ? `${c.group.stepsPct}% of the goal done${c.split && c.split.unclaimed ? ` · ${c.split.unclaimed} unclaimed` : ''}`
        : isGrp(c)
        ? `${c.group.finished} of ${c.group.players} finished · ${c.group.stepsPct}% of steps`
        : c.yourPlace ? `You finished ${placeHtml(c.yourPlace)}` : c.winner ? `${esc(c.winner.name)} won` : me ? `You're ${ordinal(c.players.indexOf(me) + 1)} of ${c.players.length}` : `${c.players.length} racing`;
      // a finished one has its own clear button beside the card
      return `<div class="ch-card-row${c.doneForYou ? ' done' : ''}"><button type="button" class="ch-card" onclick="Race.openDetail('${c.id}')">
        <span class="ch-ic">${esc(c.icon || '🏁')}</span>
        <span class="ch-main"><b>${esc(c.title)}</b><small>${kindOf(c)}${isGrp(c) ? (c.owner ? ' · you lead' : c.leaderName ? ` · led by ${esc(c.leaderName)}` : '') : ''} · ${c.over ? 'ended' : c.doneForYou ? 'finished' : `finish by ${esc(when(c.endsAt))}`}</small></span>
        <span class="ch-line">${line}</span>${unreadBadge(c)}${icon('chevron_right', 'tiny')}</button>
        ${c.doneForYou ? `<button type="button" class="ch-clear" onclick="Race.clearFromList(['${c.id}'])" aria-label="Clear ${esc(c.title)} from your list" title="Clear from your list">${icon('close', 'tiny')}</button>` : ''}</div>`;
    };
    const finishedIds = list.filter(c => c.doneForYou).map(c => c.id);
    box.innerHTML = `<form class="ch-join" id="ch-join-form"><label for="join-code">Got a code?</label>
        <div><input type="text" id="join-code" maxlength="9" autocomplete="off" autocapitalize="characters" placeholder="e.g. K7M 2QP"><button type="submit">Join</button></div></form>
      ${finishedIds.length ? `<div class="ch-list-head"><span>${list.length} on your list${finishedIds.length ? ` · ${finishedIds.length} finished` : ''}</span><button type="button" onclick="Race.clearFromList([${finishedIds.map(id => `'${id}'`).join(',')}])">${icon('trash', 'tiny')}Clear finished</button></div>` : ''}
      ${list.length ? `<div class="ch-list">${list.map(card).join('')}</div>`
        : `<div class="ch-empty"><p><b>No teams yet.</b></p><p>Open any goal and choose <b>Team up</b>: lead a squad, class, team or your clients through it, or race friends to the finish.</p></div>`}`;
    document.getElementById('ch-join-form').addEventListener('submit', e => { e.preventDefault(); joinWithCode(document.getElementById('join-code').value); });
  }
  const ago = iso => {
    if (!iso) return 'no steps yet';
    const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  };
  // One group or race: the scoreboard; for the leader, a table with
  // when each person last ticked a step, and Remind those behind.
  async function openDetail(id) {
    detailId = id;
    const box = document.getElementById('challenges-body');
    if (!box) return;
    let c;
    try { c = await API.getRace(id); } catch (err) { detailId = null; showToast(err.message || 'Could not open it', 'error'); return renderPage(); }
    const me = c.players.find(p => p.you);
    const together = isGrp(c);
    const pct = c.group.players ? Math.round((c.group.finished / c.group.players) * 100) : 0;
    box.innerHTML = `<button type="button" class="ch-back" onclick="Race.backToList()">${icon('back', 'tiny')}All teams</button>
      <div class="ch-head"><span class="ch-ic big">${esc(c.icon || '🏁')}</span><div class="min-w-0"><h3>${esc(c.title)}</h3>
        <p>${kindOf(c)}${together ? (c.owner ? ` · you're the ${roleOf(c).label.toLowerCase()}` : c.leaderName ? ` · ${leadBadge(c)} ${esc(c.leaderName)}` : '') : ''}${c.checks && c.checks !== 'none' ? ` · ${esc(checksLabel(c))}` : ''} · ${c.over ? 'ended' : `finish by ${esc(when(c.endsAt))}`}${c.stake ? ` · <span class="race-strip-stake">${esc(c.stake)}</span>` : ''}</p></div></div>
      <div class="ch-actions">
        <button type="button" onclick="Race.openChat('${c.id}')">${icon('message-circle', 'tiny')}Chat${unreadBadge(c)}</button>
        <button type="button" onclick="Race.inviteFor('${c.id}')">${icon('user-plus', 'tiny')}Invite · <b>${esc(c.joinCode.replace(/(...)(...)/, '$1 $2'))}</b></button>
        ${me ? `<button type="button" onclick="playJourneyFor('${me.projectId}')">${icon('play', 'tiny')}My Journey</button>` : ''}
        ${!together && (c.winner || c.over) ? `<button type="button" onclick="Race.openReport('${c.id}')">${icon('trophy', 'tiny')}Scoreboard</button>` : ''}
        ${c.owner ? `<button type="button" id="ch-remind" onclick="Race.remind('${c.id}')" ${c.group.behind || c.players.some(p => !p.finished && p.done === 0) ? '' : 'disabled'}>${icon('bell', 'tiny')}Remind those behind</button>` : ''}
        ${c.doneForYou ? `<button type="button" class="quiet" onclick="Race.clearFromList(['${c.id}'])">${icon('trash', 'tiny')}Clear from my list</button>`
          : me && !(c.mode === 'split' && c.owner) ? `<button type="button" class="quiet" onclick="Race.leaveFrom('${c.id}')">Leave</button>` : ''}
        ${c.owner ? `<button type="button" class="quiet ch-end" onclick="Race.endTeam('${c.id}')">${icon('trash', 'tiny')}End team</button>` : ''}
      </div>
      ${together && c.mode !== 'split' ? `<div class="ch-group"><div class="ch-group-top"><b>${c.group.finished} of ${c.group.players} finished</b><span>${c.group.stepsPct}% of all steps done${c.group.behind ? ` · ${c.group.behind} behind` : ''}</span></div>
        <div class="ch-bar" role="img" aria-label="${pct}% finished"><i style="width:${pct}%"></i></div></div>` : ''}
      ${c.mode === 'split' ? splitHtml(c) : ''}${reviewsHtml(c)}${yourStepsHtml(c)}
      ${c.players.length ? `<div class="ch-table-wrap"><table class="ch-table"><thead><tr><th>${together ? '' : '#'}</th><th>Name</th><th>Steps</th><th>Pace</th>${c.owner ? '<th>Last step</th>' : ''}</tr></thead>
        <tbody>${c.players.map((p, i) => `<tr class="${p.you ? 'you' : ''}"><td class="pos">${together ? '' : p.place ? placeHtml(p.place) : i + 1}</td>
          <td><span class="dot" style="background:${esc(p.color)}"></span>${p.you ? 'You' : `<button type="button" class="rc-cheer" data-color="${esc(p.color)}" data-name="${esc(p.name)}" onclick="Race.cheerIn('${c.id}', this)" title="Cheer ${esc(p.name)} on" aria-label="Cheer ${esc(p.name)} on">${esc(p.name)}</button>`}${p.lead && together ? ` ${leadBadge(c)}` : ''}${p.stuck ? ` <button type="button" class="stuck-chip" onclick="Race.openChat('${c.id}')" title="${p.you ? 'You asked' : `${esc(p.name)} asked`} for help on a blocker. Open the chat">${icon('hand', 'tiny')}stuck</button>` : ''}</td>
          <td><span class="ch-steps"><i style="width:${Math.round(p.frac * 100)}%"></i></span><span class="num">${p.done}/${p.total}</span>${p.pending ? `<span class="ch-pending" title="${p.pending} ticked, waiting to count">+${p.pending}</span>` : ''}</td>
          <td><span class="pace ${p.pace.replace(' ', '-')}">${p.finished ? 'finished' : p.pace}</span></td>
          ${c.owner ? `<td class="ago">${esc(ago(p.lastStepAt))}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
        : `<div class="ch-empty"><p><b>No one has joined yet.</b></p><p>Share the link or the code <button type="button" class="ch-code" onclick="Race.copyCode('${esc(c.joinCode)}')" title="Copy the code">${esc(c.joinCode)} ${icon('copy', 'tiny')}</button>. People join from <b>Teams › Join with a code</b>.</p></div>`}`;
  }
  function backToList() { detailId = null; renderPage(); }
  // Finished ones off your list (only yours: everyone else's scoreboard
  // keeps them), with an Undo.
  async function clearFromList(ids) {
    try { for (const id of ids) await API.clearRace(id); } catch (err) { showToast(err.message || 'Could not clear it', 'error'); }
    detailId = null; renderPage();
    showActionToast(ids.length === 1 ? 'Cleared from your list' : `${ids.length} cleared from your list`, [{ label: 'Undo', run: async () => {
      for (const id of ids) { try { await API.unclearRace(id); } catch { /* gone */ } }
      renderPage();
    } }]);
  }
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
  // The organiser ends the team for everyone, after saying what goes and what stays.
  async function endTeam(id) {
    let c = null;
    try { c = await API.getRace(id); } catch (err) { showToast(err.message || 'Could not open it', 'error'); return; }
    const keeps = c.mode === 'split'
      ? 'The team, its chat and everyone’s access to this goal end. The goal and all its tasks stay yours; steps given to others go back to unassigned.'
      : 'The team and its chat end. Everyone keeps their own copy of the goal.';
    const form = dialog(`${head(`End “${c.title}”?`, 'trash')}
      <p class="fb-note">${keeps}${c.players.length > 1 ? ' Your teammates are told.' : ''} This can’t be undone.</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Keep the team</button><button type="submit" class="fb-send ch-end-go">End team</button></div>`);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      try { await API.endRace(id); } catch (err) { showToast(err.message || 'Could not end it', 'error'); return; }
      close();
      forgetPlan();
      showToast(c.mode === 'split' ? 'Team ended. The goal and its tasks are still yours' : 'Team ended');
      backToList();
    });
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
    showCheers(race);
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
        showCheers(fresh);
        if (JSON.stringify(fresh.players.map(p => [p.name, p.done])) !== before) {
          renderMountainScene();
          moved.forEach(p => showToast(p.finished ? `${p.place ? `🏆 ${placeText(p.place)}` : '🏁'} ${p.name} finished` : `${p.name} is on step ${p.done} of ${p.total}`));
        }
      }, 20000);
    }
    return race;
  }
  // What the Journey draws: every other player, coloured, with pace.
  function rivals() {
    if (!current) return null;
    const leader = current.players[0];
    // A group has no winner, so no places and no leader.
    const racing = !isGrp(current);
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
    const head2 = r.mode === 'split' ? `${icon('list-checks', 'tiny')}<b>${r.group.stepsPct}% of the goal done</b>${r.split && r.split.unclaimed ? ` · ${r.split.unclaimed} unclaimed` : ''} · ${r.over ? 'ended' : daysLeft <= 0 ? 'ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`
      : isGrp(r) ? `${icon('users', 'tiny')}<b>${r.group.finished} of ${r.group.players} finished</b> · ${r.over ? 'ended' : daysLeft <= 0 ? 'ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`
      : r.winner ? `${icon('trophy', 'tiny')}<b>${r.winner.you ? 'You won!' : `${esc(r.winner.name)} won`}</b>${r.yourPlace && r.yourPlace > 1 ? ` · you finished ${placeHtml(r.yourPlace)}` : ''}`
      : r.over ? `${icon('flag', 'tiny')}<b>Time's up</b>` : `${icon('flag', 'tiny')}<b>Race</b> · ${daysLeft <= 0 ? 'ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`;
    strip.classList.remove('hidden');
    strip.innerHTML = `<div class="race-strip-top"><span class="race-strip-title">${head2}${r.stake ? ` <span class="race-strip-stake">· ${esc(r.stake)}</span>` : ''}</span>
        <span class="race-strip-actions">${r.yourSteps && (r.yourSteps.needsProof.length + r.yourSteps.sentBack.length) ? `<button type="button" class="prove" onclick="Race.proveNext()">${icon('camera', 'tiny')}Prove ${r.yourSteps.needsProof.length + r.yourSteps.sentBack.length}</button>` : ''}${!isGrp(r) && (r.winner || r.over) ? `<button type="button" onclick="Race.openReport('${r.id}')">${icon('trophy', 'tiny')}Scoreboard</button>` : ''}<button type="button" onclick="Race.openChat('${r.id}')">${icon('message-circle', 'tiny')}Chat${unreadBadge(r)}</button><button type="button" onclick="Race.invite()">${icon('user-plus', 'tiny')}Invite</button><button type="button" onclick="Race.leave()">Leave</button></span></div>
      <ol class="race-board">${r.players.map((p, i) => `<li class="${p.you ? 'you' : ''}"><span class="pos">${isGrp(r) ? '' : p.place ? placeHtml(p.place) : i + 1}</span><i style="background:${esc(p.color)}"></i>${p.you ? '<b>You</b>' : `<button type="button" class="rc-cheer" data-color="${esc(p.color)}" data-name="${esc(p.name)}" onclick="Race.cheerFrom(this)" title="Cheer ${esc(p.name)} on" aria-label="Cheer ${esc(p.name)} on">${esc(p.name)}</button>`}
        <span class="steps">${p.done}/${p.total}${p.pending ? `<small class="ch-pending" title="${p.pending} ticked, waiting to count">+${p.pending}</small>` : ''}</span><span class="pace ${p.pace.replace(' ', '-')}">${p.finished ? 'finished' : p.pace}</span></li>`).join('')}</ol>`;
  }
  // ── The race or group's chat ──
  // One thread for everyone in it: messages, the app's own lines (joined,
  // halfway, finished), cheers and the leader's reminders. Polled while open.
  let chatPoll = null;
  const unreadBadge = c => (c && c.chat && c.chat.unread ? `<span class="rc-unread" aria-label="${c.chat.unread} unread">${c.chat.unread > 9 ? '9+' : c.chat.unread}</span>` : '');
  const chatTime = iso => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  // The leader's role as a small badge, wherever their name shows.
  const leadBadge = c => `<span class="rc-lead" title="Runs this ${esc(kindOf(c).toLowerCase())}">${icon('crown', 'tiny')}${esc(roleOf(c).label)}</span>`;
  // A message about a task: tap to open it (your own step), or the team
  // page to see who has it.
  const taskChip = (cid, tk) => `<button type="button" class="rc-task${tk.done ? ' done' : ''}" onclick="Race.openFromChat('${cid}', ${tk.id ? `'${tk.id}'` : 'null'})" title="${tk.id ? 'Open this task' : 'See who has it on the team page'}">${icon(tk.done ? 'check' : 'list-checks', 'tiny')}<span>${esc(tk.title)}</span>${icon('chevron_right', 'tiny')}</button>`;
  function openFromChat(cid, taskId) {
    clearInterval(chatPoll);
    close();
    if (taskId) openTaskDetail(taskId);
    else openTeam(cid);
  }
  // about: { taskId, title, to } when opened from a task (Chat on a step
  // you're waiting on): the message carries the task, and @names its owner.
  async function openChat(id, about = null) {
    let r;
    try { r = await API.getRace(id); } catch (err) { showToast(err.message || 'Could not open the chat', 'error'); return; }
    const me = r.players.find(p => p.you);
    const form = dialog(`${head(r.title, 'message-circle')}
      <p class="fb-note rc-sub">${esc(kindOf(r))} · ${r.players.length} ${r.players.length === 1 ? 'person' : 'people'}${isGrp(r) && r.leaderName ? ` · ${leadBadge(r)} ${esc(r.leaderName)}` : ''}${!isGrp(r) ? ' · tap a name on the scoreboard to cheer them on' : ''}</p>
      <div class="rc-list" id="rc-list" role="log" aria-live="polite" aria-label="Messages"><p class="rc-empty">Loading…</p></div>
      ${about ? `<div class="rc-about" id="rc-about"><span>${icon('link', 'tiny')}About <b>${esc(about.title)}</b></span><button type="button" id="rc-about-x" aria-label="Don't link the task">${icon('close', 'tiny')}</button></div>` : ''}
      <div class="rc-file hidden" id="rc-file"><span>${icon('paperclip', 'tiny')}<b id="rc-file-name"></b></span><button type="button" id="rc-file-x" aria-label="Remove the file">${icon('close', 'tiny')}</button></div>
      <div class="rc-picks hidden" id="rc-picks" role="listbox" aria-label="Mention someone"></div>
      <div class="rc-emojis hidden" id="rc-emojis" role="group" aria-label="Emojis">${EMOJIS.map(e => `<button type="button" aria-label="${e}">${e}</button>`).join('')}</div>
      <div class="rc-send">${me && me.projectId ? `<input type="file" id="rc-upload" class="hidden" accept="image/*,video/*,.pdf,.xlsx,.xls,.docx,.doc,.txt,.csv"><button type="button" class="rc-tool" id="rc-attach" aria-label="Share a photo or file" title="Share a photo or file">${icon('paperclip', 'tiny')}</button>` : ''}<button type="button" class="rc-tool" id="rc-emoji" aria-label="Emoji" title="Emoji" aria-expanded="false">${icon('smile', 'tiny')}</button><input type="text" id="rc-text" maxlength="1000" placeholder="Say something… (@ to mention)" aria-label="Message" autocomplete="off"><button type="submit" class="fb-send" aria-label="Send">${icon('send', 'tiny')}</button></div>`);
    form.classList.add('race-chat');
    const list = form.querySelector('#rc-list');
    const input = form.querySelector('#rc-text');
    // @mentions: the names people see in this team (not yourself).
    const people = r.players.filter(p => !p.you).map(p => p.name).concat(r.owner || !r.leaderName || r.players.some(p => p.lead) ? [] : [r.leaderName]);
    let aboutId = about ? about.taskId : null;
    form.querySelector('#rc-about-x')?.addEventListener('click', () => { aboutId = null; form.querySelector('#rc-about').remove(); });
    if (about && about.to) input.value = `@${about.to} `;
    const picks = form.querySelector('#rc-picks');
    const showPicks = () => {
      const m = input.value.slice(0, input.selectionStart).match(/@([^@\s][^@]{0,30})?$/);
      const q = m ? (m[1] || '').toLowerCase() : null;
      const hits = q === null ? [] : people.filter(n => n.toLowerCase().startsWith(q)).slice(0, 6);
      picks.classList.toggle('hidden', !hits.length);
      picks.innerHTML = hits.map(n => `<button type="button" role="option" data-name="${esc(n)}">@${esc(n)}</button>`).join('');
    };
    input.addEventListener('input', showPicks);
    picks.addEventListener('mousedown', e => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault();
      const pos = input.selectionStart, before = input.value.slice(0, pos).replace(/@[^@]*$/, `@${b.dataset.name} `);
      input.value = before + input.value.slice(pos);
      input.setSelectionRange(before.length, before.length);
      picks.classList.add('hidden');
      input.focus();
    });
    // Emojis into the message, where the cursor is.
    const emojis = form.querySelector('#rc-emojis'), emojiBtn = form.querySelector('#rc-emoji');
    emojiBtn.addEventListener('click', () => { const open = emojis.classList.toggle('hidden'); emojiBtn.setAttribute('aria-expanded', String(!open)); });
    emojis.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + b.textContent + input.value.slice(pos);
      input.setSelectionRange(pos + b.textContent.length, pos + b.textContent.length);
      input.focus();
    });
    // A photo or file: uploaded to your own copy of the goal, then sent.
    let file = null;
    const fileBox = form.querySelector('#rc-file');
    const upload = form.querySelector('#rc-upload');
    if (upload) {
      form.querySelector('#rc-attach').addEventListener('click', () => upload.click());
      upload.addEventListener('change', () => {
        file = upload.files[0] || null;
        fileBox.classList.toggle('hidden', !file);
        if (file) form.querySelector('#rc-file-name').textContent = file.name;
      });
      form.querySelector('#rc-file-x').addEventListener('click', () => { file = null; upload.value = ''; fileBox.classList.add('hidden'); });
    }
    let lastKey = '';
    const draw = async () => {
      let msgs;
      try { msgs = await API.raceMessages(id); } catch { return; }
      const key = msgs.map(m => m.id).join();
      if (key === lastKey) return;
      lastKey = key;
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.innerHTML = msgs.length ? msgs.map(m => m.kind === 'help'
        ? `<div class="rc-help${m.open ? '' : ' done'}${m.you ? ' you' : ''}"><span class="rc-who" style="color:${esc(m.color)}">${icon('hand', 'tiny')} ${esc(m.author)} ${m.open ? 'asks for help' : 'asked for help'}</span><p>${esc(m.text)}</p>${m.task ? taskChip(id, m.task) : ''}
            <div class="rc-help-foot">${!m.open ? `<span class="rc-help-ok">${icon('check', 'tiny')}Sorted</span>` : m.you ? `<span>${m.offers ? `${m.offers} offered to help` : 'Waiting for a reply'}</span>` : m.youOffered ? `<span>${icon('check', 'tiny')}You offered</span>` : `<button type="button" onclick="Race.offerHelp('${id}', '${m.id}', this)">${icon('hand', 'tiny')}I can help</button>${m.offers ? `<span>${m.offers} offered</span>` : ''}`}<time>${esc(chatTime(m.createdAt))}</time></div></div>`
        : ['msg', 'nudge', 'proof', 'review', 'offer'].includes(m.kind)
        ? `<div class="rc-msg${m.you ? ' you' : ''}${m.kind === 'msg' ? '' : ` ${m.kind}`}${m.toYou ? ' to-you' : ''}"><span class="rc-who" style="color:${esc(m.color)}">${m.kind === 'nudge' ? `${icon('bell', 'tiny')} ` : m.kind === 'proof' ? `${icon('camera', 'tiny')} ` : m.kind === 'review' ? `${icon('undo', 'tiny')} ` : ''}${esc(m.author)}${m.leader && isGrp(r) ? ` ${leadBadge(r)}` : ''}</span>${m.text ? `<p>${withMentions(m.text, people)}</p>` : ''}${proofThumb(id, m.file)}${m.task ? taskChip(id, m.task) : ''}<time>${esc(chatTime(m.createdAt))}</time></div>`
        : `<div class="rc-event${m.kind === 'cheer' ? ' cheer' : ''}"><span>${esc(m.text)}</span>${m.task && m.task.id ? taskChip(id, m.task) : ''}<time>${esc(chatTime(m.createdAt))}</time></div>`).join('')
        : '<p class="rc-empty">No messages yet. Say hello, or wish everyone luck.</p>';
      if (atBottom || !lastKey.includes(',')) list.scrollTop = list.scrollHeight;
    };
    await draw();
    list.scrollTop = list.scrollHeight;
    clearInterval(chatPoll);
    chatPoll = setInterval(() => { if (!form.isConnected) { clearInterval(chatPoll); return; } draw(); }, 4000);
    input.focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text && !file) return;
      const send = form.querySelector('.fb-send');
      send.disabled = true;
      let attachmentId = null;
      try {
        if (file) attachmentId = (await API.uploadAttachment(me.projectId, file)).id;
        await API.sayInRace(id, text, attachmentId, aboutId);
      } catch (err) { send.disabled = false; showToast(err.message || 'Could not send it', 'error'); return; }
      send.disabled = false;
      input.value = '';
      aboutId = null; form.querySelector('#rc-about')?.remove();
      file = null; if (upload) upload.value = ''; fileBox.classList.add('hidden');
      emojis.classList.add('hidden'); picks.classList.add('hidden');
      await draw();
      list.scrollTop = list.scrollHeight;
    });
  }
  // The emoji picker's set, and @names in a message picked out.
  const EMOJIS = ['😀', '😂', '😊', '😍', '🙌', '👍', '👏', '🙏', '💪', '🔥', '🎉', '🚀', '⭐', '✅', '❤️', '😅', '🤔', '😮', '😢', '😴', '☕', '🏁', '🏆', '👀'];
  function withMentions(text, names) {
    let html = esc(text);
    [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length).forEach(n => {
      html = html.split(`@${esc(n)}`).join(`<b class="rc-at">@${esc(n)}</b>`);
    });
    return html;
  }
  // A cheer for one player: pick an emoji, it goes in the chat and pops
  // over them on their own Journey.
  const CHEERS = ['👏', '🔥', '💪', '🚀', '🎉'];
  function cheerMenu(btn, id, color, name) {
    document.querySelectorAll('.rc-cheer-pop').forEach(x => x.remove());
    const pop = document.createElement('div');
    pop.className = 'rc-cheer-pop';
    pop.setAttribute('role', 'menu');
    pop.innerHTML = `<small>Cheer ${esc(name)} on</small><div>${CHEERS.map(e => `<button type="button" role="menuitem" aria-label="Send ${e}">${e}</button>`).join('')}</div>`;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left))}px`;
    pop.style.top = `${r.bottom + 6 + window.scrollY}px`;
    pop.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', async ev => {
      ev.stopPropagation();
      pop.remove();
      try { await API.cheerInRace(id, color, CHEERS[i]); showToast(`${CHEERS[i]} Sent to ${name}`); } catch (err) { showToast(err.message || 'Could not send it', 'error'); }
    }));
    setTimeout(() => document.addEventListener('click', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', off); } }), 0);
  }
  function cheerFrom(btn) { if (current) cheerMenu(btn, current.id, btn.dataset.color, btn.dataset.name); }
  function cheerIn(id, btn) { cheerMenu(btn, id, btn.dataset.color, btn.dataset.name); }
  // Cheers that came in for you: a toast, and the emoji floating up over
  // the Journey. Shown once.
  function showCheers(r) {
    const list = (r && r.chat && r.chat.cheers) || [];
    if (!list.length) return;
    API.raceCheersSeen(r.id).catch(() => {});
    r.chat.cheers = [];
    const names = [...new Set(list.map(c => c.from))];
    // a beat later, so a finish or achievement toast doesn't cover it
    setTimeout(() => showToast(`${list.map(c => c.emoji).join('')} ${names.join(', ')} cheered you on`), 3500);
    const scene = document.getElementById('mountain-scene');
    if (!scene || !scene.offsetParent || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    list.slice(0, 8).forEach((c, i) => {
      const e = document.createElement('span');
      e.className = 'rc-float';
      e.textContent = c.emoji;
      e.style.left = `${35 + Math.random() * 30}%`;
      e.style.animationDelay = `${i * 0.25}s`;
      scene.parentElement.appendChild(e);
      setTimeout(() => e.remove(), 3200 + i * 250);
    });
  }

  // Your finishing place, said once per race (with confetti on the podium),
  // then the report a tap away.
  function announcePlace() {
    const r = current;
    if (!r || isGrp(r) || !r.yourPlace) return;
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
    if (isGrp(r)) {
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
    if (isGrp(r)) {
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

  // ── Split the work: one goal, each step someone's ──
  // The team's progress as one bar, each person's finished steps in their
  // colour; then every step with who has it. The leader hands steps out
  // (or shares out the unclaimed ones); anyone can take an unclaimed one.
  function splitHtml(c) {
    const sp = c.split;
    if (!sp) return '';
    const seg = sp.total ? sp.contrib.filter(m => m.done).map(m => `<i style="width:${(m.done / sp.total) * 100}%;background:${esc(m.color)}" title="${esc(m.name)}: ${m.done} done"></i>`).join('') : '';
    const others = sp.done - sp.contrib.reduce((a, m) => a + m.done, 0);
    const opts = cur => `<option value="">Unclaimed</option>${c.players.map(p => `<option value="${esc(p.color)}"${cur && cur.color === p.color ? ' selected' : ''}>${esc(p.you ? 'You' : p.name)}</option>`).join('')}`;
    const ms = c.checks === 'milestones';
    const step = st => {
      const done = st.status === 'Completed';
      // a milestone waits for sign-off; whoever runs the step can mark it
      const flag = !ms ? '' : st.manage
        ? `<button type="button" class="sp-ms${st.milestone ? ' on' : ''}" aria-pressed="${!!st.milestone}" data-task="${esc(st.taskId)}" onclick="Race.milestone('${c.id}', this)" title="${st.milestone ? 'A milestone: it waits for sign-off. Tap to make it an ordinary step' : 'Mark as a milestone that needs sign-off'}" aria-label="Milestone: ${esc(st.title)}">${icon('flag', 'tiny')}</button>`
        : st.milestone ? `<span class="sp-ms on" title="A milestone: it waits for sign-off">${icon('flag', 'tiny')}</span>` : '';
      const right = st.manage
        ? `<select class="sp-assign" aria-label="Who does ${esc(st.title)}" data-task="${esc(st.taskId)}" onchange="Race.assign('${c.id}', this)" ${done ? 'disabled' : ''}>${opts(st.who)}</select>`
        : st.who ? `<span class="sp-who"><i style="background:${esc(st.who.color)}"></i>${esc(st.who.name)}</span>`
          : st.outside ? '<span class="sp-who">Someone else</span>'
            : done ? '' : `<button type="button" class="sp-claim" data-task="${esc(st.taskId)}" onclick="Race.claim('${c.id}', this)">${icon('hand', 'tiny')}I'll take it</button>`;
      return `<li class="${done ? 'done' : ''}${!st.who && !done ? ' open' : ''}"><span class="sp-dot">${done ? icon('check', 'tiny') : ''}</span>
        <span class="sp-title">${esc(st.title)}${st.endDate ? `<small>due ${esc(new Date(st.endDate.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</small>` : ''}</span>${flag}${right}${st.manage ? `<button type="button" class="sp-del" data-task="${esc(st.taskId)}" data-title="${esc(st.title)}" onclick="Race.removeStep('${c.id}', this)" title="Delete this step (it goes to Trash)" aria-label="Delete ${esc(st.title)}">${icon('trash', 'tiny')}</button>` : ''}</li>`;
    };
    // With phases (the goal's sub-folders), the steps sit under each one,
    // with its lead; the leader picks the lead.
    const phases = sp.phases || [];
    const phaseHead = ph => {
      const lead = c.owner
        ? `<select class="sp-assign sp-lead" aria-label="Who leads ${esc(ph.title)}" data-phase="${esc(ph.projectId)}" onchange="Race.setLead('${c.id}', this)"><option value="">No lead</option>${c.players.map(p => `<option value="${esc(p.color)}"${ph.lead && ph.lead.color === p.color ? ' selected' : ''}>${esc(p.you ? 'You' : p.name)}</option>`).join('')}</select>`
        : ph.lead ? `<span class="sp-who">${icon('crown', 'tiny')}${esc(ph.lead.name)} leads</span>` : '';
      return `<li class="sp-phase"><span class="sp-title">${esc(ph.title)}${ph.yours ? '<small>You lead this phase: hand its steps out and sign them off</small>' : ''}</span>${c.owner ? `<span class="sp-lead-l">${icon('crown', 'tiny')}Lead</span>` : ''}${lead}</li>`;
    };
    const listHtml = () => {
      if (!phases.length) return sp.steps.map(step).join('');
      const loose = sp.steps.filter(st => !st.phaseId || !phases.some(ph => ph.projectId === st.phaseId));
      return phases.map(ph => phaseHead(ph) + sp.steps.filter(st => st.phaseId === ph.projectId).map(step).join('')).join('') + (loose.length ? `<li class="sp-phase"><span class="sp-title">Other steps</span></li>${loose.map(step).join('')}` : '');
    };
    const canShare = sp.steps.filter(st => st.manage && !st.who && st.status !== 'Completed').length;
    const checksPick = c.owner ? `<label class="sp-checks">${icon('badge-check', 'tiny')}<select aria-label="How steps are signed off" onchange="Race.setChecks('${c.id}', this)">${SPLIT_CHECKS.map(([v, l]) => `<option value="${v}"${(c.checks || 'none') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : '';
    return `<div class="ch-group sp-group"><div class="ch-group-top"><b>${sp.done} of ${sp.total} steps done</b><span>${c.group.stepsPct}% of the goal${sp.unclaimed ? ` · ${sp.unclaimed} unclaimed` : ''}</span></div>
        <div class="sp-bar" role="img" aria-label="${c.group.stepsPct}% of the goal done">${seg}${others > 0 ? `<i style="width:${(others / sp.total) * 100}%;background:#94A3B8"></i>` : ''}</div>
        <div class="sp-legend">${sp.contrib.filter(m => m.total).map(m => `<span><i style="background:${esc(m.color)}"></i>${esc(m.name)} <b>${m.done}/${m.total}</b></span>`).join('')}</div></div>
      <section class="sp-steps"><div class="sp-head">
        <div class="sp-tabs" role="tablist" aria-label="Show the steps as">
          <button type="button" role="tab" aria-selected="${spTab !== 'timeline'}" onclick="Race.spTab('${c.id}', 'list')">${icon('list-checks', 'tiny')}Who's doing what</button>
          <button type="button" role="tab" aria-selected="${spTab === 'timeline'}" onclick="Race.spTab('${c.id}', 'timeline')">${icon('chart', 'tiny')}Timeline</button>
        </div>
        ${checksPick}${canShare ? `<button type="button" class="sp-even" onclick="Race.splitEvenly('${c.id}', this)">${icon('users', 'tiny')}Share out ${canShare} unclaimed</button>` : ''}</div>
        ${spTab === 'timeline' ? timelineHtml(c) : sp.steps.length ? `<ul>${listHtml()}</ul>` : '<p class="fb-note">This goal has no steps yet. Add some on the goal, then hand them out.</p>'}
        ${ms && spTab !== 'timeline' && sp.steps.some(st => st.manage) && !sp.steps.some(st => st.milestone) ? `<p class="fb-note">${icon('flag', 'tiny')}Tap the flag on a step to make it a milestone. Only milestones wait for sign-off.</p>` : ''}</section>`;
  }
  // The team timeline: one row per person, their steps as bars on the
  // dates, today marked, and an arrow wherever one step hands over to the
  // next (a step that waits on another). Bars that overlap stack.
  let spTab = 'list';
  const DAY_MS = 86400000;
  const dayOf = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00');
  function timelineHtml(c) {
    const sp = c.split;
    const dated = sp.steps.filter(st => st.startDate || st.endDate).map(st => {
      const end = dayOf(st.endDate || st.startDate), start = Math.min(end, dayOf(st.startDate || st.endDate));
      return { ...st, s: start, e: end + DAY_MS };
    });
    if (!dated.length) return '<p class="fb-note">Give the steps dates on the goal (start and due) and they appear here, one row per person.</p>';
    const from = Math.min(...dated.map(d => d.s)), to = Math.max(...dated.map(d => d.e));
    const span = Math.max(DAY_MS, to - from);
    const pct = t => ((t - from) / span) * 100;
    const rows = sp.contrib.filter(m => dated.some(d => d.who && d.who.color === m.color)).map(m => ({ key: m.color, name: m.name, color: m.color }));
    if (dated.some(d => !d.who)) rows.push({ key: '', name: 'Unclaimed', color: '#CBD5E1' });
    const rowHtml = r => {
      const mine = dated.filter(d => (d.who ? d.who.color : '') === r.key).sort((a, b) => a.s - b.s);
      const lanes = [];
      mine.forEach(d => { let l = lanes.findIndex(end => end <= d.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = d.e; d.lane = l; });
      const h = Math.max(1, lanes.length) * 30 + 10;
      return `<div class="tl-row" style="height:${h}px"><div class="tl-name"><i style="background:${esc(r.color)}"></i>${esc(r.name)}</div>
        <div class="tl-track">${mine.map(d => `<div class="tl-bar${d.status === 'Completed' ? ' done' : ''}${r.key ? '' : ' open'}" data-task="${esc(d.taskId)}" title="${esc(d.title)}: ${esc(new Date(d.s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))} to ${esc(new Date(d.e - DAY_MS).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}${d.who ? ` · ${esc(d.who.name)}` : ' · unclaimed'}"
          style="left:${pct(d.s).toFixed(2)}%;width:${Math.max(2, pct(d.e) - pct(d.s)).toFixed(2)}%;top:${5 + d.lane * 30}px;--c:${esc(r.color)}">${d.status === 'Completed' ? icon('check', 'tiny') : ''}<span>${esc(d.title)}</span></div>`).join('')}</div></div>`;
    };
    const days = Math.round(span / DAY_MS);
    const every = Math.max(1, Math.ceil(days / 8));
    const ticks = [];
    for (let i = 0; i <= days; i += every) ticks.push(from + i * DAY_MS);
    const now = Date.now();
    const today = now >= from && now <= to ? `<div class="tl-today" style="left:${pct(now).toFixed(2)}%" title="Today"></div>` : '';
    lastTimeline = { id: c.id, links: sp.links || [] };
    setTimeout(() => drawHandoffs(c.id, sp.links || []), 0);
    return `<div class="tl-wrap" id="tl-${esc(c.id)}"><div class="tl-inner">
      <div class="tl-head"><div class="tl-name"></div><div class="tl-track">${ticks.map(t => `<span style="left:${pct(t).toFixed(2)}%">${esc(new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>`).join('')}</div></div>
      <div class="tl-body">${rows.map(rowHtml).join('')}<div class="tl-todaywrap"><div></div><div class="tl-track">${today}</div></div><svg class="tl-links" aria-hidden="true"></svg></div>
    </div></div>
    ${sp.links && sp.links.length ? `<p class="tl-key">${icon('link', 'tiny')}An arrow is a handover: the next step can start once the one before it is done.</p>` : ''}`;
  }
  // The handover arrows, drawn once the bars are on screen: from the end
  // of a step to the start of the one waiting on it.
  function drawHandoffs(id, links) {
    const wrap = document.getElementById(`tl-${id}`);
    if (!wrap) return;
    const body = wrap.querySelector('.tl-body'), svg = wrap.querySelector('.tl-links');
    const box = body.getBoundingClientRect();
    svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
    svg.innerHTML = `<defs><marker id="tl-arrow-${esc(id)}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#475569"/></marker></defs>` + links.map(l => {
      const a = wrap.querySelector(`.tl-bar[data-task="${CSS.escape(l.from)}"]`), b = wrap.querySelector(`.tl-bar[data-task="${CSS.escape(l.to)}"]`);
      if (!a || !b) return '';
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = ra.right - box.left, y1 = ra.top + ra.height / 2 - box.top, x2 = rb.left - box.left - 2, y2 = rb.top + rb.height / 2 - box.top;
      const mx = Math.max(x1 + 10, (x1 + x2) / 2);
      return `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${mx.toFixed(1)} ${y1.toFixed(1)}, ${(mx - 0).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="#475569" stroke-width="1.6" stroke-dasharray="4 3" marker-end="url(#tl-arrow-${esc(id)})"/>`;
    }).join('');
  }
  function spTabSet(id, tab) { spTab = tab; refreshSplit(id); }
  // The whole plan on a teammate's goal page (its Whole plan switch): the
  // same board as the team page, so they can see who's doing what and take
  // an unclaimed step without leaving the goal.
  let planTarget = null; // { id, el }
  async function planInto(id, el) {
    planTarget = { id, el };
    if (!el.innerHTML.trim()) el.innerHTML = '<p class="fb-note">Loading the plan…</p>';
    let c;
    try { c = await API.getRace(id); } catch (err) { el.innerHTML = `<p class="fb-note">${esc(err.message || 'Could not load the plan')}</p>`; return; }
    if (!planTarget || planTarget.el !== el || !el.isConnected) return;
    el.innerHTML = `<div class="sp-inline">${splitHtml(c)}<p class="fb-note">${icon('users', 'tiny')}<button type="button" class="ch-link" onclick="showPage('challenges'); setTimeout(() => Race.openDetail('${c.id}'), 200)">Open the team page</button> for the chat and everyone's progress.</p></div>`;
  }
  // After taking or handing out a step: the goal page (when the plan is
  // showing there, so the step moves into My steps) or the team page.
  function refreshSplit(id) {
    const onGoal = planTarget && planTarget.id === id && planTarget.el.isConnected && !planTarget.el.classList.contains('hidden');
    if (onGoal && typeof renderProjectDetail === 'function' && APP.currentProjectId) { renderProjectDetail(APP.currentProjectId); return; }
    openDetail(id);
  }
  let lastTimeline = null;
  window.addEventListener('resize', () => { if (lastTimeline && document.getElementById(`tl-${lastTimeline.id}`)) drawHandoffs(lastTimeline.id, lastTimeline.links); });
  async function assign(id, sel) {
    sel.disabled = true;
    try { await API.assignRaceStep(id, sel.dataset.task, sel.value); showToast(sel.value ? 'Handed over. They’ve been told' : 'Back to unclaimed'); } catch (err) { showToast(err.message || 'Could not do that', 'error'); }
    forgetPlan(); refreshSplit(id);
  }
  async function claim(id, btn) {
    btn.disabled = true;
    try { await API.claimRaceStep(id, btn.dataset.task); showToast('🙌 It’s yours. It’s in My steps and your planner'); } catch (err) { btn.disabled = false; showToast(err.message || 'Could not take it', 'error'); return; }
    forgetPlan(); refreshSplit(id);
  }
  async function splitEvenly(id, btn) {
    btn.disabled = true;
    try { const r = await API.splitRaceEvenly(id); showToast(`Shared out ${r.assigned} step${r.assigned === 1 ? '' : 's'}. Everyone’s been told`); } catch (err) { btn.disabled = false; showToast(err.message || 'Could not share them out', 'error'); return; }
    forgetPlan(); refreshSplit(id);
  }

  // The leader (or a phase lead) deletes a step: to Trash, with Undo.
  async function removeStep(id, btn) {
    btn.disabled = true;
    const taskId = btn.dataset.task;
    try { await API.deleteTask(taskId); } catch (err) { btn.disabled = false; showToast(err.message || 'Could not delete that step', 'error'); return; }
    forgetPlan(); refreshSplit(id);
    showUndoToast(`“${btn.dataset.title}” moved to Trash`, async () => { await API.restoreTask(taskId); forgetPlan(); refreshSplit(id); });
  }
  async function setLead(id, sel) {
    sel.disabled = true;
    try { await API.setRaceLead(id, sel.dataset.phase, sel.value); showToast(sel.value ? 'They lead that phase now. They’ve been told' : 'No lead for that phase'); } catch (err) { showToast(err.message || 'Could not do that', 'error'); }
    forgetPlan(); refreshSplit(id);
  }
  async function milestone(id, btn) {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.disabled = true;
    try { await API.setRaceMilestone(id, btn.dataset.task, on); showToast(on ? 'A milestone: it waits for sign-off once ticked' : 'An ordinary step again'); } catch (err) { btn.disabled = false; showToast(err.message || 'Could not do that', 'error'); return; }
    refreshSplit(id);
  }
  async function setChecks(id, sel) {
    sel.disabled = true;
    try { await API.setRaceChecks(id, sel.value); showToast(sel.value === 'milestones' ? 'Only milestones wait for sign-off now. Tap a step’s flag to mark one' : 'Changed how steps are signed off'); } catch (err) { showToast(err.message || 'Could not do that', 'error'); }
    refreshSplit(id);
  }

  // ── Asking for help on a blocker ──
  // In the task panel, each blocker gets "Ask for help" when there's
  // somewhere to ask: a race or group this goal is your copy in, or the
  // goal's own chat when it's shared with people.
  async function fillHelpSlots(taskId, wrap) {
    const slots = [...wrap.querySelectorAll('[data-help-slot]')];
    if (!slots.length) return;
    let where = { places: [], asked: [] }, shared = null;
    try {
      const [w, projects, tasks] = await Promise.all([API.helpPlaces(taskId), API.getProjects(), API.getTasks()]);
      where = w;
      const t = tasks.find(x => x.id === taskId);
      const p = t && projects.find(x => x.id === t.projectId);
      const top = p && (p.parentId ? projects.find(x => x.id === p.parentId) : p);
      if (top && (top.role !== 'owner' || top.collaboratorCount > 0)) shared = { id: top.id, title: top.title };
      helpCtx = { taskId, taskTitle: t ? t.title : '', places: w.places, shared };
    } catch { return; }
    if (!where.places.length && !shared) return;
    slots.forEach(el => {
      if (!el.isConnected) return;
      const asked = where.asked.includes(el.dataset.helpSlot);
      el.innerHTML = asked
        ? `<span class="help-asked" title="You asked for help with this. Clearing it lets everyone know">${icon('hand', 'tiny')}Asked</span>`
        : `<button type="button" class="help-btn" data-obstacle="${esc(el.dataset.helpSlot)}" data-name="${esc(el.dataset.name)}" onclick="Race.askHelp(this)" title="Ask your team for help with this blocker" aria-label="Ask for help with ${esc(el.dataset.name)}">${icon('hand', 'tiny')}Ask for help</button>`;
    });
  }
  let helpCtx = null;
  function askHelp(btn) {
    const ctx = helpCtx;
    if (!ctx) return;
    const name = btn.dataset.name, obstacleId = btn.dataset.obstacle;
    const options = [
      ...ctx.places.map(pl => ({ value: `race:${pl.id}`, label: `${isGrp(pl) ? (ROLES[pl.leaderRole] || ROLES.leader).kind : 'Race'}: ${pl.title}`, note: isGrp(pl) ? `Everyone in it sees it, and the ${(ROLES[pl.leaderRole] || ROLES.leader).label.toLowerCase()} gets a nudge.` : 'Everyone racing sees it in the chat.' })),
      ...(ctx.shared ? [{ value: `project:${ctx.shared.id}`, label: `Project chat: ${ctx.shared.title}`, note: 'Everyone you share this goal with sees it.' }] : []),
    ];
    const form = dialog(`${head('Ask for help', 'hand')}
      <p class="fb-note">Stuck on <b>${esc(name)}</b>${ctx.taskTitle ? ` in <b>${esc(ctx.taskTitle)}</b>` : ''}? Ask the people going for it with you.</p>
      ${options.length > 1 ? `<label for="help-where">Ask in</label><select id="help-where">${options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>` : `<input type="hidden" id="help-where" value="${esc(options[0].value)}"><p class="fb-note"><b>${esc(options[0].label)}</b></p>`}
      <p class="fb-note" id="help-where-note">${esc(options[0].note)}</p>
      ${window.AIFill ? `<div class="ai-fill-row">${AIFill.button({ form: 'Asking teammates for help with a blocker', taskId: () => ctx.taskId, context: () => `The blocker: ${name}`, fields: [{ key: 'note', label: "What's in the way, and what help would be good", type: 'longtext', el: '#help-note', hint: 'Two short sentences in the first person, a clear ask' }] }, 'Write it for me')}</div>` : ''}
      <label for="help-note">What's in the way? <span class="opt">(optional)</span></label>
      <textarea id="help-note" maxlength="300" rows="3" placeholder="e.g. The supplier hasn't answered in a week. Anyone know another?"></textarea>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Cancel</button><button type="submit" class="fb-send">${icon('send', 'tiny')}Ask</button></div>`);
    const sel = form.querySelector('#help-where');
    if (sel.tagName === 'SELECT') sel.onchange = () => { form.querySelector('#help-where-note').textContent = (options.find(o => o.value === sel.value) || {}).note || ''; };
    form.querySelector('#help-note').focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const [kind, id] = sel.value.split(':');
      const note = form.querySelector('#help-note').value.trim();
      const b = form.querySelector('.fb-send');
      b.disabled = true;
      try {
        if (kind === 'race') await API.askRaceHelp(id, obstacleId, note);
        else await API.addProjectMessage(id, `🆘 Stuck on “${name}”${ctx.taskTitle ? ` in “${ctx.taskTitle}”` : ''}${note ? `: ${note}` : ''}`);
      } catch (err) { b.disabled = false; showToast(err.message || 'Could not ask', 'error'); return; }
      close();
      showActionToast('🙋 Asked. Replies come in the chat', [{ label: 'Open chat', run: () => (kind === 'race' ? openChat(id) : (typeof openProjectChat === 'function' ? openProjectChat(id) : showPage('chats'))) }], 'hand');
      const slot = document.querySelector(`[data-help-slot="${CSS.escape(obstacleId)}"]`);
      if (slot && kind === 'race') slot.innerHTML = `<span class="help-asked">${icon('hand', 'tiny')}Asked</span>`;
    });
  }
  async function offerHelp(id, messageId, btn) {
    btn.disabled = true;
    try { await API.offerRaceHelp(id, messageId); } catch (err) { btn.disabled = false; showToast(err.message || 'Could not send it', 'error'); return; }
    showToast('🙌 They know you can help. Say how in the chat');
    const input = document.getElementById('rc-text');
    if (input) input.focus();
  }

  // ── In the planner (Kanban and Gantt) ──
  // Which goals are someone's copy in a team-up, the state of their steps
  // that don't count yet, and the groups they lead. Fetched once and kept
  // for a short while, so redrawing the planner doesn't refetch each time.
  let plan = null, planAt = 0;
  async function planInfo() {
    if (plan && Date.now() - planAt < 15000) return plan;
    let list = [];
    try { list = await API.listRaces(); } catch { return plan || { byProject: new Map(), steps: new Map(), leading: [] }; }
    const byProject = new Map(), steps = new Map();
    list.forEach(c => {
      const me = c.players.find(p => p.you);
      if (me && me.projectId) byProject.set(me.projectId, { id: c.id, kind: kindOf(c), title: c.title, endsAt: c.endsAt, lead: roleOf(c).label.toLowerCase() });
      const y = c.yourSteps;
      if (y) {
        y.needsProof.forEach(st => steps.set(st.taskId, { state: 'proof', raceId: c.id, title: st.title }));
        y.sentBack.forEach(st => steps.set(st.taskId, { state: 'back', raceId: c.id, title: st.title, note: st.note }));
        y.waiting.forEach(st => steps.set(st.taskId, { state: 'wait', raceId: c.id, title: st.title, lead: roleOf(c).label.toLowerCase() }));
      }
    });
    // groups you lead: your people, each with their progress
    const leading = list.filter(c => c.owner && isGrp(c)).map(c => ({ ...c, kind: kindOf(c), lead: roleOf(c).label.toLowerCase() }));
    plan = { byProject, steps, leading };
    planAt = Date.now();
    return plan;
  }
  const forgetPlan = () => { plan = null; };
  function openTeam(id) {
    if (typeof showPage === 'function') showPage('challenges');
    setTimeout(() => openDetail(id), 200);
  }
  // A small "Squad" / "Race" chip for a card or row in a team-up's copy.
  // Compact (icon only, for the Gantt's narrow name column) or labelled.
  function teamChip(team, compact = false) {
    if (!team) return '';
    const what = `Part of ${esc(team.kind.toLowerCase())}: ${esc(team.title)}. Open it`;
    return `<button type="button" class="team-chip${compact ? ' compact' : ''}" onclick="event.stopPropagation(); Race.openTeam('${team.id}')" title="${what}" aria-label="${what}">${icon(team.kind === 'Race' ? 'flag' : 'users', 'tiny')}${compact ? '' : esc(team.kind)}</button>`;
  }
  // A step that doesn't count yet: needs proof, waiting, sent back.
  function stepChip(taskId, compact = false) {
    const st = plan && plan.steps.get(taskId);
    if (!st) return '';
    const c = compact ? ' compact' : '';
    if (st.state === 'wait') {
      const what = `Waiting for the ${esc(st.lead)} to sign it off`;
      return `<span class="step-chip wait${c}" role="img" title="${what}" aria-label="${what}">${icon('clock', 'tiny')}${compact ? '' : what.replace(' to sign it off', '')}</span>`;
    }
    const back = st.state === 'back';
    const what = back ? `Sent back${st.note ? `: ${esc(st.note)}` : ''}. Add proof again` : 'Needs proof: add a photo or a note so it counts';
    return `<button type="button" class="step-chip ${back ? 'back' : 'proof'}${c}" data-task="${esc(taskId)}" data-title="${esc(st.title)}" onclick="event.stopPropagation(); Race.proveFrom('${st.raceId}', this)" title="${what}" aria-label="${what}">${icon('camera', 'tiny')}${compact ? '' : back ? 'Sent back' : 'Needs proof'}</button>`;
  }

  // ── Proof and sign-off ──
  // Just ticked a step that wants proof (api.js updateTask calls this).
  function askProof(pw) {
    if (!pw) return;
    forgetPlan();
    const lead = roleOf(pw).label.toLowerCase();
    const msg = pw.checks === 'leader' ? `“${pw.taskTitle}” is waiting for the ${lead} to sign it off` : pw.checks === 'milestones' ? `“${pw.taskTitle}” is a milestone: it counts once it's signed off` : `“${pw.taskTitle}” counts once you add proof`;
    showActionToast(msg, [{ label: pw.checks !== 'proof' ? 'Add a photo' : 'Add proof', run: () => openProof(pw.id, pw.taskId, pw.taskTitle) }], 'camera');
  }
  // A photo (from the camera on a phone) and/or a few words for one step.
  async function openProof(id, taskId, title) {
    let r;
    try { r = await API.getRace(id); } catch (err) { showToast(err.message || 'Could not open it', 'error'); return; }
    const me = r.players.find(p => p.you);
    if (!me) return;
    const back = r.yourSteps && r.yourSteps.sentBack.find(s => s.taskId === taskId);
    const form = dialog(`${head('Show it’s done', 'camera')}
      <p class="fb-note"><b>${esc(title)}</b> · ${esc(r.title)}</p>
      ${back ? `<p class="proof-back">${icon('undo', 'tiny')}<span>Sent back${back.note ? `: ${esc(back.note)}` : ''}</span></p>` : ''}
      <label for="proof-photo">A photo <span class="opt">(or a file)</span></label>
      <input type="file" id="proof-photo" accept="image/*,application/pdf,video/*">
      <label for="proof-text">A few words <span class="opt">(what you did)</span></label>
      <textarea id="proof-text" maxlength="500" rows="3" placeholder="e.g. Ran 5 km in 31 minutes"></textarea>
      <p class="fb-note">Everyone in the ${esc(kindOf(r).toLowerCase())} sees your proof in the chat.</p>
      <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Not now</button><button type="submit" class="fb-send">${icon('send', 'tiny')}Send proof</button></div>`);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const file = form.querySelector('#proof-photo').files[0];
      const text = form.querySelector('#proof-text').value.trim();
      if (!file && !text) { showToast('Add a photo or a few words first', 'error'); return; }
      const btn = form.querySelector('.fb-send');
      btn.disabled = true;
      try {
        const up = file ? await API.uploadAttachment(me.projectId, file) : null;
        await API.proveRaceStep(id, { taskId, text, attachmentId: up ? up.id : null });
      } catch (err) { btn.disabled = false; showToast(err.message || 'Could not send it', 'error'); return; }
      close();
      showToast(r.checks === 'leader' ? `📸 Sent. It counts once the ${roleOf(r).label.toLowerCase()} signs it off` : '✅ Proof sent. That step counts now');
      refresh(id);
    });
  }
  // Redraw whatever is showing this race after a proof or a decision.
  async function refresh(id) {
    forgetPlan();
    if (typeof APP !== 'undefined' && APP.currentPage === 'gantt' && typeof renderGantt === 'function') renderGantt();
    if (detailId === id) openDetail(id);
    if (current && current.id === id) {
      try { current = await API.getRace(id); } catch { return; }
      paintStrip(document.getElementById('journey-race'));
      renderMountainScene();
    }
  }
  const proofThumb = (id, f) => (!f ? '' : f.mimetype.startsWith('image/')
    ? `<a href="/api/challenges/${id}/proof-file/${f.id}" target="_blank" rel="noopener" class="proof-img"><img src="/api/challenges/${id}/proof-file/${f.id}" alt="Proof photo" loading="lazy"></a>`
    : `<a href="/api/challenges/${id}/proof-file/${f.id}" target="_blank" rel="noopener" class="proof-file">${icon('paperclip', 'tiny')}${esc(f.name)}</a>`);
  // Your own steps that don't count yet.
  function yourStepsHtml(c) {
    const y = c.yourSteps;
    if (!y || !(y.needsProof.length + y.sentBack.length + y.waiting.length)) return '';
    const btn = s => `<button type="button" data-task="${esc(s.taskId)}" data-title="${esc(s.title)}" onclick="Race.proveFrom('${c.id}', this)">${icon('camera', 'tiny')}${signsOff(c) && !s.note ? 'Add a photo' : 'Add proof'}</button>`;
    const row = (s, tag) => `<li><span class="ps-title">${esc(s.title)}</span>${tag}${btn(s)}</li>`;
    return `<section class="proof-steps"><h4>${icon('camera', 'tiny')}Your steps waiting to count</h4><ul>
      ${y.sentBack.map(s => row(s, `<span class="ps-tag back">Sent back${s.note ? `: ${esc(s.note)}` : ''}</span>`)).join('')}
      ${y.needsProof.map(s => row(s, '<span class="ps-tag">Needs proof</span>')).join('')}
      ${y.waiting.map(s => row(s, `<span class="ps-tag wait">${c.checks === 'milestones' ? 'Milestone waiting for sign-off' : `Waiting for the ${esc(roleOf(c).label.toLowerCase())}`}</span>`)).join('')}
    </ul></section>`;
  }
  // From the Journey strip: the first step waiting for proof.
  function proveNext() {
    const y = current && current.yourSteps;
    const s = y && (y.sentBack[0] || y.needsProof[0]);
    if (s) openProof(current.id, s.taskId, s.title);
  }
  function proveFrom(id, btn) { openProof(id, btn.dataset.task, btn.dataset.title); }
  // For the leader: the steps to approve (or proofs to look over).
  function reviewsHtml(c) {
    // the leader, or a phase lead for their phase's steps
    if (!c.reviews || !c.reviews.length) return '';
    const signOff = signsOff(c);
    // "Approve all" once per person, on their first waiting step
    const per = {}, firstOf = new Set();
    c.reviews.forEach((rv, i) => { if (!per[rv.color]) firstOf.add(i); per[rv.color] = (per[rv.color] || 0) + 1; });
    return `<section class="proof-review"><h4>${icon('check', 'tiny')}${signOff ? `Waiting for your sign-off (${c.reviews.length})` : `New proof this week (${c.reviews.length})`}</h4>
      <ul>${c.reviews.map((rv, i) => `<li><div class="pr-top"><span class="dot" style="background:${esc(rv.color)}"></span><b>${esc(rv.name)}</b><span class="pr-step">${esc(rv.title)}</span><time>${esc(chatTime(rv.tickedAt))}</time></div>
        ${rv.proofText ? `<p class="pr-text">${esc(rv.proofText)}</p>` : signOff && !rv.file ? '<p class="pr-text none">Ticked, no proof added</p>' : ''}${proofThumb(c.id, rv.file)}
        <div class="pr-acts">${signOff ? `<button type="button" class="ok" data-color="${esc(rv.color)}" data-task="${esc(rv.taskId)}" onclick="Race.decide('${c.id}', this, 'approve')">${icon('check', 'tiny')}Approve</button>` : ''}
          <button type="button" data-color="${esc(rv.color)}" data-task="${esc(rv.taskId)}" data-title="${esc(rv.title)}" data-name="${esc(rv.name)}" onclick="Race.decide('${c.id}', this, 'reject')">${icon('undo', 'tiny')}Send back</button>
          ${signOff && per[rv.color] > 1 && firstOf.has(i) ? `<button type="button" class="quiet" data-color="${esc(rv.color)}" data-task="all" onclick="Race.decide('${c.id}', this, 'approve')">Approve all ${per[rv.color]} for ${esc(rv.name.split(' ')[0])}</button>` : ''}</div></li>`).join('')}</ul></section>`;
  }
  async function decide(id, btn, decision) {
    const { color, task } = btn.dataset;
    let note = '';
    if (decision === 'reject') {
      const form = dialog(`${head('Send it back', 'undo')}
        <p class="fb-note"><b>${esc(btn.dataset.title)}</b> · ${esc(btn.dataset.name)}</p>
        ${window.AIFill ? `<div class="ai-fill-row">${AIFill.button({ form: "A leader sending a step back to someone in their group because the proof isn't enough", context: () => `The step: ${btn.dataset.title}. The person: ${btn.dataset.name}.`, fields: [{ key: 'note', label: "What's missing", type: 'text', el: '#pr-note', hint: 'One kind, specific sentence on what proof would do' }] }, 'Write it for me')}</div>` : ''}
        <label for="pr-note">What's missing? <span class="opt">(they'll see this in the chat)</span></label>
        <textarea id="pr-note" maxlength="300" rows="3" placeholder="e.g. The photo doesn't show the finish time"></textarea>
        <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Race.close()">Cancel</button><button type="submit" class="fb-send">Send back</button></div>`);
      form.querySelector('#pr-note').focus();
      note = await new Promise(res => form.addEventListener('submit', e => { e.preventDefault(); res(form.querySelector('#pr-note').value.trim()); close(); }));
    }
    btn.disabled = true;
    try {
      const r = await API.reviewRaceStep(id, { color, taskId: task, decision, note });
      showToast(decision === 'approve' ? `✅ Signed off${r.decided > 1 ? ` ${r.decided} steps` : ''}` : 'Sent back with your note');
    } catch (err) { btn.disabled = false; showToast(err.message || 'Could not do that', 'error'); return; }
    refresh(id);
  }

  function invite() { if (current) showShare(current, false); }
  async function leave() {
    if (!current) return;
    const form = dialog(`${head('Leave the race?')}
      <p class="fb-note">You'll come off the road and the scoreboard. The goal and its tasks stay yours.</p>
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

  return { planInto, copyCode, spTab: spTabSet, assign, claim, splitEvenly, setLead, milestone, setChecks, removeStep, cupHtml: cup, placeHtml, fillHelpSlots, askHelp, offerHelp, planInfo, forgetPlan, openTeam, teamChip, stepChip, proveNext, askProof, openProof, proveFrom, decide, openChat, openFromChat, cheerFrom, cheerIn, youBadge, finishMessage, openReport, fillCelebration, openCreate, showShare, handleLink, offerPendingJoin, joinWithCode, renderPage, openDetail, backToList, clearFromList, inviteFor, remind, leaveFrom, endTeam, load, rivals, youColor, invite, leave, close, current: () => current };
})();
window.Race = Race;
