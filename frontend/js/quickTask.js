/* global API, icon, esc, showToast, localDateKey, closeMobileSidebar, APP, renderDashboard, renderActions, renderCalendar, clockText */
// ── QUICK TASK ──────────────────────────────────────────────────
// Something that comes up in the day and isn't a goal: "Meet Tom at the
// train station 11am". Type it as you'd say it; the day and time are read
// out of the words (backend/quickTask.js) and shown before you add it, and
// you can change either. It goes in your Everyday list, is pinned in that
// day's plan when it has a time (Start my day fits the rest around it),
// and can remind you before. From the dashboard, Actions, the command
// palette and the q key.
const QuickTask = (() => {
  let lastFocus = null, timer = null, seq = 0;
  const today = () => localDateKey(new Date());
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localDateKey(d); };
  const dayText = key => (key === today() ? 'Today' : key === tomorrow() ? 'Tomorrow'
    : new Date(`${key}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }));
  const timeText = t => (typeof clockText === 'function' ? clockText(t) : t);
  const PART = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

  function open(text = '') {
    if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
    close();
    lastFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.id = 'quick-task';
    wrap.className = 'fb-overlay';
    wrap.innerHTML = `<form class="fb-card qt-card" role="dialog" aria-modal="true" aria-labelledby="qt-title">
        <div class="fb-head"><h2 id="qt-title">${icon('zap')}Quick task</h2>
          <button type="button" class="fb-x" aria-label="Close" onclick="QuickTask.close()">${icon('close')}</button></div>
        <input id="qt-text" class="qt-text" maxlength="200" autocomplete="off" placeholder="e.g. Meet Tom at the train station 11am" aria-label="What is it? Add a day and time if it has one" aria-describedby="qt-read">
        <p class="qt-read" id="qt-read" aria-live="polite"></p>
        <div class="qt-grid">
          <label>Day<input type="date" id="qt-date"></label>
          <label>Time<input type="time" id="qt-time"></label>
          <label>How long<select id="qt-mins">${[15, 30, 45, 60, 90, 120].map(m => `<option value="${m}"${m === 30 ? ' selected' : ''}>${m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ' 30' : ''}`}</option>`).join('')}</select></label>
          <label id="qt-remind-l">Remind me<select id="qt-remind"><option value="">No reminder</option><option value="0">At the time</option><option value="10">10 min before</option><option value="15">15 min before</option><option value="30" selected>30 min before</option><option value="60">1 hour before</option></select></label>
        </div>
        <p class="fb-note">It goes in your Everyday list, not a goal. With a time it's fixed in that day's plan, and Start my day fits everything else around it.</p>
        <div class="fb-foot"><button type="button" class="fb-cancel" onclick="QuickTask.close()">Cancel</button>
          <button type="submit" class="fb-send">${icon('plus', 'tiny')}Add</button></div>
      </form>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const form = wrap.querySelector('form');
    const box = form.querySelector('#qt-text');
    const date = form.querySelector('#qt-date');
    const time = form.querySelector('#qt-time');
    date.value = today();
    // The words set the day and time until you change those yourself.
    form.dataset.ownDate = ''; form.dataset.ownTime = '';
    date.addEventListener('change', () => { form.dataset.ownDate = '1'; paint(); });
    time.addEventListener('change', () => { form.dataset.ownTime = '1'; paint(); });
    box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(read, 250); });
    form.addEventListener('submit', submit);
    box.value = text;
    if (text) read();
    paint();
    box.focus();
  }

  async function read() {
    const form = document.querySelector('#quick-task form');
    if (!form) return;
    const text = form.querySelector('#qt-text').value.trim();
    const mine = ++seq;
    let p = null;
    if (text) { try { p = await API.quickParse(text, today()); } catch { return; } }
    if (mine !== seq || !form.isConnected) return;
    if (!form.dataset.ownDate) form.querySelector('#qt-date').value = p ? p.date : today();
    if (!form.dataset.ownTime) form.querySelector('#qt-time').value = p && p.time ? p.time : '';
    form.dataset.title = p ? p.title : '';
    form.dataset.part = p && p.dayPart ? p.dayPart : '';
    paint();
  }
  // What it'll be: "Meet Tom at the train station · Tomorrow · 11:00 (fixed) · Morning".
  function paint() {
    const form = document.querySelector('#quick-task form');
    if (!form) return;
    const t = form.querySelector('#qt-time').value;
    const d = form.querySelector('#qt-date').value || today();
    const title = form.dataset.title || '';
    const part = t ? (Number(t.slice(0, 2)) < 12 ? 'morning' : Number(t.slice(0, 2)) < 17 ? 'afternoon' : 'evening') : form.dataset.part;
    form.querySelector('#qt-remind-l').classList.toggle('qt-off', !t);
    form.querySelector('#qt-remind').disabled = !t;
    form.querySelector('#qt-read').innerHTML = title
      ? `<b>${esc(title)}</b><span>${icon('calendar', 'tiny')}${esc(dayText(d))}</span>${t ? `<span class="qt-fixed">${icon('pin', 'tiny')}${esc(timeText(t))}, fixed</span>` : '<span>Any time</span>'}${part ? `<span class="dp-chip dp-${part}">${PART[part]}</span>` : ''}`
      : '<span class="qt-hint">Write it as you’d say it. “tomorrow”, “Friday”, “3pm” and “tonight” all work.</span>';
  }

  async function submit(e) {
    e.preventDefault();
    const form = e.target;
    const text = form.querySelector('#qt-text').value.trim();
    if (!text) { form.querySelector('#qt-text').focus(); return; }
    const btn = form.querySelector('.fb-send');
    btn.disabled = true;
    const t = form.querySelector('#qt-time').value;
    const body = {
      text, today: today(), tzOffset: new Date().getTimezoneOffset(),
      date: form.querySelector('#qt-date').value || today(), time: t || '',
      minutes: Number(form.querySelector('#qt-mins').value),
      ...(t && form.querySelector('#qt-remind').value !== '' ? { remindBefore: Number(form.querySelector('#qt-remind').value) } : {}),
    };
    let r;
    try { r = await API.quickTask(body); } catch (err) { btn.disabled = false; showToast(err.message || 'Could not add it', 'error'); return; }
    close();
    showToast(`📌 ${r.task.title}: ${dayText(r.date)}${r.time ? ` at ${timeText(r.time)}${r.planned ? ', in your plan' : ''}` : ''}${r.reminderAt ? '. We’ll remind you' : ''}`);
    try { API.trackFeature('quick_task'); } catch { /* best effort */ }
    const page = typeof APP !== 'undefined' && APP.currentPage;
    if (page === 'dashboard' && typeof renderDashboard === 'function') renderDashboard();
    else if (page === 'actions' && typeof renderActions === 'function') renderActions();
    else if (page === 'calendar' && typeof renderCalendar === 'function') renderCalendar();
  }

  function close() {
    clearTimeout(timer);
    const el = document.getElementById('quick-task');
    if (!el) return;
    el.remove();
    if (lastFocus && lastFocus.focus && lastFocus.isConnected) lastFocus.focus();
  }

  return { open, close };
})();
window.QuickTask = QuickTask;
