import type { TopologySpec } from '@carwash/platform-messaging';
import { REVENUE_SUBSCRIPTIONS } from '../../application/reports.service';

/**
 * Subscriber-owned topology of the revenue projection.
 *
 * Reporting declares ONLY its own queue, dead-letter exchange and DLQ, and
 * binds to Billing's exchange `washgo.billing.events` (binding needs `read`
 * on the source exchange, never `configure`). The exchange belongs to Billing
 * and the infrastructure bootstrap. Until Lane E grants this identity `read`
 * on it (CR-D-P05-D4-01), this worker cannot bind on the accepted broker and
 * says so by failing to start.
 */
export const REVENUE_QUEUE = 'reporting.revenue';
export const REVENUE_DLX = 'reporting.revenue.dlx';
export const REVENUE_DLQ = 'reporting.revenue.dlq';
export const REVENUE_DEAD_LETTER_KEY = 'reporting.revenue';
/** Broker-owned redelivery ceiling before an unappliable event is dead-lettered. */
export const REVENUE_DELIVERY_LIMIT = 3;

export function revenueTopology(deliveryLimit = REVENUE_DELIVERY_LIMIT): TopologySpec {
  return {
    exchanges: [{ name: REVENUE_DLX, type: 'topic' }],
    queues: [
      {
        name: REVENUE_QUEUE,
        deadLetterExchange: REVENUE_DLX,
        deadLetterRoutingKey: REVENUE_DEAD_LETTER_KEY,
        queueType: 'quorum',
        deliveryLimit,
      },
      { name: REVENUE_DLQ },
    ],
    bindings: [
      ...REVENUE_SUBSCRIPTIONS.map((s) => ({
        queue: REVENUE_QUEUE,
        exchange: s.exchange,
        routingKey: s.eventType,
      })),
      { queue: REVENUE_DLQ, exchange: REVENUE_DLX, routingKey: '#' },
    ],
  };
}
