const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── THE APP PAGE, BUILT FOR A PHONE ON 4G ───────────────────────
// frontend/index.html stays as written: readable, with its CSS inline and
// 33 script tags. What's served is built from it when the server starts:
//   · the inline <style> becomes one minified stylesheet,
//   · the app's scripts become one minified file, in the same order,
//   · both are named by a hash of their contents, so a browser keeps them
//     for a year and fetches them again only when they change,
//   · everything is compressed once, with Brotli and gzip, not per request.
// The page itself is never cached (so a deploy shows at once), and it's now
// small. The scripts are classic scripts sharing one global scope, so
// joining them in order changes nothing; the minifier keeps top-level
// names, which the markup's onclick handlers call. BUNDLE=off serves the
// page as written. Outside production a changed source file rebuilds it.
const FRONTEND = path.join(__dirname, '../frontend');
const INDEX = path.join(FRONTEND, 'index.html');
const SCRIPT_RE = /<script src="(js\/[^"]+\.js)"><\/script>\n?/g;
const STYLE_RE = /<style>([\s\S]*?)<\/style>/;

let built = null; // { html, assets: Map(name -> { type, raw, br, gz }), sources: [{ file, mtime }] }

const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const pack = (type, raw) => ({
  type, raw,
  br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
  gz: zlib.gzipSync(raw, { level: 9 }),
});

function build() {
  const esbuild = require('esbuild');
  const source = fs.readFileSync(INDEX, 'utf8');
  const scripts = [...source.matchAll(SCRIPT_RE)].map(m => m[1]);
  if (!scripts.length) throw new Error('no app scripts found in index.html');

  // One file, in page order. Each part is named, for reading a stack trace.
  const js = scripts.map(src => `/* ${src} */\n${fs.readFileSync(path.join(FRONTEND, src), 'utf8')}\n;`).join('\n');
  const jsMin = esbuild.transformSync(js, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' }).code;

  const style = source.match(STYLE_RE);
  const cssMin = style ? esbuild.transformSync(style[1], { loader: 'css', minify: true, target: ['chrome100', 'safari15', 'firefox100'] }).code : '';

  const assets = new Map();
  const jsName = `app.${hash(jsMin)}.js`;
  assets.set(jsName, pack('application/javascript; charset=utf-8', Buffer.from(jsMin)));
  let html = source;
  if (style) {
    const cssName = `page.${hash(cssMin)}.css`;
    assets.set(cssName, pack('text/css; charset=utf-8', Buffer.from(cssMin)));
    html = html.replace(STYLE_RE, `<link rel="stylesheet" href="/build/${cssName}">`);
  }
  // The script tags go; the bundle takes the first one's place.
  let first = true;
  html = html.replace(SCRIPT_RE, () => { if (!first) return ''; first = false; return `<script src="/build/${jsName}"></script>\n`; });
  // Comments are notes for whoever edits the page, not for browsers.
  html = html.replace(/<!--(?!\[)[\s\S]*?-->/g, '').replace(/\n\s*\n+/g, '\n');

  const page = pack('text/html; charset=utf-8', Buffer.from(html));
  const sources = [INDEX, ...scripts.map(s => path.join(FRONTEND, s))].map(file => ({ file, mtime: fs.statSync(file).mtimeMs }));
  return { page, assets, sources, sizes: { scripts: scripts.length, js: jsMin.length, css: cssMin.length, html: html.length } };
}

const stale = () => process.env.NODE_ENV !== 'production' && built.sources.some(s => { try { return fs.statSync(s.file).mtimeMs !== s.mtime; } catch { return true; } });

// The built page, or null to serve index.html as written (BUNDLE=off, or
// the build failed: the app still works, just heavier).
function current() {
  if (process.env.BUNDLE === 'off') return null;
  if (built && !stale()) return built;
  try {
    built = build();
    const s = built.sizes;
    console.log(`Built the app page: ${s.scripts} scripts into one (${Math.round(s.js / 1024)} KB), CSS ${Math.round(s.css / 1024)} KB, page ${Math.round(s.html / 1024)} KB`);
  } catch (e) {
    console.error('Could not build the app page; serving it as written:', e.message);
    built = null;
  }
  return built;
}

function send(req, res, asset, cache) {
  const enc = String(req.headers['accept-encoding'] || '');
  const body = /\bbr\b/.test(enc) ? (res.setHeader('Content-Encoding', 'br'), asset.br)
    : /\bgzip\b/.test(enc) ? (res.setHeader('Content-Encoding', 'gzip'), asset.gz) : asset.raw;
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Content-Type', asset.type);
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Length', body.length);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// The app page (/app and the catch-all route).
function sendPage(req, res, fallback) {
  const b = current();
  if (!b) return fallback();
  send(req, res, b.page, 'no-cache');
}

// GET /build/:name, the hashed stylesheet and script.
function assetRoute(req, res, next) {
  const b = current();
  const asset = b && b.assets.get(req.params.name);
  // An old name (a tab open from before a deploy) is a plain 404, never the
  // page from the catch-all route, which a browser would try to run as code.
  if (!asset) return b ? res.status(404).end() : next();
  send(req, res, asset, 'public, max-age=31536000, immutable');
}

module.exports = { build, current, sendPage, assetRoute };
