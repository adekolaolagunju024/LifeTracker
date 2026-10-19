/* global icon, esc, API, showPage, showSettingsTab, openAssistant, Jarvis, setGanttPageView, importData, closeMobileSidebar, TOUR_ACTIONS */
// ── HELP ────────────────────────────────────────────────────────
// Short guides to look things up once the first-run steps are done, from
// the ? in the top bar, the sidebar, the command palette or the ? key.
// Each guide says how in a few steps and has a button that goes there.
// "Show me around" plays the feature tour (frontend/data/product.json,
// the same one the dashboard and landing page use) on demand. The first
// time someone opens the Teams page or a 3D Journey, a small card says
// what's there and points at the guide; it shows once per device.
const Help = (() => {
  const go = {
    plan: () => openAssistant(),
    projects: () => showPage('projects'),
    day: () => Jarvis.startDay(),
    actions: () => showPage('actions'),
    gantt: async () => { await showPage('gantt'); setGanttPageView('gantt'); },
    kanban: async () => { await showPage('gantt'); setGanttPageView('kanban'); },
    journey: async () => { await showPage('gantt'); setGanttPageView('journey'); },
    teams: () => showPage('challenges'),
    why: () => showPage('why'),
    import: () => importData(),
    plan_card: async () => { await showPage('settings'); showSettingsTab('profile'); },
    notifications: async () => { await showPage('settings'); showSettingsTab('notifications'); },
    appearance: async () => { await showPage('settings'); showSettingsTab('appearance'); },
  };
  // [section, id, title, steps, button label, where it goes]
  const GUIDES = [
    ['Getting started', 'first-goal', 'Set up your first goal', [
      'Open the assistant and tell it what you want to finish. It drafts a plan with dated steps, and nothing changes until you approve it.',
      'Or add a project yourself from Projects, then add its tasks with start and due dates.',
      'Folders inside a goal become its phases (or departments, in a team).',
    ], 'Open the assistant', 'plan'],
    ['Getting started', 'my-day', 'Plan your day', [
      'Start my day turns today\'s tasks into a timetable: pick what\'s for today and how long each takes.',
      'The Pacer keeps to your times while you work. Finish tasks to stay on plan or get ahead.',
      'Set a wake-up notification in Settings › Notifications and the plan opens each morning.',
    ], 'Start my day', 'day'],
    ['Getting started', 'time-of-day', 'This week, next week and time of day', [
      'Actions shows what\'s due This week and Next week, each task coloured by when it falls: morning, afternoon or evening.',
      'In Kanban, sort by Time of day to see the same split on the board.',
      'Change a task\'s time of day with the picker on its row.',
    ], 'Open Actions', 'actions'],
    ['Planning', 'blockers', 'Blockers and steps that wait', [
      'Open a task and add a blocker for anything in the way. Tick it off when it\'s sorted.',
      'A task can\'t be marked done while a blocker is still open, and a task with predecessors waits for them to finish.',
      'Stuck? Ask for help on a blocker and it goes to your team\'s chat.',
    ], 'See your blockers', 'actions'],
    ['Planning', 'views', 'Gantt, Kanban and Calendar', [
      'The Planner shows the same tasks as a Gantt timeline, a Kanban board or a Journey game.',
      'The key on each view explains its colours and marks.',
      'The Calendar shows due dates by day, and can feed your own calendar app.',
    ], 'Open the Planner', 'gantt'],
    ['Planning', 'import', 'Import a plan', [
      'Settings & data › Import Data (JSON) brings in a plan file: goals, folders, tasks, dates, blockers, tags, counters and predecessors.',
      'A download from KolaWay (Settings › Your data) imports the same way.',
    ], 'Import a file', 'import'],
    ['Teams', 'team-up', 'Team up: which kind?', [
      'Open a goal and choose Team up. Race: friends race through their own copies to the finish.',
      'Group: you lead a class, squad or clients, each working through their own copy towards the same date.',
      'Split the work: one shared goal, each step given to someone. Best for a work team.',
      'People join with the link or the six letter code, from Teams › Join with a code.',
    ], 'Open Teams', 'teams'],
    ['Teams', 'split', 'Split the work: leads and sign-off', [
      'On the team page, hand each step to someone, or Share out the unclaimed ones evenly. Anyone can take an unclaimed step.',
      'Give each phase a lead. Leads see their phase, hand its steps out and sign them off.',
      'Choose how steps are signed off: no sign-off, milestones only (tap a step\'s flag), every step, or proof for every step.',
      'The Timeline tab shows who does what, when, and which steps hand over to the next.',
    ], 'Open Teams', 'teams'],
    ['Teams', 'departments', 'Departments', [
      'In a Split the work team, switch the picker beside sign-off from Phases to Departments. Each folder of the goal becomes a department.',
      'Each department gets a card with its progress, its lead and its people.',
      'Put people in their department from the Department column. If you don\'t, it follows the department they lead or have most steps in.',
      'Type @ and the department\'s name in the team chat (say @Engineering) to reach everyone in it.',
    ], 'Open Teams', 'teams'],
    ['Teams', 'manage-team', 'Manage your team', [
      'On the team page, Manage team (for whoever set it up) changes the team\'s name and anyone\'s name in it. A changed name saves straight away.',
      'Remove takes someone off the team. In Split the work their open steps go back to unclaimed and the goal stops being shared with them.',
      'People you remove can\'t join again with the link or code until you tap Let back in.',
      'Everyone else can change the name they go by with My name, or leave with Leave.',
    ], 'Open Teams', 'teams'],
    ['Teams', 'team-chat', 'Team chat, cheers and nudges', [
      'Each team has a chat: @mention people, share photos and files, and send a message from a task so it links back.',
      'Tap a name on the scoreboard to cheer them on.',
      'If you lead, Remind those behind nudges everyone off pace.',
    ], 'Open Teams', 'teams'],
    ['Motivation', 'why-rewards', 'Your why and rewards', [
      'Your why keeps your reason, your mentor, quotes and your music, found in a two minute chat, and shows them when you\'d give up.',
      'On a goal, Rewards sends a private link: someone who believes in you promises a reward, earned the moment you finish.',
    ], 'Open Your why', 'why'],
    ['Motivation', 'journey', 'Play your plan (Journey)', [
      'The Journey shows a goal as a road your character walks, clearing the blockers you name.',
      'Pick the stage and 2D, Follow cam or Overview from the small controls in the game\'s top-right corner (on a phone, tap the button there).',
      'In 3D, drag to look around, and use + and − to zoom.',
      'XP, quests and trophies are off in Focus mode; switch them on in Settings › Appearance.',
    ], 'Open the Journey', 'journey'],
    ['Account', 'plans', 'Pro and the Team plan', [
      'Everything works on the free plan. Pro raises the daily AI allowance tenfold.',
      'The Team plan is one bill for a number of seats: hand seats out by email or from a Team up team, and everyone on a seat has Pro.',
      'Both are in Settings › Profile, and Manage billing opens Stripe for invoices, cards and cancelling.',
    ], 'See plans', 'plan_card'],
    ['Account', 'reminders', 'Reminders and notifications', [
      'Set an alarm-style reminder on any task from the task panel.',
      'Settings › Notifications has the morning list, the wake-up time and the weekly check-in.',
      'The bell in the top bar collects team activity, mentions and invites.',
    ], 'Notification settings', 'notifications'],
  ];
  const SHORTCUTS = '⌘K or Ctrl+K command palette · / search · n new task · a assistant · j talk · m pause music · ? help · Esc close';
  let lastFocus = null;
  let tourStep = 0, tour = null;

  const guideHTML = ([, id, title, steps, label]) => `<details class="hp-guide" id="hp-${id}" data-id="${id}">
      <summary>${esc(title)}${icon('chevron-down', 'tiny')}</summary>
      <ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <button type="button" class="hp-go" onclick="Help.goTo('${id}')">${esc(label)}${icon('arrow-right', 'tiny')}</button>
    </details>`;
  function listHTML(q = '') {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = GUIDES.filter(g => !words.length || words.every(w => `${g[2]} ${g[3].join(' ')}`.toLowerCase().includes(w)));
    if (!hits.length) return `<p class="hp-empty">Nothing matches “${esc(q)}”. Try other words, or <button type="button" class="ch-link" onclick="Help.close(); Feedback.open()">ask us</button>.</p>`;
    const sections = [...new Set(hits.map(g => g[0]))];
    return sections.map(s => `<section><h3>${esc(s)}</h3>${hits.filter(g => g[0] === s).map(guideHTML).join('')}</section>`).join('');
  }

  function open(guideId) {
    if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
    close();
    lastFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.id = 'help-dialog';
    wrap.className = 'fb-overlay hp-overlay';
    wrap.innerHTML = `<div class="fb-card hp-card" role="dialog" aria-modal="true" aria-labelledby="hp-title">
        <div class="fb-head"><h2 id="hp-title">${icon('help-circle')}Help</h2>
          <button type="button" class="fb-x" aria-label="Close" onclick="Help.close()">${icon('close')}</button></div>
        <div class="hp-top">
          <input type="search" id="hp-search" placeholder="Search the guides" aria-label="Search the guides" autocomplete="off">
          <button type="button" class="hp-tour-btn" onclick="Help.tour()">${icon('compass', 'tiny')}Show me around</button>
        </div>
        <div class="hp-body" id="hp-body">${listHTML()}</div>
        <p class="hp-foot"><span class="hp-keys"><b>Shortcuts</b> ${esc(SHORTCUTS)}<br></span>Still stuck? <button type="button" class="ch-link" onclick="Help.close(); Feedback.open()">Report a problem</button> and we'll reply by email.</p>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const search = wrap.querySelector('#hp-search');
    search.addEventListener('input', () => {
      document.getElementById('hp-body').innerHTML = listHTML(search.value);
      if (search.value.trim()) document.querySelectorAll('#hp-body details').forEach((d, i) => { if (i < 2) d.open = true; });
    });
    try { API.trackFeature('help'); } catch { /* best effort */ }
    if (guideId) {
      const d = document.getElementById(`hp-${guideId}`);
      if (d) { d.open = true; setTimeout(() => d.scrollIntoView({ block: 'start' }), 0); d.querySelector('summary').focus(); return; }
    }
    search.focus();
  }
  function close() {
    const el = document.getElementById('help-dialog');
    if (!el) return;
    el.remove();
    if (lastFocus && lastFocus.focus && lastFocus.isConnected) lastFocus.focus();
  }
  async function goTo(id) {
    const g = GUIDES.find(x => x[1] === id);
    close();
    if (g && go[g[5]]) await go[g[5]]();
  }

  // ── Show me around: the feature tour, a step at a time ──
  async function startTour() {
    if (!tour) {
      try { tour = ((await (await fetch('/data/product.json')).json()).tour || []).filter(t => t.action && typeof TOUR_ACTIONS !== 'undefined' && TOUR_ACTIONS[t.action]); } catch { tour = []; }
    }
    if (!tour.length) return;
    tourStep = 0;
    drawTour();
  }
  function drawTour() {
    const body = document.getElementById('hp-body');
    if (!body) return;
    const t = tour[tourStep];
    document.querySelector('#help-dialog .hp-top').hidden = true;
    body.innerHTML = `<div class="hp-tour" style="background:${esc(t.bg)}">
        <p class="hp-kicker">Show me around · ${tourStep + 1} of ${tour.length}</p>
        <p class="hp-big">${esc(t.title)}</p><p class="hp-sub">${esc(t.text)}</p>
        <button type="button" class="hp-try" onclick="Help.tourGo()">${icon(t.icon, 'tiny')}${esc(t.cta || `Try ${t.name}`)}</button>
      </div>
      <div class="hp-tour-nav">
        <button type="button" onclick="Help.tourStep(-1)" ${tourStep ? '' : 'disabled'}>${icon('back', 'tiny')}Back</button>
        <span>${tour.map((_, i) => `<i class="${i === tourStep ? 'on' : ''}"></i>`).join('')}</span>
        ${tourStep < tour.length - 1 ? `<button type="button" onclick="Help.tourStep(1)">Next${icon('arrow-right', 'tiny')}</button>` : '<button type="button" onclick="Help.endTour()">Done</button>'}
      </div>`;
    body.querySelector('.hp-try').focus();
  }
  function step(d) { tourStep = Math.max(0, Math.min(tour.length - 1, tourStep + d)); drawTour(); }
  function endTour() {
    const top = document.querySelector('#help-dialog .hp-top');
    if (top) top.hidden = false;
    const body = document.getElementById('hp-body');
    if (body) body.innerHTML = listHTML();
  }
  function tourGo() {
    const t = tour && tour[tourStep];
    close();
    if (t) TOUR_ACTIONS[t.action]();
  }

  // ── First visit tips ──
  const TIPS = {
    teams: { title: 'Teams, in a minute', text: 'Open a goal and choose Team up to race friends, lead a group, or split the work across a team with leads, sign-off and departments.', guide: 'team-up' },
    journey3d: { title: 'Getting around in 3D', text: 'Switch stage and view from the controls in the top-right corner. Drag to look around, and use + and − to zoom.', guide: 'journey' },
  };
  const seen = key => { try { return localStorage.getItem(`helpTip:${key}`) === '1'; } catch { return true; /* storage off: don't nag */ } };
  const markSeen = key => { try { localStorage.setItem(`helpTip:${key}`, '1'); } catch { /* storage off */ } };
  function tip(key) {
    const t = TIPS[key];
    if (!t || seen(key) || document.getElementById('help-tip')) return;
    markSeen(key);
    const card = document.createElement('div');
    card.id = 'help-tip';
    card.className = 'hp-tip';
    card.setAttribute('role', 'status');
    card.innerHTML = `<span class="hp-tip-ic">${icon('lightbulb', 'tiny')}</span><div><b>${esc(t.title)}</b><p>${esc(t.text)}</p>
        <div class="hp-tip-actions"><button type="button" onclick="Help.dismissTip(); Help.open('${t.guide}')">Show me how</button><button type="button" class="quiet" onclick="Help.dismissTip()">Got it</button></div></div>`;
    document.body.appendChild(card);
  }
  function dismissTip() { const el = document.getElementById('help-tip'); if (el) el.remove(); }

  return { open, close, goTo, tour: startTour, tourStep: step, endTour, tourGo, tip, dismissTip, GUIDES };
})();
window.Help = Help;
