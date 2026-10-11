import {
  CASE_KINDS,
  CaseRuleError,
  KIND_POLICIES,
  actionPolicy,
  assertResendable,
  bookingEligibility,
  caseSubject,
  caseSummary,
  decisionInput,
  oneOf,
  outcomeStatuses,
  ownerCommandKey,
  paymentEligibility,
  planApproval,
  planDecision,
  reconciliationOutcome,
  type CaseAction,
  type CaseKind,
  type CaseStatus,
  type CaseSubject,
  type DecisionInput,
  type OwnerOutcome,
} from '../domain';
import {
  CaseConflict,
  OwnerReadError,
  type BillingOwner,
  type BookingOwner,
  type BookingState,
  type CaseDetail,
  type CaseReader,
  type CaseRecord,
  type CaseStore,
  type CaseUnitOfWork,
  type Clock,
  type DecisionRecord,
  type IdSource,
  type ObligationState,
  type OnBehalfOf,
  type OwnerRequest,
  type SubjectSnapshot,
  type VerifiedSession,
} from '../ports';
import { requireApprove, requireDecide, requireOpen, requireRead } from './access';
import { SupportApplicationError, fingerprint, idempotencyKey, object, uuid } from './errors';
import { caseOpenedEvent, caseStatusChangedEvent } from './events';

export interface CaseCommandDeps {
  readonly store: CaseStore;
  readonly reader: CaseReader;
  readonly billing: BillingOwner;
  readonly booking: BookingOwner;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** A resend inside this window after the last one is refused, never doubled. */
  readonly executionLeaseMs: number;
}

/** Owner refusals that, on a RESEND, may only mean "already done": verified by reading. */
const STALE_ON_RESEND = [
  'REVISION_CONFLICT',
  'ATTEMPT_NOT_OPEN',
  'IDEMPOTENCY_CONFLICT',
  'ALREADY_UNKNOWN',
];

/**
 * The exception-case process manager.
 *
 * Every command first records the staff decision locally (with its reason and
 * evidence, one ACID transaction with the audit event and the outbox row),
 * then asks the OWNER to carry it out with the decider's own authority and a
 * key derived from the decision, then records the owner's answer. A crash or
 * timeout between those steps leaves the decision EXECUTING or
 * OUTCOME_UNKNOWN, and the only way forward is resending the SAME command.
 */
export class CaseCommands {
  constructor(private readonly deps: CaseCommandDeps) {}

  /* --------------------------------- open --------------------------------- */

  async open(
    session: VerifiedSession,
    auth: OnBehalfOf,
    rawKey: unknown,
    body: unknown,
  ): Promise<{ readonly created: boolean; readonly detail: CaseDetail }> {
    const input = object(body, ['kind', 'subject', 'summary']);
    const kind = oneOf(input.kind, CASE_KINDS, 'INVALID_KIND');
    requireOpen(session, kind);
    const key = idempotencyKey(rawKey);
    const subject = caseSubject(kind, input.subject);
    const summary = caseSummary(input.summary);
    const print = fingerprint({ kind, subject, summary });

    const replay = await this.deps.store.transaction((uow) =>
      uow.caseByOpenKey(session.subject, key),
    );
    if (replay) return { created: false, detail: await this.replayOpen(replay, print) };

    const snapshot = await this.snapshot(kind, subject, auth);
    const now = this.deps.clock.now();
    const id = this.deps.ids.uuid();
    const outcome = await this.deps.store
      .transaction(async (uow) => {
        const raced = await uow.caseByOpenKey(session.subject, key);
        if (raced) return { replay: raced };
        const active = await uow.activeCaseFor(kind, subject);
        if (active) throw new SupportApplicationError('CASE_ALREADY_OPEN', { caseId: active.id });
        const record: CaseRecord = {
          id,
          kind,
          status: 'OPEN',
          subject,
          summary,
          snapshot,
          openedBy: session.subject,
          openedAt: now,
          revision: 1,
          updatedAt: now,
          openKey: key,
          openFingerprint: print,
        };
        await uow.insertCase(record);
        await uow.appendEvent({
          id: this.deps.ids.uuid(),
          caseId: id,
          occurredAt: now,
          actorSubject: session.subject,
          action: 'case.opened',
          decisionNo: null,
          fromStatus: null,
          toStatus: 'OPEN',
          outcome: null,
          correlationId: auth.correlationId,
        });
        await uow.enqueue(
          caseOpenedEvent(
            { kind, subjectType: subject.type, subjectId: subject.id, status: 'OPEN' },
            this.eventContext(id, 1, now, session, auth),
          ),
        );
        return { replay: null };
      })
      .catch(async (error: unknown) => {
        // Two identical requests raced past the replay check: the loser replays.
        if (error instanceof CaseConflict && error.constraint === 'OPEN_KEY') {
          const winner = await this.deps.store.transaction((uow) =>
            uow.caseByOpenKey(session.subject, key),
          );
          if (winner) return { replay: winner };
        }
        if (error instanceof CaseConflict && error.constraint === 'ACTIVE_SUBJECT')
          throw new SupportApplicationError('CASE_ALREADY_OPEN');
        throw error;
      });
    if (outcome.replay)
      return { created: false, detail: await this.replayOpen(outcome.replay, print) };
    return { created: true, detail: await this.detail(id) };
  }

