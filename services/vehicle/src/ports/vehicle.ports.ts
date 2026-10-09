import type { Owner, ResolvePurpose, Vehicle, VehicleInput } from '../domain';

/** Injected time source. Every persisted timestamp is UTC and comes from here. */
export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

/**
 * Credentials exactly as the caller presented them. They are forwarded to
 * Identity for verification and never stored, logged or put in an event.
 */
export interface SessionCredentials {
  readonly authorization?: string;
  readonly cookie?: string;
  readonly origin?: string;
  readonly secFetchSite?: string;
  readonly csrfToken?: string;
  readonly correlationId: string;
}

/** A session that Identity confirmed as current (status, authVersion, session). */
export interface AuthorizedSession {
  readonly principal: Owner;
  readonly sessionId: string;
  readonly permissions: readonly string[];
}

export type AccessIntent = 'read' | 'write';

/** Identity is the only authentication authority. Implementations fail closed. */
export interface IdentityAuthorizer {
  authorize(credentials: SessionCredentials, intent: AccessIntent): Promise<AuthorizedSession>;
}

/** A calling workload whose identity and scopes the transport verified. */
export interface ServiceActor {
  readonly service: string;
  readonly scopes: readonly string[];
}

/**
 * Verifies the calling workload of a `service:` route. Workload identity is
 * P01-E5 (Lane E) and is not on main, so the only adapter refuses every call:
 * the snapshot route is deny-by-default until a real verifier is wired.
 */
export interface WorkloadAuthenticator {
  authenticate(credentials: SessionCredentials): Promise<ServiceActor>;
}

export interface IdempotencyRequest {
  readonly scope: string;
  readonly key: string;
  readonly operation: string;
  readonly fingerprint: string;
  readonly now: Date;
  readonly expiresAt: Date;
}

export type IdempotencyClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'mismatch' };

export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

/** Who caused an audited fact: a principal's session, or a service with a purpose. */
export type AuditActor =
  | { readonly kind: 'principal'; readonly subject: string; readonly sessionId: string }
  | { readonly kind: 'service'; readonly service: string; readonly purpose: ResolvePurpose };

/** Audit facts carry identifiers only; plates, names and colours are never copied. */
export interface AuditEntry {
  readonly id: string;
  readonly actor: AuditActor;
  readonly action: string;
  readonly vehicleId: string;
  readonly correlationId: string;
  readonly at: Date;
}

export interface NewVehicle extends VehicleInput {
  readonly id: string;
  readonly owner: Owner;
  readonly now: Date;
}

/** Keyset position: the page continues strictly after this (createdAt, id). */
export interface VehicleCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/** Operations that run inside ONE local ACID transaction. */
export interface VehicleTransaction {
  /** Expired records are reclaimed under a transaction-scoped lock, never replayed. */
  claimIdempotency(request: IdempotencyRequest): Promise<IdempotencyClaim>;
  completeIdempotency(scope: string, key: string, status: number, body: unknown): Promise<void>;
  /**
   * Serialises writers for one owner (transaction-scoped advisory lock), so the
   * active-vehicle limit cannot be overrun by concurrent creates.
   */
  lockOwner(owner: Owner): Promise<void>;
  countActiveVehicles(owner: Owner): Promise<number>;
  insertVehicle(vehicle: NewVehicle): Promise<Vehicle>;
  findOwnedVehicle(owner: Owner, vehicleId: string): Promise<Vehicle | null>;
  /** Compare-and-set on revision; null when the revision no longer matches. */
  updateVehicle(
    owner: Owner,
    vehicleId: string,
    input: VehicleInput,
    archived: boolean,
    expectedRevision: number,
    now: Date,
  ): Promise<Vehicle | null>;
  appendOutbox(event: OutboxEvent): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

export interface VehicleStore {
  transaction<T>(work: (tx: VehicleTransaction) => Promise<T>): Promise<T>;
  /** Active vehicles in (createdAt, id) order after the cursor, at most `limit` rows. */
  listActiveVehicles(owner: Owner, after: VehicleCursor | null, limit: number): Promise<Vehicle[]>;
}
