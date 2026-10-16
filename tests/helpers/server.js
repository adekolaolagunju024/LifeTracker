const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BOOT_TIMEOUT_MS = 60000;

// Boots the real server against a throwaway SQLite file so tests never touch
// the developer's database. A cold first start can be slow on some machines,
// so a launch that doesn't answer in time is retried once on a fresh port.
async function launch() {
  const port = 4100 + Math.floor(Math.random() * 800);
  const dbPath = path.join(os.tmpdir(), `wayrise-test-${port}-${Date.now()}.sqlite`);
  const child = spawn(process.execPath, [path.join(__dirname, '../../backend/server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', d => { stderr += d; });
  child.stdout.on('data', d => { stdout += d; });

  // 127.0.0.1, not localhost: "localhost" can resolve to IPv4 or IPv6 on
  // different connections, and the server would then see one client as
  // two addresses (splitting its per-address rate limits).
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {}
    if (child.exitCode !== null) throw new Error(`Server exited during boot: ${stderr}`);
    await new Promise(r => setTimeout(r, 150));
    if (Date.now() >= deadline) { child.kill(); throw new Error('Server did not start in time'); }
  }

  return {
    base,
    // With no email service in tests, the server logs each confirm-email
    // link; this reads the newest one for an address.
    async verifyTokenFor(email) {
      for (let i = 0; i < 40; i++) {
        const links = [...stdout.matchAll(/Confirm-email link for (\S+)[^\n]*\n\s*(\S+)/g)].filter(m => m[1] === email);
        if (links.length) return new URL(links[links.length - 1][2]).searchParams.get('verifyToken');
        await new Promise(r => setTimeout(r, 50));
      }
      return null;
    },
    async stop() {
      child.kill();
      await new Promise(r => child.once('exit', r));
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
    },
  };
}

async function startServer() {
  try {
    return await launch();
  } catch (e) {
    console.warn(`Server boot failed once (${e.message}); retrying.`);
    return launch();
  }
}

module.exports = { startServer };
