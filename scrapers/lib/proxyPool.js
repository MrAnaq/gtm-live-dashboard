// ── Proxy rotation ─────────────────────────────────────────────────────────────
// Rotates a pool of proxies round-robin and quarantines any that fail. For real
// bulk work you want RESIDENTIAL or mobile proxies — datacenter IPs are the first
// thing Google/LinkedIn block. Provide them via PROXIES env (comma-separated) or
// a proxies.txt file, one per line:
//
//   http://user:pass@host:port
//   socks5://user:pass@host:port
//
// Without proxies the scrapers still run — straight off your own IP — which is
// fine for small/occasional jobs but will get rate-limited or blocked at volume.

const fs = require('fs');
const path = require('path');

function loadProxies() {
  const out = [];
  if (process.env.PROXIES) {
    out.push(...process.env.PROXIES.split(',').map((s) => s.trim()).filter(Boolean));
  }
  const file = path.join(__dirname, '..', 'proxies.txt');
  if (fs.existsSync(file)) {
    out.push(
      ...fs.readFileSync(file, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'))
    );
  }
  return [...new Set(out)];
}

class ProxyPool {
  constructor(list = loadProxies()) {
    this.all = list;
    this.idx = 0;
    this.quarantine = new Map(); // proxy -> unblock timestamp (ms)
  }

  get size() { return this.all.length; }

  // Next healthy proxy as a Playwright { server, username, password } object,
  // or null when the pool is empty (→ run direct).
  next() {
    if (this.all.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this.all.length; i++) {
      const p = this.all[(this.idx + i) % this.all.length];
      const until = this.quarantine.get(p);
      if (until && until > now) continue;
      this.idx = (this.idx + i + 1) % this.all.length;
      return parseProxy(p);
    }
    // Everything is quarantined — return the least-recently-benched one anyway.
    const p = this.all[this.idx % this.all.length];
    this.idx++;
    return parseProxy(p);
  }

  // Bench a proxy for `cooldownMs` after it fails (block, timeout, bad auth).
  fail(serverUrl, cooldownMs = 5 * 60 * 1000) {
    const raw = this.all.find((p) => p.includes(stripCreds(serverUrl)));
    if (raw) this.quarantine.set(raw, Date.now() + cooldownMs);
  }
}

function parseProxy(raw) {
  try {
    const u = new URL(raw);
    const server = `${u.protocol}//${u.host}`;
    const out = { server, _raw: raw };
    if (u.username) out.username = decodeURIComponent(u.username);
    if (u.password) out.password = decodeURIComponent(u.password);
    return out;
  } catch {
    return { server: raw, _raw: raw };
  }
}

function stripCreds(serverUrl) {
  try { return new URL(serverUrl).host; } catch { return serverUrl; }
}

module.exports = { ProxyPool, loadProxies };
