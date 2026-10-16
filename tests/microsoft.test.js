const { test } = require('node:test');
const assert = require('node:assert/strict');
const ms = require('../backend/microsoft');

const token = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

test('reads the claims from an id token', () => {
  assert.deepEqual(ms.readIdToken(token({ email: 'a@b.com', tid: 't' })), { email: 'a@b.com', tid: 't' });
  assert.throws(() => ms.readIdToken(''), /id token/);
});

test('personal Microsoft accounts count as verified', () => {
  const who = ms.identityFromClaims({ email: 'Ade@Outlook.com', tid: ms.PERSONAL_TENANT, oid: 'o1', name: 'Ade' });
  assert.equal(who.email, 'ade@outlook.com');
  assert.equal(who.verified, true);
  assert.equal(who.name, 'Ade');
});

test('a work account email is only verified when Microsoft says so', () => {
  assert.equal(ms.identityFromClaims({ email: 'boss@bank.com', tid: 'some-org' }).verified, false);
  assert.equal(ms.identityFromClaims({ preferred_username: 'boss@bank.com', tid: 'some-org' }).verified, false);
  assert.equal(ms.identityFromClaims({ email: 'me@nhs.net', tid: 'nhs', xms_edov: true }).verified, true);
});

test('nothing that is not an email is ever verified', () => {
  assert.equal(ms.identityFromClaims({ preferred_username: 'not-an-email', tid: ms.PERSONAL_TENANT }).verified, false);
  assert.equal(ms.identityFromClaims({ tid: ms.PERSONAL_TENANT }).verified, false);
});

test('the state check accepts only the value issued for this session, once', () => {
  const req = { session: {}, query: {}, protocol: 'https', get: () => 'startline.example' };
  process.env.MICROSOFT_CLIENT_ID = 'cid';
  const url = new URL(ms.authUrl(req, { scopes: ms.SIGN_IN_SCOPES, path: '/api/auth/microsoft/callback', stateKey: 'k' }));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://startline.example/api/auth/microsoft/callback');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  const state = url.searchParams.get('state');
  req.query.state = 'forged';
  req.session.k = state;
  assert.equal(ms.checkState(req, 'k'), false);
  req.session.k = state; req.query.state = state;
  assert.equal(ms.checkState(req, 'k'), true);
  assert.equal(ms.checkState(req, 'k'), false, 'single use');
  delete process.env.MICROSOFT_CLIENT_ID;
});
