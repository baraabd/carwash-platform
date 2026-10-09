import type { Booking, BookingEvent, PrincipalKind, SagaState } from '../domain';
import type { Actor } from './runtime.ports';

/** Idempotency scope of a create command: principal + contract operation + key. */
export interface RequestKey {
  readonly principalKind: PrincipalKind;
  readonly subject: string;
  readonly key: string;
  readonly fingerprint: string;
}

/**
 * Outcome of claiming an Idempotency-Key for snapshot capture.
 *
 *   NEW          this caller owns the claim (fenced by `fence`);
 *   TAKEN_OVER   an earlier claim crashed before binding; this caller now owns it;
 *   BOUND        a booking already exists for the key: replay it;
 *   IN_PROGRESS  another request is capturing for this key right now;
 *   CONFLICT     the key was used with a different request body.
 */
export type RequestClaim =
  | { readonly kind: 'NEW' | 'TAKEN_OVER'; readonly bookingId: string; readonly fence: number }
  | { readonly kind: 'BOUND'; readonly bookingId: string }
  | { readonly kind: 'IN_PROGRESS' }
  | { readonly kind: 'CONFLICT' };

export type InsertBookingResult =
  | 'CREATED'
  /** Another live booking already uses this hold (one logical booking per hold). */
  | 'HOLD_TAKEN'
  /** Another live booking already uses this quote. */
  | 'QUOTE_TAKEN'
  /** The request claim was taken over by another attempt; nothing was written. */
  | 'CLAIM_LOST';

export interface AuditFact {
  readonly action: string;
  readonly actor: Actor;
  readonly bookingId: string;
  readonly correlationId: string;
  /** Opaque, non-personal facts only. */
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SagaLease {
  readonly owner: string;
  readonly fence: number;
}

/** A booking together with its saga, as read for the API and the process manager. */
export interface BookingRecord {
  readonly booking: Booking;
  readonly saga: SagaState;
  /** Correlation id of the request that created the booking; reused by every saga step. */
  readonly correlationId: string;
}

/**
 * Booking persistence. Each method is ONE local ACID transaction in the
 * booking database; there is no cross-service transaction anywhere.
 *
 * Fencing: every saga write is conditional on the lease (owner + fence) the
 * writer obtained. A worker that stalled past its lease, or was superseded by
 * another replica, gets `false` and must stop; its remote calls were
 * idempotent, so a duplicate attempt never produces a duplicate effect.
 */
export interface BookingStore {
  claimRequest(
    key: RequestKey,
    candidateBookingId: string,
    now: Date,
    leaseMs: number,
  ): Promise<RequestClaim>;
  /** Capture failed definitively: forget the claim (failures are not cached). */
  abandonRequest(key: RequestKey, fence: number): Promise<void>;
  /** Booking + saga + claim binding + audit, atomically, only while the claim is ours. */
  insertBooking(
    booking: Booking,
    saga: SagaState,
    claim: { readonly key: RequestKey; readonly fence: number },
    audit: AuditFact,
  ): Promise<InsertBookingResult>;
  find(bookingId: string): Promise<BookingRecord | null>;

  /** Lease one saga that is due now (or immediately, when `force`). */
  leaseSaga(
    bookingId: string,
    owner: string,
    now: Date,
    leaseMs: number,
  ): Promise<{ readonly record: BookingRecord; readonly lease: SagaLease } | null>;
  /** Lease up to `limit` due sagas, SKIP LOCKED, oldest first. */
  leaseDue(
    owner: string,
    now: Date,
    leaseMs: number,
    limit: number,
  ): Promise<{ readonly record: BookingRecord; readonly lease: SagaLease }[]>;
  /** Persist saga progress. Returns false when the lease was lost (fence check). */
  saveSaga(saga: SagaState, lease: SagaLease, release: boolean): Promise<boolean>;
  /**
   * Finish the saga together with the booking transition, its outbox event and
   * audit row, in one transaction, under the fence and the booking version.
   */
  finish(input: {
    readonly saga: SagaState;
    readonly lease: SagaLease;
    readonly booking: Booking;
    readonly expectedBookingVersion: number;
    readonly event: BookingEvent | null;
    readonly audit: AuditFact;
  }): Promise<boolean>;
}
