/**
 * scheduling ports: what the application needs from the outside world.
 *
 * Framework-free. Adapters live in infrastructure/ and transport/.
 */
import type { CapacityWindowState, HoldState, PrincipalKind, SchedulingEvent } from '../domain';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

/**
 * Service-to-service scopes this service grants (scheduling.v1 `service:` access).
 * Deny by default.
 */
export const SCHEDULING_SCOPES = [
  'scheduling.hold.commit',
  'scheduling.commitment.change',
] as const;
export type SchedulingScope = (typeof SCHEDULING_SCOPES)[number];

/**
 * The authenticated caller, resolved at the edge.
 *
 * USER = an Identity principal (account or guest). Its kind and permissions come
 * from Identity's own session view, never from a header the caller could forge.
 * SERVICE = a configured workload credential with scopes.
 */
export type Actor =
  | {
      readonly kind: 'USER';
      readonly principalKind: PrincipalKind;
      readonly subject: string;
      readonly permissions: readonly string[];
    }
  | {
      readonly kind: 'SERVICE';
      readonly clientId: string;
      readonly scopes: readonly SchedulingScope[];
    }
  | { readonly kind: 'SYSTEM'; readonly component: string };

export interface RequestMeta {
  readonly actor: Actor;
  readonly correlationId: string;
}

export interface OutboxAppend {
  readonly event: SchedulingEvent;
  readonly exchange: string;
  readonly routingKey: string;
}

export interface AuditAppend {
  readonly action: string;
  readonly actor: Actor;
  readonly targetType: 'CAPACITY_WINDOW' | 'CAPACITY_HOLD';
  readonly targetId: string;
  readonly correlationId: string;
  /** Opaque, non-personal facts only. */
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export type InsertWindowResult = 'CREATED' | 'DUPLICATE_START' | 'OVERLAPS';

/** A stored command outcome, replayed verbatim for the same key and fingerprint. */
export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

export type IdempotencyClaim =
  | { readonly kind: 'NEW' }
  | { readonly kind: 'REPLAY'; readonly response: StoredResponse }
  | { readonly kind: 'CONFLICT' }
  /** Another transaction holds the claim and did not finish within the wait budget. */
  | { readonly kind: 'IN_PROGRESS' };

/**
 * One local ACID transaction. Lock order is ALWAYS
 *   idempotency record -> beneficiary -> window -> hold
 * in every command and in the expiry sweeper (which takes only window -> hold),
 * so transactions cannot deadlock on these rows. Updates are version-guarded.
 */
export interface SchedulingTransaction {
  /**
   * Insert (scope, key) or wait for a concurrent holder of it to finish, then
   * report NEW, a REPLAY of its committed response, or a fingerprint CONFLICT.
   */
  claimIdempotency(scope: string, key: string, fingerprint: string): Promise<IdempotencyClaim>;
  completeIdempotency(scope: string, key: string, response: StoredResponse): Promise<void>;
  /** Drop an uncompleted claim in this transaction so a later retry is evaluated afresh. */
  abandonIdempotency(scope: string, key: string): Promise<void>;
  /** Serialise all hold creation for one beneficiary (anti-hoarding count). */
  lockBeneficiary(kind: PrincipalKind, subject: string): Promise<void>;
  countActiveHolds(kind: PrincipalKind, subject: string, now: Date): Promise<number>;
  /** SELECT ... FOR UPDATE. With skipLocked, returns null instead of waiting. */
  lockWindow(
    id: string,
    options?: { readonly skipLocked?: boolean },
  ): Promise<CapacityWindowState | null>;
  /** The (single, non-overlapping) window of the zone covering the interval, locked. */
  lockCoveringWindow(
    zoneId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<CapacityWindowState | null>;
  insertWindow(window: CapacityWindowState): Promise<InsertWindowResult>;
  updateWindow(window: CapacityWindowState, expectedVersion: number): Promise<void>;
  /** Caller must already hold the lock on the hold's window. */
  lockHold(id: string): Promise<HoldState | null>;
  /** ACTIVE v1 holds of the (locked) window whose deadline is at or before `now`. */
  lockDueHolds(windowId: string, now: Date): Promise<HoldState[]>;
  /**
   * Expire due ACTIVE holds written by the pre-v1 (C1) API in the (locked)
   * window. They have no v1 facts and no published event; returns units freed.
   */
  expireLegacyDueHolds(windowId: string, now: Date): Promise<number>;
  insertHold(hold: HoldState): Promise<void>;
  updateHold(hold: HoldState, expectedVersion: number): Promise<void>;
  appendEvent(entry: OutboxAppend): Promise<void>;
  appendAudit(entry: AuditAppend): Promise<void>;
}

export interface SchedulingUnitOfWork {
  run<T>(work: (tx: SchedulingTransaction) => Promise<T>): Promise<T>;
}

export interface AvailabilityRow {
  readonly window: CapacityWindowState;
  /** Capacity minus reserved minus ACTIVE holds whose deadline is still ahead. */
  readonly freeUnits: number;
}

export interface SchedulingReadModel {
  findWindow(id: string): Promise<CapacityWindowState | null>;
  findWindowByStart(zoneId: string, startsAt: Date): Promise<CapacityWindowState | null>;
  findHold(id: string): Promise<HoldState | null>;
  /** Windows of the zone starting in [from, to), with live free units. */
  availability(input: {
    readonly zoneId: string;
    readonly from: Date;
    readonly to: Date;
    readonly now: Date;
  }): Promise<AvailabilityRow[]>;
  /** Windows that currently own at least one due ACTIVE hold. */
  windowsWithDueHolds(now: Date, limit: number): Promise<string[]>;
  /**
   * Delete idempotency records completed more than `retentionMs` ago by the
   * DATABASE clock (the same clock that stamped them); returns how many.
   */
  purgeIdempotency(retentionMs: number, limit: number): Promise<number>;
}
