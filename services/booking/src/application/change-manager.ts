import {
  beginPivot,
  bookingCancelledEvent,
  bookingRescheduledEvent,
  cancelBooking,
  isPivotExit,
  onCapacityReleased,
  onConfirm,
  onDispatchCancel,
  onRebind,
  onReplace,
  onRevert,
  onSettled,
  rescheduleBooking,
  type Booking,
  type BookingEvent,
  type ChangeState,
  type SlotSnapshot,
} from '../domain';
import type {
  BillingCancellation,
  BookingStore,
  ChangeRecord,
  ChangeStore,
  Clock,
  CommitmentChanges,
  DispatchChanges,
  IdGenerator,
  Observer,
  RandomSource,
  SagaLease,
} from '../ports';

export interface ChangeManagerDeps {
  readonly changes: ChangeStore;
  readonly bookings: BookingStore;
  readonly dispatch: DispatchChanges;
  readonly commitments: CommitmentChanges;
  readonly billing: BillingCancellation;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
  readonly observer: Observer;
  readonly leaseMs: number;
  readonly traceparent: () => string | null;
}

export type ChangeDriveResult = 'DONE' | 'WAITING' | 'BUSY' | 'LEASE_LOST';

const SYSTEM_ACTOR = { kind: 'SYSTEM', component: 'booking-change-saga' } as const;

/**
 * Executes the change saga of `domain/change.ts` (P04-C3).
 *
 * Driven inline for a bounded time right after the request (the customer
 * usually gets the final answer at once) and by the saga worker for anything
 * that had to wait. State lives only in PostgreSQL; every write is fenced by
 * the lease and every owner call is replay-safe by the change id, so a crash
 * or a duplicate run never applies a change twice.
 */
export class ChangeProcessManager {
  constructor(private readonly deps: ChangeManagerDeps) {}

  async drive(changeId: string, owner: string, budgetMs: number): Promise<ChangeDriveResult> {
    const started = this.deps.clock.now().getTime();
    const leased = await this.deps.changes.leaseChange(
      changeId,
      owner,
      this.deps.clock.now(),
      this.deps.leaseMs,
    );
    if (!leased) return 'BUSY';
    return this.run(leased.record, leased.lease, started + budgetMs);
  }

  async runDue(owner: string, limit: number, budgetMsPerChange: number): Promise<number> {
    const leased = await this.deps.changes.leaseDueChanges(
      owner,
      this.deps.clock.now(),
      this.deps.leaseMs,
      limit,
    );
    for (const { record, lease } of leased) {
      await this.run(record, lease, this.deps.clock.now().getTime() + budgetMsPerChange);
    }
    return leased.length;
  }

  private async run(
    record: ChangeRecord,
    lease: SagaLease,
    deadline: number,
  ): Promise<ChangeDriveResult> {
    let change = record.change;
    for (;;) {
      if (change.step === 'DONE') return 'DONE';
      const now = this.deps.clock.now();
      if (change.nextAttemptAt.getTime() > now.getTime() || now.getTime() >= deadline) {
        return (await this.deps.changes.saveChange(change, lease, true)) ? 'WAITING' : 'LEASE_LOST';
      }
      const next = await this.step(change, record.correlationId, lease);
      if (next === 'LEASE_LOST') {
        this.deps.observer.record('booking_change_lease_lost', {
          changeId: change.changeId,
          step: change.step,
        });
        return 'LEASE_LOST';
      }
      change = next;
    }
  }

