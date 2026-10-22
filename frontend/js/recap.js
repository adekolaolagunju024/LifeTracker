/* global Race, getJourneyStage, STAGE_NAMES, APP, API, esc, showToast, localDateKey, ProgressMath, icon, openAssistant, Jarvis, showPage, setGanttPageView */
// ── MY WEEK IN REVIEW ───────────────────────────────────────────
// A short full-screen story of the last seven days, in the spirit of
// Spotify Wrapped or Strava's year in sport: tasks finished (against the
// week before), the best day, blockers beaten, the streak, the project that
// moved most and what's next. Tap or use the arrow keys to move through
// it; the last card can be shared as an image or saved.

const RECAP_DAY_MS = 86400000;
const RECAP_SLIDE_MS = 5000;
let recapState = null;

function recapTitleFor(done) {
  if (done >= 15) return ['Unstoppable', 'rocket'];
  if (done >= 8) return ['On a roll', 'flame'];
  if (done >= 4) return ['Building momentum', 'zap'];
  if (done >= 1) return ['Getting going', 'sprout'];
  return ['Warming up', 'coffee'];
}

// Everything the story shows, worked out from data the app already has.
async function buildWeeklyRecap() {
  const [tasks, projects, gaming, team, rewards] = await Promise.all([API.getTasks(), API.getProjects(), API.getJourneyGaming().catch(() => null),
    API.raceWeek().catch(() => null), API.getPledgeSummary().then(r => r.pledges || []).catch(() => [])]);
  const now = Date.now();
  const weekStart = now - 7 * RECAP_DAY_MS;
  const prevStart = now - 14 * RECAP_DAY_MS;
  const inRange = (iso, from, to) => { const t = iso ? Date.parse(iso) : NaN; return t >= from && t < to; };
  const done = tasks.filter(t => t.status === 'Completed' && inRange(t.completedAt, weekStart, now + 1));
  const donePrev = tasks.filter(t => t.status === 'Completed' && inRange(t.completedAt, prevStart, weekStart));
  const foes = tasks.flatMap(t => (t.obstacles || []).filter(o => o.resolved && inRange(o.resolvedAt, weekStart, now + 1)));

  const byDay = {};
  done.forEach(t => { const d = new Date(t.completedAt).toLocaleDateString('en-GB', { weekday: 'long' }); byDay[d] = (byDay[d] || 0) + 1; });
  const bestDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;

  // The top-level project that moved most (sub-folder tasks count for it).
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  const rootOf = id => { const p = byId[id]; return p && p.parentId ? rootOf(p.parentId) : p; };
  const moved = {};
  done.forEach(t => { const r = rootOf(t.projectId); if (r) moved[r.id] = (moved[r.id] || 0) + 1; });
  const topId = Object.entries(moved).sort((a, b) => b[1] - a[1])[0];
  let top = null;
  if (topId) {
    const root = byId[topId[0]];
    const all = tasks.filter(t => (rootOf(t.projectId) || {}).id === root.id);
    top = { title: root.title, icon: root.icon || '📁', count: topId[1], pct: ProgressMath.progressPct(all) };
  }

  const today = localDateKey(new Date());
  const weekAhead = localDateKey(new Date(now + 7 * RECAP_DAY_MS));
  const next = tasks.filter(t => t.status !== 'Completed' && t.endDate && t.endDate >= today && t.endDate <= weekAhead)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));

  const [title, titleIcon] = recapTitleFor(done.length);
  return {
    name: ((APP.profile && APP.profile.name) || '').trim() !== 'Your Name' ? ((APP.profile && APP.profile.name) || '').split(' ')[0] : '',
    everDone: tasks.some(t => t.status === 'Completed'),
    done: done.length, prev: donePrev.length, bestDay, foes: foes.reduce((n, o) => n + (o.count || 1), 0), foeNames: foes.slice(0, 3).map(o => o.name),
    streak: (APP.profile && APP.profile.currentStreak) || 0, longest: (APP.profile && APP.profile.longestStreak) || 0,
    level: gaming ? gaming.level : null, quests: gaming && gaming.daily ? gaming.daily : null, top, next, title, titleIcon,
    // races and groups, cheers, rewards and the stage you play on
    team, rewards, stage: typeof getJourneyStage === 'function' ? getJourneyStage() : null,
    bestPlace: team && team.races.length ? team.races.reduce((b, r) => (r.place && (!b || r.place < b.place) ? r : b), null) : null,
    range: `${new Date(weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(now).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
  };
}

// The newer parts of the week: race results with their cups, the groups
// you lead (with Remind) or are in, the stage you play on, rewards riding
// on your goals or earned, and the cheers you got.
const recapOrd = n => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
function teamSlides(r) {
  const out = [];
  const t = r.team;
  const cupOf = n => (window.Race && Race.cupHtml ? Race.cupHtml(n) : '');
  if (t && t.races.length) {
    const best = r.bestPlace;
    out.push({ bg: 'linear-gradient(160deg,#78350F,#D97706)', html: `<p class="recap-kicker">Race results</p>
      ${best && best.place <= 3 ? `<p class="recap-cup">${cupOf(best.place)}</p>` : ''}
      <p class="recap-big">${best ? `${recapOrd(best.place)} in ${esc(best.title)}` : 'You raced'}</p>
      <ul class="recap-list">${t.races.map(x => `<li><span>${x.place && x.place <= 3 ? cupOf(x.place) : ''}${esc(x.icon || '')} ${esc(x.title)}</span><b>${x.place ? `${recapOrd(x.place)} of ${x.players}` : x.finished ? 'finished' : `${x.done}/${x.total}`}</b></li>`).join('')}</ul>
      ${t.races.some(x => x.stake) ? `<p class="recap-sub">${esc(t.races.find(x => x.stake).stake)}</p>` : ''}` });
  }
  (t ? t.groups : []).slice(0, 2).forEach(g => {
    const role = { coach: 'squad', trainer: 'clients', teacher: 'class', manager: 'team', leader: 'team', organiser: 'group' }[g.leaderRole] || 'group';
    if (g.leader) {
      out.push({ bg: 'linear-gradient(160deg,#1E3A8A,#0A7E8C)', html: `<p class="recap-kicker">Your ${esc(role)} · ${esc(g.title)}</p>
        <p class="recap-huge">${g.group.finished}<small>/${g.group.players}</small></p><p class="recap-sub">finished · ${g.group.stepsPct}% of all steps done${g.group.behind ? ` · ${g.group.behind} behind` : ''}</p>
        <div class="recap-bar"><span style="width:${g.group.stepsPct}%"></span></div>
        ${g.group.behind && !g.over ? `<div class="recap-actions"><button type="button" onclick="event.stopPropagation(); Race.remind('${g.id}')">${icon('bell', 'tiny')}Remind those behind</button></div>` : ''}` });
    } else if (g.me) {
      const pct = g.me.total ? Math.round((g.me.done / g.me.total) * 100) : 0;
      out.push({ bg: 'linear-gradient(160deg,#1E3A8A,#0A7E8C)', html: `<p class="recap-kicker">Your ${esc(role)} · ${esc(g.title)}</p>
        <p class="recap-big">You: ${g.me.done} of ${g.me.total} steps</p><p class="recap-sub">${g.me.pace === 'finished' ? 'Finished. Well done.' : `You're ${esc(g.me.pace)}.`} ${g.group.finished} of ${g.group.players} in the ${esc(role)} have finished.</p>
        <div class="recap-bar"><span style="width:${pct}%"></span></div>` });
    }
  });
  if (r.stage && !document.documentElement.classList.contains('focus-mode')) {
    const name = (typeof STAGE_NAMES !== 'undefined' && STAGE_NAMES[r.stage]) || r.stage;
    out.push({ bg: `linear-gradient(180deg,rgba(13,27,42,.15),rgba(13,27,42,.85)), url('/showcase/stage-${r.stage}.webp') center/cover`, html: `<p class="recap-kicker">Where you played</p><p class="recap-big">${esc(name)}</p><p class="recap-sub">${r.done ? `${r.done} step${r.done === 1 ? '' : 's'} down the road this week.` : 'Your road is waiting for you.'}</p>` });
  }
  const earned = (r.rewards || []).filter(p => p.status === 'earned');
  const waiting = (r.rewards || []).filter(p => p.status === 'pledged');
  if (earned.length || waiting.length) {
    out.push({ bg: 'linear-gradient(160deg,#4C1D95,#9333EA)', html: `<p class="recap-kicker">${earned.length ? 'Rewards earned' : 'Rewards waiting for you'}</p>
      <p class="recap-huge">${icon('gift', 'recap-ic')}${earned.length || waiting.length}</p>
      <ul class="recap-list">${[...earned, ...waiting].slice(0, 3).map(p => `<li><span>${esc(p.text)}</span><b>${p.status === 'earned' ? 'earned' : esc(p.name.split(' ')[0])}</b></li>`).join('')}</ul>
      <p class="recap-sub">${earned.length ? 'Whoever pledged it checks your progress and releases it.' : 'Finish the goal and they’re yours.'}</p>` });
  }
  if (t && t.cheers.count) {
    out.push({ bg: 'linear-gradient(160deg,#9D174D,#F97316)', html: `<p class="recap-kicker">Cheers you got</p><p class="recap-huge">${t.cheers.count}</p>
      <p class="recap-emojis">${t.cheers.emojis.map(esc).join(' ')}</p><p class="recap-sub">from ${t.cheers.from.map(esc).join(', ')}${t.cheers.more ? ` and ${t.cheers.more} more` : ''}</p>` });
  }
  return out;
}

function recapSlides(r) {
  const diff = r.done - r.prev;
  const trend = r.prev === 0 ? (r.done ? 'More than last week, which was a rest week.' : 'A quiet one. This week can be different.')
    : diff > 0 ? `${diff} more than the week before. Up ${Math.round(diff / r.prev * 100)}%.` : diff < 0 ? `${-diff} fewer than the week before. Every week is a fresh start.` : 'Exactly level with the week before. Steady.';
  const slides = [
    { bg: 'linear-gradient(160deg,#0D1B2A,#0A7E8C)', html: `<p class="recap-kicker">${esc(r.range)}</p><p class="recap-big">${r.name ? `${esc(r.name)}'s` : 'Your'} week<br>in review</p><p class="recap-sub">Tap to begin</p>` },
    { bg: 'linear-gradient(160deg,#1B3A5C,#0A7E8C)', html: `<p class="recap-kicker">Tasks finished</p><p class="recap-huge">${r.done}</p><p class="recap-sub">${esc(trend)}</p>` },
  ];
  // Today's quests, unless the game layer is switched off (Focus mode).
  const q = r.quests;
  if (q && q.quests && q.quests.length && !document.documentElement.classList.contains('focus-mode')) {
    const n = q.quests.filter(x => x.done).length;
    slides.push({ bg: 'linear-gradient(160deg,#134E4A,#0D9488)', html: `<p class="recap-kicker">Today's quests</p><p class="recap-big">${n === q.quests.length ? `All done! +${q.bonusXp || 30} XP` : `${n} of ${q.quests.length} done`}</p>
      <ul class="recap-list">${q.quests.map(x => `<li><span>${x.done ? icon('check', 'recap-li-ic') : ''}${esc(x.text)}</span><b>${x.progress}/${x.target}</b></li>`).join('')}</ul>
      ${n === q.quests.length ? '' : `<p class="recap-sub">Finish all three today for +${q.bonusXp || 30} XP.</p>`}` });
  }
  slides.push(...teamSlides(r));
  if (r.bestDay) slides.push({ bg: 'linear-gradient(160deg,#4C1D95,#BE185D)', html: `<p class="recap-kicker">Your best day</p><p class="recap-big">${esc(r.bestDay[0])}</p><p class="recap-sub">${r.bestDay[1]} task${r.bestDay[1] === 1 ? '' : 's'} done in one day.</p>` });
  if (r.foes) slides.push({ bg: 'linear-gradient(160deg,#7F1D1D,#C2410C)', html: `<p class="recap-kicker">Blockers beaten</p><p class="recap-huge">${icon('blocker', 'recap-ic')}${r.foes}</p><p class="recap-sub">${r.foeNames.map(n => `“${esc(n)}”`).join(', ')}${r.foeNames.length ? ' and more, cleared out of your way.' : ''}</p>` });
  slides.push({ bg: 'linear-gradient(160deg,#9A3412,#F59E0B)', html: `<p class="recap-kicker">Your streak</p><p class="recap-huge">${icon('flame', 'recap-ic')}${r.streak}</p><p class="recap-sub">${r.streak ? `day${r.streak === 1 ? '' : 's'} in a row${r.longest > r.streak ? `. Your best is ${r.longest}.` : '. Your best yet!'}` : 'Finish one task today to start a new one.'}</p>` });
  if (r.top) slides.push({ bg: 'linear-gradient(160deg,#064E3B,#0A7E8C)', html: `<p class="recap-kicker">Most progress</p><p class="recap-big">${emojiIcon(r.top.icon)} ${esc(r.top.title)}</p><p class="recap-sub">${r.top.count} task${r.top.count === 1 ? '' : 's'} this week. Now ${r.top.pct}% complete.</p><div class="recap-bar"><span style="width:${r.top.pct}%"></span></div>` });
  slides.push({ bg: 'linear-gradient(160deg,#0D1B2A,#1B3A5C)', html: `<p class="recap-kicker">Coming up</p>${r.next.length ? `<ul class="recap-list">${r.next.slice(0, 4).map(t => `<li><span>${esc(t.title)}</span><b>${esc(new Date(t.endDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }))}</b></li>`).join('')}</ul>` : '<p class="recap-big">A clear week</p><p class="recap-sub">Nothing due in the next seven days. A good time to plan the next goal.</p>'}` });
  slides.push({ bg: 'linear-gradient(160deg,#0A7E8C,#0D1B2A)', final: true, html: `<p class="recap-kicker">This week you were</p><p class="recap-big">${icon(r.titleIcon, 'recap-ic')}${esc(r.title)}</p><div class="recap-stats"><div><b>${r.done}</b><span>tasks</span></div><div><b>${r.foes}</b><span>blockers</span></div><div><b>${r.streak}</b><span>day streak</span></div>${r.level ? `<div><b>${r.level}</b><span>level</span></div>` : ''}${r.bestPlace && r.bestPlace.place ? `<div><b>${recapOrd(r.bestPlace.place)}</b><span>best race</span></div>` : ''}</div><div class="recap-actions"><button type="button" data-recap="share">Share my week</button><button type="button" data-recap="close">Done</button></div>` });
  return slides;
}

function showRecapSlide(i) {
  const s = recapState;
  s.index = Math.max(0, Math.min(i, s.slides.length - 1));
  const slide = s.slides[s.index];
  const card = s.el.querySelector('.recap-card');
  card.style.background = slide.bg;
  const body = card.querySelector('.recap-body');
  body.innerHTML = slide.html;
  body.classList.remove('recap-in'); void body.offsetWidth; body.classList.add('recap-in');
  s.el.querySelectorAll('.recap-progress > span').forEach((bar, j) => {
    bar.classList.toggle('done', j < s.index);
    bar.classList.toggle('active', j === s.index);
    bar.style.animationDuration = `${RECAP_SLIDE_MS}ms`;
  });
  clearTimeout(s.timer);
  if (!slide.final && !s.reduceMotion) s.timer = setTimeout(() => showRecapSlide(s.index + 1), RECAP_SLIDE_MS);
}

function closeWeeklyRecap() {
  if (!recapState) return;
  clearTimeout(recapState.timer);
  document.removeEventListener('keydown', recapState.onKey);
  recapState.el.remove();
  recapState = null;
}

async function openWeeklyRecap() {
  API.trackFeature('recap');
  closeWeeklyRecap();
  let data;
  try { data = await buildWeeklyRecap(); } catch (e) { showToast('❌ ' + (e.message || 'Could not build your week'), 'error'); return; }
  const slides = recapSlides(data);
  const el = document.createElement('div');
  el.className = 'recap-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'My week in review');
  el.innerHTML = `<div class="recap-card"><div class="recap-progress">${slides.map(() => '<span></span>').join('')}</div>
    <button type="button" class="recap-close" aria-label="Close" data-recap="close">×</button>
    <div class="recap-body" aria-live="polite"></div>
    <button type="button" class="recap-nav recap-prev" aria-label="Previous"></button><button type="button" class="recap-nav recap-next" aria-label="Next"></button></div>`;
  document.body.appendChild(el);
  recapState = { el, slides, data, index: 0, timer: null, reduceMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  recapState.onKey = e => {
    if (e.key === 'Escape') closeWeeklyRecap();
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); showRecapSlide(recapState.index + 1); }
    else if (e.key === 'ArrowLeft') showRecapSlide(recapState.index - 1);
  };
  document.addEventListener('keydown', recapState.onKey);
  el.addEventListener('click', e => {
    const action = e.target.closest('[data-recap]');
    if (action) { e.stopPropagation(); if (action.dataset.recap === 'close') closeWeeklyRecap(); else shareWeeklyRecap(); return; }
    if (e.target.closest('.recap-prev')) showRecapSlide(recapState.index - 1);
    else if (e.target.closest('.recap-next')) showRecapSlide(recapState.index + 1);
    else if (e.target === el) closeWeeklyRecap();
  });
  showRecapSlide(0);
}

// The summary card as a 1080×1350 picture (the shape Instagram and most
// chat apps show best), drawn on a canvas so it needs nothing external.
function drawRecapImage(r) {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1080, 1350);
  grad.addColorStop(0, '#0A7E8C'); grad.addColorStop(1, '#0D1B2A');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
  const font = (w, s) => `${w} ${s}px Inter, system-ui, -apple-system, Segoe UI, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,.7)'; g.font = font(700, 34); g.fillText(`MY WEEK IN KOLAWAY · ${r.range.toUpperCase()}`, 80, 140);
  g.fillStyle = '#fff'; g.font = font(900, 96); g.fillText(r.title, 80, 290);
  const stats = [[r.done, 'tasks done'], [r.foes, 'blockers beaten'], [r.streak, 'day streak'], ...(r.level ? [[r.level, 'level']] : [])];
  stats.forEach(([n, label], i) => {
    const x = 80 + (i % 2) * 470; const y = 470 + Math.floor(i / 2) * 260;
    g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.roundRect(x, y - 130, 440, 220, 32); g.fill();
    g.fillStyle = '#fff'; g.font = font(900, 120); g.fillText(String(n), x + 40, y + 10);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = font(600, 36); g.fillText(label, x + 40, y + 65);
  });
  if (r.top) {
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = font(600, 36); g.fillText('Most progress', 80, 1060);
    g.fillStyle = '#fff'; g.font = font(800, 52); g.fillText(r.top.title.slice(0, 34), 80, 1130);
    g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(80, 1160, 920, 18);
    g.fillStyle = '#5EEAD4'; g.fillRect(80, 1160, 920 * r.top.pct / 100, 18);
  }
  // Your best race place this week, with its cup.
  const best = r.bestPlace;
  if (best && best.place) {
    const metal = { 1: ['#F2C230', '#9A7209'], 2: ['#CDD3DA', '#6E7883'], 3: ['#D98C4A', '#8A4F1E'] }[best.place];
    const cx = 160, cy = 905; // in the space under the stats
    if (metal) {
      g.fillStyle = metal[0]; g.strokeStyle = metal[1]; g.lineWidth = 8;
      g.beginPath(); g.moveTo(cx - 70, cy - 90); g.lineTo(cx + 70, cy - 90); g.quadraticCurveTo(cx + 70, cy + 20, cx, cy + 30); g.quadraticCurveTo(cx - 70, cy + 20, cx - 70, cy - 90); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.arc(cx - 70, cy - 55, 30, Math.PI / 2, Math.PI * 1.5); g.stroke();
      g.beginPath(); g.arc(cx + 70, cy - 55, 30, -Math.PI / 2, Math.PI / 2); g.stroke();
      g.fillRect(cx - 12, cy + 30, 24, 40); g.fillRect(cx - 50, cy + 70, 100, 22);
    }
    g.fillStyle = '#fff'; g.font = font(900, 64); g.fillText(`${recapOrd(best.place)} in a race`, 280, cy - 10);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = font(600, 36); g.fillText(best.title.slice(0, 32), 280, cy + 45);
  }
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = font(700, 34); g.fillText(location.host, 80, 1280);
  return new Promise(resolve => c.toBlob(resolve, 'image/png'));
}

