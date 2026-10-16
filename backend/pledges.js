const crypto = require('crypto');
const db = require('./db/connection');
const { getTransporter } = require('./email/mailer');
const { wrapEmailHtml, sendActivityEmail } = require('./email/activity');

// ── REWARD PLEDGES ──────────────────────────────────────────────
// Someone who believes in you promises a reward for finishing a goal:
// cash, or anything else ("dinner at your favourite place", "a day off",
// "the new boots"). Anyone with the goal's pledge link can make one, no
// account needed; the goal's owner can also add one themselves (a promise
// made in person). Each moves pledged → earned (the goal is finished, or
// finished by the date they set) → given. Missed if a date passes first,
// withdrawn if the pledger takes it back.
//
// StartLine never holds or moves money. Cash is settled between them.

// A pledger can also hold the gift itself in the app: a ticket or voucher
// code, a link (an e-ticket, a gift card) and a note. It stays hidden from
// the goal's owner until the pledger checks their progress and releases
// it. For cash, once it's earned the owner says how they'd like it sent
// (a payment link, or details), which only the pledger sees; the pledger
// sends it and releases. The two of them have their own thread.
for (const col of ['giftCode TEXT', 'giftLink TEXT', 'giftNote TEXT', 'payTo TEXT', 'receivedAt TEXT', 'releaseAskedAt TEXT']) {
  try { db.exec(`ALTER TABLE pledges ADD COLUMN ${col}`); } catch { /* already there */ }
}
db.exec(`CREATE TABLE IF NOT EXISTS pledge_messages (
  id TEXT PRIMARY KEY,
  pledgeId TEXT NOT NULL REFERENCES pledges(id) ON DELETE CASCADE,
  fromOwner INTEGER NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_pledge_messages ON pledge_messages (pledgeId, createdAt)');

const RELATIONS = ['parent', 'family', 'partner', 'friend', 'boss', 'coach', 'teacher', 'mentor', 'sponsor', 'other'];
const CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD', 'INR'];
const SYMBOL_TO_CODE = { '£': 'GBP', '$': 'USD', '€': 'EUR', '₦': 'NGN', '₵': 'GHS', 'KSh': 'KES', R: 'ZAR', '₹': 'INR' };
const token = () => crypto.randomBytes(18).toString('base64url');
const now = () => new Date().toISOString();
const todayKey = () => new Date().toISOString().slice(0, 10);
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function money(amount, currency) {
  if (amount == null) return '';
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100); } catch { return `${(amount / 100).toFixed(2)} ${currency}`; }
}
// "£50", "£50 and dinner out", or "Dinner out".
function rewardText(p) {
  const cash = p.kind === 'cash' || p.amount != null ? money(p.amount, p.currency) : '';
  return [cash, p.reward].filter(Boolean).join(' and ') || 'A reward';
}
function defaultCurrency(ownerId) {
  const row = db.prepare('SELECT currency FROM profile WHERE userId = ?').get(ownerId);
  const sym = row && row.currency;
  return CURRENCIES.includes(sym) ? sym : SYMBOL_TO_CODE[sym] || 'GBP';
}

// What someone typed into the pledge form (or the owner's "add one"),
// cleaned. Throws with a message fit to show them.
function clean(body = {}) {
  const name = clip(body.name, 60);
  if (!name) throw new Error('Add your name so they know who it is from');
  const relation = RELATIONS.includes(body.relation) ? body.relation : 'other';
  const currency = CURRENCIES.includes(body.currency) ? body.currency : 'GBP';
  const rawAmount = String(body.amount ?? '').replace(/[^\d.]/g, '');
  const amount = rawAmount ? Math.round(Number(rawAmount) * 100) : null;
  if (amount != null && (!Number.isFinite(amount) || amount <= 0 || amount > 100000000)) throw new Error('Enter an amount, or leave it blank for a non-cash reward');
  const reward = clip(body.reward, 140);
  if (amount == null && !reward) throw new Error('Say what the reward is: an amount, something else, or both');
  const condition = body.condition === 'by_date' ? 'by_date' : 'finish';
  const byDate = condition === 'by_date' ? String(body.byDate || '').slice(0, 10) : null;
  if (condition === 'by_date' && !/^\d{4}-\d{2}-\d{2}$/.test(byDate || '')) throw new Error('Pick the date it needs to be finished by');
  if (condition === 'by_date' && byDate < todayKey()) throw new Error('That date has already passed');
  const email = clip(body.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address doesn’t look right');
  // the held gift: all optional, and a link must be a web address
  const giftLink = clip(body.giftLink, 500);
  if (giftLink && !/^https:\/\/[^\s]+$/i.test(giftLink)) throw new Error('The gift link should start with https://');
  return {
    name, relation, kind: amount != null ? 'cash' : 'other', amount, currency: amount != null ? currency : null, reward, message: clip(body.message, 400), condition, byDate, email: email || null,
    giftCode: clip(body.giftCode, 120) || null, giftLink: giftLink || null, giftNote: clip(body.giftNote, 400) || null,
  };
}

// ── Links ──
function getLink(projectId) { return db.prepare('SELECT token, createdAt FROM pledge_links WHERE projectId = ?').get(projectId) || null; }
function createLink(projectId) {
  const existing = getLink(projectId);
  if (existing) return existing;
  const row = { token: token(), createdAt: now() };
  db.prepare('INSERT INTO pledge_links (projectId, token, createdAt) VALUES (?,?,?)').run(projectId, row.token, row.createdAt);
  return row;
}
function deleteLink(projectId) { db.prepare('DELETE FROM pledge_links WHERE projectId = ?').run(projectId); }

// ── The goal ──
// Progress across the goal and its sub-folders, as everyone sees it.
function goalState(projectId) {
  const p = db.prepare('SELECT id, userId, title, isGoal FROM projects WHERE id = ? AND deletedAt IS NULL').get(projectId);
  if (!p) return null;
  const ids = [p.id, ...db.prepare('SELECT id FROM projects WHERE parentId = ? AND deletedAt IS NULL').all(p.id).map(r => r.id)];
  const tasks = db.prepare(`SELECT status, endDate, completedAt FROM tasks WHERE deletedAt IS NULL AND projectId IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const done = tasks.filter(t => t.status === 'Completed');
  const complete = tasks.length > 0 && done.length === tasks.length;
  const finishedOn = complete ? (done.map(t => t.completedAt).filter(Boolean).sort().pop() || now()).slice(0, 10) : null;
  const deadline = tasks.map(t => (t.endDate || '').slice(0, 10)).filter(Boolean).sort().pop() || null;
  const owner = db.prepare('SELECT name FROM profile WHERE userId = ?').get(p.userId);
  const first = owner && owner.name && owner.name !== 'Your Name' ? owner.name.split(' ')[0] : 'they';
  return { id: p.id, ownerId: p.userId, title: p.title, firstName: first, total: tasks.length, done: done.length, pct: tasks.length ? Math.round(done.length / tasks.length * 100) : 0, complete, finishedOn, deadline };
}
const topLevel = projectId => {
  const row = db.prepare('SELECT parentId FROM projects WHERE id = ?').get(projectId);
  return row && row.parentId ? row.parentId : projectId;
};

