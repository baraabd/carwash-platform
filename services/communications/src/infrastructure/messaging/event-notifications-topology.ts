import type { TopologySpec } from '@carwash/platform-messaging';
import { EVENT_NOTIFICATION_SUBSCRIPTIONS } from '../../application/event-notifications.service';

/**
 * Subscriber-owned topology of the event-notification worker.
 *
 * Communications declares ONLY its own queue, dead-letter exchange and DLQ,
 * and binds to the producers' exchanges (binding needs `read` on the source
 * exchange, never `configure`). `booking.events` belongs to Booking and the
 * infrastructure bootstrap. Until Lane E declares it and grants this identity
 * `read` (CR-D-P03-07), the worker cannot start and says so by failing to bind.
 */
export const EVENT_NOTIFICATIONS_QUEUE = 'communications.event-notifications';
export const EVENT_NOTIFICATIONS_DLX = 'communications.event-notifications.dlx';
export const EVENT_NOTIFICATIONS_DLQ = 'communications.event-notifications.dlq';
/** Broker-owned redelivery ceiling before an unappliable event is dead-lettered. */
export const EVENT_NOTIFICATIONS_DELIVERY_LIMIT = 3;

export function eventNotificationsTopology(
  deliveryLimit = EVENT_NOTIFICATIONS_DELIVERY_LIMIT,
): TopologySpec {
  return {
    exchanges: [{ name: EVENT_NOTIFICATIONS_DLX, type: 'topic' }],
    queues: [
      {
        name: EVENT_NOTIFICATIONS_QUEUE,
        deadLetterExchange: EVENT_NOTIFICATIONS_DLX,
        deadLetterRoutingKey: EVENT_NOTIFICATIONS_QUEUE,
        queueType: 'quorum',
        deliveryLimit,
      },
      { name: EVENT_NOTIFICATIONS_DLQ },
    ],
    bindings: [
      ...EVENT_NOTIFICATION_SUBSCRIPTIONS.map((s) => ({
        queue: EVENT_NOTIFICATIONS_QUEUE,
        exchange: s.exchange,
        routingKey: s.eventType,
      })),
      { queue: EVENT_NOTIFICATIONS_DLQ, exchange: EVENT_NOTIFICATIONS_DLX, routingKey: '#' },
    ],
  };
}