async function shareWeeklyRecap() {
  if (!recapState) return;
  const blob = await drawRecapImage(recapState.data);
  const file = new File([blob], 'my-week-in-kolaway.png', { type: 'image/png' });
  const best = recapState.data.bestPlace;
  const text = `My week in KolaWay: ${recapState.data.done} tasks done, ${recapState.data.foes} blockers beaten, ${recapState.data.streak}-day streak${best && best.place ? `, and ${recapOrd(best.place)} in ${best.title}` : ''}.`;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('🖼️ Saved your week as an image');
}

// ── On the dashboard ──
// The same story, playing by itself inside the "This week" card: a quick
// status update the moment the app opens. It loops, pauses while you hover
// or the tab is in the background, and a tap moves it on. The expand button
// opens the full-screen version with sharing.
const RECAP_MINI_MS = 4500;
let dashRecap = null;

async function renderDashboardRecap() {
  const box = document.getElementById('dash-recap');
  if (!box) return;
  let data;
  try { data = await buildWeeklyRecap(); } catch { box.classList.add('hidden'); return; }
  // Nothing finished yet: a week in review would be all zeros, so the card
  // shows what KolaWay can do instead, a button on each slide.
  const tour = data.everDone ? [] : await gettingStartedSlides();
  const starting = tour.length > 0;
  // No title card (the box says what it is) and no share buttons.
  const slides = starting ? tour : recapSlides(data).slice(1)
    .map(s => (s.final ? { ...s, html: s.html.replace(/<div class="recap-actions">[\s\S]*<\/div>$/, '') } : s));
  if (dashRecap) clearTimeout(dashRecap.timer);
  box.classList.remove('hidden');
  box.classList.toggle('is-tour', !!starting);
  box.setAttribute('aria-label', starting ? 'Getting started with KolaWay, as slides' : 'Your week so far, as slides');
  box.innerHTML = `<div class="recap-progress">${slides.map(() => '<span></span>').join('')}</div>
    ${starting ? '' : `<button type="button" class="recap-expand" onclick="openWeeklyRecap()" aria-label="Play my week full screen" title="Full screen">${icon('expand')}</button>`}
    <div class="recap-body"></div>
    <button type="button" class="recap-nav recap-prev" aria-label="Previous slide"></button><button type="button" class="recap-nav recap-next" aria-label="Next slide"></button>`;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  dashRecap = { box, slides, index: 0, timer: null, paused: reduce };
  box.querySelector('.recap-prev').onclick = () => showMiniRecapSlide(dashRecap.index - 1);
  box.querySelector('.recap-next').onclick = () => showMiniRecapSlide(dashRecap.index + 1);
  box.onmouseenter = () => { dashRecap.paused = true; box.classList.add('paused'); clearTimeout(dashRecap.timer); };
  box.onmouseleave = () => { dashRecap.paused = reduce; box.classList.remove('paused'); showMiniRecapSlide(dashRecap.index); };
  showMiniRecapSlide(0);
}

