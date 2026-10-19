/* global API, esc, icon, showToast, showPage, showSettingsTab */
// ── YOUR PLAN ───────────────────────────────────────────────────
// Free, or KolaWay Pro (backend/billing.js). Upgrading opens Stripe's own
// checkout page and managing opens Stripe's billing page, so card details
// never touch KolaWay. The plan only changes when Stripe confirms it.
// The Team plan (backend/teamBilling.js) is one bill for a number of seats;
// whoever pays hands seats out, and everyone on a seat has Pro.
const Billing = (() => {
  const money = p => (p ? new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency.toUpperCase(), minimumFractionDigits: p.amount % 100 ? 2 : 0 }).format(p.amount / 100) : '');
  const PERKS = [
    ['sparkles', 'Ten times the daily AI: your assistant and the Your why coach'],
    ['heart', 'Support an independent app built to get people to their goals'],
    ['star', 'First to get new Pro features as they arrive'],
  ];
  async function render() {
    const box = document.getElementById('plan-card');
    if (!box) return;
    let b;
    try { b = await API.getBilling(); } catch { box.innerHTML = ''; return; }
    const t = b.team || {};
    const teamCard = teamHTML(t);
    if (b.via === 'team' && t.owned && t.owned.active) { box.innerHTML = teamCard; return; } // the team card says it all
    if (b.via === 'team') {
      box.innerHTML = `<div class="plan-card is-pro">
        <div class="plan-top"><span class="plan-badge">Pro</span><span class="plan-title">You're on KolaWay Pro</span></div>
        <p class="plan-sub">Through ${esc(t.member ? t.member.name : 'your team')}, paid for by ${esc(t.member ? t.member.ownerName : 'your team')}. There is nothing for you to pay.</p>
        <ul class="plan-perks">${PERKS.map(([ic, tx]) => `<li>${icon(ic)}<span>${esc(tx)}</span></li>`).join('')}</ul>
      </div>${teamCard}`;
      return;
    }
    if (b.plan === 'pro') {
      const date = b.renewsAt ? new Date(b.renewsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      box.innerHTML = `<div class="plan-card is-pro">
        <div class="plan-top"><span class="plan-badge">Pro</span><span class="plan-title">You're on KolaWay Pro</span></div>
        <p class="plan-sub">${b.status === 'past_due' ? 'Your last payment did not go through. Update your card to keep Pro.' : b.cancelAtPeriodEnd ? `Pro ends on ${esc(date)}. You can turn it back on any time before then.` : date ? `Renews on ${esc(date)}.` : ''}</p>
        <ul class="plan-perks">${PERKS.map(([ic, t]) => `<li>${icon(ic)}<span>${esc(t)}</span></li>`).join('')}</ul>
        ${b.configured ? `<button type="button" class="plan-manage" onclick="Billing.manage(this)">${icon('settings')}Manage billing</button>` : ''}
        <p class="plan-note">Change your card, switch between monthly and yearly, see invoices or cancel, on Stripe's secure page.</p>
      </div>${teamCard}`;
      return;
    }
    if (!b.configured) { box.innerHTML = teamCard; return; } // nothing else to sell until payments are set up
    const m = b.prices && b.prices.monthly, y = b.prices && b.prices.yearly;
    const saving = m && y ? Math.round((1 - y.amount / (m.amount * 12)) * 100) : 0;
    box.innerHTML = `<div class="plan-card">
      <div class="plan-top"><span class="plan-badge">Free</span><span class="plan-title">Go further with KolaWay Pro</span></div>
      <p class="plan-sub">Everything you use today stays free. Pro is for when you lean on the assistant every day.</p>
      <ul class="plan-perks">${PERKS.map(([ic, t]) => `<li>${icon(ic)}<span>${esc(t)}</span></li>`).join('')}</ul>
      <div class="plan-buy">
        ${m ? `<button type="button" onclick="Billing.upgrade('month', this)">${esc(money(m))} a month<small>Cancel any time</small></button>` : ''}
        ${y ? `<button type="button" class="alt" onclick="Billing.upgrade('year', this)">${esc(money(y))} a year<small>${saving > 0 ? `Save ${saving}%` : 'Billed yearly'}</small></button>` : ''}
      </div>
      <p class="plan-note">Secure payment by Stripe. Your card details never reach KolaWay.</p>
    </div>${teamCard}`;
    teamPrice = b.prices && b.prices.team;
    syncTotal();
  }

  // ── Team plan ──
  let teamPrice = null;
  function teamHTML(t) {
    const o = t.owned;
    if (o && o.active) {
      const date = o.renewsAt ? new Date(o.renewsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const free = o.seats - o.used;
      return `<div class="plan-card team-card is-pro" id="team-card">
        <div class="plan-top"><span class="plan-badge">Team</span><span class="plan-title">${esc(o.name)}</span></div>
        <p class="plan-sub">${o.used} of ${o.seats} seats in use. Everyone on a seat has Pro. ${o.cancelAtPeriodEnd ? `The plan ends on ${esc(date)}.` : o.status === 'past_due' ? 'The last payment did not go through. Update the card to keep everyone on Pro.' : date ? `Renews on ${esc(date)}.` : ''}</p>
        <ul class="team-seats">${o.members.map(m => `<li>
          <span class="team-who"><strong>${esc(m.you ? 'You' : m.name || m.email)}</strong>${m.you || !m.name ? '' : `<small>${esc(m.email)}</small>`}${m.joined ? '' : '<small>Not signed up yet</small>'}</span>
          ${m.you ? '<span class="team-tag">Billing owner</span>' : `<button type="button" class="team-remove" data-email="${esc(m.email)}" onclick="Billing.removeSeat(this)" aria-label="Remove ${esc(m.name || m.email)}">${icon('close')}</button>`}
        </li>`).join('')}</ul>
        ${free > 0 ? `<form class="team-add" onsubmit="event.preventDefault(); Billing.addSeat(this)">
          <input type="email" name="email" required placeholder="Email for a seat" aria-label="Email for a seat">
          <button type="submit">Add</button>
        </form>
        <button type="button" class="team-link" onclick="Billing.pickTeamUp(this)">${icon('users')}Add my Team up members</button>
        <div id="team-up-pick"></div>` : '<p class="plan-note">All seats are taken. Add seats to bring more people in.</p>'}
        <div class="team-size">
          <label for="team-size-input">Seats</label>
          <input id="team-size-input" type="number" min="${Math.max(t.minSeats, o.used)}" max="${t.maxSeats}" value="${o.seats}">
          <button type="button" onclick="Billing.resize(this)">Update</button>
        </div>
        <button type="button" class="plan-manage" onclick="Billing.manage(this)">${icon('settings')}Manage billing</button>
        <p class="plan-note">Seat changes are prorated by Stripe. Invoices and the card are on Stripe's secure page.</p>
      </div>`;
    }
    if (!t.configured || t.member) return '';
    return `<div class="plan-card team-card" id="team-card">
      <div class="plan-top"><span class="plan-badge">Team</span><span class="plan-title">KolaWay for teams</span></div>
      <p class="plan-sub">One bill for the whole team. You choose the seats and who gets them, by email or straight from a Team up team, and everyone on a seat has Pro.</p>
      ${o ? '<p class="plan-note">Your team is waiting for payment. Pick up where you left off.</p>' : ''}
      <form class="team-buy" onsubmit="event.preventDefault(); Billing.buyTeam(this)">
        <label>Team name<input name="name" maxlength="60" value="${esc(o ? o.name : '')}" placeholder="Launch team"></label>
        <label>Seats<input name="seats" type="number" min="${t.minSeats}" max="${t.maxSeats}" value="${o ? o.seats : 5}" oninput="Billing.syncTotal()"></label>
        <button type="submit">Continue to payment<small id="team-total"></small></button>
      </form>
      <p class="plan-note">Between ${t.minSeats} and ${t.maxSeats} seats. Secure payment by Stripe.</p>
    </div>`;
  }
  function syncTotal() {
    const out = document.getElementById('team-total'), inp = document.querySelector('.team-buy input[name="seats"]');
    if (!out || !inp || !teamPrice) return;
    const n = Math.max(0, Math.floor(Number(inp.value) || 0));
    out.textContent = `${money({ ...teamPrice, amount: teamPrice.amount * n })} a ${teamPrice.interval || 'month'} for ${n} seats`;
  }
  const busy = async (btn, fn) => {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { showToast('❌ ' + (e.message || 'Something went wrong'), 'error'); } finally { if (btn && btn.isConnected) btn.disabled = false; }
  };
  const buyTeam = f => busy(f.querySelector('button'), async () => {
    const { url } = await API.startTeamCheckout(f.name.value.trim(), Number(f.seats.value));
    location.href = url;
  });
  const addSeat = f => busy(f.querySelector('button'), async () => {
    const r = await API.addTeamSeat(f.email.value.trim());
    showToast(r.added ? `✅ ${f.email.value.trim()} has a seat` : 'They already have a seat');
    render();
  });
  const removeSeat = btn => busy(btn, async () => {
    if (!confirm(`Take the seat back from ${btn.dataset.email}? They lose Pro straight away.`)) return;
    await API.removeTeamSeat(btn.dataset.email);
    showToast('Seat freed');
    render();
  });
  const resize = btn => busy(btn, async () => {
    await API.setTeamSize(Number(document.getElementById('team-size-input').value));
    showToast('✅ Seats updated. Stripe adjusts the next invoice.');
    render();
  });
  // The Team up teams you organise, to seat everyone in one go.
  const pickTeamUp = btn => busy(btn, async () => {
    const box = document.getElementById('team-up-pick');
    const mine = (await API.listRaces()).filter(r => r.owner && r.players.length);
    box.innerHTML = mine.length
      ? `<div class="team-pick">${mine.map(r => `<button type="button" data-id="${esc(r.id)}" onclick="Billing.seatTeamUp(this)">${esc(r.title)}<small>${r.players.length} ${r.players.length === 1 ? 'person' : 'people'}</small></button>`).join('')}</div>`
      : '<p class="plan-note">You are not organising a Team up team yet.</p>';
  });
  const seatTeamUp = btn => busy(btn, async () => {
    const r = await API.seatsFromTeamUp(btn.dataset.id);
    showToast(r.full ? `✅ ${r.added} added. ${r.full} did not fit, so add seats for them.` : r.added ? `✅ ${r.added} added` : 'Everyone there already has a seat');
    render();
  });
  async function upgrade(interval, btn) {
    if (btn) btn.disabled = true;
    try { const { url } = await API.startCheckout(interval); location.href = url; }
    catch (e) { showToast('❌ ' + (e.message || 'Could not open the payment page'), 'error'); if (btn) btn.disabled = false; }
  }
  async function manage(btn) {
    if (btn) btn.disabled = true;
    try { const { url } = await API.openBillingPortal(); location.href = url; }
    catch (e) { showToast('❌ ' + (e.message || 'Could not open billing'), 'error'); if (btn) btn.disabled = false; }
  }
  // Back from Stripe: say what happened and show the plan. The webhook may
  // land a moment after the redirect, so check again shortly.
  function handleReturn() {
    const q = new URLSearchParams(location.search);
    const r = q.get('billing');
    if (!r) return;
    history.replaceState(null, '', location.pathname);
    if (r === 'success') showToast('🎉 Welcome to KolaWay Pro. Thank you for supporting it!');
    else if (r === 'team') showToast('🎉 Your team is on KolaWay Pro. Now hand out the seats.');
    else if (r === 'cancelled') showToast('No payment was taken. You can go Pro any time from Settings.');
    setTimeout(() => { showPage('settings'); setTimeout(() => { showSettingsTab('profile'); render(); }, 150); }, 300);
    if (r === 'success' || r === 'team') setTimeout(render, 4000);
  }
  return { render, upgrade, manage, handleReturn, buyTeam, addSeat, removeSeat, resize, pickTeamUp, seatTeamUp, syncTotal };
})();
window.Billing = Billing;
