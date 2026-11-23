import type {
  Booking,
  BookingEvent,
  CapacityReleaseResult,
  ChangeState,
  ConfirmResult,
  DispatchCancelResult,
  RebindResult,
  ReplaceResult,
  RevertResult,
  Requester,
  SettlementResult,
  SlotSnapshot,
} from '../domain';
import type { AuditFact, SagaLease } from './store.ports';

/**
 * Ports of the P04-C3 change saga. Each owner adapter speaks the REQUESTED
 * contract of P04-C-interfaces.md and maps every answer to a closed outcome.
 * A timeout, 5xx, an unparsable body or an open circuit is UNKNOWN: the saga
 * retries the SAME request (same change id); it is never read as success.
 */

/** Dispatch §C2 (service scope dispatch.booking.change). */
export interface DispatchChanges {
  cancel(bookingId: string, changeId: string, correlationId: string): Promise<DispatchCancelResult>;
  rebind(
    bookingId: string,
    changeId: string,
    slot: SlotSnapshot,
    correlationId: string,
  ): Promise<RebindResult>;
  confirm(bookingId: string, changeId: string, correlationId: string): Promise<ConfirmResult>;
  revert(bookingId: string, changeId: string, correlationId: string): Promise<RevertResult>;
}

/** Scheduling §C1 (service scope scheduling.commitment.change). */
export interface CommitmentChanges {
  release(bookingId: string, holdId: string, correlationId: string): Promise<CapacityReleaseResult>;
  replace(
    input: {
      readonly bookingId: string;
      readonly fromHoldId: string;
      readonly toHoldId: string;
      readonly toExpectedRevision: number;
    },
    correlationId: string,
  ): Promise<ReplaceResult>;
}

/** Billing (Lane B, REQUESTED): void the obligation or open a refund case. */
export interface BillingCancellation {
  settle(bookingId: string, changeId: string, correlationId: string): Promise<SettlementResult>;
}

export type InsertChangeResult =
  | { readonly kind: 'CREATED' }
  /** The same requester already used this key: the change it created. */
  | { readonly kind: 'REPLAY'; readonly changeId: string }
  | { readonly kind: 'IDEMPOTENCY_CONFLICT' }
  | { readonly kind: 'CHANGE_IN_PROGRESS' }
  | { readonly kind: 'REVISION_CONFLICT' };

export interface ChangeRecord {
  readonly change: ChangeState;
  readonly correlationId: string;
}

/**
 * Change persistence: each method is ONE local transaction in the booking
 * database. Saga writes are fenced by (lease owner, fence) like the creation
 * saga; a superseded worker gets `false` and stops.
 */
export interface ChangeStore {
  /**
   * Insert the change (and its audit row) while the booking row is locked and
   * still at `expectedBookingVersion` with no other open change. The
   * (requester, Idempotency-Key) replay is decided first.
   */
  insertChange(input: {
    readonly change: ChangeState;
    readonly idempotencyKey: string;
    readonly fingerprint: string;
    readonly expectedBookingVersion: number;
    readonly correlationId: string;
    readonly audit: AuditFact;
  }): Promise<InsertChangeResult>;
  /** The change a requester created with this Idempotency-Key, if any. */
  findByKey(
    requester: Requester,
    idempotencyKey: string,
  ): Promise<{ readonly changeId: string; readonly fingerprint: string } | null>;
  findChange(changeId: string): Promise<ChangeRecord | null>;
  /** Newest first, bounded. */
  listChanges(bookingId: string, limit: number): Promise<ChangeState[]>;
  findOpenChange(bookingId: string): Promise<ChangeState | null>;

  leaseChange(
    changeId: string,
    owner: string,
    now: Date,
    leaseMs: number,
  ): Promise<{ readonly record: ChangeRecord; readonly lease: SagaLease } | null>;
  leaseDueChanges(
    owner: string,
    now: Date,
    leaseMs: number,
    limit: number,
  ): Promise<{ readonly record: ChangeRecord; readonly lease: SagaLease }[]>;
  /** Persist progress; false when the lease was lost. */
  saveChange(change: ChangeState, lease: SagaLease, release: boolean): Promise<boolean>;
  /**
   * Persist a step transition together with the booking update it implies
   * (cancellation / new schedule), its outbox event and audit row, in one
   * transaction under the fence and the booking version. `release` frees the
   * lease (the change finished).
   */
  applyChange(input: {
    readonly change: ChangeState;
    readonly lease: SagaLease;
    readonly release: boolean;
    readonly booking: Booking | null;
    readonly expectedBookingVersion: number | null;
    readonly event: BookingEvent | null;
    readonly audit: AuditFact | null;
  }): Promise<boolean>;
}
