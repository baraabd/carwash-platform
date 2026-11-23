import { oneOf, parsePrincipalRef, parseRevision, record, uuid } from '@carwash/contracts';
import { ReviewsError } from '../../application/errors';
import type { BookingAuthority, BookingFact, RequestContext } from '../../ports/reviews.ports';
import { ownerGet, ownerJson, type OwnerEndpoint } from '../http/owner-http';

/**
 * Booking's existing CR-P02-C2 read, with the caller's own credential. A tolerant
 * reader of four strict fields: no address/contact/vehicle/quote enters Reviews.
 * No Booking implementation or database client is imported here.
 */
export class HttpBookingAuthority implements BookingAuthority {
  constructor(
    private readonly endpoint: OwnerEndpoint,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async read(context: RequestContext, bookingId: string): Promise<BookingFact | null> {
    const id = uuid(bookingId, '$.bookingId');
    const response = await ownerGet(
      this.endpoint,
      `/internal/v1/booking/bookings/${id}`,
      context.credential,
      context.correlationId,
      this.fetcher,
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      if (response.status === 404) return null;
      if (response.status === 401) throw new ReviewsError('AUTH_REQUIRED');
      if (response.status === 403) throw new ReviewsError('AUTH_FORBIDDEN');
      throw new ReviewsError('DEPENDENCY_UNAVAILABLE');
    }
    try {
      const body = record(await ownerJson(response, 65_536), '$');
      const fact = {
        bookingId: uuid(body.bookingId, '$.bookingId'),
        revision: parseRevision(body.revision, '$.revision'),
        beneficiary: parsePrincipalRef(body.beneficiary, '$.beneficiary'),
        status: oneOf(body.status, '$.status', [
          'PENDING_CONFIRMATION',
          'CONFIRMED',
          'ASSIGNED',
          'EN_ROUTE',
          'ARRIVED',
          'IN_PROGRESS',
          'COMPLETED',
          'CANCELLED',
          'EXPIRED',
          'REJECTED',
        ]),
      };
      if (fact.bookingId !== id) throw new Error('BOOKING_BINDING_MISMATCH');
      return fact;
    } catch {
      throw new ReviewsError('UPSTREAM_INVALID');
    }
  }
}
