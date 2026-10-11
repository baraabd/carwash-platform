import {
  CUSTODY_STATUSES,
  HANDOVER_STATUSES,
  type CustodyStatus,
  type HandoverStatus,
} from './cash';
import { Money, SUPPORTED_SCALES } from './money';
import {
  ATTEMPT_STATUSES,
  FINANCIAL_STATUSES,
  OBLIGATION_STATUSES,
  financialStatus,
  type AttemptStatus,
  type FinancialStatus,
  type IntentStatus,
  type ObligationStatus,
  type PaymentMethod,
} from './payment';
import { CREDIT_STATUSES, CONFIRMED_CREDIT_STATUSES, type CreditStatus } from './provider';
import { REFUND_STATUSES, type RefundStatus } from './refund';

/**
 * Finance summary (admin read model, P06-B6). A pure fold over facts read from
 * Billing's own tables in ONE consistent snapshot. It never decides money: it
 * reports what the obligations, receipts, credits, refunds and the ledger say,
 * and whether the ledger and the projections agree.
 *
 * The fold reuses `financialStatus` so the admin count of e.g. "PAID" can never
 * drift from the status a customer or Finance sees on the obligation itself.
 */

/** How much of the money that settled an obligation was refunded (completed refunds only). */
export const REFUND_EXTENTS = ['NONE', 'PARTIAL', 'FULL'] as const;
export type RefundExtent = (typeof REFUND_EXTENTS)[number];

/** Obligations sharing every fact their financial status depends on. */
export interface ObligationFactGroup {
  readonly currency: string;
  readonly status: ObligationStatus;
  readonly activeIntent: { readonly method: PaymentMethod; readonly status: IntentStatus } | null;
  readonly hasUnknownAttempt: boolean;
  readonly settledByCash: boolean;
  readonly refund: RefundExtent;
  readonly count: number;
  readonly amountMinor: bigint;
  readonly verifiedMinor: bigint;
}

/** Count and summed amount of one table's rows in one status and currency. */
export interface StatusTally<S extends string> {
  readonly currency: string;
  readonly status: S;
  readonly count: number;
  readonly amountMinor: bigint;
}

/**
 * Ledger balances in one currency, debit-positive unless stated. These are the
 * same sums the COMMIT-time trigger `billing_assert_obligation_ledger` checks
 * per obligation, aggregated over all obligations.
 */
export interface LedgerFacts {
  readonly currency: string;
  /** CUSTOMER_RECEIVABLE over obligation journals. */
  readonly receivableMinor: bigint;
  /** Clearing, cash-in-custody and unallocated-credit accounts over obligation journals. */
  readonly clearedMinor: bigint;
  /** CASH_IN_CUSTODY over every journal (all holders). */
  readonly custodyMinor: bigint;
  /** Clearing-account credits of REFUND_PAID journals (money that left). */
  readonly refundsPaidMinor: bigint;
}

export interface FinanceFacts {
  readonly obligations: readonly ObligationFactGroup[];
  readonly attempts: readonly StatusTally<AttemptStatus>[];
  readonly receipts: readonly StatusTally<CustodyStatus>[];
  readonly handovers: readonly StatusTally<HandoverStatus>[];
  readonly credits: readonly StatusTally<CreditStatus>[];
  readonly refunds: readonly StatusTally<RefundStatus>[];
  readonly ledger: readonly LedgerFacts[];
}

export interface LedgerChecks {
  /** Ledger receivable = sum over non-voided obligations of (amount - verified). */
  readonly receivable: boolean;
  /** Ledger cleared money = sum of obligation `verified`. */
  readonly cleared: boolean;
  /** Ledger cash in custody = receipts still HELD or IN_HANDOVER. */
  readonly custody: boolean;
  /** Money paid out by refunds = SUCCEEDED refunds. */
  readonly refunds: boolean;
}

