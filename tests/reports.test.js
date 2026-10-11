const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const dbFile = path.join(os.tmpdir(), `waypoint-reports-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
const db = require('../backend/db/db');
const { buildPortfolioReport, renderPortfolioHtml } = require('../backend/reports/portfolio');
const { buildProgressReport, renderProgressReportHtml } = require('../backend/reports/progress');

const now = () => new Date().toISOString();
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const user = () => db.createUser({ id: randomUUID(), email: `r_${randomUUID()}@example.com`, passwordHash: 'x', createdAt: now(), acceptedTermsAt: now() });
const project = (u, title, extra = {}) => db.createProject(u.id, { id: randomUUID(), title, createdAt: now(), ...extra });
const task = (u, p, extra = {}) => db.createTask(u.id, { id: randomUUID(), projectId: p.id, title: 'Task', status: 'Not Started', priority: 'Medium', createdAt: now(), ...extra });
const file = (u, p, mimetype = 'image/png') => db.createAttachment({ projectId: p.id, uploaderId: u.id, filename: `${randomUUID()}.png`, originalName: 'site.png', mimetype, size: 10 });
function shareWith(owner, p, role) {
  const other = user();
  const inv = db.inviteCollaborator(owner.id, p.id, other.email, role);
  db.acceptInvite(other.id, inv.id);
  return other;
}

after(() => {
  require('../backend/db/connection').close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
});

test('photos are pinned to the top-level project with caption, kind and task', () => {
  const u = user();
  const p = project(u, 'Bakery');
  const phase = project(u, 'Build', { parentId: p.id });
  const t = task(u, phase, { title: 'Fit kitchen' });
  const a = file(u, phase);
  const m = db.addReportMedia(u.id, phase.id, { attachmentId: a.id, caption: 'Ovens in', kind: 'blocker', taskId: t.id });
  assert.equal(m.projectId, p.id);
  assert.equal(m.kind, 'blocker');
  assert.equal(m.taskTitle, 'Fit kitchen');
  assert.equal(db.listReportMedia(u.id, p.id).length, 1);
  // Adding the same file again updates it rather than duplicating it.
  db.addReportMedia(u.id, p.id, { attachmentId: a.id, caption: 'Ovens fitted', kind: 'nonsense' });
  const list = db.listReportMedia(u.id, p.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].caption, 'Ovens fitted');
  assert.equal(list[0].kind, 'progress');
});

test('a file from another project cannot be pinned', () => {
  const u = user();
  const p1 = project(u, 'One'), p2 = project(u, 'Two');
  assert.throws(() => db.addReportMedia(u.id, p1.id, { attachmentId: file(u, p2).id }), /isn't part of this project/);
});

test('viewers cannot add; commenters can add and remove their own; editors can remove any', () => {
  const owner = user();
  const p = project(owner, 'Shared');
  const viewer = shareWith(owner, p, 'viewer');
  const commenter = shareWith(owner, p, 'commenter');
  const editor = shareWith(owner, p, 'editor');
  assert.throws(() => db.addReportMedia(viewer.id, p.id, { attachmentId: file(owner, p).id }), /commenter access/);
  const mine = db.addReportMedia(commenter.id, p.id, { attachmentId: file(commenter, p).id });
  const owners = db.addReportMedia(owner.id, p.id, { attachmentId: file(owner, p).id });
  assert.throws(() => db.removeReportMedia(commenter.id, owners.id), /editor/);
  assert.equal(db.removeReportMedia(commenter.id, mine.id), true);
  assert.equal(db.removeReportMedia(editor.id, owners.id), true);
  assert.equal(db.removeReportMedia(user().id, owners.id), false, 'outsiders see nothing');
});

test('the portfolio covers the chosen projects and flags what needs a decision', () => {
  const u = user();
  const late = project(u, 'Late one');
  task(u, late, { title: 'Overdue thing', startDate: day(-20), endDate: day(-3) });
  const fine = project(u, 'Fine one');
  task(u, fine, { title: 'Done thing', status: 'Completed', startDate: day(-5), endDate: day(-1) });
  const r = buildPortfolioReport(u.id);
  assert.equal(r.projectCount, 2);
  assert.equal(r.overdue, 1);
  assert.deepEqual(r.attention.map(a => a.title), ['Late one']);
  const only = buildPortfolioReport(u.id, [fine.id]);
  assert.equal(only.projectCount, 1);
  assert.equal(only.selected, true);
  const html = renderPortfolioHtml(r, { title: 'Board <meeting>' });
  assert.match(html, /Board &lt;meeting&gt;/);
  assert.match(html, /Needs a decision/);
});

test('reports show pinned photos through the given source, files by name', () => {
  const u = user();
  const p = project(u, 'With photos');
  task(u, p);
  db.addReportMedia(u.id, p.id, { attachmentId: file(u, p).id, caption: 'Front of shop' });
  db.addReportMedia(u.id, p.id, { attachmentId: file(u, p, 'application/pdf').id, caption: 'Quote' });
  const r = buildProgressReport(u.id, p.id);
  const html = renderProgressReportHtml(r, { mediaSrc: m => (m.mimetype.startsWith('image/') ? 'data:image/png;base64,AAAA' : null) });
  assert.match(html, /Photos and files/);
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="Front of shop"/);
  assert.match(html, /📎 site\.png · Quote/);
});
