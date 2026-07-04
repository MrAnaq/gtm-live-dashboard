// ── SERP scraper ────────────────────────────────────────────────────────────────
// Harvests organic search results (title, url, displayed link, snippet) for a
// query. Google's web SERP is the most aggressively anti-bot surface on the
// internet; Bing is far more tolerant and returns near-equivalent results for
// lead-gen intent. So we default to Bing and offer Google as an opt-in.
//
// Two fetch strategies:
//   'http'    — plain fetch of the results HTML, parsed with cheerio. Fastest &
//               cheapest, works great on Bing, brittle on Google.
//   'browser' — full Playwright render. Slower, survives JS challenges, needed
//               for Google at any volume.
//
// Usage:
//   const { scrapeSerp } = require('./serp');
//   await scrapeSerp('best CRM for agencies', { engine: 'bing', pages: 2 });

const cheerio = require('cheerio');
const { BrowserPool } = require('./lib/browser');
const { limiterFor, sleep, jitter } = require('./lib/rateLimiter');
const { Corpus } = require('./lib/store');
const { UA_POOL } = require('./lib/browser');
const cost = require('./lib/cost');

const ENGINES = {
  bing: {
    host: 'www.bing.com',
    url: (q, n) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&first=${n * 10 + 1}`,
    parse: parseBing,
  },
  google: {
    host: 'www.google.com',
    url: (q, n) => `https://www.google.com/search?q=${encodeURIComponent(q)}&start=${n * 10}&hl=en`,
    parse: parseGoogle,
  },
  duckduckgo: {
    host: 'html.duckduckgo.com',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDuck,
  },
};

async function scrapeSerp(query, opts = {}) {
  const {
    engine = 'bing',
    pages = 1,
    strategy = engine === 'google' ? 'browser' : 'http',
    ratePerMin = 30,
    headless = true,
    proxies,
    onRecord,
  } = opts;

  const eng = ENGINES[engine];
  if (!eng) throw new Error(`unknown engine: ${engine} (have: ${Object.keys(ENGINES).join(', ')})`);

  const corpus = new Corpus('serp');
  const limiter = limiterFor(eng.host, { ratePerMin, burst: 5 });
  const results = [];

  let pool = null;
  let ctx = null;
  if (strategy === 'browser') {
    pool = new BrowserPool({ headless, proxies });
    ctx = await pool.newContext();
  }

  try {
    for (let n = 0; n < pages; n++) {
      await limiter.take();
      const url = eng.url(query, n);
      let html;
      if (strategy === 'browser') {
        const page = await ctx.newPage();
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(600 + jitter(700));
          html = await page.content();
        } finally { await page.close(); }
      } else {
        html = await fetchHtml(url);
      }

      const rows = eng.parse(html, query, n);
      for (const r of rows) {
        r.rank = (r.rank ?? 0) + n * 10;
        if (corpus.add(r)) {
          results.push(r);
          if (onRecord) onRecord(r);
        }
      }
      if (rows.length === 0) break; // no more results / soft-blocked
    }
  } finally {
    if (ctx) await ctx.close();
    if (pool) await pool.close();
  }

  console.log('[serp]', cost.summarize(results.length, { useAI: false, avgPageKB: 120 }));
  return { query, engine, count: results.length, corpusTotal: corpus.count(), records: results };
}

async function fetchHtml(url) {
  const ua = UA_POOL[0];
  const res = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`SERP fetch ${res.status}`);
  return res.text();
}

// ── Per-engine parsers ──────────────────────────────────────────────────────────
function parseBing(html, query) {
  const $ = cheerio.load(html);
  const out = [];
  $('#b_results > li.b_algo').each((i, el) => {
    const a = $(el).find('h2 a').first();
    const url = a.attr('href');
    if (!url) return;
    out.push({
      engine: 'bing', query, rank: i,
      title: a.text().trim(),
      url,
      display_link: $(el).find('.b_attribution cite').first().text().trim() || hostOf(url),
      snippet: $(el).find('.b_caption p').first().text().trim() || null,
    });
  });
  return out;
}

function parseGoogle(html, query) {
  const $ = cheerio.load(html);
  const out = [];
  $('div.g, div[data-sokoban-container]').each((i, el) => {
    const a = $(el).find('a[href^="http"]').first();
    const url = a.attr('href');
    const title = $(el).find('h3').first().text().trim();
    if (!url || !title) return;
    out.push({
      engine: 'google', query, rank: out.length,
      title, url,
      display_link: $(el).find('cite').first().text().trim() || hostOf(url),
      snippet: $(el).find('div[data-sncf], .VwiC3b').first().text().trim() || null,
    });
  });
  return out;
}

function parseDuck(html, query) {
  const $ = cheerio.load(html);
  const out = [];
  $('.result').each((i, el) => {
    const a = $(el).find('.result__a').first();
    const url = a.attr('href');
    if (!url) return;
    out.push({
      engine: 'duckduckgo', query, rank: i,
      title: a.text().trim(),
      url,
      display_link: $(el).find('.result__url').first().text().trim() || hostOf(url),
      snippet: $(el).find('.result__snippet').first().text().trim() || null,
    });
  });
  return out;
}

function hostOf(url) { try { return new URL(url).host; } catch { return null; } }

module.exports = { scrapeSerp, ENGINES };
