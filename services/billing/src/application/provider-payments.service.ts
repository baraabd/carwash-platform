import {
  CREDIT_STATUSES,
  EVIDENCE_DIGEST,
  MERCHANT_ACCOUNT,
  OPEN_ATTEMPT_STATUSES,
  PROVIDERS,
  STATEMENT_REJECTION_REASONS,
  assertOccurredBefore,
  normalizeProviderReference,
  planStatementDecision,
  type CreditStatus,
  type ProviderId,
  type StatementRejectionReason,
} from '../domain';
import {
  NotificationRejected,
  ProviderCapabilityMissing,
  ProviderCreditTaken,
  type AccessAuthority,
  type AttemptRecord,
  type AuditAction,
  type BillingRepository,
  type BillingUnitOfWork,
  type Clock,
  type CreditQueryResult,
  type Hasher,
  type IdGenerator,
  type InboundNotification,
  type PaymentProviderAdapter,
  type PaymentProviderRegistry,
  type ProviderCreditFact,
  type ProviderCreditRecord,
  type RecordedOutcome,
  type VerifiedPrincipal,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import { FINANCE_READ_PERMISSION, RECONCILE_PERMISSION } from './billing.service';
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
import { CreditSettlement, PROVIDER_AUDIT_SUBJECTS } from './credit-settlement';
import { creditView, providerDiagnosticsView } from './provider-views';
import { providerCreditChangedEvent } from './provider-events';
import { financialStatusView } from './views';

export const PROVIDER_OPERATIONS = {
  recordStatement: 'billing.credit.statement.record.v1',
  decideStatement: 'billing.credit.statement.decide.v1',
  verifyAttempt: 'billing.attempt.provider-verify.v1',
} as const;

const DECISIONS = ['APPROVE', 'REJECT'] as const;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DEFAULT_QUEUE = 50;

function accountOnly(principal: VerifiedPrincipal): VerifiedPrincipal {
  // Money decisions belong to staff accounts; a guest session never makes them.
  if (principal.kind !== 'account') throw new BillingApplicationError('AUTH_FORBIDDEN');
  return principal;
}

function instant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value))
    throw new BillingApplicationError('REQUEST_INVALID', { field });
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new BillingApplicationError('REQUEST_INVALID', { field });
  return parsed;
}

function pattern(value: unknown, expression: RegExp, field: string): string {
  if (typeof value !== 'string' || !expression.test(value))
    throw new BillingApplicationError('REQUEST_INVALID', { field });
  return value;
}

function sameFacts(stored: ProviderCreditRecord, fact: ProviderCreditFact): boolean {
  return (
    stored.amount.equals(fact.amount) &&
    stored.occurredAt.getTime() === fact.occurredAt.getTime() &&
    stored.merchantAccount === fact.merchantAccount
  );
}

export type ProviderVerificationOutcome =
  'FOUND' | 'PENDING' | 'NOT_FOUND' | 'UNKNOWN' | 'WRONG_MERCHANT_ACCOUNT';

/**
 * Provider credits and reconciliation (domain/provider.ts):
 *  - authenticated provider notifications (adapter capability),
 *  - Finance's verified pull of one claim from the provider (capability),
 *  - merchant-statement credits recorded by one person and decided by another,
 *  - and the allocation of every confirmed credit to the claim carrying its
 *    reference (CreditSettlement).
 *
 * Network calls to a provider happen BEFORE the transaction and never under a
 * database lock; an unknowable provider outcome is UNKNOWN, never success.
 */
