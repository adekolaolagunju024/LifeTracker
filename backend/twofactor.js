const crypto = require('crypto');

// Two-step sign-in with an authenticator app (Google Authenticator,
// Microsoft Authenticator, 1Password, Authy…): the standard time-based
// one-time passwords of RFC 6238 — six digits from HMAC-SHA1 over 30-second
// steps of a shared secret. Plus single-use recovery codes, stored only as
// hashes, for when the phone is lost.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32Encode(crypto.randomBytes(20));
const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

function codeForStep(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const n = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, '0');
}

// Accepts the code for the current step or one either side (clock drift),
// but never a step at or before `lastStep`, so a code can't be replayed.
// Returns the matching step, or null.
function verifyCode(secret, code, lastStep = null, now = Date.now()) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean) || !secret) return null;
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = codeForStep(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

function otpauthUrl(secret, accountEmail) {
  const label = encodeURIComponent(`Waypoint:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Waypoint&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// Ten codes like "k7m2-9qpx", shown once; only their hashes are kept.
const hashRecovery = code => crypto.createHash('sha256').update(String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
function newRecoveryCodes(count = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(8);
    const chars = [...bytes].map(b => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

module.exports = { newSecret, codeForStep, verifyCode, otpauthUrl, newRecoveryCodes, hashRecovery, stepAt, base32Encode, base32Decode };
