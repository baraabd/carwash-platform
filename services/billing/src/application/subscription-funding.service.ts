import type { BillingRepository, ServiceCallerAuthority } from '../ports';
import { BillingApplicationError } from './billing-errors';
import { moneyInput, objectWithKeys, uuid } from './command-support';
import type { ServiceRequestContext } from './booking-obligation.service';

/** Read-only funding evidence. A settled booking receipt cannot fund a subscription. */
export class SubscriptionFundingService {
  constructor(
    private readonly deps: {
      readonly repository: BillingRepository;
      readonly callers: ServiceCallerAuthority;
    },
  ) {}

  async verify(context: ServiceRequestContext, body: unknown): Promise<Record<string, unknown>> {
    if (context.bearerPresent) throw new BillingApplicationError('AUTH_FORBIDDEN');
    const caller = this.deps.callers.authorize(
      context.clientId,
      context.token,
      'billing.subscription-funding.read',
    );
    if (!caller.ok)
      throw new BillingApplicationError(
        caller.reason === 'UNAUTHENTICATED' ? 'AUTH_REQUIRED' : 'AUTH_FORBIDDEN',
      );
    const input = objectWithKeys(body, ['obligationId', 'beneficiary', 'amount']);
    const obligationId = uuid(input.obligationId, 'obligationId');
    const beneficiary = objectWithKeys(input.beneficiary, ['kind', 'subjectId']);
    if (beneficiary.kind !== 'account') throw new BillingApplicationError('REQUEST_INVALID');
    const subjectId = uuid(beneficiary.subjectId, 'beneficiary.subjectId');
    const amount = moneyInput(input.amount, 'amount');
    const denied = { verified: false, reason: 'PAYMENT_NOT_VERIFIED' };
    const known = await this.deps.repository.providers.allocatedCreditForObligation(obligationId);
    if (!known) return denied;
    return this.deps.repository.transaction(async (uow) => {
      // Same credit -> obligation order as refunds. A pending/unknown refund
      // reserves its amount and cannot be raced by a funding verification.
      const credit = await uow.providers.lockCredit(known.id);
      const obligation = await uow.lockObligation(obligationId);
      if (
        !credit ||
        !obligation ||
        credit.status !== 'ALLOCATED' ||
        credit.obligationId !== obligationId ||
        obligation.owner.kind !== 'account' ||
        obligation.owner.subjectId !== subjectId ||
        obligation.status !== 'SETTLED' ||
        !obligation.amount.equals(amount) ||
        !obligation.verified.equals(amount) ||
        !credit.amount.equals(amount) ||
        (await uow.bookings.forObligation(obligationId))
      )
        return denied;
      const reserved = await uow.providers.reservedForRefund(credit);
      if (reserved.amountMinor !== 0n) return denied;
      return {
        verified: true,
        obligationId,
        revision: obligation.revision,
        beneficiary: { kind: 'account', subjectId },
        amount: amount.toWire(),
        quoteId: obligation.quoteId,
      };
    });
  }
}
