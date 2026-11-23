import type { AttemptStatus, FinanceFacts, Money, PaymentMethod } from '../domain';

/**
 * Admin finance read model (P06-B6). Read-only; never part of a command
 * transaction. Implementations read Billing's own tables only.
 */

/** Keyset position in the attempt work queue: (submittedAt, attemptId) ascending. */
export interface AttemptQueuePosition {
  readonly submittedAt: Date;
  readonly attemptId: string;
}

export interface AttemptQueueQuery {
  readonly status: AttemptStatus;
  /** Exclusive lower bound; null = from the oldest. */
  readonly after: AttemptQueuePosition | null;
  /** Rows to return (the caller asks for one more to detect a next page). */
  readonly limit: number;
}

/** One claim in the reconciliation work queue. Holds the FULL reference; views mask it. */
export interface AttemptQueueRow {
  readonly attemptId: string;
  readonly obligationId: string;
  /** Current obligation revision: the `expectedRevision` of the reconciliation command. */
  readonly obligationRevision: number;
  readonly intentId: string;
  readonly method: PaymentMethod;
  readonly status: AttemptStatus;
  readonly providerReference: string;
  readonly claimed: Money;
  readonly submittedAt: Date;
  readonly reconciledAt: Date | null;
}

export interface FinanceReadModel {
  /** Every fact of the summary from ONE read-only REPEATABLE READ snapshot. */
  financeFacts(): Promise<FinanceFacts>;
  attemptQueue(query: AttemptQueueQuery): Promise<readonly AttemptQueueRow[]>;
}
