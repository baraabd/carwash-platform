import type {
  Address,
  AddressDetails,
  AddressStatus,
  CustomerProfile,
  Principal,
  ProfileChanges,
} from '../domain';

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
  readonly principal: Principal;
  readonly sessionId: string;
  readonly permissions: readonly string[];
}

export type AccessIntent = 'read' | 'write';

/**
 * Identity is the only authority for authentication. Implementations fail
 * closed: an unreachable or ambiguous Identity is an error, never a session.
 */
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

/** Audit facts carry identifiers only; the changed personal values are never copied. */
export interface AuditEntry {
  readonly id: string;
  readonly actorSubject: string;
  readonly actorSessionId: string;
  readonly action: string;
  readonly targetType: 'customer' | 'address';
  readonly targetId: string;
  readonly correlationId: string;
  readonly at: Date;
}

export interface NewProfile {
  readonly id: string;
  readonly principal: Principal;
  readonly now: Date;
}

export interface NewAddress extends AddressDetails {
  readonly id: string;
  readonly customerId: string;
  readonly now: Date;
}

/** Operations that run inside ONE local ACID transaction. */
export interface CustomerTransaction {
  claimIdempotency(request: IdempotencyRequest): Promise<IdempotencyClaim>;
  completeIdempotency(scope: string, key: string, status: number, body: unknown): Promise<void>;
  findProfileForUpdate(principal: Principal): Promise<CustomerProfile | null>;
  /** Returns null when a concurrent insert for the same principal won. */
  insertProfile(profile: NewProfile): Promise<CustomerProfile | null>;
  /** Compare-and-set on revision; null when the revision no longer matches. */
  updateProfile(
    id: string,
    changes: ProfileChanges,
    expectedRevision: number,
    now: Date,
  ): Promise<CustomerProfile | null>;
  countActiveAddresses(customerId: string): Promise<number>;
  insertAddress(address: NewAddress): Promise<Address>;
  findAddress(customerId: string, addressId: string): Promise<Address | null>;
  updateAddress(
    customerId: string,
    addressId: string,
    details: AddressDetails,
    status: AddressStatus,
    expectedRevision: number,
    now: Date,
  ): Promise<Address | null>;
  appendOutbox(event: OutboxEvent): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

export interface CustomerStore {
  transaction<T>(work: (tx: CustomerTransaction) => Promise<T>): Promise<T>;
  findProfile(principal: Principal): Promise<CustomerProfile | null>;
  listAddresses(customerId: string, includeArchived: boolean): Promise<Address[]>;
  findAddress(customerId: string, addressId: string): Promise<Address | null>;
}
