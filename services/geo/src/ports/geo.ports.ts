import type { Decision, Point, Zone, ZoneDefinition, ZoneStatus } from '../domain';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

/** Who ran a zone data operation (an operator label, never personal data). */
export interface AuditEntry {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly zoneId: string;
  readonly datasetRef: string;
  readonly correlationId: string;
  readonly at: Date;
}

export interface NewZone extends ZoneDefinition {
  readonly id: string;
  readonly now: Date;
}

export interface GeoTransaction {
  /** Locks the zone row (if any) for the rest of the transaction. */
  findZoneForUpdate(code: string): Promise<Zone | null>;
  /** Null when a concurrent import of the same code committed first. */
  insertZone(zone: NewZone): Promise<Zone | null>;
  updateZone(
    code: string,
    definition: ZoneDefinition,
    status: ZoneStatus,
    expectedRevision: number,
    now: Date,
  ): Promise<Zone | null>;
  /**
   * Advances the dataset revision. Every committed zone change calls this in
   * its own transaction, so a decision's datasetRevision names exactly the
   * zone set it was evaluated against.
   */
  advanceDatasetRevision(now: Date): Promise<number>;
  appendOutbox(event: OutboxEvent): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

export interface CoverageSnapshot {
  /** Whether any ACTIVE zone exists at all. */
  readonly anyActive: boolean;
  /** ACTIVE zones whose bounding box contains the point (edges inclusive). */
  readonly candidates: Zone[];
  readonly datasetRevision: number;
}

export interface GeoStore {
  transaction<T>(work: (tx: GeoTransaction) => Promise<T>): Promise<T>;
  activeZones(): Promise<Zone[]>;
  /** One consistent snapshot of coverage and the dataset revision. */
  coverageSnapshot(point: Point): Promise<CoverageSnapshot>;
  /** Append-only. */
  recordDecision(decision: Decision): Promise<void>;
  findDecision(id: string): Promise<Decision | null>;
  /** Deletes at most `limit` decisions that expired before `before`; returns the count. */
  purgeDecisions(before: Date, limit: number): Promise<number>;
}

/** Thrown by a store adapter when PostgreSQL cannot be reached; never a decision. */
export class StoreUnavailableError extends Error {
  constructor() {
    super('STORE_UNAVAILABLE');
    this.name = 'StoreUnavailableError';
  }
}

/** Request credentials passed through to Identity; never logged. */
export interface SessionCredentials {
  readonly authorization: string | undefined;
  readonly cookie: string | undefined;
  readonly correlationId: string;
}

export interface AuthorizedPrincipal {
  readonly principal: { readonly kind: 'account' | 'guest'; readonly subject: string };
  readonly sessionId: string;
  readonly permissions: readonly string[];
}

/** Current-session check against Identity. Fails closed. */
export interface IdentityAuthorizer {
  authorize(credentials: SessionCredentials): Promise<AuthorizedPrincipal>;
}

/** A calling workload whose identity and scopes were verified by the transport. */
export interface ServiceActor {
  readonly service: string;
  readonly scopes: readonly string[];
}

/**
 * Verifies a workload (service-to-service) credential. Workload identity is
 * P01-E5 and is not on main; the only adapter refuses every caller.
 */
export interface WorkloadAuthenticator {
  authenticate(headers: Readonly<Record<string, string | undefined>>): Promise<ServiceActor>;
}
