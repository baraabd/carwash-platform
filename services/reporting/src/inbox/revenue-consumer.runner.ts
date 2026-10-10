import { RevenueProjector, parseRevenueEvent } from '../application/reports.service';
import { PrismaRevenueWriter } from '../infrastructure/persistence/prisma-reports.store';
import { sha256Hex } from '../infrastructure/persistence/prisma-projection.store';
import { REVENUE_QUEUE, revenueTopology } from '../infrastructure/messaging/revenue-topology';
import { startProjectionWorker } from './projection-worker';

/**
 * Standalone worker for the revenue projection: Billing's registered
 * obligation and refund events on `washgo.billing.events`. Transaction, ACK
 * and dead-letter semantics are those of `runProjectionWorker`.
 */
const projector = new RevenueProjector(sha256Hex, { now: () => new Date() });

startProjectionWorker({
  component: 'revenue-consumer',
  eventsComponent: 'revenue-worker-events',
  connectionName: 'reporting-revenue-consumer',
  queue: REVENUE_QUEUE,
  topology: () => revenueTopology(),
  parse: parseRevenueEvent,
  apply: async (event, tx) => {
    await projector.apply(new PrismaRevenueWriter(tx), event.fact);
  },
  integrityEvent: 'revenue_integrity_conflict',
});
