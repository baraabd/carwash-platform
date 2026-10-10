import {
  REVERSAL_REASONS,
  cashCollectedJournal,
  cashCollectionReversedJournal,
  custodyReceivedJournal,
  custodyReconciledJournal,
  normalizeTreasuryReference,
  outstanding,
  planCashCollection,
  planCollectionReversal,
  planHandover,
  planHandoverCancel,
  planHandoverReconciliation,
  planTreasuryReceipt,
  type CustodyStatus,
  type JournalPlan,
  type ReversalReason,
  type WorkEvidence,
} from '../domain';
import {
  CollectionAlreadyRecorded,
  TreasuryReferenceTaken,
  WorkAuthorityUnavailable,
  type AccessAuthority,
  type AuditAction,
  type BillingRepository,
  type BillingUnitOfWork,
  type CashReceiptRecord,
  type Clock,
  type FinancialSnapshot,
  type HandoverRecord,
  type Hasher,
  type IdGenerator,
  type OutboxEvent,
  type RecordedOutcome,
  type VerifiedPrincipal,
  type WorkAuthority,
} from '../ports';
import { BillingApplicationError } from './billing-errors';
import { FINANCE_READ_PERMISSION, RECONCILE_PERMISSION } from './billing.service';
import {
  CommandSupport,
  UUID,
  decide,
  moneyInput,
  objectWithKeys,
  oneOf,
  refOf,
  revision,
  target,
  uuid,
  type Command,
  type CommandResult,
  type RequestContext,
} from './command-support';
import {
  cashCollectedEvent,
  cashCollectionReversedEvent,
  custodyHandoverChangedEvent,
} from './custody-events';
import { handoverView, holderPositionView, receiptView, reconciliationView } from './custody-views';
import { obligationStatusChangedEvent } from './events';
import { financialStatusView, snapshotFinancialStatus } from './views';

/**
 * Requested from Lane E/Identity (CR-B-08). Until granted, every command that
 * needs one of these is denied (deny by default); nothing falls back to a
 * broader existing grant.
 */
export const COLLECT_PERMISSION = 'billing.cash.collect';
export const CORRECT_PERMISSION = 'billing.cash.correct';
export const TREASURY_RECEIVE_PERMISSION = 'billing.treasury.receive';

export const CUSTODY_OPERATIONS = {
  collect: 'billing.cash.collect.v1',
  reverse: 'billing.cash.reverse.v1',
  declare: 'billing.custody.handover.declare.v1',
  cancel: 'billing.custody.handover.cancel.v1',
  receive: 'billing.custody.handover.receive.v1',
  reconcile: 'billing.custody.handover.reconcile.v1',
} as const;

const MAX_HANDOVER_IDS = 200;

function accountOnly(principal: VerifiedPrincipal): VerifiedPrincipal {
  // Collection, custody and treasury duties belong to staff accounts; a guest
  // session can never hold cash for the company.
  if (principal.kind !== 'account') throw new BillingApplicationError('AUTH_FORBIDDEN');
  return principal;
}

function receiptIdSet(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_HANDOVER_IDS)
    throw new BillingApplicationError('REQUEST_INVALID', { field: 'receiptIds' });
  const ids = value.map((entry) => {
    if (typeof entry !== 'string' || !UUID.test(entry))
      throw new BillingApplicationError('REQUEST_INVALID', { field: 'receiptIds' });
    return entry;
  });
  return ids;
}

function treasuryReference(value: unknown, field: string): string {
  const normalized = normalizeTreasuryReference(value);
  if (!normalized) throw new BillingApplicationError('REQUEST_INVALID', { field });
  return normalized;
}

interface Scope {
  readonly obligationId: string | null;
  readonly receiptId: string | null;
  readonly handoverId: string | null;
}

/**
 * Cash collection, linked reversal, technician custody, handover, treasury
 * receipt and settlement reconciliation (domain/cash.ts).
 *
 * Every command follows the shared CommandSupport protocol and changes Billing
 * state, balanced journals, audit and outbox in ONE local ACID transaction. The
 * work owner (lane C) is read BEFORE the transaction so no network call holds a
 * database lock; its answer is authority for assignment/completion only, never
 * for money. Lock order is obligation -> receipt, and handover -> receipts;
 * receipts are always locked in ascending id order.
 */