  private async replayOpen(record: CaseRecord, print: string): Promise<CaseDetail> {
    if (record.openFingerprint !== print) throw new SupportApplicationError('IDEMPOTENCY_CONFLICT');
    return this.detail(record.id);
  }

  /* -------------------------------- decide -------------------------------- */

  async decide(
    session: VerifiedSession,
    auth: OnBehalfOf,
    rawCaseId: unknown,
    rawKey: unknown,
    body: unknown,
  ): Promise<CaseDetail> {
    const caseId = uuid(rawCaseId);
    const current = await this.deps.reader.detail(caseId);
    if (!current) throw new SupportApplicationError('NOT_FOUND');
    const kind = current.record.kind;
    requireRead(session, kind);
    const raw = object(body, ['action', 'reason', 'evidence', 'amount', 'window']);
    const action = oneOf(raw.action, actionsOf(kind), 'ACTION_NOT_ALLOWED_FOR_KIND');
    requireDecide(session, kind, action);
    const key = idempotencyKey(rawKey);
    const now = this.deps.clock.now();
    const decision = decisionInput(kind, raw, now);
    const print = fingerprint({ caseId, decision });

    const existing = await this.deps.store.transaction((uow) =>
      uow.decisionByKey(caseId, session.subject, key),
    );
    if (existing) return this.replayDecision(existing, print, session, auth);

    // A decision the owner carries out at once is frozen now, from the owner's
    // CURRENT state, so every resend is byte-identical.
    // Fail fast before asking the owner anything.
    planDecision({ kind, caseStatus: current.record.status, action });
    const policy = actionPolicy(kind, action);
    const request =
      policy.operation !== null && policy.approval === 'SINGLE'
        ? await this.ownerRequest(kind, current.record.subject, decision, caseId, auth, () =>
            nextDecisionNo(current.decisions),
          )
        : null;

    const recorded = await this.deps.store.transaction(async (uow) => {
      const raced = await uow.decisionByKey(caseId, session.subject, key);
      if (raced) return { raced };
      const record = await this.locked(uow, caseId);
      const plan = planDecision({ kind, caseStatus: record.status, action });
      const decisions = await uow.decisions(caseId);
      const decisionNo = nextDecisionNo(decisions);
      if (request && request.key !== ownerCommandKey(caseId, decisionNo))
        throw new SupportApplicationError('CASE_CHANGED');
      const blocked = decisions.find((d) => d.status === 'BLOCKED_ON_OWNER');
      if (blocked) {
        await this.fencedUpdate(uow, blocked, { status: 'SUPERSEDED' });
        await this.event(
          uow,
          record,
          session,
          auth,
          now,
          'decision.superseded',
          blocked.decisionNo,
          record.status,
          null,
        );
      }
      await uow.insertDecision({
        caseId,
        decisionNo,
        action,
        reasonCode: decision.reason.code,
        reasonNote: decision.reason.note,
        evidence: decision.evidence,
        amount: decision.amount,
        window: decision.window,
        status: plan.decisionStatus,
        decidedBy: session.subject,
        decidedAt: now,
        idempotencyKey: key,
        fingerprint: print,
        approvedBy: null,
        approvedAt: null,
        approvalNote: null,
        approvalKey: null,
        ownerRequest: request,
        ownerHttpStatus: null,
        ownerCode: null,
        ownerState: null,
        executionAttempts: 0,
        executionFence: 0,
        lastExecutedAt: null,
      });
      await this.transition(
        uow,
        record,
        plan.caseStatus,
        now,
        session,
        auth,
        'decision.recorded',
        decisionNo,
        action,
        null,
      );
      return { raced: null, decisionNo, execute: plan.execute };
    });
    if (recorded.raced) return this.replayDecision(recorded.raced, print, session, auth);
    if (recorded.execute) await this.execute(caseId, recorded.decisionNo, session, auth);
    return this.detail(caseId);
  }