export interface CurrencyFinanceSummary {
  readonly currency: string;
  readonly obligations: {
    readonly count: number;
    readonly byStatus: Readonly<Record<ObligationStatus, number>>;
    readonly byFinancialStatus: Readonly<Record<FinancialStatus, number>>;
    /** Non-voided obligations. */
    readonly billed: Money;
    readonly verified: Money;
    readonly outstanding: Money;
  };
  readonly attempts: {
    readonly byStatus: Readonly<Record<AttemptStatus, number>>;
    /** PENDING_REVIEW + UNKNOWN: claims Finance still has to resolve. */
    readonly awaitingReview: number;
  };
  readonly cashCustody: {
    /** Receipts HELD or IN_HANDOVER (cash not yet counted by the treasury). */
    readonly inCustody: Money;
    readonly receiptsByStatus: Readonly<Record<CustodyStatus, number>>;
    readonly handoversByStatus: Readonly<Record<HandoverStatus, number>>;
  };
  readonly providerCredits: {
    readonly byStatus: Readonly<Record<CreditStatus, number>>;
    /** Gross amount of confirmed credits (UNALLOCATED + ALLOCATED), before refunds. */
    readonly confirmed: Money;
  };
  readonly refunds: {
    readonly byStatus: Readonly<Record<RefundStatus, number>>;
    readonly succeeded: Money;
    /** REQUESTED, APPROVED, SUBMITTED or UNKNOWN: not yet known to have left. */
    readonly inFlight: Money;
  };
  readonly ledger: LedgerChecks;
}

export interface FinanceSummary {
  readonly asOf: Date;
  /** True iff every ledger check holds in every currency. */
  readonly ledgerConsistent: boolean;
  readonly currencies: readonly CurrencyFinanceSummary[];
}

const IN_FLIGHT_REFUNDS: readonly RefundStatus[] = [
  'REQUESTED',
  'APPROVED',
  'SUBMITTED',
  'UNKNOWN',
];

function zeros<S extends string>(statuses: readonly S[]): Record<S, number> {
  const out = {} as Record<S, number>;
  for (const status of statuses) out[status] = 0;
  return out;
}

/**
 * The financial status of every obligation in a group. Only the refund EXTENT
 * matters to the rule (none / part / all of the amount), so representative
 * magnitudes 0/1/2 of 2 feed the very same function the per-obligation view uses.
 */
export function groupFinancialStatus(group: ObligationFactGroup): FinancialStatus {
  const amount = Money.of(group.currency, 2n);
  const refunded =
    group.refund === 'NONE' ? null : Money.of(group.currency, group.refund === 'FULL' ? 2n : 1n);
  return financialStatus({
    obligation: {
      amount,
      verified: group.status === 'SETTLED' ? amount : Money.zero(group.currency),
      status: group.status,
    },
    activeIntent: group.activeIntent,
    hasUnknownAttempt: group.hasUnknownAttempt,
    settledByCash: group.settledByCash,
    refunded,
  });
}

/** Per-currency comparison of the ledger with the projections. */
export function assessLedger(input: {
  readonly receivableExpectedMinor: bigint;
  readonly verifiedMinor: bigint;
  readonly receiptsInCustodyMinor: bigint;
  readonly succeededRefundsMinor: bigint;
  readonly ledger: LedgerFacts;
}): LedgerChecks {
  return {
    receivable: input.ledger.receivableMinor === input.receivableExpectedMinor,
    cleared: input.ledger.clearedMinor === input.verifiedMinor,
    custody: input.ledger.custodyMinor === input.receiptsInCustodyMinor,
    refunds: input.ledger.refundsPaidMinor === input.succeededRefundsMinor,
  };
}

function sum<S extends string>(
  rows: readonly StatusTally<S>[],
  currency: string,
  statuses: readonly S[],
): bigint {
  return rows
    .filter((row) => row.currency === currency && statuses.includes(row.status))
    .reduce((total, row) => total + row.amountMinor, 0n);
}

