/* global API, DayPace, DayRoad, icon, esc, localDateKey, showToast */
// ── HOW TODAY WENT ──────────────────────────────────────────────
// The end-of-day report for today's plan: a headline, You against the
// Pacer as two lines across the day (the maths is DayPace.lines in
// js/dayPace.js), each task's finish against the time it was planned to
// end, and the tasks left over, which can be moved to tomorrow's plan in
// one go (Start my day picks them up in the morning). Opens from today's
// road (Full view) and from the dashboard once the plan's time is up.
const DayReport = (() => {
  const minOf = d => d.getHours() * 60 + d.getMinutes();
  const nowMin = () => minOf(new Date());
  const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
  const tomorrowKey = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localDateKey(d); };
  let view = null; // { r, L, tomorrow }

  async function open() {
    await DayRoad.refresh();
    const r = DayRoad.state();
    let tomorrow = null;
    try { tomorrow = await API.getDayPlan(tomorrowKey()); } catch { /* offline */ }
    const today = localDateKey(new Date());
    const finishedAt = {};
    (r ? r.items : []).forEach(i => {
      const at = i.task.status === 'Completed' && i.task.completedAt ? new Date(i.task.completedAt) : null;
      if (at && localDateKey(at) === today) finishedAt[i.taskId] = minOf(at);
      else if (i.task.status === 'Completed') finishedAt[i.taskId] = DayPace.toMin(i.start); // finished on an earlier day
    });
    const L = r ? DayPace.lines(r.items, finishedAt, nowMin()) : null;
    view = { r, L, moved: new Set(((tomorrow && tomorrow.items) || []).map(i => i.taskId)) };
    close();
    const el = document.createElement('div');
    el.id = 'day-report';
    el.className = 'dayroad-overlay';
    el.addEventListener('click', e => { if (e.target === el) close(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.appendChild(el);
    paint();
    el.querySelector('.dayroad-x')?.focus();
  }
  function close() {
    document.getElementById('day-report')?.remove();
  }

  function headline(r, L) {
    const left = r.n - r.done;
    if (!left) return { big: r.diff >= 5 ? `Plan done, ${DayPace.minutesText(r.diff)} ahead of the Pacer` : 'Plan done, right on time', small: `All ${r.n} tasks finished.` };
    const over = nowMin() >= r.planEnd;
    return {
      big: `${r.done} of ${r.n} done${over ? '' : ' so far'}`,
      small: over ? `${left} ${left === 1 ? 'task' : 'tasks'} left. Move ${left === 1 ? 'it' : 'them'} to tomorrow below.` : `${r.text}. The plan ends at ${hhmm(r.planEnd)}.`,
    };
  }

  function paint() {
    const el = document.getElementById('day-report');
    if (!el || !view) return;
    const { r, L } = view;
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!r || !L) {
      el.innerHTML = `<div class="dayroad-sheet dayrep" role="dialog" aria-modal="true" aria-labelledby="dayrep-title">
        <div class="dayroad-head"><div><p class="dayroad-kicker">${esc(date)}</p><h3 id="dayrep-title">How today went</h3></div>
        <button type="button" class="dayroad-x" onclick="DayReport.close()" aria-label="Close">${icon('close')}</button></div>
        <p class="dayroad-empty">There's no plan for today, so nothing to report yet.</p></div>`;
      return;
    }
    const h = headline(r, L);
    const left = r.items.filter(i => !i.done);
    const row = (it, k) => {
      const t = L.tasks[k];
      const verdict = t.finished == null ? (view.moved.has(it.taskId) ? '<em class="moved">Moved to tomorrow</em>' : '<em>Not done</em>')
        : `<em class="${t.diff >= 5 ? 'early' : t.diff <= -5 ? 'late' : 'ontime'}">${hhmm(t.finished)} · ${t.diff >= 5 ? `${DayPace.minutesText(t.diff)} early` : t.diff <= -5 ? `${DayPace.minutesText(-t.diff)} late` : 'on time'}</em>`;
      return `<tr><td class="t"><div class="tt">${icon(t.finished == null ? 'circle' : 'check', 'tiny')}<span>${esc(it.task.title)}<small>${hhmm(t.start)}–${hhmm(t.end)}</small></span></div></td><td class="slot">${hhmm(t.start)}–${hhmm(t.end)}</td><td>${verdict}</td></tr>`;
    };
    el.innerHTML = `<div class="dayroad-sheet dayrep" role="dialog" aria-modal="true" aria-labelledby="dayrep-title">
      <div class="dayroad-head"><div><p class="dayroad-kicker">${esc(date)}</p><h3 id="dayrep-title">How today went</h3></div>
        <button type="button" class="dayroad-x" onclick="DayReport.close()" aria-label="Close">${icon('close')}</button></div>
      <div class="dayrep-hero"><b>${esc(h.big)}</b><span>${esc(h.small)}</span></div>
      <section class="dayrep-chart-wrap" aria-labelledby="dayrep-chart-h">
        <div class="dayrep-chart-top"><h4 id="dayrep-chart-h">You vs the Pacer</h4>
          <span class="dayrep-legend"><i class="you"></i>You <i class="pacer"></i>The Pacer</span></div>
        <div class="dayrep-chart" id="dayrep-chart"></div>
      </section>
      <table class="dayrep-table"><caption class="sr-only">Each task: its planned slot and when it was finished</caption>
        <thead><tr><th>Task</th><th class="slot">Planned</th><th>Finished</th></tr></thead>
        <tbody>${r.items.map(row).join('')}</tbody></table>
      ${left.length ? `<section class="dayrep-carry">
        <h4>Left over</h4>
        <ul>${left.map(i => `<li><label><input type="checkbox" value="${i.taskId}" ${view.moved.has(i.taskId) ? 'disabled' : 'checked'}><span>${esc(i.task.title)}</span>${view.moved.has(i.taskId) ? '<small>Already in tomorrow\'s plan</small>' : `<small>${esc(DayPace.minutesText(i.minutes))}</small>`}</label></li>`).join('')}</ul>
        <button type="button" class="dayroad-go" onclick="DayReport.carryOver()" ${left.every(i => view.moved.has(i.taskId)) ? 'disabled' : ''}>${icon('arrow_right')}Move to tomorrow</button>
        <p class="dayrep-note">They go into tomorrow's plan at the same lengths, after anything already there. Start my day will have them ready.</p>
      </section>` : ''}
    </div>`;
    drawChart();
  }

  // You vs the Pacer, drawn to the box's width: tasks done up the side,
  // the day's hours along the bottom. Hover (or touch) for both values at
  // that moment.
  function drawChart() {
    const box = document.getElementById('dayrep-chart');
    if (!box || !view || !view.L) return;
    const L = view.L;
    const W = Math.max(280, box.clientWidth), H = 210;
    const m = { l: 28, r: 56, t: 12, b: 26 };
    const x = t => m.l + ((t - L.from) / Math.max(1, L.to - L.from)) * (W - m.l - m.r);
    const y = v => H - m.b - (v / L.n) * (H - m.t - m.b);
    const path = pts => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('');
    const grid = Array.from({ length: L.n + 1 }, (_, v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${m.l - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join('');
    const step = (L.to - L.from) > 360 ? 120 : 60;
    const ticks = [];
    for (let t = Math.ceil(L.from / step) * step; t <= L.to; t += step) ticks.push(`<text x="${x(t)}" y="${H - 8}" class="ax" text-anchor="middle">${hhmm(t)}</text>`);
    const lastYou = L.you[L.you.length - 1], lastPacer = L.pacer[L.pacer.length - 1];
    // Direct labels at the line ends, nudged apart when they'd collide.
    let ly = y(lastYou[1]), lp = y(lastPacer[1]);
    if (Math.abs(ly - lp) < 14) { if (ly <= lp) { ly -= 7; lp += 7; } else { ly += 7; lp -= 7; } }
    const nowX = L.now >= L.from && L.now <= L.to ? x(L.now) : null;
    box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`You finished ${L.done} of ${L.n} tasks; the Pacer kept to the plan from ${hhmm(L.from)} to ${hhmm(view.r.planEnd)}.`)}">
      ${grid}${ticks.join('')}
      ${nowX != null ? `<line x1="${nowX}" x2="${nowX}" y1="${m.t}" y2="${H - m.b}" class="now"/><text x="${nowX - 4}" y="${H - m.b - 6}" class="ax" text-anchor="end">now</text>` : ''}
      <path d="${path(L.pacer)}" class="pacer"/>
      <path d="${path(L.you)}" class="you"/>
      ${L.tasks.map(t => t.finished).filter(t => t != null).sort((a, b) => a - b).map((t, c) => `<circle cx="${x(t)}" cy="${y(c + 1)}" r="4" class="dot"><title>${esc(`Task ${c + 1} done at ${hhmm(t)}`)}</title></circle>`).join('')}
      <text x="${x(lastYou[0]) + 6}" y="${ly + 4}" class="lbl">You</text>
      <text x="${x(lastPacer[0]) + 6}" y="${lp + 4}" class="lbl">Pacer</text>
      <line class="cross" y1="${m.t}" y2="${H - m.b}" x1="-10" x2="-10"/>
      <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}"/>
    </svg><div class="dayrep-tip" hidden></div>`;
    const svg = box.querySelector('svg'), tip = box.querySelector('.dayrep-tip'), cross = box.querySelector('.cross');
    const move = e => {
      const rect = svg.getBoundingClientRect();
      const px = Math.max(m.l, Math.min(W - m.r, (e.touches ? e.touches[0].clientX : e.clientX) - rect.left));
      const t = L.from + ((px - m.l) / (W - m.l - m.r)) * (L.to - L.from);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      const you = DayPace.valueAt(L.you, t), pacer = DayPace.valueAt(L.pacer, t);
      tip.hidden = false;
      tip.innerHTML = `<b>${hhmm(t)}</b><span><i class="you"></i>You ${t > Math.max(L.now, L.you[L.you.length - 1][0]) ? '–' : Math.floor(you)}</span><span><i class="pacer"></i>Pacer ${pacer.toFixed(1).replace(/\.0$/, '')}</span>`;
      tip.style.left = `${Math.min(px + 10, W - 130)}px`;
    };
    const leave = () => { tip.hidden = true; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); };
    const hit = box.querySelector('.hit');
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerleave', leave);
    hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchend', leave);
  }
  window.addEventListener('resize', () => { if (document.getElementById('dayrep-chart')) drawChart(); });

  // The ticked leftovers go into tomorrow's plan, after whatever is there.
  async function carryOver() {
    if (!view || !view.r) return;
    const ids = [...document.querySelectorAll('#day-report .dayrep-carry input:checked')].map(i => i.value);
    if (!ids.length) { showToast('Tick the tasks to move first', 'error'); return; }
    const key = tomorrowKey();
    let items = [];
    try { items = ((await API.getDayPlan(key)) || {}).items || []; } catch { showToast('Could not reach tomorrow\'s plan', 'error'); return; }
    const end = i => DayPace.toMin(i.start) + Number(i.minutes);
    let at = items.length ? Math.max(...items.map(end)) : DayPace.toMin(view.r.items[0].start);
    const have = new Set(items.map(i => i.taskId));
    let moved = 0;
    for (const it of view.r.items.filter(i => ids.includes(i.taskId) && !have.has(i.taskId))) {
      if (items.length >= 20 || at + it.minutes > 24 * 60) break;
      items.push({ taskId: it.taskId, start: hhmm(at), minutes: it.minutes });
      at += it.minutes; moved++;
    }
    if (!moved) { showToast('Tomorrow\'s plan is full', 'error'); return; }
    try { await API.saveDayPlan(key, items); } catch (e) { showToast('❌ ' + (e.message || 'Could not save tomorrow\'s plan'), 'error'); return; }
    items.forEach(i => view.moved.add(i.taskId));
    showToast(`✅ ${moved === 1 ? '1 task' : `${moved} tasks`} moved to tomorrow. Start my day will have ${moved === 1 ? 'it' : 'them'} ready.`);
    paint();
  }

  return { open, close, carryOver };
})();
window.DayReport = DayReport;
