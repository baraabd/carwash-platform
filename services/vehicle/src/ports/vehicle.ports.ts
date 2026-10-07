import type { Owner, Vehicle, VehicleDetails, VehicleStatus } from '../domain';

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

/** Audit facts carry identifiers only; plates, names and colours are never copied. */
export interface AuditEntry {
  readonly id: string;
  readonly actorSubject: string;
  readonly actorSessionId: string;
  readonly action: string;
  readonly vehicleId: string;
  readonly correlationId: string;
  readonly at: Date;
}

export interface NewVehicle extends VehicleDetails {
  readonly id: string;
  readonly owner: Owner;
  readonly now: Date;
}

/** Operations that run inside ONE local ACID transaction. */
export interface VehicleTransaction {
  claimIdempotency(request: IdempotencyRequest): Promise<IdempotencyClaim>;
  completeIdempotency(scope: string, key: string, status: number, body: unknown): Promise<void>;
  /**
   * Serialises writers for one owner (transaction-scoped advisory lock), so the
   * active-vehicle ceiling cannot be overrun by concurrent creates.
   */
  lockOwner(owner: Owner): Promise<void>;
  countActiveVehicles(owner: Owner): Promise<number>;
  insertVehicle(vehicle: NewVehicle): Promise<Vehicle>;
  findOwnedVehicle(owner: Owner, vehicleId: string): Promise<Vehicle | null>;
  /** Compare-and-set on revision; null when the revision no longer matches. */
  updateVehicle(
    owner: Owner,
    vehicleId: string,
    details: VehicleDetails,
    status: VehicleStatus,
    expectedRevision: number,
    now: Date,
  ): Promise<Vehicle | null>;
  appendOutbox(event: OutboxEvent): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

export interface VehicleStore {
  transaction<T>(work: (tx: VehicleTransaction) => Promise<T>): Promise<T>;
  listOwnedVehicles(owner: Owner, includeArchived: boolean): Promise<Vehicle[]>;
  findOwnedVehicle(owner: Owner, vehicleId: string): Promise<Vehicle | null>;
}
