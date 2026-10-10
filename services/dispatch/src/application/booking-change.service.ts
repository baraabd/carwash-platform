import {
  DispatchError,
  assertChangeable,
  assertSameChange,
  cancel,
  confirmBinding,
  rebind,
  revertBinding,
  uuid,
  withdraw,
  type AssignmentState,
  type BookingChange,
  type JobSlot,
} from '../domain';
import type {
  Clock,
  DispatchReadModel,
  DispatchTransaction,
  DispatchUnitOfWork,
  IdGenerator,
  RequestMeta,
} from '../ports';
import { hasScope } from './authorization';
import { Effects } from './effects';
import { assertIdempotencyKey, runIdempotent, type Outcome } from './idempotency';

/** REQUESTED dispatch.v1 view of a booking change (P04-C-interfaces §C2). */
export interface BookingChangeView {
  readonly bookingId: string;
  readonly changeId: string;
  readonly outcome:
    'CANCELLED' | 'NOT_OPENED' | 'REBOUND' | 'CONFIRMED' | 'REVERTED' | 'NOTHING_TO_REVERT';
  readonly assignmentRevision: number | null;
}

export interface RebindInput {
  readonly changeId: string;
  readonly holdId: string;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

const SCOPE = 'dispatch.booking.change' as const;

/**
 * Booking's changes to a booking's job (P04-C2): cancellation, and the rebind
 * / confirm / revert steps of a reschedule. Decision P04-C-D1: this is the
 * work-progress gate; every decision is taken under the booking lock and the
 * assignment row lock, in the same transaction as its effects, so a
 * technician's accept/depart and a change have exactly one winner.
 *
 * Every command is replay-safe by Booking's change id (a lost response retried
 * with any Idempotency-Key returns the recorded outcome and changes nothing)
 * and by Idempotency-Key in the usual way.
 */
export class BookingChangeService {
  private readonly effects: Effects;

  constructor(
    private readonly uow: DispatchUnitOfWork,
    private readonly read: DispatchReadModel,
    private readonly clock: Clock,
    ids: IdGenerator,
  ) {
    this.effects = new Effects(ids);
  }

  /**
   * Cancels the booking's job. Without a job yet (the COMMITTED event is still
   * in flight) a tombstone is recorded so that the job is never opened.
   */
  async cancel(
    meta: RequestMeta,
    bookingIdRaw: string,
    input: { readonly changeId: string },
    key: string | undefined,
  ): Promise<BookingChangeView> {
    this.authorize(meta);
    const bookingId = uuid(bookingIdRaw, 'bookingId');
    const changeId = uuid(input.changeId, 'changeId');
    assertIdempotencyKey(key);
    return this.command(meta, 'booking.cancel', bookingId, key, { changeId }, async (tx, now) => {
      await tx.lockBooking(bookingId);
      const known = await tx.findBookingChange(changeId);
      if (known) {
        assertSameChange(known, bookingId, 'CANCELLATION');
        return done(known.changeId);
      }
      const earlier = await tx.findCancellation(bookingId);
      if (earlier) return done(earlier.changeId);

      const assignment = await tx.lockAssignmentByBooking(bookingId);
      if (!assignment) {
        await tx.insertBookingChange(
          record(changeId, bookingId, 'CANCELLATION', 'NOT_OPENED', null, now),
        );
        await this.effects.audit(
          tx,
          meta,
          'booking.cancelled-before-open',
          bookingTarget(bookingId),
          {
            changeId,
          },
        );
        return done(changeId);
      }
      if (assignment.status !== 'CANCELLED') {
        const offer = await tx.lockCurrentOffer(assignment.id);
        const live = await tx.lockLiveTask(assignment.id);
        assertChangeable(live);
        if (offer) await tx.updateOffer(withdraw(offer, 'JOB_CANCELLED', now), offer.version);
        const ended = await this.effects.endLiveTask(tx, assignment.id, 'JOB_CANCELLED', now, meta);
        // A reschedule left half-way can never complete once the booking is cancelled.
        const pending = await tx.findPendingRebind(bookingId);
        if (pending)
          await tx.updateBookingChange({ ...pending, state: 'REVERTED', updatedAt: now });
        const cancelled = cancel(assignment, 'BOOKING_CANCELLED', now);
        await tx.updateAssignment(cancelled, assignment.version);
        await this.effects.assignmentChanged(tx, cancelled, meta);
        await this.effects.audit(
          tx,
          meta,
          'assignment.cancelled-by-booking',
          { type: 'ASSIGNMENT', id: assignment.id },
          {
            changeId,
            previousStatus: assignment.status,
            withdrawnOfferId: offer?.id ?? null,
            endedTaskId: ended?.id ?? null,
          },
        );
      }
      // An assignment the slot release had already cancelled is cancelled all the same.
      await tx.insertBookingChange(
        record(changeId, bookingId, 'CANCELLATION', 'CANCELLED', assignment.id, now),
      );
      return done(changeId);
    });
  }