// ── Pledges ──
function create(projectId, body, { source = 'link' } = {}) {
  const g = goalState(projectId);
  if (!g) throw new Error('That goal no longer exists');
  const c = clean(body);
  if (c.amount != null && !body.currency) c.currency = defaultCurrency(g.ownerId);
  const open = db.prepare("SELECT COUNT(*) AS n FROM pledges WHERE projectId = ? AND status IN ('pledged','earned')").get(projectId).n;
  if (open >= 50) throw new Error('This goal has as many pledges as it can hold');
  const row = { id: crypto.randomUUID(), projectId, ownerId: g.ownerId, ...c, manageToken: token(), status: 'pledged', source, createdAt: now() };
  db.prepare(`INSERT INTO pledges (id, projectId, ownerId, name, relation, kind, amount, currency, reward, message, condition, byDate, email, manageToken, status, source, createdAt, giftCode, giftLink, giftNote)
    VALUES (@id, @projectId, @ownerId, @name, @relation, @kind, @amount, @currency, @reward, @message, @condition, @byDate, @email, @manageToken, @status, @source, @createdAt, @giftCode, @giftLink, @giftNote)`).run(row);
  refresh(projectId); // finished already, or the date's gone
  return get(row.id);
}
const get = id => db.prepare('SELECT * FROM pledges WHERE id = ?').get(id) || null;
const byManageToken = t => db.prepare('SELECT * FROM pledges WHERE manageToken = ?').get(String(t || '')) || null;
function list(projectId) {
  refresh(projectId);
  return db.prepare("SELECT * FROM pledges WHERE projectId = ? ORDER BY CASE status WHEN 'earned' THEN 0 WHEN 'pledged' THEN 1 WHEN 'given' THEN 2 ELSE 3 END, createdAt").all(projectId);
}

