import type {
  CreditSource,
  CreditStatus,
  Money,
  ProviderId,
  RefundChannel,
  RefundProviderOutcome,
  RefundReason,
  RefundStatus,
  StatementRejectionReason,
  UnallocatedReason,
} from '../domain';

// ------------------------------------------------------------ provider adapters

/**
 * What one provider integration can do, declared by its adapter. Billing never
 * calls an operation the adapter does not declare, and an adapter declares an
 * operation only when it is implemented from the provider's official, approved
 * merchant documentation (no unofficial or reverse-engineered API).
 */
export interface ProviderCapabilities {
  /** Authenticated push notifications of final credits. */
  readonly notifications: boolean;
  /** Authenticated pull of one transaction by its reference. */
  readonly creditQuery: boolean;
  /**
   * PROVIDER_API only when the provider's refund API exists AND treats the
   * Billing refund id as its idempotency key (a retried submission can never
   * pay twice). Otherwise refunds are manual, out of band, with evidence.
   */
  readonly refunds: RefundChannel;
  /** Finance may record a credit read from the merchant's own statement. */
  readonly statementEvidence: boolean;
}

export const PROVIDER_INTEGRATION_STATES = [
  /** No approved merchant documentation/credentials: only manual capabilities. */
  'OFFICIAL_DOCUMENTATION_PENDING',
  'SANDBOX',
  'LIVE',
] as const;
export type ProviderIntegrationState = (typeof PROVIDER_INTEGRATION_STATES)[number];

/** Redacted, operator-safe description of one configured provider. */
export interface ProviderDiagnostics {
  readonly provider: ProviderId;
  readonly integration: ProviderIntegrationState;
  readonly capabilities: ProviderCapabilities;
  readonly merchantAccountCount: number;
  /** Short SHA-256 fingerprint of the configured account set; never the accounts. */
  readonly merchantAccountsFingerprint: string | null;
  /** Names of the secrets the adapter holds; never their values. */
  readonly secretsConfigured: readonly string[];
}

/** A final credit as the provider states it, normalised by the adapter. */
export interface ProviderCreditFact {
  readonly merchantAccount: string;
  /** Normalised provider transaction reference (normalizeProviderReference). */
  readonly reference: string;
  readonly amount: Money;
  readonly occurredAt: Date;
}

