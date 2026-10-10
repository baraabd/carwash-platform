import { CURRENCIES, parseNonNegativeMoney, type Currency, type Money } from '../common/money';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import {
  ContractViolation,
  boolean,
  closed,
  integer,
  list,
  oneOf,
  text,
  uuid,
} from '../common/wire';

/**
 * billing.v1 cash collection, technician custody and settlement shapes
 * (CR-B-08, conforming to the merged P03-B1 provider).
 *
 * Collected cash is NOT company money until a treasury receipt and a settlement
 * reconcile it; a collection never changes what the customer paid twice. Treasury
 * and settlement references are shown masked (last four characters only).
 * Staff subjects in these views are Identity subject ids; these views are
 * served to the holder or to `billing.read` staff only, never to customers.
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
export const MAX_RECEIPTS_PER_HANDOVER = 200;
/** Treasury voucher / settlement reference as typed by Finance. */
export const TREASURY_REFERENCE = /^[A-Za-z0-9-]{4,64}$/;
const MASKED = /^…[A-Za-z0-9-]{4}$/;
const SIGNED_MINOR = /^(0|-?[1-9][0-9]{0,17})$/;
const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];

export interface CashReversalV1 {
  readonly reversalId: string;
  readonly reason: ReversalReason;
  readonly reversedBy: string;
  readonly reversedAt: UtcTimestamp;
}

export interface CashReceiptV1 {
  readonly receiptId: string;
  readonly revision: number;
  readonly obligationId: string;
  readonly bookingId: string;
  readonly assignmentId: string;
  readonly assignmentRevision: number;
  readonly collector: string;
  readonly amount: Money;
  readonly custodyStatus: CustodyStatus;
  readonly handoverId: string | null;
  readonly collectedAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly reversal: CashReversalV1 | null;
}

