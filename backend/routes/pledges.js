const express = require('express');
const db = require('../db/db');
const pledges = require('../pledges');
const { rateLimit, byIp } = require('../middleware/rateLimit');

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
// The owner got it.
router.put('/:id/received', (req, res) => {
  const p = ownPledge(req, res); if (!p) return;
  if (p.status !== 'earned') return res.status(409).json({ error: 'Only an earned reward can be marked received' });
  res.json(pledges.forOwner(pledges.markGiven(p.id)));
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
<title>${esc(title)} · Waypoint</title>
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
</style></head><body><div class="wrap"><a class="brand" href="/"><i></i>Waypoint</a>${body}</div></body></html>`;
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
    <label for="email">Your email (optional)</label><input id="email" name="email" type="email" maxlength="200" value="${v('email')}" autocomplete="email" placeholder="So we can tell you when they've earned it">
    <button class="go" type="submit">Pledge this reward</button>
    <p class="small">Waypoint only keeps track of the promise. It doesn't take or send money: when they've earned it, you give it to them yourself. Your email is never shown to them.</p>
  </form></div>`);
}

publicRouter.get('/m/:manage', (req, res) => {
  const p = pledges.byManageToken(req.params.manage);
  const g = p && pledges.goalState(p.projectId);
  if (!p || !g) return res.status(404).type('html').send(page('Not found', '<div class="card"><h2>This link doesn’t work any more</h2><p>The pledge or the goal has been removed.</p></div>'));
  pledges.refresh(p.projectId);
  const cur = pledges.get(p.id);
  const chip = { pledged: ['Promised', ''], earned: ['Earned! Time to give it', 'earned'], given: ['Given. Thank you', 'given'], withdrawn: ['Withdrawn', 'off'], missed: ['The date passed', 'off'] }[cur.status];
  const fresh = req.query.new === '1';
  res.type('html').send(page('Your pledge', `${fresh ? `<div class="card" style="border-color:#BFE3E6"><h2>Thank you, ${esc(cur.name)}</h2><p>${esc(g.firstName === 'they' ? 'They' : g.firstName)} can see your pledge now. Keep this page: bookmark it to follow along${cur.email ? ', and we’ll email you when it’s earned' : ''}.</p></div>` : ''}
    ${goalCard(g, `${g.firstName === 'they' ? 'Their' : esc(g.firstName) + '’s'} goal`)}
    <div class="card"><p class="kicker">Your pledge</p><p class="reward">${esc(pledges.rewardText(cur))}</p>
    <p>${cur.condition === 'by_date' ? `If they finish by ${esc(new Date(cur.byDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}.` : 'When they finish.'}</p>
    <p style="margin-top:10px"><span class="chip ${chip[1]}">${chip[0]}</span></p>
    <div class="actions">
      ${cur.status === 'earned' ? `<form method="post" action="/p/m/${esc(cur.manageToken)}/given"><button class="go" style="margin:0;width:auto;padding:12px 18px" type="submit">I’ve given it</button></form>` : ''}
      ${cur.status === 'pledged' ? `<form method="post" action="/p/m/${esc(cur.manageToken)}/withdraw"><button class="ghost" type="submit">Withdraw my pledge</button></form>` : ''}
    </div>
    <p class="small">Only people with this link can see this page.</p></div>`));
});
publicRouter.post('/m/:manage/given', (req, res) => {
  const p = pledges.byManageToken(req.params.manage);
  if (p) pledges.markGiven(p.id);
  res.redirect(303, `/p/m/${encodeURIComponent(req.params.manage)}`);
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
    res.redirect(303, `/p/m/${p.manageToken}?new=1`);
  } catch (e) {
    res.status(400).type('html').send(pledgeForm(g, req.params.token, req.body, e.message));
  }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
