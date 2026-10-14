import type { EvidenceFenceQueue, EvidenceFenceTarget } from '../ports';

/**
 * Delivers queued owner-access fences to Media (CR-P08-C1).
 *
 * A request completes only on Media's 2xx. Every other answer (timeout, 5xx,
 * 4xx) is kept with a capped exponential backoff and retried on a later pass;
 * there is no dead letter, because dropping a fence would leave a superseded
 * technician able to read the photos. Requests that keep failing are counted
 * as stuck so operations can see them (worker log line and metric).
 *
 * The Idempotency-Key is derived from the link id, so a retry after a lost
 * response is the same request to Media, never a second fence.
 */
export const FENCE_STUCK_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60_000;

export interface FencePassResult {
  readonly leased: number;
  readonly fenced: number;
  readonly failed: number;
}

export function fenceIdempotencyKey(evidenceId: string): string {
  return `evidence-fence-${evidenceId}`;
}

/** Full-jitter exponential backoff after `attempts` failed deliveries, capped. */
export function fenceRetryDelayMs(attempts: number, random: () => number = Math.random): number {
  const ceiling = Math.min(
    MAX_DELAY_MS,
    BASE_DELAY_MS * 2 ** Math.min(Math.max(attempts, 1) - 1, 16),
  );
  return Math.floor(ceiling / 2 + random() * (ceiling / 2));
}

export class EvidenceFenceRelay {
  constructor(
    private readonly queue: EvidenceFenceQueue,
    private readonly media: EvidenceFenceTarget,
    private readonly options: { readonly leaseMs: number } = { leaseMs: 30_000 },
  ) {}

  async pass(workerId: string, correlationId: string, limit: number): Promise<FencePassResult> {
    const leased = await this.queue.leaseDue(workerId, this.options.leaseMs, limit);
    let fenced = 0;
    let failed = 0;
    for (const request of leased) {
      const outcome = await this.media.revokeOwnerAccess(
        request.mediaObjectId,
        request.evidenceId,
        fenceIdempotencyKey(request.evidenceId),
        correlationId,
      );
      if (outcome.kind === 'FENCED') {
        if (await this.queue.markFenced(request.evidenceId, workerId)) fenced += 1;
      } else {
        failed += 1;
        await this.queue.markRetry(
          request.evidenceId,
          workerId,
          outcome.code,
          fenceRetryDelayMs(request.attempts),
        );
      }
    }
    return { leased: leased.length, fenced, failed };
  }
}
