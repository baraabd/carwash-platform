import type { OwnerOutcome } from '../../domain';
import {
  OwnerReadError,
  type BookingOwner,
  type BookingState,
  type OnBehalfOf,
  type OwnerRequest,
} from '../../ports';
import { id, instant, ownerGet, record, revision, state, type OwnerEndpoint } from './owner-http';

const BOOKING = '/internal/v1/booking';

/**
 * Booking's documented read (booking.v1 `BookingV1`, CR-P02-C2), called with
 * the deciding staff member's own credential.
 *
 * Tolerant reader: only id, revision, status, confirmation and the service
 * window are kept. Contact, address, vehicle, beneficiary and quote are
 * dropped here and never reach Support's database.
 */
export class BookingOwnerClient implements BookingOwner {
  constructor(private readonly endpoint: OwnerEndpoint) {}

  async booking(auth: OnBehalfOf, bookingId: string): Promise<BookingState | null> {
    const response = await ownerGet(this.endpoint, `${BOOKING}/bookings/${bookingId}`, auth);
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403)
      throw new OwnerReadError('OWNER_FORBIDDEN');
    if (response.status !== 200) throw new OwnerReadError('OWNER_UNAVAILABLE');
    const b = record(response.body);
    const slot = record(b.slot);
    return {
      bookingId: id(b.bookingId),
      revision: revision(b.revision),
      status: state(b.status),
      confirmation: state(b.confirmation),
      startsAt: instant(slot.startsAt),
      endsAt: instant(slot.endsAt),
    };
  }

  /**
   * Booking publishes no operational cancel or reschedule command yet
   * (CR-D-P04-03, owned by Lane C). Nothing is sent, so nothing can have
   * happened: the decision is BLOCKED_ON_OWNER, never "cancelled".
   */
  execute(_auth: OnBehalfOf, request: OwnerRequest): Promise<OwnerOutcome> {
    if (request.operation !== 'booking.cancel' && request.operation !== 'booking.reschedule')
      throw new Error('NOT_A_BOOKING_OPERATION');
    return Promise.resolve({ kind: 'UNAVAILABLE', code: 'OWNER_CAPABILITY_UNPUBLISHED' });
  }
}
