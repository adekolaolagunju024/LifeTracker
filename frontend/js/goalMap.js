// The goal map: one picture of a whole goal. Its phases (or its steps when
// it has no phases) are pins on a trail that winds up to a summit flag, and
// the goals waiting on this one sit beyond the summit behind a padlock.
// Opened from the goal page (Map) and from the "Finishing this unlocks…"
// banner. Download saves the picture as a PNG.
const GoalMap = (() => {
  const W = 400, H = 600;
  const KNOTS = [[200, 560], [300, 505], [110, 440], [290, 370], [120, 300], [270, 235], [170, 170], [200, 118]];
  let current = null; // { goal, svg }

  const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const isDone = t => t.status === 'Completed';

  // A smooth path through the knots (Catmull-Rom turned into cubic Béziers).
  function trailD() {
    let d = `M${KNOTS[0][0]},${KNOTS[0][1]}`;
    for (let i = 0; i < KNOTS.length - 1; i++) {
      const p0 = KNOTS[i - 1] || KNOTS[i], p1 = KNOTS[i], p2 = KNOTS[i + 1], p3 = KNOTS[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
    }
    return d;
  }

  // The milestones: phases with their step counts, or the steps themselves.
  // A long list of loose steps is bunched so the trail stays readable.
  function milestones(goal, phases, tasks) {
    const own = tasks.filter(t => t.projectId === goal.id).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    if (phases.length) {
      const list = phases.map(p => {
        const ts = tasks.filter(t => t.projectId === p.id);
        return { title: p.title, total: ts.length, done: ts.filter(isDone).length };
      });
      if (own.length) list.unshift({ title: 'Getting started', total: own.length, done: own.filter(isDone).length });
      return list;
    }
    if (own.length <= 10) return own.map(t => ({ title: t.title, total: 1, done: isDone(t) ? 1 : 0 }));
    const size = Math.ceil(own.length / 8), out = [];
    for (let i = 0; i < own.length; i += size) {
      const chunk = own.slice(i, i + size);
      out.push({ title: `${short(chunk[0].title, 18)} +${chunk.length - 1}`, total: chunk.length, done: chunk.filter(isDone).length });
    }
    return out;
  }

  function scenery() {
    return `<defs>
        <linearGradient id="gm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3f7"/><stop offset=".55" stop-color="#e9f6fd"/><stop offset="1" stop-color="#f6fbf2"/></linearGradient>
        <linearGradient id="gm-peak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8aa0b8"/><stop offset="1" stop-color="#5f7590"/></linearGradient>
        <linearGradient id="gm-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9d97a"/><stop offset="1" stop-color="#6fae45"/></linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#gm-sky)"/>
      <g fill="#fff" opacity=".85"><ellipse cx="70" cy="70" rx="34" ry="11"/><ellipse cx="92" cy="62" rx="20" ry="10"/><ellipse cx="330" cy="150" rx="30" ry="9"/></g>
      <path d="M0,300 L70,230 L130,280 L200,70 L270,250 L330,200 L400,270 L400,${H} L0,${H} Z" fill="#c7d4e2" opacity=".7"/>
      <path d="M30,${H} L200,96 L370,${H} Z" fill="url(#gm-peak)"/>
      <path d="M200,96 L232,190 L214,176 L202,198 L188,174 L170,188 Z" fill="#fff"/>
      <path d="M0,330 C80,300 140,340 210,320 C290,296 340,330 400,310 L400,${H} L0,${H} Z" fill="url(#gm-hill)"/>
      <path d="M0,470 C90,440 170,480 250,455 C320,435 370,455 400,450 L400,${H} L0,${H} Z" fill="#5f9e3a" opacity=".55"/>`;
  }

  function pinSvg(m, pt, i, isCurrent) {
    const done = m.total > 0 && m.done === m.total;
    const left = pt.x > 200;
    const tx = left ? pt.x - 20 : pt.x + 20, anchor = left ? 'end' : 'start';
    const fill = done ? '#16a34a' : isCurrent ? '#f59e0b' : '#fff';
    const stroke = done ? '#15803d' : isCurrent ? '#d97706' : '#94a3b8';
    const mark = done
      ? `<path d="M${pt.x - 5},${pt.y} l3.5,3.5 l6.5,-7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<text x="${pt.x}" y="${pt.y + 4.5}" text-anchor="middle" font-size="12" font-weight="800" fill="${isCurrent ? '#fff' : '#475569'}">${i + 1}</text>`;
    const count = m.total > 1 ? `${m.done}/${m.total} done` : done ? 'Done' : isCurrent ? 'Up next' : '';
    const label = esc(short(m.title, 24));
    return `<g><title>${esc(m.title)}</title>
      <circle cx="${pt.x}" cy="${pt.y}" r="${isCurrent ? 14 : 12}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>${mark}
      <text x="${tx}" y="${pt.y - 1}" text-anchor="${anchor}" font-size="13" font-weight="800" fill="#0f2033" paint-order="stroke" stroke="#ffffffcc" stroke-width="4" stroke-linejoin="round">${label}</text>
      ${count ? `<text x="${tx}" y="${pt.y + 14}" text-anchor="${anchor}" font-size="11" font-weight="700" fill="${done ? '#15803d' : isCurrent ? '#b45309' : '#64748b'}" paint-order="stroke" stroke="#ffffffcc" stroke-width="4" stroke-linejoin="round">${count}</text>` : ''}
    </g>`;
  }

  // A small hiker seen from behind, standing beside the current pin.
  function hikerSvg(pt) {
    const x = pt.x + (pt.x > 200 ? 18 : -18), y = pt.y - 18;
    return `<g transform="translate(${x},${y})">
      <ellipse cx="0" cy="17" rx="8" ry="2.5" fill="#000" opacity=".18"/>
      <rect x="-4.5" y="6" width="3.5" height="10" rx="1.5" fill="#334155"/><rect x="1" y="6" width="3.5" height="10" rx="1.5" fill="#334155"/>
      <rect x="-6" y="-6" width="12" height="14" rx="4" fill="#2563eb"/>
      <rect x="-5" y="-4" width="10" height="10" rx="3" fill="#b45309"/>
      <circle cx="0" cy="-10" r="5" fill="#f2c9a0"/><path d="M-5,-11 a5,5 0 0 1 10,0 z" fill="#dc2626"/>
      <line x1="7" y1="-2" x2="10" y2="16" stroke="#64748b" stroke-width="1.5" stroke-linecap="round"/>
    </g>`;
  }

  function summitSvg(goal, finished) {
    return `<g>
      <line x1="200" y1="118" x2="200" y2="64" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
      <path d="M200,64 L244,74 L200,86 Z" fill="${finished ? '#16a34a' : '#f97316'}"/>
      <text x="200" y="40" text-anchor="middle" font-size="16" font-weight="900" fill="#0f2033" paint-order="stroke" stroke="#ffffffdd" stroke-width="5" stroke-linejoin="round">${esc(short(goal.title, 30))}</text>
      <text x="200" y="56" text-anchor="middle" font-size="11" font-weight="800" fill="${finished ? '#15803d' : '#b45309'}" letter-spacing="1">${finished ? 'SUMMIT REACHED' : 'SUMMIT'}</text>
    </g>`;
  }

  // Goals waiting on this one: a padlocked gate on the far ridge.
  function nextSvg(waiting, finished) {
    if (!waiting.length) return '';
    const names = esc(short(waiting.map(g => g.title).join(', '), 30));
    const lockPath = finished
      ? '<rect x="-7" y="-1" width="14" height="10" rx="2" fill="#16a34a"/><path d="M-4,-1 v-4 a4,4 0 0 1 7.9,-1" fill="none" stroke="#16a34a" stroke-width="2"/>'
      : '<rect x="-7" y="-1" width="14" height="10" rx="2" fill="#4f46e5"/><path d="M-4,-1 v-4 a4,4 0 0 1 8,0 v4" fill="none" stroke="#4f46e5" stroke-width="2"/>';
    return `<g transform="translate(300,120)">
      <rect x="-82" y="-24" width="164" height="48" rx="14" fill="#fff" stroke="${finished ? '#bbf7d0' : '#c7d2fe'}" stroke-width="1.5" opacity=".96"/>
      <g transform="translate(-62,-2)">${lockPath}</g>
      <text x="-46" y="-5" font-size="10" font-weight="800" fill="${finished ? '#15803d' : '#4f46e5'}" letter-spacing=".6">${finished ? 'UNLOCKED' : 'UNLOCKS NEXT'}</text>
      <text x="-46" y="11" font-size="12" font-weight="800" fill="#1e1b4b">${names}</text>
    </g>`;
  }

  function lockedBaseSvg(goal) {
    if (!goal.locked) return '';
    return `<g transform="translate(200,585)">
      <rect x="-150" y="-16" width="300" height="26" rx="13" fill="#1e1b4b" opacity=".9"/>
      <text x="0" y="2" text-anchor="middle" font-size="12" font-weight="800" fill="#e0e7ff">Locked until you finish ${esc(short(goal.lockedBy.title, 24))}</text>
    </g>`;
  }

  async function open(projectId) {
    let goal;
    try {
      goal = await API.getProject(projectId);
      if (goal.parentId) goal = await API.getProject(goal.parentId);
    } catch (e) { showToast(e.message || 'Could not open the map', 'error'); return; }
    const [phases, tasks, tops] = await Promise.all([
      API.getProjects({ parentId: goal.id }).catch(() => []),
      API.getTasks().catch(() => []),
      API.getProjects({ parentId: 'null' }).then(l => l.filter(p => !isEveryday(p))).catch(() => []),
    ]);
    phases.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const ms = milestones(goal, phases, tasks);
    const waiting = tops.filter(g => g.unlockAfter === goal.id);
    const finished = ms.length > 0 && ms.every(m => m.total > 0 && m.done === m.total);
    const curIdx = ms.findIndex(m => !(m.total > 0 && m.done === m.total));
    const doneSteps = ms.reduce((n, m) => n + m.done, 0), allSteps = ms.reduce((n, m) => n + m.total, 0);

    close();
    const ov = document.createElement('div');
    ov.className = 'gm-overlay';
    ov.id = 'goal-map';
    ov.innerHTML = `<div class="gm-card" role="dialog" aria-modal="true" aria-labelledby="gm-title">
      <div class="gm-head"><span class="gl-ic">${icon('map')}</span>
        <h2 id="gm-title">${esc(goal.title)}<small>${allSteps ? `${doneSteps} of ${allSteps} steps done` : 'No steps yet'}${waiting.length ? ` · unlocks ${waiting.length} goal${waiting.length > 1 ? 's' : ''}` : ''}</small></h2>
        <button type="button" onclick="GoalMap.close()" aria-label="Close">${icon('close')}</button></div>
      <svg class="gm-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Inter, system-ui, sans-serif" role="img" aria-label="Map of ${esc(goal.title)}">
        ${scenery()}
        <path id="gm-trail" d="${trailD()}" fill="none" stroke="#e8d9b5" stroke-width="12" stroke-linecap="round"/>
        <path d="${trailD()}" fill="none" stroke="#a8916a" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>
        <path id="gm-progress" d="${trailD()}" fill="none" stroke="#f59e0b" stroke-width="4" stroke-linecap="round"/>
        <g id="gm-pins"></g>
        ${summitSvg(goal, finished)}
        ${nextSvg(waiting, finished)}
        ${lockedBaseSvg(goal)}
      </svg>
      <div class="gm-foot">
        ${waiting.length === 1 ? `<button type="button" onclick="GoalMap.close();showPage('project-detail','${waiting[0].id}')">${icon(finished ? 'unlock' : 'lock', 'tiny')}Next goal</button>` : ''}
        <button type="button" class="primary" onclick="GoalMap.download()">${icon('download', 'tiny')}Download image</button></div>
    </div>`;
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey);

    // Place the pins along the trail (it has to be in the page to measure it).
    const trail = ov.querySelector('#gm-trail');
    const len = trail.getTotalLength();
    const n = ms.length;
    const at = i => trail.getPointAtLength(len * (n === 1 ? 0.5 : 0.06 + 0.84 * (i / (n - 1))));
    const pts = ms.map((m, i) => at(i));
    const progress = ov.querySelector('#gm-progress');
    const reached = finished ? len : curIdx > 0 ? len * (0.06 + 0.84 * (curIdx / Math.max(1, n - 1))) : 0;
    progress.setAttribute('stroke-dasharray', `${reached} ${len}`);
    ov.querySelector('#gm-pins').innerHTML = n
      ? pts.map((p, i) => pinSvg(ms[i], p, i, i === curIdx)).join('') + (curIdx >= 0 ? hikerSvg(pts[curIdx]) : hikerSvg({ x: 200, y: 136 }))
      : `<text x="200" y="420" text-anchor="middle" font-size="14" font-weight="700" fill="#0f2033">Add a few steps to draw the trail</text>`;
    current = { goal, svg: ov.querySelector('svg') };
  }

  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.getElementById('goal-map')?.remove();
    document.removeEventListener('keydown', onKey);
    current = null;
  }

  // SVG → canvas → PNG, at twice the size so it stays sharp.
  function download() {
    if (!current) return;
    const xml = new XMLSerializer().serializeToString(current.svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W * 2; c.height = H * 2;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${(current?.goal.title || 'goal').replace(/[^\w ]+/g, '').trim() || 'goal'} map.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }, 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  return { open, close, download };
})();
window.GoalMap = GoalMap;
