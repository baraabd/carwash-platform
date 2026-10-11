import {
  CONFIRMED_CREDIT_STATUSES,
  Money,
  creditAllocatedJournal,
  creditReceivedJournal,
  outstanding,
  planCreditAllocation,
  type JournalPlan,
  type ProviderId,
} from '../domain';
import type {
  AuditActor,
  BillingUnitOfWork,
  FinancialSnapshot,
  IdGenerator,
  PrincipalRef,
  ProviderCreditRecord,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import { obligationStatusChangedEvent } from './events';
import { providerCreditChangedEvent } from './provider-events';
import { snapshotFinancialStatus } from './views';

/**
 * Fixed audit subjects for facts caused by a provider's authenticated
 * notification (no Identity principal exists for them).
 */
export const PROVIDER_AUDIT_SUBJECTS: Readonly<Record<ProviderId, string>> = {
  SHAM_CASH: '5c0a1b2c-3d4e-4f50-8a61-000000000001',
  SYRIATEL_CASH: '5c0a1b2c-3d4e-4f50-8a61-000000000002',
};

export interface SettlementStep {
  readonly uow: BillingUnitOfWork;
  readonly now: Date;
  readonly correlationId: string;
  /** The person whose command establishes the credit; null for a provider notification. */
  readonly actor: PrincipalRef | null;
}

export interface SettlementResult {
  readonly credit: ProviderCreditRecord;
  /** The obligation the credit was allocated to, after the change. */
  readonly obligation: FinancialSnapshot | null;
}

/**
 * Establishes a provider credit and allocates it when it settles a claim
 * (domain planCreditAllocation), inside the caller's transaction. The caller
 * must already hold the provider-reference advisory lock (ProviderStore.lockReference)
 * and, for an existing credit, its row lock. Lock order is
 * reference -> credit -> obligation; claim submission takes obligation ->
 * reference, which cannot cycle because a claim is only visible here once its
 * own transaction committed.
 *
 * Writes, in guard order: the credit row (so the attempt guard sees it), the
 * MATCHED attempt, the SUCCEEDED intent, CREDIT_RECEIVED (first confirmation
 * only), CREDIT_ALLOCATED, the settled obligation, audit and outbox rows.
 */
export class CreditSettlement {
  constructor(private readonly ids: IdGenerator) {}

  private auditActor(step: SettlementStep, provider: ProviderId): AuditActor {
    return step.actor ?? { kind: 'provider', subjectId: PROVIDER_AUDIT_SUBJECTS[provider] };
  }

  private async journal(
    step: SettlementStep,
    plan: JournalPlan,
    scope: { readonly obligationId: string | null; readonly creditId: string },
  ): Promise<void> {
    await step.uow.postJournal(plan, {
      id: this.ids.uuid(),
      obligationId: scope.obligationId,
      handoverId: null,
      creditId: scope.creditId,
      postedAt: step.now,
      correlationId: step.correlationId,
    });
  }

  /**
   * `draft` carries the credit's facts (and, for an approval, the decision);
   * its status/allocation fields are computed here. `previous` is the locked
   * stored row, or null for a new credit.
   */
  async confirm(
    step: SettlementStep,
    draft: ProviderCreditRecord,
    previous: ProviderCreditRecord | null,
  ): Promise<SettlementResult> {
    const { uow } = step;
    const claim = await uow.providers.claimFor(draft.provider, draft.reference);
    const obligation = claim ? await uow.lockObligation(claim.obligationId) : null;
    const before = obligation ? await uow.snapshot(obligation.id) : null;
    if (obligation && before) {
      const owner = obligation.owner.subjectId;
      // Nobody settles their own obligation: neither the person who recorded
      // the statement line nor the one who approved or triggered it.
      if (step.actor?.subjectId === owner || draft.recordedBy === owner)
        throw new BillingApplicationError('SEPARATION_OF_DUTIES');
    }
    const attempt = claim && before ? before.attempts.find((a) => a.id === claim.attemptId) : null;
    const reserved = previous ? await uow.providers.reservedForRefund(previous) : null;
    const plan = planCreditAllocation({
      credit: draft,
      reservedForRefund: reserved,
      claim: attempt ?? null,
      obligation: before?.obligation ?? null,
      intent: before?.activeIntent ?? null,
    });

    const wasConfirmed = previous !== null && CONFIRMED_CREDIT_STATUSES.includes(previous.status);
    if (previous?.status === 'UNALLOCATED' && plan.kind === 'UNALLOCATED')
      return { credit: previous, obligation: null };

    const next: ProviderCreditRecord =
      plan.kind === 'ALLOCATE' && attempt && before
        ? {
            ...draft,
            status: 'ALLOCATED',
            unallocatedReason: null,
            attemptId: attempt.id,
            obligationId: before.obligation.id,
            revision: previous ? previous.revision + 1 : 1,
            updatedAt: step.now,
          }
        : {
            ...draft,
            status: 'UNALLOCATED',
            unallocatedReason: plan.kind === 'UNALLOCATED' ? plan.reason : 'NO_CLAIM',
            attemptId: null,
            obligationId: null,
            revision: previous ? previous.revision + 1 : 1,
            updatedAt: step.now,
          };
    if (previous) await uow.providers.updateCredit(previous.id, previous.revision, next);
    else await uow.providers.insertCredit(next, step.correlationId);
    if (!wasConfirmed)
      await this.journal(step, creditReceivedJournal(next.id, next.provider, next.amount), {
        obligationId: null,
        creditId: next.id,
      });

    let after: FinancialSnapshot | null = null;
    if (next.status === 'ALLOCATED' && attempt && before) {
      const intent = before.activeIntent;
      if (!intent) throw new Error('ALLOCATION_WITHOUT_INTENT');
      await uow.reconcileAttempt(attempt.id, attempt.status, {
        to: 'MATCHED',
        at: step.now,
        by: step.actor,
        observed: next.amount,
        creditId: next.id,
      });
      await uow.setIntentStatus(intent.id, intent.status, 'SUCCEEDED', step.now);
      await this.journal(step, creditAllocatedJournal(next.id, next.amount), {
        obligationId: before.obligation.id,
        creditId: next.id,
      });
      await uow.updateObligation(before.obligation.id, before.obligation.revision, {
        verified: before.obligation.verified.plus(next.amount),
        status: 'SETTLED',
        updatedAt: step.now,
      });
      after = await uow.snapshot(before.obligation.id);
      if (!after) throw new Error('OBLIGATION_DISAPPEARED');
      await uow.appendAudit({
        id: this.ids.uuid(),
        occurredAt: step.now,
        actor: this.auditActor(step, next.provider),
        action: 'billing.credit.allocated',
        obligationId: before.obligation.id,
        attemptId: attempt.id,
        receiptId: null,
        handoverId: null,
        creditId: next.id,
        outcome: 'MATCHED',
        correlationId: step.correlationId,
      });
      await this.obligationChanged(step, before, after);
    }
    await uow.appendOutbox(
      providerCreditChangedEvent(
        {
          provider: next.provider,
          source: next.source,
          previousStatus: previous?.status ?? null,
          status: next.status,
          unallocatedReason: next.unallocatedReason,
          amount: next.amount.toWire(),
          obligationId: next.obligationId,
        },
        {
          eventId: this.ids.uuid(),
          occurredAt: step.now,
          correlationId: step.correlationId,
          actor: step.actor,
          aggregateId: next.id,
          revision: next.revision,
        },
      ),
    );
    return { credit: next, obligation: after };
  }

  /** Obligation status-changed outbox row when the customer-facing status moved. */
  async obligationChanged(
    step: SettlementStep,
    before: FinancialSnapshot,
    after: FinancialSnapshot,
  ): Promise<void> {
    const previous = snapshotFinancialStatus(before);
    const current = snapshotFinancialStatus(after);
    if (previous === current) return;
    const { obligation } = after;
    await step.uow.appendOutbox(
      obligationStatusChangedEvent(
        {
          previousFinancialStatus: previous,
          financialStatus: current,
          verified: obligation.verified.toWire(),
          outstanding: (obligation.status === 'VOIDED'
            ? Money.zero(obligation.amount.currency)
            : outstanding(obligation)
          ).toWire(),
        },
        {
          eventId: this.ids.uuid(),
          occurredAt: step.now,
          correlationId: step.correlationId,
          actor: step.actor,
          obligationId: obligation.id,
          revision: obligation.revision,
        },
      ),
    );
  }
}
