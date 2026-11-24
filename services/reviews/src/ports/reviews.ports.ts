import type { PrincipalRef, reviewsV1 } from '@carwash/contracts';
import type { Review } from '../domain/review';

export interface VerifiedActor {
  readonly principal: PrincipalRef;
  readonly permissions: readonly string[];
}

export interface IdentityAuthority {
  verify(credential: string | undefined, correlationId: string): Promise<VerifiedActor>;
}

export interface RequestContext {
  readonly actor: VerifiedActor;
  /** Kept in memory only, forwarded solely to the configured Booking origin. */
  readonly credential: string;
  readonly correlationId: string;
}

export interface BookingFact {
  readonly bookingId: string;
  readonly revision: number;
  readonly beneficiary: PrincipalRef;
  readonly status: string;
}

export interface BookingAuthority {
  read(context: RequestContext, bookingId: string): Promise<BookingFact | null>;
}

export interface ReviewRecord {
  readonly view: Review;
  /** Minimal owner fact at submission; no Booking address, contact or quote is retained. */
  readonly bookingRevision: number;
  readonly bookingVerifiedAt: string;
}

export interface CommandIdentity {
  readonly actor: PrincipalRef;
  readonly operation: 'SUBMIT' | 'MODERATE';
  readonly key: string;
}

export interface CommandReceipt {
  readonly fingerprint: string;
  readonly view: Review;
}

export interface ReviewChange {
  readonly next: ReviewRecord;
  readonly previous: Review | null;
  readonly actor: PrincipalRef;
  readonly action: 'SUBMIT' | reviewsV1.ModerationDecision;
  readonly correlationId: string;
  readonly eventId: string;
  readonly payload: string;
  readonly command: CommandIdentity;
  readonly fingerprint: string;
}

export interface ReviewTransaction {
  /** Fail fast for an identical in-flight key; all command effects commit atomically. */
  lockCommand(command: CommandIdentity): Promise<boolean>;
  receipt(command: CommandIdentity): Promise<CommandReceipt | null>;
  lockBooking(bookingId: string): Promise<void>;
  byBooking(bookingId: string): Promise<ReviewRecord | null>;
  lockReview(reviewId: string): Promise<ReviewRecord | null>;
  apply(change: ReviewChange): Promise<void>;
}

export interface QueueCursor {
  readonly asOf: string;
  readonly submittedAt: string;
  readonly reviewId: string;
}

export interface ReviewsStore {
  receipt(command: CommandIdentity): Promise<CommandReceipt | null>;
  byBooking(bookingId: string): Promise<ReviewRecord | null>;
  pending(asOf: string, after: QueueCursor | null, limit: number): Promise<readonly ReviewRecord[]>;
  transaction<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T>;
}

export interface ReviewsDependencies {
  readonly store: ReviewsStore;
  readonly booking: BookingAuthority;
  readonly uuid: () => string;
  readonly now: () => Date;
}
