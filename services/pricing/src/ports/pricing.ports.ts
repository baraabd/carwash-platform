import type {
  CatalogView,
  CurrencyPolicy,
  PriceBookEntry,
  PricedLine,
  PrincipalKind,
  PrincipalRef,
  VehicleType,
} from '../domain';

/** One immutable price book revision with the exact Catalog view it was validated against. */
export interface PriceBook {
  readonly revision: number;
  readonly currency: string;
  readonly scale: number;
  readonly policyRevision: string;
  readonly catalog: CatalogView;
  readonly catalogFingerprint: string;
  readonly entries: readonly PriceBookEntry[];
  readonly entriesFingerprint: string;
  readonly publishedAt: Date;
}

export interface NewPriceBook extends PriceBook {
  readonly publishedBy: string;
  readonly correlationId: string;
}

export interface StoredLine extends PricedLine {
  readonly lineId: string;
}

/** Immutable server-issued pricing.v1 quote. */
export interface StoredQuote {
  readonly id: string;
  readonly revision: number;
  readonly beneficiary: PrincipalRef;
  /** The verified Identity subject that requested the quote (audit). */
  readonly requestedBy: string;
  readonly vehicleType: VehicleType;
  readonly zoneId: string | null;
  readonly currency: string;
  readonly scale: number;
  readonly priceBookRevision: number;
  readonly catalogRevision: number;
  readonly policyRevision: string;
  readonly lines: readonly StoredLine[];
  readonly totalMinor: bigint;
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

export type AuditAction =
  | 'pricing.price-book.published'
  | 'pricing.price-book.publish-rejected'
  | 'pricing.quote.validated';

/**
 * Append-only audit. `actor` is an Identity subject UUID or `service:<client>`
 * for a workload caller; `purpose` is the declared resolve purpose of a
 * service read. No price, beneficiary or credential is written here.
 */
export interface AuditRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: string;
  readonly action: AuditAction;
  readonly subjectRef: string | null;
  readonly purpose: string | null;
  readonly outcome: string;
  readonly correlationId: string;
}

export interface PricingUnitOfWork {
  /** Serialises price book publishers; returns the current head revision. */
  lockPriceBookHead(): Promise<number | null>;
  /** The newest committed price book (in force from its commit). */
  priceBookInForce(): Promise<PriceBook | null>;
  findReceipt(
    actorSubject: string,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null>;
  insertPriceBook(book: NewPriceBook): Promise<void>;
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
  quote(id: string): Promise<StoredQuote | null>;
  appendAudit(record: AuditRecord): Promise<void>;
}

/** Reads the currently published Catalog through the OWNER's catalog.v1 API. */
export interface CatalogReader {
  current(correlationId: string): Promise<CatalogView>;
}

/** Catalog did not answer with a valid catalog.v1 body in time. Never a guessed catalog. */
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
  readonly kind: PrincipalKind;
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

/** Service scopes Pricing grants to workload callers (pricing.v1 `service:` routes). */
export const PRICING_SERVICE_SCOPES = ['pricing.quote.validate'] as const;
export type PricingServiceScope = (typeof PRICING_SERVICE_SCOPES)[number];

export interface ServiceCredential {
  readonly clientId: string | undefined;
  readonly token: string | undefined;
}

export type ServiceDecision =
  | { readonly ok: true; readonly clientId: string }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' | 'SCOPE_DENIED' };

export interface ServiceAuthority {
  authorize(credential: ServiceCredential, scope: PricingServiceScope): ServiceDecision;
}