  /**
   * Moves the job to the new (not yet committed) slot. A not-started task is
   * ended (JOB_RESCHEDULED) and the job returns to UNASSIGNED: the technician
   * must accept the new time again (owner decision TI-D06 pending).
   */
  async rebind(
    meta: RequestMeta,
    bookingIdRaw: string,
    input: RebindInput,
    key: string | undefined,
  ): Promise<BookingChangeView> {
    this.authorize(meta);
    const bookingId = uuid(bookingIdRaw, 'bookingId');
    const body = {
      changeId: uuid(input.changeId, 'changeId'),
      holdId: uuid(input.holdId, 'holdId'),
      zoneId: uuid(input.zoneId, 'zoneId'),
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
    };
    assertIdempotencyKey(key);
    return this.command(meta, 'booking.rebind', bookingId, key, body, async (tx, now) => {
      await tx.lockBooking(bookingId);
      const known = await tx.findBookingChange(body.changeId);
      if (known) {
        assertSameChange(known, bookingId, 'REBIND');
        if (known.state === 'REVERTED') {
          throw new DispatchError('CHANGE_REVERTED', 'The change was already reverted.');
        }
        return done(known.changeId);
      }
      if (await tx.findCancellation(bookingId)) throw bookingCancelled();
      const assignment = await tx.lockAssignmentByBooking(bookingId);
      if (!assignment) {
        throw new DispatchError('ASSIGNMENT_NOT_OPEN', 'The job is not open yet; retry shortly.');
      }
      if (assignment.status === 'CANCELLED') throw bookingCancelled();
      if (assignment.zoneId !== body.zoneId) {
        throw new DispatchError('INVALID_INPUT', 'A reschedule cannot change the zone.');
      }
      if (assignment.holdId === body.holdId) {
        throw new DispatchError('INVALID_INPUT', 'The job is already bound to this hold.');
      }
      const offer = await tx.lockCurrentOffer(assignment.id);
      const live = await tx.lockLiveTask(assignment.id);
      assertChangeable(live);
      if (offer) await tx.updateOffer(withdraw(offer, 'JOB_RESCHEDULED', now), offer.version);
      const ended = await this.effects.endLiveTask(tx, assignment.id, 'JOB_RESCHEDULED', now, meta);
      const to: JobSlot = {
        holdId: body.holdId,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
      };
      const from: JobSlot = {
        holdId: assignment.holdId,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
      };
      const rebound = rebind(assignment, { ...to, changeId: body.changeId, now });
      await tx.updateAssignment(rebound, assignment.version);
      await this.effects.assignmentChanged(tx, rebound, meta);
      await tx.insertBookingChange({
        ...record(body.changeId, bookingId, 'REBIND', 'REBOUND', assignment.id, now),
        from,
        to,
      });
      await this.effects.audit(
        tx,
        meta,
        'assignment.rebound',
        { type: 'ASSIGNMENT', id: assignment.id },
        {
          changeId: body.changeId,
          fromHoldId: from.holdId,
          toHoldId: to.holdId,
          previousStatus: assignment.status,
          withdrawnOfferId: offer?.id ?? null,
          endedTaskId: ended?.id ?? null,
        },
      );
      return done(body.changeId);
    });
  }

  /** The new hold is committed to the booking: the binding becomes final. */
  async confirm(
    meta: RequestMeta,
    bookingIdRaw: string,
    input: { readonly changeId: string },
    key: string | undefined,
  ): Promise<BookingChangeView> {
    this.authorize(meta);
    const bookingId = uuid(bookingIdRaw, 'bookingId');
    const changeId = uuid(input.changeId, 'changeId');
    assertIdempotencyKey(key);
    return this.command(meta, 'booking.confirm', bookingId, key, { changeId }, async (tx, now) => {
      await tx.lockBooking(bookingId);
      const change = await tx.findBookingChange(changeId);
      if (!change) throw new DispatchError('CHANGE_NOT_FOUND', 'The change was not found.');
      assertSameChange(change, bookingId, 'REBIND');
      if (change.state === 'REVERTED') {
        throw new DispatchError('CHANGE_REVERTED', 'The change was already reverted.');
      }
      if (change.state === 'REBOUND') await confirmRebind(tx, this.effects, meta, change, now);
      return done(changeId);
    });
  }

