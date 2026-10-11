// ── GAME SOUNDS AND HAPTICS ─────────────────────────────────────
// Short synthesised sounds (Web Audio, no files to download) and phone
// vibrations for the moments that matter: finishing a task, beating a
// blocker, levelling up, an achievement, a completed daily quest. On by
// default; the 🔊 button on the Journey and Settings → Game sounds turn
// them off (remembered on this device). Nothing plays until the person
// has interacted with the page, as browsers require.
const Sfx = (() => {
  let ctx = null;
  const enabled = () => { try { return localStorage.getItem('gameSounds') !== '0'; } catch { return true; } };
  const audio = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  // One note: a shaped oscillator with a quick attack and a smooth decay.
  function tone(c, { freq, at = 0, dur = 0.18, type = 'sine', gain = 0.18, slide = 0 }) {
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  // A short burst of filtered noise, for impacts.
  function thud(c, at = 0, gain = 0.35) {
    const t = c.currentTime + at;
    const len = Math.floor(c.sampleRate * 0.12);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const amp = c.createGain();
    src.buffer = buf;
    filter.type = 'lowpass'; filter.frequency.value = 900;
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(c.destination);
    src.start(t);
  }
  const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, A4 = 440, D5 = 587.33;
  const SOUNDS = {
    complete: c => { [C5, E5, G5].forEach((f, i) => tone(c, { freq: f, at: i * 0.07, dur: 0.22, type: 'triangle', gain: 0.16 })); tone(c, { freq: C6, at: 0.21, dur: 0.35, type: 'sine', gain: 0.12 }); },
    blocker: c => { thud(c, 0, 0.4); tone(c, { freq: 220, dur: 0.18, type: 'square', gain: 0.08, slide: 0.5 }); [G5, C6].forEach((f, i) => tone(c, { freq: f, at: 0.12 + i * 0.06, dur: 0.16, type: 'triangle', gain: 0.12 })); },
    levelup: c => { [C5, E5, G5, C6, G5, C6].forEach((f, i) => tone(c, { freq: f, at: i * 0.09, dur: i === 5 ? 0.6 : 0.16, type: i % 2 ? 'triangle' : 'square', gain: i === 5 ? 0.14 : 0.09 })); },
    achievement: c => { [E5, G5, C6].forEach((f, i) => tone(c, { freq: f, at: i * 0.11, dur: 0.5, type: 'sine', gain: 0.12 })); tone(c, { freq: C6 * 2, at: 0.33, dur: 0.4, type: 'sine', gain: 0.05 }); },
    quest: c => { [A4, D5, E5, A4 * 2].forEach((f, i) => tone(c, { freq: f, at: i * 0.08, dur: 0.3, type: 'triangle', gain: 0.13 })); },
    tap: c => tone(c, { freq: 880, dur: 0.05, type: 'sine', gain: 0.05 }),
  };
  const HAPTICS = { complete: [18, 40, 28], blocker: [35, 30, 35], levelup: [30, 50, 30, 50, 80], achievement: [20, 60, 20], quest: [25, 40, 25, 40, 60], tap: [8] };
  function play(name) {
    if (!enabled()) return;
    try { if (navigator.vibrate && HAPTICS[name]) navigator.vibrate(HAPTICS[name]); } catch { /* not supported */ }
    const c = audio();
    if (!c || !SOUNDS[name]) return;
    try { SOUNDS[name](c); } catch { /* audio unavailable */ }
  }
  function setEnabled(on) {
    try { localStorage.setItem('gameSounds', on ? '1' : '0'); } catch { /* storage off */ }
    if (on) play('tap');
  }
  return { play, enabled, setEnabled };
})();