// Moves pledges on as the goal moves: earned when it's finished (in time,
// if they set a date), missed when a date passes first. Returns the ones
// just earned, and lets their pledgers know.
function refresh(projectId, { notify = true } = {}) {
  const g = goalState(topLevel(projectId));
  if (!g) return [];
  const open = db.prepare("SELECT * FROM pledges WHERE projectId = ? AND status = 'pledged'").all(g.id);
  const earned = [];
  for (const p of open) {
    if (g.complete && (p.condition !== 'by_date' || g.finishedOn <= p.byDate)) {
      db.prepare("UPDATE pledges SET status = 'earned', earnedAt = ? WHERE id = ? AND status = 'pledged'").run(now(), p.id);
      earned.push(get(p.id));
    } else if (p.condition === 'by_date' && todayKey() > p.byDate && !g.complete) {
      db.prepare("UPDATE pledges SET status = 'missed', endedAt = ? WHERE id = ? AND status = 'pledged'").run(now(), p.id);
    }
  }
  if (notify && earned.length) earned.forEach(p => emailEarned(p, g).catch(e => console.error('Pledge email failed:', e.message)));
  return earned;
}

// The pledger checked and released it (gave it): the held gift shows.
function markGiven(id) {
  db.prepare("UPDATE pledges SET status = 'given', givenAt = ? WHERE id = ? AND status = 'earned'").run(now(), id);
  return get(id);
}
// The owner has it in hand. A reward promised in person (no pledger page
// to release it from) goes straight from earned to received.
function markReceived(id) {
  const p = get(id);
  if (!p) return null;
  if (p.status === 'earned') db.prepare("UPDATE pledges SET status = 'given', givenAt = ? WHERE id = ?").run(now(), id);
  db.prepare('UPDATE pledges SET receivedAt = ? WHERE id = ? AND receivedAt IS NULL').run(now(), id);
  return get(id);
}
// How the owner would like cash sent: only once it's earned, and only the
// pledger sees it.
function setPayTo(id, text) {
  const v = clip(text, 300);
  db.prepare('UPDATE pledges SET payTo = ? WHERE id = ?').run(v || null, id);
  return get(id);
}

