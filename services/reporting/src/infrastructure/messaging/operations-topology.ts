import type { TopologySpec } from '@carwash/platform-messaging';
import { OPERATIONS_SUBSCRIPTIONS } from '../../application/operations.service';

/**
 * Subscriber-owned topology of the operations projection.
 *
 * Reporting declares ONLY its own queue, dead-letter exchange and DLQ, and
 * binds to the producers' exchanges (binding needs `read` on the source
 * exchange, never `configure`). All producer exchanges in OPERATIONS_SUBSCRIPTIONS
 * belong to their owners and the infrastructure bootstrap, never this consumer.
 * Missing producer topology or grants fail closed at binding; installation must
 * establish every listed dependency before starting the worker.
 */
export const OPERATIONS_QUEUE = 'reporting.operations';
export const OPERATIONS_DLX = 'reporting.operations.dlx';
export const OPERATIONS_DLQ = 'reporting.operations.dlq';
export const OPERATIONS_DEAD_LETTER_KEY = 'reporting.operations';
/** Broker-owned redelivery ceiling before an unappliable event is dead-lettered. */
export const OPERATIONS_DELIVERY_LIMIT = 3;

export function operationsTopology(deliveryLimit = OPERATIONS_DELIVERY_LIMIT): TopologySpec {
  return {
    exchanges: [{ name: OPERATIONS_DLX, type: 'topic' }],
    queues: [
      {
        name: OPERATIONS_QUEUE,
        deadLetterExchange: OPERATIONS_DLX,
        deadLetterRoutingKey: OPERATIONS_DEAD_LETTER_KEY,
        queueType: 'quorum',
        deliveryLimit,
      },
      { name: OPERATIONS_DLQ },
    ],
    bindings: [
      ...OPERATIONS_SUBSCRIPTIONS.map((s) => ({
        queue: OPERATIONS_QUEUE,
        exchange: s.exchange,
        routingKey: s.eventType,
      })),
      { queue: OPERATIONS_DLQ, exchange: OPERATIONS_DLX, routingKey: '#' },
    ],
  };
}
