# Owned Raw-Code Scrapers

Three self-hosted scrapers — **Google Maps**, **SERP**, and a **bulk LinkedIn
corpus builder** — so marginal data cost collapses toward the raw-fetch floor
instead of paying per-record enrichment vendors. Records flow into the same GTM
dashboard as the Clay/Instantly integrations via `bridge.js`.

```
scrapers/
├── googlemaps.js     Business listings from the Maps UI (name/phone/site/rating…)
├── serp.js           Organic search results (Bing default, Google/DDG optional)
├── linkedin.js       Public-profile corpus builder (auth-gated, rate-capped)
├── bridge.js         Push scraped leads → dashboard webhook
├── cli.js            Command-line runner
└── lib/
    ├── browser.js       Playwright pool + minimal anti-bot hardening
    ├── rateLimiter.js   Per-host token-bucket (the knob that actually matters)
    ├── proxyPool.js     Round-robin proxy rotation + quarantine
    ├── store.js         Append-only JSONL corpus + dedup/resume index
    └── cost.js          Honest raw-vs-live cost accounting
```

## Quick start

```bash
npm install                     # installs playwright + cheerio (already in package.json)

# Google Maps — 60 dentist listings in Austin
node scrapers/cli.js maps "dentists in Austin TX" --limit 60

# SERP — 2 pages of Bing results
node scrapers/cli.js serp "best CRM for agencies" --engine bing --pages 2

# LinkedIn — profiles from a URL list (needs LI_AT, see below)
LI_AT=xxxx node scrapers/cli.js linkedin ./urls.txt --rate 6

# LinkedIn people search → profile URLs
LI_AT=xxxx node scrapers/cli.js search "VP Marketing SaaS" --pages 3 > urls.txt

# Cost estimate only (no scraping)
node scrapers/cli.js cost 100000 --ai --proxy

# Dump a corpus as JSON (one record per line)
node scrapers/cli.js export googlemaps
```

Add `--headful` to watch the browser, `--no-proxy` to run off your own IP.

## Feeding the dashboard

```js
const { scrapeMaps } = require('./scrapers/googlemaps');
const { pushToDashboard } = require('./scrapers/bridge');

const { records } = await scrapeMaps('roofers in Denver', { limit: 100 });
await pushToDashboard('acme-corp', records, 'googlemaps');
// → shows up in the live activity feed as "Lead captured (googlemaps): …"
```

Captured leads emit a neutral `lead_captured` activity — they do **not** inflate
email/call stats.

## The cost claims, honestly

Your framing is exactly right, and `cost.js` encodes it. There are two numbers
and vendors quote whichever flatters the pitch:

| | per record | records / penny | 100k records |
|---|---|---|---|
| **Raw fetch** (bandwidth + amortized compute, no proxy, no AI) | ~$0.0000162 | ~617 | ~$1.62 |
| **Live all-in** (residential proxy + AI extraction + retries) | ~$0.0091 | ~1 | ~$911 |

So **"10,000 websites per penny"** and **"1,000 LinkedIn profiles/sec at
<$0.000001/profile"** are defensible *only* as the raw-fetch, amortized-at-scale,
replaying-an-existing-corpus figure with the AI/proxy step deleted. As a live,
all-in, per-record cost they're off by **2–4 orders of magnitude** — the two
dominant costs (residential proxy bandwidth and LLM extraction tokens) are
precisely what those headlines drop. Run `node scrapers/cli.js cost N --ai
--proxy` to see the split for your own volume, and override the rates in
`lib/cost.js:DEFAULTS` with real invoice numbers.

The way you actually get near the headline number: build the corpus *once*
(slow, rate-limited, expensive per record), then serve/query it many times at
near-zero marginal cost. The "1,000/sec" is a read rate against owned data, not
a live scrape rate.

## Anti-bot reality

- **Rate limiting beats stealth.** `rateLimiter.js` (per-host token bucket) is the
  single most important defense. No "stealth" plugin saves you from an aggressive
  request rate. Defaults are deliberately gentle (Maps 20/min, LinkedIn 6/min).
- **Residential proxies are the real cost driver.** Datacenter IPs get blocked
  first. Provide them via `PROXIES` env (comma-separated) or `scrapers/proxies.txt`.
  Without proxies the scrapers still run off your own IP — fine for small jobs.
- **`browser.js` masks the two cheapest headless tells** (`navigator.webdriver`,
  languages) and randomizes UA/viewport. It is not, and cannot be, "undetectable."

## LinkedIn: read before running

This is the highest-risk target here.

- Scraping violates LinkedIn's User Agreement. Scraping *public* data isn't a CFAA
  violation after *hiQ v. LinkedIn* (9th Cir.), but LinkedIn still bans accounts/IPs
  and has won breach-of-contract claims. This is your legal call to make.
- Authenticated scraping risks **your account**. Use a **burner** you can lose, set
  `LI_AT` from its session cookie (or pass a Playwright `storageStatePath`), never
  your primary account.
- `linkedin.js` hard-caps the rate, dwells like a human, and **aborts the run** the
  moment it detects a security checkpoint rather than hammering a flagged account.
- The "1,000 profiles/sec" headline is fantasy against live LinkedIn — expect
  single-digit profiles/*minute* sustainably per warmed account. Grow the corpus
  slowly; query it fast.

## Storage & resume

Corpus is append-only JSONL in `scrapers/data/<source>.jsonl` with a sidecar
`.index` for O(1) dedup. Re-running a job **skips records already captured**, so
runs are resumable and idempotent. Corpus files and `proxies.txt` are gitignored.
Swap the store for Postgres/SQLite when it outgrows one box.

## Config

| Env | Purpose |
|-----|---------|
| `PROXIES` | Comma-separated proxy URLs (`http://user:pass@host:port`) |
| `LI_AT` | LinkedIn session cookie for authed profile scraping |
| `DASHBOARD_URL` | Dashboard base URL for `bridge.js` (default `http://localhost:3000`) |
| `SCRAPER_DATA_DIR` | Override corpus data directory |
| `CHROMIUM_PATH` / `PLAYWRIGHT_BROWSERS_PATH` | Chromium executable resolution |
