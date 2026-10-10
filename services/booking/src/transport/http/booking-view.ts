import {
  currentSlot,
  moneyToWire,
  type Booking,
  type ChangeState,
  type SagaState,
} from '../../domain';
import { changeView } from './change-view';

/**
 * Wire view of a booking (REQUESTED booking.v1 `BookingV1`, CR-P02-C2).
 *
 * `confirmation` is what the customer screen needs to know about the saga:
 * PENDING while it runs, CONFIRMED / REJECTED when it finished, and
 * NEEDS_ATTENTION when operations must reconcile it. Internal saga details
 * (obligation id, attempts, errors, fences) are never exposed.
 */
export function bookingView(
  booking: Booking,
  saga: SagaState,
  pendingChange: ChangeState | null = null,
) {
  const schedule = currentSlot(booking);
  const slot = booking.slot ?? {
    holdId: booking.requestedSlot.holdId,
    zoneId: booking.requestedSlot.zoneId,
    startsAt: booking.requestedSlot.startsAt,
    endsAt: booking.requestedSlot.endsAt,
  };
  return {
    bookingId: booking.id,
    revision: booking.version,
    status: booking.status,
    confirmation:
      saga.step === 'NEEDS_RECONCILIATION'
        ? 'NEEDS_ATTENTION'
        : saga.step === 'DONE'
          ? saga.outcome
          : 'PENDING',
    rejectionReason: booking.rejectionReason,
    beneficiary: booking.beneficiary,
    paymentMethod: booking.paymentMethod,
    slot: {
      holdId: slot.holdId,
      zoneId: slot.zoneId,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      committed: booking.slot !== null,
    },
    quote: {
      quoteId: booking.quote.quoteId,
      revision: booking.quote.revision,
      catalogRevision: booking.quote.catalogRevision,
      priceBookRevision: booking.quote.priceBookRevision,
      lines: booking.quote.lines.map((line) => ({
        lineId: line.lineId,
        kind: line.kind,
        definitionId: line.definitionId,
        quantity: line.quantity,
        unitPrice: moneyToWire(line.unitPrice),
        amount: moneyToWire(line.amount),
      })),
    },
    total: moneyToWire(booking.total),
    vehicle: booking.vehicle,
    address: booking.address,
    contact: booking.contact,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    // P04-C3: `slot` stays the original snapshot; `schedule` is where the booking is now.
    schedule:
      schedule === null
        ? null
        : {
            revision: booking.scheduleRevision,
            holdId: schedule.holdId,
            zoneId: schedule.zoneId,
            startsAt: schedule.startsAt.toISOString(),
            endsAt: schedule.endsAt.toISOString(),
          },
    cancellation:
      booking.cancellation === null
        ? null
        : {
            reason: booking.cancellation.reason,
            cancelledAt: booking.cancellation.cancelledAt.toISOString(),
          },
    pendingChange: pendingChange === null ? null : changeView(pendingChange),
  };
}