// ── The thread between the owner and the pledger ──
function messages(id) {
  return db.prepare('SELECT * FROM pledge_messages WHERE pledgeId = ? ORDER BY createdAt').all(id).map(m => ({ id: m.id, fromOwner: !!m.fromOwner, text: m.text, createdAt: m.createdAt }));
}
function say(id, fromOwner, text) {
  const t = String(text ?? '').trim().slice(0, 1000);
  if (!t) throw new Error('Write something first');
  if (db.prepare('SELECT COUNT(*) AS n FROM pledge_messages WHERE pledgeId = ?').get(id).n >= 300) throw new Error('This thread is full');
  const m = { id: crypto.randomUUID(), pledgeId: id, fromOwner: fromOwner ? 1 : 0, text: t, createdAt: now() };
  db.prepare('INSERT INTO pledge_messages (id, pledgeId, fromOwner, text, createdAt) VALUES (@id, @pledgeId, @fromOwner, @text, @createdAt)').run(m);
  return m;
}
// The owner asks the pledger to check and release an earned reward: a
// line in the thread and, where they left an email, an email.
function askRelease(id) {
  const p = get(id);
  if (!p || p.status !== 'earned') throw new Error('Only an earned reward can be released');
  if (p.releaseAskedAt && Date.now() - Date.parse(p.releaseAskedAt) < 12 * 3600000) throw new Error('You asked recently. Give them a little time');
  db.prepare('UPDATE pledges SET releaseAskedAt = ? WHERE id = ?').run(now(), id);
  say(id, true, 'I’ve finished! Could you check my progress and release the reward when you’re happy?');
  const g = goalState(p.projectId);
  emailPledger(p, g, `${g.firstName === 'they' ? 'They' : g.firstName} asked you to release your reward`, `<b>${esc(g.title)}</b> is finished, and ${esc(g.firstName === 'they' ? 'they' : g.firstName)} asked you to check and release <b>${esc(rewardText(p))}</b>.`, 'Check and release').catch(e => console.error('Pledge email failed:', e.message));
  return get(id);
}
function withdraw(id) {
  db.prepare("UPDATE pledges SET status = 'withdrawn', endedAt = ? WHERE id = ? AND status = 'pledged'").run(now(), id);
  return get(id);
}
function remove(id) { db.prepare('DELETE FROM pledges WHERE id = ?').run(id); }

// Open and earned pledges across everything someone owns, for the
// dashboard ("£50 from Mum when you finish").
function summary(ownerId) {
  return db.prepare("SELECT p.* FROM pledges p JOIN projects pr ON pr.id = p.projectId AND pr.deletedAt IS NULL WHERE p.ownerId = ? AND p.status IN ('pledged','earned') ORDER BY p.createdAt").all(ownerId);
}

// What the goal's owner sees: never the pledger's email or private link.
// The held gift stays hidden until it's released.
function forOwner(p) {
  const held = !!(p.giftCode || p.giftLink || p.giftNote);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM pledge_messages WHERE pledgeId = ? AND fromOwner = 0').get(p.id).n;
  return {
    id: p.id, projectId: p.projectId, name: p.name, relation: p.relation, kind: p.kind, amount: p.amount, currency: p.currency, reward: p.reward, text: rewardText(p), message: p.message, condition: p.condition, byDate: p.byDate, status: p.status, source: p.source, createdAt: p.createdAt, earnedAt: p.earnedAt, givenAt: p.givenAt, receivedAt: p.receivedAt || null, notified: !!p.email,
    held, gift: held && p.status === 'given' ? { code: p.giftCode, link: p.giftLink, note: p.giftNote } : null,
    payTo: p.payTo || null, releaseAskedAt: p.releaseAskedAt || null, messages: unread,
  };
}

