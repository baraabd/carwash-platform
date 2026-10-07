import type { OutboxEvent } from '../ports';

/**
 * Vehicle integration events, written to the local outbox in the same
 * transaction as the change. They carry references and revisions only - never
 * a plate, name, colour or owner subject. Registration in
 * @carwash/event-contracts and broker topology are a Lane E request
 * (docs/production/A/P01-A2_VEHICLE_PROVIDER.md); until then rows stay pending.
 */
export const VEHICLE_EVENTS_EXCHANGE = 'washgo.vehicle.events';
export const VEHICLE_UPDATED_V1 = 'vehicle.vehicle-updated.v1' as const;

export type VehicleChange = 'created' | 'updated' | 'archived';

export interface VehicleUpdatedV1 {
  readonly eventId: string;
  readonly eventType: typeof VEHICLE_UPDATED_V1;
  readonly schemaVersion: 1;
  readonly producer: 'vehicle';
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly aggregateVersion: number;
  readonly data: {
    readonly vehicleId: string;
    readonly change: VehicleChange;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  };
}

export interface EventContext {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

export function vehicleUpdatedEvent(
  context: EventContext,
  vehicle: {
    readonly id: string;
    readonly revision: number;
    readonly status: 'ACTIVE' | 'ARCHIVED';
  },
  change: VehicleChange,
): OutboxEvent {
  const event: VehicleUpdatedV1 = {
    eventId: context.eventId,
    eventType: VEHICLE_UPDATED_V1,
    schemaVersion: 1,
    producer: 'vehicle',
    occurredAt: context.occurredAt.toISOString(),
    correlationId: context.correlationId,
    aggregateVersion: vehicle.revision,
    data: { vehicleId: vehicle.id, change, status: vehicle.status },
  };
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    exchange: VEHICLE_EVENTS_EXCHANGE,
    routingKey: event.eventType,
    payload: JSON.stringify(event),
    correlationId: event.correlationId,
    traceParent: context.traceParent,
  };
}
