const { test } = require('node:test');
const assert = require('node:assert/strict');
const { byIp, byIpAndEmail } = require('../backend/middleware/rateLimit');

test('an IPv4 address written as IPv6 counts as the same client', () => {
  assert.equal(byIp({ ip: '::ffff:127.0.0.1' }), byIp({ ip: '127.0.0.1' }));
  assert.equal(byIpAndEmail({ ip: '::ffff:10.0.0.5', body: { email: ' A@Example.com ' } }), '10.0.0.5|a@example.com');
  assert.equal(byIp({ ip: '::1' }), '::1');
  assert.equal(byIp({}), 'unknown');
});