function tally<S extends string>(
  rows: readonly StatusTally<S>[],
  currency: string,
  statuses: readonly S[],
): Record<S, number> {
  const out = zeros(statuses);
  for (const row of rows) if (row.currency === currency) out[row.status] += row.count;
  return out;
}

/**
 * Folds one snapshot of facts into the summary. A currency appears as soon as
 * any fact (obligation, receipt, credit, refund or ledger line) uses it; a
 * currency outside the supported set means stored corruption and throws.
 */
export function foldFinanceSummary(facts: FinanceFacts, asOf: Date): FinanceSummary {
  const currencies = new Set<string>();
  for (const rows of [
    facts.obligations,
    facts.attempts,
    facts.receipts,
    facts.handovers,
    facts.credits,
    facts.refunds,
    facts.ledger,
  ])
    for (const row of rows) currencies.add(row.currency);
  for (const currency of currencies)
    if (SUPPORTED_SCALES[currency] === undefined) throw new Error('STORED_CURRENCY_INVALID');

  const summaries = [...currencies].sort().map((currency): CurrencyFinanceSummary => {
    const groups = facts.obligations.filter((group) => group.currency === currency);
    const byStatus = zeros(OBLIGATION_STATUSES);
    const byFinancialStatus = zeros(FINANCIAL_STATUSES);
    let count = 0;
    let billed = 0n;
    let verified = 0n;
    for (const group of groups) {
      count += group.count;
      byStatus[group.status] += group.count;
      byFinancialStatus[groupFinancialStatus(group)] += group.count;
      verified += group.verifiedMinor;
      if (group.status !== 'VOIDED') billed += group.amountMinor;
    }
    const outstanding = billed - verified;
    const attempts = tally(facts.attempts, currency, ATTEMPT_STATUSES);
    const receiptsInCustody = sum(facts.receipts, currency, ['HELD', 'IN_HANDOVER']);
    const succeededRefunds = sum(facts.refunds, currency, ['SUCCEEDED']);
    const ledger = facts.ledger.find((row) => row.currency === currency) ?? {
      currency,
      receivableMinor: 0n,
      clearedMinor: 0n,
      custodyMinor: 0n,
      refundsPaidMinor: 0n,
    };
    return {
      currency,
      obligations: {
        count,
        byStatus,
        byFinancialStatus,
        billed: Money.of(currency, billed),
        verified: Money.of(currency, verified),
        outstanding: Money.of(currency, outstanding),
      },
      attempts: {
        byStatus: attempts,
        awaitingReview: attempts.PENDING_REVIEW + attempts.UNKNOWN,
      },
      cashCustody: {
        inCustody: Money.of(currency, receiptsInCustody),
        receiptsByStatus: tally(facts.receipts, currency, CUSTODY_STATUSES),
        handoversByStatus: tally(facts.handovers, currency, HANDOVER_STATUSES),
      },
      providerCredits: {
        byStatus: tally(facts.credits, currency, CREDIT_STATUSES),
        confirmed: Money.of(currency, sum(facts.credits, currency, CONFIRMED_CREDIT_STATUSES)),
      },
      refunds: {
        byStatus: tally(facts.refunds, currency, REFUND_STATUSES),
        succeeded: Money.of(currency, succeededRefunds),
        inFlight: Money.of(currency, sum(facts.refunds, currency, IN_FLIGHT_REFUNDS)),
      },
      ledger: assessLedger({
        receivableExpectedMinor: outstanding,
        verifiedMinor: verified,
        receiptsInCustodyMinor: receiptsInCustody,
        succeededRefundsMinor: succeededRefunds,
        ledger,
      }),
    };
  });
  return {
    asOf,
    ledgerConsistent: summaries.every((summary) => Object.values(summary.ledger).every(Boolean)),
    currencies: summaries,
  };
}
