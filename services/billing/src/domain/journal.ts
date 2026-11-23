import { assertBalancedJournal } from './ledger';
import type { Money } from './money';
import type { PaymentMethod } from './payment';

/**
 * Append-only double-entry journal primitives. A journal is posted once under
 * a unique business reference and never edited; corrections are new reversing
 * journals. Balance per currency is checked here and again by a COMMIT-time
 * database trigger.
 *
 * The account set is a provisional TECHNICAL chart (no revenue recognition or
 * tax): the owner's accounting decisions (B-04/B-06/B-07) may extend it with new
 * accounts through a reviewed migration, never by editing posted lines.
 */
export const LEDGER_ACCOUNTS = [
  'CUSTOMER_RECEIVABLE',
  'BILLED_OBLIGATIONS_CONTROL',
  'CLEARING_SHAM_CASH',
  'CLEARING_SYRIATEL_CASH',
  // P03-B cash custody chart (technical, provisional; no revenue/tax).
  'CASH_IN_CUSTODY',
  'TREASURY_CASH_UNRECONCILED',
  'TREASURY_CASH',
  'CUSTODY_SHORTAGE_RECEIVABLE',
  'CUSTODY_OVERAGE_SUSPENSE',
  // P04-B provider credits and refunds (technical, provisional; no revenue/tax).
  /** Money received at a provider and not (yet) applied to an obligation. */
  'PROVIDER_CREDITS_UNALLOCATED',
  /** Refunds of money that had settled an obligation (classification: B-06). */
  'REFUNDS_CONTROL',
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];
/** Accounts whose lines carry the custody holder (an Identity subject). */
export const HOLDER_ACCOUNTS: readonly LedgerAccount[] = [
  'CASH_IN_CUSTODY',
  'CUSTODY_SHORTAGE_RECEIVABLE',
];
export const JOURNAL_KINDS = [
  'OBLIGATION_BILLED',
  'OBLIGATION_VOIDED',
  'PAYMENT_MATCHED',
  'CASH_COLLECTED',
  'CASH_COLLECTION_REVERSED',
  'CUSTODY_RECEIVED',
  'CUSTODY_RECONCILED',
  'CREDIT_RECEIVED',
  'CREDIT_ALLOCATED',
  'REFUND_PAID',
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];
/** Journals posted against one handover rather than one obligation. */
export const HANDOVER_JOURNAL_KINDS: readonly JournalKind[] = [
  'CUSTODY_RECEIVED',
  'CUSTODY_RECONCILED',
];
/** Journals posted against one provider credit only. */
export const CREDIT_JOURNAL_KINDS: readonly JournalKind[] = ['CREDIT_RECEIVED', 'REFUND_PAID'];
/** Journals posted against an obligation AND the credit that settled it. */
export const ALLOCATION_JOURNAL_KINDS: readonly JournalKind[] = ['CREDIT_ALLOCATED'];
export type JournalSide = 'DEBIT' | 'CREDIT';

export interface JournalLine {
  readonly account: LedgerAccount;
  readonly side: JournalSide;
  readonly amount: Money;
  /** Required exactly for HOLDER_ACCOUNTS. */
  readonly holder?: string;
}

export interface JournalPlan {
  readonly kind: JournalKind;
  readonly businessRef: string;
  readonly lines: readonly JournalLine[];
}

function balanced(plan: JournalPlan): JournalPlan {
  for (const line of plan.lines)
    if (HOLDER_ACCOUNTS.includes(line.account) !== (line.holder !== undefined))
      throw new Error('INVALID_HOLDER_DIMENSION');
  assertBalancedJournal(
    plan.lines.map((line) => ({
      accountId: line.account,
      currency: line.amount.currency,
      side: line.side,
      amountMinor: line.amount.amountMinor.toString(),
    })),
  );
  return plan;
}

/** The customer now owes the obligation amount. No money has moved. */
export function obligationBilledJournal(obligationId: string, amount: Money): JournalPlan {
  return balanced({
    kind: 'OBLIGATION_BILLED',
    businessRef: `obligation:${obligationId}:billed`,
    lines: [
      { account: 'CUSTOMER_RECEIVABLE', side: 'DEBIT', amount },
      { account: 'BILLED_OBLIGATIONS_CONTROL', side: 'CREDIT', amount },
    ],
  });
}

/** Reverses the billing of an obligation that was voided before any payment. */
export function obligationVoidedJournal(obligationId: string, amount: Money): JournalPlan {
  return balanced({
    kind: 'OBLIGATION_VOIDED',
    businessRef: `obligation:${obligationId}:voided`,
    lines: [
      { account: 'BILLED_OBLIGATIONS_CONTROL', side: 'DEBIT', amount },
      { account: 'CUSTOMER_RECEIVABLE', side: 'CREDIT', amount },
    ],
  });
}

export function clearingAccount(method: PaymentMethod): LedgerAccount {
  if (method === 'SHAM_CASH') return 'CLEARING_SHAM_CASH';
  if (method === 'SYRIATEL_CASH') return 'CLEARING_SYRIATEL_CASH';
  throw new Error('NO_CLEARING_ACCOUNT_FOR_METHOD');
}

