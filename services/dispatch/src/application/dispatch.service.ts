import type { EventActor } from '@carwash/event-contracts';
import {
  DISPATCH_ASSIGNMENT_CHANGED_V1,
  DISPATCH_EVENTS_EXCHANGE,
  DispatchError,
  accept,
  assertOpen,
  assertRevision,
  assignmentChangedEvent,
  createOffer,
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
  type OfferState,
  type WithdrawReason,
} from '../domain';
import type {
  Actor,
  Clock,
  DispatchReadModel,
  DispatchTransaction,
  DispatchUnitOfWork,
  IdGenerator,
  IdempotentResult,
  RequestMeta,
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
import { fingerprint } from './canonical-json';

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
}

export interface OfferInput {
  readonly expectedRevision: number;
  readonly resourceId: string;
  readonly technicianSubject: string;
  readonly ttlSeconds?: number;
}

/** Idempotency records are kept this long, then purged by the expiry worker. */
export const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 3_600_000;

const KEY = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_QUERY_SPAN_MS = 31 * 24 * 3_600_000;

type Outcome =
  | { readonly kind: 'DONE'; readonly result: IdempotentResult }
  /** Committed (e.g. an expiry was recorded) but the command itself is refused. */
  | { readonly kind: 'REFUSED'; readonly error: DispatchError };

export function eventActor(actor: Actor): EventActor {
  if (actor.kind === 'USER') return { kind: 'account', id: actor.subject };
  if (actor.kind === 'SERVICE') return { kind: 'service', id: actor.clientId };
  return { kind: 'system', id: null };
}

/**
 * Dispatch application service: commands and queries over assignments/offers.
 *
 * Every mutation runs in one local transaction that also appends its outbox
 * event and audit row. Decisions are made on rows read under FOR UPDATE in the
 * lock order documented on DispatchTransaction.
 */
export class DispatchService {
  constructor(
    private readonly uow: DispatchUnitOfWork,
    private readonly read: DispatchReadModel,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  // ---------------------------------------------------------------- queries

  async getAssignment(meta: RequestMeta, id: string): Promise<AssignmentView> {
    requirePermission(meta.actor, OPERATIONS_DISPATCH);
    const assignment = await this.read.findAssignment(uuid(id, 'assignmentId'));
    if (!assignment) throw notFound();
    return { assignment, offer: await this.read.findCurrentOffer(assignment.id) };
  }

  /** Operations, or a service with `dispatch.assignment.read` (e.g. Booking display). */
  async getAssignmentByBooking(meta: RequestMeta, bookingId: string): Promise<AssignmentView> {
    if (!isOperations(meta.actor) && !hasScope(meta.actor, 'dispatch.assignment.read')) {
      throw new DispatchError('FORBIDDEN', 'Permission denied.');
    }
    const assignment = await this.read.findAssignmentByBooking(uuid(bookingId, 'bookingId'));
    if (!assignment) throw notFound();
    return { assignment, offer: await this.read.findCurrentOffer(assignment.id) };
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
    return this.idempotent(meta, 'offer', id, idempotencyKey, normalized, (tx, now) =>
      this.withAssignment(tx, id, normalized.expectedRevision, now, meta, async (current) => {
        if (current.assignment.status === 'ASSIGNED') {
          throw new DispatchError('ASSIGNMENT_ALREADY_ASSIGNED', 'The job is already assigned.');
        }
        return this.placeOffer(tx, current.assignment, normalized, now, meta);
      }),
    );
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
    return this.idempotent(meta, 'reassign', id, idempotencyKey, normalized, (tx, now) =>
      this.withAssignment(tx, id, normalized.expectedRevision, now, meta, async (current) => {
        const released = await this.releaseCurrent(tx, current, 'REASSIGNED', now, meta);
        return this.placeOffer(tx, released, normalized, now, meta);
      }),
    );
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
    return this.idempotent(meta, 'unassign', id, idempotencyKey, body, (tx, now) =>
      this.withAssignment(tx, id, body.expectedRevision, now, meta, async (current) => {
        await this.releaseCurrent(tx, current, 'UNASSIGNED', now, meta);
        return { kind: 'DONE', result: { resultType: 'ASSIGNMENT', resultId: id } };
      }),
    );
  }

  // ------------------------------------------------------ technician commands

  async acceptOffer(
    meta: RequestMeta,
    offerId: string,
    idempotencyKey: string | undefined,
  ): Promise<CommandResult<AssignmentView>> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const id = uuid(offerId, 'offerId');
    return this.idempotent(meta, 'accept', id, idempotencyKey, {}, (tx, now) =>
      this.withOwnOffer(tx, id, user.subject, now, meta, async (assignment, offer) => {
        if (offer.status === 'ACCEPTED' && assignment.status === 'ASSIGNED') {
          // Accepting the offer one already holds is a natural replay.
          return { kind: 'DONE', result: { resultType: 'OFFER', resultId: offer.id } };
        }
        const accepted = accept(offer, now);
        const assigned = markAssigned(assignment, accepted, now);
        await tx.updateOffer(accepted, offer.version);
        // RESOURCE_BUSY from the exclusion constraint rolls everything back.
        await tx.updateAssignment(assigned, assignment.version);
        await this.emit(tx, assigned, meta, null);
        await tx.appendAudit({
          action: 'offer.accepted',
          actor: meta.actor,
          targetType: 'OFFER',
          targetId: offer.id,
          correlationId: meta.correlationId,
          details: { assignmentId: assignment.id, resourceId: offer.resourceId },
        });
        return { kind: 'DONE', result: { resultType: 'OFFER', resultId: offer.id } };
      }),
    );
  }

