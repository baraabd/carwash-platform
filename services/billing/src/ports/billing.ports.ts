import type {
  AttemptStatus,
  IntentStatus,
  JournalPlan,
  Money,
  ObligationStatus,
  PaymentMethod,
} from '../domain';

export type PrincipalKind = 'account' | 'guest';

/** Identity subject reference; never a phone, name or email. */
export interface PrincipalRef {
  readonly kind: PrincipalKind;
  readonly subjectId: string;
}

export interface ObligationRecord {
  readonly id: string;
  readonly owner: PrincipalRef;
  readonly quoteId: string;
  readonly amount: Money;
  readonly verified: Money;
  readonly status: ObligationStatus;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface IntentRecord {
  readonly id: string;
  readonly obligationId: string;
  readonly method: PaymentMethod;
  readonly status: IntentStatus;
  /** Outstanding amount fixed when the method was chosen. */
  readonly amount: Money;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AttemptRecord {
  readonly id: string;
  readonly intentId: string;
  readonly obligationId: string;
  readonly method: PaymentMethod;
  /** Normalised provider transaction reference. Never logged or evented. */
  readonly providerReference: string;
  readonly status: AttemptStatus;
  /** The intent amount the customer was asked to pay. A claim, not a receipt. */
  readonly claimed: Money;
  readonly submittedAt: Date;
  readonly reconciledAt: Date | null;
  readonly reconciledBy: PrincipalRef | null;
  /** Amount Finance observed at the provider; set only by MATCHED/MISMATCHED. */
  readonly observed: Money | null;
}

export interface RecordedOutcome {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface IdempotencyReceipt {
  readonly actor: PrincipalRef;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly outcome: RecordedOutcome;
}

export const AUDIT_ACTIONS = [
  'billing.obligation.created',
  'billing.obligation.voided',
  'billing.intent.initialized',
  'billing.attempt.submitted',
  'billing.attempt.reconciled',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: PrincipalRef;
  readonly action: AuditAction;
  readonly obligationId: string;
  readonly attemptId: string | null;
  /** A fixed machine value (status or outcome), never free text. */
  readonly outcome: string;
  readonly correlationId: string;
}

/** A row of the local transactional outbox (platform-messaging relay layout). */
export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  /** Serialised envelope v2; validated before it is written. */
  readonly payload: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
  readonly createdAt: Date;
}

export class ReceiptAlreadyExists extends Error {
  constructor() {
    super('RECEIPT_ALREADY_EXISTS');
    this.name = 'ReceiptAlreadyExists';
  }
}

export class ObligationAlreadyExists extends Error {
  constructor() {
    super('OBLIGATION_ALREADY_EXISTS');
    this.name = 'ObligationAlreadyExists';
  }
}

export class ProviderReferenceTaken extends Error {
  constructor() {
    super('PROVIDER_REFERENCE_TAKEN');
    this.name = 'ProviderReferenceTaken';
  }
}

/** A guarded write found the row in a different state than the lock showed. */
export class ConcurrentModification extends Error {
  constructor() {
    super('CONCURRENT_MODIFICATION');
    this.name = 'ConcurrentModification';
  }
}

export interface FinancialSnapshot {
  readonly obligation: ObligationRecord;
  readonly activeIntent: IntentRecord | null;
  /** Newest first. */
  readonly attempts: readonly AttemptRecord[];
}

export interface ObligationChange {
  readonly verified: Money;
  readonly status: ObligationStatus;
  readonly updatedAt: Date;
}

export interface AttemptReconciliation {
  readonly to: AttemptStatus;
  readonly at: Date;
  readonly by: PrincipalRef;
  readonly observed: Money | null;
}

export interface JournalMeta {
  readonly id: string;
  readonly obligationId: string;
  readonly postedAt: Date;
  readonly correlationId: string;
}

/** Work inside ONE local ACID transaction. Reads after a lock use this connection. */
export interface BillingUnitOfWork {
  findReceipt(
    actor: PrincipalRef,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null>;
  /** Throws ReceiptAlreadyExists when a concurrent writer committed the same key. */
  saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void>;
  obligationIdForQuote(quoteId: string): Promise<string | null>;
  /** Throws ObligationAlreadyExists when the quote already has an obligation. */
  insertObligation(obligation: ObligationRecord, correlationId: string): Promise<void>;
  /** SELECT … FOR UPDATE: serialises every command on one obligation. */
  lockObligation(id: string): Promise<ObligationRecord | null>;
  /** Compare-and-set on revision; bumps it by exactly one. Throws ConcurrentModification. */
  updateObligation(id: string, expectedRevision: number, change: ObligationChange): Promise<void>;
  snapshot(obligationId: string): Promise<FinancialSnapshot | null>;
  insertIntent(intent: IntentRecord, correlationId: string): Promise<void>;
  /** Guarded transition; throws ConcurrentModification when `from` no longer holds. */
  setIntentStatus(intentId: string, from: IntentStatus, to: IntentStatus, at: Date): Promise<void>;
  countAttempts(obligationId: string): Promise<number>;
  /** Throws ProviderReferenceTaken when (method, reference) was already reported anywhere. */
  insertAttempt(attempt: AttemptRecord, correlationId: string): Promise<void>;
  /** Guarded transition; throws ConcurrentModification when `from` no longer holds. */
  reconcileAttempt(
    attemptId: string,
    from: AttemptStatus,
    change: AttemptReconciliation,
  ): Promise<void>;
  postJournal(journal: JournalPlan, meta: JournalMeta): Promise<void>;
  appendAudit(record: AuditRecord): Promise<void>;
  appendOutbox(event: OutboxEvent): Promise<void>;
}

export interface BillingRepository {
  transaction<T>(work: (uow: BillingUnitOfWork) => Promise<T>): Promise<T>;
  findReceipt(
    actor: PrincipalRef,
    operation: string,
    key: string,
  ): Promise<IdempotencyReceipt | null>;
  snapshot(obligationId: string): Promise<FinancialSnapshot | null>;
  obligationIdForQuote(quoteId: string): Promise<string | null>;
  obligationIdForAttempt(attemptId: string): Promise<string | null>;
}

/** A priced quote as confirmed by its owner, Pricing, for the calling principal. */
export interface VerifiedQuote {
  readonly quoteId: string;
  readonly total: Money;
  readonly usable: boolean;
}

export class QuoteUnavailable extends Error {
  constructor() {
    super('QUOTE_UNAVAILABLE');
    this.name = 'QuoteUnavailable';
  }
}

/**
 * Reads a quote from Pricing on behalf of the caller (the quote is owner-scoped).
 * Returns null when Pricing says it does not exist for this caller. Any outage,
 * timeout or unparseable answer throws QuoteUnavailable: never a guessed amount.
 */
export interface QuoteReader {
  read(quoteId: string, credential: string, correlationId: string): Promise<VerifiedQuote | null>;
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
  readonly kind: PrincipalKind;
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
