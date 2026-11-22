import { parseNonNegativeMoney, type Money } from '../common/money';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { ContractViolation, closed, oneOf, text, uuid } from '../common/wire';

/** A review candidate, never evidence that an obligation has been settled. */
export interface StatementCreditReviewV1 {
  readonly attemptId: string;
  readonly obligationId: string;
  readonly obligationRevision: number;
  readonly creditId: string;
  readonly creditRevision: number;
  readonly provider: 'SHAM_CASH' | 'SYRIATEL_CASH';
  readonly status: 'PENDING_APPROVAL';
  readonly amount: Money;
  readonly merchantAccount: string;
  readonly reference: string;
  readonly evidenceFingerprint: string;
  readonly occurredAt: UtcTimestamp;
  readonly recordedAt: UtcTimestamp;
}

export function parseStatementCreditReviewV1(value: unknown): StatementCreditReviewV1 {
  const v = closed(value, '$', [
    'attemptId',
    'obligationId',
    'obligationRevision',
    'creditId',
    'creditRevision',
    'provider',
    'status',
    'amount',
    'merchantAccount',
    'reference',
    'evidenceFingerprint',
    'occurredAt',
    'recordedAt',
  ]);
  const occurredAt = parseUtc(v.occurredAt, '$.occurredAt');
  const recordedAt = parseUtc(v.recordedAt, '$.recordedAt');
  if (recordedAt < occurredAt) throw new ContractViolation('TIME_TRAVEL', '$.recordedAt');
  const amount = parseNonNegativeMoney(v.amount, '$.amount');
  if (BigInt(amount.amountMinor) === 0n) throw new ContractViolation('ZERO_CREDIT', '$.amount');
  const masked = (value: unknown, path: string) =>
    text(value, path, { min: 2, max: 5, pattern: /^…[^\s]{1,4}$/u });
  return {
    attemptId: uuid(v.attemptId, '$.attemptId'),
    obligationId: uuid(v.obligationId, '$.obligationId'),
    obligationRevision: parseRevision(v.obligationRevision, '$.obligationRevision'),
    creditId: uuid(v.creditId, '$.creditId'),
    creditRevision: parseRevision(v.creditRevision, '$.creditRevision'),
    provider: oneOf(v.provider, '$.provider', ['SHAM_CASH', 'SYRIATEL_CASH']),
    status: oneOf(v.status, '$.status', ['PENDING_APPROVAL']),
    amount,
    merchantAccount: masked(v.merchantAccount, '$.merchantAccount'),
    reference: masked(v.reference, '$.reference'),
    evidenceFingerprint: text(v.evidenceFingerprint, '$.evidenceFingerprint', {
      min: 12,
      max: 12,
      pattern: /^[a-f0-9]{12}$/,
    }),
    occurredAt,
    recordedAt,
  };
}