export class ProviderPaymentsService {
  private readonly commands: CommandSupport;
  private readonly settlement: CreditSettlement;

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
    this.settlement = new CreditSettlement(deps.ids);
  }

  private adapter(provider: ProviderId): PaymentProviderAdapter {
    return this.deps.providers.adapter(provider);
  }

  private async audit(
    uow: BillingUnitOfWork,
    command: Command,
    context: RequestContext,
    now: Date,
    action: AuditAction,
    credit: ProviderCreditRecord,
  ): Promise<void> {
    await uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor: refOf(command.principal),
      action,
      obligationId: credit.obligationId,
      attemptId: credit.attemptId,
      receiptId: null,
      handoverId: null,
      creditId: credit.id,
      outcome: credit.status,
      correlationId: context.correlationId,
    });
  }

  /** Command responses: a credit has no refunds while it is being decided. */
  private outcome(credit: ProviderCreditRecord, status: number): RecordedOutcome {
    return { status, body: creditView(credit, []) };
  }

  // ---------------------------------------------------------------- commands

  /**
   * Finance records a credit read from the merchant's own statement for an
   * approved merchant account. It changes nothing financial until a second
   * person approves it (decideStatementCredit).
   */
  async recordStatementCredit(
    context: RequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, RECONCILE_PERMISSION));
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, [
      'provider',
      'merchantAccount',
      'providerReference',
      'amount',
      'occurredAt',
      'evidenceDigest',
    ]);
    const provider: ProviderId = oneOf(input.provider, PROVIDERS, 'provider');
    const merchantAccount = pattern(input.merchantAccount, MERCHANT_ACCOUNT, 'merchantAccount');
    const reference = normalizeProviderReference(input.providerReference);
    if (!reference)
      throw new BillingApplicationError('REQUEST_INVALID', { field: 'providerReference' });
    const amount = moneyInput(input.amount, 'amount');
    const occurredAt = instant(input.occurredAt, 'occurredAt');
    const evidenceDigest = pattern(input.evidenceDigest, EVIDENCE_DIGEST, 'evidenceDigest');
    const adapter = this.adapter(provider);
    if (!adapter.capabilities.statementEvidence)
      throw new BillingApplicationError('PROVIDER_CAPABILITY_MISSING');
    if (!adapter.acceptsMerchantAccount(merchantAccount))
      throw new BillingApplicationError('MERCHANT_ACCOUNT_UNKNOWN');
    const command = this.commands.command(principal, PROVIDER_OPERATIONS.recordStatement, key, {
      provider,
      merchantAccount,
      providerReference: reference,
      amount: amount.toWire(),
      occurredAt: occurredAt.toISOString(),
      evidenceDigest,
    });
    try {
      return await this.commands.execute(command, async (uow, now) => {
        decide(() => assertOccurredBefore(occurredAt, now));
        await uow.providers.lockReference(provider, reference);
        if (await uow.providers.effectiveCredit(provider, merchantAccount, reference))
          throw new BillingApplicationError('PROVIDER_CREDIT_ALREADY_RECORDED');
        const credit: ProviderCreditRecord = {
          id: this.deps.ids.uuid(),
          provider,
          merchantAccount,
          reference,
          amount,
          occurredAt,
          source: 'MERCHANT_STATEMENT',
          evidenceDigest,
          status: 'PENDING_APPROVAL',
          unallocatedReason: null,
          attemptId: null,
          obligationId: null,
          recordedBy: principal.subject,
          decidedBy: null,
          decidedAt: null,
          rejectionReason: null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        await uow.providers.insertCredit(credit, context.correlationId);
        await this.audit(uow, command, context, now, 'billing.credit.recorded', credit);
        await uow.appendOutbox(
          providerCreditChangedEvent(
            {
              provider,
              source: credit.source,
              previousStatus: null,
              status: credit.status,
              unallocatedReason: null,
              amount: amount.toWire(),
              obligationId: null,
            },
            {
              eventId: this.deps.ids.uuid(),
              occurredAt: now,
              correlationId: context.correlationId,
              actor: refOf(principal),
              aggregateId: credit.id,
              revision: 1,
            },
          ),
        );
        return this.outcome(credit, 201);
      });
    } catch (error: unknown) {
      if (error instanceof ProviderCreditTaken)
        throw new BillingApplicationError('PROVIDER_CREDIT_ALREADY_RECORDED');
      throw error;
    }
  }

  /**
   * A second person approves (the credit is established and allocated when it
   * settles a claim) or rejects (no financial effect; the line may be recorded
   * again correctly) a statement credit.
   */
  async decideStatementCredit(
    context: RequestContext,
    creditId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, RECONCILE_PERMISSION));
    const id = target(creditId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'decision', 'rejectionReason']);
    const expectedRevision = revision(input.expectedRevision);
    const decision = oneOf(input.decision, DECISIONS, 'decision');
    let rejectionReason: StatementRejectionReason | null = null;
    if (decision === 'REJECT')
      rejectionReason = oneOf(
        input.rejectionReason,
        STATEMENT_REJECTION_REASONS,
        'rejectionReason',
      );
    else if (input.rejectionReason !== null)
      throw new BillingApplicationError('REQUEST_INVALID', { field: 'rejectionReason' });
    const command = this.commands.command(principal, PROVIDER_OPERATIONS.decideStatement, key, {
      creditId: id,
      expectedRevision,
      decision,
      rejectionReason,
    });
    const existing = await this.commands.committed(command);
    if (existing) return existing;
    const known = await this.deps.repository.providers.credit(id);
    if (!known) throw new BillingApplicationError('NOT_FOUND');

    return this.commands.execute(command, async (uow, now) => {
      await uow.providers.lockReference(known.provider, known.reference);
      const credit = await uow.providers.lockCredit(id);
      if (!credit) throw new BillingApplicationError('NOT_FOUND');
      if (credit.revision !== expectedRevision)
        throw new BillingApplicationError('REVISION_CONFLICT');
      decide(() => planStatementDecision({ credit, decider: principal.subject }));
      if (decision === 'REJECT') {
        const next: ProviderCreditRecord = {
          ...credit,
          status: 'REJECTED',
          decidedBy: principal.subject,
          decidedAt: now,
          rejectionReason,
          revision: credit.revision + 1,
          updatedAt: now,
        };
        await uow.providers.updateCredit(id, credit.revision, next);
        await this.audit(uow, command, context, now, 'billing.credit.rejected', next);
        await uow.appendOutbox(
          providerCreditChangedEvent(
            {
              provider: next.provider,
              source: next.source,
              previousStatus: credit.status,
              status: next.status,
              unallocatedReason: null,
              amount: next.amount.toWire(),
              obligationId: null,
            },
            {
              eventId: this.deps.ids.uuid(),
              occurredAt: now,
              correlationId: context.correlationId,
              actor: refOf(principal),
              aggregateId: id,
              revision: next.revision,
            },
          ),
        );
        return this.outcome(next, 200);
      }
      const result = await this.settlement.confirm(
        { uow, now, correlationId: context.correlationId, actor: refOf(principal) },
        { ...credit, decidedBy: principal.subject, decidedAt: now },
        credit,
      );
      await this.audit(uow, command, context, now, 'billing.credit.approved', result.credit);
      return this.outcome(result.credit, 200);
    });
  }

  /**
   * A provider notification. Not an Identity-authenticated request: the
   * adapter authenticates the exact bytes (signature, replay window) or the
   * notification is rejected. Natural idempotency on the provider reference: a
   * replay with the same facts changes nothing; different facts are refused.
   */
  async receiveNotification(
    providerPath: string,
    notification: InboundNotification,
    correlationId: string,
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
    const provider = PROVIDERS.find((candidate) => candidate === providerPath.toUpperCase());
    // An unknown provider and one without the capability are indistinguishable.
    if (!provider) throw new BillingApplicationError('NOT_FOUND');
    const adapter = this.adapter(provider);
    if (!adapter.capabilities.notifications) throw new BillingApplicationError('NOT_FOUND');
    const received = this.deps.clock.now();
    let authenticated;
    try {
      authenticated = await adapter.authenticateNotification(notification, received);
    } catch (error: unknown) {
      if (error instanceof NotificationRejected || error instanceof ProviderCapabilityMissing)
        throw new BillingApplicationError('NOTIFICATION_REJECTED');
      throw error;
    }
    if (authenticated.kind === 'IGNORED') return { status: 202, body: { recorded: false } };
    const { fact, evidenceDigest } = authenticated;
    if (!adapter.acceptsMerchantAccount(fact.merchantAccount))
      throw new BillingApplicationError('MERCHANT_ACCOUNT_UNKNOWN');
    decide(() => assertOccurredBefore(fact.occurredAt, received));

    try {
      return await this.deps.repository.transaction(async (uow) => {
        const now = this.deps.clock.now();
        await uow.providers.lockReference(provider, fact.reference);
        const stored = await uow.providers.effectiveCredit(
          provider,
          fact.merchantAccount,
          fact.reference,
        );
        if (stored) {
          // Same facts already recorded (possibly as a statement line awaiting
          // approval): acknowledged, never recorded twice. Different facts: refused.
          if (!sameFacts(stored, fact))
            throw new BillingApplicationError('PROVIDER_CREDIT_CONFLICT');
          return { status: 200, body: { recorded: false, duplicate: true } };
        }
        const result = await this.settlement.confirm(
          { uow, now, correlationId, actor: null },
          this.draft(provider, fact, evidenceDigest, 'PROVIDER_NOTIFICATION', null, now),
          null,
        );
        await uow.appendAudit({
          id: this.deps.ids.uuid(),
          occurredAt: now,
          actor: { kind: 'provider', subjectId: PROVIDER_AUDIT_SUBJECTS[provider] },
          action: 'billing.credit.recorded',
          obligationId: result.credit.obligationId,
          attemptId: result.credit.attemptId,
          receiptId: null,
          handoverId: null,
          creditId: result.credit.id,
          outcome: result.credit.status,
          correlationId,
        });
        // The provider learns only that the notification was recorded.
        return { status: 201, body: { recorded: true } };
      });
    } catch (error: unknown) {
      // A concurrent identical notification committed first (unique key).
      if (error instanceof ProviderCreditTaken)
        return { status: 200, body: { recorded: false, duplicate: true } };
      throw error;
    }
  }

  private draft(
    provider: ProviderId,
    fact: ProviderCreditFact,
    evidenceDigest: string,
    source: 'PROVIDER_NOTIFICATION' | 'PROVIDER_QUERY',
    recordedBy: string | null,
    now: Date,
  ): ProviderCreditRecord {
    return {
      id: this.deps.ids.uuid(),
      provider,
      merchantAccount: fact.merchantAccount,
      reference: fact.reference,
      amount: fact.amount,
      occurredAt: fact.occurredAt,
      source,
      evidenceDigest,
      status: 'UNALLOCATED',
      unallocatedReason: null,
      attemptId: null,
      obligationId: null,
      recordedBy,
      decidedBy: null,
      decidedAt: null,
      rejectionReason: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Finance asks the provider about one open claim (verified pull). FOUND
   * records the credit (or retries the allocation of one already recorded);
   * UNKNOWN marks a pending claim UNKNOWN; PENDING / NOT_FOUND change nothing.
   */
  async verifyAttemptWithProvider(
    context: RequestContext,
    attemptId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, RECONCILE_PERMISSION));
    const id = target(attemptId);
    const key = this.commands.key(idempotencyKey);
    objectWithKeys(body, []);
    const command = this.commands.command(principal, PROVIDER_OPERATIONS.verifyAttempt, key, {
      attemptId: id,
    });
    const existing = await this.commands.committed(command);
    if (existing) return existing;
    const obligationId = await this.deps.repository.obligationIdForAttempt(id);
    if (!obligationId) throw new BillingApplicationError('NOT_FOUND');
    const snapshot = await this.deps.repository.snapshot(obligationId);
    const claim = snapshot?.attempts.find((attempt) => attempt.id === id);
    if (!snapshot || !claim) throw new BillingApplicationError('NOT_FOUND');
    if (snapshot.obligation.owner.subjectId === principal.subject)
      throw new BillingApplicationError('SEPARATION_OF_DUTIES');
    if (!OPEN_ATTEMPT_STATUSES.includes(claim.status))
      throw new BillingApplicationError('ATTEMPT_NOT_OPEN');
    const provider = PROVIDERS.find((candidate) => candidate === claim.method);
    if (!provider) throw new BillingApplicationError('PROVIDER_CAPABILITY_MISSING');
    const adapter = this.adapter(provider);
    if (!adapter.capabilities.creditQuery)
      throw new BillingApplicationError('PROVIDER_CAPABILITY_MISSING');

    // Outside any transaction: a slow provider never holds a database lock.
    const answer = await this.query(adapter, claim, context.correlationId);

    return this.commands.execute(command, async (uow, now) => {
      if (answer.kind === 'FOUND_FINAL') {
        if (!adapter.acceptsMerchantAccount(answer.fact.merchantAccount))
          return this.verification(uow, obligationId, 'WRONG_MERCHANT_ACCOUNT', null);
        decide(() => assertOccurredBefore(answer.fact.occurredAt, now));
        await uow.providers.lockReference(provider, answer.fact.reference);
        const stored = await uow.providers.effectiveCredit(
          provider,
          answer.fact.merchantAccount,
          answer.fact.reference,
        );
        let credit: ProviderCreditRecord;
        if (stored) {
          if (!sameFacts(stored, answer.fact))
            throw new BillingApplicationError('PROVIDER_CREDIT_CONFLICT');
          const locked = await uow.providers.lockCredit(stored.id);
          if (!locked) throw new Error('CREDIT_DISAPPEARED');
          if (locked.status !== 'UNALLOCATED')
            return this.verification(uow, obligationId, 'FOUND', locked);
          credit = (await this.settlement.confirm(stepOf(), locked, locked)).credit;
        } else {
          credit = (
            await this.settlement.confirm(
              stepOf(),
              this.draft(
                provider,
                answer.fact,
                answer.evidenceDigest,
                'PROVIDER_QUERY',
                principal.subject,
                now,
              ),
              null,
            )
          ).credit;
          await this.audit(uow, command, context, now, 'billing.credit.recorded', credit);
        }
        return this.verification(uow, obligationId, 'FOUND', credit);
      }
      if (answer.kind === 'UNKNOWN')
        await this.markUnknown(uow, obligationId, id, command, context, now);
      return this.verification(uow, obligationId, answer.kind, null);

      function stepOf() {
        return { uow, now, correlationId: context.correlationId, actor: refOf(principal) };
      }
    });
  }

  private async query(
    adapter: PaymentProviderAdapter,
    claim: AttemptRecord,
    correlationId: string,
  ): Promise<CreditQueryResult> {
    try {
      const answer = await adapter.queryCredit(claim.providerReference, correlationId);
      // An answer about a different transaction is not an answer about this one.
      if (answer.kind === 'FOUND_FINAL' && answer.fact.reference !== claim.providerReference)
        return { kind: 'UNKNOWN' };
      return answer;
    } catch {
      return { kind: 'UNKNOWN' };
    }
  }

  private async markUnknown(
    uow: BillingUnitOfWork,
    obligationId: string,
    attemptId: string,
    command: Command,
    context: RequestContext,
    now: Date,
  ): Promise<void> {
    const obligation = await uow.lockObligation(obligationId);
    const before = await uow.snapshot(obligationId);
    const attempt = before?.attempts.find((candidate) => candidate.id === attemptId);
    if (!obligation || !before || !attempt || attempt.status !== 'PENDING_REVIEW') return;
    await uow.reconcileAttempt(attemptId, 'PENDING_REVIEW', {
      to: 'UNKNOWN',
      at: now,
      by: refOf(command.principal),
      observed: null,
      creditId: null,
    });
    await uow.updateObligation(obligationId, obligation.revision, {
      verified: obligation.verified,
      status: obligation.status,
      updatedAt: now,
    });
    await uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor: refOf(command.principal),
      action: 'billing.attempt.reconciled',
      obligationId,
      attemptId,
      receiptId: null,
      handoverId: null,
      outcome: 'UNKNOWN',
      correlationId: context.correlationId,
    });
    const after = await uow.snapshot(obligationId);
    if (!after) throw new Error('OBLIGATION_DISAPPEARED');
    await this.settlement.obligationChanged(
      { uow, now, correlationId: context.correlationId, actor: refOf(command.principal) },
      before,
      after,
    );
  }

  private async verification(
    uow: BillingUnitOfWork,
    obligationId: string,
    outcome: ProviderVerificationOutcome,
    credit: ProviderCreditRecord | null,
  ): Promise<RecordedOutcome> {
    const after = await uow.snapshot(obligationId);
    if (!after) throw new Error('OBLIGATION_DISAPPEARED');
    return {
      status: 200,
      body: {
        providerOutcome: outcome,
        credit: credit ? creditView(credit, []) : null,
        obligation: financialStatusView(after),
      },
    };
  }

  // ------------------------------------------------------------------ queries

  async getCredit(context: RequestContext, creditId: string) {
    await this.commands.permitted(context, FINANCE_READ_PERMISSION);
    const id = target(creditId);
    const credit = await this.deps.repository.providers.credit(id);
    if (!credit) throw new BillingApplicationError('NOT_FOUND');
    return creditView(credit, await this.deps.repository.providers.refundsForCredit(id));
  }

  /** Finance's work queue: credits awaiting approval, or received but unallocated. */
  async credits(context: RequestContext, status: unknown, limit: unknown) {
    await this.commands.permitted(context, FINANCE_READ_PERMISSION);
    const filter: CreditStatus = oneOf(status, CREDIT_STATUSES, 'status');
    const take = limit === undefined ? DEFAULT_QUEUE : Number(limit);
    if (!Number.isInteger(take) || take < 1 || take > 200)
      throw new BillingApplicationError('REQUEST_INVALID', { field: 'limit' });
    const rows = await this.deps.repository.providers.credits({ status: filter, limit: take });
    return { credits: rows.map((credit) => creditView(credit, [])) };
  }

  /** Redacted capability/configuration report for operators. */
  async providers(context: RequestContext) {
    await this.commands.permitted(context, FINANCE_READ_PERMISSION);
    return {
      providers: this.deps.providers
        .all()
        .map((adapter) => providerDiagnosticsView(adapter.diagnostics())),
    };
  }
}