  private async replayDecision(
    decision: DecisionRecord,
    print: string,
    session: VerifiedSession,
    auth: OnBehalfOf,
  ): Promise<CaseDetail> {
    if (decision.fingerprint !== print) throw new SupportApplicationError('IDEMPOTENCY_CONFLICT');
    // A retried request after a lost answer resumes the same owner command.
    if (decision.status === 'EXECUTING' && !this.leased(decision))
      await this.execute(decision.caseId, decision.decisionNo, session, auth);
    return this.detail(decision.caseId);
  }

  /* -------------------------------- approve ------------------------------- */

  async approve(
    session: VerifiedSession,
    auth: OnBehalfOf,
    rawCaseId: unknown,
    rawDecisionNo: unknown,
    rawKey: unknown,
    body: unknown,
  ): Promise<CaseDetail> {
    const caseId = uuid(rawCaseId);
    const decisionNo = positive(rawDecisionNo);
    const current = await this.deps.reader.detail(caseId);
    if (!current) throw new SupportApplicationError('NOT_FOUND');
    requireRead(session, current.record.kind);
    requireApprove(session);
    const key = idempotencyKey(rawKey);
    const input = object(body, ['approve', 'note']);
    if (typeof input.approve !== 'boolean') throw new SupportApplicationError('REQUEST_INVALID');
    const approve = input.approve;
    const note = approvalNote(input.note);
    const decision = current.decisions.find((d) => d.decisionNo === decisionNo);
    if (!decision) throw new SupportApplicationError('NOT_FOUND');

    if (decision.approvalKey !== null) {
      if (decision.approvalKey !== key || decision.approvedBy !== session.subject)
        throw new CaseRuleError('CASE_NOT_AWAITING_APPROVAL');
      if (decision.status === 'EXECUTING' && !this.leased(decision))
        await this.execute(caseId, decisionNo, session, auth);
      return this.detail(caseId);
    }

    planApproval({
      caseStatus: current.record.status,
      decisionStatus: decision.status,
      proposer: decision.decidedBy,
      approver: session.subject,
      approve,
    });
    const request = approve
      ? await this.ownerRequest(
          current.record.kind,
          current.record.subject,
          storedInput(decision),
          caseId,
          auth,
          () => decisionNo,
        )
      : null;
    const now = this.deps.clock.now();
    const execute = await this.deps.store.transaction(async (uow) => {
      const record = await this.locked(uow, caseId);
      const fresh = (await uow.decisions(caseId)).find((d) => d.decisionNo === decisionNo);
      if (!fresh) throw new SupportApplicationError('NOT_FOUND');
      const plan = planApproval({
        caseStatus: record.status,
        decisionStatus: fresh.status,
        proposer: fresh.decidedBy,
        approver: session.subject,
        approve,
      });
      await this.fencedUpdate(uow, fresh, {
        status: plan.decisionStatus,
        approvedBy: session.subject,
        approvedAt: now,
        approvalNote: note,
        approvalKey: key,
        ownerRequest: request,
      });
      await this.transition(
        uow,
        record,
        plan.caseStatus,
        now,
        session,
        auth,
        approve ? 'decision.approved' : 'decision.rejected',
        decisionNo,
        fresh.action,
        null,
      );
      return plan.execute;
    });
    if (execute) await this.execute(caseId, decisionNo, session, auth);
    return this.detail(caseId);
  }

  /* -------------------------------- resend -------------------------------- */

  /**
   * Re-sends an in-flight, unknown or owner-blocked decision with its frozen
   * request and key. The owner replays instead of acting twice.
   */
  async resend(
    session: VerifiedSession,
    auth: OnBehalfOf,
    rawCaseId: unknown,
    rawDecisionNo: unknown,
  ): Promise<CaseDetail> {
    const caseId = uuid(rawCaseId);
    const decisionNo = positive(rawDecisionNo);
    const current = await this.deps.reader.detail(caseId);
    if (!current) throw new SupportApplicationError('NOT_FOUND');
    requireRead(session, current.record.kind);
    const decision = current.decisions.find((d) => d.decisionNo === decisionNo);
    if (!decision) throw new SupportApplicationError('NOT_FOUND');
    requireDecide(session, current.record.kind, decision.action);
    assertResendable(decision.status);
    if (this.leased(decision)) throw new SupportApplicationError('EXECUTION_IN_PROGRESS');
    await this.execute(caseId, decisionNo, session, auth);
    return this.detail(caseId);
  }