// The feature tour from frontend/data/product.json, the same slides the
// landing page plays. Only the ones with something to tap are used here.
let tourCache = null;
async function gettingStartedSlides() {
  if (!tourCache) {
    try { tourCache = ((await (await fetch('/data/product.json')).json()).tour || []).filter(t => t.action && TOUR_ACTIONS[t.action]); } catch { return []; }
  }
  // Steps they've already taken (a goal set, today planned, as the first
  // run does) drop out, so the slides never ask for what's done.
  const done = await tourDone();
  const left = tourCache.filter(t => !done.has(t.action));
  return left.map((t, i) => ({
    bg: t.bg,
    html: `<p class="recap-kicker">Getting started · ${i + 1} of ${left.length}</p><p class="recap-big">${esc(t.title)}</p><p class="recap-sub">${esc(t.text)}</p><button type="button" class="recap-go" onclick="tourGo('${esc(t.action)}')">${icon(t.icon)}${esc(t.cta || t.name)}</button>`,
  }));
}
async function tourDone() {
  const done = new Set();
  try { if ((await API.getProjects()).some(p => !isEveryday(p))) done.add('plan').add('projects'); } catch { /* offline: show them all */ }
  try { const p = await API.getDayPlan(localDateKey(new Date())); if (p && p.items && p.items.length) done.add('day'); } catch { /* no plan */ }
  try { if ((await API.listRaces()).length) done.add('teams'); } catch { /* offline: keep it */ }
  if (typeof focusModeOn === 'function' && focusModeOn()) done.add('journey'); // the game layer is off
  return done;
}
const TOUR_ACTIONS = {
  plan: () => openAssistant(),
  day: () => Jarvis.startDay(),
  journey: async () => { await showPage('gantt'); setGanttPageView('journey'); },
  actions: () => showPage('actions'),
  why: () => showPage('why'),
  projects: () => showPage('projects'),
  teams: () => showPage('challenges'),
};
function tourGo(action) {
  API.trackFeature('tour');
  (TOUR_ACTIONS[action] || (() => {}))();
}

function showMiniRecapSlide(i) {
  const s = dashRecap;
  if (!s || !s.box.isConnected) return;
  const n = s.slides.length;
  s.index = ((i % n) + n) % n; // loops both ways
  const slide = s.slides[s.index];
  s.box.style.background = slide.bg;
  const body = s.box.querySelector('.recap-body');
  body.innerHTML = slide.html;
  body.classList.remove('recap-in'); void body.offsetWidth; body.classList.add('recap-in');
  const ms = slide.final ? RECAP_MINI_MS * 2 : RECAP_MINI_MS;
  s.box.querySelectorAll('.recap-progress > span').forEach((bar, j) => {
    bar.classList.toggle('done', j < s.index);
    bar.classList.toggle('active', j === s.index);
    bar.style.animationDuration = `${ms}ms`;
  });
  clearTimeout(s.timer);
  if (s.paused) return;
  s.timer = setTimeout(function tick() {
    // Off screen or in a background tab: wait rather than skip ahead.
    if (document.hidden || !s.box.offsetParent) { s.timer = setTimeout(tick, 1000); return; }
    showMiniRecapSlide(s.index + 1);
  }, ms);
}
