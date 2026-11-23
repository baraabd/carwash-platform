import {
  DispatchError,
  accept,
  assertOpen,
  assertRevision,
  createOffer,
  createTask,
  decideEligibility,
  decline,
  expire,
  isDue,
  markAssigned,
  markOffered,
  markUnassigned,
  offerTtlSeconds,
  uuid,
  withdraw,
  type AssignmentState,
  type AssignmentStatus,
  type DeclineReason,
  type EligibilityVerdict,
  type OfferState,
  type ResourceObservation,
  type TaskState,
  type WithdrawReason,
} from '../domain';
import type {
  Clock,
  DispatchReadModel,
  DispatchTransaction,
  DispatchUnitOfWork,
  IdGenerator,
  IdempotentResult,
  RequestMeta,
  WorkforceCapacity,
} from '../ports';
import {
  OPERATIONS_DISPATCH,
  WORK_EXECUTE,
  WORK_READ,
  actorKey,
  hasScope,
  isOperations,
  requirePermission,
} from './authorization';
import { Effects } from './effects';
import { assertIdempotencyKey, revision, runIdempotent, type Outcome } from './idempotency';

export { IDEMPOTENCY_RETENTION_MS } from './idempotency';
export { eventActor } from './effects';

export interface CommandResult<T> {
  readonly value: T;
  /** True when an earlier identical request (same key and body) produced it. */
  readonly replayed: boolean;
}

export interface AssignmentView {
  readonly assignment: AssignmentState;
  /**
   * Operations results: the current (OFFERED or ACCEPTED) offer, if any.
   * Technician results: the offer the technician acted on, in its current state.
   */
  readonly offer: OfferState | null;
  /** Operations: the live task (CLOSED included). Technician: the task of their offer. */
  readonly task: TaskState | null;
}

export interface OfferInput {
  readonly expectedRevision: number;
  readonly resourceId: string;
  readonly technicianSubject: string;
  readonly ttlSeconds?: number;
}

const MAX_QUERY_SPAN_MS = 31 * 24 * 3_600_000;

/** A newer INELIGIBLE watermark overrides an older eligible read. */
function stillEligible(verdict: EligibilityVerdict, observed: ResourceObservation | null): boolean {
  return (
    verdict.eligible &&
    !(
      observed !== null &&
      observed.eligibility === 'INELIGIBLE' &&
      observed.revision > verdict.eligibilityRevision
    )
  );
}

/**
 * Dispatch application service: commands and queries over assignments/offers.
 *
 * Every mutation runs in one local transaction that also appends its outbox
 * events and audit rows. Decisions are made on rows read under FOR UPDATE in
 * the lock order documented on DispatchTransaction. Workforce eligibility is
 * read over HTTP BEFORE the transaction (never while holding row locks); the
 * transaction then re-checks the pushed eligibility watermark under a shared
 * per-resource lock taken BEFORE the assignment lock, which serialises
 * against the eligibility consumer (exclusive resource lock, then assignments).
 *
 * `workforce` is null in processes that never offer or accept (the expiry
 * worker); offering or accepting there fails closed as unavailable.
 */
export class DispatchService {
  private readonly effects: Effects;

  constructor(
    private readonly uow: DispatchUnitOfWork,
    private readonly read: DispatchReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly workforce: WorkforceCapacity | null = null,
  ) {
    this.effects = new Effects(ids);
  }

  // ---------------------------------------------------------------- queries

  async getAssignment(meta: RequestMeta, id: string): Promise<AssignmentView> {
    requirePermission(meta.actor, OPERATIONS_DISPATCH);
    const assignment = await this.read.findAssignment(uuid(id, 'assignmentId'));
    if (!assignment) throw notFound();
    return this.current(assignment);
  }

