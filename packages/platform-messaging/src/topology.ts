import type { ConfirmChannel } from 'amqplib';

/**
 * Explicit, durable topology, and explicit OWNERSHIP of it.
 *
 * Who may declare what follows from the broker ACL, and the split below mirrors
 * it exactly rather than working around it:
 *
 *   producer    declares its OWN exchange (it holds `configure` on it),
 *   subscriber  declares its OWN queues and dead-letter exchange, and BINDS to
 *               the producer's exchange - binding needs only `read` on the
 *               source exchange and `write` on its own queue, never `configure`,
 *   infra       declares exchanges shared between services, during bootstrap.
 *
 * A subscriber that tried to declare the producer's exchange would be refused,
 * and rightly so: it does not own it.
 *
 * Nothing here is auto-created by accident, and nothing is highly available - a
 * single-node development broker is not an HA cluster.
 */

export interface ExchangeSpec {
  readonly name: string;
  readonly type: 'topic' | 'fanout' | 'direct';
}

export interface QueueSpec {
  readonly name: string;
  readonly deadLetterExchange?: string;
  readonly deadLetterRoutingKey?: string;
  readonly queueType?: 'classic' | 'quorum';
  /**
   * Broker-enforced redelivery ceiling. RabbitMQ supports this on quorum queues;
   * once exceeded the message is dead-lettered instead of looping forever.
   */
  readonly deliveryLimit?: number;
}

export interface BindingSpec {
  readonly queue: string;
  readonly exchange: string;
  readonly routingKey: string;
}

export interface TopologySpec {
  readonly exchanges: readonly ExchangeSpec[];
  readonly queues: readonly QueueSpec[];
  readonly bindings: readonly BindingSpec[];
}

export async function assertTopology(channel: ConfirmChannel, spec: TopologySpec): Promise<void> {
  for (const exchange of spec.exchanges) {
    await channel.assertExchange(exchange.name, exchange.type, { durable: true });
  }
  for (const queue of spec.queues) {
    const args: Record<string, unknown> = {};
    if (queue.deadLetterExchange) args['x-dead-letter-exchange'] = queue.deadLetterExchange;
    if (queue.deadLetterRoutingKey) args['x-dead-letter-routing-key'] = queue.deadLetterRoutingKey;
    if (queue.queueType) args['x-queue-type'] = queue.queueType;
    if (queue.deliveryLimit !== undefined) {
      if (queue.queueType !== 'quorum') {
        throw new Error(`DELIVERY_LIMIT_REQUIRES_QUORUM: ${queue.name}`);
      }
      if (!Number.isInteger(queue.deliveryLimit) || queue.deliveryLimit < 1) {
        throw new Error(`INVALID_DELIVERY_LIMIT: ${queue.name}`);
      }
      args['x-delivery-limit'] = queue.deliveryLimit;
    }
    // Durable queues survive a broker restart; messages are published persistent.
    await channel.assertQueue(queue.name, { durable: true, arguments: args });
  }
  for (const binding of spec.bindings) {
    await channel.bindQueue(binding.queue, binding.exchange, binding.routingKey);
  }
}

/** The single non-financial event slice delivered in Sprint 0.2. */
export const FOUNDATION_PROBE_ROUTING_KEY = 'foundation.probe.created.v1';
export const CATALOG_EVENTS_EXCHANGE = 'catalog.events';

/** Declared by the catalog producer, which owns it. */
export const producerTopology: TopologySpec = {
  exchanges: [{ name: CATALOG_EVENTS_EXCHANGE, type: 'topic' }],
  queues: [],
  bindings: [],
};

/** Declared once at bootstrap by the infrastructure identity. */
export const sharedTopology: TopologySpec = {
  exchanges: [{ name: CATALOG_EVENTS_EXCHANGE, type: 'topic' }],
  queues: [],
  bindings: [],
};

export const FOUNDATION_TRANSIENT_DELIVERY_LIMIT = 3;

export function subscriberQueueName(subscriber: string): string {
  // The queue belongs to the SUBSCRIBING SERVICE, not to a process replica.
  // Two replicas of one service share this queue and therefore compete for
  // messages; two different services have different queues and therefore each
  // receive their own copy. Naming a queue per replica would silently turn
  // fan-out into duplicated work.
  return `${subscriber}.catalog.foundation-probe`;
}

export function subscriberDeadLetterExchangeName(subscriber: string): string {
  return `${subscriber}.dlx`;
}

export function subscriberDeadLetterQueueName(subscriber: string): string {
  return `${subscriber}.dlq`;
}

/**
 * Subscriber-owned topology with broker-persistent bounded redelivery.
 *
 * The main queue is quorum-backed and RabbitMQ owns the delivery counter. A
 * transient consumer failure uses NACK+requeue; once the broker-enforced limit
 * is exceeded the message is dead-lettered. Because the counter lives in the
 * broker rather than process memory, restarting a consumer cannot reset the
 * retry budget.
 *
 * Permanent parse/integrity failures use NACK without requeue and go directly
 * to the same DLQ. The subscriber still has only READ access on catalog.events:
 * no retry mechanism grants it permission to forge producer events.
 */
export function subscriberTopology(
  subscriber: string,
  deliveryLimit = FOUNDATION_TRANSIENT_DELIVERY_LIMIT,
): TopologySpec {
  const queue = subscriberQueueName(subscriber);
  const dlx = subscriberDeadLetterExchangeName(subscriber);
  const dlq = subscriberDeadLetterQueueName(subscriber);
  return {
    exchanges: [{ name: dlx, type: 'topic' }],
    queues: [
      {
        name: queue,
        deadLetterExchange: dlx,
        deadLetterRoutingKey: FOUNDATION_PROBE_ROUTING_KEY,
        queueType: 'quorum',
        deliveryLimit,
      },
      { name: dlq },
    ],
    bindings: [
      { queue, exchange: CATALOG_EVENTS_EXCHANGE, routingKey: FOUNDATION_PROBE_ROUTING_KEY },
      { queue: dlq, exchange: dlx, routingKey: '#' },
    ],
  };
}
