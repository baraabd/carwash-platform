import { billingV1 } from '@carwash/contracts';
import { Money, refundPaidJournal } from '../domain';
import {
  ProviderRefundReferenceTaken,
  type AccessAuthority,
  type BillingRepository,
  type BillingUnitOfWork,
  type Clock,
  type Hasher,
  type IdGenerator,
  type ObligationRecord,
  type ProviderCreditRecord,
  type RecordedOutcome,
  type RefundRecord,
  type VerifiedPrincipal,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import { FINANCE_READ_PERMISSION } from './billing.service';
import {
  CommandSupport,
  refOf,
  sameRef,
  target,
  type Command,
  type CommandResult,
  type RequestContext,
} from './command-support';
import { canonicalRefundChangedEvent } from './canonical-refund.events';
import { canonicalRefundView, obligationRefundsView } from './canonical-refund.views';
import { REFUND_PERMISSION } from './refund.service';
import { assertSubscriptionFundingReleased } from './subscription-refund-fence';

export const CANONICAL_REFUND_OPERATIONS = {
  request: 'billing.obligation-refund.request.v1',
  outcome: 'billing.obligation-refund.outcome.v1',
} as const;

function account(principal: VerifiedPrincipal): VerifiedPrincipal {
  if (principal.kind !== 'account') throw new BillingApplicationError('AUTH_FORBIDDEN');
  return principal;
}

/**
 * Published billing.v1 manual-review refunds, backed by the original allocated
 * provider credit. Records out-of-band outcomes; it never transfers money or
 * manufactures a provider success. Cash disbursement/custody policy is unset.
 * Lock order agrees with settlement and legacy refunds: credit -> obligation -> refund.
 */
export class CanonicalRefundService {
  private readonly commands: CommandSupport;

  constructor(
    private readonly deps: {
      readonly repository: BillingRepository;
      readonly authority: AccessAuthority;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {
    this.commands = new CommandSupport(deps);
  }

  private readable(principal: VerifiedPrincipal, obligation: ObligationRecord): void {
    if (
      !principal.permissions.includes(FINANCE_READ_PERMISSION) &&
      !sameRef(refOf(principal), obligation.owner)
    )
      throw new BillingApplicationError('NOT_FOUND');
  }

  private distinctOwner(principal: VerifiedPrincipal, obligation: ObligationRecord): void {
    if (principal.subject === obligation.owner.subjectId)
      throw new BillingApplicationError('SEPARATION_OF_DUTIES');
  }

  private async bound(
    uow: BillingUnitOfWork,
    creditId: string,
    obligationId: string,
  ): Promise<{ credit: ProviderCreditRecord; obligation: ObligationRecord }> {
    const credit = await uow.providers.lockCredit(creditId);
    if (!credit || credit.status !== 'ALLOCATED' || credit.obligationId !== obligationId)
      throw new BillingApplicationError('SERVICE_NOT_READY');
    const obligation = await uow.lockObligation(obligationId);
    if (!obligation) throw new BillingApplicationError('NOT_FOUND');
    const snapshot = await uow.snapshot(obligationId);
    if (
      !snapshot ||
      obligation.status !== 'SETTLED' ||
      !credit.amount.equals(obligation.verified) ||
      !snapshot.attempts.some(
        (attempt) =>
          attempt.id === credit.attemptId &&
          attempt.status === 'MATCHED' &&
          attempt.method === credit.provider &&
          attempt.claimed.equals(credit.amount) &&
          attempt.observed?.equals(credit.amount),
      )
    )
      throw new BillingApplicationError('SERVICE_NOT_READY');
    return { credit, obligation };
  }

  private async changed(
    uow: BillingUnitOfWork,
    command: Command,
    context: RequestContext,
    credit: ProviderCreditRecord,
    previous: RefundRecord | null,
    next: RefundRecord,
    now: Date,
  ): Promise<RecordedOutcome> {
    await uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor: refOf(command.principal),
      action: previous ? 'billing.refund.outcome-recorded' : 'billing.refund.requested',
      obligationId: credit.obligationId,
      attemptId: null,
      receiptId: null,
      handoverId: null,
      creditId: credit.id,
      refundId: next.id,
      outcome: next.status,
      correlationId: context.correlationId,
    });
    await uow.appendOutbox(
      canonicalRefundChangedEvent(credit, previous, next, {
        eventId: this.deps.ids.uuid(),
        occurredAt: now,
        correlationId: context.correlationId,
        actor: refOf(command.principal),
        aggregateId: next.id,
        revision: next.revision,
      }),
    );
    return { status: previous ? 200 : 201, body: { ...canonicalRefundView(next, credit) } };
  }

  async requestRefund(
    context: RequestContext,
    obligationId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = account(await this.commands.permitted(context, REFUND_PERMISSION));
    const id = target(obligationId);
    const key = this.commands.key(idempotencyKey);
    const input = billingV1.parseRequestRefundRequestV1(body);
    const amount = Money.parse(input.amount);
    const command = this.commands.command(principal, CANONICAL_REFUND_OPERATIONS.request, key, {
      obligationId: id,
      ...input,
    });
    const committed = await this.commands.committed(command);
    if (committed) return committed;
    // Discover the immutable binding before entering the shared credit-first lock order.
    const snapshot = await this.deps.repository.snapshot(id);
    if (!snapshot) throw new BillingApplicationError('NOT_FOUND');
    this.distinctOwner(principal, snapshot.obligation);
    if (snapshot.obligation.revision !== input.expectedRevision)
      throw new BillingApplicationError('REVISION_CONFLICT');
    if (snapshot.obligation.status !== 'SETTLED')
      throw new BillingApplicationError('OBLIGATION_NOT_SETTLED');
    const known = await this.deps.repository.providers.allocatedCreditForObligation(id);
    // Includes cash, historical unmatched settlement, and a concurrent binding not yet visible.
    // No receipt is stored and no cash/provider journal is fabricated.
    if (!known) throw new BillingApplicationError('SERVICE_NOT_READY');
    return this.commands.execute(command, async (uow, now) => {
      const { credit, obligation } = await this.bound(uow, known.id, id);
      await assertSubscriptionFundingReleased(uow, credit);
      this.distinctOwner(principal, obligation);
      if (obligation.revision !== input.expectedRevision)
        throw new BillingApplicationError('REVISION_CONFLICT');
      if (amount.currency !== obligation.amount.currency)
        throw new BillingApplicationError('CURRENCY_MISMATCH');
      const refunds = await uow.providers.refundsForCredit(credit.id);
      if (refunds.length >= billingV1.MAX_REFUNDS_PER_OBLIGATION)
        throw new BillingApplicationError('REFUND_LIMIT_REACHED');
      const reserved = await uow.providers.reservedForRefund(credit);
      if (amount.amountMinor > obligation.verified.minus(reserved).amountMinor)
        throw new BillingApplicationError('REFUND_EXCEEDS_REFUNDABLE');
      const refund: RefundRecord = {
        id: this.deps.ids.uuid(),
        workflow: 'OBLIGATION_V1',
        creditId: credit.id,
        provider: credit.provider,
        amount,
        reason: input.reason,
        channel: 'MANUAL_OUT_OF_BAND',
        status: 'REQUESTED',
        requestedBy: principal.subject,
        requestedAt: now,
        decidedBy: null,
        decidedAt: null,
        providerRefundReference: null,
        evidenceDigest: null,
        completedBy: null,
        completedAt: null,
        revision: 1,
        updatedAt: now,
      };
      await uow.providers.insertRefund(refund, context.correlationId);
      return this.changed(uow, command, context, credit, null, refund, now);
    });
  }

  async recordOutcome(
    context: RequestContext,
    refundId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = account(await this.commands.permitted(context, 'billing.reconcile'));
    const id = target(refundId);
    const key = this.commands.key(idempotencyKey);
    const input = billingV1.parseRecordRefundOutcomeRequestV1(body);
    const command = this.commands.command(principal, CANONICAL_REFUND_OPERATIONS.outcome, key, {
      refundId: id,
      ...input,
    });
    const committed = await this.commands.committed(command);
    if (committed) return committed;
    const known = await this.deps.repository.providers.refund(id);
    if (!known) throw new BillingApplicationError('NOT_FOUND');
    if (known.workflow !== 'OBLIGATION_V1') throw new BillingApplicationError('REFUND_NOT_OPEN');
    const knownCredit = await this.deps.repository.providers.credit(known.creditId);
    if (!knownCredit?.obligationId) throw new BillingApplicationError('SERVICE_NOT_READY');
    const obligationId = knownCredit.obligationId;
    try {
      return await this.commands.execute(command, async (uow, now) => {
        const { credit, obligation } = await this.bound(uow, known.creditId, obligationId);
        await assertSubscriptionFundingReleased(uow, credit);
        const refund = await uow.providers.lockRefund(id);
        if (!refund || refund.creditId !== credit.id || refund.workflow !== 'OBLIGATION_V1')
          throw new BillingApplicationError('NOT_FOUND');
        this.distinctOwner(principal, obligation);
        if (refund.requestedBy === principal.subject)
          throw new BillingApplicationError('SEPARATION_OF_DUTIES');
        if (refund.revision !== input.expectedRevision)
          throw new BillingApplicationError('REVISION_CONFLICT');
        if (refund.status !== 'REQUESTED' && refund.status !== 'UNKNOWN')
          throw new BillingApplicationError('REFUND_NOT_OPEN');
        if (refund.status === 'UNKNOWN' && input.outcome === 'UNKNOWN')
          throw new BillingApplicationError('REFUND_NOT_OPEN');
        const terminal = input.outcome !== 'UNKNOWN';
        const next: RefundRecord = {
          ...refund,
          status: input.outcome,
          revision: refund.revision + 1,
          updatedAt: now,
          decidedBy: refund.decidedBy ?? principal.subject,
          decidedAt: refund.decidedAt ?? now,
          providerRefundReference: input.reference,
          completedBy: terminal ? principal.subject : null,
          completedAt: terminal ? now : null,
        };
        await uow.providers.updateRefund(id, refund.revision, next);
        if (next.status === 'SUCCEEDED') {
          await uow.postJournal(refundPaidJournal(next.id, credit.provider, next.amount, true), {
            id: this.deps.ids.uuid(),
            obligationId: null,
            handoverId: null,
            creditId: credit.id,
            postedAt: now,
            correlationId: context.correlationId,
          });
        }
        return this.changed(uow, command, context, credit, refund, next, now);
      });
    } catch (error: unknown) {
      if (error instanceof ProviderRefundReferenceTaken)
        throw new BillingApplicationError('REFUND_REFERENCE_TAKEN');
      throw error;
    }
  }

  async listObligationRefunds(context: RequestContext, obligationId: string) {
    const principal = await this.commands.principal(context);
    const id = target(obligationId);
    const first = await this.deps.repository.snapshot(id);
    if (!first) throw new BillingApplicationError('NOT_FOUND');
    this.readable(principal, first.obligation);
    const known = await this.deps.repository.providers.allocatedCreditForObligation(id);
    if (!known) {
      if (first.obligation.status === 'SETTLED' && !first.cashReceipt)
        throw new BillingApplicationError('SERVICE_NOT_READY');
      return obligationRefundsView(first.obligation, null, []);
    }
    return this.deps.repository.transaction(async (uow) => {
      const { credit, obligation } = await this.bound(uow, known.id, id);
      this.readable(principal, obligation);
      return obligationRefundsView(
        obligation,
        credit,
        await uow.providers.refundsForCredit(credit.id),
      );
    });
  }

  async getRefund(context: RequestContext, refundId: string) {
    await this.commands.permitted(context, FINANCE_READ_PERMISSION);
    const refund = await this.deps.repository.providers.refund(target(refundId));
    if (!refund) throw new BillingApplicationError('NOT_FOUND');
    const credit = await this.deps.repository.providers.credit(refund.creditId);
    if (!credit) throw new BillingApplicationError('NOT_FOUND');
    return canonicalRefundView(refund, credit);
  }
}
