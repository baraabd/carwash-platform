import { parseNonNegativeMoney, type Money } from '../common/money';
import { parsePrincipalRef, type PrincipalRef } from '../common/principal';
import { parseRevision } from '../common/protocol';
import { ContractViolation, closed, uuid } from '../common/wire';

export interface VerifySubscriptionFundingRequestV1 {
  readonly obligationId: string;
  readonly beneficiary: PrincipalRef;
  readonly amount: Money;
}
export type SubscriptionFundingProofV1 =
  | { readonly verified: false; readonly reason: 'PAYMENT_NOT_VERIFIED' }
  | {
      readonly verified: true;
      readonly obligationId: string;
      readonly revision: number;
      readonly beneficiary: PrincipalRef;
      readonly amount: Money;
      readonly quoteId: string;
    };

export function parseVerifySubscriptionFundingRequestV1(
  raw: unknown,
): VerifySubscriptionFundingRequestV1 {
  const value = closed(raw, '$', ['obligationId', 'beneficiary', 'amount']);
  const beneficiary = parsePrincipalRef(value.beneficiary, '$.beneficiary');
  const amount = parseNonNegativeMoney(value.amount, '$.amount');
  if (beneficiary.kind !== 'account' || amount.amountMinor === '0')
    throw new ContractViolation('INVALID_SUBSCRIPTION_FUNDING', '$');
  return { obligationId: uuid(value.obligationId, '$.obligationId'), beneficiary, amount };
}

/** A point-in-time fact, not an instruction to transfer money or a reusable grant. */
export function parseSubscriptionFundingProofV1(raw: unknown): SubscriptionFundingProofV1 {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).verified === false
  ) {
    const value = closed(raw, '$', ['verified', 'reason']);
    if (value.reason !== 'PAYMENT_NOT_VERIFIED')
      throw new ContractViolation('INVALID_FUNDING_REASON', '$.reason');
    return { verified: false, reason: 'PAYMENT_NOT_VERIFIED' };
  }
  const value = closed(raw, '$', [
    'verified',
    'obligationId',
    'revision',
    'beneficiary',
    'amount',
    'quoteId',
  ]);
  if (value.verified !== true) throw new ContractViolation('INVALID_FUNDING_PROOF', '$.verified');
  const request = parseVerifySubscriptionFundingRequestV1({
    obligationId: value.obligationId,
    beneficiary: value.beneficiary,
    amount: value.amount,
  });
  return {
    verified: true,
    ...request,
    revision: parseRevision(value.revision, '$.revision'),
    quoteId: uuid(value.quoteId, '$.quoteId'),
  };
}
