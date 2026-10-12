import { CATALOG_DEFINITIONS_PUBLISHED_V1 } from '@carwash/event-contracts';
import type { OutboxEvent } from '../ports';

/**
 * `catalog.definitions-published.v1` (envelope v2, published in
 * @carwash/event-contracts business-v1), written to the outbox in the SAME
 * transaction as the catalog revision it announces.
 *
 * Data is the list of definitions that are new or changed in this revision;
 * consumers re-read GET /definitions for content. The aggregate is the single
 * catalog; its version is the catalog revision, so consumers apply an event
 * only when it is newer than what they hold.
 *
 * Every event is self-validated with the published parser before it is
 * enqueued, so a row that would be refused downstream is never written.
 */
export const CATALOG_EVENTS_EXCHANGE = 'washgo.catalog.events';
/** Fixed identity of the one catalog aggregate (catalog.v1 has a single catalog). */
export const CATALOG_AGGREGATE_ID = '6b0b3a52-7c1e-4d8a-9f3e-2c5a1d0e4b71';

export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly traceParent: string | null;
  readonly actorSubject: string;
}

export function definitionsPublishedEvent(
  context: EventContext,
  catalogRevision: number,
  changedDefinitionIds: readonly string[],
): OutboxEvent {
  const event = CATALOG_DEFINITIONS_PUBLISHED_V1.parse({
    eventId: context.eventId,
    eventType: CATALOG_DEFINITIONS_PUBLISHED_V1.eventType,
    envelopeVersion: 2,
    producer: 'catalog',
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    causationId: null,
    traceparent: context.traceParent,
    aggregate: {
      type: CATALOG_DEFINITIONS_PUBLISHED_V1.aggregateType,
      id: CATALOG_AGGREGATE_ID,
      version: catalogRevision,
    },
    actor: { kind: 'account', id: context.actorSubject },
    data: { definitionIds: [...changedDefinitionIds] },
  });
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    exchange: CATALOG_EVENTS_EXCHANGE,
    routingKey: event.eventType,
    payload: JSON.stringify(event),
    correlationId: event.correlationId,
    traceParent: event.traceparent,
  };
}
