/* global API, esc, showToast, openModal, closeModal, openTaskDetail, startTwoMinuteTimer, enablePushReminders, APP_currentDetailTaskId */
// ── TASK ALARMS ─────────────────────────────────────────────────
// "Ring me about this task at 18:30." The reminder lives on the server,
// which rings it as an urgent push (stays on screen, vibrates, with Start
// and Snooze buttons) even when Waypoint is closed. While the app is open
// it also takes over the screen like an alarm clock, with sound, so it
// cuts through a scrolling session instead of hiding in the shade. In the
// Android app it is also scheduled as a native alarm notification.
// Keep-ringing (nag) repeats every 5 minutes, up to 3 more times, until
// the person starts, snoozes or dismisses it.
const Reminders = (() => {
  let list = [];
  const shown = new Set(); // "id:remindAt:fireCount" already put on screen
  let current = null;
  let pollHandle = null;
  let soundHandle = null;
  let nextTimer = null;

  const native = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;
  // Native notification ids are numbers: a stable hash of the task id.
  const nativeId = taskId => { let h = 0; for (const ch of String(taskId)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % 2000000000; };

  const forTask = taskId => list.find(r => r.taskId === taskId) || null;
  const fmt = iso => {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(Date.now() + 86400000);
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return time;
    if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
    return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
  };
  // A small "⏰ 18:30" chip for boards and lists; empty when none is set.
  const chip = taskId => {
    const r = forTask(taskId);
    if (!r) return '';
    return `<button type="button" onclick="event.stopPropagation(); Reminders.openSheet('${r.taskId}')" class="reminder-chip" title="Reminder set. Tap to change" aria-label="Reminder at ${esc(fmt(r.remindAt))}. Change reminder">${icon('alarm', 'tiny mr-1')}${esc(fmt(r.remindAt))}</button>`;
  };

  async function load() {
    try { list = await API.getReminders(); } catch { return; }
    refreshChips();
    check();
    scheduleNext();
  }
  // Wake exactly when the next one is due instead of waiting for the poll.
  function scheduleNext() {
    clearTimeout(nextTimer);
    const next = list.map(r => new Date(r.remindAt).getTime()).filter(t => t > Date.now()).sort((a, b) => a - b)[0];
    if (next && next - Date.now() < 2147483647) nextTimer = setTimeout(load, next - Date.now() + 500);
  }
  function check() {
    if (current) return;
    const due = list.find(r => new Date(r.remindAt).getTime() <= Date.now() && !shown.has(`${r.id}:${r.remindAt}:${r.fireCount}`));
    if (due) ring(due);
  }

  // ── The alarm screen ──
  function startSound() {
    stopSound();
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    try { ctx = AC ? new AC() : null; } catch { ctx = null; }
    const beep = () => {
      // Phones only allow vibration after the person has tapped the page.
      try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([400, 200, 400, 200, 400]); } catch { /* not supported */ }
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      [0, 0.18, 0.36, 0.7, 0.88, 1.06].forEach((at, i) => {
        const t = ctx.currentTime + at;
        const osc = ctx.createOscillator(); const amp = ctx.createGain();
        osc.type = 'square'; osc.frequency.setValueAtTime(i % 3 === 2 ? 1175 : 988, t);
        amp.gain.setValueAtTime(0.0001, t); amp.gain.exponentialRampToValueAtTime(0.12, t + 0.01); amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        osc.connect(amp).connect(ctx.destination); osc.start(t); osc.stop(t + 0.17);
      });
    };
    beep();
    let rings = 1;
    // Rings for about half a minute, then goes quiet (the card stays).
    soundHandle = setInterval(() => { if (++rings > 15) { stopSound(); return; } beep(); }, 2000);
    soundHandle.ctx = ctx;
  }
  function stopSound() {
    if (!soundHandle) return;
    clearInterval(soundHandle);
    try { soundHandle.ctx && soundHandle.ctx.close(); } catch { /* already closed */ }
    try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(0); } catch { /* not supported */ }
    soundHandle = null;
  }

  async function ring(r) {
    shown.add(`${r.id}:${r.remindAt}:${r.fireCount}`);
    current = r;
    let task = null;
    try { task = await API.getTask(r.taskId); } catch { /* still ring with what we have */ }
    const blockers = task ? (task.obstacles || []).filter(o => !o.resolved) : [];
    const waiting = task ? (task.predecessors || []).filter(p => p.status !== 'Completed') : [];
    document.getElementById('alarm-overlay')?.remove();
    const el = document.createElement('div');
    el.id = 'alarm-overlay';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'alarm-title');
    el.innerHTML = `
      <div class="alarm-card">
        <div class="alarm-bell" aria-hidden="true">${icon('alarm')}</div>
        <p class="alarm-kicker">${r.fireCount > 0 ? 'Still waiting on you' : "It's time"} · ${esc(fmt(r.remindAt))}</p>
        <h2 class="alarm-title" id="alarm-title">${esc(r.taskTitle || (task && task.title) || 'Your task')}</h2>
        <p class="alarm-sub">Put the scrolling down for two minutes. Starting is the hard part.</p>
        ${blockers.length ? `<div class="alarm-blockers"><p>${icon('blocker')} Blocked by ${blockers.length === 1 ? 'this' : 'these'}. Clear ${blockers.length === 1 ? 'it' : 'them'} first:</p><ul>${blockers.map(b => `<li>${esc(b.name)}${(b.count || 1) > 1 ? ` ×${b.count}` : ''}</li>`).join('')}</ul></div>` : ''}
        ${waiting.length ? `<div class="alarm-blockers is-waiting"><p>${icon('link')} Waiting on ${waiting.map(p => `"${esc(p.title)}"`).join(', ')}</p></div>` : ''}
        <button type="button" class="alarm-start" onclick="Reminders.start()">${icon('play')} Start now · 2 minutes</button>
        <div class="alarm-row">
          <button type="button" onclick="Reminders.snooze(10)">10 min</button>
          <button type="button" onclick="Reminders.snooze(30)">30 min</button>
          <button type="button" onclick="Reminders.snooze(60)">1 hour</button>
        </div>
        <button type="button" class="alarm-dismiss" onclick="Reminders.dismiss()">Dismiss</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.alarm-start').focus();
    startSound();
    // A Waypoint tab in the background still gets a system notification,
    // even without push turned on.
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.getRegistration().then(reg => reg && reg.showNotification(`⏰ Time for: ${r.taskTitle}`, {
        body: 'Two minutes is enough to start.', tag: `reminder-${r.taskId}`, renotify: true, requireInteraction: true,
        icon: '/icons/icon-192.png', data: { url: `/app?reminder=${r.id}`, reminderId: r.id, taskId: r.taskId },
        actions: [{ action: 'start', title: '▶ Start now' }, { action: 'snooze', title: '😴 Snooze 10 min' }],
      })).catch(() => {});
    }
  }
  function closeAlarm() {
    stopSound();
    document.getElementById('alarm-overlay')?.remove();
    // Clear the matching system notification too, if it is still up.
    if (current && navigator.serviceWorker) {
      const tag = `reminder-${current.taskId}`;
      navigator.serviceWorker.getRegistration().then(reg => reg && reg.getNotifications({ tag })).then(ns => (ns || []).forEach(n => n.close())).catch(() => {});
    }
    const was = current;
    current = null;
    return was;
  }
  async function start() {
    const r = closeAlarm();
    if (!r) return;
    API.ackReminder(r.id).catch(() => {});
    cancelNative(r.taskId);
    list = list.filter(x => x.id !== r.id);
    refreshChips();
    await openTaskDetail(r.taskId);
    // The task panel's own 2-minute timer, when the task hasn't started.
    if (!document.getElementById('td-tiny-step')?.classList.contains('hidden')) startTwoMinuteTimer();
    check();
  }
  async function snooze(minutes) {
    const r = closeAlarm();
    if (!r) return;
    try {
      const updated = await API.snoozeReminder(r.id, minutes);
      list = list.map(x => x.id === r.id ? updated : x);
      scheduleNative(updated);
      showToast(`😴 Snoozed. Ringing again at ${fmt(updated.remindAt)}`);
    } catch (e) { showToast('❌ ' + (e.message || 'Could not snooze'), 'error'); }
    refreshChips();
    scheduleNext();
    check();
  }
  function dismiss() {
    const r = closeAlarm();
    if (!r) return;
    API.ackReminder(r.id).catch(() => {});
    cancelNative(r.taskId);
    list = list.filter(x => x.id !== r.id);
    refreshChips();
    check();
  }

  // ── Native alarms (Android app) ──
  async function scheduleNative(r) {
    const LN = native();
    if (!LN || !r) return;
    try {
      const perm = await LN.checkPermissions();
      if (perm.display !== 'granted') await LN.requestPermissions();
      await LN.cancel({ notifications: [{ id: nativeId(r.taskId) }] }).catch(() => {});
      await LN.schedule({ notifications: [{
        id: nativeId(r.taskId), title: `⏰ Time for: ${r.taskTitle}`, body: 'Two minutes is enough to start.',
        schedule: { at: new Date(r.remindAt), allowWhileIdle: true }, extra: { url: `/app?reminder=${r.id}` },
      }] });
    } catch (e) { console.warn('Native reminder failed:', e && e.message); }
  }
  function cancelNative(taskId) {
    const LN = native();
    if (LN) LN.cancel({ notifications: [{ id: nativeId(taskId) }] }).catch(() => {});
  }

  // ── Setting a reminder ──
  function presets() {
    const now = new Date();
    const at = (h, m = 0, addDays = 0) => { const d = new Date(now); d.setDate(d.getDate() + addDays); d.setHours(h, m, 0, 0); return d; };
    const out = [
      ['In 15 min', new Date(now.getTime() + 15 * 60000)],
      ['In 1 hour', new Date(now.getTime() + 60 * 60000)],
    ];
    if (now.getHours() < 18) out.push(['This evening 6pm', at(18)]);
    else if (now.getHours() < 21) out.push(['Tonight 9pm', at(21)]);
    out.push(['Tomorrow 9am', at(9, 0, 1)]);
    return out;
  }
  const toLocalInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  async function pushReady() {
    if (native()) return true;
    if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return false;
    try { const reg = await navigator.serviceWorker.getRegistration(); return !!(reg && await reg.pushManager.getSubscription()); } catch { return false; }
  }

  async function openSheet(taskId, title) {
    let taskTitle = title;
    if (!taskTitle) { try { taskTitle = (await API.getTask(taskId)).title; } catch { taskTitle = 'this task'; } }
    const existing = forTask(taskId);
    const box = document.getElementById('modal-reminder');
    box.dataset.taskId = taskId;
    document.getElementById('reminder-task-title').textContent = taskTitle;
    document.getElementById('reminder-presets').innerHTML = presets().map(([label, d]) =>
      `<button type="button" class="reminder-preset" onclick="Reminders.save('${d.toISOString()}')">${esc(label)}<small>${esc(fmt(d.toISOString()))}</small></button>`).join('');
    const input = document.getElementById('reminder-custom');
    input.min = toLocalInput(new Date());
    input.value = toLocalInput(existing ? new Date(existing.remindAt) : new Date(Date.now() + 30 * 60000));
    document.getElementById('reminder-nag').checked = existing ? existing.nag : true;
    document.getElementById('reminder-current').textContent = existing ? `Set for ${fmt(existing.remindAt)}` : '';
    document.getElementById('reminder-remove').classList.toggle('hidden', !existing);
    const ready = await pushReady();
    document.getElementById('reminder-push-note').classList.toggle('hidden', ready);
    openModal('modal-reminder');
  }
  async function save(iso) {
    const box = document.getElementById('modal-reminder');
    const taskId = box.dataset.taskId;
    const when = iso || (document.getElementById('reminder-custom').value && new Date(document.getElementById('reminder-custom').value).toISOString());
    if (!when) { showToast('Pick a time first'); return; }
    try {
      const r = await API.setTaskReminder(taskId, { remindAt: when, nag: document.getElementById('reminder-nag').checked });
      list = list.filter(x => x.taskId !== taskId).concat(r).sort((a, b) => a.remindAt.localeCompare(b.remindAt));
      scheduleNative(r);
      closeModal('modal-reminder');
      showToast(`⏰ Reminder set for ${fmt(r.remindAt)}`);
      refreshChips();
      scheduleNext();
    } catch (e) { showToast('❌ ' + (e.message || 'Could not set the reminder'), 'error'); }
  }
  async function remove() {
    const taskId = document.getElementById('modal-reminder').dataset.taskId;
    try { await API.clearTaskReminder(taskId); } catch (e) { showToast('❌ ' + (e.message || 'Could not remove it'), 'error'); return; }
    list = list.filter(x => x.taskId !== taskId);
    cancelNative(taskId);
    closeModal('modal-reminder');
    showToast('Reminder removed');
    refreshChips();
  }
  async function turnOnAlerts() {
    try {
      await enablePushReminders();
      document.getElementById('reminder-push-note').classList.add('hidden');
      showToast('✅ Phone alerts are on');
    } catch (e) { showToast('❌ ' + (e.message || 'Could not turn alerts on'), 'error'); }
  }

  // Chips on screen ("⏰ 18:30") follow the list without a full re-render.
  function refreshChips() {
    document.querySelectorAll('[data-reminder-slot]').forEach(slot => { slot.innerHTML = chip(slot.dataset.reminderSlot); });
    const btn = document.getElementById('td-reminder-btn');
    if (btn && typeof APP_currentDetailTaskId !== 'undefined' && APP_currentDetailTaskId) {
      const r = forTask(APP_currentDetailTaskId);
      btn.innerHTML = `${icon('alarm')} ${r ? esc(fmt(r.remindAt)) : 'Remind me'}`;
    }
  }

  // Opened from a notification: /app?reminder=<id>[&start=1].
  async function handleUrl() {
    const params = new URLSearchParams(location.search);
    const id = params.get('reminder');
    if (!id) return;
    history.replaceState(null, '', '/app');
    await load();
    const r = list.find(x => x.id === id);
    if (!r) return;
    if (params.has('start')) { current = r; await start(); return; }
    if (!current) ring(r);
  }

  function boot() {
    if (pollHandle) return;
    load().then(handleUrl);
    pollHandle = setInterval(load, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'reminder') load(); });
    // Android app: tapping the native alarm opens it here.
    const LN = native();
    if (LN) LN.addListener('localNotificationActionPerformed', ev => {
      const url = ev && ev.notification && ev.notification.extra && ev.notification.extra.url;
      if (url) { history.replaceState(null, '', url); handleUrl(); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) snooze(10); });
  }

  return { boot, load, forTask, chip, openSheet, save, remove, turnOnAlerts, start, snooze, dismiss, fmt };
})();
window.Reminders = Reminders;
