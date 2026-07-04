// ── Per-host token-bucket rate limiter ─────────────────────────────────────────
// Keeps request rate below a threshold *per hostname* so one aggressive target
// can't get the whole IP burned. This is the single most important knob for not
// getting blocked — far more than any "stealth" trick.

class TokenBucket {
  constructor({ ratePerMin = 30, burst = 5 } = {}) {
    this.capacity = burst;
    this.tokens = burst;
    this.refillPerMs = ratePerMin / 60000; // tokens per ms
    this.last = null; // set on first use; Date.now() is fine here
  }

  _refill() {
    const now = Date.now();
    if (this.last == null) { this.last = now; return; }
    const elapsed = now - this.last;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.last = now;
  }

  // Resolves once a token is available. Adds small jitter so requests never
  // land on a perfectly periodic clock (a trivial bot tell).
  async take() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      await sleep(jitter(150));
      return;
    }
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil(deficit / this.refillPerMs);
    await sleep(waitMs + jitter(400));
    return this.take();
  }
}

const buckets = new Map();

// Get (or lazily create) the bucket for a hostname.
function limiterFor(host, opts) {
  if (!buckets.has(host)) buckets.set(host, new TokenBucket(opts));
  return buckets.get(host);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Deterministic-enough jitter without Math.random (unavailable in some
// sandboxes): mix the clock's low bits into a spread of [0, span).
function jitter(span) {
  const seed = (Date.now() % 997) / 997;
  return Math.floor(seed * span);
}

module.exports = { TokenBucket, limiterFor, sleep, jitter };