export interface InboundNotification {
  /** The exact bytes received; authentication is computed over them. */
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export type AuthenticatedNotification =
  | {
      readonly kind: 'CREDIT_FINAL';
      readonly fact: ProviderCreditFact;
      /** SHA-256 of the raw notification: provenance without storing it. */
      readonly evidenceDigest: string;
    }
  /** Authentic but not a final credit (pending, test ping, other type). */
  | { readonly kind: 'IGNORED' };

/** Bad signature, outside the replay window, malformed or unknown sender. */
export class NotificationRejected extends Error {
  constructor() {
    super('NOTIFICATION_REJECTED');
    this.name = 'NotificationRejected';
  }
}

export type CreditQueryResult =
  | {
      readonly kind: 'FOUND_FINAL';
      readonly fact: ProviderCreditFact;
      readonly evidenceDigest: string;
    }
  | { readonly kind: 'PENDING' }
  | { readonly kind: 'NOT_FOUND' }
  /** Timeout, outage or an unreadable answer: the outcome cannot be known. */
  | { readonly kind: 'UNKNOWN' };

export interface RefundInstruction {
  /** Billing's refund id: the provider-side idempotency key. */
  readonly refundId: string;
  readonly merchantAccount: string;
  readonly originalReference: string;
  readonly amount: Money;
}

export interface RefundProviderAnswer {
  /** UNKNOWN on timeout/outage/unreadable answer: never success. */
  readonly outcome: RefundProviderOutcome;
  /** Normalised provider refund reference, when the provider gave one. */
  readonly providerRefundReference: string | null;
}

/** The operation is not among the adapter's declared capabilities. */
export class ProviderCapabilityMissing extends Error {
  constructor() {
    super('PROVIDER_CAPABILITY_MISSING');
    this.name = 'ProviderCapabilityMissing';
  }
}

/**
 * One payment provider integration. Implementations hold their own secrets
 * and never log, event or return them; network operations have bounded
 * timeouts and report UNKNOWN instead of throwing for an unknowable outcome.
 */
export interface PaymentProviderAdapter {
  readonly provider: ProviderId;
  readonly capabilities: ProviderCapabilities;
  /** True only for a merchant account this deployment is configured to receive into. */
  acceptsMerchantAccount(account: string): boolean;
  /** Throws NotificationRejected; ProviderCapabilityMissing without the capability. */
  authenticateNotification(
    notification: InboundNotification,
    now: Date,
  ): Promise<AuthenticatedNotification>;
  queryCredit(reference: string, correlationId: string): Promise<CreditQueryResult>;
  submitRefund(
    instruction: RefundInstruction,
    correlationId: string,
  ): Promise<RefundProviderAnswer>;
  refundStatus(
    instruction: RefundInstruction,
    correlationId: string,
  ): Promise<RefundProviderAnswer>;
  diagnostics(): ProviderDiagnostics;
}

export interface PaymentProviderRegistry {
  adapter(provider: ProviderId): PaymentProviderAdapter;
  all(): readonly PaymentProviderAdapter[];
}

// ------------------------------------------------------------------ records

export interface ProviderCreditRecord {
  readonly id: string;
  readonly provider: ProviderId;
  readonly merchantAccount: string;
  /** Normalised provider reference. Never logged or evented. */
  readonly reference: string;
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly source: CreditSource;
  readonly evidenceDigest: string;
  readonly status: CreditStatus;
  readonly unallocatedReason: UnallocatedReason | null;
  readonly attemptId: string | null;
  readonly obligationId: string | null;
  /** The account that recorded it (statement or triggered query); null for notifications. */
  readonly recordedBy: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly rejectionReason: StatementRejectionReason | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RefundRecord {
  readonly id: string;
  readonly creditId: string;
  readonly provider: ProviderId;
  readonly amount: Money;
  readonly reason: RefundReason;
  readonly channel: RefundChannel;
  readonly status: RefundStatus;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly providerRefundReference: string | null;
  readonly evidenceDigest: string | null;
  readonly completedBy: string | null;
  readonly completedAt: Date | null;
  readonly revision: number;
  readonly updatedAt: Date;
}

/** (provider, merchant account, reference) already has an effective credit. */
export class ProviderCreditTaken extends Error {
  constructor() {
    super('PROVIDER_CREDIT_TAKEN');
    this.name = 'ProviderCreditTaken';
  }
}

/** The provider refund reference was already used by another refund. */
export class ProviderRefundReferenceTaken extends Error {
  constructor() {
    super('PROVIDER_REFUND_REFERENCE_TAKEN');
    this.name = 'ProviderRefundReferenceTaken';
  }
}

export interface ClaimLocation {
  readonly attemptId: string;
  readonly obligationId: string;
}

/** Provider writes on the caller's transaction (BillingUnitOfWork.providers). */
export interface ProviderStore {
  /**
   * Transaction-scoped advisory lock on one provider reference. Every path that
   * can pair a claim with a credit (claim submission, credit confirmation) takes
   * it, so two concurrent writers can never both miss each other's row.
   */
  lockReference(provider: ProviderId, reference: string): Promise<void>;
  effectiveCredit(
    provider: ProviderId,
    merchantAccount: string,
    reference: string,
  ): Promise<ProviderCreditRecord | null>;
  /** A confirmed, unallocated credit carrying this reference (any merchant account). */
  unallocatedCreditFor(
    provider: ProviderId,
    reference: string,
  ): Promise<ProviderCreditRecord | null>;
  claimFor(provider: ProviderId, reference: string): Promise<ClaimLocation | null>;
  /** SELECT … FOR UPDATE. */
  lockCredit(id: string): Promise<ProviderCreditRecord | null>;
  /** Throws ProviderCreditTaken. */
  insertCredit(credit: ProviderCreditRecord, correlationId: string): Promise<void>;
  /** Compare-and-set on revision; throws ConcurrentModification. */
  updateCredit(id: string, expectedRevision: number, next: ProviderCreditRecord): Promise<void>;
  /** Sum of the credit's refunds that still hold money (RESERVING_REFUND_STATUSES). */
  reservedForRefund(credit: ProviderCreditRecord): Promise<Money>;
  insertRefund(refund: RefundRecord, correlationId: string): Promise<void>;
  /** SELECT … FOR UPDATE. */
  lockRefund(id: string): Promise<RefundRecord | null>;
  /** Compare-and-set on revision; throws ConcurrentModification / ProviderRefundReferenceTaken. */
  updateRefund(id: string, expectedRevision: number, next: RefundRecord): Promise<void>;
}

export interface CreditQueueFilter {
  readonly status: CreditStatus;
  readonly limit: number;
}

export interface RefundQueueFilter {
  readonly status: RefundStatus;
  readonly limit: number;
}

/** Finance reads (outside any command transaction). */
export interface ProviderReader {
  credit(id: string): Promise<ProviderCreditRecord | null>;
  refund(id: string): Promise<RefundRecord | null>;
  refundsForCredit(creditId: string): Promise<readonly RefundRecord[]>;
  credits(filter: CreditQueueFilter): Promise<readonly ProviderCreditRecord[]>;
  refunds(filter: RefundQueueFilter): Promise<readonly RefundRecord[]>;
}
