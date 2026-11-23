import {
  addMoney,
  compareMoney,
  money,
  parseNonNegativeMoney,
  type Currency,
  type Money,
} from '../common/money';
import { PAYMENT_METHODS, type PaymentMethod } from '../common/payment-method';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { ContractViolation, closed, list, oneOf, text, uuid } from '../common/wire';

/**
 * billing.v1 refunds and provider notifications (P04-E1, contract-first).
 *
 * Refund model (manual-review mode, the accepted production mode until a
 * provider with a refund API and merchant agreement exists):
 *  1. Finance (`billing.refund`) REQUESTS a refund on a SETTLED obligation for at
 *     most the refundable amount: verified − succeeded − in-flight refunds.
 *     Concurrent requests that together exceed it: exactly one wins, the rest get
 *     409 REFUND_EXCEEDS_REFUNDABLE (refund race).
 *  2. Money is returned out-of-band (wallet transfer or cash voucher).
 *  3. A DIFFERENT person (`billing.reconcile`, never the requester) records the
 *     outcome: SUCCEEDED (with the provider/voucher reference), FAILED, or UNKNOWN.
 *     UNKNOWN stays in flight (still counts against refundable) and is resolved
 *     later to SUCCEEDED or FAILED, never back to UNKNOWN and never by timeout.
 *
 * REQUESTED and OUTCOME_UNKNOWN never mean the money went back. A refund never
 * changes `financialStatus` in v1; clients read refunds explicitly.
 * Refund views carry no staff subjects and no full references (masked).
 */

