/* global icon, esc, API, showToast, closeMobileSidebar */
// ── REPORT A PROBLEM ────────────────────────────────────────────
// A short note to whoever looks after KolaWay, from anywhere in the app
// (the sidebar, the phone's More menu, the command palette). The page
// they were on and their browser go with it, so "it broke" is enough to
// start from. backend/routes/feedback.js saves it and emails the owner.
const Feedback = (() => {
  let lastFocus = null;

  function open() {
    if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
    close();
    lastFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.id = 'feedback-dialog';
    wrap.className = 'fb-overlay';
    wrap.innerHTML = `<form class="fb-card" role="dialog" aria-modal="true" aria-labelledby="fb-title">
        <div class="fb-head"><h2 id="fb-title">${icon('message-circle')}Report a problem</h2>
          <button type="button" class="fb-x" aria-label="Close" onclick="Feedback.close()">${icon('close')}</button></div>
        <label for="fb-text">What happened, or what would make KolaWay better?</label>
        <textarea id="fb-text" rows="5" maxlength="4000" required placeholder="e.g. I ticked a task on my phone and it came back unticked"></textarea>
        <p class="fb-note">We'll see which page you were on and your browser, and reply to your account's email.</p>
        <div class="fb-foot"><button type="button" class="fb-cancel" onclick="Feedback.close()">Cancel</button>
          <button type="submit" class="fb-send">${icon('send', 'tiny')}Send</button></div>
      </form>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    wrap.querySelector('form').addEventListener('submit', send);
    wrap.querySelector('textarea').focus();
  }

  async function send(e) {
    e.preventDefault();
    const box = document.getElementById('fb-text');
    const btn = document.querySelector('#feedback-dialog .fb-send');
    const message = box.value.trim();
    if (message.length < 3) { box.focus(); return; }
    btn.disabled = true;
    try {
      await API.sendFeedback(message, `${(typeof APP !== 'undefined' && APP.currentPage) || ''} ${location.pathname}${location.hash}`.trim());
      close();
      showToast('📨 Thanks. Your report is on its way');
    } catch (err) {
      btn.disabled = false;
      showToast(err.message || 'Could not send it. Try again in a moment', 'error');
    }
  }

  function close() {
    const el = document.getElementById('feedback-dialog');
    if (!el) return;
    el.remove();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // The owner's list on the Metrics page.
  async function renderOwnerList(box) {
    if (!box) return;
    let rows = [];
    try { rows = await API.getAdminFeedback(); } catch { return; }
    box.innerHTML = `<div class="metric-card">
      <p class="metric-card-title">Problem reports <span>${rows.length ? `latest ${rows.length}` : 'none yet'}</span></p>
      ${rows.length ? `<ul class="fb-list">${rows.map(r => `<li><p>${esc(r.message)}</p>
        <small>${esc(r.email || 'unknown')} · ${esc(new Date(r.createdAt).toLocaleString())}${r.page ? ` · ${esc(r.page)}` : ''}</small></li>`).join('')}</ul>`
        : '<p class="metric-note">When someone uses Report a problem it shows here and is emailed to you.</p>'}
    </div>`;
  }

  return { open, close, renderOwnerList };
})();
window.Feedback = Feedback;
