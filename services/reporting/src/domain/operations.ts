/**
 * Operations read-model rules (booking operations and workforce eligibility).
 *
 * Pure domain. Reporting derives these rows from other owners' published
 * events and never decides a booking, dispatch or verification fact: every
 * row carries the source event that produced it, and every read says it is a
 * derived projection with its own freshness, separate from the owner's
 * authoritative record.
 */

export type HoldState = 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
export type Eligibility = 'ELIGIBLE' | 'INELIGIBLE';

export const OPERATIONS_SOURCES = [
  'booking',
  'scheduling',
  'workforce',
  'dispatch',
  'billing',
] as const;
export type OperationsSource = (typeof OPERATIONS_SOURCES)[number];

export class OperationsRuleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OperationsRuleError';
  }
}

/**
 * Two facts that cannot both be true for one aggregate. Never folded and never
 * ACKed as a duplicate: the consumer rejects the delivery and the broker
 * dead-letters it once its bounded redelivery budget is spent.
 */
export type IntegrityCode =
  | 'FACT_VERSION_CONFLICT'
  | 'HOLD_BOOKING_CONFLICT'
  | 'ASSIGNMENT_BOOKING_CONFLICT'
  | 'OBLIGATION_CURRENCY_CONFLICT';

export class OperationsIntegrityError extends Error {
  constructor(readonly code: IntegrityCode) {
    super(code);
    this.name = 'OperationsIntegrityError';
  }
}

/** Source provenance kept on every derived row. */
export interface SourceFact {
  readonly source: OperationsSource;
  readonly eventId: string;
  readonly occurredAt: Date;
  /** The owner's aggregate version for the row's aggregate. */
  readonly version: number;
}

export interface BookingConfirmedFact extends SourceFact {
  readonly kind: 'BOOKING_CONFIRMED';
  readonly bookingId: string;
  /** Opaque Identity/Customer reference; never a name, phone or address. */
  readonly customerRef: string;
}

export interface HoldChangedFact extends SourceFact {
  readonly kind: 'HOLD_CHANGED';
  readonly holdId: string;
  readonly state: HoldState;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly bookingId: string | null;
}

export interface EligibilityChangedFact extends SourceFact {
  readonly kind: 'ELIGIBILITY_CHANGED';
  readonly resourceId: string;
  readonly eligibility: Eligibility;
}

/** Dispatch assignment lifecycle (owner: Dispatch). */
export type AssignmentStatus = 'UNASSIGNED' | 'OFFERED' | 'ASSIGNED' | 'CANCELLED';
export const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'UNASSIGNED',
  'OFFERED',
  'ASSIGNED',
  'CANCELLED',
];

export interface AssignmentChangedFact extends SourceFact {
  readonly kind: 'ASSIGNMENT_CHANGED';
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly status: AssignmentStatus;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Workforce capacity resource; non-null exactly when status is ASSIGNED. */
  readonly resourceId: string | null;
}

/** Billing's financial status vocabulary for one obligation (owner: Billing). */
export type CashState =
  | 'UNPAID'
  | 'AWAITING_CASH'
  | 'AWAITING_PAYMENT'
  | 'UNDER_REVIEW'
  | 'OUTCOME_UNKNOWN'
  | 'PAID'
  | 'VOIDED';
export const CASH_STATES: readonly CashState[] = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
  'PAID',
  'VOIDED',
];
/** States in which money is still expected or its outcome is unresolved. */
export const OPEN_CASH_STATES: readonly CashState[] = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
];

/**
 * Exact money in integer minor units. Never a binary float: amounts leave the
 * service as decimal strings and are summed by the database as NUMERIC.
 */
export interface ExactAmount {
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly scale: number;
}

export interface ObligationStatusFact extends SourceFact {
  readonly kind: 'OBLIGATION_STATUS';
  readonly obligationId: string;
  readonly cashState: CashState;
  /** What Billing reports as still outstanding at this revision. */
  readonly outstanding: ExactAmount;
}

export type OperationsFact =
  | BookingConfirmedFact
  | HoldChangedFact
  | EligibilityChangedFact
  | AssignmentChangedFact
  | ObligationStatusFact;

