const crypto = require('crypto');

// ── OFF-SITE COPIES ─────────────────────────────────────────────
// The nightly backup (backup.js) is written beside the database, on the
// same volume, so losing the volume would lose the backups too. This sends
// a copy to S3-compatible storage somewhere else: Cloudflare R2, AWS S3,
// Backblaze B2 and the like all take the same signed PUT. It's off unless
// these are set (see .env.example):
//   BACKUP_S3_ENDPOINT           https://<account>.r2.cloudflarestorage.com
//   BACKUP_S3_BUCKET             waypoint-backups
//   BACKUP_S3_ACCESS_KEY_ID      …
//   BACKUP_S3_SECRET_ACCESS_KEY  …
//   BACKUP_S3_REGION             auto (R2) or e.g. eu-west-2 (S3)
// Signed by hand (AWS Signature Version 4) rather than pulling in the AWS
// SDK for one kind of request.

const env = () => ({
  endpoint: (process.env.BACKUP_S3_ENDPOINT || '').replace(/\/+$/, ''),
  bucket: process.env.BACKUP_S3_BUCKET || '',
  keyId: process.env.BACKUP_S3_ACCESS_KEY_ID || '',
  secret: process.env.BACKUP_S3_SECRET_ACCESS_KEY || '',
  region: process.env.BACKUP_S3_REGION || 'auto',
});
const isConfigured = () => { const e = env(); return !!(e.endpoint && e.bucket && e.keyId && e.secret); };

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// The key that signs one day's requests for one region and service.
function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}
// Each path segment percent-encoded the way S3 expects (slashes kept).
const encodePath = p => p.split('/').map(s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

// The headers for one signed request (path-style URL: endpoint/bucket/key).
function sign({ method, url, body, contentType, now = new Date() }, e = env()) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body || '');
  const headers = { host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, u.pathname, u.search.slice(1), names.map(n => `${n}:${headers[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${e.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(e.secret, date, e.region, 's3')).update(toSign).digest('hex');
  const rest = { ...headers };
  delete rest.host; // fetch sets Host itself
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${e.keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

// Puts one object. Throws with the storage service's reason on failure.
async function put(key, body, contentType = 'application/octet-stream') {
  const e = env();
  if (!isConfigured()) throw new Error('Off-site backup storage is not set up');
  const url = `${e.endpoint}/${encodePath(e.bucket)}/${encodePath(key)}`;
  const res = await fetch(url, { method: 'PUT', headers: sign({ method: 'PUT', url, body, contentType }, e), body });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Off-site upload of ${key} failed: ${res.status} ${text}`);
  }
}

module.exports = { isConfigured, put, sign, signingKey };
