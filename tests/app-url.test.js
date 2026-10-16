const { test } = require('node:test');
const assert = require('node:assert/strict');

// backend/email/appUrl.js: the link background emails and pushes use.
const load = env => {
  const saved = { APP_URL: process.env.APP_URL, RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN };
  for (const k of Object.keys(saved)) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  delete require.cache[require.resolve('../backend/email/appUrl')];
  const { APP_URL } = require('../backend/email/appUrl');
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return APP_URL;
};

test('the app URL: APP_URL first, then Railway\'s public domain, then localhost', () => {
  assert.equal(load({ APP_URL: 'https://waypoint.example/' }), 'https://waypoint.example');
  assert.equal(load({ RAILWAY_PUBLIC_DOMAIN: 'waypoint.up.railway.app' }), 'https://waypoint.up.railway.app');
  assert.equal(load({ APP_URL: 'https://mine.example', RAILWAY_PUBLIC_DOMAIN: 'waypoint.up.railway.app' }), 'https://mine.example');
  assert.equal(load({}), 'http://localhost:3000');
});
