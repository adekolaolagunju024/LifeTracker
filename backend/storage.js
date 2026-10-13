const fs = require('fs');
const path = require('path');

// ── WHERE UPLOADED FILES LIVE ───────────────────────────────────
// Beside the database, so they sit on the same persistent volume
// (DB_PATH=/data/lifetracker.sqlite puts them in /data/uploads). They used
// to live in backend/uploads, inside the app's own folder, which a
// container host rebuilds on every deploy. UPLOAD_DIR overrides both.
const LEGACY_DIR = path.join(__dirname, 'uploads');
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'uploads') : LEGACY_DIR);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Files still in the old folder are copied across once (never moved, so
// nothing is lost if the old folder is itself a mounted volume). A file
// already in the new folder is left alone.
function adoptLegacyUploads(from = LEGACY_DIR, to = UPLOAD_DIR) {
  if (path.resolve(from) === path.resolve(to) || !fs.existsSync(from)) return 0;
  let copied = 0;
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.existsSync(dest) || !fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, dest);
    copied++;
  }
  return copied;
}

module.exports = { UPLOAD_DIR, LEGACY_DIR, adoptLegacyUploads };
