import { v1State, type HoldState, type HoldStateV1 } from './hold';

/**
 * `scheduling.hold-changed.v1` on envelope v2, as published by Lane E in
 * @carwash/event-contracts (business-v1) and docs/asyncapi/business-events-v1.yaml.
 * The service cannot import that package yet (lockfile is Lane E's), so the
 * producer shape is declared here and verified against the published parser
 * by tests/production/C/scheduling-v1-provider.test.mjs.
 *
 * Data carries opaque ids and the slot only; no names, phones or addresses.
 */
export const SCHEDULING_HOLD_CHANGED_V1 = 'scheduling.hold-changed.v1' as const;
export const SCHEDULING_EVENTS_EXCHANGE = 'scheduling.events' as const;

export type EventActor =
  | { readonly kind: 'account' | 'guest'; readonly id: string }
  | { readonly kind: 'service'; readonly id: string }
  | { readonly kind: 'system'; readonly id: null };

export interface SchedulingHoldChangedV1 {
  readonly eventId: string;
  readonly eventType: typeof SCHEDULING_HOLD_CHANGED_V1;
  readonly envelopeVersion: 2;
  readonly producer: 'scheduling';
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly traceparent: string | null;
  readonly aggregate: { readonly type: 'hold'; readonly id: string; readonly version: number };
  readonly actor: EventActor;
  readonly data: {
    readonly state: HoldStateV1;
    readonly zoneId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly bookingId: string | null;
  };
}

export type SchedulingEvent = SchedulingHoldChangedV1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('INVALID_EVENT_UUID');
  return value;
}

export function holdChangedEvent(input: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly hold: HoldState;
  readonly zoneId: string;
  readonly actor: EventActor;
}): SchedulingHoldChangedV1 {
  const { hold } = input;
  const state = v1State(hold);
  return {
    eventId: uuid(input.eventId),
    eventType: SCHEDULING_HOLD_CHANGED_V1,
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: hold.updatedAt.toISOString(),
    correlationId: uuid(input.correlationId),
    causationId: null,
    // Filled in by the outbox adapter from the active trace, never invented here.
    traceparent: null,
    aggregate: { type: 'hold', id: uuid(hold.id), version: hold.version },
    actor: input.actor,
    data: {
      state,
      zoneId: uuid(input.zoneId),
      startsAt: hold.slotStartsAt.toISOString(),
      endsAt: hold.slotEndsAt.toISOString(),
      // The published parser binds bookingId to COMMITTED exactly.
      bookingId: state === 'COMMITTED' ? hold.bookingId : null,
    },
  };
}
