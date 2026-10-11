import type { Booking } from './booking';
import type { CancellationReason, ChangeState, Requester } from './change';
import { moneyToWire, type MoneyWire } from './money';
import type { PaymentMethod, PrincipalRef } from './snapshots';

/**
 * `booking.created.v1` on envelope v2: the producer side of the contract
 * REQUESTED from Lane E in docs/production/C/contract-requests/CR-P02-C2-booking-v1.md.
 * Until E publishes it, it is written to the outbox only (status
 * producer-pending); nothing may claim it is a published contract.
 *
 * Emitted once, when the booking is CONFIRMED (the hold is committed). Data
 * carries opaque ids, the slot and the exact total; never the contact name,
 * phone, address text, coordinates or plate.
 */
export const BOOKING_CREATED_V1 = 'booking.created.v1' as const;
export const BOOKING_EVENTS_EXCHANGE = 'booking.events' as const;

export interface EventActor {
  readonly kind: 'account' | 'guest' | 'service' | 'system';
  readonly id: string | null;
}

export interface BookingCreatedV1 {
  readonly eventId: string;
  readonly eventType: typeof BOOKING_CREATED_V1;
  readonly envelopeVersion: 2;
  readonly producer: 'booking';
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly traceparent: string | null;
  readonly aggregate: { readonly type: 'booking'; readonly id: string; readonly version: number };
  readonly actor: EventActor;
  readonly data: {
    readonly status: 'CONFIRMED';
    readonly beneficiary: PrincipalRef;
    readonly zoneId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly holdId: string;
    readonly quoteId: string;
    readonly quoteRevision: number;
    readonly total: MoneyWire;
    readonly paymentMethod: PaymentMethod;
  };
}

export const BOOKING_CANCELLED_V1 = 'booking.cancelled.v1' as const;
export const BOOKING_RESCHEDULED_V1 = 'booking.rescheduled.v1' as const;

interface EnvelopeHead<TType extends string> {
  readonly eventId: string;
  readonly eventType: TType;
  readonly envelopeVersion: 2;
  readonly producer: 'booking';
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly traceparent: string | null;
  readonly aggregate: { readonly type: 'booking'; readonly id: string; readonly version: number };
  readonly actor: EventActor;
}

/**
 * `booking.cancelled.v1` (producer-pending, CR-P04-C3): the booking will not
 * happen. Emitted once, in the transaction that records Dispatch's acceptance
 * of the cancellation. Billing settles from its own request (P04-C saga), not
 * from this event; consumers use it for projections and notifications.
 */
export interface BookingCancelledV1 extends EnvelopeHead<typeof BOOKING_CANCELLED_V1> {
  readonly data: {
    readonly status: 'CANCELLED';
    readonly changeId: string;
    readonly reason: CancellationReason;
    readonly holdId: string;
    readonly zoneId: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly paymentMethod: PaymentMethod;
    readonly total: MoneyWire;
  };
}

/** `booking.rescheduled.v1` (producer-pending, CR-P04-C3): the commitment moved. */
export interface BookingRescheduledV1 extends EnvelopeHead<typeof BOOKING_RESCHEDULED_V1> {
  readonly data: {
    readonly changeId: string;
    readonly scheduleRevision: number;
    readonly previous: {
      readonly holdId: string;
      readonly startsAt: string;
      readonly endsAt: string;
    };
    readonly current: {
      readonly holdId: string;
      readonly zoneId: string;
      readonly startsAt: string;
      readonly endsAt: string;
    };
  };
}

export type BookingEvent = BookingCreatedV1 | BookingCancelledV1 | BookingRescheduledV1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('INVALID_EVENT_UUID');
  return value;
}