  /* ------------------------------- execution ------------------------------ */

  private async execute(
    caseId: string,
    decisionNo: number,
    session: VerifiedSession,
    auth: OnBehalfOf,
  ): Promise<void> {
    const now = this.deps.clock.now();
    const claim = await this.deps.store.transaction(async (uow) => {
      const record = await this.locked(uow, caseId);
      const decision = (await uow.decisions(caseId)).find((d) => d.decisionNo === decisionNo);
      if (!decision) throw new SupportApplicationError('NOT_FOUND');
      assertResendable(decision.status);
      const request = decision.ownerRequest;
      if (!request) throw new Error('DECISION_WITHOUT_OWNER_REQUEST');
      const fence = decision.executionFence + 1;
      const attempt = decision.executionAttempts + 1;
      await this.fencedUpdate(uow, decision, {
        status: 'EXECUTING',
        executionFence: fence,
        executionAttempts: attempt,
        lastExecutedAt: now,
      });
      await this.transition(
        uow,
        record,
        'EXECUTING',
        now,
        session,
        auth,
        'execution.started',
        decisionNo,
        decision.action,
        `attempt-${attempt}`,
      );
      return { request, fence, attempt, action: decision.action };
    });

    let outcome = await this.owner(claim.request).execute(auth, claim.request);
    if (
      outcome.kind === 'REJECTED' &&
      claim.attempt > 1 &&
      claim.request.operation === 'billing.reconcile' &&
      STALE_ON_RESEND.includes(outcome.code)
    )
      outcome = await this.verifyReconciliation(auth, claim.request, claim.action, outcome);

    const finished = this.deps.clock.now();
    await this.deps.store.transaction(async (uow) => {
      const record = await this.locked(uow, caseId);
      const decision = (await uow.decisions(caseId)).find((d) => d.decisionNo === decisionNo);
      if (!decision) throw new SupportApplicationError('NOT_FOUND');
      const statuses = outcomeStatuses(outcome);
      // Stale-worker fencing: a later claim owns the result of this decision.
      const recorded = await uow.updateDecision(caseId, decisionNo, claim.fence, {
        status: statuses.decisionStatus,
        ownerHttpStatus: 'ownerStatus' in outcome ? outcome.ownerStatus : null,
        ownerCode: outcome.kind === 'APPLIED' ? null : outcome.code,
        ownerState: outcome.kind === 'APPLIED' ? outcome.ownerState : null,
      });
      if (!recorded) return;
      await this.transition(
        uow,
        record,
        statuses.caseStatus,
        finished,
        session,
        auth,
        'execution.finished',
        decisionNo,
        decision.action,
        outcome.kind === 'APPLIED'
          ? `APPLIED:${outcome.ownerState ?? ''}`
          : `${outcome.kind}:${outcome.code}`,
      );
    });
  }

  /**
   * After a resend the owner may refuse as "stale" because the FIRST send was
   * applied. Billing's own record decides: only if the attempt now has the
   * status this decision asked for is the decision APPLIED.
   */
  private async verifyReconciliation(
    auth: OnBehalfOf,
    request: OwnerRequest,
    action: CaseAction,
    refused: OwnerOutcome,
  ): Promise<OwnerOutcome> {
    const obligationId = request.body.obligationId;
    if (typeof obligationId !== 'string') return refused;
    let state: ObligationState | null;
    try {
      state = await this.deps.billing.obligation(auth, obligationId);
    } catch {
      return { kind: 'UNKNOWN', code: 'OWNER_UNAVAILABLE' };
    }
    const attempt = state?.attempts.find((a) => a.attemptId === request.targetId);
    if (attempt && attempt.status === reconciliationOutcome(action))
      return { kind: 'APPLIED', ownerStatus: 200, ownerState: attempt.status };
    return refused;
  }

  /* -------------------------------- owners -------------------------------- */

  private owner(request: OwnerRequest): BillingOwner | BookingOwner {
    return request.operation.startsWith('billing.') ? this.deps.billing : this.deps.booking;
  }

