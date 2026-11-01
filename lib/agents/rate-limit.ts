// A token bucket per key: `perMinute` requests allowed in a burst, refilled continuously.
// ponytail: this lives in one process's memory. If the app ever runs as more than one instance, move the counters to
// the database; until then the limit is per instance, which is the same thing.
export function createLimiter(opts: { perMinute: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const refillPerMs = opts.perMinute / 60_000;
  const buckets = new Map<string, { tokens: number; at: number }>();
  let lastSweep = now();

  function allow(key: string): boolean {
    const t = now();
    // Forget keys idle for two minutes (their bucket would be full again), so memory does not grow without bound.
    if (t - lastSweep > 60_000) {
      for (const [k, b] of buckets) if (t - b.at > 120_000) buckets.delete(k);
      lastSweep = t;
    }
    const b = buckets.get(key) ?? { tokens: opts.perMinute, at: t };
    const tokens = Math.min(opts.perMinute, b.tokens + (t - b.at) * refillPerMs);
    if (tokens < 1) {
      buckets.set(key, { tokens, at: t });
      return false;
    }
    buckets.set(key, { tokens: tokens - 1, at: t });
    return true;
  }
  allow.size = () => buckets.size;
  return allow;
}
