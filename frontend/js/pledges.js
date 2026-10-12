/* global API, esc, icon, showToast, showPage */
// ── REWARD PLEDGES ──────────────────────────────────────────────
// On a goal's page: the rewards people have promised for finishing it
// (cash or anything else), a private link to invite more, and a way to
// add one promised in person. Earned rewards show in the goal-complete
// celebration and on the dashboard's Journey card. Only the goal's owner
// sees any of this. Waypoint tracks the promise; money changes hands
// between the people themselves. See backend/pledges.js.
const Rewards = (() => {
  const REL = { parent: 'Parent', family: 'Family', partner: 'Partner', friend: 'Friend', boss: 'Boss', coach: 'Coach', teacher: 'Teacher', mentor: 'Mentor', sponsor: 'Sponsor', other: 'Other' };
  const STATUS = { pledged: ['Promised', 'promised'], earned: ['Earned', 'earned'], given: ['Received', 'given'], withdrawn: ['Withdrawn', 'off'], missed: ['Date passed', 'off'] };
  let state = null; // { projectId, title, link, pledges, currency, currencies, relations }

  async function renderProject(project) {
    const box = document.getElementById('detail-rewards');
    if (!box) return;
    // Rewards are the owner's own, and live on the top-level goal.
    if (!project || project.role !== 'owner' || project.parentId) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    let d;
    try { d = await API.getPledges(project.id); } catch { box.classList.add('hidden'); return; }
    state = { projectId: project.id, title: project.title, ...d };
    paint();
  }
  function paint() {
    const box = document.getElementById('detail-rewards');
    if (!box || !state) return;
    const live = state.pledges.filter(p => p.status === 'pledged' || p.status === 'earned');
    const rest = state.pledges.filter(p => !live.includes(p));
    box.classList.remove('hidden');
    box.innerHTML = `<div class="rw-card">
      <div class="rw-head">
        <span class="rw-ic">${icon('gift')}</span>
        <div class="min-w-0 flex-1"><p class="rw-title">Rewards</p>
        <p class="rw-sub">${live.length ? `${live.length} ${live.length === 1 ? 'person is' : 'people are'} backing you on this` : 'Ask someone who believes in you to promise a reward for finishing. Cash, or anything else.'}</p></div>
        <div class="rw-btns">
          <button type="button" class="rw-btn primary" onclick="Rewards.openInvite()">${icon('send', 'tiny')}Invite a pledge</button>
          <button type="button" class="rw-btn" onclick="Rewards.openAdd()" title="Add a reward someone promised you in person">${icon('plus', 'tiny')}<span class="hidden sm:inline">Add one</span></button>
        </div>
      </div>
      ${state.pledges.length ? `<div class="rw-list">${[...live, ...rest].map(row).join('')}</div>` : ''}
    </div>`;
  }
  function row(p) {
    const [label, cls] = STATUS[p.status] || ['', ''];
    const when = p.condition === 'by_date' ? `if you finish by ${new Date(p.byDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'when you finish';
    return `<div class="rw-row ${cls}">
      <span class="rw-av" aria-hidden="true">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</span>
      <div class="min-w-0 flex-1">
        <p class="rw-what">${esc(p.text)}</p>
        <p class="rw-who">from ${esc(p.name)} · ${esc(REL[p.relation] || 'Other')}${p.status === 'pledged' ? ` · ${when}` : ''}</p>
        ${p.message ? `<p class="rw-msg">“${esc(p.message)}”</p>` : ''}
      </div>
      <div class="rw-side">
        <span class="rw-chip ${cls}">${label}</span>
        ${p.status === 'earned' ? `<button type="button" class="rw-mini" onclick="Rewards.received('${p.id}')">${icon('check', 'tiny')}Got it</button>` : ''}
        <button type="button" class="rw-x" onclick="Rewards.remove('${p.id}')" aria-label="Remove this reward" title="Remove">${icon('trash')}</button>
      </div>
    </div>`;
  }

  // ── Invite: the goal's private pledge link ──
  async function openInvite() {
    API.trackFeature('pledges');
    if (!state) return;
    let link = state.link;
    if (!link) {
      try { link = (await API.createPledgeLink(state.projectId)).link; state.link = link; } catch (e) { showToast(e.message || 'Could not make the link', 'error'); return; }
    }
    const text = `I'm working on "${state.title}". Would you back me with a reward for when I finish? It can be anything. ${link}`;
    sheet(`<div class="dayplan-head"><div><p class="dayplan-kicker">Rewards</p><h3 id="sheet-title">Invite someone to pledge</h3>
      <p class="dayplan-sub">A parent, your boss, a coach, a friend, a teacher. They open the link, promise a reward (cash or anything else) and see your progress. No account needed.</p></div>
      <button type="button" class="dayplan-x" onclick="Rewards.close()" aria-label="Close">${icon('close')}</button></div>
      <div class="rw-link"><input id="rw-link" readonly value="${esc(link)}" aria-label="Your pledge link"><button type="button" onclick="Rewards.copy()">${icon('copy', 'tiny')}Copy</button></div>
      <div class="rw-share">
        ${navigator.share ? `<button type="button" onclick="Rewards.nativeShare()">${icon('share', 'tiny')}Share</button>` : ''}
        <a href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${icon('chat', 'tiny')}WhatsApp</a>
        <a href="mailto:?subject=${encodeURIComponent(`Back me on "${state.title}"?`)}&body=${encodeURIComponent(text)}">${icon('mail', 'tiny')}Email</a>
        <a href="sms:?&body=${encodeURIComponent(text)}">${icon('smartphone', 'tiny')}Text</a>
      </div>
      <p class="rw-note">${icon('lock', 'tiny')} Only people you send it to can open it, and you can turn it off any time. Waypoint keeps track of the promise; any money changes hands between you.</p>
      <div class="dayplan-foot"><button type="button" class="dayplan-ai" style="color:#B91C1C" onclick="Rewards.turnOff()">Turn this link off</button>
      <button type="button" class="dayplan-go" onclick="Rewards.close()">Done</button></div>`);
    state.shareText = text;
  }
  function copy() {
    const input = document.getElementById('rw-link');
    if (!input) return;
    (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).then(() => showToast('Link copied')).catch(() => { input.select(); document.execCommand('copy'); showToast('Link copied'); });
  }
  function nativeShare() { navigator.share({ title: 'Back me on my goal', text: state.shareText }).catch(() => {}); }
  async function turnOff() {
    if (!state) return;
    if (!window.confirm('Turn this pledge link off? Anyone who has it won’t be able to pledge any more. Pledges already made stay.')) return;
    await API.deletePledgeLink(state.projectId).catch(() => {});
    state.link = null;
    close();
    showToast('Pledge link turned off');
  }

  // ── Add one promised in person ──
  function openAdd() {
    API.trackFeature('pledges');
    if (!state) return;
    const cur = state.currency || 'GBP';
    sheet(`<div class="dayplan-head"><div><p class="dayplan-kicker">Rewards</p><h3 id="sheet-title">Add a promised reward</h3>
      <p class="dayplan-sub">For a reward someone promised you in person, or one you're giving yourself.</p></div>
      <button type="button" class="dayplan-x" onclick="Rewards.close()" aria-label="Close">${icon('close')}</button></div>
      <form class="rw-form" onsubmit="event.preventDefault(); Rewards.saveAdd()">
        <label>Who promised it<input id="rw-name" maxlength="60" required placeholder="e.g. Mum, my manager, me"></label>
        <label>They are your<select id="rw-rel">${(state.relations || Object.keys(REL)).map(r => `<option value="${r}">${REL[r] || r}</option>`).join('')}</select></label>
        <label>Cash (optional)<span class="rw-cash"><select id="rw-cur" aria-label="Currency">${(state.currencies || ['GBP']).map(c => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select><input id="rw-amount" inputmode="decimal" maxlength="12" placeholder="50"></span></label>
        <label>Something else (optional)<input id="rw-reward" maxlength="140" placeholder="e.g. A weekend away"></label>
        <label class="rw-inline"><input type="checkbox" id="rw-bydate-on" onchange="document.getElementById('rw-bydate').disabled = !this.checked"> Only if I finish by <input type="date" id="rw-bydate" disabled></label>
        <div class="dayplan-foot"><span></span><button type="submit" class="dayplan-go" id="rw-save">${icon('check', 'tiny')}Add reward</button></div>
      </form>`);
    setTimeout(() => document.getElementById('rw-name')?.focus(), 50);
  }
  async function saveAdd() {
    const v = id => document.getElementById(id).value;
    const byDateOn = document.getElementById('rw-bydate-on').checked;
    const btn = document.getElementById('rw-save'); btn.disabled = true;
    try {
      await API.addPledge({ projectId: state.projectId, name: v('rw-name'), relation: v('rw-rel'), currency: v('rw-cur'), amount: v('rw-amount'), reward: v('rw-reward'), condition: byDateOn ? 'by_date' : 'finish', byDate: byDateOn ? v('rw-bydate') : '' });
      close();
      await refresh();
      showToast('Reward added');
    } catch (e) { showToast(e.message || 'Could not add that', 'error'); btn.disabled = false; }
  }

  async function received(id) {
    try { await API.pledgeReceived(id); await refresh(); showToast('Marked received. Say thank you!'); } catch (e) { showToast(e.message || 'Could not update that', 'error'); }
  }
  async function remove(id) {
    if (!window.confirm('Remove this reward from your goal? This can’t be undone.')) return;
    try { await API.deletePledge(id); await refresh(); } catch (e) { showToast(e.message || 'Could not remove that', 'error'); }
  }
  async function refresh() {
    if (!state) return;
    const d = await API.getPledges(state.projectId);
    state = { ...state, ...d };
    paint();
  }

  // A light sheet, the same as Start my day's.
  function sheet(html) {
    close();
    const el = document.createElement('div');
    el.id = 'rw-sheet';
    el.className = 'dayplan-overlay';
    el.innerHTML = `<div class="dayplan" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${html}</div>`;
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.appendChild(el);
  }
  function close() { document.getElementById('rw-sheet')?.remove(); }

  // ── Elsewhere ──
  // The goal-complete celebration: what you've just earned.
  async function fillCelebration(projectId) {
    const el = document.getElementById('project-complete-rewards');
    if (!el) return;
    el.classList.add('hidden');
    if (!projectId) return;
    try {
      const { pledges } = await API.getPledges(projectId);
      const earned = pledges.filter(p => p.status === 'earned');
      if (!earned.length) return;
      el.innerHTML = `<p class="pc-rw-kicker">${icon('gift', 'tiny')} You've earned</p>${earned.map(p => `<p class="pc-rw-row"><b>${esc(p.text)}</b> from ${esc(p.name)}</p>`).join('')}`;
      el.classList.remove('hidden');
    } catch { /* not the owner, or offline */ }
  }
  // The dashboard's Journey card: what's riding on this goal.
  async function paintDashLine(projectId) {
    const el = document.getElementById('dash-reward-line');
    if (!el) return;
    try {
      const { pledges } = await API.getPledgeSummary();
      const mine = pledges.filter(p => p.projectId === projectId);
      if (!mine.length) { el.innerHTML = ''; return; }
      const earned = mine.filter(p => p.status === 'earned');
      const first = earned[0] || mine[0];
      const more = (earned.length || mine.length) - 1;
      el.innerHTML = `<button type="button" class="reward-line ${earned.length ? 'is-earned' : ''}" onclick="showPage('project-detail','${projectId}')">${icon('gift')}<span class="min-w-0 truncate">${earned.length ? 'Earned: ' : ''}<b>${esc(first.text)}</b> from ${esc(first.name)}${earned.length ? '' : ' when you finish'}${more > 0 ? ` +${more} more` : ''}</span></button>`;
    } catch { el.innerHTML = ''; }
  }

  return { renderProject, openInvite, openAdd, saveAdd, copy, nativeShare, turnOff, received, remove, close, fillCelebration, paintDashLine };
})();
window.Rewards = Rewards;
