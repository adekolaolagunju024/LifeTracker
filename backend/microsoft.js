const crypto = require('crypto');

// Microsoft accounts: "Continue with Microsoft" (Outlook.com, Hotmail,
// Live and work or school accounts). The OAuth 2.0
// authorisation-code flow of the Microsoft identity platform, done with
// plain fetch, no SDK. Off until MICROSOFT_CLIENT_ID and
// MICROSOFT_CLIENT_SECRET are set (see README → Microsoft).
//
// Redirect URI to register on the Azure app (Web platform):
//   https://<your domain>/api/auth/microsoft/callback

const TENANT = () => process.env.MICROSOFT_TENANT || 'common'; // personal + work accounts
const AUTHORITY = () => `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0`;
const GRAPH = 'https://graph.microsoft.com/v1.0';
// Personal Microsoft accounts (Outlook.com, Hotmail, Live) all sign in
// through this one tenant id; their email addresses are verified.
const PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const SIGN_IN_SCOPES = ['openid', 'email', 'profile', 'User.Read'];

const isConfigured = () => !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
const callbackUrl = (req, path) => `${req.protocol}://${req.get('host')}${path}`;

// The URL to send the person to, with a one-time `state` kept in the
// session so the callback can't be forged from another site.
function authUrl(req, { scopes, path, stateKey, prompt = 'select_account' }) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session[stateKey] = state;
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: callbackUrl(req, path),
    response_mode: 'query',
    scope: scopes.join(' '),
    state,
    prompt,
  });
  return `${AUTHORITY()}/authorize?${params}`;
}
function checkState(req, stateKey) {
  const expected = req.session[stateKey];
  delete req.session[stateKey];
  const got = String(req.query.state || '');
  return !!expected && got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

async function tokenRequest(body) {
  const res = await fetch(`${AUTHORITY()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Microsoft sign-in failed (${res.status})`);
  return data;
}
const exchangeCode = (req, { code, scopes, path }) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(req, path), scope: scopes.join(' ') });
const refreshAccess = (refreshToken, scopes) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: scopes.join(' ') });

// The id_token came straight from Microsoft's token endpoint over TLS in
// exchange for our client secret, so its claims can be read without
// re-checking the signature (OpenID Connect Core 3.1.3.7).
function readIdToken(idToken) {
  const part = String(idToken || '').split('.')[1];
  if (!part) throw new Error('Microsoft did not return an id token');
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

// Who signed in, and whether their email can be trusted to match an
// existing StartLine account. Work or school accounts can carry an email
// their organisation never verified (the "nOAuth" problem), so for those
// it only counts as verified when Microsoft says so (the xms_edov
// optional claim). Unverified ones may still sign up with a fresh
// account, but never take over an existing one.
function identityFromClaims(claims) {
  const email = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
  const personal = claims.tid === PERSONAL_TENANT;
  const verified = !!email && /@/.test(email) && (personal || claims.xms_edov === true || claims.xms_edov === 'true' || claims.xms_edov === 1);
  return { email, verified, name: claims.name || '', subject: `${claims.tid || ''}:${claims.oid || claims.sub || ''}` };
}

async function graph(accessToken, path, opts = {}) {
  const res = await fetch(`${GRAPH}${path}`, { ...opts, headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Microsoft Graph error (${res.status})`);
  return data;
}

module.exports = { isConfigured, authUrl, checkState, exchangeCode, refreshAccess, readIdToken, identityFromClaims, graph, SIGN_IN_SCOPES, PERSONAL_TENANT };
