// ── Google Maps scraper ─────────────────────────────────────────────────────────
// Drives the Maps search UI and harvests business listings: name, category,
// address, phone, website, rating, review count, coordinates. Maps lazy-loads
// results into a scrollable side panel, so we scroll the panel, collect the card
// links, then visit each detail pane.
//
// This scrapes the public Maps web UI, which is against Google's ToS. For a
// sanctioned path use the Places API (paid, ~$17–32 / 1k requests). This module
// is the "own it" alternative — cheaper at volume, higher operational risk.
//
// Usage:
//   const { scrapeMaps } = require('./googlemaps');
//   await scrapeMaps('dentists in Austin TX', { limit: 60 });

const { BrowserPool, humanScroll } = require('./lib/browser');
const { limiterFor, sleep, jitter } = require('./lib/rateLimiter');
const { Corpus } = require('./lib/store');
const cost = require('./lib/cost');

const HOST = 'www.google.com';
const RESULTS_PANEL = 'div[role="feed"]';

async function scrapeMaps(query, opts = {}) {
  const {
    limit = 40,
    headless = true,
    proxies,
    ratePerMin = 20, // gentle: Maps blocks fast
    onRecord,
  } = opts;

  const corpus = new Corpus('googlemaps');
  const pool = new BrowserPool({ headless, proxies });
  const limiter = limiterFor(HOST, { ratePerMin, burst: 4 });
  const results = [];

  const ctx = await pool.newContext();
  const page = await ctx.newPage();

  try {
    await limiter.take();
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await consentIfPresent(page);

    // Some queries land straight on a single place; most on the feed.
    await page.waitForSelector(RESULTS_PANEL, { timeout: 15000 }).catch(() => {});

    // Scroll the feed until we have enough cards or it stops growing.
    let cardLinks = [];
    for (let round = 0; round < 30 && cardLinks.length < limit; round++) {
      await humanScroll(page, RESULTS_PANEL, { steps: 3, pause: 900 });
      cardLinks = await page.$$eval(`${RESULTS_PANEL} a[href*="/maps/place/"]`,
        (as) => [...new Set(as.map((a) => a.href))]);
      const end = await page.$('span:has-text("You\'ve reached the end")').catch(() => null);
      if (end) break;
    }
    cardLinks = cardLinks.slice(0, limit);

    for (const href of cardLinks) {
      await limiter.take();
      try {
        const rec = await scrapeDetail(page, href, query);
        if (rec && rec.name) {
          if (corpus.add(rec)) {
            results.push(rec);
            if (onRecord) onRecord(rec);
          }
        }
      } catch (e) {
        // one bad card shouldn't kill the run
        await sleep(jitter(800));
      }
    }
  } finally {
    await ctx.close();
    await pool.close();
  }

  console.log('[googlemaps]', cost.summarize(results.length, { useAI: false })); // selector-parsed → no AI cost
  return { query, count: results.length, corpusTotal: corpus.count(), records: results };
}

// Open a place pane and read the detail fields from the aria-labelled buttons
// Maps renders. Selectors are resilient to class-name churn by keying on
// data-item-id / aria-label rather than hashed classes.
async function scrapeDetail(page, href, query) {
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});
  await sleep(500 + jitter(600));

  return page.evaluate((q) => {
    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || null;

    const name = txt('h1');
    const rating = parseFloat(txt('div.fontDisplayLarge') || attr('[role="img"][aria-label*="stars"]', 'aria-label') || '') || null;
    const reviewsRaw = document.querySelector('button[aria-label*="reviews"]')?.getAttribute('aria-label') || '';
    const reviews = parseInt((reviewsRaw.match(/([\d,]+)\s+reviews/) || [])[1]?.replace(/,/g, '') || '') || null;

    const address = attr('button[data-item-id="address"]', 'aria-label')?.replace(/^Address:\s*/, '') || null;
    const phone = attr('button[data-item-id^="phone"]', 'aria-label')?.replace(/^Phone:\s*/, '') || null;
    const website = document.querySelector('a[data-item-id="authority"]')?.href || null;
    const category = txt('button[jsaction*="category"]') || txt('button.DkEaL') || null;

    // Coordinates live in the URL after the place resolves.
    const m = location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const place_id = (location.href.match(/!1s([^!]+)/) || [])[1] || location.href;

    return {
      place_id,
      name, category, address, phone, website,
      rating, reviews,
      lat: m ? parseFloat(m[1]) : null,
      lng: m ? parseFloat(m[2]) : null,
      query: q,
      url: location.href,
    };
  }, query);
}

async function consentIfPresent(page) {
  // Google's EU consent wall blocks the feed until dismissed.
  for (const label of ['Accept all', 'Reject all', 'I agree']) {
    const btn = await page.$(`button:has-text("${label}")`).catch(() => null);
    if (btn) { await btn.click().catch(() => {}); await sleep(800); return; }
  }
}

module.exports = { scrapeMaps };