export interface HandoverV1 {
  readonly handoverId: string;
  readonly revision: number;
  readonly holder: string;
  readonly status: HandoverStatus;
  readonly receiptCount: number;
  readonly receiptIds: readonly string[];
  readonly declared: Money;
  readonly counted: Money | null;
  readonly shortage: Money | null;
  readonly overage: Money | null;
  readonly treasuryReference: string | null;
  readonly receivedBy: string | null;
  readonly receivedAt: UtcTimestamp | null;
  readonly settlementReference: string | null;
  readonly reconciledBy: string | null;
  readonly reconciledAt: UtcTimestamp | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface HolderBalanceV1 {
  readonly currency: Currency;
  readonly ledgerCustody: Money;
  readonly held: Money;
  readonly heldCount: number;
  readonly inHandover: Money;
  readonly inHandoverCount: number;
  readonly shortageOutstanding: Money;
}

export interface HolderPositionV1 {
  readonly holder: string;
  readonly balances: readonly HolderBalanceV1[];
}

export interface CustodyReconciliationReportV1 {
  readonly evaluatedAt: UtcTimestamp;
  readonly consistent: boolean;
  readonly holdersChecked: number;
  readonly holderMismatches: readonly {
    readonly holder: string;
    readonly currency: Currency;
    /** Exact signed minor units, never clamped. */
    readonly ledgerCustodyMinor: string;
    readonly receiptsInCustodyMinor: string;
  }[];
  readonly receiptsWithoutSettledObligation: number;
  readonly cashSettlementsWithoutReceipt: number;
  readonly handoversPending: number;
  readonly handoversAwaitingReconciliation: number;
  readonly handoversWithDiscrepancy: number;
  readonly treasury: readonly {
    readonly currency: Currency;
    readonly unreconciled: Money;
    readonly reconciled: Money;
    readonly shortageOutstanding: Money;
    readonly overageSuspense: Money;
  }[];
}

export interface RecordCashCollectionRequestV1 {
  readonly expectedRevision: number;
  readonly bookingId: string;
  readonly amount: Money;
}
export interface ReverseCashCollectionRequestV1 {
  readonly expectedRevision: number;
  readonly reason: ReversalReason;
}
export interface DeclareHandoverRequestV1 {
  readonly receiptIds: readonly string[];
  readonly declaredAmount: Money;
}
export interface CancelHandoverRequestV1 {
  readonly expectedRevision: number;
}
export interface ReceiveHandoverRequestV1 {
  readonly expectedRevision: number;
  readonly countedAmount: Money;
  readonly treasuryReference: string;
}
export interface ReconcileHandoverRequestV1 {
  readonly expectedRevision: number;
  readonly settlementReference: string;
}

const count = (value: unknown, path: string): number => integer(value, path, 0, 2_147_483_647);
const nullable = <T>(value: unknown, parse: (v: unknown) => T): T | null =>
  value === null ? null : parse(value);
const masked = (value: unknown, path: string): string | null =>
  nullable(value, (v) => text(v, path, { max: 5, pattern: MASKED }));

function inCurrency(value: unknown, path: string, currency: Currency): Money {
  const parsed = parseNonNegativeMoney(value, path);
  if (parsed.currency !== currency) throw new ContractViolation('CURRENCY_MISMATCH', path);
  return parsed;
}

export function parseCashReceiptV1(value: unknown, path = '$'): CashReceiptV1 {
  const v = closed(value, path, [
    'receiptId',
    'revision',
    'obligationId',
    'bookingId',
    'assignmentId',
    'assignmentRevision',
    'collector',
    'amount',
    'custodyStatus',
    'handoverId',
    'collectedAt',
    'updatedAt',
    'reversal',
  ]);
  const custodyStatus = oneOf(v.custodyStatus, `${path}.custodyStatus`, CUSTODY_STATUSES);
  const reversal = nullable(v.reversal, (r) => {
    const x = closed(r, `${path}.reversal`, ['reversalId', 'reason', 'reversedBy', 'reversedAt']);
    return {
      reversalId: uuid(x.reversalId, `${path}.reversal.reversalId`),
      reason: oneOf(x.reason, `${path}.reversal.reason`, REVERSAL_REASONS),
      reversedBy: uuid(x.reversedBy, `${path}.reversal.reversedBy`),
      reversedAt: parseUtc(x.reversedAt, `${path}.reversal.reversedAt`),
    };
  });
  if ((custodyStatus === 'REVERSED') !== (reversal !== null)) {
    throw new ContractViolation('INCONSISTENT_REVERSAL', `${path}.reversal`);
  }
  const handoverId = nullable(v.handoverId, (h) => uuid(h, `${path}.handoverId`));
  if (custodyStatus === 'IN_HANDOVER' && handoverId === null) {
    throw new ContractViolation('HANDOVER_MISSING', `${path}.handoverId`);
  }
  return {
    receiptId: uuid(v.receiptId, `${path}.receiptId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    obligationId: uuid(v.obligationId, `${path}.obligationId`),
    bookingId: uuid(v.bookingId, `${path}.bookingId`),
    assignmentId: uuid(v.assignmentId, `${path}.assignmentId`),
    assignmentRevision: parseRevision(v.assignmentRevision, `${path}.assignmentRevision`),
    collector: uuid(v.collector, `${path}.collector`),
    amount: parseNonNegativeMoney(v.amount, `${path}.amount`),
    custodyStatus,
    handoverId,
    collectedAt: parseUtc(v.collectedAt, `${path}.collectedAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
    reversal,
  };
}

export function parseHandoverV1(value: unknown, path = '$'): HandoverV1 {
  const v = closed(value, path, [
    'handoverId',
    'revision',
    'holder',
    'status',
    'receiptCount',
    'receiptIds',
    'declared',
    'counted',
    'shortage',
    'overage',
    'treasuryReference',
    'receivedBy',
    'receivedAt',
    'settlementReference',
    'reconciledBy',
    'reconciledAt',
    'cancelledBy',
    'cancelledAt',
    'createdAt',
    'updatedAt',
  ]);
  const status = oneOf(v.status, `${path}.status`, HANDOVER_STATUSES);
  const declared = parseNonNegativeMoney(v.declared, `${path}.declared`);
  const c = declared.currency;
  const receiptIds = list(v.receiptIds, `${path}.receiptIds`, MAX_RECEIPTS_PER_HANDOVER, (id, at) =>
    uuid(id, at),
  );
  const receiptCount = integer(
    v.receiptCount,
    `${path}.receiptCount`,
    1,
    MAX_RECEIPTS_PER_HANDOVER,
  );
  if (receiptIds.length !== receiptCount || new Set(receiptIds).size !== receiptIds.length) {
    throw new ContractViolation('INCONSISTENT_RECEIPTS', `${path}.receiptIds`);
  }
  const counted = nullable(v.counted, (m) => inCurrency(m, `${path}.counted`, c));
  const receivedAt = nullable(v.receivedAt, (t) => parseUtc(t, `${path}.receivedAt`));
  const reconciledAt = nullable(v.reconciledAt, (t) => parseUtc(t, `${path}.reconciledAt`));
  const cancelledAt = nullable(v.cancelledAt, (t) => parseUtc(t, `${path}.cancelledAt`));
  const received = status === 'RECEIVED' || status === 'RECONCILED';
  if (received !== (counted !== null && receivedAt !== null)) {
    throw new ContractViolation('INCONSISTENT_TREASURY_RECEIPT', `${path}.counted`);
  }
  if ((status === 'RECONCILED') !== (reconciledAt !== null)) {
    throw new ContractViolation('INCONSISTENT_SETTLEMENT', `${path}.reconciledAt`);
  }
  if ((status === 'CANCELLED') !== (cancelledAt !== null)) {
    throw new ContractViolation('INCONSISTENT_CANCELLATION', `${path}.cancelledAt`);
  }
  return {
    handoverId: uuid(v.handoverId, `${path}.handoverId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    holder: uuid(v.holder, `${path}.holder`),
    status,
    receiptCount,
    receiptIds,
    declared,
    counted,
    shortage: nullable(v.shortage, (m) => inCurrency(m, `${path}.shortage`, c)),
    overage: nullable(v.overage, (m) => inCurrency(m, `${path}.overage`, c)),
    treasuryReference: masked(v.treasuryReference, `${path}.treasuryReference`),
    receivedBy: nullable(v.receivedBy, (s) => uuid(s, `${path}.receivedBy`)),
    receivedAt,
    settlementReference: masked(v.settlementReference, `${path}.settlementReference`),
    reconciledBy: nullable(v.reconciledBy, (s) => uuid(s, `${path}.reconciledBy`)),
    reconciledAt,
    cancelledBy: nullable(v.cancelledBy, (s) => uuid(s, `${path}.cancelledBy`)),
    cancelledAt,
    createdAt: parseUtc(v.createdAt, `${path}.createdAt`),
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

export function parseHolderPositionV1(value: unknown, path = '$'): HolderPositionV1 {
  const v = closed(value, path, ['holder', 'balances']);
  const balances = list(v.balances, `${path}.balances`, CURRENCY_CODES.length, (b, at) => {
    const x = closed(b, at, [
      'currency',
      'ledgerCustody',
      'held',
      'heldCount',
      'inHandover',
      'inHandoverCount',
      'shortageOutstanding',
    ]);
    const currency = oneOf(x.currency, `${at}.currency`, CURRENCY_CODES);
    return {
      currency,
      ledgerCustody: inCurrency(x.ledgerCustody, `${at}.ledgerCustody`, currency),
      held: inCurrency(x.held, `${at}.held`, currency),
      heldCount: count(x.heldCount, `${at}.heldCount`),
      inHandover: inCurrency(x.inHandover, `${at}.inHandover`, currency),
      inHandoverCount: count(x.inHandoverCount, `${at}.inHandoverCount`),
      shortageOutstanding: inCurrency(x.shortageOutstanding, `${at}.shortageOutstanding`, currency),
    };
  });
  if (new Set(balances.map((b) => b.currency)).size !== balances.length) {
    throw new ContractViolation('DUPLICATE_ITEM', `${path}.balances`);
  }
  return { holder: uuid(v.holder, `${path}.holder`), balances };
}

export function parseCustodyReconciliationReportV1(
  value: unknown,
  path = '$',
): CustodyReconciliationReportV1 {
  const v = closed(value, path, [
    'evaluatedAt',
    'consistent',
    'holdersChecked',
    'holderMismatches',
    'receiptsWithoutSettledObligation',
    'cashSettlementsWithoutReceipt',
    'handoversPending',
    'handoversAwaitingReconciliation',
    'handoversWithDiscrepancy',
    'treasury',
  ]);
  const signed = (x: unknown, at: string): string => {
    if (typeof x !== 'string' || !SIGNED_MINOR.test(x))
      throw new ContractViolation('INVALID_MONEY_AMOUNT', at);
    return x;
  };
  const holderMismatches = list(v.holderMismatches, `${path}.holderMismatches`, 10_000, (m, at) => {
    const x = closed(m, at, ['holder', 'currency', 'ledgerCustodyMinor', 'receiptsInCustodyMinor']);
    return {
      holder: uuid(x.holder, `${at}.holder`),
      currency: oneOf(x.currency, `${at}.currency`, CURRENCY_CODES),
      ledgerCustodyMinor: signed(x.ledgerCustodyMinor, `${at}.ledgerCustodyMinor`),
      receiptsInCustodyMinor: signed(x.receiptsInCustodyMinor, `${at}.receiptsInCustodyMinor`),
    };
  });
  const receiptsWithoutSettledObligation = count(
    v.receiptsWithoutSettledObligation,
    `${path}.receiptsWithoutSettledObligation`,
  );
  const cashSettlementsWithoutReceipt = count(
    v.cashSettlementsWithoutReceipt,
    `${path}.cashSettlementsWithoutReceipt`,
  );
  const consistent = boolean(v.consistent, `${path}.consistent`);
  const derived =
    holderMismatches.length === 0 &&
    receiptsWithoutSettledObligation === 0 &&
    cashSettlementsWithoutReceipt === 0;
  // "consistent" is derived by Billing; a report that claims it over a mismatch is a defect.
  if (consistent !== derived)
    throw new ContractViolation('INCONSISTENT_REPORT', `${path}.consistent`);
  const treasury = list(v.treasury, `${path}.treasury`, CURRENCY_CODES.length, (t, at) => {
    const x = closed(t, at, [
      'currency',
      'unreconciled',
      'reconciled',
      'shortageOutstanding',
      'overageSuspense',
    ]);
    const currency = oneOf(x.currency, `${at}.currency`, CURRENCY_CODES);
    return {
      currency,
      unreconciled: inCurrency(x.unreconciled, `${at}.unreconciled`, currency),
      reconciled: inCurrency(x.reconciled, `${at}.reconciled`, currency),
      shortageOutstanding: inCurrency(x.shortageOutstanding, `${at}.shortageOutstanding`, currency),
      overageSuspense: inCurrency(x.overageSuspense, `${at}.overageSuspense`, currency),
    };
  });
  return {
    evaluatedAt: parseUtc(v.evaluatedAt, `${path}.evaluatedAt`),
    consistent,
    holdersChecked: count(v.holdersChecked, `${path}.holdersChecked`),
    holderMismatches,
    receiptsWithoutSettledObligation,
    cashSettlementsWithoutReceipt,
    handoversPending: count(v.handoversPending, `${path}.handoversPending`),
    handoversAwaitingReconciliation: count(
      v.handoversAwaitingReconciliation,
      `${path}.handoversAwaitingReconciliation`,
    ),
    handoversWithDiscrepancy: count(v.handoversWithDiscrepancy, `${path}.handoversWithDiscrepancy`),
    treasury,
  };
}

const reference = (value: unknown, path: string): string =>
  text(value, path, { min: 4, max: 64, pattern: TREASURY_REFERENCE });

export function parseRecordCashCollectionRequestV1(value: unknown): RecordCashCollectionRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'bookingId', 'amount']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    bookingId: uuid(v.bookingId, '$.bookingId'),
    amount: parseNonNegativeMoney(v.amount, '$.amount'),
  };
}

export function parseReverseCashCollectionRequestV1(
  value: unknown,
): ReverseCashCollectionRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'reason']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    reason: oneOf(v.reason, '$.reason', REVERSAL_REASONS),
  };
}

export function parseDeclareHandoverRequestV1(value: unknown): DeclareHandoverRequestV1 {
  const v = closed(value, '$', ['receiptIds', 'declaredAmount']);
  const receiptIds = list(v.receiptIds, '$.receiptIds', MAX_RECEIPTS_PER_HANDOVER, (id, at) =>
    uuid(id, at),
  );
  if (receiptIds.length === 0) throw new ContractViolation('TOO_FEW_ITEMS', '$.receiptIds');
  if (new Set(receiptIds).size !== receiptIds.length)
    throw new ContractViolation('DUPLICATE_ITEM', '$.receiptIds');
  return {
    receiptIds,
    declaredAmount: parseNonNegativeMoney(v.declaredAmount, '$.declaredAmount'),
  };
}

export function parseCancelHandoverRequestV1(value: unknown): CancelHandoverRequestV1 {
  const v = closed(value, '$', ['expectedRevision']);
  return { expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision') };
}

export function parseReceiveHandoverRequestV1(value: unknown): ReceiveHandoverRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'countedAmount', 'treasuryReference']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    countedAmount: parseNonNegativeMoney(v.countedAmount, '$.countedAmount'),
    treasuryReference: reference(v.treasuryReference, '$.treasuryReference'),
  };
}

export function parseReconcileHandoverRequestV1(value: unknown): ReconcileHandoverRequestV1 {
  const v = closed(value, '$', ['expectedRevision', 'settlementReference']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    settlementReference: reference(v.settlementReference, '$.settlementReference'),
  };
}
