const webpush = require('web-push');
const db = require('../db/db');
const { APP_URL } = require('../email/appUrl');

// VAPID identifies this server to push services (Chrome/Firefox/etc) —
// unlike Gmail or Google OAuth, it needs no external account at all, just
// a keypair. Generated once on first use and persisted in app_config
// rather than requiring a manual .env step, so the feature works with
// zero setup; regenerating it would silently invalidate every existing
// subscription, so this never runs twice once a keypair exists.
function ensureVapidKeys() {
  let publicKey = db.getAppConfig('vapidPublicKey');
  let privateKey = db.getAppConfig('vapidPrivateKey');
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    db.setAppConfig('vapidPublicKey', publicKey);
    db.setAppConfig('vapidPrivateKey', privateKey);
    console.log('Push reminders: generated a new VAPID keypair.');
  }
  webpush.setVapidDetails(`mailto:${process.env.VAPID_CONTACT_EMAIL || 'admin@example.com'}`, publicKey, privateKey);
  return publicKey;
}

function getVapidPublicKey() {
  return ensureVapidKeys();
}

// Sends to every device a user has enabled reminders on; a subscription
// the push service reports as gone (410) or invalid (404) is removed on
// the spot rather than retried forever. Logged on every outcome (not just
// failure) — a silent success and "never had a subscription to send to in
// the first place" used to look identical from the server logs alone.
async function sendPushToUser(userId, { title, body, url, urgent, tag }) {
  ensureVapidKeys();
  const subs = db.listPushSubscriptionsForUser(userId);
  if (!subs.length) {
    console.log(`Push skipped for user ${userId}: no subscriptions registered (device never finished enabling it).`);
    return;
  }
  const payload = JSON.stringify({ title, body, url: url || APP_URL, urgent: !!urgent, tag });
  let sent = 0;
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.removePushSubscriptionByEndpoint(sub.endpoint);
        console.log(`Push subscription removed for user ${userId}: push service reported it gone (${e.statusCode}).`);
      } else {
        console.error(`Push send failed for ${userId} (status ${e.statusCode || 'n/a'}):`, e.message);
      }
    }
  }));
  if (sent) console.log(`Push sent to ${sent}/${subs.length} device(s) for user ${userId}: ${title}`);
}

module.exports = { getVapidPublicKey, sendPushToUser };