  /** The owner's CURRENT state of a subject, reduced to what a case may keep. */
  private async snapshot(
    kind: CaseKind,
    subject: CaseSubject,
    auth: OnBehalfOf,
  ): Promise<SubjectSnapshot> {
    const readAt = this.deps.clock.now().toISOString();
    if (subject.type === 'booking') {
      const booking = await this.readBooking(auth, subject.id);
      if (bookingEligibility(kind, booking.status))
        throw new SupportApplicationError('SUBJECT_NOT_ELIGIBLE', { reason: 'BOOKING_FINISHED' });
      return {
        owner: 'booking',
        readAt,
        state: {
          bookingRevision: booking.revision,
          bookingStatus: booking.status,
          confirmation: booking.confirmation,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
        },
      };
    }
    const obligationId = subject.parentId ?? subject.id;
    const obligation = await this.readObligation(auth, obligationId);
    const attempt =
      subject.type === 'billing.payment-attempt'
        ? obligation.attempts.find((a) => a.attemptId === subject.id)
        : undefined;
    if (subject.type === 'billing.payment-attempt' && !attempt)
      throw new SupportApplicationError('SUBJECT_NOT_FOUND');
    const ineligible = paymentEligibility(kind, {
      attemptStatus: attempt?.status ?? null,
      verified: obligation.verified,
    });
    if (ineligible)
      throw new SupportApplicationError('SUBJECT_NOT_ELIGIBLE', { reason: ineligible });
    return {
      owner: 'billing',
      readAt,
      state: {
        obligationRevision: obligation.revision,
        obligationStatus: obligation.status,
        financialStatus: obligation.financialStatus,
        currency: obligation.amount.currency,
        scale: obligation.amount.scale,
        amountMinor: obligation.amount.amountMinor,
        verifiedMinor: obligation.verified.amountMinor,
        outstandingMinor: obligation.outstanding.amountMinor,
        attemptStatus: attempt?.status ?? null,
        attemptMethod: attempt?.method ?? null,
        claimedMinor: attempt?.claimed.amountMinor ?? null,
      },
    };
  }

  /** Freezes the exact owner command for a decision from the owner's current revision. */
  private async ownerRequest(
    kind: CaseKind,
    subject: CaseSubject,
    decision: DecisionInput,
    caseId: string,
    auth: OnBehalfOf,
    decisionNo: () => number,
  ): Promise<OwnerRequest> {
    const policy = actionPolicy(kind, decision.action);
    const key = ownerCommandKey(caseId, decisionNo());
    switch (policy.operation) {
      case 'billing.reconcile': {
        const obligationId = subject.parentId;
        if (subject.type !== 'billing.payment-attempt' || !obligationId)
          throw new Error('RECONCILE_NEEDS_ATTEMPT');
        const obligation = await this.readObligation(auth, obligationId);
        return {
          operation: 'billing.reconcile',
          targetId: subject.id,
          key,
          body: {
            obligationId,
            expectedRevision: obligation.revision,
            outcome: reconciliationOutcome(decision.action),
            observedAmount: decision.action === 'MARK_UNKNOWN' ? null : decision.amount,
          },
        };
      }
      case 'billing.refund': {
        const obligationId = subject.parentId ?? subject.id;
        const obligation = await this.readObligation(auth, obligationId);
        return {
          operation: 'billing.refund',
          targetId: obligationId,
          key,
          body: {
            obligationId,
            expectedRevision: obligation.revision,
            amount: decision.amount,
            reasonCode: decision.reason.code,
          },
        };
      }
      case 'booking.cancel':
      case 'booking.reschedule': {
        const booking = await this.readBooking(auth, subject.id);
        return {
          operation: policy.operation,
          targetId: subject.id,
          key,
          body: {
            expectedRevision: booking.revision,
            reasonCode: decision.reason.code,
            ...(policy.operation === 'booking.reschedule' ? { window: decision.window } : {}),
          },
        };
      }
      case null:
        throw new Error('NO_OWNER_OPERATION');
    }
  }

  private async readObligation(auth: OnBehalfOf, obligationId: string): Promise<ObligationState> {
    const state = await this.ownerRead(() => this.deps.billing.obligation(auth, obligationId));
    if (!state) throw new SupportApplicationError('SUBJECT_NOT_FOUND');
    return state;
  }

  private async readBooking(auth: OnBehalfOf, bookingId: string): Promise<BookingState> {
    const state = await this.ownerRead(() => this.deps.booking.booking(auth, bookingId));
    if (!state) throw new SupportApplicationError('SUBJECT_NOT_FOUND');
    return state;
  }

