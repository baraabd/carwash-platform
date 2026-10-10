/**
 * Per-replica fixed-window budget per verified subject (or service client).
 *
 * It bounds abuse from one principal on one replica. It is NOT a distributed
 * budget: N replicas allow up to N times the limit (a shared budget needs the
 * security-kit dependency, a Lane E lockfile change). Memory is bounded: the
 * key map is dropped at each window boundary and capped; under a flood of
 * distinct keys it fails closed.
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
    if (used === 0 && this.counts.size >= this.maxKeys) return false;
    this.counts.set(key, used + 1);
    return true;
  }
}

export interface ConfigurationRateLimits {
  readonly commands: FixedWindowRateLimit;
  readonly reads: FixedWindowRateLimit;
  readonly service: FixedWindowRateLimit;
}

function perMinute(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]{0,6}$/.test(raw)) throw new Error(`${name}_INVALID`);
  return Number(raw);
}

/**
 * Per minute: 30 commands and 240 staff reads per subject, 600 service reads
 * per client, unless overridden (positive integers only; anything else fails
 * the boot rather than silently disabling the budget).
 */
export function rateLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): ConfigurationRateLimits {
  const window = (name: string, fallback: number) =>
    new FixedWindowRateLimit(perMinute(env[name], fallback, name), 60_000);
  return {
    commands: window('CONFIGURATION_RATE_COMMANDS_PER_MINUTE', 30),
    reads: window('CONFIGURATION_RATE_READS_PER_MINUTE', 240),
    service: window('CONFIGURATION_RATE_SERVICE_PER_MINUTE', 600),
  };
}
