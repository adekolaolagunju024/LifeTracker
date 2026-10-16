// ── TASK ACTIONS ────────────────────────────────────────────────
// What a task is for, so StartLine can open the right app when its turn
// comes (frontend/js/taskActions.js builds the link): an email, a
// WhatsApp message, a call or text, a meeting, directions, a booking or
// any web link. Stored on the task as JSON; this keeps only known kinds
// and fields, of sensible lengths, and links that are https.
const TYPES = ['email', 'whatsapp', 'call', 'sms', 'meeting', 'directions', 'book', 'link'];
const BOOK = ['table', 'flight', 'taxi', 'hotel'];
const FIELDS = { to: 300, phone: 40, subject: 200, body: 2000, place: 200, from: 200, people: 500 };

function clean(action) {
  if (action === null || action === undefined || action === '') return null;
  if (typeof action !== 'object' || Array.isArray(action)) throw new Error('An action looks like { type: "email", to: "…" }');
  const type = String(action.type || '');
  if (!TYPES.includes(type)) throw new Error(`An action is one of: ${TYPES.join(', ')}`);
  const out = { type };
  for (const [k, max] of Object.entries(FIELDS)) {
    if (action[k] === undefined || action[k] === null || action[k] === '') continue;
    const v = String(action[k]).trim();
    if (v.length > max) throw new Error(`That ${k} is too long`);
    if (v) out[k] = v;
  }
  if (out.phone && !/^[+\d][\d\s().-]{2,}$/.test(out.phone)) throw new Error('A phone number is digits, with + for the country code');
  if (type === 'book') out.kind = BOOK.includes(action.kind) ? action.kind : 'table';
  if (action.url) {
    const url = String(action.url).trim();
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 1000) throw new Error('A link must start with https://');
    out.url = url;
  }
  if (type === 'link' && !out.url) throw new Error('A link action needs the link');
  return out;
}
function parse(stored) {
  if (!stored) return null;
  try { return clean(JSON.parse(stored)); } catch { return null; }
}

module.exports = { clean, parse, TYPES };
