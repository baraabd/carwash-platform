import { parseNonNegativeMoney, type Money } from '../common/money';
import { parsePrincipalRef, type PrincipalRef } from '../common/principal';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { ContractViolation, closed, oneOf, text, uuid } from '../common/wire';

export interface CreateSubscriptionQuoteV1 {
  readonly planId: string;
  readonly planVersion: number;
}
export interface SubscriptionQuoteV1 extends CreateSubscriptionQuoteV1 {
  readonly quoteId: string;
  readonly beneficiary: PrincipalRef;
  readonly status: 'USABLE' | 'EXPIRED';
  readonly currency: string;
  readonly total: Money;
  readonly planContentHash: string;
  readonly issuedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
}
export function parseCreateSubscriptionQuoteV1(raw: unknown): CreateSubscriptionQuoteV1 {
  const v = closed(raw, '$', ['planId', 'planVersion']);
  return {
    planId: uuid(v.planId, '$.planId'),
    planVersion: parseRevision(v.planVersion, '$.planVersion'),
  };
}
export function parseSubscriptionQuoteV1(raw: unknown): SubscriptionQuoteV1 {
  const v = closed(raw, '$', [
    'quoteId',
    'beneficiary',
    'status',
    'currency',
    'total',
    'planId',
    'planVersion',
    'planContentHash',
    'issuedAt',
    'expiresAt',
  ]);
  const total = parseNonNegativeMoney(v.total, '$.total');
  const beneficiary = parsePrincipalRef(v.beneficiary, '$.beneficiary');
  const issuedAt = parseUtc(v.issuedAt, '$.issuedAt');
  const expiresAt = parseUtc(v.expiresAt, '$.expiresAt');
  if (
    beneficiary.kind !== 'account' ||
    total.currency !== v.currency ||
    total.amountMinor === '0' ||
    expiresAt <= issuedAt
  )
    throw new ContractViolation('INVALID_SUBSCRIPTION_QUOTE', '$');
  return {
    ...parseCreateSubscriptionQuoteV1({ planId: v.planId, planVersion: v.planVersion }),
    quoteId: uuid(v.quoteId, '$.quoteId'),
    beneficiary,
    total,
    currency: total.currency,
    status: oneOf(v.status, '$.status', ['USABLE', 'EXPIRED'] as const),
    planContentHash: text(v.planContentHash, '$.planContentHash', {
      min: 64,
      max: 64,
      pattern: /^[0-9a-f]{64}$/,
    }),
    issuedAt,
    expiresAt,
  };
}
