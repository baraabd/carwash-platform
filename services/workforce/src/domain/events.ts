import type { EmploymentStatus, VerificationStatus } from './operator';
import type { ShiftStatus } from './shift';

export const WORKFORCE_EVENTS_EXCHANGE = 'workforce.events' as const;
export const ELIGIBILITY_CHANGED_V1 = 'workforce.eligibility-changed.v1' as const;
export const SHIFT_UPDATED_V1 = 'workforce.shift-updated.v1' as const;

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

export type EligibilityChangedV1 = EventBase<
  typeof ELIGIBILITY_CHANGED_V1,
  {
    readonly operatorId: string;
    readonly eligible: boolean;
    readonly employmentStatus: EmploymentStatus;
    readonly verificationStatus: VerificationStatus;
    readonly suspended: boolean;
    readonly skillCodes: readonly string[];
  }
>;

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

export function eligibilityEvent(input: Omit<EligibilityChangedV1, 'eventType' | 'schemaVersion' | 'producer'>): EligibilityChangedV1 {
  return {
    ...input,
    eventType: ELIGIBILITY_CHANGED_V1,
    schemaVersion: 1,
    producer: 'workforce',
    data: { ...input.data, skillCodes: [...input.data.skillCodes].sort() },
  };
}

export function shiftEvent(input: Omit<ShiftUpdatedV1, 'eventType' | 'schemaVersion' | 'producer'>): ShiftUpdatedV1 {
  return {
    ...input,
    eventType: SHIFT_UPDATED_V1,
    schemaVersion: 1,
    producer: 'workforce',
  };
}
