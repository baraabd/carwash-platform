import type {
  FundingAuthority,
  PeriodRecord,
  SubscriptionRecord,
  SubscriptionUnitOfWork,
} from '../ports';
import { SubscriptionApplicationError } from './subscription-errors';

/** Reconciles pre-claim historical periods before any new entitlement use. */
export async function requirePeriodFunding(
  funding: FundingAuthority,
  uow: SubscriptionUnitOfWork,
  subscription: SubscriptionRecord,
  period: PeriodRecord,
  correlationId: string,
): Promise<void> {
  const revision = (await uow.revisionsOf(subscription.planCode)).find(
    (r) => r.revision === period.planRevision,
  );
  if (!revision) throw new SubscriptionApplicationError('FUNDING_UNAVAILABLE');
  const purchase = await uow.purchaseForPeriod(subscription.id, period.periodNo);
  const proof = await funding.claim({
    obligationId: period.paymentReference,
    customerSubject: subscription.customerSubject,
    subscriptionId: subscription.id,
    periodNo: period.periodNo,
    amount: revision.terms.price,
    correlationId,
    ...(purchase ? { quoteId: purchase.quoteId } : {}),
  });
  if (proof !== 'CLAIMED')
    throw new SubscriptionApplicationError(
      proof === 'UNAVAILABLE' ? 'FUNDING_UNAVAILABLE' : 'PAYMENT_NOT_VERIFIED',
    );
}
