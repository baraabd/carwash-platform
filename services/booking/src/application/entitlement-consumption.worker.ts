import type { BookingEntitlements } from '../ports/entitlements.ports';
import type { EntitlementConsumptionQueue } from '../ports/entitlement-consumption.ports';

/** The queue is committed with COMPLETED; payment is neither tested nor inferred. */
export class EntitlementConsumptionWorker {
  constructor(
    private readonly queue: EntitlementConsumptionQueue,
    private readonly owner: BookingEntitlements,
  ) {}
  async pass(workerId: string): Promise<{ consumed: number; retried: number; leaseLost: number }> {
    const items = await this.queue.lease(workerId, 1);
    let consumed = 0;
    let retried = 0;
    let leaseLost = 0;
    for (const item of items) {
      const outcome = await this.owner.consume(
        item.bookingId,
        item.reservationId,
        item.correlationId,
      );
      const saved =
        outcome.kind === 'VOIDED'
          ? await this.queue.consumed(workerId, item)
          : await this.queue.retry(workerId, item, outcome.error);
      if (!saved) leaseLost += 1;
      else if (outcome.kind === 'VOIDED') consumed += 1;
      else retried += 1;
    }
    return { consumed, retried, leaseLost };
  }
}
