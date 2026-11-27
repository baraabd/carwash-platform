import type { BillingUnitOfWork, ProviderCreditRecord } from '../ports';
import { BillingApplicationError } from './billing-errors';

/** Call only after locking this credit: claim acquisition uses the same mutex. */
export async function assertSubscriptionFundingReleased(
  uow: BillingUnitOfWork,
  credit: ProviderCreditRecord,
): Promise<void> {
  if (!credit.obligationId) return;
  const claim = await uow.subscriptionFunding.forObligation(credit.obligationId);
  if (claim && claim.releasedAt === null)
    throw new BillingApplicationError('SUBSCRIPTION_FUNDING_COMMITTED');
}
