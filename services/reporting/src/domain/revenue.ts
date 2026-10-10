/**
 * Revenue read-model rules, folded from Billing's PUBLISHED events.
 *
 * Pure domain. Billing owns obligations, their verification and refunds;
 * Reporting only keeps the latest observed financial status by Billing's
 * aggregate version and derives period totals from it. A settled figure is
 * what Billing reports as settled; pending is never called earned.
 */
import { OperationsIntegrityError, OperationsRuleError } from './operations';

export const FINANCIAL_STATUSES = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
  'PAID',
  'CASH_COLLECTED',
  'VOIDED',
] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

/**
 * Billing settled the obligation: PAID (verified electronic payment) or
 * CASH_COLLECTED (an authorised cash receipt). CASH_COLLECTED never means the
 * company holds the cash; custody is a separate Billing fact.
 */
export const SETTLED_STATUSES: readonly FinancialStatus[] = ['PAID', 'CASH_COLLECTED'];
/** Money is still expected or its outcome is unresolved: pending, never earned. */
export const PENDING_STATUSES: readonly FinancialStatus[] = [
  'UNPAID',
  'AWAITING_CASH',
  'AWAITING_PAYMENT',
  'UNDER_REVIEW',
  'OUTCOME_UNKNOWN',
];

export const REFUND_STATUSES = ['REQUESTED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
/** Refunds whose money movement is not yet known to have happened. */
export const OPEN_REFUND_STATUSES: readonly RefundStatus[] = ['REQUESTED', 'OUTCOME_UNKNOWN'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;

interface BillingFactBase {
  readonly source: 'billing';
  readonly eventId: string;
  readonly occurredAt: Date;
  /** Billing's aggregate version. */
  readonly version: number;
  readonly currency: string;
  readonly scale: number;
}

/** `billing.obligation-created.v1`: the obligation's amount and initial status. */
export interface ObligationCreatedFact extends BillingFactBase {
  readonly kind: 'REVENUE_OBLIGATION_CREATED';
  readonly obligationId: string;
  readonly status: FinancialStatus;
  readonly amountMinor: bigint;
}

/** `billing.obligation-status-changed.v1`: a new derived status with verified/outstanding. */
export interface ObligationStatusChangedFact extends BillingFactBase {
  readonly kind: 'REVENUE_OBLIGATION_STATUS';
  readonly obligationId: string;
  readonly status: FinancialStatus;
  readonly verifiedMinor: bigint;
  readonly outstandingMinor: bigint;
}

/** `billing.refund-status-changed.v1`. */
export interface RefundStatusFact extends BillingFactBase {
  readonly kind: 'REVENUE_REFUND';
  readonly refundId: string;
  readonly obligationId: string;
  readonly status: RefundStatus;
  readonly amountMinor: bigint;
}

export type RevenueFact = ObligationCreatedFact | ObligationStatusChangedFact | RefundStatusFact;

function uuid(value: string, code: string): string {
  if (!UUID.test(value)) throw new OperationsRuleError(code);
  return value.toLowerCase();
}

function minor(value: string): bigint {
  if (!MINOR.test(value)) throw new OperationsRuleError('INVALID_AMOUNT');
  return BigInt(value);
}

function base(input: {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly version: number;
  readonly currency: string;
  readonly scale: number;
}): BillingFactBase {
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw new OperationsRuleError('INVALID_OCCURRED_AT');
  if (!Number.isSafeInteger(input.version) || input.version < 1)
    throw new OperationsRuleError('INVALID_VERSION');
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new OperationsRuleError('INVALID_CURRENCY');
  if (!Number.isSafeInteger(input.scale) || input.scale < 0 || input.scale > 4)
    throw new OperationsRuleError('INVALID_SCALE');
  return {
    source: 'billing',
    eventId: uuid(input.eventId, 'INVALID_EVENT_ID'),
    occurredAt,
    version: input.version,
    currency: input.currency,
    scale: input.scale,
  };
}

export function obligationCreatedFact(input: {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly version: number;
  readonly obligationId: string;
  readonly status: FinancialStatus;
  readonly amount: {
    readonly currency: string;
    readonly amountMinor: string;
    readonly scale: number;
  };
}): ObligationCreatedFact {
  return {
    ...base({ ...input, currency: input.amount.currency, scale: input.amount.scale }),
    kind: 'REVENUE_OBLIGATION_CREATED',
    obligationId: uuid(input.obligationId, 'INVALID_OBLIGATION_ID'),
    status: input.status,
    amountMinor: minor(input.amount.amountMinor),
  };
}

export function obligationStatusFact(input: {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly version: number;
  readonly obligationId: string;
  readonly status: FinancialStatus;
  readonly verified: {
    readonly currency: string;
    readonly amountMinor: string;
    readonly scale: number;
  };
  readonly outstanding: {
    readonly currency: string;
    readonly amountMinor: string;
    readonly scale: number;
  };
}): ObligationStatusChangedFact {
  if (input.verified.currency !== input.outstanding.currency)
    throw new OperationsRuleError('INVALID_CURRENCY');
  const outstandingMinor = minor(input.outstanding.amountMinor);
  // A settled or voided obligation has nothing outstanding (Billing invariant).
  if (
    (SETTLED_STATUSES.includes(input.status) || input.status === 'VOIDED') &&
    outstandingMinor !== 0n
  )
    throw new OperationsRuleError('CLOSED_OBLIGATION_HAS_OUTSTANDING');
  return {
    ...base({ ...input, currency: input.verified.currency, scale: input.verified.scale }),
    kind: 'REVENUE_OBLIGATION_STATUS',
    obligationId: uuid(input.obligationId, 'INVALID_OBLIGATION_ID'),
    status: input.status,
    verifiedMinor: minor(input.verified.amountMinor),
    outstandingMinor,
  };
}

export function refundFact(input: {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly version: number;
  readonly refundId: string;
  readonly obligationId: string;
  readonly status: RefundStatus;
  readonly amount: {
    readonly currency: string;
    readonly amountMinor: string;
    readonly scale: number;
  };
}): RefundStatusFact {
  return {
    ...base({ ...input, currency: input.amount.currency, scale: input.amount.scale }),
    kind: 'REVENUE_REFUND',
    refundId: uuid(input.refundId, 'INVALID_REFUND_ID'),
    obligationId: uuid(input.obligationId, 'INVALID_OBLIGATION_ID'),
    status: input.status,
    amountMinor: minor(input.amount.amountMinor),
  };
}

/** Canonical content of a fact: same version + different content is an integrity conflict. */
export function revenueFingerprint(fact: RevenueFact): string {
  switch (fact.kind) {
    case 'REVENUE_OBLIGATION_CREATED':
      return JSON.stringify([
        fact.kind,
        fact.obligationId,
        fact.version,
        fact.status,
        fact.currency,
        fact.scale,
        fact.amountMinor.toString(),
      ]);
    case 'REVENUE_OBLIGATION_STATUS':
      return JSON.stringify([
        fact.kind,
        fact.obligationId,
        fact.version,
        fact.status,
        fact.currency,
        fact.scale,
        fact.verifiedMinor.toString(),
        fact.outstandingMinor.toString(),
      ]);
    case 'REVENUE_REFUND':
      return JSON.stringify([
        fact.kind,
        fact.refundId,
        fact.version,
        fact.obligationId,
        fact.status,
        fact.currency,
        fact.scale,
        fact.amountMinor.toString(),
      ]);
  }
}

/** Current revenue view of one obligation, as the store keeps it. */
export interface ObligationRevenueState {
  readonly version: number;
  readonly fingerprint: string;
  readonly status: FinancialStatus;
  readonly currency: string;
  readonly scale: number;
  readonly amountMinor: bigint | null;
  readonly verifiedMinor: bigint | null;
  readonly outstandingMinor: bigint | null;
  /** Billing occurrence time of the creation event, once seen (any delivery order). */
  readonly createdAt: Date | null;
  /** Occurrence time of the event that put the obligation in its current settled status. */
  readonly settledAt: Date | null;
  readonly sourceEventId: string;
  readonly occurredAt: Date;
}

export type RevenueDecision = 'APPLIED' | 'STALE' | 'SAME';

/**
 * Folds one obligation fact into its current revenue view.
 *
 * - The current status follows Billing's version: newer applies, older is
 *   STALE, and the same version must carry the same content.
 * - The creation fact's amount and time are true whatever the delivery order,
 *   so a stale creation still fills them in (never overwriting).
 * - `settledAt` is the occurrence of the status event that settled the
 *   obligation; a later non-settled status (for example a reversed cash
 *   collection) clears it, so the obligation leaves the settled figure.
 * - One obligation keeps one currency.
 */
export function foldObligation(
  current: ObligationRevenueState | null,
  fact: ObligationCreatedFact | ObligationStatusChangedFact,
  fingerprint: string,
): { readonly decision: RevenueDecision; readonly next: ObligationRevenueState | null } {
  if (current && (current.currency !== fact.currency || current.scale !== fact.scale))
    throw new OperationsIntegrityError('OBLIGATION_CURRENCY_CONFLICT');
  const isCreated = fact.kind === 'REVENUE_OBLIGATION_CREATED';
  const creation = {
    amountMinor: isCreated ? fact.amountMinor : (current?.amountMinor ?? null),
    createdAt: isCreated ? fact.occurredAt : (current?.createdAt ?? null),
  };
  if (current && fact.version === current.version) {
    if (current.fingerprint !== fingerprint)
      throw new OperationsIntegrityError('FACT_VERSION_CONFLICT');
    return { decision: 'SAME', next: null };
  }
  if (current && fact.version < current.version) {
    if (!isCreated || (current.createdAt !== null && current.amountMinor !== null))
      return { decision: 'STALE', next: null };
    return { decision: 'STALE', next: { ...current, ...creation } };
  }
  const settled = SETTLED_STATUSES.includes(fact.status);
  return {
    decision: 'APPLIED',
    next: {
      version: fact.version,
      fingerprint,
      status: fact.status,
      currency: fact.currency,
      scale: fact.scale,
      ...creation,
      verifiedMinor: isCreated ? (current?.verifiedMinor ?? null) : fact.verifiedMinor,
      outstandingMinor: isCreated ? (current?.outstandingMinor ?? null) : fact.outstandingMinor,
      settledAt: settled ? fact.occurredAt : null,
      sourceEventId: fact.eventId,
      occurredAt: fact.occurredAt,
    },
  };
}

/** Current view of one Billing refund. */
export interface RefundState {
  readonly version: number;
  readonly fingerprint: string;
  readonly obligationId: string;
  readonly status: RefundStatus;
  readonly currency: string;
  readonly scale: number;
  readonly amountMinor: bigint;
  /** Earliest Billing occurrence seen for this refund (any delivery order). */
  readonly firstObservedAt: Date;
  /** Occurrence of the SUCCEEDED event, when that is the current status. */
  readonly succeededAt: Date | null;
  readonly sourceEventId: string;
  readonly occurredAt: Date;
}

export function foldRefund(
  current: RefundState | null,
  fact: RefundStatusFact,
  fingerprint: string,
): { readonly decision: RevenueDecision; readonly next: RefundState | null } {
  if (
    current &&
    (current.currency !== fact.currency ||
      current.scale !== fact.scale ||
      current.obligationId !== fact.obligationId)
  )
    throw new OperationsIntegrityError('REFUND_IDENTITY_CONFLICT');
  const firstObservedAt =
    current && current.firstObservedAt.getTime() <= fact.occurredAt.getTime()
      ? current.firstObservedAt
      : fact.occurredAt;
  if (current && fact.version === current.version) {
    if (current.fingerprint !== fingerprint)
      throw new OperationsIntegrityError('FACT_VERSION_CONFLICT');
    return { decision: 'SAME', next: null };
  }
  if (current && fact.version < current.version)
    return current.firstObservedAt.getTime() === firstObservedAt.getTime()
      ? { decision: 'STALE', next: null }
      : { decision: 'STALE', next: { ...current, firstObservedAt } };
  return {
    decision: 'APPLIED',
    next: {
      version: fact.version,
      fingerprint,
      obligationId: fact.obligationId,
      status: fact.status,
      currency: fact.currency,
      scale: fact.scale,
      amountMinor: fact.amountMinor,
      firstObservedAt,
      succeededAt: fact.status === 'SUCCEEDED' ? fact.occurredAt : null,
      sourceEventId: fact.eventId,
      occurredAt: fact.occurredAt,
    },
  };
}