export class CashCustodyService {
  private readonly commands: CommandSupport;

  constructor(
    private readonly deps: {
      readonly repository: BillingRepository;
      readonly authority: AccessAuthority;
      readonly work: WorkAuthority;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly hasher: Hasher;
    },
  ) {
    this.commands = new CommandSupport(deps);
  }

  // ---------------------------------------------------------------- helpers

  private async journal(
    uow: BillingUnitOfWork,
    plan: JournalPlan,
    scope: { readonly obligationId: string | null; readonly handoverId: string | null },
    now: Date,
    context: RequestContext,
  ): Promise<void> {
    await uow.postJournal(plan, {
      id: this.deps.ids.uuid(),
      obligationId: scope.obligationId,
      handoverId: scope.handoverId,
      postedAt: now,
      correlationId: context.correlationId,
    });
  }

  private async audit(
    uow: BillingUnitOfWork,
    command: Command,
    context: RequestContext,
    now: Date,
    action: AuditAction,
    outcome: string,
    scope: Scope,
  ): Promise<void> {
    await uow.appendAudit({
      id: this.deps.ids.uuid(),
      occurredAt: now,
      actor: refOf(command.principal),
      action,
      obligationId: scope.obligationId,
      attemptId: null,
      receiptId: scope.receiptId,
      handoverId: scope.handoverId,
      outcome,
      correlationId: context.correlationId,
    });
  }

  private context(command: Command, context: RequestContext, now: Date) {
    return {
      eventId: this.deps.ids.uuid(),
      occurredAt: now,
      correlationId: context.correlationId,
      actor: refOf(command.principal),
    };
  }

  /** Obligation status-changed outbox row when the customer-facing status moved. */
  private async obligationChanged(
    uow: BillingUnitOfWork,
    before: FinancialSnapshot,
    after: FinancialSnapshot,
    command: Command,
    context: RequestContext,
    now: Date,
  ): Promise<void> {
    const previous = snapshotFinancialStatus(before);
    const current = snapshotFinancialStatus(after);
    if (previous === current) return;
    const { obligation } = after;
    await uow.appendOutbox(
      obligationStatusChangedEvent(
        {
          previousFinancialStatus: previous,
          financialStatus: current,
          verified: obligation.verified.toWire(),
          outstanding: outstanding(obligation).toWire(),
        },
        {
          ...this.context(command, context, now),
          obligationId: obligation.id,
          revision: obligation.revision,
        },
      ),
    );
  }

  private handoverEvent(
    previous: HandoverRecord | null,
    next: HandoverRecord,
    command: Command,
    context: RequestContext,
    now: Date,
  ): OutboxEvent {
    return custodyHandoverChangedEvent(
      {
        holder: next.holder,
        previousStatus: previous?.status ?? null,
        status: next.status,
        receiptCount: next.receiptCount,
        declared: next.declared.toWire(),
        counted: next.counted?.toWire() ?? null,
        shortage: next.shortage?.toWire() ?? null,
        overage: next.overage?.toWire() ?? null,
      },
      { ...this.context(command, context, now), aggregateId: next.id, revision: next.revision },
    );
  }

  /** Moves every receipt of a handover to `to`, locking them in id order. */
  private async moveReceipts(
    uow: BillingUnitOfWork,
    handoverId: string,
    expected: CustodyStatus,
    to: CustodyStatus,
    link: string | null,
    now: Date,
  ): Promise<void> {
    const ids = await uow.custody.handoverReceiptIds(handoverId);
    const receipts = await uow.custody.lockReceipts(ids);
    if (receipts.length !== ids.length) throw new Error('HANDOVER_RECEIPT_MISSING');
    for (const receipt of receipts) {
      if (receipt.custodyStatus !== expected || receipt.handoverId !== handoverId)
        throw new Error('HANDOVER_RECEIPT_OUT_OF_STEP');
      await uow.custody.updateReceiptCustody(receipt.id, receipt.revision, to, link, now);
    }
  }

