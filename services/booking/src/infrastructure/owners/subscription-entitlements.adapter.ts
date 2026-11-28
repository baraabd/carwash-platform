import { subscriptionV1 } from '@carwash/contracts';
import type { Booking, EntitlementResult, VoidResult } from '../../domain';
import type { BookingEntitlements } from '../../ports';
import type { OwnerHttpClient } from '../http/owner-http.client';

const PREFIX = '/internal/v1/subscription/entitlement-reservations';
export class SubscriptionEntitlementsAdapter implements BookingEntitlements {
  constructor(private readonly http: OwnerHttpClient) {}

  async reserve(booking: Booking, correlationId: string): Promise<EntitlementResult> {
    const selection = booking.subscription;
    const line = booking.quote.lines[0];
    if (
      !selection ||
      !line?.definitionId ||
      line.kind !== 'PACKAGE' ||
      booking.quote.lines.length !== 1
    )
      return { kind: 'REJECTED' };
    const result = await this.http.call({
      method: 'POST',
      path: PREFIX,
      correlationId,
      idempotencyKey: `booking-entitlement-reserve-${booking.id}`,
      body: {
        ...selection,
        beneficiary: booking.beneficiary,
        bookingId: booking.id,
        packageId: line.definitionId,
        vehicleType: booking.quote.vehicleType,
        scheduledFor: booking.requestedSlot.startsAt.toISOString(),
      },
    });
    if (result.kind !== 'RESPONSE') return { kind: 'UNAVAILABLE', error: result.error };
    if (result.status === 200 || result.status === 201) {
      try {
        const reservation = subscriptionV1.parseEntitlementReservationV1(result.body);
        if (
          reservation.bookingId !== booking.id ||
          reservation.subscriptionId !== selection.subscriptionId ||
          reservation.packageId !== line.definitionId ||
          reservation.status !== 'RESERVED'
        )
          return { kind: 'UNAVAILABLE', error: 'ENTITLEMENT_CONTRACT_MISMATCH' };
        return { kind: 'RESERVED', reservationId: reservation.reservationId };
      } catch {
        return { kind: 'UNAVAILABLE', error: 'ENTITLEMENT_CONTRACT_INVALID' };
      }
    }
    if ([400, 404, 409, 412, 422].includes(result.status)) return { kind: 'REJECTED' };
    return { kind: 'UNAVAILABLE', error: `ENTITLEMENT_HTTP_${result.status}` };
  }

  releaseForBooking(
    bookingId: string,
    reservationId: string | null,
    correlationId: string,
  ): Promise<VoidResult> {
    if (reservationId === null)
      return Promise.resolve({ kind: 'UNAVAILABLE', error: 'RESERVATION_REFERENCE_UNKNOWN' });
    return this.resolve(bookingId, reservationId, 'RELEASE', correlationId);
  }
  consume(bookingId: string, reservationId: string, correlationId: string): Promise<VoidResult> {
    return this.resolve(bookingId, reservationId, 'CONSUME', correlationId);
  }
  private async resolve(
    bookingId: string,
    reservationId: string,
    action: 'CONSUME' | 'RELEASE',
    correlationId: string,
  ): Promise<VoidResult> {
    const result = await this.http.call({
      method: 'POST',
      path: `${PREFIX}/${encodeURIComponent(reservationId)}/resolution`,
      correlationId,
      idempotencyKey: `booking-entitlement-${action.toLowerCase()}-${bookingId}`,
      body: { bookingId, action },
    });
    if (result.kind !== 'RESPONSE') return { kind: 'UNAVAILABLE', error: result.error };
    if (result.status === 200) {
      try {
        const reservation = subscriptionV1.parseEntitlementReservationV1(result.body);
        if (
          reservation.reservationId === reservationId &&
          reservation.bookingId === bookingId &&
          reservation.status === (action === 'CONSUME' ? 'CONSUMED' : 'RELEASED')
        )
          return { kind: 'VOIDED' };
      } catch {
        /* A malformed acknowledgement proves no resolution. */
      }
    }
    return { kind: 'UNAVAILABLE', error: `ENTITLEMENT_RESOLUTION_HTTP_${result.status}` };
  }
}
