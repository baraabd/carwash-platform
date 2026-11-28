import type { Booking, EntitlementResult, VoidResult } from '../domain';

export interface BookingEntitlements {
  reserve(booking: Booking, correlationId: string): Promise<EntitlementResult>;
  releaseForBooking(
    bookingId: string,
    reservationId: string | null,
    correlationId: string,
  ): Promise<VoidResult>;
  consume(bookingId: string, reservationId: string, correlationId: string): Promise<VoidResult>;
}
