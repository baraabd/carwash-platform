import type { OwnerOutcome } from '../../domain';
import {
  OwnerReadError,
  type BookingOwner,
  type BookingState,
  type OnBehalfOf,
  type OwnerRequest,
} from '../../ports';
import {
  id,
  instant,
  ownerGet,
  ownerPost,
  record,
  revision,
  state,
  type OwnerEndpoint,
} from './owner-http';

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
    const slot = record(b.schedule ?? b.slot);
    return {
      bookingId: id(b.bookingId),
      revision: revision(b.revision),
      status: state(b.status),
      confirmation: state(b.confirmation),
      startsAt: instant(slot.startsAt),
      endsAt: instant(slot.endsAt),
    };
  }

  /** Uses the frozen revision/key and the human's own authority on every retry. */
  async execute(auth: OnBehalfOf, request: OwnerRequest): Promise<OwnerOutcome> {
    if (request.operation !== 'booking.cancel' && request.operation !== 'booking.reschedule')
      throw new Error('NOT_A_BOOKING_OPERATION');
    const reschedule = request.operation === 'booking.reschedule';
    const { expectedRevision, holdId, holdRevision, reasonCode } = request.body;
    // Historical decisions cannot manufacture a new hold from dates on resend.
    if (reschedule && (typeof holdId !== 'string' || typeof holdRevision !== 'number'))
      return { kind: 'UNAVAILABLE', code: 'BOOKING_HOLD_REQUIRED' };
    const reason =
      reasonCode === 'CUSTOMER_REQUEST'
        ? 'CUSTOMER_REQUEST_BY_PHONE'
        : reasonCode === 'TECHNICIAN_UNAVAILABLE' || reasonCode === 'WEATHER_OR_SAFETY'
          ? 'SERVICE_UNAVAILABLE'
          : 'OPERATIONS_REQUEST';
    const result = await ownerPost(
      this.endpoint,
      `${BOOKING}/bookings/${request.targetId}/${reschedule ? 'reschedule' : 'cancellation'}`,
      auth,
      request.key,
      reschedule ? { expectedRevision, holdId, holdRevision } : { expectedRevision, reason },
      (body) => {
        const change = record(body);
        id(change.changeId);
        if (
          id(change.bookingId) !== request.targetId ||
          change.kind !== (reschedule ? 'RESCHEDULE' : 'CANCELLATION')
        )
          return null;
        return ['IN_PROGRESS', 'COMPLETED', 'REFUSED', 'FAILED'].includes(String(change.state))
          ? String(change.state)
          : null;
      },
    );
    if (result.kind !== 'APPLIED') return result;
    if (result.ownerState === 'IN_PROGRESS')
      return { ...result, kind: 'PENDING', ownerState: 'IN_PROGRESS', code: 'OWNER_IN_PROGRESS' };
    if (result.ownerState !== 'COMPLETED')
      return { kind: 'REJECTED', ownerStatus: 409, code: `BOOKING_CHANGE_${result.ownerState}` };
    return result;
  }
}
