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
  /** Broker-owned delay used by retry queues before redelivery. */
  readonly messageTtlMs?: number;
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
    if (queue.messageTtlMs !== undefined) {
      if (!Number.isInteger(queue.messageTtlMs) || queue.messageTtlMs < 1) {
        throw new Error(`INVALID_QUEUE_TTL: ${queue.name}`);
      }
      args['x-message-ttl'] = queue.messageTtlMs;
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

export const FOUNDATION_RETRY_DELAY_MS = 250;

export function subscriberQueueName(subscriber: string): string {
  // The queue belongs to the SUBSCRIBING SERVICE, not to a process replica.
  // Two replicas of one service share this queue and therefore compete for
  // messages; two different services have different queues and therefore each
  // receive their own copy. Naming a queue per replica would silently turn
  // fan-out into duplicated work.
  return `${subscriber}.catalog.foundation-probe`;
}

export function subscriberRetryExchangeName(subscriber: string): string {
  return `${subscriber}.retry`;
}

export function subscriberRedeliveryExchangeName(subscriber: string): string {
  return `${subscriber}.redelivery`;
}

export function subscriberRetryQueueName(subscriber: string): string {
  return `${subscriber}.retry.catalog.foundation-probe`;
}

export function subscriberDeadLetterExchangeName(subscriber: string): string {
  return `${subscriber}.dlx`;
}

export function subscriberDeadLetterQueueName(subscriber: string): string {
  return `${subscriber}.dlq`;
}

/**
 * Subscriber-owned retry topology.
 *
 * A transient failure is confirmed into the subscriber's own retry exchange.
 * The retry queue holds it briefly, then RabbitMQ dead-letters it to the
 * subscriber's own redelivery exchange, which is also bound to the main queue.
 * This avoids granting a consumer WRITE permission on the producer's exchange.
 *
 * The retry count is carried in the message header by InboxConsumer, so the
 * retry budget survives consumer process restarts. Permanent failures still
 * dead-letter directly from the main queue to the subscriber DLQ.
 */
export function subscriberTopology(
  subscriber: string,
  retryDelayMs = FOUNDATION_RETRY_DELAY_MS,
): TopologySpec {
  const queue = subscriberQueueName(subscriber);
  const retryExchange = subscriberRetryExchangeName(subscriber);
  const redeliveryExchange = subscriberRedeliveryExchangeName(subscriber);
  const retryQueue = subscriberRetryQueueName(subscriber);
  const dlx = subscriberDeadLetterExchangeName(subscriber);
  const dlq = subscriberDeadLetterQueueName(subscriber);
  return {
    // Every resource below is inside the subscriber's namespace. The only
    // foreign resource touched is catalog.events, and only with READ permission
    // for binding.
    exchanges: [
      { name: dlx, type: 'topic' },
      { name: retryExchange, type: 'topic' },
      { name: redeliveryExchange, type: 'topic' },
    ],
    queues: [
      { name: queue, deadLetterExchange: dlx, deadLetterRoutingKey: FOUNDATION_PROBE_ROUTING_KEY },
      {
        name: retryQueue,
        deadLetterExchange: redeliveryExchange,
        deadLetterRoutingKey: FOUNDATION_PROBE_ROUTING_KEY,
        messageTtlMs: retryDelayMs,
      },
      { name: dlq },
    ],
    bindings: [
      { queue, exchange: CATALOG_EVENTS_EXCHANGE, routingKey: FOUNDATION_PROBE_ROUTING_KEY },
      { queue, exchange: redeliveryExchange, routingKey: FOUNDATION_PROBE_ROUTING_KEY },
      { queue: retryQueue, exchange: retryExchange, routingKey: FOUNDATION_PROBE_ROUTING_KEY },
      { queue: dlq, exchange: dlx, routingKey: '#' },
    ],
  };
}
