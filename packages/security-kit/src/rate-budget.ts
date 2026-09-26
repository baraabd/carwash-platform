import { createClient } from '@redis/client';
import { keyedDigest } from './opaque';

export interface BudgetResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}
export interface RateBudget {
  take(scope: string, subject: string, limit: number, windowMs: number): Promise<BudgetResult>;
}

// Atomic fixed window: expiry is attached to the first increment in the same script.
// A response lost in transit can consume a budget without executing the protected action;
// that conservative outcome is intentional. No automatic retry can double-allow a request.
const CONSUME = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;
export class RedisRateBudget implements RateBudget {
  private readonly client: ReturnType<typeof createClient>;
  private constructor(
    url: string,
    private readonly key: Uint8Array,
  ) {
    if (key.byteLength < 32) throw new Error('BUDGET_KEY_TOO_SHORT');
    this.client = createClient({
      url,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 128,
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    // The budget rejects while unavailable. Error events never become uncaught exceptions or logs of URLs.
    this.client.on('error', () => {});
  }
  static async open(url: string, key: Uint8Array): Promise<RedisRateBudget> {
    const budget = new RedisRateBudget(url, key);
    try {
      await budget.client.connect();
      return budget;
    } catch {
      budget.client.destroy();
      throw new Error('RATE_BUDGET_UNAVAILABLE');
    }
  }
  async take(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): Promise<BudgetResult> {
    if (
      !/^[a-z-]{1,48}$/.test(scope) ||
      !subject ||
      subject.length > 512 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 10_000 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1_000 ||
      windowMs > 86_400_000
    )
      throw new Error('INVALID_RATE_POLICY');
    if (!this.client.isReady) throw new Error('RATE_BUDGET_UNAVAILABLE');
    const key = `identity:rate:${keyedDigest(this.key, scope, subject)}`;
    try {
      const result = await this.client
        .withCommandOptions({ abortSignal: AbortSignal.timeout(3_000) })
        .eval(CONSUME, { keys: [key], arguments: [String(windowMs)] });
      if (!Array.isArray(result) || result.length !== 2) throw new Error('INVALID_RATE_REPLY');
      const count = Number(result[0]);
      const ttl = Number(result[1]);
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(ttl) || count < 1 || ttl < 0)
        throw new Error('INVALID_RATE_REPLY');
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterMs: ttl };
    } catch {
      throw new Error('RATE_BUDGET_UNAVAILABLE');
    }
  }
  async ping(): Promise<void> {
    if (!this.client.isReady) throw new Error('RATE_BUDGET_UNAVAILABLE');
    await this.client.withCommandOptions({ abortSignal: AbortSignal.timeout(3_000) }).ping();
  }
  close(): void {
    if (this.client.isOpen) this.client.destroy();
  }
}