export const REFUND_STATUSES = ['REQUESTED', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
/** In flight: counts against the refundable amount until it SUCCEEDS or FAILS. */
export const IN_FLIGHT_REFUND_STATUSES: readonly RefundStatus[] = ['REQUESTED', 'OUTCOME_UNKNOWN'];
export const REFUND_OUTCOMES = ['SUCCEEDED', 'FAILED', 'UNKNOWN'] as const;
export type RefundOutcome = (typeof REFUND_OUTCOMES)[number];
/** Closed reasons; a refund never carries free text (PII risk). */
export const REFUND_REASONS = [
  'BOOKING_CANCELLED',
  'SERVICE_NOT_DELIVERED',
  'DUPLICATE_PAYMENT',
  'SERVICE_QUALITY',
  'PRICE_CORRECTION',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
export const REFUND_REFERENCE = /^[A-Za-z0-9-]{4,64}$/;
export const MAX_REFUNDS_PER_OBLIGATION = 20;
const MASKED = /^…[A-Za-z0-9-]{4}$/;

export interface RefundV1 {
  readonly refundId: string;
  readonly obligationId: string;
  readonly revision: number;
  readonly status: RefundStatus;
  readonly reason: RefundReason;
  /** The method the money is returned through (the method that was paid). */
  readonly method: PaymentMethod;
  readonly amount: Money;
  /** Masked; non-null exactly when SUCCEEDED. */
  readonly reference: string | null;
  readonly requestedAt: UtcTimestamp;
  /** Non-null exactly when an outcome was recorded (status is not REQUESTED). */
  readonly decidedAt: UtcTimestamp | null;
  readonly updatedAt: UtcTimestamp;
}

export interface ObligationRefundsV1 {
  readonly obligationId: string;
  /** Sum of SUCCEEDED refunds. */
  readonly refunded: Money;
  /** Sum of REQUESTED + OUTCOME_UNKNOWN refunds. */
  readonly inFlight: Money;
  /** What may still be requested: verified − refunded − inFlight (never negative). */
  readonly refundable: Money;
  /** Newest first. */
  readonly items: readonly RefundV1[];
}

export interface RequestRefundRequestV1 {
  /** The obligation revision the requester saw. */
  readonly expectedRevision: number;
  readonly amount: Money;
  readonly reason: RefundReason;
}

export interface RecordRefundOutcomeRequestV1 {
  /** The refund revision the recorder saw. */
  readonly expectedRevision: number;
  readonly outcome: RefundOutcome;
  /** Required for SUCCEEDED (the transfer/voucher reference); null otherwise. */
  readonly reference: string | null;
}

export function parseRefundV1(value: unknown, path = '$'): RefundV1 {
  const v = closed(value, path, [
    'refundId',
    'obligationId',
    'revision',
    'status',
    'reason',
    'method',
    'amount',
    'reference',
    'requestedAt',
    'decidedAt',
    'updatedAt',
  ]);
  const status = oneOf(v.status, `${path}.status`, REFUND_STATUSES);
  const reference =
    v.reference === null
      ? null
      : text(v.reference, `${path}.reference`, { max: 5, pattern: MASKED });
  if ((status === 'SUCCEEDED') !== (reference !== null)) {
    throw new ContractViolation('INCONSISTENT_REFUND_REFERENCE', `${path}.reference`);
  }
  const decidedAt = v.decidedAt === null ? null : parseUtc(v.decidedAt, `${path}.decidedAt`);
  if ((status === 'REQUESTED') !== (decidedAt === null)) {
    throw new ContractViolation('INCONSISTENT_REFUND_DECISION', `${path}.decidedAt`);
  }
  const amount = parseNonNegativeMoney(v.amount, `${path}.amount`);
  if (amount.amountMinor === '0') throw new ContractViolation('ZERO_REFUND', `${path}.amount`);
  return {
    refundId: uuid(v.refundId, `${path}.refundId`),
    obligationId: uuid(v.obligationId, `${path}.obligationId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    status,
    reason: oneOf(v.reason, `${path}.reason`, REFUND_REASONS),
    method: oneOf(v.method, `${path}.method`, PAYMENT_METHODS),
    amount,
    reference,
    requestedAt: parseUtc(v.requestedAt, `${path}.requestedAt`),
    decidedAt,
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

function total(currency: Currency, items: readonly RefundV1[], statuses: readonly RefundStatus[]) {
  return items
    .filter((item) => statuses.includes(item.status))
    .reduce<Money>((sum, item) => addMoney(sum, item.amount), money(currency, 0n));
}

export function parseObligationRefundsV1(value: unknown, path = '$'): ObligationRefundsV1 {
  const v = closed(value, path, ['obligationId', 'refunded', 'inFlight', 'refundable', 'items']);
  const obligationId = uuid(v.obligationId, `${path}.obligationId`);
  const refunded = parseNonNegativeMoney(v.refunded, `${path}.refunded`);
  const inFlight = parseNonNegativeMoney(v.inFlight, `${path}.inFlight`);
  const refundable = parseNonNegativeMoney(v.refundable, `${path}.refundable`);
  const currency = refunded.currency;
  if (inFlight.currency !== currency || refundable.currency !== currency) {
    throw new ContractViolation('CURRENCY_MISMATCH', path);
  }
  const items = list(v.items, `${path}.items`, MAX_REFUNDS_PER_OBLIGATION, (item, at) =>
    parseRefundV1(item, at),
  );
  for (const [index, item] of items.entries()) {
    if (item.obligationId !== obligationId)
      throw new ContractViolation('FOREIGN_REFUND', `${path}.items[${index}].obligationId`);
    if (item.amount.currency !== currency)
      throw new ContractViolation('CURRENCY_MISMATCH', `${path}.items[${index}].amount`);
  }
  if (new Set(items.map((item) => item.refundId)).size !== items.length) {
    throw new ContractViolation('DUPLICATE_ITEM', `${path}.items`);
  }
  for (let i = 1; i < items.length; i += 1) {
    const newer = items[i - 1];
    const older = items[i];
    if (newer && older && Date.parse(newer.requestedAt) < Date.parse(older.requestedAt)) {
      throw new ContractViolation('REFUNDS_NOT_NEWEST_FIRST', `${path}.items`);
    }
  }
  // Totals are derived from the items; a summary that disagrees is a provider defect.
  if (compareMoney(total(currency, items, ['SUCCEEDED']), refunded) !== 0) {
    throw new ContractViolation('INCONSISTENT_REFUNDED', `${path}.refunded`);
  }
  if (compareMoney(total(currency, items, IN_FLIGHT_REFUND_STATUSES), inFlight) !== 0) {
    throw new ContractViolation('INCONSISTENT_IN_FLIGHT', `${path}.inFlight`);
  }
  return { obligationId, refunded, inFlight, refundable, items };
}

export function parseRequestRefundRequestV1(value: unknown): RequestRefundRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'amount', 'reason']);
  const amount = parseNonNegativeMoney(v.amount, '$.amount');
  if (amount.amountMinor === '0') throw new ContractViolation('ZERO_REFUND', '$.amount');
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    amount,
    reason: oneOf(v.reason, '$.reason', REFUND_REASONS),
  };
}

export function parseRecordRefundOutcomeRequestV1(value: unknown): RecordRefundOutcomeRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'outcome', 'reference']);
  const outcome = oneOf(v.outcome, '$.outcome', REFUND_OUTCOMES);
  if ((outcome === 'SUCCEEDED') !== (v.reference !== null)) {
    throw new ContractViolation(
      outcome === 'SUCCEEDED' ? 'REFUND_REFERENCE_REQUIRED' : 'REFUND_REFERENCE_NOT_ALLOWED',
      '$.reference',
    );
  }
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    outcome,
    reference:
      v.reference === null
        ? null
        : text(v.reference, '$.reference', { min: 4, max: 64, pattern: REFUND_REFERENCE }),
  };
}

/**
 * Provider server notifications (`receiveProviderNotification`).
 *
 * The body is the provider's own format and is NOT parsed by this package:
 * Billing's provider adapter verifies the signature over the exact raw bytes
 * before parsing anything. The Gateway forwards only the raw body (bounded),
 * the content type and the allowlisted provider headers below; never cookies,
 * bearer tokens, identity or client-supplied forwarding headers.
 *
 * Responses: 204 for an accepted OR already-seen notification (a provider
 * retry is never an error and never re-applies the fact); 401 with reason
 * NOTIFICATION_SIGNATURE_INVALID or NOTIFICATION_STALE; 404 for an unknown
 * provider; 413 above the size limit; 503 NOTIFICATION_PROVIDER_DISABLED while
 * no merchant/provider configuration is active. A notification is a CLAIM to be
 * reconciled against the obligation; it never settles one without the same
 * exact-amount rules as manual reconciliation.
 */
export const PAYMENT_PROVIDERS = ['sham-cash', 'syriatel-cash'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
export const PROVIDER_NOTIFICATION_HEADERS = [
  'x-provider-signature',
  'x-provider-timestamp',
  'x-provider-notification-id',
] as const;
export const PROVIDER_NOTIFICATION_MAX_BYTES = 16_384;
/** Accepted clock skew / replay window for the signed timestamp. */
export const PROVIDER_NOTIFICATION_TOLERANCE_SECONDS = 300;

export function parsePaymentProvider(value: unknown, path = '$.provider'): PaymentProvider {
  return oneOf(value, path, PAYMENT_PROVIDERS);
}
