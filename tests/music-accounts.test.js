const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Linking switched on, Spotify keys set, Google not: Spotify is offered,
// YouTube isn't.
process.env.MUSIC_LINKING = 'on';
process.env.SPOTIFY_CLIENT_ID = 'sp-client';
process.env.SPOTIFY_CLIENT_SECRET = 'sp-secret';
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
const { startServer } = require('./helpers/server');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.stop(); });

async function signUp() {
  const res = await fetch(`${server.base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `mu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`, password: 'testpass123', acceptTerms: true }) });
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

test('the accounts list says which services can be linked', async () => {
  const cookie = await signUp();
  const a = await (await fetch(`${server.base}/api/music/accounts`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(a.spotify, { name: 'Spotify', available: true, connected: false, account: null });
  assert.equal(a.youtube.available, false);
});

test('connecting sends you to Spotify with a state that the return trip must match', async () => {
  const cookie = await signUp();
  const go = await fetch(`${server.base}/api/music/spotify/connect`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(go.status, 302);
  const to = new URL(go.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(to.searchParams.get('client_id'), 'sp-client');
  assert.match(to.searchParams.get('redirect_uri'), /\/api\/music\/spotify\/callback$/);
  assert.match(to.searchParams.get('scope'), /playlist-read-private/);
  assert.ok(to.searchParams.get('state').length >= 32);

  // A forged return (wrong state) is refused and links nothing
  const bad = await fetch(`${server.base}/api/music/spotify/callback?code=abc&state=forged`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(bad.headers.get('location'), '/app?music=spotify-error');
  const a = await (await fetch(`${server.base}/api/music/accounts`, { headers: { Cookie: cookie } })).json();
  assert.equal(a.spotify.connected, false);

  // Saying no on Spotify's page comes back as cancelled
  await fetch(`${server.base}/api/music/spotify/connect`, { headers: { Cookie: cookie }, redirect: 'manual' });
  const no = await fetch(`${server.base}/api/music/spotify/callback?error=access_denied&state=x`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(no.headers.get('location'), '/app?music=spotify-cancelled');
});

test('a service that is not set up, or not linked, says so', async () => {
  const cookie = await signUp();
  assert.equal((await fetch(`${server.base}/api/music/youtube/connect`, { headers: { Cookie: cookie }, redirect: 'manual' })).status, 400);
  assert.equal((await fetch(`${server.base}/api/music/spotify/playlists`, { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await fetch(`${server.base}/api/music/napster/playlists`, { headers: { Cookie: cookie } })).status, 404);
});
