/* global API, esc, icon, showToast, showPage */
// ── REWARD PLEDGES ──────────────────────────────────────────────
// On a goal's page: the rewards people have promised for finishing it
// (cash or anything else), a private link to invite more, and a way to
// add one promised in person. Earned rewards show in the goal-complete
// celebration and on the dashboard's Journey card. Only the goal's owner
// sees any of this. StartLine tracks the promise; money changes hands
// between the people themselves. See backend/pledges.js.
const Rewards = (() => {
  const REL = { parent: 'Parent', family: 'Family', partner: 'Partner', friend: 'Friend', boss: 'Boss', coach: 'Coach', teacher: 'Teacher', mentor: 'Mentor', sponsor: 'Sponsor', other: 'Other' };
  const STATUS = { pledged: ['Promised', 'promised'], earned: ['Earned', 'earned'], given: ['Released', 'given'], withdrawn: ['Withdrawn', 'off'], missed: ['Date passed', 'off'] };
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
    let [label, cls] = STATUS[p.status] || ['', ''];
    if (p.status === 'given' && p.receivedAt) label = 'Received';
    const when = p.condition === 'by_date' ? `if you finish by ${new Date(p.byDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'when you finish';
    const fromLink = p.source === 'link';
    const first = esc((p.name || '').split(' ')[0] || 'them');
    // Earned from someone's pledge: they check and release it. Cash: say how
    // you'd like it sent. A gift they're holding shows once it's released.
    const earnedBits = p.status === 'earned' && fromLink ? `<div class="rw-flow">
        <p>${p.held ? `🎁 ${first} is holding a gift for you. ` : ''}${first} checks your progress and releases it.${p.releaseAskedAt ? ' You’ve asked them.' : ''}</p>
        ${p.kind === 'cash' ? `<p class="rw-payto">${p.payTo ? `${icon('check', 'tiny')}You told them how to send it` : `${icon('info', 'tiny')}Tell ${first} how you’d like the money`}</p>` : ''}
        <div class="rw-acts">
          ${p.kind === 'cash' ? `<button type="button" class="rw-mini" onclick="Rewards.openPayTo('${p.id}')">${icon('wallet', 'tiny')}${p.payTo ? 'Change how to send it' : 'How to send it'}</button>` : ''}
          ${!p.releaseAskedAt ? `<button type="button" class="rw-mini primary" onclick="Rewards.askRelease('${p.id}')">${icon('send', 'tiny')}Ask ${first} to release it</button>` : ''}
          <button type="button" class="rw-mini" onclick="Rewards.received('${p.id}')" title="They handed it over in person">${icon('check', 'tiny')}Got it in person</button>
        </div></div>` : '';
    const gift = p.gift ? `<div class="rw-gift"><p class="rw-gift-k">${icon('gift', 'tiny')}Your gift from ${first}</p>
        ${p.gift.code ? `<p class="rw-code"><span>${esc(p.gift.code)}</span><button type="button" onclick="Rewards.copyText(this.previousElementSibling.textContent)" aria-label="Copy the code">${icon('copy', 'tiny')}</button></p>` : ''}
        ${p.gift.link ? `<p><a href="${esc(p.gift.link)}" target="_blank" rel="noopener noreferrer">${icon('external-link', 'tiny')}Open it</a></p>` : ''}
        ${p.gift.note ? `<p class="rw-msg">${esc(p.gift.note)}</p>` : ''}</div>` : '';
    return `<div class="rw-row ${cls}">
      <span class="rw-av" aria-hidden="true">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</span>
      <div class="min-w-0 flex-1">
        <p class="rw-what">${esc(p.text)}${p.held && !p.gift ? ` <span class="rw-held" title="A gift is held for you, revealed when it's released">${icon('gift', 'tiny')}Gift held</span>` : ''}</p>
        <p class="rw-who">from ${esc(p.name)} · ${esc(REL[p.relation] || 'Other')}${p.status === 'pledged' ? ` · ${when}` : ''}</p>
        ${p.message ? `<p class="rw-msg">“${esc(p.message)}”</p>` : ''}
      </div>
      <div class="rw-side">
        <span class="rw-chip ${cls}">${label}</span>
        ${p.status === 'earned' && !fromLink ? `<button type="button" class="rw-mini" onclick="Rewards.received('${p.id}')">${icon('check', 'tiny')}Got it</button>` : ''}
        ${p.status === 'given' && !p.receivedAt ? `<button type="button" class="rw-mini" onclick="Rewards.received('${p.id}')">${icon('check', 'tiny')}Got it</button>` : ''}
        ${fromLink ? `<button type="button" class="rw-mini quiet" onclick="Rewards.openThread('${p.id}')" aria-label="Messages with ${esc(p.name)}">${icon('message-circle', 'tiny')}${p.messages ? `<span class="rw-count">${p.messages}</span>` : ''}</button>` : ''}
        <button type="button" class="rw-x" onclick="Rewards.remove('${p.id}')" aria-label="Remove this reward" title="Remove">${icon('trash')}</button>
      </div>
      ${earnedBits || gift ? `<div class="rw-extra">${earnedBits}${gift}</div>` : ''}
    </div>`;
  }
  const find = id => state && state.pledges.find(p => p.id === id);
  function copyText(t) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => showToast('Copied')).catch(() => showToast(t)); }
  // How you'd like the cash sent: a payment link or details. Only the
  // person who pledged it sees this, and only now it's earned.
  function openPayTo(id) {
    const p = find(id);
    if (!p) return;
    sheet(`<div class="dayplan-head"><div><p class="dayplan-kicker">Rewards</p><h3 id="sheet-title">How should ${esc(p.name)} send it?</h3>
      <p class="dayplan-sub">A payment link (PayPal.me, Monzo, Revolut, Cash App…) or the details they need. Only ${esc(p.name)} sees this, on their own page.</p></div>
      <button type="button" class="dayplan-x" onclick="Rewards.close()" aria-label="Close">${icon('close')}</button></div>
      <form class="rw-form" onsubmit="event.preventDefault(); Rewards.savePayTo('${p.id}')">
        <label>Payment link or details<textarea id="rw-payto" maxlength="300" rows="3" placeholder="e.g. https://monzo.me/ade or Sort code 00-00-00, account 12345678">${esc(p.payTo || '')}</textarea></label>
        <p class="rw-note">${icon('lock', 'tiny')} Only share what you’re happy for them to see. StartLine never moves the money: they send it, then release it.</p>
        <div class="dayplan-foot"><span></span><button type="submit" class="dayplan-go" id="rw-save">${icon('check', 'tiny')}Save</button></div>
      </form>`);
    setTimeout(() => document.getElementById('rw-payto')?.focus(), 50);
  }
  async function savePayTo(id) {
    try { await API.pledgePayTo(id, document.getElementById('rw-payto').value); close(); await refresh(); showToast('Saved. They’ll see it on their page'); } catch (e) { showToast(e.message || 'Could not save that', 'error'); }
  }
  async function askRelease(id) {
    try { await API.pledgeAskRelease(id); await refresh(); showToast('Asked. It’s in your messages with them'); } catch (e) { showToast(e.message || 'Could not ask', 'error'); }
  }
  // The thread with the person who pledged.
  async function openThread(id) {
    const p = find(id);
    if (!p) return;
    let msgs = [];
    try { msgs = await API.pledgeMessages(id); } catch (e) { showToast(e.message || 'Could not open it', 'error'); return; }
    const when = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    sheet(`<div class="dayplan-head"><div><p class="dayplan-kicker">Rewards · ${esc(p.text)}</p><h3 id="sheet-title">Messages with ${esc(p.name)}</h3>
      <p class="dayplan-sub">${p.notified ? `They get an email when you write.` : `They see these on their pledge page.`}</p></div>
      <button type="button" class="dayplan-x" onclick="Rewards.close()" aria-label="Close">${icon('close')}</button></div>
      <div class="rw-thread" role="log" aria-label="Messages">${msgs.length ? msgs.map(m => `<div class="rw-tm ${m.fromOwner ? 'you' : ''}"><b>${m.fromOwner ? 'You' : esc(p.name)}</b><p>${esc(m.text)}</p><small>${esc(when(m.createdAt))}</small></div>`).join('') : '<p class="rw-note">No messages yet. Say thanks, or tell them how it went.</p>'}</div>
      <form class="rw-send" onsubmit="event.preventDefault(); Rewards.say('${p.id}')"><input id="rw-say" maxlength="1000" autocomplete="off" placeholder="Write to ${esc(p.name)}" aria-label="Message"><button type="submit" class="dayplan-go" aria-label="Send">${icon('send', 'tiny')}</button></form>`);
    const t = document.querySelector('.rw-thread');
    if (t) t.scrollTop = t.scrollHeight;
    setTimeout(() => document.getElementById('rw-say')?.focus(), 50);
  }
  async function say(id) {
    const input = document.getElementById('rw-say');
    const text = input.value.trim();
    if (!text) return;
    try { await API.pledgeSay(id, text); } catch (e) { showToast(e.message || 'Could not send it', 'error'); return; }
    openThread(id);
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
      <p class="rw-note">${icon('lock', 'tiny')} Only people you send it to can open it, and you can turn it off any time. StartLine keeps track of the promise; any money changes hands between you.</p>
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
      el.innerHTML = `<p class="pc-rw-kicker">${icon('gift', 'tiny')} You've earned</p>${earned.map(p => `<p class="pc-rw-row"><b>${esc(p.text)}</b> from ${esc(p.name)}${p.source === 'link' ? `<small>${p.held ? 'A gift is waiting. ' : ''}${esc(p.name.split(' ')[0])} checks and releases it</small>` : ''}</p>`).join('')}`;
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

  return { copyText, openPayTo, savePayTo, askRelease, openThread, say, renderProject, openInvite, openAdd, saveAdd, copy, nativeShare, turnOff, received, remove, close, fillCelebration, paintDashLine };
})();
window.Rewards = Rewards;