  /**
   * The new hold could not be committed: the job goes back to its original
   * slot. A revert that arrives before (or instead of) the rebind leaves a
   * tombstone, so a late rebind with the same change id is refused.
   */
  async revert(
    meta: RequestMeta,
    bookingIdRaw: string,
    input: { readonly changeId: string },
    key: string | undefined,
  ): Promise<BookingChangeView> {
    this.authorize(meta);
    const bookingId = uuid(bookingIdRaw, 'bookingId');
    const changeId = uuid(input.changeId, 'changeId');
    assertIdempotencyKey(key);
    return this.command(meta, 'booking.revert', bookingId, key, { changeId }, async (tx, now) => {
      await tx.lockBooking(bookingId);
      const change = await tx.findBookingChange(changeId);
      if (!change) {
        await tx.insertBookingChange(record(changeId, bookingId, 'REBIND', 'REVERTED', null, now));
        return done(changeId);
      }
      assertSameChange(change, bookingId, 'REBIND');
      if (change.state === 'CONFIRMED') {
        throw new DispatchError('CHANGE_CONFIRMED', 'The new slot is already final.');
      }
      if (change.state === 'REVERTED') return done(changeId);
      const assignment =
        change.assignmentId === null ? null : await tx.lockAssignment(change.assignmentId);
      if (assignment && change.from && assignment.pendingChangeId === changeId) {
        const reverted = revertBinding(assignment, changeId, change.from, now);
        await tx.updateAssignment(reverted, assignment.version);
        await this.effects.assignmentChanged(tx, reverted, meta);
      }
      await tx.updateBookingChange({ ...change, state: 'REVERTED', updatedAt: now });
      await this.effects.audit(tx, meta, 'assignment.rebind-reverted', bookingTarget(bookingId), {
        changeId,
        assignmentId: change.assignmentId,
        restoredHoldId: change.from?.holdId ?? null,
      });
      return done(changeId);
    });
  }

  // --------------------------------------------------------------- internals

  private authorize(meta: RequestMeta): void {
    if (!hasScope(meta.actor, SCOPE)) throw new DispatchError('FORBIDDEN', 'Permission denied.');
  }

  private async command(
    meta: RequestMeta,
    operation: string,
    bookingId: string,
    key: string | undefined,
    body: unknown,
    work: (tx: DispatchTransaction, now: Date) => Promise<Outcome>,
  ): Promise<BookingChangeView> {
    const now = this.clock.now();
    const { result } = await runIdempotent(
      this.uow,
      meta,
      { operation, target: bookingId },
      key,
      body,
      (tx) => work(tx, now),
    );
    return this.view(result.resultId);
  }

  private async view(changeId: string): Promise<BookingChangeView> {
    const change = await this.read.findBookingChange(changeId);
    if (!change) throw new Error('BOOKING_CHANGE_VANISHED');
    const assignment =
      change.assignmentId === null ? null : await this.read.findAssignment(change.assignmentId);
    return {
      bookingId: change.bookingId,
      changeId: change.changeId,
      outcome:
        change.state === 'REVERTED' && change.from === null ? 'NOTHING_TO_REVERT' : change.state,
      assignmentRevision: assignment?.version ?? null,
    };
  }
}

/**
 * Makes a rebind final: from Booking's confirm, or from the new hold's
 * COMMITTED event, whichever comes first. Caller holds the booking lock.
 */
export async function confirmRebind(
  tx: DispatchTransaction,
  effects: Effects,
  meta: RequestMeta,
  change: BookingChange,
  now: Date,
): Promise<AssignmentState | null> {
  const assignment =
    change.assignmentId === null ? null : await tx.lockAssignment(change.assignmentId);
  let confirmed: AssignmentState | null = null;
  if (assignment && assignment.pendingChangeId === change.changeId) {
    confirmed = confirmBinding(assignment, change.changeId, now);
    await tx.updateAssignment(confirmed, assignment.version);
    await effects.assignmentChanged(tx, confirmed, meta);
  }
  await tx.updateBookingChange({ ...change, state: 'CONFIRMED', updatedAt: now });
  await effects.audit(tx, meta, 'assignment.rebind-confirmed', bookingTarget(change.bookingId), {
    changeId: change.changeId,
    assignmentId: change.assignmentId,
  });
  return confirmed;
}

function done(changeId: string): Outcome {
  return { kind: 'DONE', result: { resultType: 'BOOKING_CHANGE', resultId: changeId } };
}

function record(
  changeId: string,
  bookingId: string,
  kind: BookingChange['kind'],
  state: BookingChange['state'],
  assignmentId: string | null,
  now: Date,
): BookingChange {
  return {
    changeId,
    bookingId,
    kind,
    state,
    assignmentId,
    from: null,
    to: null,
    createdAt: now,
    updatedAt: now,
  };
}

function bookingTarget(bookingId: string) {
  return { type: 'BOOKING' as const, id: bookingId };
}

function bookingCancelled(): DispatchError {
  return new DispatchError('BOOKING_CANCELLED', 'The booking was cancelled.');
}
