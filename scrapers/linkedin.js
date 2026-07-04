// ── LinkedIn corpus builder ─────────────────────────────────────────────────────
// Builds a bulk corpus of LinkedIn *public* profile data. Read this header before
// you run it — LinkedIn is the highest-risk target in this repo:
//
//   • It violates LinkedIn's User Agreement. Scraping public data is not itself
//     a CFAA violation post-hiQ v. LinkedIn (9th Cir.), but LinkedIn still bans
//     accounts and IPs aggressively and has won breach-of-contract claims.
//   • Authenticated scraping (using your li_at cookie) puts YOUR account at real
//     ban risk. Use a burner account you can afford to lose, never your main one.
//   • Volume is the tell. "1,000 profiles/sec" is a fantasy against live
//     LinkedIn — you'll be challenged within dozens of requests. That headline
//     number describes replaying an ALREADY-CAPTURED corpus, not live scraping.
//     Realistic sustainable live rate per warmed account is single-digit
//     profiles per MINUTE. Plan around a corpus you grow slowly, then serve fast.
//
// This module is deliberately conservative: hard per-account rate caps, jittered
// pacing, challenge detection that aborts rather than hammers, and checkpointing
// so a run resumes instead of re-hitting profiles.
//
// Auth: export LI_AT with your session cookie, or pass storageStatePath to a
// Playwright storage-state JSON captured from a logged-in browser.
//
// Usage:
//   const { scrapeProfiles, searchPeople } = require('./linkedin');
//   await scrapeProfiles(['https://www.linkedin.com/in/some-handle/'], {});

const fs = require('fs');
const { BrowserPool, humanScroll } = require('./lib/browser');
const { limiterFor, sleep, jitter } = require('./lib/rateLimiter');
const { Corpus } = require('./lib/store');
const cost = require('./lib/cost');

const HOST = 'www.linkedin.com';

function buildStorageState(opts) {
  if (opts.storageStatePath && fs.existsSync(opts.storageStatePath)) {
    return JSON.parse(fs.readFileSync(opts.storageStatePath, 'utf8'));
  }
  const li_at = opts.li_at || process.env.LI_AT;
  if (!li_at) return undefined; // will only see logged-out public views (very limited)
  return {
    cookies: [{
      name: 'li_at', value: li_at, domain: '.linkedin.com', path: '/',
      httpOnly: true, secure: true, sameSite: 'None',
    }],
    origins: [],
  };
}

async function scrapeProfiles(urls, opts = {}) {
  const {
    // Deliberately low. Do not raise this to chase the marketing numbers.
    ratePerMin = 6,
    maxPerRun = 150,
    headless = true,
    proxies,
    onRecord,
  } = opts;

  const corpus = new Corpus('linkedin');
  const storageState = buildStorageState(opts);
  if (!storageState) {
    console.warn('[linkedin] no LI_AT / storageState — only logged-out public data, expect sparse fields');
  }

  const pool = new BrowserPool({ headless, proxies });
  const limiter = limiterFor(HOST, { ratePerMin, burst: 2 });
  const ctx = await pool.newContext({ storageState });
  const results = [];
  let challenged = false;

  try {
    const targets = urls.filter((u) => !corpus.has({ profile_url: canonical(u) })).slice(0, maxPerRun);
    for (const url of targets) {
      await limiter.take();
      const page = await ctx.newPage();
      try {
        await page.goto(canonical(url), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(1500 + jitter(2000)); // dwell like a human reading

        if (await isChallenged(page)) {
          console.error('[linkedin] challenge/checkpoint hit — aborting run to protect the account');
          challenged = true;
          break;
        }

        await humanScroll(page, null, { steps: 6, pause: 900 }); // trigger lazy sections
        const rec = await extractProfile(page, url);
        if (rec && rec.name && corpus.add(rec)) {
          results.push(rec);
          if (onRecord) onRecord(rec);
        }
      } catch (e) {
        await sleep(jitter(1500));
      } finally {
        await page.close();
      }
    }
  } finally {
    await ctx.close();
    await pool.close();
  }

  console.log('[linkedin]', cost.summarize(results.length, { avgPageKB: 900, useAI: true }));
  return {
    count: results.length,
    corpusTotal: corpus.count(),
    challenged,
    records: results,
  };
}

// Search people by keyword and collect result profile URLs (then feed to
// scrapeProfiles). Requires auth. Very rate-sensitive.
async function searchPeople(keyword, opts = {}) {
  const { maxPages = 3, ratePerMin = 5, headless = true, proxies } = opts;
  const storageState = buildStorageState(opts);
  if (!storageState) throw new Error('searchPeople requires auth (LI_AT or storageStatePath)');

  const pool = new BrowserPool({ headless, proxies });
  const limiter = limiterFor(HOST, { ratePerMin, burst: 2 });
  const ctx = await pool.newContext({ storageState });
  const urls = new Set();

  try {
    for (let p = 1; p <= maxPages; p++) {
      await limiter.take();
      const page = await ctx.newPage();
      try {
        const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}&page=${p}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(1500 + jitter(1500));
        if (await isChallenged(page)) break;
        await humanScroll(page, null, { steps: 8, pause: 800 });
        const links = await page.$$eval('a[href*="/in/"]',
          (as) => [...new Set(as.map((a) => a.href.split('?')[0]))]);
        links.forEach((l) => urls.add(l));
        if (links.length === 0) break;
      } finally { await page.close(); }
    }
  } finally {
    await ctx.close();
    await pool.close();
  }
  return [...urls];
}

