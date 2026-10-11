import type { CatalogSnapshot, Definition } from '../domain';

/** The recorded terminal outcome of an idempotent command. */
export interface RecordedOutcome {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface IdempotencyReceipt {
  readonly actorSubject: string;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly outcome: RecordedOutcome;
}

export type AuditAction = 'catalog.definitions.published' | 'catalog.definitions.publish-rejected';

export interface AuditRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorSubject: string;
  readonly action: AuditAction;
  /** The catalog revision created, or null for a rejection. */
  readonly revision: number | null;
  readonly outcome: string;
  readonly reasonCode: string;
  readonly correlationId: string;
}

export interface NewPublication {
  readonly catalogRevision: number;
  readonly publishedAt: Date;
  readonly publishedBy: string;
  readonly correlationId: string;
  readonly reasonCode: string;
  readonly snapshotFingerprint: string;
  readonly items: readonly Definition[];
}

/** One integration event row for the transactional outbox. */
export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
}

/** Work performed inside ONE local ACID transaction. */
export interface CatalogUnitOfWork {
  /**
   * Serialises publishers and returns the current snapshot. Holding this lock
   * makes "check receipt, plan, insert, record receipt" atomic for the catalog.
   */
  lockCurrent(): Promise<CatalogSnapshot | null>;
  findReceipt(
    actorSubject: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null>;
  insertPublication(publication: NewPublication): Promise<void>;
  saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void>;
  appendAudit(record: AuditRecord): Promise<void>;
  enqueue(event: OutboxEvent): Promise<void>;
}

export interface CatalogRepository {
  transaction<T>(work: (uow: CatalogUnitOfWork) => Promise<T>): Promise<T>;
  /** The newest published snapshot, or null before the first publication. */
  current(): Promise<CatalogSnapshot | null>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

export interface Hasher {
  sha256Hex(text: string): string;
}

/** A principal whose session and permissions Identity confirmed just now. */
export interface VerifiedPrincipal {
  readonly subject: string;
  readonly sessionId: string;
  readonly permissions: readonly string[];
}

export type AccessFailure = 'AUTH_REQUIRED' | 'AUTH_UNAVAILABLE';

export class AccessDenied extends Error {
  constructor(readonly reason: AccessFailure) {
    super(reason);
    this.name = 'AccessDenied';
  }
}

/**
 * Obtains a CURRENT authorization decision from Identity. Implementations fail
 * closed: an unreachable or ambiguous Identity is AUTH_UNAVAILABLE, never an
 * anonymous or cached grant.
 */
export interface AccessAuthority {
  verify(credential: string | undefined, correlationId: string): Promise<VerifiedPrincipal>;
}