  private async lockedHandover(
    uow: BillingUnitOfWork,
    handoverId: string,
    expectedRevision: number,
    allowed: (handover: HandoverRecord) => boolean,
  ): Promise<HandoverRecord> {
    const handover = await uow.custody.lockHandover(handoverId);
    if (!handover || !allowed(handover)) throw new BillingApplicationError('NOT_FOUND');
    if (handover.revision !== expectedRevision)
      throw new BillingApplicationError('REVISION_CONFLICT');
    return handover;
  }

  private async handoverOutcome(
    uow: BillingUnitOfWork,
    handover: HandoverRecord,
    status: number,
  ): Promise<RecordedOutcome> {
    const receiptIds = await uow.custody.handoverReceiptIds(handover.id);
    return { status, body: handoverView({ handover, receiptIds }) };
  }

  // ---------------------------------------------------------------- commands

  /**
   * The assigned technician records the cash the customer paid after the
   * service. Work facts come from the work owner, never from the body; the body
   * only asserts the amount, which must equal the outstanding amount exactly.
   */
  async recordCollection(
    context: RequestContext,
    obligationId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, COLLECT_PERMISSION));
    const id = target(obligationId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'bookingId', 'amount']);
    const expectedRevision = revision(input.expectedRevision);
    const bookingId = uuid(input.bookingId, 'bookingId');
    const declared = moneyInput(input.amount, 'amount');
    const command = this.commands.command(principal, CUSTODY_OPERATIONS.collect, key, {
      obligationId: id,
      expectedRevision,
      bookingId,
      amount: declared.toWire(),
    });
    const existing = await this.commands.committed(command);
    if (existing) return existing;

    let work: WorkEvidence | null;
    try {
      // The credential was verified above, so it is a string here.
      work = await this.deps.work.evidenceFor(
        bookingId,
        context.credential ?? '',
        context.correlationId,
      );
    } catch (error: unknown) {
      if (error instanceof WorkAuthorityUnavailable)
        throw new BillingApplicationError('UPSTREAM_UNAVAILABLE');
      throw error;
    }
    if (!work || work.bookingId !== bookingId) throw new BillingApplicationError('NOT_FOUND');
    const evidence = work;

    try {
      return await this.commands.execute(command, async (uow, now) => {
        const obligation = await uow.lockObligation(id);
        // An obligation that is not this booking's is indistinguishable from a
        // missing one, and the revision is checked only after that binding.
        if (!obligation || obligation.quoteId !== evidence.quoteId)
          throw new BillingApplicationError('NOT_FOUND');
        if (evidence.technicianSubject !== principal.subject)
          throw new BillingApplicationError('COLLECTOR_NOT_ASSIGNED');
        if (obligation.revision !== expectedRevision)
          throw new BillingApplicationError('REVISION_CONFLICT');
        const before = await uow.snapshot(id);
        if (!before) throw new Error('LOCKED_OBLIGATION_WITHOUT_SNAPSHOT');
        const plan = decide(() =>
          planCashCollection({
            obligation,
            intent: before.activeIntent,
            owner: obligation.owner.subjectId,
            collector: principal.subject,
            work: evidence,
            declared,
          }),
        );
        const intent = before.activeIntent;
        if (!intent) throw new Error('PLAN_ACCEPTED_WITHOUT_INTENT');
        const receipt: CashReceiptRecord = {
          id: this.deps.ids.uuid(),
          obligationId: id,
          intentId: intent.id,
          bookingId,
          assignmentId: evidence.assignmentId,
          assignmentRevision: evidence.assignmentRevision,
          collector: principal.subject,
          amount: plan.received,
          custodyStatus: 'HELD',
          handoverId: null,
          revision: 1,
          collectedAt: now,
          updatedAt: now,
        };
        await uow.custody.insertReceipt(receipt, context.correlationId);
        await uow.setIntentStatus(intent.id, intent.status, 'SUCCEEDED', now);
        await this.journal(
          uow,
          cashCollectedJournal(receipt.id, principal.subject, plan.received),
          { obligationId: id, handoverId: null },
          now,
          context,
        );
        await uow.updateObligation(id, expectedRevision, {
          verified: obligation.verified.plus(plan.received),
          status: 'SETTLED',
          updatedAt: now,
        });
        const after = await uow.snapshot(id);
        if (!after) throw new Error('OBLIGATION_DISAPPEARED');
        await this.audit(uow, command, context, now, 'billing.cash.collected', 'HELD', {
          obligationId: id,
          receiptId: receipt.id,
          handoverId: null,
        });
        await uow.appendOutbox(
          cashCollectedEvent(
            {
              obligationId: id,
              bookingId,
              assignmentId: evidence.assignmentId,
              amount: plan.received.toWire(),
              custodyStatus: 'HELD',
            },
            { ...this.context(command, context, now), aggregateId: receipt.id, revision: 1 },
          ),
        );
        await this.obligationChanged(uow, before, after, command, context, now);
        return {
          status: 201,
          body: { receipt: receiptView(receipt, null), obligation: financialStatusView(after) },
        };
      });
    } catch (error: unknown) {
      if (error instanceof CollectionAlreadyRecorded)
        throw new BillingApplicationError('COLLECTION_ALREADY_RECORDED');
      throw error;
    }
  }

  /**
   * Finance corrects a collection recorded in error with a LINKED reversal:
   * the receipt becomes REVERSED (kept), the receivable returns, the obligation
   * reopens awaiting cash, and a fresh cash intent is opened. Only cash still
   * HELD can be reversed here; the collector and the customer never can.
   */
  async reverseCollection(
    context: RequestContext,
    receiptId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, CORRECT_PERMISSION));
    const id = target(receiptId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'reason']);
    const expectedRevision = revision(input.expectedRevision);
    const reason: ReversalReason = oneOf(input.reason, REVERSAL_REASONS, 'reason');
    const command = this.commands.command(principal, CUSTODY_OPERATIONS.reverse, key, {
      receiptId: id,
      expectedRevision,
      reason,
    });
    const existing = await this.commands.committed(command);
    if (existing) return existing;
    const known = await this.deps.repository.custody.receipt(id);
    if (!known) throw new BillingApplicationError('NOT_FOUND');

    return this.commands.execute(command, async (uow, now) => {
      const obligation = await uow.lockObligation(known.obligationId);
      const receipt = await uow.custody.lockReceipt(id);
      if (!obligation || !receipt) throw new BillingApplicationError('NOT_FOUND');
      if (receipt.revision !== expectedRevision)
        throw new BillingApplicationError('REVISION_CONFLICT');
      if (obligation.owner.subjectId === principal.subject)
        throw new BillingApplicationError('SEPARATION_OF_DUTIES');
      decide(() => planCollectionReversal({ receipt, reverser: principal.subject }));
      const before = await uow.snapshot(obligation.id);
      if (!before) throw new Error('LOCKED_OBLIGATION_WITHOUT_SNAPSHOT');
      const reversal = {
        id: this.deps.ids.uuid(),
        receiptId: id,
        obligationId: obligation.id,
        reason,
        reversedBy: principal.subject,
        reversedAt: now,
      };
      await uow.custody.insertReversal(reversal, context.correlationId);
      await uow.custody.updateReceiptCustody(id, receipt.revision, 'REVERSED', null, now);
      await uow.setIntentStatus(receipt.intentId, 'SUCCEEDED', 'CANCELLED', now);
      await this.journal(
        uow,
        cashCollectionReversedJournal(id, receipt.collector, receipt.amount),
        { obligationId: obligation.id, handoverId: null },
        now,
        context,
      );
      const reopened = obligation.verified.minus(receipt.amount);
      await uow.updateObligation(obligation.id, obligation.revision, {
        verified: reopened,
        status: 'OPEN',
        updatedAt: now,
      });
      // The customer chose cash; the reopened obligation awaits cash again.
      await uow.insertIntent(
        {
          id: this.deps.ids.uuid(),
          obligationId: obligation.id,
          method: 'CASH_ON_COMPLETION',
          status: 'AWAITING_CASH_COLLECTION',
          amount: obligation.amount.minus(reopened),
          createdAt: now,
          updatedAt: now,
        },
        context.correlationId,
      );
      const after = await uow.snapshot(obligation.id);
      if (!after) throw new Error('OBLIGATION_DISAPPEARED');
      await this.audit(uow, command, context, now, 'billing.cash.reversed', reason, {
        obligationId: obligation.id,
        receiptId: id,
        handoverId: null,
      });
      await uow.appendOutbox(
        cashCollectionReversedEvent(
          {
            obligationId: obligation.id,
            bookingId: receipt.bookingId,
            amount: receipt.amount.toWire(),
            reason,
          },
          {
            ...this.context(command, context, now),
            aggregateId: id,
            revision: receipt.revision + 1,
          },
        ),
      );
      await this.obligationChanged(uow, before, after, command, context, now);
      const updated = await uow.custody.lockReceipt(id);
      if (!updated) throw new Error('RECEIPT_DISAPPEARED');
      return {
        status: 200,
        body: { receipt: receiptView(updated, reversal), obligation: financialStatusView(after) },
      };
    });
  }

  /**
   * The holder declares handing a set of their HELD receipts to the company.
   * The request is a SET: duplicates are refused and order is not meaningful,
   * so the fingerprint uses the sorted ids. Nothing is "received" yet.
   */
  async declareHandover(
    context: RequestContext,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, COLLECT_PERMISSION));
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['receiptIds', 'declaredAmount']);
    const requested = receiptIdSet(input.receiptIds);
    const declared = moneyInput(input.declaredAmount, 'declaredAmount');
    const sorted = [...requested].sort();
    const command = this.commands.command(principal, CUSTODY_OPERATIONS.declare, key, {
      receiptIds: sorted,
      declaredAmount: declared.toWire(),
    });
    return this.commands.execute(command, async (uow, now) => {
      const receipts =
        new Set(sorted).size === sorted.length ? await uow.custody.lockReceipts(sorted) : [];
      const plan = decide(() =>
        planHandover({ holder: principal.subject, receipts, requestedIds: requested, declared }),
      );
      const handover: HandoverRecord = {
        id: this.deps.ids.uuid(),
        holder: principal.subject,
        declared: plan.total,
        receiptCount: receipts.length,
        status: 'PENDING',
        counted: null,
        shortage: null,
        overage: null,
        treasuryReference: null,
        receivedBy: null,
        receivedAt: null,
        settlementReference: null,
        reconciledBy: null,
        reconciledAt: null,
        cancelledBy: null,
        cancelledAt: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await uow.custody.insertHandover(
        handover,
        receipts.map((receipt) => ({ receiptId: receipt.id, amount: receipt.amount })),
        context.correlationId,
      );
      for (const receipt of receipts)
        await uow.custody.updateReceiptCustody(
          receipt.id,
          receipt.revision,
          'IN_HANDOVER',
          handover.id,
          now,
        );
      await this.audit(uow, command, context, now, 'billing.custody.handover-declared', 'PENDING', {
        obligationId: null,
        receiptId: null,
        handoverId: handover.id,
      });
      await uow.appendOutbox(this.handoverEvent(null, handover, command, context, now));
      return this.handoverOutcome(uow, handover, 201);
    });
  }

  /** The holder withdraws a PENDING handover, or the treasury refuses it. */
  async cancelHandover(
    context: RequestContext,
    handoverId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.principal(context));
    const holderDuty = principal.permissions.includes(COLLECT_PERMISSION);
    const treasuryDuty = principal.permissions.includes(TREASURY_RECEIVE_PERMISSION);
    if (!holderDuty && !treasuryDuty) throw new BillingApplicationError('AUTH_FORBIDDEN');
    const id = target(handoverId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision']);
    const expectedRevision = revision(input.expectedRevision);
    const command = this.commands.command(principal, CUSTODY_OPERATIONS.cancel, key, {
      handoverId: id,
      expectedRevision,
    });
    return this.commands.execute(command, async (uow, now) => {
      const handover = await this.lockedHandover(
        uow,
        id,
        expectedRevision,
        (candidate) => treasuryDuty || (holderDuty && candidate.holder === principal.subject),
      );
      decide(() => planHandoverCancel({ handover }));
      const next: HandoverRecord = {
        ...handover,
        status: 'CANCELLED',
        cancelledBy: principal.subject,
        cancelledAt: now,
        revision: handover.revision + 1,
        updatedAt: now,
      };
      await uow.custody.updateHandover(id, handover.revision, next);
      await this.moveReceipts(uow, id, 'IN_HANDOVER', 'HELD', null, now);
      await this.audit(
        uow,
        command,
        context,
        now,
        'billing.custody.handover-cancelled',
        'CANCELLED',
        { obligationId: null, receiptId: null, handoverId: id },
      );
      await uow.appendOutbox(this.handoverEvent(handover, next, command, context, now));
      return this.handoverOutcome(uow, next, 200);
    });
  }

  /**
   * An independent treasury receiver counts the handed-over cash. A shortage or
   * overage is recorded explicitly in the ledger and stays open for the owner's
   * resolution policy (B-07); it is never absorbed or blamed automatically.
   */
  async receiveHandover(
    context: RequestContext,
    handoverId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(
      await this.commands.permitted(context, TREASURY_RECEIVE_PERMISSION),
    );
    const id = target(handoverId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'countedAmount', 'treasuryReference']);
    const expectedRevision = revision(input.expectedRevision);
    const counted = moneyInput(input.countedAmount, 'countedAmount');
    const reference = treasuryReference(input.treasuryReference, 'treasuryReference');
    const command = this.commands.command(principal, CUSTODY_OPERATIONS.receive, key, {
      handoverId: id,
      expectedRevision,
      countedAmount: counted.toWire(),
      treasuryReference: reference,
    });
    try {
      return await this.commands.execute(command, async (uow, now) => {
        const handover = await this.lockedHandover(uow, id, expectedRevision, () => true);
        const plan = decide(() =>
          planTreasuryReceipt({ handover, receiver: principal.subject, counted }),
        );
        const next: HandoverRecord = {
          ...handover,
          status: 'RECEIVED',
          counted: plan.counted,
          shortage: plan.shortage,
          overage: plan.overage,
          treasuryReference: reference,
          receivedBy: principal.subject,
          receivedAt: now,
          revision: handover.revision + 1,
          updatedAt: now,
        };
        await uow.custody.updateHandover(id, handover.revision, next);
        await this.journal(
          uow,
          custodyReceivedJournal(id, handover.holder, handover.declared, plan),
          { obligationId: null, handoverId: id },
          now,
          context,
        );
        await this.moveReceipts(uow, id, 'IN_HANDOVER', 'DEPOSITED', id, now);
        const outcome = plan.shortage.isZero()
          ? plan.overage.isZero()
            ? 'RECEIVED'
            : 'RECEIVED_OVERAGE'
          : 'RECEIVED_SHORTAGE';
        await this.audit(uow, command, context, now, 'billing.custody.handover-received', outcome, {
          obligationId: null,
          receiptId: null,
          handoverId: id,
        });
        await uow.appendOutbox(this.handoverEvent(handover, next, command, context, now));
        return this.handoverOutcome(uow, next, 200);
      });
    } catch (error: unknown) {
      if (error instanceof TreasuryReferenceTaken)
        throw new BillingApplicationError('TREASURY_REFERENCE_TAKEN');
      throw error;
    }
  }

  /**
   * Final settlement: a reconciler who is neither the holder nor the receiver
   * confirms the counted cash against the company's settlement reference.
   */
  async reconcileHandover(
    context: RequestContext,
    handoverId: string,
    idempotencyKey: unknown,
    body: unknown,
  ): Promise<CommandResult> {
    const principal = accountOnly(await this.commands.permitted(context, RECONCILE_PERMISSION));
    const id = target(handoverId);
    const key = this.commands.key(idempotencyKey);
    const input = objectWithKeys(body, ['expectedRevision', 'settlementReference']);
    const expectedRevision = revision(input.expectedRevision);
    const reference = treasuryReference(input.settlementReference, 'settlementReference');
    const command = this.commands.command(principal, CUSTODY_OPERATIONS.reconcile, key, {
      handoverId: id,
      expectedRevision,
      settlementReference: reference,
    });
    try {
      return await this.commands.execute(command, async (uow, now) => {
        const handover = await this.lockedHandover(uow, id, expectedRevision, () => true);
        decide(() => planHandoverReconciliation({ handover, reconciler: principal.subject }));
        const counted = handover.counted;
        if (!counted) throw new Error('RECEIVED_HANDOVER_WITHOUT_COUNT');
        const next: HandoverRecord = {
          ...handover,
          status: 'RECONCILED',
          settlementReference: reference,
          reconciledBy: principal.subject,
          reconciledAt: now,
          revision: handover.revision + 1,
          updatedAt: now,
        };
        await uow.custody.updateHandover(id, handover.revision, next);
        // Nothing reached the treasury when the count was zero: no journal.
        if (!counted.isZero())
          await this.journal(
            uow,
            custodyReconciledJournal(id, counted),
            { obligationId: null, handoverId: id },
            now,
            context,
          );
        await this.moveReceipts(uow, id, 'DEPOSITED', 'SETTLED', id, now);
        await this.audit(
          uow,
          command,
          context,
          now,
          'billing.custody.handover-reconciled',
          'RECONCILED',
          { obligationId: null, receiptId: null, handoverId: id },
        );
        await uow.appendOutbox(this.handoverEvent(handover, next, command, context, now));
        return this.handoverOutcome(uow, next, 200);
      });
    } catch (error: unknown) {
      if (error instanceof TreasuryReferenceTaken)
        throw new BillingApplicationError('TREASURY_REFERENCE_TAKEN');
      throw error;
    }
  }

  // ------------------------------------------------------------------ queries

  /** The collector sees their own receipts; Finance sees all. */
  async getReceipt(context: RequestContext, receiptId: string) {
    const principal = await this.commands.principal(context);
    const id = target(receiptId);
    const receipt = await this.deps.repository.custody.receipt(id);
    const collector =
      receipt !== null &&
      principal.kind === 'account' &&
      receipt.collector === principal.subject &&
      principal.permissions.includes(COLLECT_PERMISSION);
    const finance = principal.permissions.includes(FINANCE_READ_PERMISSION);
    if (!receipt || !(collector || finance)) throw new BillingApplicationError('NOT_FOUND');
    return receiptView(receipt, await this.deps.repository.custody.reversalFor(id));
  }

  /** The holder sees their own handovers; Finance sees all. */
  async getHandover(context: RequestContext, handoverId: string) {
    const principal = await this.commands.principal(context);
    const id = target(handoverId);
    const view = await this.deps.repository.custody.handover(id);
    const holder =
      view !== null &&
      principal.kind === 'account' &&
      view.handover.holder === principal.subject &&
      principal.permissions.includes(COLLECT_PERMISSION);
    const finance = principal.permissions.includes(FINANCE_READ_PERMISSION);
    if (!view || !(holder || finance)) throw new BillingApplicationError('NOT_FOUND');
    return handoverView(view);
  }

  /** The technician's own custody position (what they hold for the company). */
  async myCustody(context: RequestContext) {
    const principal = accountOnly(await this.commands.permitted(context, COLLECT_PERMISSION));
    return holderPositionView(await this.deps.repository.custody.holderPosition(principal.subject));
  }

  async holderCustody(context: RequestContext, holder: string) {
    await this.commands.permitted(context, FINANCE_READ_PERMISSION);
    return holderPositionView(await this.deps.repository.custody.holderPosition(target(holder)));
  }

  /** Finance's invariant report over Billing's own cash/custody/treasury facts. */
  async reconciliation(context: RequestContext) {
    await this.commands.permitted(context, FINANCE_READ_PERMISSION);
    return reconciliationView(
      await this.deps.repository.custody.reconciliationReport(this.deps.clock.now()),
    );
  }
}
