import {
  beginCommit,
  bookingCreatedEvent,
  confirmBooking,
  isTerminal,
  matchesRequestedSlot,
  onCommit,
  onObligation,
  onQuoteChecked,
  onVoid,
  rejectBooking,
  totalMatches,
  type Booking,
  type CommitResult,
  type QuoteCheck,
  type SagaState,
  type SlotSnapshot,
} from '../domain';
import type {
  BillingObligations,
  BookingRecord,
  BookingStore,
  Clock,
  HoldCommitter,
  IdGenerator,
  Observer,
  QuoteValidator,
  RandomSource,
  SagaLease,
} from '../ports';

export interface ProcessManagerDeps {
  readonly store: BookingStore;
  readonly quotes: QuoteValidator;
  readonly billing: BillingObligations;
  readonly holds: HoldCommitter;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
  readonly observer: Observer;
  /** How long one worker owns a saga before another replica may take it over. */
  readonly leaseMs: number;
  /** Supplies the W3C trace parent of the active span, if any. */
  readonly traceparent: () => string | null;
}

export type DriveResult = 'DONE' | 'WAITING' | 'BUSY' | 'LEASE_LOST';

const SYSTEM_ACTOR = { kind: 'SYSTEM', component: 'booking-saga' } as const;

/**
 * Executes the creation saga of `domain/saga.ts`.
 *
 * Runs in the API process right after a booking is created (bounded by a time
 * budget, so the customer usually gets the final answer at once) and in the
 * standalone saga worker for everything that had to wait. Any replica may
 * resume any saga: state lives only in PostgreSQL, every write is fenced by the
 * lease, and every remote call is idempotent (same booking id / key), so a
 * crash or a duplicate execution never creates a second booking, obligation or
 * commit.
 */
export class BookingProcessManager {
  constructor(private readonly deps: ProcessManagerDeps) {}

  /** Advance one saga until it finishes, must wait, or the budget is spent. */
  async drive(bookingId: string, owner: string, budgetMs: number): Promise<DriveResult> {
    const started = this.deps.clock.now().getTime();
    const leased = await this.deps.store.leaseSaga(
      bookingId,
      owner,
      this.deps.clock.now(),
      this.deps.leaseMs,
    );
    if (!leased) return 'BUSY';
    return this.run(leased.record, leased.lease, started + budgetMs);
  }

  /** Worker pass: lease due sagas (SKIP LOCKED) and advance each of them. */
  async runDue(owner: string, limit: number, budgetMsPerSaga: number): Promise<number> {
    const leased = await this.deps.store.leaseDue(
      owner,
      this.deps.clock.now(),
      this.deps.leaseMs,
      limit,
    );
    for (const { record, lease } of leased) {
      await this.run(record, lease, this.deps.clock.now().getTime() + budgetMsPerSaga);
    }
    return leased.length;
  }

  private async run(
    record: BookingRecord,
    initialLease: SagaLease,
    deadline: number,
  ): Promise<DriveResult> {
    let saga = record.saga;
    const lease = initialLease;
    for (;;) {
      if (isTerminal(saga.step)) return 'DONE';
      const now = this.deps.clock.now();
      if (saga.nextAttemptAt.getTime() > now.getTime() || now.getTime() >= deadline) {
        return (await this.deps.store.saveSaga(saga, lease, true)) ? 'WAITING' : 'LEASE_LOST';
      }
      const outcome = await this.step(record, saga, lease);
      if (outcome === 'LEASE_LOST') {
        this.deps.observer.record('booking_saga_lease_lost', {
          bookingId: saga.bookingId,
          step: saga.step,
        });
        return 'LEASE_LOST';
      }
      saga = outcome;
    }
  }

