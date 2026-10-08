import type {
  BookingConfirmedFact,
  BookingSlot,
  DerivedOperationsStatus,
  Eligibility,
  EligibilityChangedFact,
  FactDecision,
  FreshnessCheckpoint,
  HoldChangedFact,
  HoldState,
  OperationsSource,
} from '../domain/operations';

export type FactOutcome = 'APPLIED' | Exclude<FactDecision, 'APPLY'>;

/**
 * Transaction-bound writer for the operations read model. It is created with
 * the inbox transaction, so derived rows, the freshness checkpoint and the
 * inbox record commit together. Integrity conflicts are thrown.
 */
export interface OperationsWriter {
  applyBookingConfirmed(fact: BookingConfirmedFact, fingerprintHash: string): Promise<FactOutcome>;
  applyHoldChanged(fact: HoldChangedFact, fingerprintHash: string): Promise<FactOutcome>;
  applyEligibilityChanged(
    fact: EligibilityChangedFact,
    fingerprintHash: string,
  ): Promise<FactOutcome>;
  touchFreshness(source: OperationsSource, occurredAt: Date, appliedAt: Date): Promise<void>;
}

export interface BookingOperationRow {
  readonly bookingId: string;
  readonly customerRef: string | null;
  readonly confirmedAt: Date | null;
  readonly slot: BookingSlot | null;
  /** Source occurrence time of the newest fact folded into this row. */
  readonly updatedAt: Date;
}

/** One scheduling hold linked to a booking, as last observed. */
export interface LinkedHoldRow {
  readonly holdId: string;
  readonly state: HoldState;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly version: number;
  readonly occurredAt: Date;
}

export interface ResourceEligibilityRow {
  readonly resourceId: string;
  readonly eligibility: Eligibility;
  readonly version: number;
  readonly changedAt: Date;
}

export interface EligibilitySummary {
  readonly eligible: number;
  readonly ineligible: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface OperationsReader {
  listBookings(input: {
    from: Date;
    to: Date;
    zoneId: string | null;
    status: DerivedOperationsStatus | null;
    limit: number;
    cursor: string | null;
  }): Promise<Page<BookingOperationRow>>;
  booking(bookingId: string): Promise<BookingOperationRow | null>;
  bookingHolds(bookingId: string): Promise<readonly LinkedHoldRow[]>;
  listResources(input: {
    eligibility: Eligibility | null;
    limit: number;
    cursor: string | null;
  }): Promise<Page<ResourceEligibilityRow>>;
  resourceSummary(): Promise<EligibilitySummary>;
  checkpoints(): Promise<ReadonlyMap<OperationsSource, FreshnessCheckpoint>>;
}
