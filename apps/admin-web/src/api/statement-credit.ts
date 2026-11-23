import type { MoneyWire } from '../domain/finance';
import { INSTANT, UUID, integer, object, oneOf, request, text, type Result } from './http';
import { money } from './kpis';

/** The owner's read-only, masked candidate for an explicit second-person review. */
export interface StatementCreditReview {
  readonly attemptId: string;
  readonly obligationId: string;
  readonly obligationRevision: number;
  readonly creditId: string;
  readonly creditRevision: number;
  readonly provider: 'SHAM_CASH' | 'SYRIATEL_CASH';
  readonly status: 'PENDING_APPROVAL';
  readonly amount: MoneyWire;
  readonly merchantAccount: string;
  readonly reference: string;
  readonly evidenceFingerprint: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
}

export function readStatementCredit(attemptId: string): Promise<Result<StatementCreditReview>> {
  return request(
    `/admin/billing/payment-attempts/${encodeURIComponent(attemptId)}/statement-credit`,
    {
      read: (raw) => {
        const v = object(raw, '$');
        const result: StatementCreditReview = {
          attemptId: text(v.attemptId, 'attemptId', UUID),
          obligationId: text(v.obligationId, 'obligationId', UUID),
          obligationRevision: integer(v.obligationRevision, 'obligationRevision'),
          creditId: text(v.creditId, 'creditId', UUID),
          creditRevision: integer(v.creditRevision, 'creditRevision'),
          provider: oneOf(v.provider, ['SHAM_CASH', 'SYRIATEL_CASH'], 'provider'),
          status: oneOf(v.status, ['PENDING_APPROVAL'], 'status'),
          amount: money(v.amount, 'amount'),
          merchantAccount: text(v.merchantAccount, 'merchantAccount', /^…[^\s]{1,4}$/u),
          reference: text(v.reference, 'reference', /^…[^\s]{1,4}$/u),
          evidenceFingerprint: text(v.evidenceFingerprint, 'evidenceFingerprint', /^[a-f0-9]{12}$/),
          occurredAt: text(v.occurredAt, 'occurredAt', INSTANT),
          recordedAt: text(v.recordedAt, 'recordedAt', INSTANT),
        };
        if (
          result.attemptId !== attemptId ||
          result.obligationRevision < 1 ||
          result.creditRevision < 1 ||
          BigInt(result.amount.amountMinor) === 0n ||
          !Number.isFinite(Date.parse(result.occurredAt)) ||
          !Number.isFinite(Date.parse(result.recordedAt)) ||
          Date.parse(result.recordedAt) < Date.parse(result.occurredAt)
        )
          throw new Error('INVALID_STATEMENT_REVIEW');
        return result;
      },
    },
  );
}
