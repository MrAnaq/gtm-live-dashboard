#!/usr/bin/env node
// ── Scraper CLI ─────────────────────────────────────────────────────────────────
// Thin command-line front end over the three scrapers + cost estimator.
//
//   node scrapers/cli.js maps "dentists in Austin TX" --limit 60
//   node scrapers/cli.js serp "best CRM for agencies" --engine bing --pages 2
//   node scrapers/cli.js linkedin ./urls.txt --rate 6
//   node scrapers/cli.js search "VP Marketing SaaS" --pages 3   (linkedin people search)
//   node scrapers/cli.js cost 100000 --ai --proxy                 (estimate only)
//   node scrapers/cli.js export googlemaps                        (dump corpus as JSON)
//
// Flags: --headful (show browser), --limit N, --pages N, --engine X, --rate N,
//        --ai / --no-ai, --proxy / --no-proxy

const fs = require('fs');

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = pos;
  const headless = !flags.headful;
  const useProxy = flags.proxy === true || flags['no-proxy'] !== true;
  const log = (r) => console.log(`  + ${r.name || r.title || r.profile_url || r.url}`);

  switch (cmd) {
    case 'maps': {
      const { scrapeMaps } = require('./googlemaps');
      const res = await scrapeMaps(arg, {
        limit: +(flags.limit || 40), headless, onRecord: log,
      });
      console.log(`\n✓ ${res.count} new listings (corpus total ${res.corpusTotal})`);
      break;
    }
    case 'serp': {
      const { scrapeSerp } = require('./serp');
      const res = await scrapeSerp(arg, {
        engine: flags.engine || 'bing', pages: +(flags.pages || 1), headless, onRecord: log,
      });
      console.log(`\n✓ ${res.count} new results from ${res.engine} (corpus total ${res.corpusTotal})`);
      break;
    }
    case 'linkedin': {
      const { scrapeProfiles } = require('./linkedin');
      const urls = fs.existsSync(arg)
        ? fs.readFileSync(arg, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
        : [arg];
      const res = await scrapeProfiles(urls, {
        ratePerMin: +(flags.rate || 6), headless, onRecord: log,
      });
      console.log(`\n✓ ${res.count} new profiles${res.challenged ? ' (STOPPED: challenge hit)' : ''} (corpus total ${res.corpusTotal})`);
      break;
    }
    case 'search': {
      const { searchPeople } = require('./linkedin');
      const urls = await searchPeople(arg, { maxPages: +(flags.pages || 3), headless });
      console.log(urls.join('\n'));
      console.error(`\n✓ ${urls.length} profile URLs (pipe to a file, then: cli.js linkedin thatfile)`);
      break;
    }
    case 'cost': {
      const cost = require('./lib/cost');
      const n = +(arg || 10000);
      const est = cost.perRecord({ useAI: flags.ai === true, useProxy: useProxy });
      console.log(cost.summarize(n, { useAI: flags.ai === true, useProxy }));
      console.log('\nbreakdown per record ($):', est.breakdown);
      break;
    }
    case 'export': {
      const { Corpus } = require('./lib/store');
      const c = new Corpus(arg || 'googlemaps');
      for (const rec of c.read()) process.stdout.write(JSON.stringify(rec) + '\n');
      break;
    }
    default:
      console.log(fs.readFileSync(require('path').join(__dirname, 'cli.js'), 'utf8')
        .split('\n').slice(1, 18).join('\n').replace(/^\/\/ ?/gm, ''));
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
