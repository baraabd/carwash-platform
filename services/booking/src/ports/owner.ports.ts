import type {
  AddressSnapshot,
  CommitResult,
  Money,
  ObligationResult,
  PaymentMethod,
  PrincipalRef,
  QuoteSnapshot,
  RejectionReason,
  SlotSnapshot,
  VehicleSnapshot,
  VoidResult,
} from '../domain';
import type { UserCredential } from './runtime.ports';

/**
 * Ports to the owner services Booking orchestrates. Each adapter speaks the
 * owner's published contract (or, for Billing, the requested one) and maps
 * every answer to one of these closed outcomes. A timeout is never success:
 *   - reads report UNAVAILABLE,
 *   - mutations report an outcome that keeps the saga retrying the SAME
 *     idempotent request (UNAVAILABLE / UNKNOWN), never a guessed result.
 */
export type ReadResult<T> =
  | { readonly kind: 'OK'; readonly value: T }
  /** The owner answered definitively that the record cannot be used. */
  | { readonly kind: 'NOT_USABLE'; readonly reason: string }
  | { readonly kind: 'UNAVAILABLE'; readonly error: string };

/** scheduling.v1 HoldV1 fields Booking relies on. */
export interface HoldView {
  readonly holdId: string;
  readonly revision: number;
  readonly state: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  readonly beneficiary: PrincipalRef;
  readonly zoneId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly expiresAt: Date;
  readonly bookingId: string | null;
}

export interface QuoteRead {
  readonly snapshot: QuoteSnapshot;
  readonly status: 'USABLE' | 'EXPIRED' | 'REVOKED';
}

/** pricing.v1 `GET /quotes/:quoteId`, on behalf of the quote's beneficiary. */
export interface QuoteReader {
  read(
    quoteId: string,
    credential: UserCredential,
    correlationId: string,
  ): Promise<ReadResult<QuoteRead>>;
}

/** scheduling.v1 `GET /holds/:holdId`, on behalf of the hold's beneficiary. */
export interface HoldReader {
  read(
    holdId: string,
    credential: UserCredential,
    correlationId: string,
  ): Promise<ReadResult<HoldView>>;
}

export interface SnapshotRequest {
  readonly owner: PrincipalRef;
  readonly id: string;
  readonly expectedRevision: number;
}

/** vehicle.v1 `POST /vehicle-snapshots/resolve` (service scope, purpose booking-create). */
export interface VehicleSnapshots {
  resolve(request: SnapshotRequest, correlationId: string): Promise<ReadResult<VehicleSnapshot>>;
}

/** customer.v1 `POST /address-snapshots/resolve` (service scope, purpose booking-create). */
export interface AddressSnapshots {
  resolve(request: SnapshotRequest, correlationId: string): Promise<ReadResult<AddressSnapshot>>;
}

export type QuoteValidation =
  | { readonly kind: 'VALID'; readonly total: Money }
  | { readonly kind: 'INVALID'; readonly reason: RejectionReason }
  | { readonly kind: 'UNAVAILABLE'; readonly error: string };

/** pricing.v1 `POST /quotes/:quoteId/validate` (service scope, safe). */
export interface QuoteValidator {
  validate(
    input: {
      readonly quoteId: string;
      readonly revision: number;
      readonly beneficiary: PrincipalRef;
    },
    correlationId: string,
  ): Promise<QuoteValidation>;
}

export interface ObligationRequest {
  readonly bookingId: string;
  readonly beneficiary: PrincipalRef;
  readonly quoteId: string;
  readonly quoteRevision: number;
  readonly amount: Money;
  readonly paymentMethod: PaymentMethod;
}

/**
 * Billing obligation for the booking (REQUESTED contract; see CR-P02-C2).
 * Both operations are idempotent by booking id. Voiding a booking whose
 * obligation never existed succeeds and leaves a tombstone, so a create that
 * arrives late can never resurrect it.
 */
export interface BillingObligations {
  create(request: ObligationRequest, correlationId: string): Promise<ObligationResult>;
  voidForBooking(bookingId: string, correlationId: string): Promise<VoidResult>;
}

export type HoldCommit =
  | { readonly kind: 'COMMITTED'; readonly slot: SlotSnapshot }
  | Exclude<CommitResult, { readonly kind: 'COMMITTED' }>;

/** scheduling.v1 `POST /holds/:holdId/commit` (service scope; replay-safe by bookingId). */
export interface HoldCommitter {
  commit(
    input: {
      readonly holdId: string;
      readonly expectedRevision: number;
      readonly bookingId: string;
    },
    correlationId: string,
  ): Promise<HoldCommit>;
}