  async declineOffer(
    meta: RequestMeta,
    offerId: string,
    reason: DeclineReason,
    idempotencyKey: string | undefined,
  ): Promise<CommandResult<AssignmentView>> {
    const user = requirePermission(meta.actor, WORK_EXECUTE);
    const id = uuid(offerId, 'offerId');
    return this.idempotent(meta, 'decline', id, idempotencyKey, { reason }, (tx, now) =>
      this.withOwnOffer(tx, id, user.subject, now, meta, async (assignment, offer) => {
        const declined = decline(offer, reason, now);
        const unassigned = markUnassigned(assignment, now);
        await tx.updateOffer(declined, offer.version);
        await tx.updateAssignment(unassigned, assignment.version);
        await this.emit(tx, unassigned, meta, null);
        await tx.appendAudit({
          action: 'offer.declined',
          actor: meta.actor,
          targetType: 'OFFER',
          targetId: offer.id,
          correlationId: meta.correlationId,
          details: { assignmentId: assignment.id, reason },
        });
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

  private async idempotent(
    meta: RequestMeta,
    operation: string,
    target: string,
    key: string | undefined,
    body: unknown,
    work: (tx: DispatchTransaction, now: Date) => Promise<Outcome>,
  ): Promise<CommandResult<AssignmentView>> {
    if (key === undefined || key === '') {
      throw new DispatchError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required.');
    }
    if (!KEY.test(key)) throw new DispatchError('INVALID_INPUT', 'Idempotency-Key is malformed.');
    const scope = `${actorKey(meta.actor)}|${operation}|${target}`;
    const print = fingerprint(body);
    const now = this.clock.now();
    const outcome = await this.uow.run(async (tx) => {
      const claim = await tx.claimIdempotency(scope, key, print);
      if (claim.kind === 'CONFLICT') {
        throw new DispatchError(
          'IDEMPOTENCY_CONFLICT',
          'The Idempotency-Key was already used for a different request.',
        );
      }
      if (claim.kind === 'REPLAY') return { replayed: true, outcome: claim.result };
      const result = await work(tx, now);
      // A refusal commits its side effects (e.g. a recorded expiry) but no
      // idempotency record, so a retry is evaluated against the new state.
      if (result.kind === 'REFUSED') return { replayed: false, outcome: result.error };
      await tx.completeIdempotency(scope, key, result.result);
      return { replayed: false, outcome: result.result };
    });
    if (outcome.outcome instanceof DispatchError) throw outcome.outcome;
    return { value: await this.view(outcome.outcome), replayed: outcome.replayed };
  }

  /** Replays re-read the CURRENT state of what the original command produced. */
  private async view(result: IdempotentResult): Promise<AssignmentView> {
    if (result.resultType === 'OFFER') {
      const offer = await this.read.findOffer(result.resultId);
      const assignment = offer ? await this.read.findAssignment(offer.assignmentId) : null;
      if (!offer || !assignment) throw offerNotFound();
      return { assignment, offer };
    }
    const assignment = await this.read.findAssignment(result.resultId);
    if (!assignment) throw notFound();
    return { assignment, offer: await this.read.findCurrentOffer(assignment.id) };
  }

  /** Locks the assignment, checks the client's revision and settles a due offer first. */
  private async withAssignment(
    tx: DispatchTransaction,
    id: string,
    expectedRevision: number,
    now: Date,
    meta: RequestMeta,
    work: (current: AssignmentView) => Promise<Outcome>,
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
   * as not found, never as forbidden, so offer ids cannot be probed.
   */
  private async withOwnOffer(
    tx: DispatchTransaction,
    offerId: string,
    subject: string,
    now: Date,
    meta: RequestMeta,
    work: (assignment: AssignmentState, offer: OfferState) => Promise<Outcome>,
  ): Promise<Outcome> {
    const seen = await tx.readOffer(offerId);
    if (!seen || seen.technicianSubject !== subject) throw offerNotFound();
    // Lock order: assignment -> offer, then re-read the offer under the lock.
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
    return work(assignment, offer);
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
    await this.emit(tx, offered, meta, null);
    await tx.appendAudit({
      action: 'offer.created',
      actor: meta.actor,
      targetType: 'OFFER',
      targetId: offer.id,
      correlationId: meta.correlationId,
      details: {
        assignmentId: assignment.id,
        resourceId: offer.resourceId,
        technicianSubject: offer.technicianSubject,
        expiresAt: offer.expiresAt.toISOString(),
      },
    });
    return { kind: 'DONE', result: { resultType: 'ASSIGNMENT', resultId: assignment.id } };
  }

  /** Withdraws the current offer (live or accepted) and returns the job to UNASSIGNED. */
  private async releaseCurrent(
    tx: DispatchTransaction,
    current: AssignmentView,
    reason: WithdrawReason,
    now: Date,
    meta: RequestMeta,
  ): Promise<AssignmentState> {
    const { assignment, offer } = current;
    if (assignment.status === 'UNASSIGNED') return assignment;
    if (offer) await tx.updateOffer(withdraw(offer, reason, now), offer.version);
    const unassigned = markUnassigned(assignment, now);
    await tx.updateAssignment(unassigned, assignment.version);
    await this.emit(tx, unassigned, meta, null);
    await tx.appendAudit({
      action: reason === 'REASSIGNED' ? 'assignment.reassigned' : 'assignment.unassigned',
      actor: meta.actor,
      targetType: 'ASSIGNMENT',
      targetId: assignment.id,
      correlationId: meta.correlationId,
      details: {
        previousStatus: assignment.status,
        withdrawnOfferId: offer?.id ?? null,
        previousResourceId: assignment.resourceId,
      },
    });
    return unassigned;
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
    await this.emit(tx, unassigned, meta, null);
    await tx.appendAudit({
      action: 'offer.expired',
      actor: meta.actor,
      targetType: 'OFFER',
      targetId: offer.id,
      correlationId: meta.correlationId,
      // The deadline is the fact; when it was noticed is the audit row's own time.
      details: { assignmentId: assignment.id, expiredAt: offer.expiresAt.toISOString() },
    });
    return unassigned;
  }

  private async emit(
    tx: DispatchTransaction,
    assignment: AssignmentState,
    meta: RequestMeta,
    causationId: string | null,
  ): Promise<void> {
    await tx.appendEvent({
      event: assignmentChangedEvent({
        eventId: this.ids.next(),
        correlationId: meta.correlationId,
        causationId,
        actor: eventActor(meta.actor),
        assignment,
      }),
      exchange: DISPATCH_EVENTS_EXCHANGE,
      routingKey: DISPATCH_ASSIGNMENT_CHANGED_V1,
    });
  }
}

function notFound(): DispatchError {
  return new DispatchError('ASSIGNMENT_NOT_FOUND', 'The assignment was not found.');
}

function offerNotFound(): DispatchError {
  return new DispatchError('OFFER_NOT_FOUND', 'The offer was not found.');
}

function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new DispatchError('INVALID_INPUT', 'expectedRevision must be a positive integer.');
  }
  return value;
}

function normalizeOffer(input: OfferInput): Required<OfferInput> {
  return {
    expectedRevision: revision(input.expectedRevision),
    resourceId: uuid(input.resourceId, 'resourceId'),
    technicianSubject: uuid(input.technicianSubject, 'technicianSubjectId'),
    ttlSeconds: offerTtlSeconds(input.ttlSeconds),
  };
}