/**
 * Canonical content of a fact. The same aggregate version arriving with
 * different content is an integrity conflict, never a silent overwrite.
 */
export function factFingerprint(fact: OperationsFact): string {
  switch (fact.kind) {
    case 'BOOKING_CONFIRMED':
      return JSON.stringify([fact.kind, fact.bookingId, fact.version, fact.customerRef]);
    case 'HOLD_CHANGED':
      return JSON.stringify([
        fact.kind,
        fact.holdId,
        fact.version,
        fact.state,
        fact.zoneId,
        fact.startsAt.toISOString(),
        fact.endsAt.toISOString(),
        fact.bookingId,
      ]);
    case 'ELIGIBILITY_CHANGED':
      return JSON.stringify([fact.kind, fact.resourceId, fact.version, fact.eligibility]);
    case 'ASSIGNMENT_CHANGED':
      return JSON.stringify([
        fact.kind,
        fact.assignmentId,
        fact.version,
        fact.bookingId,
        fact.status,
        fact.zoneId,
        fact.startsAt.toISOString(),
        fact.endsAt.toISOString(),
        fact.resourceId,
      ]);
    case 'OBLIGATION_STATUS':
      return JSON.stringify([
        fact.kind,
        fact.obligationId,
        fact.version,
        fact.cashState,
        fact.outstanding.currency,
        fact.outstanding.amountMinor.toString(),
        fact.outstanding.scale,
      ]);
  }
}

export type FactDecision = 'APPLY' | 'STALE' | 'SAME';

/**
 * Monotonic per-aggregate rule over the owner's version: newer applies, older
 * is stale, and the same version must carry the same content.
 */
export function decideFact(
  current: { readonly version: number; readonly fingerprint: string } | null,
  incoming: { readonly version: number; readonly fingerprint: string },
): FactDecision {
  if (!current || incoming.version > current.version) return 'APPLY';
  if (incoming.version < current.version) return 'STALE';
  if (current.fingerprint !== incoming.fingerprint)
    throw new OperationsIntegrityError('FACT_VERSION_CONFLICT');
  return 'SAME';
}

/**
 * A hold is linked to at most one booking for its whole life. The contract
 * carries the booking only on COMMITTED, so the link is learned from whichever
 * delivery carries it (even a stale one) and is then fixed.
 */
export function linkedBooking(existing: string | null, incoming: string | null): string | null {
  if (existing !== null && incoming !== null && existing !== incoming)
    throw new OperationsIntegrityError('HOLD_BOOKING_CONFLICT');
  return existing ?? incoming;
}

/**
 * Operational status DERIVED from the facts Reporting has seen. It is a
 * discovery aid for operators, not the Booking owner's lifecycle state.
 */
export type DerivedOperationsStatus =
  'SCHEDULED' | 'CONFIRMED_UNSCHEDULED' | 'SLOT_COMMITTED_UNCONFIRMED' | 'SLOT_RELEASED';

export const DERIVED_STATUSES: readonly DerivedOperationsStatus[] = [
  'SCHEDULED',
  'CONFIRMED_UNSCHEDULED',
  'SLOT_COMMITTED_UNCONFIRMED',
  'SLOT_RELEASED',
];

