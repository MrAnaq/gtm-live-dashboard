// ── Corpus store ───────────────────────────────────────────────────────────────
// Append-only JSONL per source + an on-disk dedup index. Zero native deps, safe
// to resume: re-running a job skips records already captured. Swap for Postgres/
// SQLite when the corpus outgrows a single box, but JSONL is the right default —
// it's greppable, streamable, and never corrupts on a mid-write crash.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.SCRAPER_DATA_DIR || path.join(__dirname, '..', 'data');

class Corpus {
  constructor(source) {
    this.source = source; // 'googlemaps' | 'serp' | 'linkedin'
    this.file = path.join(DATA_DIR, `${source}.jsonl`);
    this.indexFile = path.join(DATA_DIR, `${source}.index`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.seen = this._loadIndex();
    this.added = 0;
    this.skipped = 0;
  }

  _loadIndex() {
    const set = new Set();
    if (fs.existsSync(this.indexFile)) {
      for (const line of fs.readFileSync(this.indexFile, 'utf8').split('\n')) {
        if (line) set.add(line);
      }
    }
    return set;
  }

  // Stable dedup key. Prefer an explicit natural key (profile URL, place_id),
  // else hash the record.
  static keyOf(rec) {
    const natural = rec.place_id || rec.profile_url || rec.url || rec.id;
    if (natural) return crypto.createHash('sha1').update(String(natural)).digest('hex').slice(0, 16);
    return crypto.createHash('sha1').update(JSON.stringify(rec)).digest('hex').slice(0, 16);
  }

  has(rec) { return this.seen.has(Corpus.keyOf(rec)); }

  // Append a record unless already present. Returns true if written.
  add(rec) {
    const key = Corpus.keyOf(rec);
    if (this.seen.has(key)) { this.skipped++; return false; }
    const enriched = { ...rec, _source: this.source, _scraped_at: rec._scraped_at || nowIso() };
    fs.appendFileSync(this.file, JSON.stringify(enriched) + '\n');
    fs.appendFileSync(this.indexFile, key + '\n');
    this.seen.add(key);
    this.added++;
    return true;
  }

  addMany(recs) { return recs.map((r) => this.add(r)).filter(Boolean).length; }

  count() { return this.seen.size; }

  // Stream all records (for export / feeding the dashboard pipeline).
  *read() {
    if (!fs.existsSync(this.file)) return;
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (line) { try { yield JSON.parse(line); } catch { /* skip bad line */ } }
    }
  }
}

// nowIso avoids argless `new Date()` for sandbox-compat via explicit timestamp.
function nowIso() { return new Date(Date.now()).toISOString(); }

module.exports = { Corpus, DATA_DIR };
