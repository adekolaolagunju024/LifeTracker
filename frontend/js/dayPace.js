// ── TODAY'S PACE: YOU AGAINST THE PACER ─────────────────────────
// Today's plan is a timetable (backend/dayPlan.js): each task has a start
// time and a length. The Pacer keeps to it exactly, moving with the clock,
// like a pacer in a race.
// You move when you finish a task. This works out where both are and how
// far apart, in minutes. Shared by the app (js/dayRoad.js) and the tests.
//
//   You've done k tasks. The plan has the next one (k) running from
//   start(k) to end(k). Before start(k) you're ahead by the gap; inside it
//   you're on plan; after end(k) you're behind by the overrun.
//   Finishing early always counts: the Pacer never "catches up" on a task
//   you've already done.
const DayPace = (() => {
  const toMin = t => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
  const minutesText = m => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);
  const ON_PACE = 5; // within five minutes either way counts as level

  // items: [{ taskId, start: "09:30", minutes }], in time order.
  // doneIds: Set of finished task ids. now: minutes since midnight.
  // lastDoneAt: minutes since midnight when the last one was finished, if known.
  function compute(items, doneIds, now, lastDoneAt = null) {
    const list = (items || []).filter(i => i && i.start);
    const n = list.length;
    if (!n) return { n: 0, done: 0, pacer: 0, state: 'none', diff: 0, text: '' };
    const done = list.filter(i => doneIds.has(i.taskId)).length;
    const starts = list.map(i => toMin(i.start));
    const ends = list.map((i, k) => starts[k] + Number(i.minutes || 0));
    // The Pacer: how many tasks' worth of the plan the clock has covered.
    const pacer = list.reduce((s, i, k) => s + Math.min(1, Math.max(0, (now - starts[k]) / Math.max(1, ends[k] - starts[k]))), 0);
    const planEnd = ends[n - 1];
    let state, diff = 0, text;
    if (done >= n) {
      state = 'done';
      diff = lastDoneAt != null ? planEnd - lastDoneAt : 0;
      text = diff >= ON_PACE ? `Plan done ${minutesText(diff)} early` : "Today's plan is done";
    } else if (now < starts[0] && done === 0) {
      state = 'before';
      text = `Starts at ${list[0].start}`;
    } else {
      const k = done; // the task you're on, in plan order
      if (now < starts[k] - ON_PACE + 1) { state = 'ahead'; diff = starts[k] - now; }
      else if (now > ends[k] + ON_PACE - 1) { state = 'behind'; diff = now - ends[k]; }
      else { state = 'on'; diff = 0; }
      text = state === 'ahead' ? `${minutesText(diff)} ahead of plan`
        : state === 'behind' ? `${minutesText(diff)} behind plan`
          : 'On plan';
    }
    return { n, done, pacer, state, diff, text, planEnd, starts, ends };
  }
  return { compute, toMin, minutesText };
})();
if (typeof module !== 'undefined') module.exports = DayPace;
else window.DayPace = DayPace;
