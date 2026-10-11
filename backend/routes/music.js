const express = require('express');
const crypto = require('crypto');
const accounts = require('../musicAccounts');

// /api/music: link Spotify or YouTube and list your own playlists.
const router = express.Router();
const appUrl = req => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
const known = p => Object.prototype.hasOwnProperty.call(accounts.PROVIDERS, p);

router.get('/accounts', (req, res) => res.json(accounts.status(req.session.userId)));

// Off to the service's own sign-in page. The state ties the return trip to
// this person's session, so nobody can link their account to someone else's.
router.get('/:provider/connect', (req, res) => {
  const { provider } = req.params;
  if (!known(provider)) return res.status(404).send('Unknown music service');
  if (!accounts.PROVIDERS[provider].configured()) return res.status(400).send(`${accounts.PROVIDERS[provider].name} isn't set up on this server yet.`);
  const state = crypto.randomBytes(16).toString('hex');
  req.session.musicOAuth = { provider, state };
  res.redirect(accounts.authorizeUrl(provider, appUrl(req), state));
});
router.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const back = result => res.redirect(`/app?music=${encodeURIComponent(provider)}-${result}`);
  const expected = req.session.musicOAuth;
  req.session.musicOAuth = null;
  if (!known(provider) || req.query.error || !req.query.code) return back('cancelled');
  if (!expected || expected.provider !== provider || expected.state !== req.query.state) return back('error');
  try {
    await accounts.connect(req.session.userId, provider, String(req.query.code), appUrl(req));
    back('connected');
  } catch (e) {
    console.error(`${provider} link failed:`, e.message);
    back('error');
  }
});
router.get('/:provider/playlists', async (req, res) => {
  const { provider } = req.params;
  if (!known(provider)) return res.status(404).json({ error: 'Unknown music service' });
  try {
    const list = await accounts.playlists(req.session.userId, provider);
    if (!list) return res.status(404).json({ error: 'Not connected' });
    res.json({ playlists: list });
  } catch (e) {
    console.error(`${provider} playlists:`, e.message);
    // Access was taken back on their side: forget the link.
    if (e.status === 401 || /invalid_grant/i.test(e.message)) { accounts.disconnect(req.session.userId, provider); return res.status(409).json({ error: `Your ${accounts.PROVIDERS[provider].name} link has expired. Connect it again.` }); }
    res.status(502).json({ error: `Couldn't reach ${accounts.PROVIDERS[provider].name} just now` });
  }
});
router.delete('/:provider', (req, res) => {
  if (!known(req.params.provider)) return res.status(404).json({ error: 'Unknown music service' });
  accounts.disconnect(req.session.userId, req.params.provider);
  res.json({ success: true });
});

module.exports = router;