/**
 * Cash handed to the assigned technician settles the customer's receivable;
 * the company now holds that cash through the technician (custody).
 */
export function cashCollectedJournal(
  receiptId: string,
  holder: string,
  received: Money,
): JournalPlan {
  return balanced({
    kind: 'CASH_COLLECTED',
    businessRef: `receipt:${receiptId}:collected`,
    lines: [
      { account: 'CASH_IN_CUSTODY', side: 'DEBIT', amount: received, holder },
      { account: 'CUSTOMER_RECEIVABLE', side: 'CREDIT', amount: received },
    ],
  });
}

/** Linked reversal of a collection recorded in error: the receivable returns. */
export function cashCollectionReversedJournal(
  receiptId: string,
  holder: string,
  amount: Money,
): JournalPlan {
  return balanced({
    kind: 'CASH_COLLECTION_REVERSED',
    businessRef: `receipt:${receiptId}:reversed`,
    lines: [
      { account: 'CUSTOMER_RECEIVABLE', side: 'DEBIT', amount },
      { account: 'CASH_IN_CUSTODY', side: 'CREDIT', amount, holder },
    ],
  });
}

/**
 * The treasury counted a handover. The holder's custody is relieved by the
 * declared total; the counted cash is treasury cash awaiting reconciliation;
 * any difference is an explicit shortage receivable from the holder or an
 * overage held in suspense. Zero-amount lines are never written.
 */
export function custodyReceivedJournal(
  handoverId: string,
  holder: string,
  declared: Money,
  plan: { readonly counted: Money; readonly shortage: Money; readonly overage: Money },
): JournalPlan {
  const lines: JournalLine[] = [];
  if (!plan.counted.isZero())
    lines.push({ account: 'TREASURY_CASH_UNRECONCILED', side: 'DEBIT', amount: plan.counted });
  if (!plan.shortage.isZero())
    lines.push({
      account: 'CUSTODY_SHORTAGE_RECEIVABLE',
      side: 'DEBIT',
      amount: plan.shortage,
      holder,
    });
  lines.push({ account: 'CASH_IN_CUSTODY', side: 'CREDIT', amount: declared, holder });
  if (!plan.overage.isZero())
    lines.push({ account: 'CUSTODY_OVERAGE_SUSPENSE', side: 'CREDIT', amount: plan.overage });
  return balanced({
    kind: 'CUSTODY_RECEIVED',
    businessRef: `handover:${handoverId}:received`,
    lines,
  });
}

/** Settlement confirmed against the treasury reference: the cash is reconciled. */
export function custodyReconciledJournal(handoverId: string, counted: Money): JournalPlan {
  return balanced({
    kind: 'CUSTODY_RECONCILED',
    businessRef: `handover:${handoverId}:reconciled`,
    lines: [
      { account: 'TREASURY_CASH', side: 'DEBIT', amount: counted },
      { account: 'TREASURY_CASH_UNRECONCILED', side: 'CREDIT', amount: counted },
    ],
  });
}

/**
 * A provider credit is established: the money is in the provider clearing
 * account and, until it is applied to an obligation, unallocated.
 */
export function creditReceivedJournal(
  creditId: string,
  provider: PaymentMethod,
  amount: Money,
): JournalPlan {
  return balanced({
    kind: 'CREDIT_RECEIVED',
    businessRef: `credit:${creditId}:received`,
    lines: [
      { account: clearingAccount(provider), side: 'DEBIT', amount },
      { account: 'PROVIDER_CREDITS_UNALLOCATED', side: 'CREDIT', amount },
    ],
  });
}

/** The credit settles the obligation whose claim carried its reference. */
export function creditAllocatedJournal(creditId: string, amount: Money): JournalPlan {
  return balanced({
    kind: 'CREDIT_ALLOCATED',
    businessRef: `credit:${creditId}:allocated`,
    lines: [
      { account: 'PROVIDER_CREDITS_UNALLOCATED', side: 'DEBIT', amount },
      { account: 'CUSTOMER_RECEIVABLE', side: 'CREDIT', amount },
    ],
  });
}

/**
 * Money left the provider account back to the payer. Refunding money that had
 * settled an obligation is booked to the refunds control account; refunding
 * unallocated money relieves the unallocated balance.
 */
export function refundPaidJournal(
  refundId: string,
  provider: PaymentMethod,
  amount: Money,
  creditWasAllocated: boolean,
): JournalPlan {
  return balanced({
    kind: 'REFUND_PAID',
    businessRef: `refund:${refundId}:paid`,
    lines: [
      {
        account: creditWasAllocated ? 'REFUNDS_CONTROL' : 'PROVIDER_CREDITS_UNALLOCATED',
        side: 'DEBIT',
        amount,
      },
      { account: clearingAccount(provider), side: 'CREDIT', amount },
    ],
  });
}
