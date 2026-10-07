import type {
  CatalogSnapshot,
  CurrencyPolicy,
  QuoteLine,
  Rate,
  Selection,
  VersionHead,
} from '../domain';

export interface PublishedPriceVersion {
  readonly version: number;
  readonly effectiveFrom: Date;
  readonly publishedAt: Date;
  readonly catalogRevision: number;
  readonly policyRevision: string;
  readonly currency: string;
  readonly minorUnitExponent: number;
  readonly ratesFingerprint: string;
  readonly rates: readonly Rate[];
  /** The exact catalog view the rates were validated against. */
  readonly catalog: CatalogSnapshot;
}

export interface NewPriceVersion extends PublishedPriceVersion {
  readonly publishedBy: string;
  readonly correlationId: string;
}

export interface StoredQuote {
  readonly id: string;
  readonly ownerSubject: string;
  readonly priceVersion: number;
  readonly catalogRevision: number;
  readonly policyRevision: string;
  readonly currency: string;
  readonly minorUnitExponent: number;
  readonly selection: Selection;
  readonly lines: readonly QuoteLine[];
  readonly subtotalMinor: bigint;
  readonly totalMinor: bigint;
  readonly durationMinutes: number;
  readonly inputFingerprint: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly correlationId: string;
}

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
  readonly action: 'pricing.version.published' | 'pricing.version.publish-rejected';
  readonly version: number | null;
  readonly outcome: string;
  readonly correlationId: string;
}

export interface PricingUnitOfWork {
  /** Serialises price publishers; returns the current chain head. */
  lockHead(): Promise<VersionHead | null>;
  findReceipt(
    actorSubject: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null>;
  insertPriceVersion(version: NewPriceVersion): Promise<void>;
  insertQuote(quote: StoredQuote): Promise<void>;
  /** Throws ReceiptAlreadyExists when a concurrent writer committed the same key. */
  saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void>;
  appendAudit(record: AuditRecord): Promise<void>;
}

export class ReceiptAlreadyExists extends Error {
  constructor() {
    super('RECEIPT_ALREADY_EXISTS');
    this.name = 'ReceiptAlreadyExists';
  }
}

export interface PricingRepository {
  transaction<T>(work: (uow: PricingUnitOfWork) => Promise<T>): Promise<T>;
  findReceipt(
    actorSubject: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null>;
  versionInForce(at: Date): Promise<PublishedPriceVersion | null>;
  version(version: number): Promise<PublishedPriceVersion | null>;
  listVersions(limit: number): Promise<Omit<PublishedPriceVersion, 'rates' | 'catalog'>[]>;
  quote(id: string): Promise<StoredQuote | null>;
}

/** Reads one immutable catalog revision from the Catalog OWNER contract. */
export interface CatalogRevisionReader {
  read(revision: number, correlationId: string): Promise<CatalogSnapshot | null>;
}

export class CatalogUnavailable extends Error {
  constructor() {
    super('CATALOG_UNAVAILABLE');
    this.name = 'CatalogUnavailable';
  }
}

/** Accepted owner policy (B-03/B-05). null means "not configured": fail closed. */
export interface PolicyProvider {
  currencyPolicy(): CurrencyPolicy | null;
  quoteTtlSeconds(): number | null;
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

export interface AccessAuthority {
  verify(credential: string | undefined, correlationId: string): Promise<VerifiedPrincipal>;
}