export function bookingCreatedEvent(input: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly traceparent: string | null;
  readonly booking: Booking;
}): BookingCreatedV1 {
  const { booking } = input;
  const slot = booking.slot;
  if (booking.status !== 'CONFIRMED' || slot === null || booking.confirmedAt === null) {
    throw new Error('BOOKING_NOT_CONFIRMED');
  }
  return {
    eventId: uuid(input.eventId),
    eventType: BOOKING_CREATED_V1,
    envelopeVersion: 2,
    producer: 'booking',
    occurredAt: booking.confirmedAt.toISOString(),
    correlationId: uuid(input.correlationId),
    causationId: input.causationId === null ? null : uuid(input.causationId),
    traceparent:
      input.traceparent !== null && TRACEPARENT.test(input.traceparent) ? input.traceparent : null,
    aggregate: { type: 'booking', id: uuid(booking.id), version: booking.version },
    // The principal the booking was made for caused it; ids only.
    actor: { kind: booking.beneficiary.kind, id: uuid(booking.beneficiary.subjectId) },
    data: {
      status: 'CONFIRMED',
      beneficiary: booking.beneficiary,
      zoneId: uuid(slot.zoneId),
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      holdId: uuid(slot.holdId),
      quoteId: uuid(booking.quote.quoteId),
      quoteRevision: booking.quote.revision,
      total: moneyToWire(booking.total),
      paymentMethod: booking.paymentMethod,
    },
  };
}

function changeActor(requester: Requester): EventActor {
  // Staff are Identity accounts; the event never says more than the subject id.
  return { kind: requester.kind === 'guest' ? 'guest' : 'account', id: uuid(requester.subjectId) };
}

function head<TType extends string>(
  eventType: TType,
  input: {
    readonly eventId: string;
    readonly correlationId: string;
    readonly traceparent: string | null;
    readonly booking: Booking;
    readonly change: ChangeState;
  },
): EnvelopeHead<TType> {
  return {
    eventId: uuid(input.eventId),
    eventType,
    envelopeVersion: 2,
    producer: 'booking',
    occurredAt: input.booking.updatedAt.toISOString(),
    correlationId: uuid(input.correlationId),
    causationId: null,
    traceparent:
      input.traceparent !== null && TRACEPARENT.test(input.traceparent) ? input.traceparent : null,
    aggregate: { type: 'booking', id: uuid(input.booking.id), version: input.booking.version },
    actor: changeActor(input.change.requester),
  };
}

export function bookingCancelledEvent(input: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly traceparent: string | null;
  readonly booking: Booking;
  readonly change: ChangeState;
}): BookingCancelledV1 {
  const { booking, change } = input;
  if (booking.status !== 'CANCELLED' || booking.cancellation === null) {
    throw new Error('BOOKING_NOT_CANCELLED');
  }
  return {
    ...head(BOOKING_CANCELLED_V1, input),
    data: {
      status: 'CANCELLED',
      changeId: uuid(change.changeId),
      reason: booking.cancellation.reason,
      holdId: uuid(change.from.holdId),
      zoneId: uuid(change.from.zoneId),
      startsAt: change.from.startsAt.toISOString(),
      endsAt: change.from.endsAt.toISOString(),
      paymentMethod: booking.paymentMethod,
      total: moneyToWire(booking.total),
    },
  };
}

export function bookingRescheduledEvent(input: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly traceparent: string | null;
  readonly booking: Booking;
  readonly change: ChangeState;
}): BookingRescheduledV1 {
  const { booking, change } = input;
  const current = booking.rescheduledSlot;
  if (current === null || change.to === null || current.holdId !== change.to.holdId) {
    throw new Error('BOOKING_NOT_RESCHEDULED');
  }
  return {
    ...head(BOOKING_RESCHEDULED_V1, input),
    data: {
      changeId: uuid(change.changeId),
      scheduleRevision: booking.scheduleRevision,
      previous: {
        holdId: uuid(change.from.holdId),
        startsAt: change.from.startsAt.toISOString(),
        endsAt: change.from.endsAt.toISOString(),
      },
      current: {
        holdId: uuid(current.holdId),
        zoneId: uuid(current.zoneId),
        startsAt: current.startsAt.toISOString(),
        endsAt: current.endsAt.toISOString(),
      },
    },
  };
}
