import type { OutboxEvent } from '../ports';

/**
 * `geo.zone-updated.v1`, written to the outbox in the same transaction as the
 * zone change. Zone references and revision only; consumers re-read the zone.
 * Registration and topology are a Lane E request; rows stay pending until then.
 */
export const GEO_EVENTS_EXCHANGE = 'washgo.geo.events';
export const GEO_ZONE_UPDATED_V1 = 'geo.zone-updated.v1' as const;

export type ZoneChange = 'created' | 'revised' | 'retired';

export interface GeoZoneUpdatedV1 {
  readonly eventId: string;
  readonly eventType: typeof GEO_ZONE_UPDATED_V1;
  readonly schemaVersion: 1;
  readonly producer: 'geo';
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly aggregateVersion: number;
  readonly data: {
    readonly zoneId: string;
    readonly code: string;
    readonly change: ZoneChange;
    readonly status: 'ACTIVE' | 'RETIRED';
  };
}

export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

export function zoneUpdatedEvent(
  context: EventContext,
  zone: {
    readonly id: string;
    readonly code: string;
    readonly revision: number;
    readonly status: 'ACTIVE' | 'RETIRED';
  },
  change: ZoneChange,
): OutboxEvent {
  const event: GeoZoneUpdatedV1 = {
    eventId: context.eventId,
    eventType: GEO_ZONE_UPDATED_V1,
    schemaVersion: 1,
    producer: 'geo',
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    aggregateVersion: zone.revision,
    data: { zoneId: zone.id, code: zone.code, change, status: zone.status },
  };
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    exchange: GEO_EVENTS_EXCHANGE,
    routingKey: event.eventType,
    payload: JSON.stringify(event),
    correlationId: event.correlationId,
    traceParent: context.traceParent,
  };
}
