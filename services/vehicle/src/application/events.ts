import { VEHICLE_UPDATED_V1 as VEHICLE_UPDATED_EVENT } from '@carwash/event-contracts';
import type { OutboxEvent } from '../ports';

/**
 * vehicle.vehicle-updated.v1 in the published envelope v2
 * (@carwash/event-contracts business-v1, docs/asyncapi/business-events-v1.yaml),
 * written to the local outbox in the same transaction as the change.
 *
 * Data carries the change kind only; the aggregate carries the vehicle id and
 * committed revision. Never a plate, make, model, colour or nickname. The actor
 * is the Identity subject of the principal that made the change. Every event is
 * checked with the published parser before it is written, so a drifting shape
 * fails the transaction instead of reaching a consumer.
 */
export const VEHICLE_EVENTS_EXCHANGE = 'vehicle.events';
export const VEHICLE_UPDATED_V1 = 'vehicle.vehicle-updated.v1' as const;

export type VehicleChange = 'CREATED' | 'UPDATED' | 'ARCHIVED';

export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly traceParent: string | null;
  readonly actor: { readonly kind: 'account' | 'guest'; readonly id: string };
}

const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

export function vehicleUpdatedEvent(
  context: EventContext,
  vehicle: { readonly id: string; readonly revision: number },
  change: VehicleChange,
): OutboxEvent {
  const traceparent =
    context.traceParent && TRACEPARENT.test(context.traceParent) ? context.traceParent : null;
  const event = VEHICLE_UPDATED_EVENT.parse({
    eventId: context.eventId,
    eventType: VEHICLE_UPDATED_V1,
    envelopeVersion: 2,
    producer: 'vehicle',
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    causationId: null,
    traceparent,
    aggregate: { type: 'vehicle', id: vehicle.id, version: vehicle.revision },
    actor: context.actor,
    data: { change },
  });
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    exchange: VEHICLE_EVENTS_EXCHANGE,
    routingKey: event.eventType,
    payload: JSON.stringify(event),
    correlationId: event.correlationId,
    traceParent: traceparent,
  };
}