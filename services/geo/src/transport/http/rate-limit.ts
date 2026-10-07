/**
 * Per-replica fixed-window limiter for the guest-safe serviceability route.
 *
 * It bounds abuse from one client on one replica. It is NOT a distributed
 * budget: N replicas allow up to N times the limit. A shared Redis budget needs
 * the security-kit dependency (a Lane E lockfile change, request A-P01-05).
 * Memory is bounded: the key map is dropped at each window boundary and capped.
 */
export class FixedWindowRateLimit {
  private windowStart = 0;
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly perWindow: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(perWindow) || perWindow < 1) throw new Error('INVALID_RATE_LIMIT');
    if (!Number.isSafeInteger(windowMs) || windowMs < 1_000) throw new Error('INVALID_RATE_WINDOW');
  }

  take(key: string): boolean {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.counts.clear();
    }
    const used = this.counts.get(key) ?? 0;
    if (used >= this.perWindow) return false;
    // Under a flood of distinct keys, fail closed rather than grow without bound.
    if (used === 0 && this.counts.size >= this.maxKeys) return false;
    this.counts.set(key, used + 1);
    return true;
  }
}