async function extractProfile(page, sourceUrl) {
  return page.evaluate((src) => {
    const txt = (sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() || null;
    const clean = (s) => (s ? s.replace(/\s+/g, ' ').trim() : null);

    // LinkedIn's authed profile DOM keys off stable-ish section anchors.
    const name = txt('h1');
    const headline = txt('div.text-body-medium.break-words') || txt('.pv-text-details__left-panel .text-body-medium');
    const location = txt('.pv-text-details__left-panel .text-body-small.inline') ||
      txt('span.text-body-small.inline.t-black--light.break-words');

    // Current experience (first item in the Experience section).
    let current_company = null, current_title = null;
    const expSection = document.querySelector('#experience')?.closest('section');
    if (expSection) {
      const first = expSection.querySelector('li');
      if (first) {
        current_title = clean(first.querySelector('.t-bold span[aria-hidden="true"]')?.textContent);
        current_company = clean(first.querySelector('.t-14.t-normal span[aria-hidden="true"]')?.textContent);
      }
    }

    // Fallback for logged-out public pages (JSON-LD person object).
    let jsonld = null;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent);
        const graph = Array.isArray(data['@graph']) ? data['@graph'] : [data];
        jsonld = graph.find((g) => g['@type'] === 'Person') || jsonld;
      } catch { /* ignore */ }
    }

    return {
      profile_url: src.split('?')[0].replace(/\/$/, ''),
      name: name || jsonld?.name || null,
      headline: headline || jsonld?.jobTitle?.[0] || jsonld?.description || null,
      location: location || jsonld?.address?.addressLocality || null,
      current_company: current_company || jsonld?.worksFor?.[0]?.name || null,
      current_title,
      image: jsonld?.image?.contentUrl || null,
    };
  }, sourceUrl);
}

// Detect the auth-wall / security-checkpoint / rate-limit interstitials so we
// stop instead of pounding a flagged account into a permanent ban.
async function isChallenged(page) {
  const url = page.url();
  if (/\/(checkpoint|authwall|uas\/login)/.test(url)) return true;
  const body = await page.textContent('body').catch(() => '');
  return /(unusual activity|verify you.?re a human|security verification|Let.?s do a quick security check)/i.test(body || '');
}

function canonical(u) {
  try {
    const url = new URL(u.startsWith('http') ? u : `https://www.linkedin.com/in/${u}`);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}/`;
  } catch { return u; }
}

module.exports = { scrapeProfiles, searchPeople, canonical };