  private async step(
    record: BookingRecord,
    saga: SagaState,
    lease: SagaLease,
  ): Promise<SagaState | 'LEASE_LOST'> {
    const { booking, correlationId } = record;
    const random = this.deps.random.next();
    let next: SagaState;
    let committedSlot: SlotSnapshot | null = null;

    switch (saga.step) {
      case 'VALIDATE_QUOTE': {
        const result = await this.deps.quotes.validate(
          {
            quoteId: booking.quote.quoteId,
            revision: booking.quote.revision,
            beneficiary: booking.beneficiary,
          },
          correlationId,
        );
        let check: QuoteCheck;
        if (result.kind === 'VALID') {
          // The customer saw (and the snapshot holds) exactly this total.
          check = totalMatches(booking, result.total)
            ? { kind: 'VALID' }
            : { kind: 'INVALID', reason: 'QUOTE_INVALID' };
        } else check = result;
        next = onQuoteChecked(saga, check, this.deps.clock.now(), random);
        break;
      }
      case 'CREATE_OBLIGATION': {
        const result = await this.deps.billing.create(
          {
            bookingId: booking.id,
            beneficiary: booking.beneficiary,
            quoteId: booking.quote.quoteId,
            quoteRevision: booking.quote.revision,
            amount: booking.total,
            paymentMethod: booking.paymentMethod,
          },
          correlationId,
        );
        next = onObligation(saga, result, this.deps.clock.now(), random);
        break;
      }
      case 'COMMIT_HOLD': {
        // The pivot is recorded durably BEFORE the request leaves, so after any
        // crash the saga knows the commit may have happened and never rejects
        // the booking on a deadline from here on.
        const marked = beginCommit(saga, this.deps.clock.now());
        if (marked !== saga) {
          if (!(await this.deps.store.saveSaga(marked, lease, false))) return 'LEASE_LOST';
          saga = marked;
        }
        const result = await this.deps.holds.commit(
          {
            holdId: booking.requestedSlot.holdId,
            expectedRevision: booking.requestedSlot.holdRevision,
            bookingId: booking.id,
          },
          correlationId,
        );
        let mapped: CommitResult;
        if (result.kind === 'COMMITTED') {
          committedSlot = result.slot;
          mapped = {
            kind: 'COMMITTED',
            matchesRequest: matchesRequestedSlot(booking, result.slot),
          };
        } else mapped = result;
        next = onCommit(saga, mapped, this.deps.clock.now(), random);
        break;
      }
      case 'VOID_OBLIGATION': {
        const result = await this.deps.billing.voidForBooking(booking.id, correlationId);
        next = onVoid(saga, result, this.deps.clock.now(), random);
        break;
      }
      case 'DONE':
      case 'NEEDS_RECONCILIATION':
        return saga;
    }

    this.deps.observer.record('booking_saga_step', {
      bookingId: booking.id,
      from: saga.step,
      to: next.step,
      attempts: next.attempts,
      error: next.lastError,
    });

    if (!isTerminal(next.step)) {
      return (await this.deps.store.saveSaga(next, lease, false)) ? next : 'LEASE_LOST';
    }
    return (await this.finish(record, booking, next, lease, committedSlot)) ? next : 'LEASE_LOST';
  }

  private async finish(
    record: BookingRecord,
    booking: Booking,
    saga: SagaState,
    lease: SagaLease,
    committedSlot: SlotSnapshot | null,
  ): Promise<boolean> {
    const now = this.deps.clock.now();
    let finalBooking = booking;
    let action: string;
    if (saga.step === 'NEEDS_RECONCILIATION') {
      action = 'booking.saga.reconciliation-required';
    } else if (saga.outcome === 'CONFIRMED') {
      if (committedSlot === null) throw new Error('SAGA_CONFIRMED_WITHOUT_SLOT');
      finalBooking = confirmBooking(booking, committedSlot, now);
      action = 'booking.confirmed';
    } else {
      const reason = saga.pendingRejection;
      if (reason === null) throw new Error('SAGA_REJECTED_WITHOUT_REASON');
      finalBooking = rejectBooking(booking, reason, now);
      action = 'booking.rejected';
    }
    const event =
      finalBooking.status === 'CONFIRMED' && booking.status !== 'CONFIRMED'
        ? bookingCreatedEvent({
            eventId: this.deps.ids.next(),
            correlationId: record.correlationId,
            causationId: null,
            traceparent: this.deps.traceparent(),
            booking: finalBooking,
          })
        : null;
    const finished = await this.deps.store.finish({
      saga,
      lease,
      booking: finalBooking,
      expectedBookingVersion: booking.version,
      event,
      audit: {
        action,
        actor: SYSTEM_ACTOR,
        bookingId: booking.id,
        correlationId: record.correlationId,
        details: {
          status: finalBooking.status,
          reason: finalBooking.rejectionReason,
          obligationId: saga.obligationId,
          sagaError: saga.lastError,
        },
      },
    });
    if (finished) {
      this.deps.observer.record('booking_saga_finished', {
        bookingId: booking.id,
        step: saga.step,
        status: finalBooking.status,
        reason: finalBooking.rejectionReason,
      });
    }
    return finished;
  }
}
