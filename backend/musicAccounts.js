const db = require('./db/connection');

// ── LINKED MUSIC ACCOUNTS ───────────────────────────────────────
// Connect Spotify or YouTube (read-only) so your own playlists show up
// in Your why, one tap to add. Both use the standard OAuth sign-in on the
// service's own page; Waypoint keeps a refresh token to list playlists
// again later, never a password, and can't change anything on them.
//
// Settings:
//   Spotify  SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET (developer.spotify.com),
//            redirect URI <APP_URL>/api/music/spotify/callback
//   YouTube  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (the same Google app as
//            Drive backup), redirect URI <APP_URL>/api/music/youtube/callback,
//            with the YouTube Data API v3 turned on.

const PROVIDERS = {
  spotify: {
    name: 'Spotify',
    configured: () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
    authUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    scope: 'playlist-read-private playlist-read-collaborative',
    clientId: () => process.env.SPOTIFY_CLIENT_ID,
    clientSecret: () => process.env.SPOTIFY_CLIENT_SECRET,
    extraAuth: {},
  },
  youtube: {
    name: 'YouTube',
    configured: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
};

const redirectUri = (appUrl, provider) => `${appUrl.replace(/\/$/, '')}/api/music/${provider}/callback`;
function authorizeUrl(provider, appUrl, state) {
  const p = PROVIDERS[provider];
  const qs = new URLSearchParams({ client_id: p.clientId(), response_type: 'code', redirect_uri: redirectUri(appUrl, provider), scope: p.scope, state, ...p.extraAuth });
  return `${p.authUrl}?${qs}`;
}

async function tokenRequest(provider, body) {
  const p = PROVIDERS[provider];
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${p.clientId()}:${p.clientSecret()}`).toString('base64')}` },
    body: new URLSearchParams({ ...body, client_id: p.clientId(), client_secret: p.clientSecret() }).toString(),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error_description || d.error || `${p.name} sign-in failed (${res.status})`);
  return d;
}

const get = (userId, provider) => db.prepare('SELECT * FROM music_accounts WHERE userId = ? AND provider = ?').get(userId, provider) || null;
function save(userId, provider, t, displayName) {
  const cur = get(userId, provider);
  db.prepare(`INSERT INTO music_accounts (userId, provider, refreshToken, accessToken, expiresAt, displayName, connectedAt) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(userId, provider) DO UPDATE SET refreshToken = excluded.refreshToken, accessToken = excluded.accessToken, expiresAt = excluded.expiresAt, displayName = COALESCE(excluded.displayName, music_accounts.displayName)`)
    .run(userId, provider, t.refresh_token || (cur && cur.refreshToken) || null, t.access_token, Date.now() + ((t.expires_in || 3600) - 60) * 1000, displayName || null, (cur && cur.connectedAt) || new Date().toISOString());
}
function disconnect(userId, provider) { db.prepare('DELETE FROM music_accounts WHERE userId = ? AND provider = ?').run(userId, provider); }

async function api(provider, token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((d.error && (d.error.message || d.error)) || `${PROVIDERS[provider].name} said no (${res.status})`), { status: res.status });
  return d;
}

// Finishes the sign-in: swaps the code for tokens and notes whose account it is.
async function connect(userId, provider, code, appUrl) {
  const t = await tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(appUrl, provider) });
  let name = null;
  try {
    if (provider === 'spotify') name = (await api(provider, t.access_token, 'https://api.spotify.com/v1/me')).display_name;
    else { const ch = await api(provider, t.access_token, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true'); name = ch.items && ch.items[0] && ch.items[0].snippet.title; }
  } catch { /* the name is a nicety */ }
  save(userId, provider, t, name);
}

// A working access token, refreshed when it has run out. Null if not linked.
async function accessToken(userId, provider) {
  const a = get(userId, provider);
  if (!a) return null;
  if (a.accessToken && a.expiresAt > Date.now()) return a.accessToken;
  if (!a.refreshToken) return null;
  const t = await tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: a.refreshToken });
  save(userId, provider, t, null);
  return t.access_token;
}

const pickImage = (images = []) => (images.slice().sort((x, y) => (x.width || 0) - (y.width || 0)).find(i => (i.width || 0) >= 60) || images[0] || {}).url || '';
// Their own playlists, as links the player already plays.
async function playlists(userId, provider) {
  const token = await accessToken(userId, provider);
  if (!token) return null;
  if (provider === 'spotify') {
    const d = await api(provider, token, 'https://api.spotify.com/v1/me/playlists?limit=50');
    return (d.items || []).filter(Boolean).map(p => ({ title: p.name, by: (p.tracks && p.tracks.total ? `${p.tracks.total} songs` : 'Playlist'), art: pickImage(p.images), url: p.external_urls && p.external_urls.spotify })).filter(p => p.url);
  }
  const d = await api(provider, token, 'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50');
  return (d.items || []).map(p => ({ title: p.snippet.title, by: p.contentDetails && p.contentDetails.itemCount ? `${p.contentDetails.itemCount} videos` : 'Playlist', art: (p.snippet.thumbnails && (p.snippet.thumbnails.default || p.snippet.thumbnails.medium || {}).url) || '', url: `https://www.youtube.com/playlist?list=${p.id}` }));
}

function status(userId) {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => {
    const a = get(userId, k);
    return [k, { name: p.name, available: p.configured(), connected: !!a, account: a ? a.displayName : null }];
  }));
}

module.exports = { PROVIDERS, authorizeUrl, connect, accessToken, playlists, status, disconnect, redirectUri };
