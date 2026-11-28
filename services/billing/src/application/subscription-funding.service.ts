import type {
  BillingRepository,
  BillingServiceScope,
  BillingUnitOfWork,
  Clock,
  Hasher,
  ServiceCallerAuthority,
  SubscriptionFundingClaim,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import { IDEMPOTENCY_KEY, moneyInput, objectWithKeys, uuid } from './command-support';
import { canonicalJson } from './canonical-json';
import type { ServiceRequestContext } from './booking-obligation.service';

/** Billing owns both diagnostic evidence and the durable entitlement/refund exclusion. */
export class SubscriptionFundingService {
  constructor(
    private readonly deps: {
      readonly repository: BillingRepository;
      readonly callers: ServiceCallerAuthority;
      readonly clock?: Clock;
      readonly hasher: Hasher;
    },
  ) {}

  private caller(context: ServiceRequestContext, scope: BillingServiceScope): string {
    if (context.bearerPresent) throw new BillingApplicationError('AUTH_FORBIDDEN');
    const caller = this.deps.callers.authorize(context.clientId, context.token, scope);
    if (!caller.ok)
      throw new BillingApplicationError(
        caller.reason === 'UNAUTHENTICATED' ? 'AUTH_REQUIRED' : 'AUTH_FORBIDDEN',
      );
    return caller.clientId;
  }

  private key(raw: unknown): string {
    if (typeof raw !== 'string' || !IDEMPOTENCY_KEY.test(raw))
      throw new BillingApplicationError('IDEMPOTENCY_KEY_INVALID');
    return raw;
  }

  private async bind(
    uow: BillingUnitOfWork,
    clientId: string,
    operation: 'CLAIM' | 'RELEASE',
    key: string,
    request: unknown,
    correlationId: string,
  ): Promise<void> {
    const fingerprint = this.deps.hasher.sha256Hex(canonicalJson(request));
    const prior = await uow.subscriptionFunding.lockCommand(clientId, operation, key);
    if (prior !== null && prior !== fingerprint)
      throw new BillingApplicationError('IDEMPOTENCY_CONFLICT');
    if (prior === null)
      await uow.subscriptionFunding.bindCommand({
        clientId,
        operation,
        key,
        fingerprint,
        correlationId,
        recordedAt: this.deps.clock?.now() ?? new Date(),
      });
  }

  /** The natural subscription/period key survives a lost reply or owner transaction rollback. */
  async claim(
    context: ServiceRequestContext,
    body: unknown,
    rawKey: unknown,
  ): Promise<Record<string, unknown>> {
    const clientId = this.caller(context, 'billing.subscription-funding.claim');
    const key = this.key(rawKey);
    const input = objectWithKeys(body, [
      'obligationId',
      'subscriptionId',
      'periodNo',
      'beneficiary',
      'amount',
      ...(body !== null && typeof body === 'object' && Object.hasOwn(body, 'quoteId')
        ? ['quoteId']
        : []),
    ]);
    const obligationId = uuid(input.obligationId, 'obligationId');
    const subscriptionId = uuid(input.subscriptionId, 'subscriptionId');
    const periodNo = input.periodNo;
    if (
      typeof periodNo !== 'number' ||
      !Number.isSafeInteger(periodNo) ||
      periodNo < 1 ||
      periodNo > 2147483647
    )
      throw new BillingApplicationError('REQUEST_INVALID');
    const beneficiary = objectWithKeys(input.beneficiary, ['kind', 'subjectId']);
    if (beneficiary.kind !== 'account') throw new BillingApplicationError('REQUEST_INVALID');
    const subjectId = uuid(beneficiary.subjectId, 'beneficiary.subjectId');
    const amount = moneyInput(input.amount, 'amount');
    const quoteId = Object.hasOwn(input, 'quoteId') ? uuid(input.quoteId, 'quoteId') : null;
    const denied = { claimed: false, reason: 'PAYMENT_NOT_VERIFIED' };
    const known = await this.deps.repository.providers.allocatedCreditForObligation(obligationId);
    return this.deps.repository.transaction(async (uow) => {
      await this.bind(
        uow,
        clientId,
        'CLAIM',
        key,
        {
          obligationId,
          subscriptionId,
          periodNo,
          subjectId,
          amount: amount.toWire(),
          quoteId,
        },
        context.correlationId,
      );
      await uow.subscriptionFunding.lockSubscription(subscriptionId);
      const namespace = await uow.subscriptionFunding.namespace(subscriptionId);
      if (namespace && (namespace.clientId !== clientId || namespace.customerSubject !== subjectId))
        throw new BillingApplicationError('AUTH_FORBIDDEN');
      if (namespace?.releasedAt) return { claimed: false, reason: 'SUBSCRIPTION_CANCELLED' };
      if (!known) return denied;
      // Namespace -> credit -> obligation. Refunds acquire the same credit before checking claims.
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
        (quoteId !== null && obligation.quoteId !== quoteId) ||
        (await uow.bookings.forObligation(obligationId))
      )
        return denied;
      const existing = await uow.subscriptionFunding.forObligation(obligationId);
      const period = await uow.subscriptionFunding.forPeriod(subscriptionId, periodNo);
      if (
        (existing &&
          (existing.subscriptionId !== subscriptionId ||
            existing.periodNo !== periodNo ||
            existing.releasedAt)) ||
        (period && period.obligationId !== obligationId)
      )
        return { claimed: false, reason: 'FUNDING_ALREADY_CLAIMED' };
      if ((await uow.providers.reservedForRefund(credit)).amountMinor !== 0n) return denied;
      const now = this.deps.clock?.now() ?? new Date();
      if (!namespace)
        await uow.subscriptionFunding.insertNamespace({
          subscriptionId,
          clientId,
          customerSubject: subjectId,
          createdAt: now,
          releasedAt: null,
          correlationId: context.correlationId,
        });
      const claim: SubscriptionFundingClaim = existing ?? {
        obligationId,
        creditId: credit.id,
        subscriptionId,
        periodNo,
        quoteId: obligation.quoteId,
        amount,
        claimedAt: now,
        releasedAt: null,
        correlationId: context.correlationId,
      };
      if (!existing) await uow.subscriptionFunding.insertClaim(claim);
      return {
        claimed: true,
        obligationId,
        subscriptionId,
        periodNo,
        beneficiary: { kind: 'account', subjectId },
        amount: claim.amount.toWire(),
        quoteId: claim.quoteId,
      };
    });
  }

  /**
   * Only the Subscription workload can assert irreversible cancellation after all
   * reservations quiesce. The tombstone also fences an acquisition arriving late.
   * This does not issue a refund; Finance retains its approval and amount rules.
   */
  async release(
    context: ServiceRequestContext,
    id: string,
    body: unknown,
    rawKey: unknown,
  ): Promise<Record<string, unknown>> {
    const clientId = this.caller(context, 'billing.subscription-funding.release');
    const key = this.key(rawKey);
    const subscriptionId = uuid(id, 'subscriptionId');
    const input = objectWithKeys(body, ['beneficiary']);
    const beneficiary = objectWithKeys(input.beneficiary, ['kind', 'subjectId']);
    if (beneficiary.kind !== 'account') throw new BillingApplicationError('REQUEST_INVALID');
    const subjectId = uuid(beneficiary.subjectId, 'beneficiary.subjectId');
    return this.deps.repository.transaction(async (uow) => {
      await this.bind(
        uow,
        clientId,
        'RELEASE',
        key,
        { subscriptionId, subjectId },
        context.correlationId,
      );
      await uow.subscriptionFunding.lockSubscription(subscriptionId);
      const namespace = await uow.subscriptionFunding.namespace(subscriptionId);
      if (namespace && (namespace.clientId !== clientId || namespace.customerSubject !== subjectId))
        throw new BillingApplicationError('AUTH_FORBIDDEN');
      const now = this.deps.clock?.now() ?? new Date();
      if (!namespace)
        await uow.subscriptionFunding.insertNamespace({
          subscriptionId,
          clientId,
          customerSubject: subjectId,
          createdAt: now,
          releasedAt: now,
          correlationId: context.correlationId,
        });
      else if (!namespace.releasedAt)
        await uow.subscriptionFunding.releaseNamespace(subscriptionId, now);
      for (const claim of await uow.subscriptionFunding.activeClaims(subscriptionId)) {
        await uow.providers.lockCredit(claim.creditId);
        await uow.subscriptionFunding.releaseClaim(claim.obligationId, now);
      }
      return { released: true, subscriptionId, beneficiary: { kind: 'account', subjectId } };
    });
  }

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
