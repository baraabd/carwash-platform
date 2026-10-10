import { CONFIGURATION_PUBLISHED_V1 } from '@carwash/event-contracts';
import type { OutboxEvent, PublishedRecord } from '../ports/configuration-v1.ports';

/**
 * `configuration.configuration-published.v1` (REGISTERED, envelope v2), written
 * to the outbox in the same transaction as the publish. Data is the published
 * contract's exact key set: market, namespace, content hash, effective time.
 * The content itself is not in the event; consumers read it through getCurrent.
 *
 * The exchange follows the AsyncAPI channel `configuration.events`; its
 * declaration and the producer ACL belong to the infrastructure bootstrap
 * (Lane E, CR-D-P05-D5-05).
 */
export const CONFIGURATION_EVENTS_EXCHANGE = 'configuration.events';
export const CONFIGURATION_PUBLISHED_EVENT = CONFIGURATION_PUBLISHED_V1.eventType;

const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly traceParent: string | null;
  readonly actorSubject: string;
}

export function configurationPublishedEvent(
  context: EventContext,
  scopeId: string,
  published: PublishedRecord,
): OutboxEvent {
  const traceparent =
    context.traceParent !== null && TRACEPARENT.test(context.traceParent)
      ? context.traceParent
      : null;
  const event = {
    eventId: context.eventId,
    eventType: CONFIGURATION_PUBLISHED_V1.eventType,
    envelopeVersion: 2,
    producer: CONFIGURATION_PUBLISHED_V1.producer,
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    causationId: null,
    traceparent,
    aggregate: {
      type: CONFIGURATION_PUBLISHED_V1.aggregateType,
      id: scopeId,
      version: published.version,
    },
    actor: { kind: 'account', id: context.actorSubject },
    data: {
      marketId: published.scope.marketId,
      namespace: published.scope.namespace,
      contentHash: published.contentHash,
      effectiveAt: published.effectiveAt.toISOString(),
    },
  } as const;
  // Never commit an event the published contract would refuse.
  CONFIGURATION_PUBLISHED_V1.parse(event);
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    exchange: CONFIGURATION_EVENTS_EXCHANGE,
    routingKey: event.eventType,
    payload: JSON.stringify(event),
    correlationId: event.correlationId,
    traceParent: traceparent,
  };
}
