import {
  EVIDENCE_DIGEST,
  REFUND_REASONS,
  REFUND_STATUSES,
  normalizeProviderReference,
  planManualRefundCompletion,
  planRefundDecision,
  planRefundProviderOutcome,
  planRefundRequest,
  refundPaidJournal,
  type RefundReason,
  type RefundStatus,
} from '../domain';
import {
  ProviderRefundReferenceTaken,
  type AccessAuthority,
  type AuditAction,
  type BillingRepository,
  type BillingUnitOfWork,
  type Clock,
  type Hasher,
  type IdGenerator,
  type PaymentProviderRegistry,
  type ProviderCreditRecord,
  type RecordedOutcome,
  type RefundProviderAnswer,
  type RefundRecord,
  type VerifiedPrincipal,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import { FINANCE_READ_PERMISSION } from './billing.service';
import {
  CommandSupport,
  decide,
  moneyInput,
  objectWithKeys,
  oneOf,
  refOf,
  revision,
  target,
  type Command,
  type CommandResult,
  type RequestContext,
} from './command-support';
import { refundChangedEvent } from './provider-events';
import { refundView } from './provider-views';

/** Existing Identity grant (packages/contracts IDENTITY_PERMISSIONS). */
export const REFUND_PERMISSION = 'billing.refund';

export const REFUND_OPERATIONS = {
  request: 'billing.refund.request.v1',
  decide: 'billing.refund.decide.v1',
  execute: 'billing.refund.provider-execute.v1',
  complete: 'billing.refund.manual-complete.v1',
} as const;

const DECISIONS = ['APPROVE', 'REJECT'] as const;
const MANUAL_OUTCOMES = ['SUCCEEDED', 'FAILED'] as const;
const DEFAULT_QUEUE = 50;

function accountOnly(principal: VerifiedPrincipal): VerifiedPrincipal {
  if (principal.kind !== 'account') throw new BillingApplicationError('AUTH_FORBIDDEN');
  return principal;
}

/**
 * Refunds of provider credits (domain/refund.ts). Request -> approval by a
 * different person -> execution through the provider's refund API (when its
 * adapter declares that capability) or an out-of-band manual transfer recorded
 * with its reference and evidence. Lock order is credit -> refund. A provider
 * call is made outside any transaction; its unknowable outcome is UNKNOWN.
 */
export class RefundService {
  private readonly commands: CommandSupport;

  constructor(
    private readonly deps: {
      readonly repository: BillingRepository;
      readonly authority: AccessAuthority;
      readonly providers: PaymentProviderRegistry;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {
    this.commands = new CommandSupport(deps);
  }

  // ---------------------------------------------------------------- helpers

  private async changed(
    uow: BillingUnitOfWork,
    command: Command,
    context: RequestContext,
    now: Date,
    action: AuditAction,
    credit: ProviderCreditRecord,
    previous: RefundRecord | null,
    next: RefundRecord,
  ): Promise<RecordedOutcome> {
    await uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor: refOf(command.principal),
      action,
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
      refundChangedEvent(
        {
          creditId: credit.id,
          obligationId: credit.obligationId,
          provider: next.provider,
          channel: next.channel,
          reason: next.reason,
          previousStatus: previous?.status ?? null,
          status: next.status,
          amount: next.amount.toWire(),
        },
        {
          eventId: this.deps.ids.uuid(),
          occurredAt: now,
          correlationId: context.correlationId,
          actor: refOf(command.principal),
          aggregateId: next.id,
          revision: next.revision,
        },
      ),
    );
    return { status: previous ? 200 : 201, body: refundView(next) };
  }

  /** credit -> refund, both locked; the refund revision is the caller's precondition. */
  private async lockedRefund(
    uow: BillingUnitOfWork,
    refundId: string,
    creditId: string,
    expectedRevision: number,
  ): Promise<{ credit: ProviderCreditRecord; refund: RefundRecord }> {
    const credit = await uow.providers.lockCredit(creditId);
    const refund = await uow.providers.lockRefund(refundId);
    if (!credit || !refund || refund.creditId !== credit.id)
      throw new BillingApplicationError('NOT_FOUND');
    if (refund.revision !== expectedRevision)
      throw new BillingApplicationError('REVISION_CONFLICT');
    return { credit, refund };
  }

  /** The money left: post the refund journal against the credit. */
  private async paid(
    uow: BillingUnitOfWork,
    credit: ProviderCreditRecord,
    refund: RefundRecord,
    now: Date,
    context: RequestContext,
  ): Promise<void> {
    await uow.postJournal(
      refundPaidJournal(refund.id, credit.provider, refund.amount, credit.status === 'ALLOCATED'),
      {
        id: this.deps.ids.uuid(),
        obligationId: null,
        handoverId: null,
        creditId: credit.id,
        postedAt: now,
        correlationId: context.correlationId,
      },
    );
  }

  private async known(refundId: string): Promise<RefundRecord> {
    const refund = await this.deps.repository.providers.refund(refundId);
    if (!refund) throw new BillingApplicationError('NOT_FOUND');
    return refund;
  }

  private async withReferenceGuard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof ProviderRefundReferenceTaken)
        throw new BillingApplicationError('PROVIDER_REFUND_REFERENCE_TAKEN');
      throw error;
    }
  }

  // ---------------------------------------------------------------- commands

  /**
   * Finance requests a refund of (part of) a confirmed credit. The amount is
   * reserved immediately, so concurrent requests can never exceed the credit.
   */
  async requestRefund(
    context: RequestContext,
    creditId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, REFUND_PERMISSION));
    const id = target(creditId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'amount', 'reason']);
    const expectedRevision = revision(input.expectedRevision);
    const amount = moneyInput(input.amount, 'amount');
    const reason: RefundReason = oneOf(input.reason, REFUND_REASONS, 'reason');
    const command = this.commands.command(principal, REFUND_OPERATIONS.request, key, {
      creditId: id,
      expectedRevision,
      amount: amount.toWire(),
      reason,
    });
    return this.commands.execute(command, async (uow, now) => {
      const credit = await uow.providers.lockCredit(id);
      if (!credit) throw new BillingApplicationError('NOT_FOUND');
      if (credit.revision !== expectedRevision)
        throw new BillingApplicationError('REVISION_CONFLICT');
      if (credit.obligationId) {
        const snapshot = await uow.snapshot(credit.obligationId);
        // Nobody refunds money that paid their own obligation.
        if (snapshot?.obligation.owner.subjectId === principal.subject)
          throw new BillingApplicationError('SEPARATION_OF_DUTIES');
      }
      const reserved = await uow.providers.reservedForRefund(credit);
      decide(() => planRefundRequest({ credit, reserved, amount, reason }));
      const refund: RefundRecord = {
        id: this.deps.ids.uuid(),
        creditId: id,
        provider: credit.provider,
        amount,
        reason,
        channel: this.deps.providers.adapter(credit.provider).capabilities.refunds,
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
      return this.changed(
        uow,
        command,
        context,
        now,
        'billing.refund.requested',
        credit,
        null,
        refund,
      );
    });
  }

  /** Approval or rejection by someone other than the requester. */
  async decideRefund(
    context: RequestContext,
    refundId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, REFUND_PERMISSION));
    const id = target(refundId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'decision']);
    const expectedRevision = revision(input.expectedRevision);
    const decision = oneOf(input.decision, DECISIONS, 'decision');
    const command = this.commands.command(principal, REFUND_OPERATIONS.decide, key, {
      refundId: id,
      expectedRevision,
      decision,
    });
    const existing = await this.commands.committed(command);
    if (existing) return existing;
    const known = await this.known(id);
    return this.commands.execute(command, async (uow, now) => {
      const { credit, refund } = await this.lockedRefund(uow, id, known.creditId, expectedRevision);
      decide(() => planRefundDecision({ refund, decider: principal.subject }));
      const next: RefundRecord = {
        ...refund,
        status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        decidedBy: principal.subject,
        decidedAt: now,
        revision: refund.revision + 1,
        updatedAt: now,
      };
      await uow.providers.updateRefund(id, refund.revision, next);
      return this.changed(
        uow,
        command,
        context,
        now,
        decision === 'APPROVE' ? 'billing.refund.approved' : 'billing.refund.rejected',
        credit,
        refund,
        next,
      );
    });
  }

  /**
   * Submits an APPROVED refund to the provider's refund API, or asks the
   * provider for the status of a SUBMITTED/UNKNOWN one. The refund id is the
   * provider's idempotency key, so a retry after a lost answer cannot pay twice.
   */
  async executeRefund(
    context: RequestContext,
    refundId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, REFUND_PERMISSION));
    const id = target(refundId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision']);
    const expectedRevision = revision(input.expectedRevision);
    const command = this.commands.command(principal, REFUND_OPERATIONS.execute, key, {
      refundId: id,
      expectedRevision,
    });
    const existing = await this.commands.committed(command);
    if (existing) return existing;
    const refund = await this.known(id);
    if (refund.revision !== expectedRevision)
      throw new BillingApplicationError('REVISION_CONFLICT');
    // Validates the channel and status before any provider call.
    decide(() => planRefundProviderOutcome({ refund, outcome: 'UNKNOWN' }));
    const credit = await this.deps.repository.providers.credit(refund.creditId);
    if (!credit) throw new Error('REFUND_WITHOUT_CREDIT');
    const adapter = this.deps.providers.adapter(credit.provider);
    if (adapter.capabilities.refunds !== 'PROVIDER_API')
      throw new BillingApplicationError('PROVIDER_CAPABILITY_MISSING');
    const instruction = {
      refundId: refund.id,
      merchantAccount: credit.merchantAccount,
      originalReference: credit.reference,
      amount: refund.amount,
    };
    let answer: RefundProviderAnswer;
    try {
      answer =
        refund.status === 'APPROVED'
          ? await adapter.submitRefund(instruction, context.correlationId)
          : await adapter.refundStatus(instruction, context.correlationId);
    } catch {
      answer = { outcome: 'UNKNOWN', providerRefundReference: null };
    }
    const providerReference =
      answer.providerRefundReference === null
        ? null
        : normalizeProviderReference(answer.providerRefundReference);

    return this.withReferenceGuard(() =>
      this.commands.execute(command, async (uow, now) => {
        const locked = await this.lockedRefund(uow, id, refund.creditId, expectedRevision);
        const status: RefundStatus = decide(() =>
          planRefundProviderOutcome({ refund: locked.refund, outcome: answer.outcome }),
        );
        if (status === locked.refund.status)
          return { status: 200, body: refundView(locked.refund) };
        const terminal = status === 'SUCCEEDED' || status === 'FAILED';
        const next: RefundRecord = {
          ...locked.refund,
          status,
          providerRefundReference: locked.refund.providerRefundReference ?? providerReference,
          completedAt: terminal ? now : null,
          revision: locked.refund.revision + 1,
          updatedAt: now,
        };
        await uow.providers.updateRefund(id, locked.refund.revision, next);
        if (status === 'SUCCEEDED') await this.paid(uow, locked.credit, next, now, context);
        return this.changed(
          uow,
          command,
          context,
          now,
          'billing.refund.outcome-recorded',
          locked.credit,
          locked.refund,
          next,
        );
      }),
    );
  }

  /**
   * Records the outcome of an approved out-of-band refund. SUCCEEDED needs the
   * transfer reference and the digest of the evidence (bank/provider record);
   * the recorder cannot be the requester.
   */
  async completeManualRefund(
    context: RequestContext,
    refundId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, REFUND_PERMISSION));
    const id = target(refundId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, [
      'expectedRevision',
      'outcome',
      'transferReference',
      'evidenceDigest',
    ]);
    const expectedRevision = revision(input.expectedRevision);
    const outcome = oneOf(input.outcome, MANUAL_OUTCOMES, 'outcome');
    let transferReference: string | null = null;
    let evidenceDigest: string | null = null;
    if (outcome === 'SUCCEEDED') {
      transferReference = normalizeProviderReference(input.transferReference);
      if (!transferReference)
        throw new BillingApplicationError('REQUEST_INVALID', { field: 'transferReference' });
      if (typeof input.evidenceDigest !== 'string' || !EVIDENCE_DIGEST.test(input.evidenceDigest))
        throw new BillingApplicationError('REQUEST_INVALID', { field: 'evidenceDigest' });
      evidenceDigest = input.evidenceDigest;
    } else if (input.transferReference !== null || input.evidenceDigest !== null) {
      throw new BillingApplicationError('REQUEST_INVALID', { field: 'transferReference' });
    }
    const command = this.commands.command(principal, REFUND_OPERATIONS.complete, key, {
      refundId: id,
      expectedRevision,
      outcome,
      transferReference,
      evidenceDigest,
    });
    const existing = await this.commands.committed(command);
    if (existing) return existing;
    const known = await this.known(id);
    return this.withReferenceGuard(() =>
      this.commands.execute(command, async (uow, now) => {
        const { credit, refund } = await this.lockedRefund(
          uow,
          id,
          known.creditId,
          expectedRevision,
        );
        decide(() => planManualRefundCompletion({ refund, recorder: principal.subject }));
        const next: RefundRecord = {
          ...refund,
          status: outcome,
          providerRefundReference: transferReference,
          evidenceDigest,
          completedBy: principal.subject,
          completedAt: now,
          revision: refund.revision + 1,
          updatedAt: now,
        };
        await uow.providers.updateRefund(id, refund.revision, next);
        if (outcome === 'SUCCEEDED') await this.paid(uow, credit, next, now, context);
        return this.changed(
          uow,
          command,
          context,
          now,
          'billing.refund.outcome-recorded',
          credit,
          refund,
          next,
        );
      }),
    );
  }

  // ------------------------------------------------------------------ queries

  async getRefund(context: RequestContext, refundId: string) {
    await this.commands.permitted(context, FINANCE_READ_PERMISSION);
    return refundView(await this.known(target(refundId)));
  }

  async refunds(context: RequestContext, status: unknown, limit: unknown) {
    await this.commands.permitted(context, FINANCE_READ_PERMISSION);
    const filter: RefundStatus = oneOf(status, REFUND_STATUSES, 'status');
    const take = limit === undefined ? DEFAULT_QUEUE : Number(limit);
    if (!Number.isInteger(take) || take < 1 || take > 200)
      throw new BillingApplicationError('REQUEST_INVALID', { field: 'limit' });
    const rows = await this.deps.repository.providers.refunds({ status: filter, limit: take });
    return { refunds: rows.map(refundView) };
  }
}
