import { bestEffortLog } from '@carwash/observability';
import { setTimeout as delay } from 'node:timers/promises';
import type { MessageLogger } from './types';

/** The supplied pass must lease/re-read durable state and be safe to retry. */
export async function runPollingLoop(options: {
  readonly signal: AbortSignal;
  readonly intervalMs: number;
  readonly work: () => Promise<unknown>;
  readonly logger?: MessageLogger;
}): Promise<void> {
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1)
    throw new Error('INVALID_POLL_INTERVAL');
  let failures = 0;
  while (!options.signal.aborted) {
    try {
      await options.work();
      failures = 0;
    } catch (error: unknown) {
      failures += 1;
      bestEffortLog(options.logger, 'warn', 'worker_pass_failed', {
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        failures,
      });
    }
    const wait = Math.min(30_000, options.intervalMs * 2 ** Math.min(failures, 6));
    await delay(wait, undefined, { signal: options.signal }).catch(() => {});
  }
}
