import { Money } from './money';
import { outstanding, type IntentState, type ObligationState } from './payment';

/**
 * Cash after the wash: collection receipt, technician custody, handover to the
 * company, treasury receipt and settlement reconciliation.
 *
 * These are five DIFFERENT facts and none implies the next:
 *  1. service completed       - a work fact owned by Dispatch/C, verified here
 *                               through a port, never asserted by the client;
 *  2. cash collected          - an authorised collection receipt (Billing);
 *  3. cash held by technician - the receipt's custody status HELD and the
 *                               holder's CASH_IN_CUSTODY ledger balance;
 *  4. cash handed to company  - a handover the holder declares (PENDING), then
 *                               counted by an independent treasury receiver
 *                               (RECEIVED, with any shortage/overage explicit);
 *  5. settlement reconciled   - an independent reconciler confirms the treasury
 *                               deposit against its reference (RECONCILED).
 *
 * Mistakes are corrected by a linked reversal receipt, never by editing or
 * deleting the original. Shortage/overage are recorded, never auto-resolved:
 * their resolution policy is the owner's decision B-07.
 */
export const CUSTODY_STATUSES = [
  'HELD',
  'IN_HANDOVER',
  'DEPOSITED',
  'SETTLED',
  'REVERSED',
] as const;
export type CustodyStatus = (typeof CUSTODY_STATUSES)[number];
export const HANDOVER_STATUSES = ['PENDING', 'RECEIVED', 'RECONCILED', 'CANCELLED'] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];
/** Closed reason set: a correction never carries free text (PII risk). */
export const REVERSAL_REASONS = [
  'RECORDED_IN_ERROR',
  'WRONG_BOOKING',
  'AMOUNT_NOT_RECEIVED',
  'DUPLICATE_RECORD',
] as const;
export type ReversalReason = (typeof REVERSAL_REASONS)[number];
export const WORK_STATES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type WorkState = (typeof WORK_STATES)[number];
/** Bounds one handover so a single lock set and journal stay small. */
export const MAX_RECEIPTS_PER_HANDOVER = 200;

export type CashRuleCode =
  | 'OBLIGATION_SETTLED'
  | 'OBLIGATION_VOIDED'
  | 'NO_ACTIVE_INTENT'
  | 'INTENT_NOT_CASH'
  | 'COLLECTOR_NOT_ASSIGNED'
  | 'WORK_NOT_COMPLETED'
  | 'BOOKING_MISMATCH'
  | 'SELF_COLLECTION_FORBIDDEN'
  | 'AMOUNT_NOT_EQUAL_OUTSTANDING'
  | 'RECEIPT_ALREADY_REVERSED'
  | 'RECEIPT_NOT_HELD'
  | 'SEPARATION_OF_DUTIES'
  | 'HANDOVER_EMPTY'
  | 'HANDOVER_TOO_LARGE'
  | 'HANDOVER_DUPLICATE_RECEIPT'
  | 'HANDOVER_MIXED_CURRENCY'
  | 'DECLARED_TOTAL_MISMATCH'
  | 'HANDOVER_NOT_PENDING'
  | 'HANDOVER_NOT_RECEIVED'
  | 'CURRENCY_MISMATCH';

export class CashRuleError extends Error {
  constructor(readonly code: CashRuleCode) {
    super(code);
    this.name = 'CashRuleError';
  }
}

/** What the work owner (Dispatch/Booking, lane C) confirms about one booking. */
export interface WorkEvidence {
  readonly bookingId: string;
  /** The quote the booking pinned; binds the booking to exactly one obligation. */
  readonly quoteId: string;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  /** The technician currently assigned, or null when nobody is. */
  readonly technicianSubject: string | null;
  readonly workState: WorkState;
}

export interface ReceiptState {
  readonly collector: string;
  readonly amount: Money;
  readonly custodyStatus: CustodyStatus;
}

export interface HandoverState {
  readonly holder: string;
  readonly status: HandoverStatus;
  readonly declared: Money;
  readonly counted: Money | null;
  readonly receivedBy: string | null;
}

export interface CollectionPlan {
  readonly received: Money;
}

/**
 * A technician records the cash the customer handed over. Allowed only for the
 * technician the work owner says is assigned, after the work owner says the
 * service is COMPLETED, for the booking whose quote is this obligation's quote,
 * against an active cash intent, and for exactly the outstanding amount
 * (no partial or over-collection is silently accepted).
 */
export function planCashCollection(input: {
  readonly obligation: ObligationState & { readonly quoteId: string };
  readonly intent: IntentState | null;
  readonly owner: string;
  readonly collector: string;
  readonly work: WorkEvidence;
  readonly declared: Money;
}): CollectionPlan {
  // Binding and assignment first, so a technician who is not the assignee
  // learns nothing about the obligation's financial state.
  if (input.work.quoteId !== input.obligation.quoteId) throw new CashRuleError('BOOKING_MISMATCH');
  if (input.work.technicianSubject !== input.collector)
    throw new CashRuleError('COLLECTOR_NOT_ASSIGNED');
  if (input.collector === input.owner) throw new CashRuleError('SELF_COLLECTION_FORBIDDEN');
  if (input.obligation.status === 'SETTLED') throw new CashRuleError('OBLIGATION_SETTLED');
  if (input.obligation.status === 'VOIDED') throw new CashRuleError('OBLIGATION_VOIDED');
  if (input.work.workState !== 'COMPLETED') throw new CashRuleError('WORK_NOT_COMPLETED');
  if (!input.intent) throw new CashRuleError('NO_ACTIVE_INTENT');
  if (
    input.intent.method !== 'CASH_ON_COMPLETION' ||
    input.intent.status !== 'AWAITING_CASH_COLLECTION'
  )
    throw new CashRuleError('INTENT_NOT_CASH');
  if (input.declared.currency !== input.obligation.amount.currency)
    throw new CashRuleError('CURRENCY_MISMATCH');
  const due = outstanding(input.obligation);
  if (due.isZero() || !input.declared.equals(due))
    throw new CashRuleError('AMOUNT_NOT_EQUAL_OUTSTANDING');
  return { received: input.declared };
}

