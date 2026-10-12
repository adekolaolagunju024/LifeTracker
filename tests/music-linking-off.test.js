const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Linking is shelved unless MUSIC_LINKING=on, even with the keys set.
const dbPath = path.join(os.tmpdir(), `wp-music-off-${process.pid}.sqlite`);
process.env.DB_PATH = dbPath;
process.env.SPOTIFY_CLIENT_ID = 'sp-client';
process.env.SPOTIFY_CLIENT_SECRET = 'sp-secret';
const accounts = require('../backend/musicAccounts');
const conn = require('../backend/db/connection');
after(() => { conn.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true }); });

test('Connect is not offered while linking is shelved', () => {
  delete process.env.MUSIC_LINKING;
  assert.equal(accounts.PROVIDERS.spotify.configured(), false);
  process.env.MUSIC_LINKING = 'on';
  assert.equal(accounts.PROVIDERS.spotify.configured(), true);
});
