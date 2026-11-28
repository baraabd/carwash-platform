import type { Clock, FundingAuthority, FundingReleaseQueue } from '../ports';

/** Durable, replayable cross-owner release. A timeout keeps the claim fenced for retry. */
export class FundingRecoveryService {
  constructor(
    private readonly deps: {
      readonly queue: FundingReleaseQueue;
      readonly funding: FundingAuthority;
      readonly clock: Clock;
      readonly workerId: string;
    },
  ) {}

  async runBatch(limit = 10): Promise<{ attempted: number; released: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10)
      throw new Error('FUNDING_BATCH_INVALID');
    const leases = await this.deps.queue.claim(this.deps.workerId, this.deps.clock.now(), limit);
    let completed = 0;
    for (const lease of leases) {
      let released = false;
      try {
        released =
          (await this.deps.funding.release({
            subscriptionId: lease.subscriptionId,
            customerSubject: lease.customerSubject,
            correlationId: lease.correlationId,
          })) === 'RELEASED';
      } catch {
        /* Owner outcome is unknown; never clear the financial fence. */
      }
      const owned = await this.deps.queue.finish(lease, this.deps.clock.now(), released);
      if (owned && released) completed++;
    }
    return { attempted: leases.length, released: completed };
  }
}