export interface BookingSlot {
  readonly holdId: string;
  readonly state: HoldState;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface LinkedHold extends BookingSlot {
  /** Source occurrence time of the hold's latest applied fact. */
  readonly occurredAt: Date;
}

function later(a: LinkedHold, b: LinkedHold): LinkedHold {
  const delta = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (delta !== 0) return delta > 0 ? a : b;
  return a.holdId > b.holdId ? a : b;
}

/**
 * The slot a booking currently occupies, independent of delivery order.
 * A committed hold always wins over released/expired ones: a reschedule
 * commits the new hold and releases the old one, and that release may occur
 * (and arrive) after the new commit. Without any committed hold, the most
 * recent hold explains why the booking has no slot.
 */
export function currentSlot(holds: readonly LinkedHold[]): BookingSlot | null {
  const committed = holds.filter((h) => h.state === 'COMMITTED');
  const pool = committed.length > 0 ? committed : holds;
  const first = pool[0];
  if (!first) return null;
  const chosen = pool.slice(1).reduce(later, first);
  return {
    holdId: chosen.holdId,
    state: chosen.state,
    zoneId: chosen.zoneId,
    startsAt: chosen.startsAt,
    endsAt: chosen.endsAt,
  };
}

export function deriveStatus(input: {
  readonly confirmed: boolean;
  readonly latestSlot: BookingSlot | null;
}): DerivedOperationsStatus | null {
  const slot = input.latestSlot;
  if (slot && (slot.state === 'RELEASED' || slot.state === 'EXPIRED')) return 'SLOT_RELEASED';
  if (input.confirmed) return slot?.state === 'COMMITTED' ? 'SCHEDULED' : 'CONFIRMED_UNSCHEDULED';
  if (slot?.state === 'COMMITTED') return 'SLOT_COMMITTED_UNCONFIRMED';
  return null;
}

export interface FreshnessCheckpoint {
  readonly lastEventOccurredAt: Date;
  readonly lastAppliedAt: Date;
  readonly appliedCount: bigint;
}

export type FreshnessStatus = 'NO_DATA' | 'FRESH' | 'STALE';

export interface Freshness {
  readonly source: OperationsSource;
  readonly status: FreshnessStatus;
  readonly lastEventOccurredAt: Date | null;
  readonly lastAppliedAt: Date | null;
  /** Ingestion delay of the newest applied event: appliedAt - occurredAt. */
  readonly ingestionLagMs: number | null;
  readonly appliedCount: bigint;
}

/** A source is FRESH when something was applied within this window. */
export const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Freshness of one source as Reporting observes it. STALE means "nothing
 * applied recently", which can be a quiet producer or a broken pipeline;
 * without producer heartbeats Reporting cannot tell those apart and says so.
 */
export function freshness(
  source: OperationsSource,
  checkpoint: FreshnessCheckpoint | null,
  now: Date,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): Freshness {
  if (!checkpoint)
    return {
      source,
      status: 'NO_DATA',
      lastEventOccurredAt: null,
      lastAppliedAt: null,
      ingestionLagMs: null,
      appliedCount: 0n,
    };
  const sinceApplied = now.getTime() - checkpoint.lastAppliedAt.getTime();
  return {
    source,
    status: sinceApplied <= staleAfterMs ? 'FRESH' : 'STALE',
    lastEventOccurredAt: checkpoint.lastEventOccurredAt,
    lastAppliedAt: checkpoint.lastAppliedAt,
    ingestionLagMs: Math.max(
      0,
      checkpoint.lastAppliedAt.getTime() - checkpoint.lastEventOccurredAt.getTime(),
    ),
    appliedCount: checkpoint.appliedCount,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_PAGE = 100;
export const DEFAULT_PAGE = 25;
export const MAX_WINDOW_DAYS = 31;

export function uuidInput(value: unknown, code: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new OperationsRuleError(code);
  return value.toLowerCase();
}

export function instantInput(value: unknown, code: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value))
    throw new OperationsRuleError(code);
  const parsed = new Date(value);
  // Reject calendar overflow such as 2026-02-30, which Date would roll forward.
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw new OperationsRuleError(code);
  return parsed;
}

export function pageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value))
    throw new OperationsRuleError('INVALID_LIMIT');
  const n = Number(value);
  if (n > MAX_PAGE) throw new OperationsRuleError('INVALID_LIMIT');
  return n;
}

/** Discovery window over slot start times: bounded so a query cannot scan everything. */
export function slotWindow(fromRaw: unknown, toRaw: unknown): { from: Date; to: Date } {
  const from = instantInput(fromRaw, 'INVALID_FROM');
  const to = instantInput(toRaw, 'INVALID_TO');
  const span = to.getTime() - from.getTime();
  if (span <= 0) throw new OperationsRuleError('INVALID_WINDOW');
  if (span > MAX_WINDOW_DAYS * 86_400_000) throw new OperationsRuleError('WINDOW_TOO_LARGE');
  return { from, to };
}
