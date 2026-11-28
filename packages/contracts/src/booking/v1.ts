import type { OwnerContract } from '../common/route';
import { parseRevision } from '../common/protocol';
import { closed, uuid } from '../common/wire';

/** Booking owns the hold facade and the financial-source decision, never client payment claims. */
export const BOOKING_V1 = {
  id: 'booking.v1',
  owner: 'booking',
  prefix: '/internal/v1/booking',
  routes: {
    createBooking: { method: 'POST', path: '/bookings', access: 'principal', idempotent: true },
    getBooking: { method: 'GET', path: '/bookings/:bookingId', access: 'principal' },
    getTechnicianView: {
      method: 'GET',
      path: '/bookings/:bookingId/technician-view',
      access: 'permission:work.read:assigned',
    },
    getMine: { method: 'GET', path: '/mine', access: 'principal', paged: true },
    getByRequest: {
      method: 'GET',
      path: '/bookings/by-request/:idempotencyKey',
      access: 'principal',
    },
    createHold: { method: 'POST', path: '/booking-holds', access: 'principal', idempotent: true },
    getHold: { method: 'GET', path: '/booking-holds/:holdId', access: 'principal' },
    releaseHold: {
      method: 'POST',
      path: '/booking-holds/:holdId/release',
      access: 'principal',
      idempotent: true,
    },
    cancel: {
      method: 'POST',
      path: '/bookings/:bookingId/cancellation',
      access: 'principal',
      idempotent: true,
    },
    reschedule: {
      method: 'POST',
      path: '/bookings/:bookingId/reschedule',
      access: 'principal',
      idempotent: true,
    },
  },
  reasons: [
    'SUBSCRIPTION_COVERAGE_UNSUPPORTED',
    'ENTITLEMENT_REJECTED',
    'SUBSCRIPTION_RESCHEDULE_UNAVAILABLE',
  ],
} as const satisfies OwnerContract;

/** Optional create field; validated by Subscription, never a client assertion of payment. */
export interface SubscriptionSelectionV1 {
  readonly subscriptionId: string;
  readonly expectedRevision: number;
}
export function parseSubscriptionSelectionV1(raw: unknown): SubscriptionSelectionV1 {
  const s = closed(raw, '$.subscription', ['subscriptionId', 'expectedRevision']);
  return {
    subscriptionId: uuid(s.subscriptionId, '$.subscription.subscriptionId'),
    expectedRevision: parseRevision(s.expectedRevision, '$.subscription.expectedRevision'),
  };
}
/**
 * Direct creates require a payment method. Covered creates may omit it; any
 * supplied supported method is ignored for funding. The legacy response/event
 * method remains a compatibility value, never cash due or payment evidence.
 * Consumers must use financialSource, then the responsible owner's receipts.
 */
export type BookingFundingRequestV1 =
  | {
      readonly subscription?: never;
      readonly paymentMethod: 'CASH_ON_COMPLETION' | 'SHAM_CASH' | 'SYRIATEL_CASH';
    }
  | {
      readonly subscription: SubscriptionSelectionV1;
      readonly paymentMethod?: 'CASH_ON_COMPLETION' | 'SHAM_CASH' | 'SYRIATEL_CASH';
    };
/** A quoted retail total remains immutable; financialSource defines who funds its coverage. */
export interface BookingFundingV1 {
  readonly financialSource: 'DIRECT' | 'SUBSCRIPTION';
  readonly entitlementReservationId: string | null;
  readonly obligationId: string | null;
}