/**
 * A linked reversal of a collection recorded in error. Only cash still HELD by
 * the collector can be reversed here: once it is in a handover or at the
 * treasury, the correction is a treasury adjustment (owner decision B-06/B-07),
 * which is refused explicitly instead of being hidden. The collector can never
 * reverse their own receipt.
 */
export function planCollectionReversal(input: {
  readonly receipt: ReceiptState;
  readonly reverser: string;
}): void {
  if (input.receipt.custodyStatus === 'REVERSED')
    throw new CashRuleError('RECEIPT_ALREADY_REVERSED');
  if (input.receipt.custodyStatus !== 'HELD') throw new CashRuleError('RECEIPT_NOT_HELD');
  if (input.reverser === input.receipt.collector) throw new CashRuleError('SEPARATION_OF_DUTIES');
}

/**
 * The holder declares a handover of some of their HELD receipts. The declared
 * total is an assertion that must equal the server's sum of those receipts, so
 * a stale client view cannot hand over a different amount.
 */
export function planHandover(input: {
  readonly holder: string;
  readonly receipts: readonly (ReceiptState & { readonly id: string })[];
  readonly requestedIds: readonly string[];
  readonly declared: Money;
}): { readonly total: Money } {
  if (input.requestedIds.length === 0) throw new CashRuleError('HANDOVER_EMPTY');
  if (input.requestedIds.length > MAX_RECEIPTS_PER_HANDOVER)
    throw new CashRuleError('HANDOVER_TOO_LARGE');
  if (new Set(input.requestedIds).size !== input.requestedIds.length)
    throw new CashRuleError('HANDOVER_DUPLICATE_RECEIPT');
  let total = Money.zero(input.declared.currency);
  for (const receipt of input.receipts) {
    if (receipt.collector !== input.holder) throw new CashRuleError('RECEIPT_NOT_HELD');
    if (receipt.custodyStatus !== 'HELD') throw new CashRuleError('RECEIPT_NOT_HELD');
    if (receipt.amount.currency !== input.declared.currency)
      throw new CashRuleError('HANDOVER_MIXED_CURRENCY');
    total = total.plus(receipt.amount);
  }
  if (input.receipts.length !== input.requestedIds.length)
    throw new CashRuleError('RECEIPT_NOT_HELD');
  if (!total.equals(input.declared)) throw new CashRuleError('DECLARED_TOTAL_MISMATCH');
  return { total };
}

/** The holder withdraws a pending handover, or the treasury refuses to take it. */
export function planHandoverCancel(input: { readonly handover: HandoverState }): void {
  if (input.handover.status !== 'PENDING') throw new CashRuleError('HANDOVER_NOT_PENDING');
}

export interface TreasuryReceiptPlan {
  readonly counted: Money;
  /** declared - counted when positive: cash the holder still owes. */
  readonly shortage: Money;
  /** counted - declared when positive: unexplained cash held in suspense. */
  readonly overage: Money;
}

/**
 * An independent treasury receiver counts the cash. A difference is recorded as
 * an explicit shortage (receivable from the holder) or overage (suspense), and
 * never silently absorbed. The holder can never receive their own handover.
 */
export function planTreasuryReceipt(input: {
  readonly handover: HandoverState;
  readonly receiver: string;
  readonly counted: Money;
}): TreasuryReceiptPlan {
  if (input.handover.status !== 'PENDING') throw new CashRuleError('HANDOVER_NOT_PENDING');
  if (input.receiver === input.handover.holder) throw new CashRuleError('SEPARATION_OF_DUTIES');
  const declared = input.handover.declared;
  if (input.counted.currency !== declared.currency) throw new CashRuleError('CURRENCY_MISMATCH');
  const zero = Money.zero(declared.currency);
  if (input.counted.amountMinor < declared.amountMinor)
    return { counted: input.counted, shortage: declared.minus(input.counted), overage: zero };
  return { counted: input.counted, shortage: zero, overage: input.counted.minus(declared) };
}

/**
 * Final settlement: a reconciler who is neither the holder nor the receiver
 * confirms that the counted cash reached the company's account/safe.
 */
export function planHandoverReconciliation(input: {
  readonly handover: HandoverState;
  readonly reconciler: string;
}): void {
  if (input.handover.status !== 'RECEIVED') throw new CashRuleError('HANDOVER_NOT_RECEIVED');
  if (input.reconciler === input.handover.holder || input.reconciler === input.handover.receivedBy)
    throw new CashRuleError('SEPARATION_OF_DUTIES');
}

/** Custody status every receipt of a handover must have for its status. */
export function receiptStatusFor(handover: HandoverStatus): CustodyStatus {
  switch (handover) {
    case 'PENDING':
      return 'IN_HANDOVER';
    case 'RECEIVED':
      return 'DEPOSITED';
    case 'RECONCILED':
      return 'SETTLED';
    case 'CANCELLED':
      return 'HELD';
  }
}

export const TREASURY_REFERENCE = /^[A-Za-z0-9-]{4,64}$/;

/** Treasury/settlement references compare case- and separator-insensitively. */
export function normalizeTreasuryReference(raw: unknown): string | null {
  if (typeof raw !== 'string' || !TREASURY_REFERENCE.test(raw)) return null;
  const normalized = raw.replaceAll('-', '').toUpperCase();
  return normalized.length >= 4 ? normalized : null;
}
