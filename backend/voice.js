// ── NATURAL VOICE ───────────────────────────────────────────────
// The assistant reading aloud in a natural, human-sounding voice instead
// of the device's built-in one. The text goes to a speech service and
// comes back as audio; without a key the app keeps using the device voice.
//
// Settings (either one; ElevenLabs is used when both are set):
//   ELEVENLABS_API_KEY  elevenlabs.io → Profile → API keys
//   OPENAI_API_KEY      platform.openai.com → API keys (OPENAI_TTS_MODEL
//                       optional, default gpt-4o-mini-tts)
//
// Each person can have up to DAILY_CHARS characters read a day, so a
// loop or a long chat can't run up the bill, and the same line in the
// same voice (the preview, "Let's go") is served from a small cache.

const DAILY_CHARS = Number(process.env.VOICE_DAILY_CHARS) || 12000;
const MAX_TEXT = 1500;

const ELEVEN = [
  { id: 'george', label: 'George · warm, British', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
  { id: 'daniel', label: 'Daniel · calm, British', voiceId: 'onwK4e9ZLuTAKqWW03F9' },
  { id: 'alice', label: 'Alice · clear, British', voiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  { id: 'lily', label: 'Lily · gentle, British', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  { id: 'brian', label: 'Brian · deep, American', voiceId: 'nPczCjzI2devNBz1zQrb' },
];
const OPENAI = [
  { id: 'onyx', label: 'Onyx · deep, steady' },
  { id: 'fable', label: 'Fable · warm, British' },
  { id: 'sage', label: 'Sage · calm' },
  { id: 'coral', label: 'Coral · bright' },
  { id: 'nova', label: 'Nova · friendly' },
];

function provider() {
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}
const voicesFor = p => (p === 'elevenlabs' ? ELEVEN : p === 'openai' ? OPENAI : []);

function info() {
  const p = provider();
  return { available: !!p, provider: p, voices: voicesFor(p).map(({ id, label }) => ({ id, label })) };
}

// Per person per day, in memory: resets on a deploy, which only ever
// errs towards letting someone hear more.
const used = new Map();
function charge(userId, n) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${userId}:${day}`;
  const so = used.get(key) || 0;
  if (so + n > DAILY_CHARS) return false;
  used.set(key, so + n);
  if (used.size > 5000) for (const k of used.keys()) { if (!k.endsWith(day)) used.delete(k); }
  return true;
}

const cache = new Map(); // `${provider}:${voice}:${text}` -> Buffer, newest last
function remember(key, buf) {
  cache.delete(key);
  cache.set(key, buf);
  while (cache.size > 80) cache.delete(cache.keys().next().value);
}

// Returns an MP3 Buffer. Throws with .status for the route to pass on.
async function speak(userId, text, voiceId) {
  const p = provider();
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (!p) throw fail(503, 'Natural voice is not set up on this server');
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!clean) throw fail(400, 'Nothing to read');
  const voices = voicesFor(p);
  const voice = voices.find(v => v.id === voiceId) || voices[0];
  const key = `${p}:${voice.id}:${clean}`;
  if (cache.has(key)) { const buf = cache.get(key); remember(key, buf); return buf; }
  if (!charge(userId, clean.length)) throw fail(429, "That's today's natural-voice allowance used. The device voice takes over until tomorrow.");

  let res;
  if (p === 'elevenlabs') {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: clean, model_id: process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
  } else {
    res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: voice.id, input: clean, response_format: 'mp3', instructions: 'Speak like a calm, encouraging personal assistant: warm, clear and unhurried.' }),
    });
  }
  if (!res.ok) {
    console.error(`Voice (${p}) failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    throw fail(502, 'The voice service did not answer');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  remember(key, buf);
  return buf;
}

module.exports = { info, speak, DAILY_CHARS };
