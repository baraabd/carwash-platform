/**
 * Dispatch ports: what the application needs from the outside world.
 *
 * Framework-free. Adapters live in infrastructure/ and transport/.
 */
import type {
  AssignmentState,
  AssignmentStatus,
  DispatchEvent,
  HoldObservation,
  OfferState,
} from '../domain';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

/** Service-to-service scopes this service grants. Deny by default. */
export const DISPATCH_SCOPES = ['dispatch.assignment.read'] as const;
export type DispatchScope = (typeof DISPATCH_SCOPES)[number];

/**
 * The authenticated caller, resolved at the edge.
 *
 * USER permissions come from Identity's own session view, never from a header
 * the caller could forge. SERVICE identity comes from a configured credential.
 * SYSTEM is an in-process component (expiry worker, event consumer).
 */
export type Actor =
  | {
      readonly kind: 'USER';
      readonly subject: string;
      readonly permissions: readonly string[];
    }
  | {
      readonly kind: 'SERVICE';
      readonly clientId: string;
      readonly scopes: readonly DispatchScope[];
    }
  | { readonly kind: 'SYSTEM'; readonly component: string };

export interface RequestMeta {
  readonly actor: Actor;
  readonly correlationId: string;
}

export interface OutboxAppend {
  readonly event: DispatchEvent;
  readonly exchange: string;
  readonly routingKey: string;
}

export interface AuditAppend {
  readonly action: string;
  readonly actor: Actor;
  readonly targetType: 'ASSIGNMENT' | 'OFFER' | 'HOLD';
  readonly targetId: string;
  readonly correlationId: string;
  /** Opaque, non-personal facts only. */
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

/** What a completed idempotent command produced; replays re-read it. */
export interface IdempotentResult {
  readonly resultType: 'ASSIGNMENT' | 'OFFER';
  readonly resultId: string;
}

export type IdempotencyClaim =
  | { readonly kind: 'NEW' }
  | { readonly kind: 'REPLAY'; readonly result: IdempotentResult }
  | { readonly kind: 'CONFLICT' };

export type InsertAssignmentResult = 'CREATED' | 'DUPLICATE_BOOKING' | 'DUPLICATE_HOLD';

/**
 * One local ACID transaction. Lock order is ALWAYS
 *   idempotency record -> hold observation -> assignment -> offer
 * in every command, in the event handler and in the expiry worker, so two
 * transactions cannot deadlock on these rows. Updates are version-guarded.
 */
export interface DispatchTransaction {
  /**
   * Insert (scope, key) or wait for a concurrent holder of it to finish, then
   * report NEW, a REPLAY of its committed result, or a fingerprint CONFLICT.
   * The record commits with the command's effect, so a failed command leaves
   * no record and a retry is evaluated afresh.
   */
  claimIdempotency(scope: string, key: string, fingerprint: string): Promise<IdempotencyClaim>;
  completeIdempotency(scope: string, key: string, result: IdempotentResult): Promise<void>;

  /** Serialises all event handling for one hold, then reads what is known. */
  lockHoldObservation(holdId: string): Promise<HoldObservation | null>;
  saveHoldObservation(observation: HoldObservation): Promise<void>;

  insertAssignment(assignment: AssignmentState): Promise<InsertAssignmentResult>;
  /** SELECT ... FOR UPDATE. With skipLocked, returns null instead of waiting. */
  lockAssignment(
    id: string,
    options?: { readonly skipLocked?: boolean },
  ): Promise<AssignmentState | null>;
  lockAssignmentByHold(holdId: string): Promise<AssignmentState | null>;
  /**
   * Version-guarded. Throws DispatchError RESOURCE_BUSY when the database
   * exclusion constraint rejects an overlapping assignment for the resource.
   */
  updateAssignment(assignment: AssignmentState, expectedVersion: number): Promise<void>;

  /**
   * Plain read inside this transaction (no lock), used only to find which
   * assignment to lock first. Reading through the pool instead would need a
   * second connection while this one is held and can starve the pool.
   */
  readOffer(id: string): Promise<OfferState | null>;
  /** Caller must already hold the lock on the offer's assignment. */
  lockOffer(id: string): Promise<OfferState | null>;
  /** The OFFERED or ACCEPTED offer of a locked assignment, if any. */
  lockCurrentOffer(assignmentId: string): Promise<OfferState | null>;
  insertOffer(offer: OfferState): Promise<void>;
  updateOffer(offer: OfferState, expectedVersion: number): Promise<void>;

  appendEvent(entry: OutboxAppend): Promise<void>;
  appendAudit(entry: AuditAppend): Promise<void>;
}

export interface DispatchUnitOfWork {
  run<T>(work: (tx: DispatchTransaction) => Promise<T>): Promise<T>;
}

export interface AssignmentQuery {
  readonly zoneId: string;
  readonly from: Date;
  readonly to: Date;
  readonly status: AssignmentStatus | null;
}

export interface DispatchReadModel {
  findAssignment(id: string): Promise<AssignmentState | null>;
  findAssignmentByBooking(bookingId: string): Promise<AssignmentState | null>;
  findOffer(id: string): Promise<OfferState | null>;
  findCurrentOffer(assignmentId: string): Promise<OfferState | null>;
  /** Jobs of a zone starting in [from, to), ordered by start; bounded. */
  listAssignments(query: AssignmentQuery): Promise<AssignmentState[]>;
  /** The technician's OFFERED and ACCEPTED offers whose job has not ended. */
  listTechnicianOffers(
    technicianSubject: string,
    now: Date,
  ): Promise<Array<{ readonly offer: OfferState; readonly assignment: AssignmentState }>>;
  /** Assignment ids that currently own an OFFERED offer whose deadline passed. */
  assignmentsWithDueOffers(now: Date, limit: number): Promise<string[]>;
}

/** Retention of idempotency records; purged by the expiry worker. */
export interface IdempotencyRetention {
  purgeIdempotencyBefore(cutoff: Date, limit: number): Promise<number>;
}