  private async ownerRead<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof OwnerReadError)
        throw new SupportApplicationError(
          error.code === 'OWNER_FORBIDDEN' ? 'OWNER_FORBIDDEN' : 'OWNER_UNAVAILABLE',
        );
      throw error;
    }
  }

  /* ------------------------------- helpers -------------------------------- */

  private leased(decision: DecisionRecord): boolean {
    return (
      decision.lastExecutedAt !== null &&
      this.deps.clock.now().getTime() - decision.lastExecutedAt.getTime() <
        this.deps.executionLeaseMs
    );
  }

  private async locked(uow: CaseUnitOfWork, caseId: string): Promise<CaseRecord> {
    const record = await uow.lockCase(caseId);
    if (!record) throw new SupportApplicationError('NOT_FOUND');
    return record;
  }

  private async fencedUpdate(
    uow: CaseUnitOfWork,
    decision: DecisionRecord,
    patch: Parameters<CaseUnitOfWork['updateDecision']>[3],
  ): Promise<void> {
    const updated = await uow.updateDecision(
      decision.caseId,
      decision.decisionNo,
      decision.executionFence,
      patch,
    );
    if (!updated) throw new SupportApplicationError('EXECUTION_IN_PROGRESS');
  }

  private async transition(
    uow: CaseUnitOfWork,
    record: CaseRecord,
    to: CaseStatus,
    now: Date,
    session: VerifiedSession,
    auth: OnBehalfOf,
    action: string,
    decisionNo: number,
    caseAction: CaseAction,
    outcome: string | null,
  ): Promise<void> {
    await this.event(uow, record, session, auth, now, action, decisionNo, to, outcome);
    if (record.status === to) return;
    const revision = record.revision + 1;
    if (!(await uow.updateCase(record.id, record.revision, { status: to, updatedAt: now })))
      throw new SupportApplicationError('CASE_CHANGED');
    await uow.enqueue(
      caseStatusChangedEvent(
        {
          kind: record.kind,
          previousStatus: record.status,
          status: to,
          decisionNo,
          action: caseAction,
        },
        this.eventContext(record.id, revision, now, session, auth),
      ),
    );
    Object.assign(record, { status: to, revision, updatedAt: now });
  }

  private async event(
    uow: CaseUnitOfWork,
    record: CaseRecord,
    session: VerifiedSession,
    auth: OnBehalfOf,
    now: Date,
    action: string,
    decisionNo: number,
    to: CaseStatus,
    outcome: string | null,
  ): Promise<void> {
    await uow.appendEvent({
      id: this.deps.ids.uuid(),
      caseId: record.id,
      occurredAt: now,
      actorSubject: session.subject,
      action,
      decisionNo,
      fromStatus: record.status,
      toStatus: to,
      outcome,
      correlationId: auth.correlationId,
    });
  }

  private eventContext(
    caseId: string,
    revision: number,
    now: Date,
    session: VerifiedSession,
    auth: OnBehalfOf,
  ) {
    return {
      eventId: this.deps.ids.uuid(),
      occurredAt: now,
      correlationId: auth.correlationId,
      actorSubject: session.subject,
      caseId,
      revision,
    };
  }

  private async detail(caseId: string): Promise<CaseDetail> {
    const detail = await this.deps.reader.detail(caseId);
    if (!detail) throw new SupportApplicationError('NOT_FOUND');
    return detail;
  }
}

function actionsOf(kind: CaseKind): readonly CaseAction[] {
  return Object.keys(KIND_ACTIONS[kind]) as CaseAction[];
}

const KIND_ACTIONS = Object.fromEntries(
  CASE_KINDS.map((kind) => [kind, KIND_POLICIES[kind].actions]),
) as Readonly<Record<CaseKind, Readonly<Partial<Record<CaseAction, unknown>>>>>;

function nextDecisionNo(decisions: readonly DecisionRecord[]): number {
  return decisions.reduce((max, d) => Math.max(max, d.decisionNo), 0) + 1;
}

function positive(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value))
    throw new SupportApplicationError('NOT_FOUND');
  return Number(value);
}

function approvalNote(value: unknown): string {
  if (typeof value !== 'string') throw new CaseRuleError('REASON_NOTE_REQUIRED');
  const note = value.trim();
  if (note.length < 10) throw new CaseRuleError('REASON_NOTE_REQUIRED');
  if (note.length > 500) throw new CaseRuleError('INVALID_REASON');
  return note;
}

function storedInput(decision: DecisionRecord): DecisionInput {
  return {
    action: decision.action,
    reason: { code: decision.reasonCode, note: decision.reasonNote },
    evidence: decision.evidence,
    amount: decision.amount,
    window: decision.window,
  };
}
