// The public URL of this deployment, used for the "Open Waypoint" /
// "open the app" links in outgoing emails — a background email job has
// no incoming request to derive it from the way a normal route handler
// would.
//
// APP_URL is the explicit override (set it yourself for a custom domain
// or any non-Railway host). RAILWAY_PUBLIC_DOMAIN is injected
// automatically by Railway for any service with a public domain, so a
// Railway deployment gets the right link even if APP_URL was never set —
// which is what was happening before this file existed: every email
// linked back to http://localhost:3000 in production.
const APP_URL = process.env.APP_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
  || 'http://localhost:3000';

module.exports = { APP_URL };
