/* global API, esc, icon, showToast, showPage, showSettingsTab */
// ── YOUR PLAN ───────────────────────────────────────────────────
// Free, or Waypoint Pro (backend/billing.js). Upgrading opens Stripe's own
// checkout page and managing opens Stripe's billing page, so card details
// never touch Waypoint. The plan only changes when Stripe confirms it.
const Billing = (() => {
  const money = p => (p ? new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency.toUpperCase(), minimumFractionDigits: p.amount % 100 ? 2 : 0 }).format(p.amount / 100) : '');
  const PERKS = [
    ['sparkles', 'Ten times the daily AI: your assistant, the Your why coach and AI insights'],
    ['heart', 'Support an independent app built to get people to their goals'],
    ['star', 'First to get new Pro features as they arrive'],
  ];
  async function render() {
    const box = document.getElementById('plan-card');
    if (!box) return;
    let b;
    try { b = await API.getBilling(); } catch { box.innerHTML = ''; return; }
    if (b.plan === 'pro') {
      const date = b.renewsAt ? new Date(b.renewsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      box.innerHTML = `<div class="plan-card is-pro">
        <div class="plan-top"><span class="plan-badge">Pro</span><span class="plan-title">You're on Waypoint Pro</span></div>
        <p class="plan-sub">${b.status === 'past_due' ? 'Your last payment did not go through. Update your card to keep Pro.' : b.cancelAtPeriodEnd ? `Pro ends on ${esc(date)}. You can turn it back on any time before then.` : date ? `Renews on ${esc(date)}.` : ''}</p>
        <ul class="plan-perks">${PERKS.map(([ic, t]) => `<li>${icon(ic)}<span>${esc(t)}</span></li>`).join('')}</ul>
        ${b.configured ? `<button type="button" class="plan-manage" onclick="Billing.manage(this)">${icon('settings')}Manage billing</button>` : ''}
        <p class="plan-note">Change your card, switch between monthly and yearly, see invoices or cancel, on Stripe's secure page.</p>
      </div>`;
      return;
    }
    if (!b.configured) { box.innerHTML = ''; return; } // nothing to sell until payments are set up
    const m = b.prices && b.prices.monthly, y = b.prices && b.prices.yearly;
    const saving = m && y ? Math.round((1 - y.amount / (m.amount * 12)) * 100) : 0;
    box.innerHTML = `<div class="plan-card">
      <div class="plan-top"><span class="plan-badge">Free</span><span class="plan-title">Go further with Waypoint Pro</span></div>
      <p class="plan-sub">Everything you use today stays free. Pro is for when you lean on the assistant every day.</p>
      <ul class="plan-perks">${PERKS.map(([ic, t]) => `<li>${icon(ic)}<span>${esc(t)}</span></li>`).join('')}</ul>
      <div class="plan-buy">
        ${m ? `<button type="button" onclick="Billing.upgrade('month', this)">${esc(money(m))} a month<small>Cancel any time</small></button>` : ''}
        ${y ? `<button type="button" class="alt" onclick="Billing.upgrade('year', this)">${esc(money(y))} a year<small>${saving > 0 ? `Save ${saving}%` : 'Billed yearly'}</small></button>` : ''}
      </div>
      <p class="plan-note">Secure payment by Stripe. Your card details never reach Waypoint.</p>
    </div>`;
  }
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
    if (r === 'success') showToast('🎉 Welcome to Waypoint Pro. Thank you for supporting it!');
    else if (r === 'cancelled') showToast('No payment was taken. You can go Pro any time from Settings.');
    setTimeout(() => { showPage('settings'); setTimeout(() => { showSettingsTab('profile'); render(); }, 150); }, 300);
    if (r === 'success') setTimeout(render, 4000);
  }
  return { render, upgrade, manage, handleReturn };
})();
window.Billing = Billing;
