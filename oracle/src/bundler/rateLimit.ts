/**
 * In-memory sliding-window rate limiter for the sponsor endpoints.
 *
 * /v1/send broadcasts handleOps on the oracle wallet's dime, so an open
 * endpoint is a free-gas faucet for anyone who can read the URL. This caps
 * how many ops a single address can sponsor per window. The limiter is
 * deliberately per-process and best-effort: it stops casual abuse and
 * scripted drains, not a determined attacker — for that, put the oracle
 * behind an authenticated proxy or allowlist (see DEPLOY.md).
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when the key may proceed, false when it is over the limit. */
  allow(key: string): boolean {
    if (this.limit <= 0) return true; // 0 = disabled
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Opportunistic full prune so an attacker rotating addresses can't grow
    // the map without bound; per-key pruning above keeps steady state cheap.
    if (this.hits.size > 10_000) this.prune(cutoff);
    return true;
  }

  private prune(cutoff: number): void {
    for (const [key, times] of this.hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length > 0) this.hits.set(key, kept);
      else this.hits.delete(key);
    }
  }
}