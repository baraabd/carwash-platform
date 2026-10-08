import { billingV1, bookingV1, type Page } from '@carwash/contracts';
import { callRoute } from './routes.js';
import type { ApiResult, CallContext, HttpClient } from './transport.js';

/**
 * Typed calls for the P02 booking journey. Each binds the owner route to its
 * published request/response parser, so a caller cannot pair a route with the
 * wrong shape. Requests are parsed BEFORE sending: a malformed booking never
 * leaves the client. Retries MUST reuse the same idempotency key.
 */

export function createBooking(
  client: HttpClient,
  request: bookingV1.CreateBookingRequestV1,
  idempotencyKey: string,
  context: CallContext = {},
): Promise<ApiResult<bookingV1.BookingV1>> {
  return callRoute(client, bookingV1.BOOKING_V1, 'createBooking', {
    ...context,
    body: bookingV1.parseCreateBookingRequestV1(request),
    idempotencyKey,
    parse: (value) => bookingV1.parseBookingV1(value),
  });
}

export function getBooking(
  client: HttpClient,
  bookingId: string,
  context: CallContext = {},
): Promise<ApiResult<bookingV1.BookingV1>> {
  return callRoute(client, bookingV1.BOOKING_V1, 'getBooking', {
    ...context,
    params: { bookingId },
    parse: (value) => bookingV1.parseBookingV1(value),
  });
}

export function listMyBookings(
  client: HttpClient,
  page: { readonly limit?: number; readonly cursor?: string } = {},
  context: CallContext = {},
): Promise<ApiResult<Page<bookingV1.BookingSummaryV1>>> {
  return callRoute(client, bookingV1.BOOKING_V1, 'listMine', {
    ...context,
    query: { limit: page.limit, cursor: page.cursor },
    parse: (value) => bookingV1.parseBookingPageV1(value),
  });
}

export function cancelBooking(
  client: HttpClient,
  bookingId: string,
  request: bookingV1.CancelBookingRequestV1,
  idempotencyKey: string,
  context: CallContext = {},
): Promise<ApiResult<bookingV1.BookingV1>> {
  return callRoute(client, bookingV1.BOOKING_V1, 'cancelBooking', {
    ...context,
    params: { bookingId },
    body: bookingV1.parseCancelBookingRequestV1(request),
    idempotencyKey,
    parse: (value) => bookingV1.parseBookingV1(value),
  });
}

export function getRepeatDraft(
  client: HttpClient,
  bookingId: string,
  context: CallContext = {},
): Promise<ApiResult<bookingV1.RepeatDraftV1>> {
  return callRoute(client, bookingV1.BOOKING_V1, 'getRepeatDraft', {
    ...context,
    params: { bookingId },
    parse: (value) => bookingV1.parseRepeatDraftV1(value),
  });
}

export function getBookingPayment(
  client: HttpClient,
  bookingId: string,
  context: CallContext = {},
): Promise<ApiResult<billingV1.PaymentV1>> {
  return callRoute(client, billingV1.BILLING_V1, 'getBookingPayment', {
    ...context,
    params: { bookingId },
    parse: (value) => billingV1.parsePaymentV1(value),
  });
}

export function submitTransferProof(
  client: HttpClient,
  paymentId: string,
  request: billingV1.SubmitTransferProofRequestV1,
  idempotencyKey: string,
  context: CallContext = {},
): Promise<ApiResult<billingV1.PaymentV1>> {
  return callRoute(client, billingV1.BILLING_V1, 'submitTransferProof', {
    ...context,
    params: { paymentId },
    body: billingV1.parseSubmitTransferProofRequestV1(request),
    idempotencyKey,
    parse: (value) => billingV1.parsePaymentV1(value),
  });
}
