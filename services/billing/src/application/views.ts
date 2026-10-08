import {
  Money,
  financialStatus,
  maskProviderReference,
  outstanding,
  type FinancialStatus,
} from '../domain';
import type { AttemptRecord, FinancialSnapshot, IntentRecord } from '../ports';

/** The financial status derived from the server-held snapshot only. */
export function snapshotFinancialStatus(snapshot: FinancialSnapshot): FinancialStatus {
  return financialStatus({
    obligation: snapshot.obligation,
    activeIntent: snapshot.activeIntent,
    hasUnknownAttempt: snapshot.attempts.some((attempt) => attempt.status === 'UNKNOWN'),
  });
}

function intentView(intent: IntentRecord): Record<string, unknown> {
  return {
    intentId: intent.id,
    method: intent.method,
    status: intent.status,
    amount: intent.amount.toWire(),
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

function attemptView(attempt: AttemptRecord): Record<string, unknown> {
  return {
    attemptId: attempt.id,
    intentId: attempt.intentId,
    method: attempt.method,
    status: attempt.status,
    // The caller already knows the full number; echo only a mask so logs,
    // screenshots and support tooling never carry the provider reference.
    reference: maskProviderReference(attempt.providerReference),
    claimed: attempt.claimed.toWire(),
    submittedAt: attempt.submittedAt.toISOString(),
    reconciledAt: attempt.reconciledAt?.toISOString() ?? null,
  };
}

/** Full obligation view for its owner or Finance. */
export function obligationView(snapshot: FinancialSnapshot): Record<string, unknown> {
  const { obligation } = snapshot;
  return {
    obligationId: obligation.id,
    revision: obligation.revision,
    status: obligation.status,
    financialStatus: snapshotFinancialStatus(snapshot),
    quoteId: obligation.quoteId,
    amount: obligation.amount.toWire(),
    verified: obligation.verified.toWire(),
    outstanding:
      obligation.status === 'VOIDED'
        ? Money.zero(obligation.amount.currency).toWire()
        : outstanding(obligation).toWire(),
    activeIntent: snapshot.activeIntent ? intentView(snapshot.activeIntent) : null,
    attempts: snapshot.attempts.map(attemptView),
    createdAt: obligation.createdAt.toISOString(),
    updatedAt: obligation.updatedAt.toISOString(),
  };
}

/** Lean status for polling clients and the booking journey. */
export function financialStatusView(snapshot: FinancialSnapshot): Record<string, unknown> {
  const view = obligationView(snapshot);
  return {
    obligationId: view.obligationId,
    revision: view.revision,
    financialStatus: view.financialStatus,
    amount: view.amount,
    verified: view.verified,
    outstanding: view.outstanding,
    method: snapshot.activeIntent?.method ?? null,
  };
}
