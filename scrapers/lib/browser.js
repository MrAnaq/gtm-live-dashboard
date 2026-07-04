// ── Browser pool ───────────────────────────────────────────────────────────────
// Thin wrapper over Playwright Chromium with the minimum viable "don't look like
// a headless bot" hardening: real UA, sane viewport, webdriver flag masked,
// per-context proxy, and human-ish helpers. This is NOT a full stealth suite —
// against LinkedIn/Google you will still need residential proxies and modest
// volume. Anyone selling you "undetectable" is selling you a ban.

const { chromium } = require('playwright');
const { ProxyPool } = require('./proxyPool');
const { sleep, jitter } = require('./rateLimiter');

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

// Executable resolution: honour a pinned Playwright install, else fall back to
// the sandbox's pre-provisioned Chromium so we never trigger a download.
function executablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base) {
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = fs.readdirSync(base).find((d) => d.startsWith('chromium-'));
      if (dir) {
        const p = path.join(base, dir, 'chrome-linux', 'chrome');
        if (fs.existsSync(p)) return p;
      }
    } catch { /* fall through to Playwright's own resolution */ }
  }
  return undefined; // let Playwright resolve
}

class BrowserPool {
  constructor({ headless = true, proxies, concurrency = 3 } = {}) {
    this.headless = headless;
    this.pool = proxies instanceof ProxyPool ? proxies : new ProxyPool(proxies);
    this.concurrency = concurrency;
    this.browser = null;
    this._uaIdx = 0;
  }

  async _launch() {
    if (this.browser) return this.browser;
    const exe = executablePath();
    this.browser = await chromium.launch({
      headless: this.headless,
      executablePath: exe,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    return this.browser;
  }

  _nextUA() {
    const ua = UA_POOL[this._uaIdx % UA_POOL.length];
    this._uaIdx++;
    return ua;
  }

  // Fresh isolated context (own cookies + proxy). Pass storageState to reuse a
  // logged-in session (e.g. LinkedIn's li_at cookie).
  async newContext({ storageState, locale = 'en-US' } = {}) {
    await this._launch();
    const proxy = this.pool.next();
    const ctx = await this.browser.newContext({
      userAgent: this._nextUA(),
      locale,
      viewport: { width: 1366, height: 768 },
      proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      storageState,
    });
    // Mask the two cheapest headless tells.
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });
    ctx._proxy = proxy;
    return ctx;
  }

  async close() {
    if (this.browser) { await this.browser.close(); this.browser = null; }
  }
}

// Human-ish incremental scroll — many result lists (Maps, LinkedIn search) only
// lazy-load as you scroll a specific container.
async function humanScroll(page, selector, { steps = 20, pause = 700 } = {}) {
  for (let i = 0; i < steps; i++) {
    const done = await page.evaluate((sel) => {
      const el = sel ? document.querySelector(sel) : document.scrollingElement;
      if (!el) return true;
      const before = el.scrollTop;
      el.scrollBy(0, el.clientHeight * 0.9);
      return el.scrollTop === before; // no movement → bottom reached
    }, selector).catch(() => true);
    if (done) break;
    await sleep(pause + jitter(500));
  }
}

module.exports = { BrowserPool, humanScroll, UA_POOL };
