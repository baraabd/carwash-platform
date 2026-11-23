import { ContractViolation, billingV1 } from '@carwash/contracts';
import { Money } from '../domain';
import type { ObligationRecord, ProviderCreditRecord, RefundRecord } from '../ports';
import { BillingApplicationError } from './billing-errors';

function publishedView<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error: unknown) {
    // A persisted provider defect is never misreported as invalid caller input.
    if (error instanceof ContractViolation) throw new BillingApplicationError('SERVICE_NOT_READY');
    throw error;
  }
}

/** A legacy approval is not a recorded money-out outcome. */
export function publicRefundStatus(refund: RefundRecord): billingV1.RefundStatus {
  switch (refund.status) {
    case 'REQUESTED':
    case 'APPROVED':
      return 'REQUESTED';
    case 'SUBMITTED':
    case 'UNKNOWN':
      return 'OUTCOME_UNKNOWN';
    case 'REJECTED':
    case 'FAILED':
      return 'FAILED';
    case 'SUCCEEDED':
      return 'SUCCEEDED';
  }
}

/** No staff subjects, full reference, credit id or evidence digest on the published wire. */
export function canonicalRefundView(
  refund: RefundRecord,
  credit: ProviderCreditRecord,
): billingV1.RefundV1 {
  if (!credit.obligationId || refund.creditId !== credit.id)
    throw new BillingApplicationError('NOT_FOUND');
  // Historical unallocated refunds and provider outcomes lacking a final reference
  // cannot be represented truthfully by the closed published obligation contract.
  if (
    refund.reason === 'UNALLOCATABLE_CREDIT' ||
    (refund.status === 'SUCCEEDED' && !refund.providerRefundReference)
  )
    throw new BillingApplicationError('SERVICE_NOT_READY');
  const status = publicRefundStatus(refund);
  const decidedAt =
    status === 'REQUESTED'
      ? null
      : (refund.completedAt ??
        (refund.status === 'SUBMITTED' || refund.status === 'UNKNOWN'
          ? refund.updatedAt
          : refund.decidedAt));
  return publishedView(() =>
    billingV1.parseRefundV1({
      refundId: refund.id,
      obligationId: credit.obligationId,
      revision: refund.revision,
      status,
      reason: refund.reason,
      method: credit.provider,
      amount: refund.amount.toWire(),
      reference: status === 'SUCCEEDED' ? `…${refund.providerRefundReference?.slice(-4)}` : null,
      requestedAt: refund.requestedAt.toISOString(),
      decidedAt: decidedAt?.toISOString() ?? null,
      updatedAt: refund.updatedAt.toISOString(),
    }),
  );
}

/** Called while the common credit lock prevents a mixed financial read. */
export function obligationRefundsView(
  obligation: ObligationRecord,
  credit: ProviderCreditRecord | null,
  refunds: readonly RefundRecord[],
): billingV1.ObligationRefundsV1 {
  if (refunds.length > billingV1.MAX_REFUNDS_PER_OBLIGATION)
    throw new BillingApplicationError('SERVICE_NOT_READY');
  const items = refunds
    .map((refund) => {
      if (!credit) throw new Error('REFUND_WITHOUT_CREDIT');
      return canonicalRefundView(refund, credit);
    })
    .sort(
      (a, b) =>
        Date.parse(b.requestedAt) - Date.parse(a.requestedAt) ||
        b.refundId.localeCompare(a.refundId),
    );
  const total = (statuses: readonly billingV1.RefundStatus[]) =>
    items
      .filter((item) => statuses.includes(item.status))
      .reduce(
        (sum, item) => sum.plus(Money.parse(item.amount)),
        Money.zero(obligation.amount.currency),
      );
  const refunded = total(['SUCCEEDED']);
  const inFlight = total(['REQUESTED', 'OUTCOME_UNKNOWN']);
  return publishedView(() =>
    billingV1.parseObligationRefundsV1({
      obligationId: obligation.id,
      refunded: refunded.toWire(),
      inFlight: inFlight.toWire(),
      refundable: obligation.verified.minus(refunded).minus(inFlight).toWire(),
      items,
    }),
  );
}
