const express = require('express');
const db = require('../db/db');
const pledges = require('../pledges');
const { rateLimit, byIp } = require('../middleware/rateLimit');
const { sendActivityEmail } = require('../email/activity');
// A push to the goal's owner, where they've turned push on.
const pushOwner = (userId, body, tag) => {
  try { require('../push/webpush').sendPushToUser(userId, { title: 'Rewards', body, url: '/app', tag }).catch(() => {}); } catch { /* push not set up */ }
};

const appUrl = req => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
const linkUrl = (req, token) => `${appUrl(req)}/p/${token}`;

// ── For the goal's owner: /api/pledges ──
// Rewards are personal, so only the goal's owner sees or manages them,
// not the people they share the project with.
const router = express.Router();
function ownGoal(req, res, projectId) {
  const id = pledges.topLevel(String(projectId || ''));
  if (!db.isProjectOwner(req.session.userId, id)) { res.status(404).json({ error: 'Goal not found' }); return null; }
  return id;
}

// GET /api/pledges?projectId= : the goal's pledges and its pledge link.
router.get('/', (req, res) => {
  const id = ownGoal(req, res, req.query.projectId); if (!id) return;
  const link = pledges.getLink(id);
  res.json({ link: link ? linkUrl(req, link.token) : null, pledges: pledges.list(id).map(pledges.forOwner), currency: pledges.defaultCurrency(req.session.userId), currencies: pledges.CURRENCIES, relations: pledges.RELATIONS });
});
// GET /api/pledges/summary : open and earned rewards across your goals.
router.get('/summary', (req, res) => {
  res.json({ pledges: pledges.summary(req.session.userId).map(pledges.forOwner) });
});
router.post('/link', (req, res) => {
  const id = ownGoal(req, res, req.body.projectId); if (!id) return;
  pledges.setAppUrl(appUrl(req));
  res.status(201).json({ link: linkUrl(req, pledges.createLink(id).token) });
});
router.delete('/link/:projectId', (req, res) => {
  const id = ownGoal(req, res, req.params.projectId); if (!id) return;
  pledges.deleteLink(id);
  res.json({ success: true });
});
// POST /api/pledges : the owner adds one themselves (a promise made in person).
router.post('/', (req, res) => {
  const id = ownGoal(req, res, req.body.projectId); if (!id) return;
  try { res.status(201).json(pledges.forOwner(pledges.create(id, req.body, { source: 'owner' }))); } catch (e) { res.status(400).json({ error: e.message }); }
});
function ownPledge(req, res) {
  const p = pledges.get(req.params.id);
  if (!p || p.ownerId !== req.session.userId) { res.status(404).json({ error: 'Pledge not found' }); return null; }
  return p;
}
// The owner has it in hand (released, or handed over in person).
router.put('/:id/received', (req, res) => {
  const p = ownPledge(req, res); if (!p) return;
  if (!['earned', 'given'].includes(p.status)) return res.status(409).json({ error: 'Only an earned reward can be marked received' });
  res.json(pledges.forOwner(pledges.markReceived(p.id)));
});
// How you'd like cash sent, once it's earned (only the pledger sees it).
router.put('/:id/pay-to', (req, res) => {
  const p = ownPledge(req, res); if (!p) return;
  if (p.status !== 'earned') return res.status(409).json({ error: 'You can say how to send it once it’s earned' });
  res.json(pledges.forOwner(pledges.setPayTo(p.id, (req.body || {}).payTo)));
});
// Ask the pledger to check and release an earned reward.
router.post('/:id/ask-release', (req, res) => {
  const p = ownPledge(req, res); if (!p) return;
  pledges.setAppUrl(appUrl(req));
  try { res.json(pledges.forOwner(pledges.askRelease(p.id))); } catch (e) { res.status(400).json({ error: e.message }); }
});
// The thread with the pledger.
router.get('/:id/messages', (req, res) => {
  const p = ownPledge(req, res); if (!p) return;
  res.json(pledges.messages(p.id));
});
router.post('/:id/messages', (req, res) => {
  const p = ownPledge(req, res); if (!p) return;
  if (p.source !== 'link') return res.status(400).json({ error: 'This one was added by you, so there’s no one to message' });
  try {
    const m = pledges.say(p.id, true, (req.body || {}).text);
    pledges.setAppUrl(appUrl(req));
    const g = pledges.goalState(p.projectId);
    pledges.emailPledger(p, g, `A message from ${g.firstName === 'they' ? 'them' : g.firstName} about your reward`, esc(m.text), 'Read and reply').catch(e => console.error('Pledge email failed:', e.message));
    res.status(201).json({ id: m.id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/:id', (req, res) => {
  const p = ownPledge(req, res); if (!p) return;
  pledges.remove(p.id);
  res.json({ success: true });
});

// ── For the person pledging: /p/<token> and /p/m/<their token> ──
// Plain pages and forms (no account, no scripts). Not indexed.
const publicRouter = express.Router();
publicRouter.use(express.urlencoded({ extended: false, limit: '20kb' }));
publicRouter.use((req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
const pledgeLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: byIp, message: 'Too many pledges from this connection. Please try again later.' });

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const REL_LABEL = { parent: 'Parent', family: 'Family', partner: 'Partner', friend: 'Friend', boss: 'Boss or manager', coach: 'Coach', teacher: 'Teacher', mentor: 'Mentor', sponsor: 'Sponsor or organisation', other: 'Other' };
const CUR_SYMBOL = { GBP: '£', USD: '$', EUR: '€', NGN: '₦', GHS: '₵', KES: 'KSh', ZAR: 'R', CAD: 'C$', AUD: 'A$', INR: '₹' };

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · StartLine</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Arial,sans-serif;background:#F3F5F7;color:#0D1B2A}
.wrap{max-width:560px;margin:0 auto;padding:24px 16px 48px}
.brand{display:flex;align-items:center;gap:8px;font-weight:800;color:#0D1B2A;text-decoration:none;font-size:15px;margin-bottom:18px}
.brand i{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#0A7E8C,#0D1B2A);display:inline-block}
.card{background:#fff;border:1px solid #E3E6EA;border-radius:20px;padding:22px;margin-bottom:14px}
.hero{background:linear-gradient(135deg,#E9F8F6 0%,#fff 62%);border-color:#D5ECEA}
.kicker{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#0A7E8C;margin:0}
h1{font-size:24px;line-height:1.25;margin:6px 0 6px;letter-spacing:-.015em}h2{font-size:17px;margin:0 0 4px}
p{font-size:14px;line-height:1.55;color:#3B4552;margin:0}
.bar{height:10px;border-radius:6px;background:#E8ECEF;overflow:hidden;margin:14px 0 6px}.bar span{display:block;height:100%;background:#0A7E8C;border-radius:6px}
.meta{font-size:12px;color:#6B7280}
label{display:block;font-size:13px;font-weight:700;margin:14px 0 6px;color:#1F2A37}
input,select,textarea{width:100%;font:inherit;font-size:15px;border:1px solid #D5DBE1;border-radius:12px;padding:11px 12px;background:#fff;color:#0D1B2A}
input:focus,select:focus,textarea:focus{outline:none;border-color:#0A7E8C;box-shadow:0 0 0 3px rgba(10,126,140,.12)}
textarea{min-height:80px;resize:vertical}
.row{display:grid;grid-template-columns:110px 1fr;gap:8px}
.hint{font-size:12px;color:#6B7280;margin-top:6px}
.radio{display:flex;gap:8px;flex-wrap:wrap}.radio label{margin:0;display:flex;align-items:center;gap:6px;font-weight:600;border:1px solid #D5DBE1;border-radius:12px;padding:9px 12px;cursor:pointer}
.radio input{width:auto;accent-color:#0A7E8C}
button{font:inherit;cursor:pointer}
.go{width:100%;margin-top:18px;background:#0A7E8C;color:#fff;border:0;border-radius:14px;padding:14px;font-size:16px;font-weight:800}
.go:hover{background:#086C78}.ghost{background:#fff;color:#3B4552;border:1px solid #D5DBE1;border-radius:12px;padding:11px 16px;font-weight:700}
.err{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;border-radius:12px;padding:10px 12px;font-size:14px;margin-bottom:12px}
.reward{font-size:20px;font-weight:800;margin:6px 0}
.chip{display:inline-block;font-size:12px;font-weight:800;border-radius:999px;padding:4px 10px;background:#E6F4F5;color:#075E68}
.chip.earned{background:#FEF3C7;color:#92400E}.chip.given{background:#DCFCE7;color:#14532D}.chip.off{background:#F1F3F5;color:#6B7280}
.small{font-size:12px;color:#6B7280;line-height:1.5;margin-top:10px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.actions form{margin:0}
.gift{margin-top:16px;border:1px dashed #BFE3E6;border-radius:14px;padding:10px 14px;background:#F7FCFC}.gift summary{font-weight:800;font-size:14px;cursor:pointer}
.release{border-top:1px solid #EEF1F4;margin-top:14px}.payto{background:#F3F5F7;border-radius:12px;padding:12px;margin-top:10px}
.steps{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}.steps li{display:flex;gap:8px;align-items:baseline;font-size:14px}.steps li span{color:#9CA3AF;width:14px}.steps li.done span{color:#0A7E8C}.steps li b{font-weight:600;flex:1}.steps li small{font-size:12px;color:#6B7280}
.thread{display:grid;gap:8px;margin:10px 0}.msg{border-radius:14px;padding:8px 12px;max-width:85%}.msg.you{justify-self:end;background:#E6F4F5}.msg.them{background:#F3F5F7}.msg b{font-size:11px}.msg p{white-space:pre-wrap}.msg small{font-size:11px;color:#6B7280}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style></head><body><div class="wrap"><a class="brand" href="/"><i></i>StartLine</a>${body}</div></body></html>`;
}
function goalCard(g, lead) {
  return `<div class="card hero"><p class="kicker">${esc(lead)}</p><h1>${esc(g.title)}</h1>
    <div class="bar" role="img" aria-label="${g.pct}% done"><span style="width:${g.pct}%"></span></div>
    <p class="meta">${g.complete ? 'Finished' : `${g.done} of ${g.total} steps done · ${g.pct}%`}${g.deadline && !g.complete ? ` · aiming for ${esc(new Date(g.deadline + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}` : ''}</p></div>`;
}
function pledgeForm(g, token, values = {}, error = '') {
  const v = k => esc(values[k] ?? '');
  const cur = values.currency || pledges.defaultCurrency(g.ownerId);
  return page(`Pledge a reward for ${g.firstName}`, `${goalCard(g, `${g.firstName === 'they' ? 'Someone' : esc(g.firstName)} is working on`)}
  <div class="card"><h2>Promise a reward</h2>
  <p>Back ${esc(g.firstName === 'they' ? 'them' : g.firstName)} with something to look forward to when they finish. Cash, or anything else: a meal out, a day off, the thing they've been saving for.</p>
  <form method="post" action="/p/${esc(token)}">
    ${error ? `<div class="err" role="alert" style="margin-top:14px">${esc(error)}</div>` : ''}
    <label for="name">Your name</label><input id="name" name="name" maxlength="60" required value="${v('name')}" autocomplete="name" placeholder="e.g. Mum, Coach Ade, Sarah from work">
    <label for="relation">You are their…</label><select id="relation" name="relation">${pledges.RELATIONS.map(r => `<option value="${r}" ${values.relation === r ? 'selected' : ''}>${REL_LABEL[r]}</option>`).join('')}</select>
    <label for="amount">Cash (optional)</label>
    <div class="row"><select name="currency" aria-label="Currency">${pledges.CURRENCIES.map(c => `<option value="${c}" ${cur === c ? 'selected' : ''}>${CUR_SYMBOL[c] || ''} ${c}</option>`).join('')}</select>
    <input id="amount" name="amount" inputmode="decimal" maxlength="12" value="${v('amount')}" placeholder="50"></div>
    <label for="reward">Something else (optional)</label><input id="reward" name="reward" maxlength="140" value="${v('reward')}" placeholder="e.g. Dinner at your favourite place">
    <p class="hint">Fill in cash, something else, or both.</p>
    <label>When is it earned?</label>
    <div class="radio"><label><input type="radio" name="condition" value="finish" ${values.condition !== 'by_date' ? 'checked' : ''}> When they finish</label>
    <label><input type="radio" name="condition" value="by_date" ${values.condition === 'by_date' ? 'checked' : ''}> If they finish by…</label></div>
    <input name="byDate" type="date" aria-label="Finish by date" value="${v('byDate')}" style="margin-top:8px">
    <label for="message">A note for them (optional)</label><textarea id="message" name="message" maxlength="400" placeholder="I believe in you.">${v('message')}</textarea>
    <details class="gift" ${values.giftCode || values.giftLink || values.giftNote ? 'open' : ''}><summary>🎁 Hold the gift here (optional)</summary>
      <p class="hint">Got a ticket, a voucher or a booking? Put it here and it stays hidden until you release it, once they’ve finished.</p>
      <label for="giftCode">Ticket, voucher or booking code</label><input id="giftCode" name="giftCode" maxlength="120" value="${v('giftCode')}" placeholder="e.g. ODEON-7F3K-22">
      <label for="giftLink">A link to it</label><input id="giftLink" name="giftLink" type="url" maxlength="500" value="${v('giftLink')}" placeholder="https://… (an e-ticket or gift card)">
      <label for="giftNote">A note to go with it</label><input id="giftNote" name="giftNote" maxlength="400" value="${v('giftNote')}" placeholder="e.g. Screen 3, Saturday 7pm. Enjoy!">
    </details>
    <label for="email">Your email (optional)</label><input id="email" name="email" type="email" maxlength="200" value="${v('email')}" autocomplete="email" placeholder="So we can tell you when they've earned it">
    <button class="go" type="submit">Pledge this reward</button>
    <p class="small">StartLine keeps the promise and any gift you hold here. It doesn't take or send money: once they've earned it, you check their progress, send or hand over the reward yourself, and release it. Your email is never shown to them.</p>
  </form></div>`);
}

// The pledger's own page: the goal's steps (to check they're really
// done), their pledge, releasing it (with how to send cash, once earned),
// and their thread with the goal's owner.
const fmtDay = d => new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
publicRouter.get('/m/:manage', (req, res) => {
  const p = pledges.byManageToken(req.params.manage);
  const g = p && pledges.goalState(p.projectId);
  if (!p || !g) return res.status(404).type('html').send(page('Not found', '<div class="card"><h2>This link doesn’t work any more</h2><p>The pledge or the goal has been removed.</p></div>'));
  pledges.refresh(p.projectId);
  const cur = pledges.get(p.id);
  const they = g.firstName === 'they' ? 'they' : g.firstName;
  const They = they === 'they' ? 'They' : they;
  const chip = { pledged: ['Promised', ''], earned: ['Earned! Check and release it', 'earned'], given: [cur.receivedAt ? `Released. ${They} got it` : 'Released. Thank you', 'given'], withdrawn: ['Withdrawn', 'off'], missed: ['The date passed', 'off'] }[cur.status];
  const fresh = req.query.new === '1';
  const held = cur.giftCode || cur.giftLink || cur.giftNote;
  const steps = pledgeSteps(cur.projectId);
  const thread = pledges.messages(cur.id);
  res.type('html').send(page('Your pledge', `${fresh ? `<div class="card" style="border-color:#BFE3E6"><h2>Thank you, ${esc(cur.name)}</h2><p>${esc(They)} can see your pledge now${held ? ' (your gift stays hidden until you release it)' : ''}. Keep this page: bookmark it to follow along${cur.email ? ', and we’ll email you when it’s earned' : ''}.</p></div>` : ''}
    ${goalCard(g, `${they === 'they' ? 'Their' : esc(they) + '’s'} goal`)}
    <div class="card"><p class="kicker">Your pledge</p><p class="reward">${esc(pledges.rewardText(cur))}</p>
    <p>${cur.condition === 'by_date' ? `If they finish by ${esc(fmtDay(cur.byDate))}.` : 'When they finish.'}</p>
    ${held ? `<p class="small" style="margin-top:8px">🎁 You’re holding a gift for them${cur.giftCode ? `: code <b>${esc(cur.giftCode)}</b>` : ''}${cur.giftLink ? `, <a href="${esc(cur.giftLink)}" rel="noopener noreferrer">link</a>` : ''}. ${cur.status === 'given' ? 'They can see it now.' : 'They see it when you release it.'}</p>` : ''}
    <p style="margin-top:10px"><span class="chip ${chip[1]}">${chip[0]}</span></p>
    ${cur.status === 'earned' ? `<div class="release">
      <h2 style="margin-top:14px">Check, then release</h2>
      <p>${esc(They)} finished every step${g.finishedOn ? ` on ${esc(fmtDay(g.finishedOn))}` : ''}. Look over the steps below${thread.length ? ' and your messages' : ''}; if you’re happy, release it.</p>
      ${cur.kind === 'cash' ? (cur.payTo ? `<div class="payto"><p class="kicker">How ${esc(they)} would like it sent</p><p style="white-space:pre-wrap">${esc(cur.payTo)}</p></div><p class="small">Send it yourself, then release it here. StartLine never handles the money.</p>` : `<p class="small">${esc(They)} hasn’t said how they’d like the money yet. You can ask below, or hand it over in person.</p>`) : ''}
      <div class="actions"><form method="post" action="/p/m/${esc(cur.manageToken)}/given"><button class="go" style="margin:0;width:auto;padding:12px 18px" type="submit">${cur.kind === 'cash' ? 'I’ve sent it: release' : held ? 'Release the gift' : 'I’ve given it: release'}</button></form></div>
    </div>` : ''}
    <div class="actions">
      ${cur.status === 'pledged' ? `<form method="post" action="/p/m/${esc(cur.manageToken)}/withdraw"><button class="ghost" type="submit">Withdraw my pledge</button></form>` : ''}
    </div>
    <p class="small">Only people with this link can see this page.</p></div>
    ${steps.length ? `<div class="card"><p class="kicker">Their steps</p><ul class="steps">${steps.map(t => `<li class="${t.status === 'Completed' ? 'done' : ''}"><span>${t.status === 'Completed' ? '✓' : '○'}</span><b>${esc(t.title)}</b><small>${t.status === 'Completed' && t.completedAt ? `done ${esc(fmtDay(t.completedAt))}` : t.status === 'In Progress' ? 'under way' : 'to do'}</small></li>`).join('')}</ul></div>` : ''}
    ${cur.source === 'link' ? `<div class="card" id="thread"><p class="kicker">Messages with ${esc(they)}</p>
      ${thread.length ? `<div class="thread">${thread.map(m => `<div class="msg ${m.fromOwner ? 'them' : 'you'}"><b>${m.fromOwner ? esc(They) : 'You'}</b><p>${esc(m.text)}</p><small>${esc(fmtDay(m.createdAt))}</small></div>`).join('')}</div>` : `<p class="small" style="margin-top:4px">Say well done, ask for a photo of the finish line, or ask how they’d like the reward.</p>`}
      <form method="post" action="/p/m/${esc(cur.manageToken)}/say"><label for="say" class="sr">Message</label><textarea id="say" name="text" maxlength="1000" required placeholder="Write to ${esc(they)}"></textarea><button class="ghost" type="submit" style="margin-top:8px">Send</button></form></div>` : ''}`));
});
// The goal's steps, for the pledger to check them over.
function pledgeSteps(projectId) {
  const conn = require('../db/connection');
  return conn.prepare(`SELECT t.title, t.status, t.completedAt FROM tasks t JOIN projects p ON p.id = t.projectId
    WHERE (p.id = ? OR p.parentId = ?) AND t.deletedAt IS NULL AND p.deletedAt IS NULL ORDER BY COALESCE(t.endDate, '9999'), t.sortOrder LIMIT 200`).all(projectId, projectId);
}
publicRouter.post('/m/:manage/given', (req, res) => {
  const p = pledges.byManageToken(req.params.manage);
  if (p && p.status === 'earned') {
    pledges.markGiven(p.id);
    const g = pledges.goalState(p.projectId);
    if (g) pushOwner(g.ownerId, `${p.name} released ${pledges.rewardText(p)}${p.giftCode || p.giftLink || p.giftNote ? '. Your gift is waiting' : ''}`, `pledge-${p.id}`);
    if (g) sendActivityEmail(g.ownerId, { subject: `${p.name} released your reward`, heading: `${esc(p.name)} released your reward`, bodyHtml: `<p style="font-size:14px;color:#374151;line-height:1.6;margin:0;"><b>${esc(pledges.rewardText(p))}</b> for <b>${esc(g.title)}</b>.${p.giftCode || p.giftLink || p.giftNote ? ' Open the goal in StartLine to see your gift.' : ''}</p>` }).catch(() => {});
  }
  res.redirect(303, `/p/m/${encodeURIComponent(req.params.manage)}`);
});
publicRouter.post('/m/:manage/say', pledgeLimit, (req, res) => {
  const p = pledges.byManageToken(req.params.manage);
  if (p && p.source === 'link') {
    try {
      const m = pledges.say(p.id, false, req.body.text);
      const g = pledges.goalState(p.projectId);
      if (g) pushOwner(g.ownerId, `${p.name}: ${m.text.slice(0, 120)}`, `pledge-msg-${p.id}`);
      if (g) sendActivityEmail(g.ownerId, { subject: `${p.name} sent you a message about your reward`, heading: `A message from ${esc(p.name)}`, bodyHtml: `<p style="font-size:14px;color:#374151;line-height:1.6;margin:0;">“${esc(m.text)}”</p>` }).catch(() => {});
    } catch { /* empty or full: just show the page again */ }
  }
  res.redirect(303, `/p/m/${encodeURIComponent(req.params.manage)}#thread`);
});
publicRouter.post('/m/:manage/withdraw', (req, res) => {
  const p = pledges.byManageToken(req.params.manage);
  if (p) pledges.withdraw(p.id);
  res.redirect(303, `/p/m/${encodeURIComponent(req.params.manage)}`);
});

const target = token => db.getPledgeLinkTarget(token);
publicRouter.get('/:token', (req, res) => {
  const t = target(req.params.token);
  const g = t && pledges.goalState(t.projectId);
  if (!g) return res.status(404).type('html').send(page('Not found', '<div class="card"><h2>This pledge link has been turned off</h2><p>Ask them for a new one.</p></div>'));
  if (g.complete) return res.type('html').send(page('Already finished', `${goalCard(g, 'Goal')}<div class="card"><h2>${esc(g.firstName === 'they' ? 'They' : g.firstName)} already finished this one</h2><p>Too late to pledge on it, but not too late to say well done.</p></div>`));
  res.type('html').send(pledgeForm(g, req.params.token));
});
publicRouter.post('/:token', pledgeLimit, (req, res) => {
  const t = target(req.params.token);
  const g = t && pledges.goalState(t.projectId);
  if (!g) return res.status(404).type('html').send(page('Not found', '<div class="card"><h2>This pledge link has been turned off</h2></div>'));
  try {
    pledges.setAppUrl(appUrl(req));
    const p = pledges.create(g.id, req.body, { source: 'link' });
    db.logEvent(g.ownerId, 'pledge_received');
    pledges.emailOwnerNewPledge(p, g).catch(e => console.error('Pledge email failed:', e.message));
    pushOwner(g.ownerId, `${p.name} pledged ${pledges.rewardText(p)} for “${g.title}”`, `pledge-${p.id}`);
    res.redirect(303, `/p/m/${p.manageToken}?new=1`);
  } catch (e) {
    res.status(400).type('html').send(pledgeForm(g, req.params.token, req.body, e.message));
  }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