  /** Operations, or a service with `dispatch.assignment.read` (e.g. Booking display). */
  async getAssignmentByBooking(meta: RequestMeta, bookingId: string): Promise<AssignmentView> {
    if (!isOperations(meta.actor) && !hasScope(meta.actor, 'dispatch.assignment.read')) {
      throw new DispatchError('FORBIDDEN', 'Permission denied.');
    }
    const assignment = await this.read.findAssignmentByBooking(uuid(bookingId, 'bookingId'));
    if (!assignment) throw notFound();
    return this.current(assignment);
  }

  async listAssignments(
    meta: RequestMeta,
    query: {
      readonly zoneId: string;
      readonly from: Date;
      readonly to: Date;
      readonly status: AssignmentStatus | null;
    },
  ): Promise<AssignmentState[]> {
    requirePermission(meta.actor, OPERATIONS_DISPATCH);
    const span = query.to.getTime() - query.from.getTime();
    if (!(span > 0) || span > MAX_QUERY_SPAN_MS) {
      throw new DispatchError('INVALID_INPUT', 'from/to must span between 1 ms and 31 days.');
    }
    return this.read.listAssignments({ ...query, zoneId: uuid(query.zoneId, 'zoneId') });
  }

  async listMyOffers(
    meta: RequestMeta,
  ): Promise<Array<{ readonly offer: OfferState; readonly assignment: AssignmentState }>> {
    const user = requirePermission(meta.actor, WORK_READ);
    return this.read.listTechnicianOffers(user.subject, this.clock.now());
  }

  // ------------------------------------------------------ operations commands

  async offer(
    meta: RequestMeta,
    assignmentId: string,
    input: OfferInput,
    idempotencyKey: string | undefined,
  ): Promise<CommandResult<AssignmentView>> {
    requirePermission(meta.actor, OPERATIONS_DISPATCH);
    const id = uuid(assignmentId, 'assignmentId');
    const normalized = normalizeOffer(input);
    assertIdempotencyKey(idempotencyKey);
    const verdict = await this.eligibilityFor(id, normalized.resourceId, meta);
    return this.command(meta, 'offer', id, idempotencyKey, normalized, async (tx, now) => {
      const observed = await tx.readResourceObservation(normalized.resourceId);
      return this.withAssignment(
        tx,
        id,
        normalized.expectedRevision,
        now,
        meta,
        async (current) => {
          if (current.assignment.status === 'ASSIGNED') {
            throw new DispatchError('ASSIGNMENT_ALREADY_ASSIGNED', 'The job is already assigned.');
          }
          if (!stillEligible(verdict, observed)) throw ineligible();
          return this.placeOffer(tx, current.assignment, normalized, now, meta);
        },
      );
    });
  }

  /** Withdraws the live or accepted offer and offers the job to another resource. */
  async reassign(
    meta: RequestMeta,
    assignmentId: string,
    input: OfferInput,
    idempotencyKey: string | undefined,
  ): Promise<CommandResult<AssignmentView>> {
    requirePermission(meta.actor, OPERATIONS_DISPATCH);
    const id = uuid(assignmentId, 'assignmentId');
    const normalized = normalizeOffer(input);
    assertIdempotencyKey(idempotencyKey);
    const verdict = await this.eligibilityFor(id, normalized.resourceId, meta);
    return this.command(meta, 'reassign', id, idempotencyKey, normalized, async (tx, now) => {
      const observed = await tx.readResourceObservation(normalized.resourceId);
      return this.withAssignment(
        tx,
        id,
        normalized.expectedRevision,
        now,
        meta,
        async (current) => {
          if (!stillEligible(verdict, observed)) throw ineligible();
          const released = await this.releaseCurrent(tx, current, 'REASSIGNED', now, meta);
          return this.placeOffer(tx, released, normalized, now, meta);
        },
      );
    });
  }

