const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// backend/voice.js with the speech service stubbed out.
const voice = require('../backend/voice');
let calls = [];
beforeEach(() => {
  calls = [];
  delete process.env.ELEVENLABS_API_KEY; delete process.env.OPENAI_API_KEY;
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, arrayBuffer: async () => new TextEncoder().encode('MP3').buffer }; };
});

test('without a key there is no natural voice, and speaking says so', async () => {
  assert.deepEqual(voice.info(), { available: false, provider: null, voices: [] });
  await assert.rejects(voice.speak('u1', 'Hello', 'george'), e => e.status === 503);
});

test('ElevenLabs is used when its key is set, with the chosen voice', async () => {
  process.env.ELEVENLABS_API_KEY = 'el-key'; process.env.OPENAI_API_KEY = 'oa-key';
  const info = voice.info();
  assert.equal(info.provider, 'elevenlabs');
  assert.ok(info.voices.some(v => v.id === 'george'));
  assert.ok(!JSON.stringify(info).includes('el-key'), 'the key never leaves the server');
  const audio = await voice.speak('u2', 'Good morning, here is your day.', 'daniel');
  assert.equal(audio.toString(), 'MP3');
  assert.match(calls[0].url, /api\.elevenlabs\.io\/v1\/text-to-speech\/onwK4e9ZLuTAKqWW03F9/);
  assert.equal(calls[0].opts.headers['xi-api-key'], 'el-key');
});

test('OpenAI is used when only its key is set; an unknown voice gets the first one', async () => {
  process.env.OPENAI_API_KEY = 'oa-key';
  await voice.speak('u3', 'Time for the next task.', 'nobody');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/speech');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.voice, 'onyx');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer oa-key');
});

test('the same line in the same voice is not paid for twice, and there is a daily limit', async () => {
  process.env.OPENAI_API_KEY = 'oa-key';
  await voice.speak('u4', 'Same line.', 'nova');
  await voice.speak('u4', 'Same line.', 'nova');
  assert.equal(calls.length, 1);
  const long = 'x'.repeat(1400);
  let i = 0;
  await assert.rejects(async () => { while (i < 100) await voice.speak('u5', `${long}${i++}`, 'nova'); }, e => e.status === 429);
  assert.ok(calls.length - 1 <= Math.ceil(voice.DAILY_CHARS / 1400));
});

test('empty text is refused', async () => {
  process.env.OPENAI_API_KEY = 'oa-key';
  await assert.rejects(voice.speak('u6', '   ', 'nova'), e => e.status === 400);
});
