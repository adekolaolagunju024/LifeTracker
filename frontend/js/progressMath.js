// How far along a plan is, weighted by how big each task is.
// Shared by the app (loaded as a plain script: window.ProgressMath) and the
// server's reports (require('../../frontend/js/progressMath')), so the two
// can never disagree.
//
// Counting tasks treats a one-hour job and a three-week one the same, so
// a plan of many small tasks looked further along than it was. Instead
// each task weighs its planned length in days (1 to 90; tasks with no
// dates weigh the average of the dated ones), and earns credit:
//   Completed           → all of its weight
//   has a target count  → its share of the target (e.g. 12 of 20 pages)
//   otherwise           → nothing yet
// "Expected by now" uses the same weights: each task's share of its own
// planned window that has already passed. So ahead/behind compares actual
// progress against the schedule like for like.
(function (root) {
  const DAY = 86400000;
  const MAX_DAYS = 90;
  const ms = d => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').getTime() : NaN);

  function plannedDays(t) {
    const s = ms(t.startDate), e = ms(t.endDate);
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
    return Math.min(MAX_DAYS, Math.round((e - s) / DAY) + 1);
  }
  function weights(tasks) {
    const dated = tasks.map(plannedDays);
    const known = dated.filter(d => d !== null);
    const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    return dated.map(d => (d === null ? fallback : d));
  }
  function credit(t) {
    if (t.status === 'Completed') return 1;
    if (t.targetCount > 0) return Math.max(0, Math.min(1, (t.progressCount || 0) / t.targetCount));
    return 0;
  }
  // 0–1 share of the plan's weight that is done.
  function progressFraction(tasks) {
    if (!tasks || !tasks.length) return 0;
    const w = weights(tasks);
    const total = w.reduce((a, b) => a + b, 0);
    return total ? tasks.reduce((sum, t, i) => sum + w[i] * credit(t), 0) / total : 0;
  }
  function progressPct(tasks) {
    const f = progressFraction(tasks);
    // Never round up to 100% before everything is actually done.
    const p = Math.round(f * 100);
    return p === 100 && tasks.some(t => t.status !== 'Completed') ? 99 : p;
  }
  // 0–1 share of the plan's weight the schedule says should be done by
  // `now`, or null when there aren't enough dates to say.
  function expectedFraction(tasks, fallbackStart, now = Date.now()) {
    if (!tasks || !tasks.some(t => t.endDate)) return null;
    const w = weights(tasks);
    let total = 0, due = 0;
    tasks.forEach((t, i) => {
      const e = ms(t.endDate);
      if (Number.isNaN(e)) return;
      let s = ms(t.startDate || fallbackStart);
      if (Number.isNaN(s) || s > e) s = e;
      total += w[i];
      if (now >= e + DAY / 2) due += w[i];
      else if (now > s) due += w[i] * ((now - s) / (e + DAY / 2 - s));
    });
    return total ? Math.max(0, Math.min(1, due / total)) : null;
  }

  const api = { progressFraction, progressPct, expectedFraction, plannedDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProgressMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
