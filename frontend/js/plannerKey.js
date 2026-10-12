/* global icon, esc, PRIORITY_BORDER, STATUS_COLOR, shadeColor, formatDateShort */
// ── THE PLANNER KEY ─────────────────────────────────────────────
// What every mark on the Gantt chart, the Kanban board and the Calendar
// means, one tap away (the Key button on each). Each entry shows the mark
// as it's drawn, with words beside it, so nothing is told by colour alone.
// The samples use the same colours and shapes as the views themselves
// (PRIORITY_BORDER, STATUS_COLOR, the badge classes in js/app/01-core.js).
const PlannerKey = (() => {
  const store = {
    get(k) { try { return localStorage.getItem(k) === '1'; } catch { return false; } },
    set(k, on) { try { localStorage.setItem(k, on ? '1' : '0'); } catch { /* private mode */ } },
  };
  let goals = []; // the goals in view, for the colour swatches

  const item = (sample, label, note = '') => `<li class="pkey-item"><span class="pkey-sample" aria-hidden="true">${sample}</span><span class="pkey-text"><b>${label}</b>${note ? `<small>${note}</small>` : ''}</span></li>`;
  const group = (title, items) => `<section class="pkey-group"><h4>${title}</h4><ul>${items.join('')}</ul></section>`;

  // Samples, drawn like the real thing
  const bar = (fill, border) => `<i class="pkey-bar" style="background:${fill};border-color:${border}"></i>`;
  const diamond = c => `<i class="pkey-diamond" style="background:${c};border-color:${c}"></i>`;
  const summary = c => `<i class="pkey-summary" style="background:${c};--c:${c}"></i>`;
  const vline = cls => `<i class="pkey-vline ${cls}"></i>`;
  const arrow = waiting => `<svg viewBox="0 0 34 12" class="pkey-arrow"><path d="M1 6 H27" stroke="${waiting ? '#f59e0b' : '#64748b'}" stroke-width="2" ${waiting ? 'stroke-dasharray="5 3"' : ''} fill="none"/><path d="M26 2 L33 6 L26 10 Z" fill="${waiting ? '#f59e0b' : '#64748b'}"/></svg>`;
  const dot = c => `<i class="pkey-dot" style="background:${c}"></i>`;
  const badge = (cls, ic, text) => `<span class="pkey-badge ${cls}">${icon(ic, 'tiny')}${text}</span>`;
  const pill = (cls, ic, text) => `<span class="pkey-pill ${cls}">${icon(ic)} ${text}</span>`;
  const chip = (c, text, extra = '') => `<span class="pkey-chip ${extra}" style="background:${c}22;color:${c}">${text}</span>`;

  const BADGES = [
    item(badge('red', 'blocker', '2'), 'Blockers still in the way', 'Tap it to see and tick them off'),
    item(badge('green', 'done', ''), 'Every blocker cleared'),
    item(badge('amber', 'link', '1'), 'Waiting on another task', 'It unlocks when that one is done'),
  ];
  const SCHEDULE = [
    item(pill('ok', 'circle', 'On Track'), 'Due later, not done yet'),
    item(pill('late', 'overdue', 'Delayed'), 'Past its due date'),
    item(pill('ok', 'done', 'Done'), 'Finished'),
  ];
  const PRIORITY = color => ['High', 'Medium', 'Low'].map(p => item(color(PRIORITY_BORDER[p]), `${p} priority`));

  function gantt() {
    const first = (goals[0] && goals[0].color) || '#0A7E8C';
    const swatches = goals.slice(0, 6).map(g => item(bar(g.color, g.color), esc(g.title)));
    return [
      group('Bars', [
        ...swatches,
        ...(goals.length > 6 ? [item('', `and ${goals.length - 6} more goals`)] : []),
        item(bar(shadeColor(first, 40), PRIORITY_BORDER.Medium), 'Faded bar', 'The task is done'),
        item(diamond(first), 'Diamond', 'Only a due date, no start date'),
        item(summary(shadeColor(first, -40)), 'Phase bar', "A phase's first to last date; drag it to move them all"),
      ]),
      group('Outline: priority', PRIORITY(c => bar('#fff', c))),
      ...(goals.some(g => g.startDate) ? [group('Goal start dates', goals.filter(g => g.startDate).slice(0, 6).map(g => item(vline('start'), esc(g.title), `Starts ${formatDateShort(g.startDate)}`)))] : []),
      group('Lines and arrows', [
        item(vline('today'), 'Today'),
        item(vline('start'), "A goal's start date"),
        item(arrow(false), 'Waits on a task that is done'),
        item(arrow(true), 'Still waiting on that task'),
      ]),
      group('Status dot', ['Not Started', 'In Progress', 'Completed'].map(s => item(dot(STATUS_COLOR[s]), { 'Not Started': 'To do', 'In Progress': 'Doing', Completed: 'Done' }[s]))),
      group('Badges', BADGES),
      group('Schedule (when shown)', SCHEDULE),
    ].join('');
  }
  function kanban() {
    return [
      group('Columns', [
        item(dot('#6B7280'), 'Not Started'), item(dot('#C0642A'), 'In Progress'), item(dot('#1A7A4A'), 'Completed'),
        item('', 'Drag a card to another column', 'Or use Move to… on a phone'),
      ]),
      group('Dates', [
        item('<span class="pkey-due">12 Oct</span>', 'Due date'),
        item('<span class="pkey-due late">9 Oct</span>', 'Overdue', 'Past its due date and not done'),
      ]),
      group('Priority (when shown)', PRIORITY(c => `<span class="pkey-prio"><i style="background:${c}"></i></span>`)),
      group('Badges', BADGES),
      group('Schedule (when shown)', SCHEDULE),
    ].join('');
  }
  function calendar() {
    return [
      group('Task colour: priority', PRIORITY(c => chip(c, 'Task'))),
      group('Marks', [
        item(chip('#DC2626', `${icon('overdue', 'tiny')}Task`), 'Overdue', 'Shown in red with a clock'),
        item(chip(PRIORITY_BORDER.Medium, 'Task', 'done'), 'Done', 'Crossed out and faded'),
        item('<span class="pkey-today">12</span>', 'Today'),
        item('<span class="pkey-dots"><i style="background:#DC2626"></i><i style="background:#F59E0B"></i><i style="background:#16A34A"></i></span>', 'On a phone: one dot per task', 'Tap a day to list them'),
      ]),
      group('Moving things', [
        item(icon('calendar'), 'Drag a task to another day', 'Its due date moves with it'),
        item(icon('plus'), 'Tap an empty day', 'Adds a task due that day'),
      ]),
    ].join('');
  }

  const PANELS = { gantt: ['gantt', 'planner-key', 'plannerKeyOpen'], kanban: ['kanban', 'planner-key', 'plannerKeyOpen'], calendar: ['calendar', 'calendar-key', 'calendarKeyOpen'] };
  const views = { gantt, kanban, calendar };
  const btnFor = id => document.querySelector(`[aria-controls="${id}"]`);

  function paint(view) {
    const [, id, key] = PANELS[view];
    const el = document.getElementById(id);
    if (!el) return;
    const open = store.get(key);
    el.classList.toggle('hidden', !open);
    const btn = btnFor(id);
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const name = { gantt: 'the Gantt chart', kanban: 'the board', calendar: 'the calendar' }[view];
    el.innerHTML = `<div class="pkey-head"><p>What the marks on ${name} mean</p>
        <button type="button" class="pkey-close" onclick="PlannerKey.toggle('${view}')" aria-label="Close the key">${icon('close')}</button></div>
      <div class="pkey-grid">${views[view]()}</div>`;
  }
  function toggle(view) {
    const [, , key] = PANELS[view];
    store.set(key, !store.get(key));
    paint(view);
  }
  // The planner page tells the key which goals are on screen.
  function setGoals(list) { goals = list || []; }

  return { paint, toggle, setGoals };
})();
window.PlannerKey = PlannerKey;
