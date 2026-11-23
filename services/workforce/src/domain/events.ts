import type { EventActor, EventEnvelopeV2 } from '@carwash/event-contracts';
import type { EligibilityState } from './capacity';
import type { OperatorState } from './operator';
import type { ShiftStatus } from './shift';

export const WORKFORCE_EVENTS_EXCHANGE = 'workforce.events' as const;
export const ELIGIBILITY_CHANGED_V1 = 'workforce.eligibility-changed.v1' as const;
export const SHIFT_UPDATED_V1 = 'workforce.shift-updated.v1' as const;

/**
 * `workforce.eligibility-changed.v1` — PUBLISHED in @carwash/event-contracts
 * (business-v1, envelope v2). Aggregate = the capacity resource (operator id),
 * aggregate.version = its eligibility revision. Data is closed and carries the
 * eligibility state only: no subject, name, zone, skill or verification detail.
 */
export const CAPACITY_RESOURCE_AGGREGATE = 'capacity-resource' as const;

export type EligibilityChangedV1 = EventEnvelopeV2<
  typeof ELIGIBILITY_CHANGED_V1,
  'workforce',
  { readonly eligibility: EligibilityState }
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('INVALID_EVENT_UUID');
  return value.toLowerCase();
}

export function eligibilityChangedEvent(input: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly actor: EventActor;
  readonly operator: OperatorState;
  readonly eligibility: EligibilityState;
}): EligibilityChangedV1 {
  return {
    eventId: uuid(input.eventId),
    eventType: ELIGIBILITY_CHANGED_V1,
    envelopeVersion: 2,
    producer: 'workforce',
    occurredAt: input.operator.updatedAt.toISOString(),
    correlationId: uuid(input.correlationId),
    causationId: null,
    // The active trace travels in the outbox row's trace_parent column.
    traceparent: null,
    aggregate: {
      type: CAPACITY_RESOURCE_AGGREGATE,
      id: uuid(input.operator.id),
      version: input.operator.eligibilityRevision,
    },
    actor: input.actor,
    data: { eligibility: input.eligibility },
  };
}

/**
 * Pre-envelope-v2 shape kept for the UNPUBLISHED `workforce.shift-updated.v1`
 * (P01-C2). It is not in @carwash/event-contracts and nothing may treat it as
 * published.
 */
interface EventBase<T extends string, D> {
  readonly eventId: string;
  readonly eventType: T;
  readonly schemaVersion: 1;
  readonly producer: 'workforce';
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly aggregateVersion: number;
  readonly data: D;
}

export type ShiftUpdatedV1 = EventBase<
  typeof SHIFT_UPDATED_V1,
  {
    readonly shiftId: string;
    readonly operatorId: string;
    readonly zoneId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly status: ShiftStatus;
  }
>;

export type WorkforceEvent = EligibilityChangedV1 | ShiftUpdatedV1;

export function shiftEvent(
  input: Omit<ShiftUpdatedV1, 'eventType' | 'schemaVersion' | 'producer'>,
): ShiftUpdatedV1 {
  return {
    ...input,
    eventType: SHIFT_UPDATED_V1,
    schemaVersion: 1,
    producer: 'workforce',
  };
}
