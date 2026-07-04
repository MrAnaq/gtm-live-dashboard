// ── Honest cost accounting ─────────────────────────────────────────────────────
// This module exists to keep everyone honest about what a scraped record ACTUALLY
// costs. The headline numbers you hear ("10,000 websites per penny", "1,000
// LinkedIn profiles/sec at <$0.000001/profile") are real — but they are AMORTIZED
// RAW-FETCH costs at ideal scale, on hardware you've already paid for, with the
// AI/parsing step removed. Read as live, all-in, per-record cost they are off by
// two to four orders of magnitude. We track both so nobody confuses them.
//
// Two figures per record:
//   rawCost  — bandwidth + amortized compute for the fetch alone
//   liveCost — rawCost + proxy per-GB + retries + AI extraction tokens + storage
//
// Defaults are conservative mid-market rates (2025-era). Override with real
// invoice numbers to get numbers you can actually put in a budget.

const DEFAULTS = {
  // Infra (amortized): a $40/mo box doing ~5M fetches/mo ≈ $0.000008/fetch.
  computePerFetch: 0.000008,
  bandwidthPerGB: 0.01, // egress on a cheap VPS; often effectively free inbound
  avgPageKB: 400, // median rendered page transfer

  // Proxies: residential is the real cost driver. $3–8/GB is typical.
  residentialProxyPerGB: 5.0,
  useProxy: true,

  // Reality tax: not every request succeeds first try.
  retryFactor: 1.35, // avg attempts per successful record (blocks, timeouts)

  // AI extraction: turning raw HTML into structured fields. This is usually the
  // DOMINANT live cost and the one the marketing quietly drops. ~6k in / 400 out
  // tokens per page on a cheap model.
  aiInputTokens: 6000,
  aiOutputTokens: 400,
  aiInputPerMTok: 0.80,  // $/1M input tokens (cheap/fast tier)
  aiOutputPerMTok: 4.00, // $/1M output tokens
  useAI: true, // set false if you parse with selectors instead of an LLM

  storagePerRecord: 0.0000002, // object storage, negligible but nonzero
};

function perRecord(overrides = {}) {
  const c = { ...DEFAULTS, ...overrides };
  const gb = c.avgPageKB / 1_000_000;

  const bandwidth = gb * c.bandwidthPerGB;
  const proxy = c.useProxy ? gb * c.residentialProxyPerGB : 0;
  const ai = c.useAI
    ? (c.aiInputTokens / 1e6) * c.aiInputPerMTok + (c.aiOutputTokens / 1e6) * c.aiOutputPerMTok
    : 0;

  const rawCost = (c.computePerFetch + bandwidth) * c.retryFactor;
  const liveCost = (c.computePerFetch + bandwidth + proxy) * c.retryFactor + ai + c.storagePerRecord;

  return {
    rawCost,
    liveCost,
    breakdown: {
      compute: c.computePerFetch * c.retryFactor,
      bandwidth: bandwidth * c.retryFactor,
      proxy: proxy * c.retryFactor,
      ai,
      storage: c.storagePerRecord,
    },
    // Sanity-check framing against the marketing claims.
    recordsPerPenny: { raw: 0.01 / rawCost, live: 0.01 / liveCost },
  };
}

// Pretty one-liner for logs.
function summarize(n, overrides = {}) {
  const p = perRecord(overrides);
  const usd = (x) => `$${x.toFixed(8)}`;
  return [
    `${n} records`,
    `raw ≈ ${usd(p.rawCost)}/rec (${Math.round(p.recordsPerPenny.raw).toLocaleString()}/penny)`,
    `live ≈ ${usd(p.liveCost)}/rec (${Math.round(p.recordsPerPenny.live).toLocaleString()}/penny)`,
    `→ batch live cost ≈ $${(p.liveCost * n).toFixed(4)}`,
  ].join('  |  ');
}

module.exports = { perRecord, summarize, DEFAULTS };
