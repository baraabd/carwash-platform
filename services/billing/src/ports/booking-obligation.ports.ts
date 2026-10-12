import type { Money } from '../domain';
import type { PrincipalRef } from './billing.ports';

/**
 * Ports for the booking-saga routes of billing.v1 (`createBookingObligation`,
 * `voidBookingObligation`, access `service:billing.obligation.write`).
 *
 * The caller is a workload (the Booking saga), never a person: it creates the
 * obligation FOR the booking's beneficiary and voids it as compensation.
 */

/** Billing's service-scope vocabulary. Deny by default: nothing else exists. */
export const BILLING_SERVICE_SCOPES = ['billing.obligation.write'] as const;
export type BillingServiceScope = (typeof BILLING_SERVICE_SCOPES)[number];

export type ServiceDenial = 'UNAUTHENTICATED' | 'SCOPE_DENIED';

export type ServiceDecision =
  | { readonly ok: true; readonly clientId: string }
  | { readonly ok: false; readonly reason: ServiceDenial };

/** Authenticates a workload credential and requires one scope. */
export interface ServiceCallerAuthority {
  authorize(
    clientId: string | undefined,
    token: string | undefined,
    scope: BillingServiceScope,
  ): ServiceDecision;
}

/**
 * The booking an obligation was created for, and by which workload. One booking
 * has at most one obligation and one obligation belongs to at most one booking
 * (both unique in the database). Immutable except the single void stamp.
 */
export interface BookingLink {
  readonly bookingId: string;
  readonly obligationId: string;
  readonly clientId: string;
  readonly createdAt: Date;
  readonly voidedAt: Date | null;
}

export class BookingAlreadyLinked extends Error {
  constructor() {
    super('BOOKING_ALREADY_LINKED');
    this.name = 'BookingAlreadyLinked';
  }
}

/** Booking links inside the caller's ONE local transaction. */
export interface BookingLinkStore {
  forBooking(bookingId: string): Promise<BookingLink | null>;
  forObligation(obligationId: string): Promise<BookingLink | null>;
  /** Throws BookingAlreadyLinked when the booking or the obligation is already linked. */
  insert(link: BookingLink, correlationId: string): Promise<void>;
  /** Sets the void stamp once; the obligation must already be VOIDED in this transaction. */
  markVoided(obligationId: string, at: Date, correlationId: string): Promise<void>;
}

/** Booking-link reads outside a transaction (the decision is re-checked inside). */
export interface BookingLinkReader {
  forBooking(bookingId: string): Promise<BookingLink | null>;
  forObligation(obligationId: string): Promise<BookingLink | null>;
}

/** Pricing's server-computed total for a quote that is valid for the beneficiary. */
export type QuoteValidation =
  { readonly kind: 'VALID'; readonly total: Money } | { readonly kind: 'NOT_USABLE' };

/**
 * pricing.v1 `validateQuote` on Billing's own workload credential. Throws
 * QuoteUnavailable on any outage, timeout, refusal of Billing's credential or
 * malformed answer: never a guessed amount.
 */
export interface QuoteValidator {
  validate(
    quoteId: string,
    beneficiary: PrincipalRef,
    correlationId: string,
  ): Promise<QuoteValidation>;
}
