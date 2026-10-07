import type { CatalogDefinitions, RevisionHead } from '../domain';

/** An immutable, published catalog revision exactly as it was stored. */
export interface PublishedRevision {
  readonly revision: number;
  readonly effectiveFrom: Date;
  readonly publishedAt: Date;
  readonly definitionsFingerprint: string;
  readonly definitions: CatalogDefinitions;
}

export interface RevisionSummary {
  readonly revision: number;
  readonly effectiveFrom: Date;
  readonly publishedAt: Date;
  readonly definitionsFingerprint: string;
}

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

export interface AuditRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorSubject: string;
  readonly action: 'catalog.revision.published' | 'catalog.revision.publish-rejected';
  readonly revision: number | null;
  readonly outcome: string;
  readonly correlationId: string;
}

export interface NewRevision {
  readonly revision: number;
  readonly effectiveFrom: Date;
  readonly publishedAt: Date;
  readonly publishedBy: string;
  readonly correlationId: string;
  readonly definitionsFingerprint: string;
  readonly definitions: CatalogDefinitions;
}

/** Work performed inside ONE local ACID transaction. */
export interface CatalogUnitOfWork {
  /**
   * Serialises publishers and returns the current chain head. Holding this lock
   * makes "check receipt, plan, insert, record receipt" atomic per catalog.
   */
  lockHead(): Promise<RevisionHead | null>;
  findReceipt(
    actorSubject: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null>;
  insertRevision(revision: NewRevision): Promise<void>;
  saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void>;
  appendAudit(record: AuditRecord): Promise<void>;
}

export interface CatalogRepository {
  transaction<T>(work: (uow: CatalogUnitOfWork) => Promise<T>): Promise<T>;
  /** The revision in force at `at`, i.e. the latest effectiveFrom <= at. */
  revisionInForce(at: Date): Promise<PublishedRevision | null>;
  revision(revision: number): Promise<PublishedRevision | null>;
  /** Newest first, bounded. */
  listRevisions(limit: number): Promise<RevisionSummary[]>;
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
