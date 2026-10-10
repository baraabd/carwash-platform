import type {
  AssignmentChangedFact,
  AssignmentStatus,
  BookingConfirmedFact,
  CashState,
  BookingSlot,
  DerivedOperationsStatus,
  Eligibility,
  EligibilityChangedFact,
  FactDecision,
  FreshnessCheckpoint,
  HoldChangedFact,
  HoldState,
  ObligationStatusFact,
  OperationsSource,
} from '../domain/operations';
import type { DurationSummary } from '../domain/live-operations';

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
  applyAssignmentChanged(
    fact: AssignmentChangedFact,
    fingerprintHash: string,
  ): Promise<FactOutcome>;
  applyObligationStatus(fact: ObligationStatusFact, fingerprintHash: string): Promise<FactOutcome>;
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
  bookingAssignments(bookingId: string): Promise<readonly AssignmentRow[]>;
  operationsKpis(input: {
    from: Date;
    to: Date;
    zoneId: string | null;
  }): Promise<OperationsKpiRows>;
  cashKpis(): Promise<readonly CashStateRow[]>;
  checkpoints(): Promise<ReadonlyMap<OperationsSource, FreshnessCheckpoint>>;
}

/** One Dispatch assignment as last observed, with its first-occurrence milestones. */
export interface AssignmentRow {
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly status: AssignmentStatus;
  readonly resourceId: string | null;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly version: number;
  readonly occurredAt: Date;
  readonly firstObservedAt: Date;
  readonly firstOfferedAt: Date | null;
  readonly firstAssignedAt: Date | null;
  /** Distinct capacity resources this assignment has ever been ASSIGNED to. */
  readonly assignedResourceCount: number;
}

/** Aggregates over one window, computed by the database. */
export interface OperationsKpiRows {
  readonly bookingsByStatus: ReadonlyMap<DerivedOperationsStatus, number>;
  readonly assignmentsByStatus: ReadonlyMap<AssignmentStatus, number>;
  readonly reassigned: number;
  readonly assignedAfterStart: number;
  readonly timeToFirstOffer: DurationSummary;
  readonly timeToAssign: DurationSummary;
  readonly offerToAssign: DurationSummary;
}

/** Outstanding total for one currency, as an exact decimal string of minor units. */
export interface OutstandingTotal {
  readonly currency: string;
  readonly scale: number;
  readonly amountMinor: string;
}

export interface CashStateRow {
  readonly cashState: CashState;
  readonly count: number;
  readonly outstanding: readonly OutstandingTotal[];
  /** Earliest time an obligation still in this state entered it. */
  readonly oldestSince: Date | null;
}
