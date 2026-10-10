/**
 * Live-operations rules: assignment timing and cash-state facts.
 *
 * Pure domain. Dispatch owns assignments and Billing owns obligations; this
 * module only validates the facts Reporting folds and derives timing and
 * backlog figures from them. Nothing here can change an owner's state.
 */
import {
  ASSIGNMENT_STATUSES,
  CASH_STATES,
  OperationsRuleError,
  type AssignmentChangedFact,
  type AssignmentStatus,
  type ExactAmount,
  type ObligationStatusFact,
} from './operations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
/** 18 digits keeps every amount inside PostgreSQL BIGINT. */
const AMOUNT_LIMIT = 10n ** 18n;

function id(value: string, code: string): string {
  if (!UUID.test(value)) throw new OperationsRuleError(code);
  return value.toLowerCase();
}

function instant(value: Date, code: string): Date {
  if (!Number.isFinite(value.getTime())) throw new OperationsRuleError(code);
  return value;
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new OperationsRuleError('INVALID_VERSION');
  return value;
}

/**
 * Builds a validated assignment fact. The Dispatch invariant is checked again
 * here: a resource is named exactly when the assignment is ASSIGNED, and the
 * job window is non-empty. A violating fact is rejected, never repaired.
 */
export function assignmentFact(input: {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly version: number;
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly status: string;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly resourceId: string | null;
}): AssignmentChangedFact {
  const status = ASSIGNMENT_STATUSES.find((s) => s === input.status);
  if (!status) throw new OperationsRuleError('INVALID_ASSIGNMENT_STATUS');
  if ((status === 'ASSIGNED') !== (input.resourceId !== null))
    throw new OperationsRuleError('ASSIGNMENT_RESOURCE_MISMATCH');
  const startsAt = instant(input.startsAt, 'INVALID_JOB_WINDOW');
  const endsAt = instant(input.endsAt, 'INVALID_JOB_WINDOW');
  if (endsAt.getTime() <= startsAt.getTime()) throw new OperationsRuleError('INVALID_JOB_WINDOW');
  return {
    kind: 'ASSIGNMENT_CHANGED',
    source: 'dispatch',
    eventId: id(input.eventId, 'INVALID_EVENT_ID'),
    occurredAt: instant(input.occurredAt, 'INVALID_OCCURRED_AT'),
    version: version(input.version),
    assignmentId: id(input.assignmentId, 'INVALID_ASSIGNMENT_ID'),
    bookingId: id(input.bookingId, 'INVALID_BOOKING_ID'),
    status,
    zoneId: id(input.zoneId, 'INVALID_ZONE'),
    startsAt,
    endsAt,
    resourceId: input.resourceId === null ? null : id(input.resourceId, 'INVALID_RESOURCE_ID'),
  };
}

/** Strict exact amount: integer minor units, a three-letter code and a small scale. */
export function exactAmount(input: {
  readonly currency: string;
  readonly amountMinor: string;
  readonly scale: number;
}): ExactAmount {
  if (!CURRENCY.test(input.currency)) throw new OperationsRuleError('INVALID_CURRENCY');
  if (!Number.isSafeInteger(input.scale) || input.scale < 0 || input.scale > 4)
    throw new OperationsRuleError('INVALID_SCALE');
  if (!/^(0|[1-9][0-9]{0,17})$/.test(input.amountMinor))
    throw new OperationsRuleError('INVALID_AMOUNT');
  const amountMinor = BigInt(input.amountMinor);
  if (amountMinor >= AMOUNT_LIMIT) throw new OperationsRuleError('INVALID_AMOUNT');
  return { currency: input.currency, amountMinor, scale: input.scale };
}

/**
 * Builds a validated obligation fact. A settled or voided obligation has
 * nothing outstanding; any other combination is a contradiction Reporting
 * refuses to fold.
 */
export function obligationFact(input: {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly version: number;
  readonly obligationId: string;
  readonly cashState: string;
  readonly outstanding: ExactAmount;
}): ObligationStatusFact {
  const cashState = CASH_STATES.find((s) => s === input.cashState);
  if (!cashState) throw new OperationsRuleError('INVALID_CASH_STATE');
  if ((cashState === 'PAID' || cashState === 'VOIDED') && input.outstanding.amountMinor !== 0n)
    throw new OperationsRuleError('CLOSED_OBLIGATION_HAS_OUTSTANDING');
  return {
    kind: 'OBLIGATION_STATUS',
    source: 'billing',
    eventId: id(input.eventId, 'INVALID_EVENT_ID'),
    occurredAt: instant(input.occurredAt, 'INVALID_OCCURRED_AT'),
    version: version(input.version),
    obligationId: id(input.obligationId, 'INVALID_OBLIGATION_ID'),
    cashState,
    outstanding: exactAmount({
      currency: input.outstanding.currency,
      amountMinor: input.outstanding.amountMinor.toString(),
      scale: input.outstanding.scale,
    }),
  };
}

/**
 * First-occurrence milestones of one assignment. Each is the EARLIEST source
 * occurrence Reporting has seen for that status, so it is independent of
 * delivery order: a stale delivery cannot change the current state, but it is
 * still a true historical occurrence and may move a milestone earlier.
 */
export interface AssignmentMilestones {
  readonly firstObservedAt: Date;
  readonly firstOfferedAt: Date | null;
  readonly firstAssignedAt: Date | null;
}

function earlier(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

export function mergeMilestones(
  current: AssignmentMilestones | null,
  fact: { readonly status: AssignmentStatus; readonly occurredAt: Date },
): AssignmentMilestones {
  const at = fact.occurredAt;
  return {
    firstObservedAt: earlier(current?.firstObservedAt ?? null, at) ?? at,
    firstOfferedAt: earlier(current?.firstOfferedAt ?? null, fact.status === 'OFFERED' ? at : null),
    firstAssignedAt: earlier(
      current?.firstAssignedAt ?? null,
      fact.status === 'ASSIGNED' ? at : null,
    ),
  };
}

/** Distribution of non-negative durations, by nearest rank. */
export interface DurationSummary {
  readonly count: number;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
  readonly maxMs: number | null;
}

/**
 * Nearest-rank percentile (the smallest value whose cumulative share is at
 * least p). This is exactly PostgreSQL's `percentile_disc`, so the database
 * aggregate and this reference implementation agree value for value.
 */
export function nearestRank(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (!(p > 0 && p <= 1)) throw new OperationsRuleError('INVALID_PERCENTILE');
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? null;
}

export function summarizeDurations(values: readonly number[]): DurationSummary {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50Ms: nearestRank(sorted, 0.5),
    p90Ms: nearestRank(sorted, 0.9),
    maxMs: sorted.length === 0 ? null : (sorted[sorted.length - 1] ?? null),
  };
}

/**
 * A KPI is complete only when every source it depends on is FRESH. A missing
 * or quiet source makes the figure partial, and the response says which.
 */
export function incompleteSources(
  freshness: readonly { readonly source: string; readonly status: string }[],
): readonly string[] {
  return freshness.filter((f) => f.status !== 'FRESH').map((f) => f.source);
}
