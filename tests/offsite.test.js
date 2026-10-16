const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kolaway-offsite-'));
process.env.DB_PATH = path.join(tmp, 'app.sqlite');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
const db = require('../backend/db/connection');
const offsite = require('../backend/offsite');
const storage = require('../backend/storage');
const backup = require('../backend/backup');

// A stand-in for R2/S3 that records each PUT.
const puts = [];
let server;
before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { puts.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.end(); });
  });
  await new Promise(r => server.listen(0, r));
  Object.assign(process.env, {
    BACKUP_S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    BACKUP_S3_BUCKET: 'kolaway-backups',
    BACKUP_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
    BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
    BACKUP_S3_REGION: 'auto',
  });
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the signing key matches the AWS Signature Version 4 example', () => {
  const key = offsite.signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam');
  assert.equal(key.toString('hex'), 'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
});

test('a signed request names the key, the scope and the signed headers', () => {
  const h = offsite.sign({ method: 'PUT', url: 'https://x.example.com/b/db/a.gz', body: 'hi', now: new Date('2026-10-13T03:30:00Z') },
    { region: 'auto', keyId: 'KEY', secret: 's' });
  assert.equal(h['x-amz-date'], '20261013T033000Z');
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=KEY\/20261013\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test('it is off until the storage is set up', () => {
  const saved = process.env.BACKUP_S3_BUCKET;
  delete process.env.BACKUP_S3_BUCKET;
  assert.equal(offsite.isConfigured(), false);
  process.env.BACKUP_S3_BUCKET = saved;
  assert.equal(offsite.isConfigured(), true);
});

test('the nightly job sends the database compressed, and each upload once', async () => {
  fs.writeFileSync(path.join(storage.UPLOAD_DIR, 'one.png'), 'photo-1');
  let result = await backup.nightly();
  assert.equal(result.ok, true);
  const dbPut = puts.find(p => p.url.startsWith('/kolaway-backups/db/lifetracker-'));
  assert.ok(dbPut, 'database sent');
  assert.match(dbPut.headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.equal(zlib.gunzipSync(dbPut.body).subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal(puts.filter(p => p.url === '/kolaway-backups/uploads/one.png').length, 1);

  fs.writeFileSync(path.join(storage.UPLOAD_DIR, 'two.pdf'), 'doc-2');
  result = await backup.nightly();
  assert.equal(result.offsite.files, 1); // only the new one
  assert.equal(puts.filter(p => p.url === '/kolaway-backups/uploads/one.png').length, 1);
  assert.equal(puts.filter(p => p.url === '/kolaway-backups/uploads/two.pdf').length, 1);
  assert.equal(backup.lastResult().ok, true);
});

test('a failed upload is reported, not thrown', async () => {
  const saved = process.env.BACKUP_S3_ENDPOINT;
  process.env.BACKUP_S3_ENDPOINT = 'http://127.0.0.1:1';
  const result = await backup.nightly();
  process.env.BACKUP_S3_ENDPOINT = saved;
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('uploads live beside the database, and old ones are copied across without overwriting', () => {
  assert.equal(storage.UPLOAD_DIR, path.join(tmp, 'uploads'));
  const old = fs.mkdtempSync(path.join(tmp, 'legacy-'));
  fs.writeFileSync(path.join(old, 'a.jpg'), 'old-a');
  fs.writeFileSync(path.join(old, 'b.jpg'), 'old-b');
  fs.writeFileSync(path.join(storage.UPLOAD_DIR, 'b.jpg'), 'new-b');
  assert.equal(storage.adoptLegacyUploads(old, storage.UPLOAD_DIR), 1);
  assert.equal(fs.readFileSync(path.join(storage.UPLOAD_DIR, 'a.jpg'), 'utf8'), 'old-a');
  assert.equal(fs.readFileSync(path.join(storage.UPLOAD_DIR, 'b.jpg'), 'utf8'), 'new-b');
  assert.ok(fs.existsSync(path.join(old, 'a.jpg')), 'the original stays');
});
