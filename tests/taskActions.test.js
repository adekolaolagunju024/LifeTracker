const { test } = require('node:test');
const assert = require('node:assert/strict');
global.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); } };
global.localDateKey = d => d.toISOString().slice(0, 10);
global.document = { addEventListener() {} };
global.window = { addEventListener() {} };
const TaskActions = require('../frontend/js/taskActions');

test('a task title suggests what it is for', () => {
  assert.equal(TaskActions.guess('Email the recruiter').type, 'email');
  assert.equal(TaskActions.guess('WhatsApp Tunde about the reference').type, 'whatsapp');
  assert.equal(TaskActions.guess('Call the GP surgery').type, 'call');
  assert.deepEqual(TaskActions.guess('Book a flight to Manchester'), { type: 'book', kind: 'flight' });
  assert.deepEqual(TaskActions.guess('Lunch with Sam'), { type: 'book', kind: 'table' });
  assert.equal(TaskActions.guess('Mock interview with mentor').type, 'meeting');
  assert.equal(TaskActions.guess('Catch the bus home').type, 'directions');
  assert.equal(TaskActions.guess('Rewrite my CV'), null);
});

test('each action opens the right app with the details filled in', () => {
  const t = { id: 't1', title: 'Email the recruiter', startDate: '2026-10-14' };
  localStorage.setItem('wp-apps', 'google');
  const gmail = TaskActions.linkFor({ type: 'email', to: 'jo@nhs.net', body: 'Hi Jo' }, t).href;
  assert.match(gmail, /^https:\/\/mail\.google\.com\/mail\/\?view=cm/);
  assert.match(gmail, /to=jo%40nhs\.net/);
  assert.match(gmail, /su=Email%20the%20recruiter/, 'the subject defaults to the task title');
  localStorage.setItem('wp-apps', 'device');
  assert.match(TaskActions.linkFor({ type: 'email', to: 'jo@nhs.net' }, t).href, /^mailto:jo@nhs\.net\?/);
  assert.equal(TaskActions.linkFor({ type: 'whatsapp', phone: '+44 7700 900123', body: 'Hi' }, t).href, 'https://wa.me/447700900123?text=Hi');
  assert.equal(TaskActions.linkFor({ type: 'call', phone: '+44 (20) 7946 0000' }, t).href, 'tel:+442079460000');
  localStorage.setItem('wp-apps', 'google');
  const cal = TaskActions.linkFor({ type: 'meeting', people: 'mentor@x.com' }, t).href;
  assert.match(cal, /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(cal, /dates=\d{8}T\d{6}Z\/\d{8}T\d{6}Z/);
  assert.match(cal, /add=mentor%40x\.com/);
  assert.match(TaskActions.linkFor({ type: 'directions', place: 'Home' }, t).href, /google\.com\/maps\/dir\/\?api=1&destination=Home&travelmode=transit/);
  assert.match(TaskActions.linkFor({ type: 'book', kind: 'flight', from: 'London', place: 'Manchester' }, t).href, /google\.com\/travel\/flights\?q=Flights%20from%20London%20to%20Manchester%20on%202026-10-14/);
  assert.equal(TaskActions.linkFor({ type: 'link', url: 'https://nhsjobs.com' }, t).href, 'https://nhsjobs.com');
});
