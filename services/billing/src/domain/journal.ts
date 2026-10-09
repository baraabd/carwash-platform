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
] as const;
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];
export const JOURNAL_KINDS = ['OBLIGATION_BILLED', 'OBLIGATION_VOIDED', 'PAYMENT_MATCHED'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];
export type JournalSide = 'DEBIT' | 'CREDIT';

export interface JournalLine {
  readonly account: LedgerAccount;
  readonly side: JournalSide;
  readonly amount: Money;
}

export interface JournalPlan {
  readonly kind: JournalKind;
  readonly businessRef: string;
  readonly lines: readonly JournalLine[];
}

function balanced(plan: JournalPlan): JournalPlan {
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

function clearingAccount(method: PaymentMethod): LedgerAccount {
  if (method === 'SHAM_CASH') return 'CLEARING_SHAM_CASH';
  if (method === 'SYRIATEL_CASH') return 'CLEARING_SYRIATEL_CASH';
  throw new Error('NO_CLEARING_ACCOUNT_FOR_METHOD');
}

/** A reconciled electronic receipt settles the receivable through clearing. */
export function paymentMatchedJournal(
  attemptId: string,
  method: PaymentMethod,
  received: Money,
): JournalPlan {
  return balanced({
    kind: 'PAYMENT_MATCHED',
    businessRef: `attempt:${attemptId}:matched`,
    lines: [
      { account: clearingAccount(method), side: 'DEBIT', amount: received },
      { account: 'CUSTOMER_RECEIVABLE', side: 'CREDIT', amount: received },
    ],
  });
}
