import type { CapacityWindowState } from './capacity-window';
import type { HoldState } from './hold';

/**
 * Scheduling integration events (schema version 1).
 *
 * These shapes are the producer side of the contract REQUESTED from Lane E in
 * docs/production/C/contract-requests/CR-C1-scheduling-events-v1.md. Until E
 * publishes them in @carwash/event-contracts they are written to the outbox
 * only; no relay publishes them (see the scheduling README). The payload carries
 * opaque references only: no customer name, phone, address or plate.
 */
export const SCHEDULING_HOLD_CREATED_V1 = 'scheduling.hold-created.v1' as const;
export const SCHEDULING_HOLD_EXPIRED_V1 = 'scheduling.hold-expired.v1' as const;
export const SCHEDULING_EVENTS_EXCHANGE = 'scheduling.events' as const;

interface Envelope<TType extends string, TData> {
  readonly eventId: string;
  readonly eventType: TType;
  readonly schemaVersion: 1;
  readonly producer: 'scheduling';
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly aggregateVersion: number;
  readonly data: TData;
}

export type SchedulingHoldCreatedV1 = Envelope<
  typeof SCHEDULING_HOLD_CREATED_V1,
  {
    readonly holdId: string;
    readonly windowId: string;
    readonly zoneId: string;
    readonly holderRef: string;
    readonly units: number;
    readonly windowStartsAt: string;
    readonly windowEndsAt: string;
    readonly expiresAt: string;
  }
>;

export type SchedulingHoldExpiredV1 = Envelope<
  typeof SCHEDULING_HOLD_EXPIRED_V1,
  {
    readonly holdId: string;
    readonly windowId: string;
    readonly zoneId: string;
    readonly holderRef: string;
    readonly units: number;
    readonly expiredAt: string;
  }
>;

export type SchedulingEvent = SchedulingHoldCreatedV1 | SchedulingHoldExpiredV1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new Error('INVALID_EVENT_UUID');
}

export function holdCreatedEvent(input: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly hold: HoldState;
  readonly window: CapacityWindowState;
}): SchedulingHoldCreatedV1 {
  const { hold, window } = input;
  const event: SchedulingHoldCreatedV1 = {
    eventId: input.eventId,
    eventType: SCHEDULING_HOLD_CREATED_V1,
    schemaVersion: 1,
    producer: 'scheduling',
    occurredAt: hold.createdAt.toISOString(),
    correlationId: input.correlationId,
    aggregateVersion: hold.version,
    data: {
      holdId: hold.id,
      windowId: window.id,
      zoneId: window.zoneId,
      holderRef: hold.holderRef,
      units: hold.units,
      windowStartsAt: window.startsAt.toISOString(),
      windowEndsAt: window.endsAt.toISOString(),
      expiresAt: hold.expiresAt.toISOString(),
    },
  };
  validate(event);
  return event;
}

export function holdExpiredEvent(input: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly hold: HoldState;
  readonly zoneId: string;
}): SchedulingHoldExpiredV1 {
  const { hold } = input;
  if (hold.status !== 'EXPIRED') throw new Error('HOLD_NOT_EXPIRED');
  const event: SchedulingHoldExpiredV1 = {
    eventId: input.eventId,
    eventType: SCHEDULING_HOLD_EXPIRED_V1,
    schemaVersion: 1,
    producer: 'scheduling',
    occurredAt: hold.updatedAt.toISOString(),
    correlationId: input.correlationId,
    aggregateVersion: hold.version,
    data: {
      holdId: hold.id,
      windowId: hold.windowId,
      zoneId: input.zoneId,
      holderRef: hold.holderRef,
      units: hold.units,
      // The deadline is the fact; when a sweeper noticed it is `occurredAt`.
      expiredAt: hold.expiresAt.toISOString(),
    },
  };
  validate(event);
  return event;
}

/** An event that its own contract would reject must never reach the outbox. */
function validate(event: SchedulingEvent): void {
  assertUuid(event.eventId);
  assertUuid(event.correlationId);
  assertUuid(event.data.holdId);
  assertUuid(event.data.windowId);
  assertUuid(event.data.zoneId);
  assertUuid(event.data.holderRef);
  if (!Number.isSafeInteger(event.aggregateVersion) || event.aggregateVersion < 1) {
    throw new Error('INVALID_AGGREGATE_VERSION');
  }
}
