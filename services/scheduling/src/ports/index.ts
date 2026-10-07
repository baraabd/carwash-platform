/**
 * scheduling ports: what the application needs from the outside world.
 *
 * Framework-free. Adapters live in infrastructure/ and transport/.
 */
import type { CapacityWindowState, HoldState, SchedulingEvent } from '../domain';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

/** Service-to-service scopes this service understands. Deny by default. */
export const SCHEDULING_SCOPES = [
  'scheduling.availability.read',
  'scheduling.holds.write',
] as const;
export type SchedulingScope = (typeof SCHEDULING_SCOPES)[number];

/**
 * The authenticated caller, resolved at the transport edge.
 *
 * USER permissions come from Identity's own session view, never from a header
 * the caller could forge. SERVICE identity comes from a configured credential.
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
export type InsertHoldResult = 'CREATED' | 'DUPLICATE_IDEMPOTENCY_KEY';

/**
 * One local ACID transaction. Lock order is ALWAYS window -> hold, in every
 * command and in the expiry sweeper, so two transactions cannot deadlock on
 * the pair. Every update is version-guarded; a mismatch is a hard failure.
 */
export interface SchedulingTransaction {
  /** SELECT ... FOR UPDATE. With skipLocked, returns null instead of waiting. */
  lockWindow(
    id: string,
    options?: { readonly skipLocked?: boolean },
  ): Promise<CapacityWindowState | null>;
  insertWindow(window: CapacityWindowState): Promise<InsertWindowResult>;
  updateWindow(window: CapacityWindowState, expectedVersion: number): Promise<void>;
  /** Caller must already hold the lock on the hold's window. */
  lockHold(id: string): Promise<HoldState | null>;
  /** ACTIVE holds of the (locked) window whose deadline is at or before `now`. */
  lockDueHolds(windowId: string, now: Date): Promise<HoldState[]>;
  insertHold(hold: HoldState): Promise<InsertHoldResult>;
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
  findHoldByIdempotencyKey(clientId: string, key: string): Promise<HoldState | null>;
  availability(input: {
    readonly zoneId: string;
    readonly from: Date;
    readonly to: Date;
    readonly now: Date;
  }): Promise<AvailabilityRow[]>;
  /** Windows that currently own at least one due ACTIVE hold. */
  windowsWithDueHolds(now: Date, limit: number): Promise<string[]>;
}
