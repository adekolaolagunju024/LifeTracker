/* global API, APP, Sfx, showToast, esc, celebrationsEnabled, fireBigScreenConfetti, announceJourneyReward, openJourneyTrophyCase */
// ── GAME LAYER UI ───────────────────────────────────────────────
// The visible side of backend/journey.js: a floating "+XP" chip when
// something pays out, a full-screen level-up moment with the new rank,
// today's three quests (dashboard card, Journey badge, Trophy Case) and
// the game-sound switches. Sounds come from js/sfx.js.

// "+15 XP" rising from the bottom of the screen.
// Focus mode (Settings) hides the game layer; see the stylesheet too.
function focusModeOn() { return document.documentElement.classList.contains('focus-mode'); }
function toggleFocusMode() {
  const on = !focusModeOn();
  document.documentElement.classList.toggle('focus-mode', on);
  try { localStorage.setItem('focusMode', on ? '1' : '0'); } catch { /* storage off */ }
  syncFocusModeButton();
  syncSoundButtons();
  showToast(on ? '🧘 Focus mode on: the game layer is hidden' : '🎮 Focus mode off: XP, quests and trophies are back');
}
function syncFocusModeButton() {
  const sw = document.getElementById('focus-mode-btn');
  if (sw) { sw.classList.toggle('on', focusModeOn()); sw.setAttribute('aria-checked', String(focusModeOn())); }
}
document.addEventListener('DOMContentLoaded', syncFocusModeButton);

function floatXp(amount, note) {
  if (!amount || focusModeOn()) return;
  const chip = document.createElement('div');
  chip.className = 'xp-float';
  chip.setAttribute('aria-hidden', 'true');
  chip.innerHTML = `+${amount} XP${note ? `<small>${esc(note)}</small>` : ''}`;
  document.body.appendChild(chip);
  setTimeout(() => chip.remove(), 1900);
}

// The level-up moment: big number, the rank (and a "new rank" ribbon when
// it changes), a fanfare and confetti. Tap anywhere or wait to close.
// Never over a running focus timer: it waits until the session ends, so
// a celebration doesn't cover the work it's celebrating.
let pendingLevelUp = null;
const timerRunning = () => !!document.querySelector('#focus-hud:not(.is-done)');
function showLevelUp(reward) {
  if (focusModeOn()) return;
  if (timerRunning()) {
    const waiting = pendingLevelUp;
    pendingLevelUp = reward;
    if (!waiting) {
      const check = setInterval(() => {
        if (timerRunning()) return;
        clearInterval(check);
        const r = pendingLevelUp; pendingLevelUp = null;
        if (r) showLevelUp(r);
      }, 2000);
    }
    return;
  }
  Sfx.play('levelup');
  document.getElementById('levelup-overlay')?.remove();
  const el = document.createElement('div');
  el.id = 'levelup-overlay';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="levelup-card">
      <p class="levelup-kicker">Level up!</p>
      <p class="levelup-level">${reward.level}</p>
      <p class="levelup-rank">${emojiIcon(reward.rank.icon)} ${esc(reward.rank.name)}</p>
      ${reward.rankChanged ? '<p class="levelup-new">New rank unlocked</p>' : ''}
      <p class="levelup-hint">Tap to keep going</p>
    </div>`;
  // While the Journey is on screen, a compact banner at the top instead
  // of the full-screen moment, so it never hides the scene's own action
  // (a blocker going down, the walk to the next flag).
  const journeyOnScreen = APP.currentPage === 'gantt' && !document.getElementById('gantt-journey-view')?.classList.contains('hidden');
  if (journeyOnScreen) {
    el.classList.add('is-compact');
    el.querySelector('.levelup-card').innerHTML = `<p class="levelup-level">${reward.level}</p><div><p class="levelup-kicker">Level up!</p><p class="levelup-rank">${emojiIcon(reward.rank.icon)} ${esc(reward.rank.name)}${reward.rankChanged ? ' · new rank' : ''}</p></div>`;
  }
  document.body.appendChild(el);
  if (celebrationsEnabled() && !journeyOnScreen) fireBigScreenConfetti();
  const close = () => el.remove();
  el.addEventListener('click', close);
  setTimeout(close, journeyOnScreen ? 3000 : 4200);
}

// Today's quests, wherever they show.
function renderDailyQuests(quests, opts = {}) {
  if (!quests) return;
  const done = quests.filter(q => q.done).length;
  const badge = document.getElementById('journey-quest-badge');
  if (badge) {
    badge.textContent = `${done}/${quests.length}`;
    badge.classList.remove('hidden'); badge.classList.add('flex');
    badge.title = done === quests.length ? "All of today's quests are done!" : "Today's quests";
  }
  lastQuests = { quests, bonusXp: opts.bonusXp || 30 };
  paintQuestLine();
}
// On the dashboard, today's quests are one line in the Journey tile; the
// Trophy Case has them in full.
let lastQuests = null;
function paintQuestLine() {
  const el = document.getElementById('dash-quest-line');
  if (!el || !lastQuests) return;
  const { quests, bonusXp } = lastQuests;
  const done = quests.filter(q => q.done).length;
  const nextQ = quests.find(q => !q.done);
  el.innerHTML = `<button type="button" class="quest-line" onclick="openJourneyTrophyCase()" title="Today's quests">
    ${icon('goal')}<span class="min-w-0 truncate">${done === quests.length ? `All quests done · +${bonusXp} XP` : `Quest: ${esc(nextQ.text)}`}</span>
    <span class="quest-dots" aria-label="${done} of ${quests.length} done">${quests.map(q => `<i class="${q.done ? 'on' : ''}"></i>`).join('')}</span>
  </button>`;
}
async function loadDailyQuests() {
  try {
    const g = await API.getJourneyGaming();
    renderDailyQuests(g.daily.quests, g.daily);
    return g;
  } catch { return null; }
}

// Sound switches: the 🔊 button on the Journey and Settings → Game sounds.
function syncSoundButtons() {
  const on = Sfx.enabled();
  const btn = document.getElementById('journey-sound-btn');
  if (btn) { btn.innerHTML = icon(on ? 'volume' : 'volume-x'); btn.setAttribute('aria-label', on ? 'Turn game sounds off' : 'Turn game sounds on'); btn.setAttribute('aria-pressed', String(on)); }
  const sw = document.getElementById('game-sounds-btn');
  if (sw) { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); }
}
function toggleGameSounds() {
  Sfx.setEnabled(!Sfx.enabled());
  syncSoundButtons();
  showToast(Sfx.enabled() ? '🔊 Game sounds on' : '🔇 Game sounds off');
}

// Ticking off a blocker anywhere (Journey, board, task panel, assistant)
// plays the knockout sound and announces any reward it earned.
{
  const update = API.updateObstacle;
  API.updateObstacle = async (id, changes) => {
    const result = await update(id, changes);
    if (changes && changes.resolved === true) Sfx.play('blocker');
    if (result && result.journeyReward) announceJourneyReward(result.journeyReward);
    return result;
  };
}

document.addEventListener('DOMContentLoaded', syncSoundButtons);
syncSoundButtons();
