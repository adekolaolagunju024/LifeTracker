/* global API, DayRoad, icon, esc, showToast, showActionToast, taskGateMessage, showGateCard, refreshAfterStart, localDateKey, openTaskDetail */
// ── TASK ACTIONS: OPEN THE RIGHT APP ────────────────────────────
// What a task is for (stored on it, see backend/taskActions.js): an
// email, a WhatsApp message, a call or text, a meeting, directions, a
// booking or a link. When its turn comes, one tap opens the app that does
// it with the details filled in (Gmail or Outlook, WhatsApp, the phone,
// Google or Outlook Calendar, Google Maps, a booking site), and the person
// presses the final button there. Back in StartLine, it asks "Did that
// go?" and Done ticks the task off. Nothing is sent or booked for them.
// The assistant-free guess from the title ("Email the recruiter")
// suggests the kind.
const TaskActions = (() => {
  const META = {
    email: { icon: 'mail', label: 'Email', verb: 'Send email', asks: 'Did the email go?' },
    whatsapp: { icon: 'message-circle', label: 'WhatsApp', verb: 'WhatsApp', asks: 'Did you send the message?' },
    call: { icon: 'phone', label: 'Call', verb: 'Call', asks: 'Did the call happen?' },
    sms: { icon: 'message-square', label: 'Text', verb: 'Text', asks: 'Did you send the text?' },
    meeting: { icon: 'calendar', label: 'Meeting', verb: 'Set up meeting', asks: 'Is the meeting set up?' },
    directions: { icon: 'map-pin', label: 'Directions', verb: 'Directions', asks: 'Made it?' },
    book: { icon: 'utensils', label: 'Book', verb: 'Book', asks: 'Is it booked?' },
    link: { icon: 'external-link', label: 'Link', verb: 'Open', asks: 'All done there?' },
  };
  const BOOK = { table: ['utensils', 'Book a table'], flight: ['plane', 'Find flights'], taxi: ['car', 'Get a taxi'], hotel: ['bed', 'Find a hotel'] };
  const ORDER = ['email', 'whatsapp', 'call', 'sms', 'meeting', 'directions', 'book', 'link'];

  // Which apps email and meetings open in: Google, Microsoft or this
  // device's own (Mail, Calendar). Saved on the device.
  const apps = () => { try { return localStorage.getItem('wp-apps') || 'google'; } catch { return 'google'; } };
  function setApps(v) { try { localStorage.setItem('wp-apps', v); } catch { /* private mode */ } }

  // A guess at what a task is for, from its title.
  function guess(title) {
    const s = String(title || '').toLowerCase();
    if (/\bwhats ?app\b/.test(s)) return { type: 'whatsapp' };
    if (/\b(e-?mail|mail)\b/.test(s)) return { type: 'email' };
    if (/\b(text|sms)\b/.test(s)) return { type: 'sms' };
    if (/\b(call|ring|phone)\b/.test(s)) return { type: 'call' };
    if (/\b(flight|fly)\b/.test(s)) return { type: 'book', kind: 'flight' };
    if (/\b(taxi|uber|cab)\b/.test(s)) return { type: 'book', kind: 'taxi' };
    if (/\b(hotel|airbnb|accommodation)\b/.test(s)) return { type: 'book', kind: 'hotel' };
    if (/\b(lunch|dinner|breakfast|brunch|restaurant|table)\b/.test(s)) return { type: 'book', kind: 'table' };
    if (/\b(meeting|meet|interview|catch ?up|1:1|one to one|appointment)\b/.test(s)) return { type: 'meeting' };
    if (/\b(bus|train|tube|drive|commute|travel|get to|go to|head to)\b/.test(s)) return { type: 'directions' };
    return null;
  }

  const digits = p => String(p || '').replace(/[^\d+]/g, '');
  const q = encodeURIComponent;
  const pad = n => String(n).padStart(2, '0');
  // When the task happens: its slot on today's plan, else its start date
  // at 9:00, for meetings and travel.
  function slotFor(t) {
    const r = typeof DayRoad !== 'undefined' && DayRoad.state ? DayRoad.state() : null;
    const it = r && r.items.find(i => i.taskId === t.id);
    const day = it ? localDateKey(new Date()) : (t.startDate || t.endDate || localDateKey(new Date())).slice(0, 10);
    const [h, m] = (it ? it.start : '09:00').split(':').map(Number);
    const start = new Date(`${day}T${pad(h)}:${pad(m)}:00`);
    return { start, end: new Date(start.getTime() + (it ? it.minutes : 30) * 60000), day };
  }
  const gcal = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

  // The link that does it: { href, file? } (file: a calendar invite to download).
  function linkFor(a, t) {
    const title = t.title || '';
    switch (a.type) {
      case 'email': {
        const subject = a.subject || title, body = a.body || '';
        if (apps() === 'google') return { href: `https://mail.google.com/mail/?view=cm&fs=1&to=${q(a.to || '')}&su=${q(subject)}&body=${q(body)}` };
        if (apps() === 'microsoft') return { href: `https://outlook.office.com/mail/deeplink/compose?to=${q(a.to || '')}&subject=${q(subject)}&body=${q(body)}` };
        return { href: `mailto:${a.to || ''}?subject=${q(subject)}&body=${q(body)}`, same: true };
      }
      case 'whatsapp': return { href: `https://wa.me/${digits(a.phone).replace(/^\+/, '')}?text=${q(a.body || '')}` };
      case 'call': return { href: `tel:${digits(a.phone)}`, same: true };
      case 'sms': return { href: `sms:${digits(a.phone)}${a.body ? `?&body=${q(a.body)}` : ''}`, same: true };
      case 'meeting': {
        const { start, end } = slotFor(t);
        const subject = a.subject || title;
        if (apps() === 'google') return { href: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${q(subject)}&dates=${gcal(start)}/${gcal(end)}&details=${q(a.body || '')}${a.people ? `&add=${q(a.people)}` : ''}${a.place ? `&location=${q(a.place)}` : ''}` };
        if (apps() === 'microsoft') return { href: `https://outlook.office.com/calendar/deeplink/compose?subject=${q(subject)}&startdt=${q(start.toISOString())}&enddt=${q(end.toISOString())}&body=${q(a.body || '')}${a.people ? `&to=${q(a.people)}` : ''}${a.place ? `&location=${q(a.place)}` : ''}` };
        return { file: icsFor(subject, start, end, a) };
      }
      case 'directions': return { href: `https://www.google.com/maps/dir/?api=1${a.from ? `&origin=${q(a.from)}` : ''}&destination=${q(a.place || title)}&travelmode=transit` };
      case 'book': {
        const where = a.place || '';
        if (a.kind === 'flight') return { href: `https://www.google.com/travel/flights?q=${q(`Flights${a.from ? ` from ${a.from}` : ''}${where ? ` to ${where}` : ''} on ${slotFor(t).day}`)}` };
        if (a.kind === 'taxi') return { href: `https://m.uber.com/ul/?action=setPickup&pickup=my_location${where ? `&dropoff[formatted_address]=${q(where)}` : ''}` };
        if (a.kind === 'hotel') return { href: `https://www.google.com/travel/search?q=${q(`hotels in ${where || 'the area'}`)}` };
        return { href: `https://www.google.com/maps/search/?api=1&query=${q(`restaurants near ${where || 'me'}`)}` };
      }
      case 'link': return { href: a.url };
      default: return null;
    }
  }
  // A calendar invite for this device's own calendar app.
  function icsFor(subject, start, end, a) {
    const esc2 = s => String(s || '').replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StartLine//EN', 'BEGIN:VEVENT', `UID:${Date.now()}@${location.host}`, `DTSTAMP:${gcal(new Date())}`,
      `DTSTART:${gcal(start)}`, `DTEND:${gcal(end)}`, `SUMMARY:${esc2(subject)}`, a.body ? `DESCRIPTION:${esc2(a.body)}` : '', a.place ? `LOCATION:${esc2(a.place)}` : '',
      ...String(a.people || '').split(/[,;\s]+/).filter(x => /@/.test(x)).map(e => `ATTENDEE:mailto:${e}`), 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean);
    return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  }

  // What the button says, e.g. "Send email" or "Find flights".
  const verbFor = a => (a.type === 'book' ? BOOK[a.kind || 'table'][1] : META[a.type].verb);
  const iconFor = a => (a.type === 'book' ? BOOK[a.kind || 'table'][0] : META[a.type].icon);
  // Who or where, in a few words.
  function summary(a) {
    if (a.type === 'email') return a.to ? `to ${a.to}` : '';
    if (a.type === 'whatsapp' || a.type === 'call' || a.type === 'sms') return a.phone || (a.type === 'whatsapp' ? 'pick the chat' : '');
    if (a.type === 'meeting') return a.people ? `with ${a.people}` : '';
    if (a.type === 'directions') return a.place ? `to ${a.place}` : '';
    if (a.type === 'book') return a.place ? (a.kind === 'flight' ? `${a.from ? `${a.from} → ` : ''}${a.place}` : a.place) : '';
    if (a.type === 'link') { try { return new URL(a.url).hostname.replace(/^www\./, ''); } catch { return ''; } }
    return '';
  }

  // A small button for rows and cards (today's road, the focus timer).
  function chip(t, cls = '') {
    if (!t || !t.action || t.status === 'Completed') return '';
    const a = t.action;
    return `<button type="button" class="ta-chip ${cls}" onclick="event.stopPropagation(); TaskActions.run('${t.id}')" title="${esc(`${verbFor(a)} ${summary(a)}`.trim())}">${icon(iconFor(a), 'tiny')}<span>${esc(verbFor(a))}</span></button>`;
  }

  // ── Doing it ──
  let pending = null; // { id, title, type, at }
  async function run(taskId, given) {
    const t = given || await API.getTask(taskId).catch(() => null);
    if (!t || !t.action) return;
    const l = linkFor(t.action, t);
    if (!l) return;
    API.trackFeature && API.trackFeature(`action_${t.action.type}`);
    if (l.file) {
      const url = URL.createObjectURL(l.file);
      const aEl = document.createElement('a');
      aEl.href = url; aEl.download = `${(t.title || 'meeting').replace(/[^\w ]+/g, '').slice(0, 40) || 'meeting'}.ics`;
      document.body.appendChild(aEl); aEl.click(); aEl.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('📅 Invite saved: open it to add it to your calendar');
    } else if (l.same) {
      window.location.href = l.href; // mail, phone and text apps open over the page
    } else {
      window.open(l.href, '_blank', 'noopener');
    }
    pending = { id: t.id, title: t.title, type: t.action.type, at: Date.now() };
    if (l.file) setTimeout(askDone, 1500);
  }
  // Back from the other app: did it go?
  function askDone() {
    if (!pending || Date.now() - pending.at < 1500) return;
    const p = pending;
    pending = null;
    showActionToast(`${META[p.type] ? META[p.type].asks : 'All done?'} “${p.title}”`, [
      { label: 'Not yet', run: () => {} },
      { label: 'Done', run: () => finish(p.id) },
    ]);
  }
  async function finish(taskId) {
    const t = await API.getTask(taskId).catch(() => null);
    if (!t || t.status === 'Completed') return;
    if (taskGateMessage(t, 'Completed')) { showGateCard(t, 'Completed'); return; }
    try { await API.updateTask(taskId, { status: 'Completed' }); } catch (e) { showToast('❌ ' + (e.message || 'Could not finish it'), 'error'); return; }
    showToast(`✅ “${t.title}” done`);
    refreshAfterStart(taskId, 'Completed');
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(askDone, 400); });
  window.addEventListener('focus', () => setTimeout(askDone, 400));

  // ── Setting it (the task panel) ──
  let edit = null; // { taskId, action } while the form is open
  const field = (k, label, value, opts = {}) => `<label class="ta-f"><span>${label}</span>${opts.area
    ? `<textarea data-k="${k}" rows="3" maxlength="${opts.max || 2000}" placeholder="${esc(opts.ph || '')}">${esc(value || '')}</textarea>`
    : `<input data-k="${k}" type="${opts.type || 'text'}" maxlength="${opts.max || 200}" value="${esc(value || '')}" placeholder="${esc(opts.ph || '')}" ${opts.list ? `list="${opts.list}"` : ''}>`}</label>`;
  function formFields(a, t) {
    const appsPick = `<div class="ta-apps" role="group" aria-label="Opens in">${[['google', 'Google'], ['microsoft', 'Outlook'], ['device', 'This device']].map(([k, n]) => `<button type="button" aria-pressed="${apps() === k}" onclick="TaskActions.setApps('${k}'); TaskActions.paint()">${n}</button>`).join('')}</div>`;
    switch (a.type) {
      case 'email': return field('to', 'To', a.to, { type: 'email', ph: 'name@example.com', max: 300, list: 'ta-people' }) + field('subject', 'Subject', a.subject, { ph: t.title }) + field('body', 'Message', a.body, { area: true, ph: 'What do you want to say?' }) + `<p class="ta-hint">Opens in ${appsPick}</p>`;
      case 'whatsapp': return field('phone', 'Their number', a.phone, { type: 'tel', ph: '+44 7700 900123 (or leave it to pick the chat)', max: 40, list: 'ta-phones' }) + field('body', 'Message', a.body, { area: true, ph: 'Hi…' });
      case 'call': return field('phone', 'Number', a.phone, { type: 'tel', ph: '+44 20 7946 0000', max: 40, list: 'ta-phones' });
      case 'sms': return field('phone', 'Number', a.phone, { type: 'tel', ph: '+44 7700 900123', max: 40, list: 'ta-phones' }) + field('body', 'Message', a.body, { area: true });
      case 'meeting': return field('people', 'Invite', a.people, { ph: 'emails, separated by commas', max: 500, list: 'ta-people' }) + field('subject', 'Title', a.subject, { ph: t.title }) + field('place', 'Where', a.place, { ph: 'Online, or an address' }) + field('body', 'Agenda', a.body, { area: true }) + `<p class="ta-hint">Uses its time on today's plan (or its start date at 9:00). Opens in ${appsPick}</p>`;
      case 'directions': return field('place', 'To', a.place, { ph: 'An address, station or place' }) + field('from', 'From', a.from, { ph: 'Leave empty for where you are' });
      case 'book': return `<div class="ta-kinds" role="group" aria-label="What to book">${Object.entries(BOOK).map(([k, [ic, n]]) => `<button type="button" aria-pressed="${(a.kind || 'table') === k}" onclick="TaskActions.setKind('${k}')">${icon(ic, 'tiny')}${n.replace(/^(Book a |Find |Get a )/, '')}</button>`).join('')}</div>`
        + (a.kind === 'flight' ? field('from', 'From', a.from, { ph: 'London' }) + field('place', 'To', a.place, { ph: 'Manchester' }) : field('place', a.kind === 'taxi' ? 'Going to' : 'Where', a.place, { ph: a.kind === 'hotel' ? 'A city or area' : a.kind === 'taxi' ? 'An address' : 'An area, e.g. King\'s Cross' }));
      case 'link': return field('url', 'Link', a.url, { type: 'url', ph: 'https://…', max: 1000 });
      default: return '';
    }
  }
  // Numbers and emails used on other tasks, to pick from.
  async function suggestions() {
    const tasks = await API.getTasks().catch(() => []);
    const emails = new Set(), phones = new Set();
    tasks.forEach(x => { const a = x.action; if (!a) return; [a.to, a.people].filter(Boolean).join(',').split(/[,;\s]+/).filter(e => /@/.test(e)).forEach(e => emails.add(e)); if (a.phone) phones.add(a.phone); });
    return `<datalist id="ta-people">${[...emails].slice(0, 30).map(e => `<option value="${esc(e)}">`).join('')}</datalist><datalist id="ta-phones">${[...phones].slice(0, 30).map(p => `<option value="${esc(p)}">`).join('')}</datalist>`;
  }
  let lastTask = null, lastCanEdit = false;
  async function renderPanel(t, canEdit) {
    lastTask = t; lastCanEdit = canEdit;
    if (!edit || edit.taskId !== t.id) edit = null;
    paint();
    if (canEdit) { const box = document.getElementById('td-action'); if (box) box.insertAdjacentHTML('beforeend', await suggestions()); }
  }
  function paint() {
    const box = document.getElementById('td-action');
    const t = lastTask;
    if (!box || !t) return;
    const a = t.action;
    const done = t.status === 'Completed';
    let html = `<h3 class="ta-h">${icon('external-link', 'tiny')}Do it</h3>`;
    if (edit) {
      const ea = edit.action;
      html += `<div class="ta-pick" role="group" aria-label="What this task is for">${ORDER.map(k => `<button type="button" aria-pressed="${ea.type === k}" onclick="TaskActions.setType('${k}')">${icon(META[k].icon, 'tiny')}${META[k].label}</button>`).join('')}</div>
        <div class="ta-form">${formFields(ea, t)}</div>
        <div class="ta-foot"><button type="button" class="ta-cancel" onclick="TaskActions.cancel()">Cancel</button><button type="button" class="ta-save" onclick="TaskActions.save()">${icon('check', 'tiny')}Save</button></div>`;
    } else if (a) {
      html += `<div class="ta-card"><span class="ta-ic">${icon(iconFor(a))}</span><span class="ta-what"><b>${esc(verbFor(a))}</b><small>${esc(summary(a) || 'Tap to open')}</small></span>
        ${done ? '' : `<button type="button" class="ta-go" onclick="TaskActions.run('${t.id}')">${icon('external-link', 'tiny')}Open</button>`}
        ${lastCanEdit ? `<button type="button" class="ta-mini" onclick="TaskActions.startEdit()" aria-label="Change the action">${icon('edit', 'tiny')}</button><button type="button" class="ta-mini" onclick="TaskActions.remove()" aria-label="Remove the action">${icon('close', 'tiny')}</button>` : ''}</div>`;
    } else if (lastCanEdit && !done) {
      const g = guess(t.title);
      html += `<p class="ta-ask">${g ? `Looks like ${g.type === 'book' ? `a booking (${BOOK[g.kind][1].toLowerCase()})` : `a${/^[aeiou]/.test(META[g.type].label.toLowerCase()) ? 'n' : ''} ${META[g.type].label.toLowerCase()}`}. Set it up and one tap opens the right app when it's time.` : 'Is this an email, a call, a meeting or a trip? Set it up and one tap opens the right app when it\'s time.'}</p>
        <div class="ta-pick">${(g ? [g.type, ...ORDER.filter(k => k !== g.type)] : ORDER).map((k, i) => `<button type="button" class="${g && i === 0 ? 'is-guess' : ''}" onclick="TaskActions.startEdit('${k}'${g && k === g.type && g.kind ? `, '${g.kind}'` : ''})">${icon(META[k].icon, 'tiny')}${META[k].label}</button>`).join('')}</div>`;
    } else { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const lists = box.querySelectorAll('datalist');
    box.innerHTML = html;
    lists.forEach(l => box.appendChild(l));
    if (edit) box.querySelector('.ta-form input, .ta-form textarea')?.focus();
  }
  function readForm() {
    if (!edit) return;
    document.querySelectorAll('#td-action .ta-form [data-k]').forEach(el => { edit.action[el.dataset.k] = el.value.trim(); });
  }
  function startEdit(type, kind) {
    if (!lastTask) return;
    edit = { taskId: lastTask.id, action: lastTask.action ? { ...lastTask.action } : { type: type || 'email', ...(kind ? { kind } : {}) } };
    if (type && !lastTask.action) edit.action.type = type;
    paint();
  }
  function setType(type) { readForm(); edit.action = { ...edit.action, type, ...(type === 'book' && !edit.action.kind ? { kind: 'table' } : {}) }; paint(); }
  function setKind(kind) { readForm(); edit.action.kind = kind; paint(); }
  function cancel() { edit = null; paint(); }
  async function save() {
    readForm();
    const a = Object.fromEntries(Object.entries(edit.action).filter(([, v]) => v !== '' && v != null));
    if (a.type === 'link' && a.url && !/^https:\/\//i.test(a.url)) a.url = `https://${a.url.replace(/^\w+:\/\//, '')}`;
    try {
      const saved = await API.updateTask(lastTask.id, { action: a });
      lastTask = { ...lastTask, action: saved.action };
      edit = null;
      paint();
      showToast(`✅ ${verbFor(saved.action)} is set. Tap Open when it's time`);
      if (typeof DayRoad !== 'undefined') DayRoad.refresh();
    } catch (e) { showToast('❌ ' + (e.message || 'Could not save that'), 'error'); }
  }
  async function remove() {
    try { await API.updateTask(lastTask.id, { action: null }); } catch (e) { showToast('❌ ' + (e.message || 'Could not remove it'), 'error'); return; }
    lastTask = { ...lastTask, action: null };
    paint();
    if (typeof DayRoad !== 'undefined') DayRoad.refresh();
  }

  return { guess, linkFor, chip, run, renderPanel, paint, startEdit, setType, setKind, cancel, save, remove, setApps, open: id => openTaskDetail(id) };
})();
if (typeof module !== 'undefined') module.exports = TaskActions;
else window.TaskActions = TaskActions;