// For the owner's notification bell: rewards pledged, earned, released,
// and messages from the people who pledged, since they last looked.
function activitySince(ownerId, since) {
  const out = [];
  const goal = id => (db.prepare('SELECT title FROM projects WHERE id = ?').get(id) || {}).title || 'your goal';
  db.prepare("SELECT * FROM pledges WHERE ownerId = ? AND source = 'link' AND createdAt > ?").all(ownerId, since)
    .forEach(p => out.push({ projectId: p.projectId, kind: 'pledged', text: `${p.name} pledged ${rewardText(p)} for “${goal(p.projectId)}”`, at: p.createdAt }));
  db.prepare('SELECT * FROM pledges WHERE ownerId = ? AND earnedAt > ?').all(ownerId, since)
    .forEach(p => out.push({ projectId: p.projectId, kind: 'earned', text: `You earned ${rewardText(p)} from ${p.name}${p.source === 'link' ? '. Ask them to release it' : ''}`, at: p.earnedAt }));
  db.prepare("SELECT * FROM pledges WHERE ownerId = ? AND source = 'link' AND givenAt > ?").all(ownerId, since)
    .forEach(p => out.push({ projectId: p.projectId, kind: 'released', text: `${p.name} released ${rewardText(p)}${p.giftCode || p.giftLink || p.giftNote ? '. Your gift is waiting' : ''}`, at: p.givenAt }));
  db.prepare(`SELECT p.projectId, p.name, COUNT(*) AS n, MAX(m.createdAt) AS at FROM pledge_messages m JOIN pledges p ON p.id = m.pledgeId
    WHERE p.ownerId = ? AND m.fromOwner = 0 AND m.createdAt > ? GROUP BY p.id`).all(ownerId, since)
    .forEach(r => out.push({ projectId: r.projectId, kind: 'message', text: `${r.name} sent you ${r.n === 1 ? 'a message' : `${r.n} messages`} about your reward`, at: r.at }));
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 10);
}

// ── Emails ──
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let appUrl = process.env.APP_URL || '';
const setAppUrl = u => { if (u && !process.env.APP_URL) appUrl = u; };
async function emailEarned(p, g) {
  if (!p.email) return;
  const t = getTransporter();
  if (!t) return;
  const url = `${(process.env.APP_URL || appUrl).replace(/\/$/, '')}/p/m/${p.manageToken}`;
  await t.sendMail({
    to: p.email,
    subject: `${g.firstName === 'they' ? 'They' : g.firstName} finished “${g.title}”`,
    html: wrapEmailHtml({
      heading: `${esc(g.firstName === 'they' ? 'They' : g.firstName)} did it`,
      bodyHtml: `<p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 14px;"><b>${esc(g.title)}</b> is finished. You promised <b>${esc(rewardText(p))}</b>. Now's the moment.</p>
        <a href="${esc(url)}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">See it and mark it given</a>`,
    }),
  });
}
// A note to the pledger (when they left an email), linking their page.
async function emailPledger(p, g, subject, bodyHtml, button) {
  if (!p.email) return;
  const t = getTransporter();
  if (!t) return;
  const url = `${(process.env.APP_URL || appUrl).replace(/\/$/, '')}/p/m/${p.manageToken}`;
  await t.sendMail({
    to: p.email, subject,
    html: wrapEmailHtml({ heading: esc(subject), bodyHtml: `<p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 14px;">${bodyHtml}</p><a href="${esc(url)}" style="display:inline-block;background:#0A7E8C;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">${esc(button)}</a>` }),
  });
}
function emailOwnerNewPledge(p, g) {
  return sendActivityEmail(g.ownerId, {
    subject: `${p.name} pledged a reward for “${g.title}”`,
    heading: `${esc(p.name)} believes in you`,
    bodyHtml: `<p style="font-size:14px;color:#374151;line-height:1.6;margin:0;">${esc(p.name)} promised you <b>${esc(rewardText(p))}</b> ${p.condition === 'by_date' ? `if you finish <b>${esc(g.title)}</b> by ${esc(p.byDate)}` : `when you finish <b>${esc(g.title)}</b>`}.${p.message ? `</p><p style="font-size:14px;color:#374151;line-height:1.6;margin:12px 0 0;font-style:italic;">“${esc(p.message)}”` : ''}</p>`,
  });
}

module.exports = { activitySince, markReceived, setPayTo, messages, say, askRelease, emailPledger, RELATIONS, CURRENCIES, clean, rewardText, money, defaultCurrency, getLink, createLink, deleteLink, goalState, create, get, byManageToken, list, refresh, markGiven, withdraw, remove, summary, forOwner, emailOwnerNewPledge, setAppUrl, topLevel };
