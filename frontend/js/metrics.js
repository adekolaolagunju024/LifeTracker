/* global API, esc, showToast */
// ── OWNER METRICS ───────────────────────────────────────────────
// The numbers that say whether Wayrise is working as a business: are
// people signing up, getting to a finished task, and coming back? Only the
// owner sees the sidebar link (GET /api/admin/me); the data is counts only
// (backend/metrics.js). Charts are plain HTML/SVG in the house teal, each
// with hover details and a table view.
const Metrics = (() => {
  const fmtDay = isoStr => new Date(isoStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const pctText = (n, of) => (of ? `${Math.round(n / of * 100)}%` : '—');

  // Shows the Metrics link for the owner only.
  async function initNav() {
    try {
      const { owner } = await API.getAdminMe();
      document.getElementById('nav-metrics').classList.toggle('hidden', !owner);
    } catch { /* not the owner, or offline */ }
  }

  function tile(label, value, sub, hint) {
    return `<div class="metric-tile" ${hint ? `title="${esc(hint)}"` : ''}>
      <p class="metric-label">${esc(label)}</p>
      <p class="metric-value">${value}</p>
      ${sub ? `<p class="metric-sub">${sub}</p>` : ''}
    </div>`;
  }

  // One series of weekly bars: 12 weeks, newest on the right.
  function barChart(id, title, weeks, key, unit) {
    const values = weeks.map(w => w[key]);
    const max = Math.max(1, ...values);
    const nice = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
    const W = 600, H = 180, padL = 28, padB = 22, padT = 8;
    const plotW = W - padL - 6, plotH = H - padB - padT;
    const slot = plotW / values.length, barW = Math.max(6, slot - 6);
    const y = v => padT + plotH - (v / nice) * plotH;
    const grid = [0, nice / 2, nice].map(v => `<line x1="${padL}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" class="metric-grid"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="metric-axis">${Math.round(v)}</text>`).join('');
    const bars = values.map((v, i) => {
      const x = padL + i * slot + (slot - barW) / 2;
      const h = Math.max(v ? 2 : 0, plotH - (y(v) - padT));
      const r = Math.min(4, barW / 2, h);
      const top = padT + plotH - h;
      // Rounded at the data end only, square on the baseline.
      const path = h ? `M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z` : '';
      const label = `Week to ${fmtDay(weeks[i].end)}: ${v} ${unit}`;
      return `<g class="metric-bar" tabindex="0" data-tip="${esc(label)}" aria-label="${esc(label)}">
        <rect x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent"/>
        ${path ? `<path d="${path}"/>` : ''}
      </g>`;
    }).join('');
    const ticks = weeks.map((w, i) => (i % 3 === 2 || i === weeks.length - 1) ? `<text x="${padL + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle" class="metric-axis">${esc(fmtDay(w.end))}</text>` : '').join('');
    return `<figure class="metric-card" id="${id}">
      <figcaption class="metric-card-title">${esc(title)} <span>last 12 weeks</span></figcaption>
      <svg viewBox="0 0 ${W} ${H}" class="metric-svg" role="img" aria-label="${esc(title)}, last 12 weeks. Latest week: ${values[values.length - 1]}.">${grid}${bars}${ticks}</svg>
      <details class="metric-table"><summary>Show as a table</summary>
        <table><thead><tr><th>Week ending</th><th>${esc(unit)}</th></tr></thead><tbody>${weeks.map(w => `<tr><td>${esc(fmtDay(w.end))}</td><td>${w[key]}</td></tr>`).join('')}</tbody></table>
      </details>
    </figure>`;
  }

  function funnel(steps) {
    const top = Math.max(1, steps[0].count);
    return `<div class="metric-card">
      <p class="metric-card-title">From sign-up to habit <span>people who joined 1 to 90 days ago</span></p>
      <div class="metric-funnel">${steps.map(s => `
        <div class="metric-funnel-row" title="${esc(`${s.step}: ${s.count} of ${s.of}`)}">
          <span class="metric-funnel-label">${esc(s.step)}</span>
          <span class="metric-funnel-track"><span style="width:${Math.round(s.count / top * 100)}%"></span></span>
          <span class="metric-funnel-num">${s.of ? `${s.count} <small>${pctText(s.count, s.of)}${s.of !== steps[0].count ? ` of ${s.of}` : ''}</small>` : '<small>not yet</small>'}</span>
        </div>`).join('')}
      </div>
      <p class="metric-note">Week 2 and week 4 only count people who joined long enough ago to have reached them.</p>
    </div>`;
  }

  // Cohort retention: rows are sign-up weeks, columns weeks since joining,
  // cells shaded light to dark teal by the share still active.
  function cohorts(rows) {
    const step = v => (v === null ? '' : v >= 60 ? 's5' : v >= 40 ? 's4' : v >= 25 ? 's3' : v >= 10 ? 's2' : 's1');
    return `<div class="metric-card">
      <p class="metric-card-title">Who keeps coming back <span>share of each sign-up week active in later weeks</span></p>
      <div class="metric-cohort-wrap"><table class="metric-cohort">
        <thead><tr><th scope="col">Joined week of</th><th scope="col">People</th>${[...Array(8)].map((_, w) => `<th scope="col">Wk ${w}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr><th scope="row">${esc(fmtDay(r.start))}</th><td>${r.size}</td>${r.weeks.map((v, w) =>
          `<td class="${step(v)}" ${v === null ? '' : `title="${esc(`${v}% of the ${fmtDay(r.start)} group were active in week ${w}`)}"`}>${v === null ? '' : v + '%'}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
      <p class="metric-note">Week 0 is the week they joined. Blank cells are weeks that haven't happened yet.</p>
    </div>`;
  }

  // Is the service safe to run: each safety system on or off, with what
  // to set on the host when it's off, and how the last backup went.
  function service(s) {
    if (!s) return '';
    const b = s.lastBackup;
    const ageH = b ? (Date.now() - new Date(b.at).getTime()) / 3600000 : null;
    const backupOk = b && b.ok && ageH < 30;
    const rows = [
      [s.dataVolume, 'Data on a persistent volume', 'Set DB_PATH to a file on a mounted volume, e.g. /data/lifetracker.sqlite.'],
      [s.offsiteBackups, 'Off-site backups', 'Set the BACKUP_S3_* variables (an R2 or S3 bucket). Until then backups stay on the same volume as the data.'],
      [backupOk, b ? `Last backup ${new Date(b.at).toLocaleString()}${b.offsite ? ', sent off-site' : ''}` : 'No backup yet', b && !b.ok ? `It failed: ${b.error}` : (b ? 'Over a day old. Check the logs for the 03:30 job.' : 'One runs at 03:30 each night, and a few minutes after a deploy.')],
      [s.errorTracking, 'Error tracking (Sentry)', 'Set SENTRY_DSN so crashes and failed backups reach you.'],
      [s.email, 'Email (Resend)', 'Set RESEND_API_KEY so password resets, verification and invites are emailed.'],
      [s.payments, 'Payments (Stripe)', 'Set STRIPE_SECRET_KEY and STRIPE_PRICE_MONTHLY when you are ready to charge.'],
    ];
    const off = rows.filter(r => !r[0]).length;
    return `<div class="metric-card">
      <p class="metric-card-title">Service <span>${off ? `${off} to set up` : 'all set up'}</span></p>
      <ul class="svc-list">${rows.map(([ok, name, fix]) => `<li class="${ok ? 'ok' : 'off'}">${icon(ok ? 'check' : 'warning', 'tiny')}<div><b>${esc(name)}</b>${ok ? '' : `<small>${esc(fix)}</small>`}</div></li>`).join('')}</ul>
    </div>`;
  }

  async function render() {
    const box = document.getElementById('metrics-body');
    box.innerHTML = '<p class="text-sm text-gray-400 py-10 text-center">Counting…</p>';
    let m;
    try { m = await API.getAdminMetrics(); } catch (e) {
      box.innerHTML = `<p class="text-sm text-red-500 py-10 text-center">${esc(e.message || 'Could not load the metrics')}</p>`;
      return;
    }
    const h = m.headline, e = m.engagement;
    const diff = h.signups7 - h.signupsPrev7;
    document.getElementById('metrics-updated').textContent = `Updated ${new Date(m.generatedAt).toLocaleString()}`;
    box.innerHTML = `${service(m.service)}
      <div class="metric-tiles">
        ${tile('People signed up', h.users, `${h.signups7} this week · ${diff >= 0 ? '+' : ''}${diff} vs last week`)}
        ${tile('Active this week', h.active7, `${h.active30} in the last 30 days`, 'Used the app on at least one day')}
        ${tile('Activation', h.activation.rate === null ? '—' : h.activation.rate + '%', h.activation.of ? `finished a task in their first week · of ${h.activation.of}` : 'needs people who joined 7+ days ago', 'Of people who joined 7–90 days ago')}
        ${tile('Week-4 retention', h.week4.rate === null ? '—' : h.week4.rate + '%', h.week4.of ? `still active in week 4 · of ${h.week4.of}` : 'needs people who joined 28+ days ago')}
        ${tile('Visit → sign-up', h.landing.rate === null ? '—' : h.landing.rate + '%', h.landing.rate === null ? `Counting visits${h.landing.since ? ' since ' + fmtDay(h.landing.since) : ''} · ${h.landing.views30} so far` : `${h.landing.signups30} sign-ups from ${h.landing.views30} landing visits (30 days)`, 'Landing-page visits, crawlers skipped. Shown once there are at least 20.')}
        ${tile('Paying customers', h.pro === null ? '—' : h.pro, h.pro === null ? 'Payments aren’t set up yet' : 'on Wayrise Pro')}
      </div>
      <div class="metric-grid2">
        ${barChart('metric-signups', 'New sign-ups per week', m.weeks, 'signups', 'sign-ups')}
        ${barChart('metric-active', 'Weekly active people', m.weeks, 'active', 'active people')}
      </div>
      ${funnel(m.funnel)}
      ${cohorts(m.cohorts)}
      <div class="metric-card">
        <p class="metric-card-title">This week in the app <span>last 7 days, everyone</span></p>
        <div class="metric-tiles small">
          ${tile('Goals created', e.goals7)}
          ${tile('Tasks finished', e.tasksDone7)}
          ${tile('Blockers beaten', e.blockersBeaten7)}
          ${tile('Reminders set', e.remindersSet7)}
          ${tile('Alarms answered', e.alarmsAnswered7)}
          ${tile('AI requests', e.aiCalls7, e.aiCalls7 && h.active7 ? `${(e.aiCalls7 / h.active7).toFixed(1)} per active person` : '')}
          ${tile('Invites sent', e.invites7)}
        </div>
      </div>
      ${features(m.features, h.active30)}
      <div id="metrics-feedback"></div>
      <p class="metric-note">Counts only: apart from the problem reports people chose to send, this page never shows who anyone is. "Active" means they used the app that day. Day-by-day activity is recorded from today, so the first weeks lean on finished tasks.</p>`;
    wireTips(box);
    if (window.Feedback) Feedback.renderOwnerList(document.getElementById('metrics-feedback'));
  }

  // Which features people use: of the people active in the last 30 days,
  // how many used each one. The ones near the bottom are the candidates to
  // hide or cut.
  function features(list, active30) {
    if (!list || !list.length) return '';
    return `<div class="metric-card">
      <p class="metric-card-title">Feature use <span>last 30 days, share of the ${active30} active ${active30 === 1 ? 'person' : 'people'}</span></p>
      <div class="feat-use">${list.map(f => `<div class="feat-row ${f.share !== null && f.share < 5 ? 'low' : ''}">
        <span class="feat-name">${esc(f.label)}</span>
        <span class="feat-bar" aria-hidden="true"><i style="width:${f.share || 0}%"></i></span>
        <span class="feat-num">${f.share === null ? '—' : f.share + '%'} <small>${f.people}</small></span>
      </div>`).join('')}</div>
      <p class="metric-note" style="margin-top:8px">Recorded from today, once a day per person. Under 5% after a few weeks (shown faded) means hide it or cut it.</p>
    </div>`;
  }

  // A small tooltip that follows the hovered or focused bar.
  function wireTips(root) {
    let tip = document.getElementById('metric-tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'metric-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    const show = el => {
      tip.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect();
      tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(8, r.top - tip.offsetHeight - 6) + 'px';
      tip.classList.add('on');
      root.querySelectorAll('.metric-bar.is-hot').forEach(b => b.classList.remove('is-hot'));
      el.classList.add('is-hot');
    };
    const hide = () => { tip.classList.remove('on'); root.querySelectorAll('.metric-bar.is-hot').forEach(b => b.classList.remove('is-hot')); };
    root.querySelectorAll('.metric-bar').forEach(el => {
      el.addEventListener('mouseenter', () => show(el));
      el.addEventListener('focus', () => show(el));
      el.addEventListener('mouseleave', hide);
      el.addEventListener('blur', hide);
      el.addEventListener('click', () => show(el));
    });
  }

  return { initNav, render, refresh: () => render().then(() => showToast('📈 Metrics refreshed')) };
})();
window.Metrics = Metrics;
