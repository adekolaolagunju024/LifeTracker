const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Boots the real server against a throwaway SQLite file so tests never touch
// the developer's database, and tears it down afterwards.
async function startServer() {
  const port = 4100 + Math.floor(Math.random() * 800);
  const dbPath = path.join(os.tmpdir(), `waypoint-test-${port}-${Date.now()}.sqlite`);
  const child = spawn(process.execPath, [path.join(__dirname, '../../backend/server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });

  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {}
    if (child.exitCode !== null) throw new Error(`Server exited during boot: ${stderr}`);
    await new Promise(r => setTimeout(r, 150));
  }

  return {
    base,
    async stop() {
      child.kill();
      await new Promise(r => child.once('exit', r));
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
    },
  };
}

module.exports = { startServer };
