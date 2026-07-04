// ── Dashboard bridge ────────────────────────────────────────────────────────────
// Feeds scraped records into the running GTM dashboard by posting to the same
// webhook the Clay/Instantly integrations use, so owned-scrape leads show up in
// the live activity feed exactly like paid-enrichment ones. This keeps the
// dashboard the single source of truth regardless of where a lead came from.
//
// Usage:
//   const { pushToDashboard } = require('./bridge');
//   await pushToDashboard('acme-corp', mapsRecords, 'googlemaps');

const DEFAULT_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

// Map a scraped record to the dashboard's Clay-webhook shape. We emit a neutral
// "system" activity per new lead — these are captured leads, not send/reply
// events, so they don't inflate email/call stats.
function toEvent(rec, source) {
  const name = rec.name || rec.title || rec.profile_url || rec.url || 'Unknown';
  return {
    event_type: 'lead_captured',
    source, // 'googlemaps' | 'serp' | 'linkedin'
    contact: {
      name: rec.name || null,
      email: rec.email || null,
      phone: rec.phone || null,
    },
    company: rec.current_company || rec.name || null,
    notes: rec.headline || rec.snippet || rec.category || null,
    url: rec.website || rec.profile_url || rec.url || null,
    _lead: rec,
    _display: `Lead captured (${source}): ${name}`,
  };
}

async function pushToDashboard(clientId, records, source, opts = {}) {
  const url = `${opts.dashboardUrl || DEFAULT_URL}/webhook/clay?client=${encodeURIComponent(clientId)}`;
  const batchSize = opts.batchSize || 50;
  let sent = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize).map((r) => toEvent(r, source));
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    }).catch((e) => ({ ok: false, _err: e.message }));
    if (res.ok) sent += batch.length;
    else console.error(`[bridge] batch failed: ${res.status || res._err}`);
  }
  console.log(`[bridge] pushed ${sent}/${records.length} ${source} leads → client ${clientId}`);
  return sent;
}

module.exports = { pushToDashboard, toEvent };
