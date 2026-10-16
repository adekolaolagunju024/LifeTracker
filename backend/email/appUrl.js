// The public URL of this deployment, for links in emails, push messages and
// referral links sent from background jobs (which have no incoming request
// to take the host from). APP_URL overrides it (a custom domain or another
// host); on Railway, RAILWAY_PUBLIC_DOMAIN is set for any service with a
// public domain, so the links are right even when APP_URL was never set
// rather than pointing at localhost.
const APP_URL = (process.env.APP_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
  || 'http://localhost:3000').replace(/\/$/, '');

module.exports = { APP_URL };