  private async step(
    before: ChangeState,
    correlationId: string,
    lease: SagaLease,
  ): Promise<ChangeState | 'LEASE_LOST'> {
    const { bookingId, changeId } = before;
    const random = this.deps.random.next();
    let change = before;
    let next: ChangeState;
    let replacedSlot: SlotSnapshot | null = null;

    switch (change.step) {
      case 'DISPATCH_CANCEL': {
        const result = await this.deps.dispatch.cancel(bookingId, changeId, correlationId);
        next = onDispatchCancel(change, result, this.deps.clock.now(), random);
        break;
      }
      case 'RELEASE_CAPACITY': {
        const result = await this.deps.commitments.release(
          bookingId,
          change.from.holdId,
          correlationId,
        );
        next = onCapacityReleased(change, result, this.deps.clock.now(), random);
        break;
      }
      case 'SETTLE_BILLING': {
        const result = await this.deps.billing.settle(bookingId, changeId, correlationId);
        next = onSettled(change, result, this.deps.clock.now(), random);
        break;
      }
      case 'DISPATCH_REBIND': {
        const to = target(change);
        const result = await this.deps.dispatch.rebind(bookingId, changeId, to, correlationId);
        next = onRebind(change, result, this.deps.clock.now(), random);
        break;
      }
      case 'REPLACE_COMMITMENT': {
        // The pivot is recorded durably BEFORE the request leaves: after any
        // crash the saga knows the replace may have happened and only replays it.
        const marked = beginPivot(change, this.deps.clock.now());
        if (marked !== change) {
          if (!(await this.deps.changes.saveChange(marked, lease, false))) return 'LEASE_LOST';
          change = marked;
        }
        const to = target(change);
        const result = await this.deps.commitments.replace(
          {
            bookingId,
            fromHoldId: change.from.holdId,
            toHoldId: to.holdId,
            toExpectedRevision: to.holdRevision,
          },
          correlationId,
        );
        if (result.kind === 'REPLACED') replacedSlot = result.slot;
        next = onReplace(change, result, this.deps.clock.now(), random);
        break;
      }
      case 'DISPATCH_CONFIRM': {
        const result = await this.deps.dispatch.confirm(bookingId, changeId, correlationId);
        next = onConfirm(change, result, this.deps.clock.now(), random);
        break;
      }
      case 'DISPATCH_REVERT': {
        const result = await this.deps.dispatch.revert(bookingId, changeId, correlationId);
        next = onRevert(change, result, this.deps.clock.now(), random);
        break;
      }
      case 'DONE':
        return change;
    }

    this.deps.observer.record('booking_change_step', {
      changeId,
      bookingId,
      kind: change.kind,
      from: change.step,
      to: next.step,
      attempts: next.attempts,
      attention: next.attention,
      error: next.lastError,
    });

    const finished = next.step === 'DONE';
    if (isPivotExit(change, next)) {
      return (await this.pivot(change, next, correlationId, lease, replacedSlot))
        ? next
        : 'LEASE_LOST';
    }
    if (finished || next.step !== change.step) {
      const saved = await this.deps.changes.applyChange({
        change: next,
        lease,
        release: finished,
        booking: null,
        expectedBookingVersion: null,
        event: null,
        audit:
          finished || next.attention !== change.attention ? this.audit(next, correlationId) : null,
      });
      if (!saved) return 'LEASE_LOST';
      if (finished) {
        this.deps.observer.record('booking_change_finished', {
          changeId,
          bookingId,
          kind: next.kind,
          outcome: next.outcome,
          refusal: next.refusal,
          settlement: next.settlement,
        });
      }
      return next;
    }
    return (await this.deps.changes.saveChange(next, lease, false)) ? next : 'LEASE_LOST';
  }

  /**
   * The step whose success changes the booking: the booking update, its event
   * and the audit row commit with the change's transition, or not at all.
   */
  private async pivot(
    before: ChangeState,
    next: ChangeState,
    correlationId: string,
    lease: SagaLease,
    replacedSlot: SlotSnapshot | null,
  ): Promise<boolean> {
    const record = await this.deps.bookings.find(before.bookingId);
    if (!record) throw new Error('CHANGED_BOOKING_MISSING');
    const booking = record.booking;
    const now = this.deps.clock.now();
    let updated: Booking;
    let event: BookingEvent;
    if (before.kind === 'CANCELLATION') {
      if (before.reason === null) throw new Error('CANCELLATION_WITHOUT_REASON');
      updated = cancelBooking(booking, before.reason, now);
      event = bookingCancelledEvent({
        eventId: this.deps.ids.next(),
        correlationId,
        traceparent: this.deps.traceparent(),
        booking: updated,
        change: before,
      });
    } else {
      if (replacedSlot === null) throw new Error('RESCHEDULE_WITHOUT_SLOT');
      updated = rescheduleBooking(booking, replacedSlot, now);
      event = bookingRescheduledEvent({
        eventId: this.deps.ids.next(),
        correlationId,
        traceparent: this.deps.traceparent(),
        booking: updated,
        change: before,
      });
    }
    return this.deps.changes.applyChange({
      change: next,
      lease,
      release: false,
      booking: updated,
      expectedBookingVersion: booking.version,
      event,
      audit: {
        action: before.kind === 'CANCELLATION' ? 'booking.cancelled' : 'booking.rescheduled',
        actor: SYSTEM_ACTOR,
        bookingId: before.bookingId,
        correlationId,
        details: {
          changeId: before.changeId,
          bookingVersion: updated.version,
          scheduleRevision: updated.scheduleRevision,
          holdId:
            before.kind === 'CANCELLATION' ? before.from.holdId : (replacedSlot?.holdId ?? null),
        },
      },
    });
  }

  private audit(change: ChangeState, correlationId: string) {
    return {
      action: change.step === 'DONE' ? 'booking.change.finished' : 'booking.change.attention',
      actor: SYSTEM_ACTOR,
      bookingId: change.bookingId,
      correlationId,
      details: {
        changeId: change.changeId,
        kind: change.kind,
        outcome: change.outcome,
        refusal: change.refusal,
        settlement: change.settlement,
        lastError: change.lastError,
      },
    };
  }
}

function target(change: ChangeState) {
  if (change.to === null) throw new Error('RESCHEDULE_WITHOUT_TARGET');
  return change.to;
}