  /** Takes the job back to UNASSIGNED (withdraws the live or accepted offer). */
  async unassign(
    meta: RequestMeta,
    assignmentId: string,
    input: { readonly expectedRevision: number },
    idempotencyKey: string | undefined,
  ): Promise<CommandResult<AssignmentView>> {
    requirePermission(meta.actor, OPERATIONS_DISPATCH);
    const id = uuid(assignmentId, 'assignmentId');
    const body = { expectedRevision: revision(input.expectedRevision) };
    return this.command(meta, 'unassign', id, idempotencyKey, body, (tx, now) =>
      this.withAssignment(tx, id, body.expectedRevision, now, meta, async (current) => {
        await this.releaseCurrent(tx, current, 'UNASSIGNED', now, meta);
        return { kind: 'DONE', result: { resultType: 'ASSIGNMENT', resultId: id } };
      }),
    );
  }

  // ------------------------------------------------------ technician commands

  /**
   * Accepts the technician's own live offer. Workforce eligibility of the
   * offered resource is re-read first (an offer may be minutes old); a
   * resource that is no longer eligible gets its offer withdrawn and the job
   * returns to operations. Acceptance creates the task in the same transaction.
   */
  async acceptOffer(
    meta: RequestMeta,
    offerId: string,
    idempotencyKey: string | undefined,
  ): Promise<CommandResult<AssignmentView>> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const id = uuid(offerId, 'offerId');
    assertIdempotencyKey(idempotencyKey);
    const seen = await this.read.findOffer(id);
    if (!seen || seen.technicianSubject !== user.subject) throw offerNotFound();
    let verdict: EligibilityVerdict | null = null;
    if (seen.status === 'OFFERED' && !isDue(seen, this.clock.now())) {
      verdict = await this.eligibilityFor(seen.assignmentId, seen.resourceId, meta);
    }
    return this.command(meta, 'accept', id, idempotencyKey, {}, (tx, now) =>
      this.withOwnOffer(tx, id, user.subject, now, meta, async (assignment, offer, observed) => {
        if (offer.status === 'ACCEPTED' && assignment.status === 'ASSIGNED') {
          // Accepting the offer one already holds is a natural replay.
          return { kind: 'DONE', result: { resultType: 'OFFER', resultId: offer.id } };
        }
        if (offer.status === 'OFFERED' && verdict === null) {
          // The offer became live/undue between the pre-read and the lock; retry re-reads.
          throw new DispatchError('OFFER_NOT_LIVE', 'The offer changed; refetch it.');
        }
        if (offer.status === 'OFFERED' && verdict !== null && !stillEligible(verdict, observed)) {
          await this.withdrawForIneligibility(tx, assignment, offer, now, meta);
          return { kind: 'REFUSED', error: ineligible() };
        }
        const accepted = accept(offer, now);
        const assigned = markAssigned(assignment, accepted, now);
        await tx.updateOffer(accepted, offer.version);
        // RESOURCE_BUSY from the exclusion constraint rolls everything back.
        await tx.updateAssignment(assigned, assignment.version);
        const task = createTask({
          id: this.ids.next(),
          assignmentId: assigned.id,
          offerId: accepted.id,
          bookingId: assigned.bookingId,
          resourceId: accepted.resourceId,
          technicianSubject: accepted.technicianSubject,
          now,
        });
        await tx.insertTask(task);
        await this.effects.assignmentChanged(tx, assigned, meta);
        await this.effects.taskProgressed(tx, task, 'accepted', meta);
        await this.effects.audit(
          tx,
          meta,
          'offer.accepted',
          { type: 'OFFER', id: offer.id },
          {
            assignmentId: assignment.id,
            resourceId: offer.resourceId,
            taskId: task.id,
            eligibilityRevision:
              verdict !== null && verdict.eligible ? verdict.eligibilityRevision : null,
          },
        );
        return { kind: 'DONE', result: { resultType: 'OFFER', resultId: offer.id } };
      }),
    );
  }

  async declineOffer(
    meta: RequestMeta,
    offerId: string,
    reason: DeclineReason,
    note: string | null,
    idempotencyKey: string | undefined,
  ): Promise<CommandResult<AssignmentView>> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const id = uuid(offerId, 'offerId');
    const body = note === null ? { reason } : { reason, note };
    return this.command(meta, 'decline', id, idempotencyKey, body, (tx, now) =>
      this.withOwnOffer(tx, id, user.subject, now, meta, async (assignment, offer) => {
        const declined = decline(offer, reason, now, note);
        const unassigned = markUnassigned(assignment, now);
        await tx.updateOffer(declined, offer.version);
        await tx.updateAssignment(unassigned, assignment.version);
        await this.effects.assignmentChanged(tx, unassigned, meta);
        await this.effects.audit(
          tx,
          meta,
          'offer.declined',
          { type: 'OFFER', id: offer.id },
          { assignmentId: assignment.id, reason, withNote: note !== null },
        );
        return { kind: 'DONE', result: { resultType: 'OFFER', resultId: offer.id } };
      }),
    );
  }

  // ----------------------------------------------------------------- system

  /**
   * Expires due offers. Stateless and safe in any number of replicas: each
   * assignment is locked with SKIP LOCKED and the deadline is re-checked under
   * the lock, so a stalled or duplicate worker cannot double-expire.
   */
  async expireDue(correlationId: string, limit: number): Promise<{ readonly offers: number }> {
    const now = this.clock.now();
    const meta: RequestMeta = {
      actor: { kind: 'SYSTEM', component: 'offer-expiry' },
      correlationId,
    };
    let offers = 0;
    for (const assignmentId of await this.read.assignmentsWithDueOffers(now, limit)) {
      offers += await this.uow.run(async (tx) => {
        const assignment = await tx.lockAssignment(assignmentId, { skipLocked: true });
        if (!assignment) return 0;
        const offer = await tx.lockCurrentOffer(assignment.id);
        if (!offer || !isDue(offer, now)) return 0;
        await this.recordExpiry(tx, assignment, offer, now, meta);
        return 1;
      });
    }
    return { offers };
  }

  // --------------------------------------------------------------- internals

  private async command(
    meta: RequestMeta,
    operation: string,
    target: string,
    key: string | undefined,
    body: unknown,
    work: (tx: DispatchTransaction, now: Date) => Promise<Outcome>,
  ): Promise<CommandResult<AssignmentView>> {
    const now = this.clock.now();
    const { result, replayed } = await runIdempotent(
      this.uow,
      meta,
      { operation, target },
      key,
      body,
      (tx) => work(tx, now),
    );
    return { value: await this.view(result), replayed };
  }

  /**
   * Reads Workforce for the job's window. Unknown assignments are reported as
   * not found before any remote call; Workforce failure is 503, never "eligible".
   */
  private async eligibilityFor(
    assignmentId: string,
    resourceId: string,
    meta: RequestMeta,
  ): Promise<EligibilityVerdict> {
    const assignment = await this.read.findAssignment(assignmentId);
    if (!assignment) throw notFound();
    if (this.workforce === null) {
      throw new DispatchError('ELIGIBILITY_UNAVAILABLE', 'Workforce eligibility is unavailable.');
    }
    const job = {
      zoneId: assignment.zoneId,
      startsAt: assignment.startsAt,
      endsAt: assignment.endsAt,
    };
    const resource = await this.workforce.findResource(job, resourceId, meta.correlationId);
    return decideEligibility(job, resource, await this.read.findResourceObservation(resourceId));
  }

  private async current(assignment: AssignmentState): Promise<AssignmentView> {
    return {
      assignment,
      offer: await this.read.findCurrentOffer(assignment.id),
      task: await this.read.findLiveTask(assignment.id),
    };
  }

  /** Replays re-read the CURRENT state of what the original command produced. */
  private async view(result: IdempotentResult): Promise<AssignmentView> {
    if (result.resultType === 'OFFER') {
      const offer = await this.read.findOffer(result.resultId);
      const assignment = offer ? await this.read.findAssignment(offer.assignmentId) : null;
      if (!offer || !assignment) throw offerNotFound();
      return { assignment, offer, task: await this.read.findTaskByOffer(offer.id) };
    }
    if (result.resultType === 'TASK') throw new Error('TASK_RESULT_IN_DISPATCH_VIEW');
    const assignment = await this.read.findAssignment(result.resultId);
    if (!assignment) throw notFound();
    return this.current(assignment);
  }

  /** Locks the assignment, checks the client's revision and settles a due offer first. */
  private async withAssignment(
    tx: DispatchTransaction,
    id: string,
    expectedRevision: number,
    now: Date,
    meta: RequestMeta,
    work: (current: {
      readonly assignment: AssignmentState;
      readonly offer: OfferState | null;
    }) => Promise<Outcome>,
  ): Promise<Outcome> {
    const locked = await tx.lockAssignment(id);
    if (!locked) throw notFound();
    assertRevision(locked, expectedRevision);
    assertOpen(locked);
    let assignment = locked;
    let offer = await tx.lockCurrentOffer(id);
    if (offer && isDue(offer, now)) {
      assignment = await this.recordExpiry(tx, assignment, offer, now, meta);
      offer = null;
    }
    return work({ assignment, offer });
  }

  /**
   * Locks the technician's own offer. Another technician's offer is reported
   * as not found, never as forbidden, so offer ids cannot be probed. The
   * shared lock on the offered resource's eligibility watermark is taken
   * before the assignment lock (documented lock order).
   */
  private async withOwnOffer(
    tx: DispatchTransaction,
    offerId: string,
    subject: string,
    now: Date,
    meta: RequestMeta,
    work: (
      assignment: AssignmentState,
      offer: OfferState,
      observed: ResourceObservation | null,
    ) => Promise<Outcome>,
  ): Promise<Outcome> {
    const seen = await tx.readOffer(offerId);
    if (!seen || seen.technicianSubject !== subject) throw offerNotFound();
    const observed = await tx.readResourceObservation(seen.resourceId);
    const assignment = await tx.lockAssignment(seen.assignmentId);
    const offer = await tx.lockOffer(offerId);
    if (!assignment || !offer || offer.technicianSubject !== subject) throw offerNotFound();
    if (isDue(offer, now)) {
      await this.recordExpiry(tx, assignment, offer, now, meta);
      return {
        kind: 'REFUSED',
        error: new DispatchError('OFFER_EXPIRED', 'The offer has expired.'),
      };
    }
    return work(assignment, offer, observed);
  }

  private async placeOffer(
    tx: DispatchTransaction,
    assignment: AssignmentState,
    input: Required<OfferInput>,
    now: Date,
    meta: RequestMeta,
  ): Promise<Outcome> {
    const offered = markOffered(assignment, now);
    const offer = createOffer({
      id: this.ids.next(),
      assignmentId: assignment.id,
      resourceId: input.resourceId,
      technicianSubject: input.technicianSubject,
      ttlSeconds: input.ttlSeconds,
      jobEndsAt: assignment.endsAt,
      createdBy: actorKey(meta.actor),
      now,
    });
    await tx.updateAssignment(offered, assignment.version);
    await tx.insertOffer(offer);
    await this.effects.assignmentChanged(tx, offered, meta);
    await this.effects.audit(
      tx,
      meta,
      'offer.created',
      { type: 'OFFER', id: offer.id },
      {
        assignmentId: assignment.id,
        resourceId: offer.resourceId,
        technicianSubject: offer.technicianSubject,
        expiresAt: offer.expiresAt.toISOString(),
      },
    );
    return { kind: 'DONE', result: { resultType: 'ASSIGNMENT', resultId: assignment.id } };
  }

  /**
   * Withdraws the current offer (live or accepted), ends the live task and
   * returns the job to UNASSIGNED. Completed work (a CLOSED task) is never
   * taken away.
   */
  private async releaseCurrent(
    tx: DispatchTransaction,
    current: { readonly assignment: AssignmentState; readonly offer: OfferState | null },
    reason: Extract<WithdrawReason, 'REASSIGNED' | 'UNASSIGNED'>,
    now: Date,
    meta: RequestMeta,
  ): Promise<AssignmentState> {
    const { assignment, offer } = current;
    if (assignment.status === 'UNASSIGNED') return assignment;
    const live = await tx.lockLiveTask(assignment.id);
    if (live?.stage === 'CLOSED') {
      throw new DispatchError('TASK_CLOSED', 'The job was completed and cannot be taken back.');
    }
    if (offer) await tx.updateOffer(withdraw(offer, reason, now), offer.version);
    const ended = await this.effects.endLiveTask(tx, assignment.id, reason, now, meta);
    const unassigned = markUnassigned(assignment, now);
    await tx.updateAssignment(unassigned, assignment.version);
    await this.effects.assignmentChanged(tx, unassigned, meta);
    await this.effects.audit(
      tx,
      meta,
      reason === 'REASSIGNED' ? 'assignment.reassigned' : 'assignment.unassigned',
      { type: 'ASSIGNMENT', id: assignment.id },
      {
        previousStatus: assignment.status,
        withdrawnOfferId: offer?.id ?? null,
        previousResourceId: assignment.resourceId,
        endedTaskId: ended?.id ?? null,
        endedTaskStage: live?.stage ?? null,
      },
    );
    return unassigned;
  }

  private async withdrawForIneligibility(
    tx: DispatchTransaction,
    assignment: AssignmentState,
    offer: OfferState,
    now: Date,
    meta: RequestMeta,
  ): Promise<void> {
    await tx.updateOffer(withdraw(offer, 'RESOURCE_INELIGIBLE', now), offer.version);
    const unassigned = markUnassigned(assignment, now);
    await tx.updateAssignment(unassigned, assignment.version);
    await this.effects.assignmentChanged(tx, unassigned, meta);
    await this.effects.audit(
      tx,
      meta,
      'offer.withdrawn-ineligible',
      { type: 'OFFER', id: offer.id },
      { assignmentId: assignment.id, resourceId: offer.resourceId },
    );
  }

  private async recordExpiry(
    tx: DispatchTransaction,
    assignment: AssignmentState,
    offer: OfferState,
    now: Date,
    meta: RequestMeta,
  ): Promise<AssignmentState> {
    const expired = expire(offer, now);
    const unassigned = markUnassigned(assignment, now);
    await tx.updateOffer(expired, offer.version);
    await tx.updateAssignment(unassigned, assignment.version);
    await this.effects.assignmentChanged(tx, unassigned, meta);
    // The deadline is the fact; when it was noticed is the audit row's own time.
    await this.effects.audit(
      tx,
      meta,
      'offer.expired',
      { type: 'OFFER', id: offer.id },
      { assignmentId: assignment.id, expiredAt: offer.expiresAt.toISOString() },
    );
    return unassigned;
  }
}

function notFound(): DispatchError {
  return new DispatchError('ASSIGNMENT_NOT_FOUND', 'The assignment was not found.');
}

function offerNotFound(): DispatchError {
  return new DispatchError('OFFER_NOT_FOUND', 'The offer was not found.');
}

function ineligible(): DispatchError {
  return new DispatchError('RESOURCE_INELIGIBLE', 'The resource is not eligible for this job.');
}

function normalizeOffer(input: OfferInput): Required<OfferInput> {
  return {
    expectedRevision: revision(input.expectedRevision),
    resourceId: uuid(input.resourceId, 'resourceId'),
    technicianSubject: uuid(input.technicianSubject, 'technicianSubjectId'),
    ttlSeconds: offerTtlSeconds(input.ttlSeconds),
  };
}
