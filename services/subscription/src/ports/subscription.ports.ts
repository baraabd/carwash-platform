import type {
  CancelReason,
  FreezeReason,
  MovementKind,
  PeriodState,
  PlanTerms,
  ReleaseReason,
  ReservationStatus,
  ReverseReason,
  RevisionHead,
  SubscriptionStatus,
} from '../domain';

export interface PlanRevisionRecord extends RevisionHead {
  readonly planCode: string;
  readonly publishedAt: Date;
  readonly publishedBy: string;
  readonly correlationId: string;
  readonly terms: PlanTerms;
}

export interface SubscriptionRecord {
  readonly id: string;
  readonly customerSubject: string;
  readonly planCode: string;
  /** Revision whose terms are snapshotted for the CURRENT period (or the request). */
  readonly planRevision: number;
  readonly status: SubscriptionStatus;
  readonly version: number;
  readonly terms: PlanTerms;
  readonly currentPeriodNo: number | null;
  readonly requestedAt: Date;
  readonly updatedAt: Date;
  readonly freezeReason: FreezeReason | null;
  readonly cancelReason: CancelReason | null;
}

export interface PeriodRecord extends PeriodState {
  readonly subscriptionId: string;
  readonly planRevision: number;
  /** Opaque Billing reference of the verified payment that funded this period. */
  readonly paymentReference: string;
  readonly grantedBy: string;
  readonly grantedAt: Date;
}

export type SettlementReason = ReleaseReason | ReverseReason;

export interface ReservationRecord {
  readonly id: string;
  readonly subscriptionId: string;
  readonly periodNo: number;
  readonly bookingId: string;
  readonly packageId: string;
  readonly scheduledFor: Date;
  readonly status: ReservationStatus;
  readonly version: number;
  readonly reservedAt: Date;
  readonly reservedBy: string;
  readonly settledAt: Date | null;
  readonly settledBy: string | null;
  readonly reason: SettlementReason | null;
  readonly correlationId: string;
}

export type ActorKind = 'account' | 'service';

export interface ActorRef {
  readonly kind: ActorKind;
  /** account: Identity subject UUID. service: configured client id. */
  readonly id: string;
}

export interface MovementRecord {
  readonly id: string;
  readonly subscriptionId: string;
  readonly periodNo: number;
  readonly reservationId: string | null;
  readonly kind: MovementKind;
  readonly granted: number;
  readonly reserved: number;
  readonly consumed: number;
  readonly occurredAt: Date;
  readonly actor: ActorRef;
  readonly correlationId: string;
}

export const AUDIT_ACTIONS = [
  'subscription.plan.revision-published',
  'subscription.plan.revision-rejected',
  'subscription.requested',
  'subscription.activated',
  'subscription.renewed',
  'subscription.frozen',
  'subscription.unfrozen',
  'subscription.cancelled',
  'subscription.change-requested',
  'subscription.change-rejected',
  'subscription.entitlement.reserved',
  'subscription.entitlement.committed',
  'subscription.entitlement.released',
  'subscription.entitlement.reversed',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actor: ActorRef;
  readonly action: AuditAction;
  readonly planCode: string | null;
  readonly subscriptionId: string | null;
  readonly reservationId: string | null;
  readonly outcome: string;
  readonly correlationId: string;
}

export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly payload: string;
  readonly correlationId: string;
  readonly traceParent: string | null;
  readonly createdAt: Date;
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

export interface WorkloadReceipt {
  readonly clientId: string;
  readonly operation: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly outcome: RecordedOutcome;
}

export class ReceiptAlreadyExists extends Error {
  constructor() {
    super('RECEIPT_ALREADY_EXISTS');
    this.name = 'ReceiptAlreadyExists';
  }
}

/** Storage could not start or finish the transaction in time; nothing was committed. */
export class RepositoryBusy extends Error {
  constructor() {
    super('REPOSITORY_BUSY');
    this.name = 'RepositoryBusy';
  }
}

export type UniqueTarget =
  'OPEN_SUBSCRIPTION' | 'PAYMENT_REFERENCE' | 'RESERVATION_BOOKING' | 'LIVE_BOOKING_RESERVATION';

/** Unique-constraint conflicts the application turns into a replay or a 409. */
export class UniqueConflict extends Error {
  constructor(readonly target: UniqueTarget) {
    super(`UNIQUE_CONFLICT_${target}`);
    this.name = 'UniqueConflict';
  }
}

export interface LockedSubscription {
  readonly subscription: SubscriptionRecord;
  readonly period: PeriodRecord | null;
}

export interface SubscriptionUnitOfWork {
  insertChange(record: SubscriptionChangeRecord): Promise<void>;
  lockChange(id: string): Promise<SubscriptionChangeRecord | null>;
  updateChange(record: SubscriptionChangeRecord): Promise<void>;
  lockPurchase(id: string): Promise<PurchaseRecord | null>;
  purchaseForQuote(quoteId: string): Promise<PurchaseRecord | null>;
  insertPurchase(record: PurchaseRecord): Promise<void>;
  updatePurchase(record: PurchaseRecord): Promise<void>;
  /** Serializes one workload command even before a reservation exists. */
  lockWorkloadReceipt(
    clientId: string,
    operation: string,
    key: string,
  ): Promise<WorkloadReceipt | null>;
  saveWorkloadReceipt(receipt: WorkloadReceipt, at: Date): Promise<void>;
  /** Serialises publishers of one plan code (creates the plan row on first use). */
  lockPlan(planCode: string, createdBy: string, at: Date): Promise<RevisionHead | null>;
  insertRevision(revision: PlanRevisionRecord): Promise<void>;
  revisionsOf(planCode: string): Promise<PlanRevisionRecord[]>;
  findReceipt(actor: string, operation: string, key: string): Promise<IdempotencyReceipt | null>;
  /** Throws ReceiptAlreadyExists when a concurrent writer committed the same key. */
  saveReceipt(receipt: IdempotencyReceipt, recordedAt: Date): Promise<void>;
  /** Throws UniqueConflict('OPEN_SUBSCRIPTION') for a second open subscription to one plan. */
  insertSubscription(subscription: SubscriptionRecord): Promise<void>;
  /** Row locks the subscription, then its current period (fixed order: no deadlock). */
  lockSubscription(id: string): Promise<LockedSubscription | null>;
  updateSubscription(subscription: SubscriptionRecord): Promise<void>;
  /** Throws UniqueConflict('PAYMENT_REFERENCE') when the payment already funded a period. */
  insertPeriod(period: PeriodRecord): Promise<void>;
  lockPeriod(subscriptionId: string, periodNo: number): Promise<PeriodRecord | null>;
  updatePeriodCounters(period: PeriodState & { readonly subscriptionId: string }): Promise<void>;
  reservationFor(subscriptionId: string, bookingId: string): Promise<ReservationRecord | null>;
  lockReservation(id: string): Promise<ReservationRecord | null>;
  /** Throws UniqueConflict for a duplicate (subscription, booking) or a second live booking hold. */
  insertReservation(reservation: ReservationRecord): Promise<void>;
  updateReservation(reservation: ReservationRecord): Promise<void>;
  appendMovement(movement: MovementRecord): Promise<void>;
  appendAudit(record: AuditRecord): Promise<void>;
  appendOutbox(event: OutboxEvent): Promise<void>;
}

export interface LedgerView {
  readonly period: PeriodRecord;
  readonly movements: readonly MovementRecord[];
}

export interface SubscriptionRepository {
  pendingChanges(limit: number): Promise<SubscriptionChangeRecord[]>;
  canonicalPlanCodes(after: string | null, limit: number): Promise<string[]>;
  canonicalSubscriptionsOf(
    subject: string,
    after: string | null,
    limit: number,
  ): Promise<SubscriptionRecord[]>;
  purchase(id: string): Promise<PurchaseRecord | null>;
  purchaseForSubscription(subscriptionId: string): Promise<PurchaseRecord | null>;
  transaction<T>(work: (uow: SubscriptionUnitOfWork) => Promise<T>): Promise<T>;
  findReceipt(actor: string, operation: string, key: string): Promise<IdempotencyReceipt | null>;
  planCodes(limit: number): Promise<string[]>;
  revisionsOf(planCode: string): Promise<PlanRevisionRecord[]>;
  subscription(id: string): Promise<SubscriptionRecord | null>;
  period(subscriptionId: string, periodNo: number): Promise<PeriodRecord | null>;
  subscriptionsOf(customerSubject: string, limit: number): Promise<SubscriptionRecord[]>;
  reservation(id: string): Promise<ReservationRecord | null>;
  reservationsForBooking(bookingId: string): Promise<ReservationRecord[]>;
  ledger(subscriptionId: string): Promise<LedgerView[]>;
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
  /** A guest holds no account: it cannot own a subscription (B-15 is open). */
  readonly principalKind: 'account' | 'guest';
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

/** Billing alone verifies settled, unrefunded funding owned by this account. */
export interface FundingAuthority {
  verify(input: {
    readonly obligationId: string;
    readonly customerSubject: string;
    readonly amount: import('../domain').Money;
    readonly correlationId: string;
    readonly quoteId?: string;
  }): Promise<'VERIFIED' | 'NOT_VERIFIED' | 'UNAVAILABLE'>;
}

export interface PurchaseRecord {
  readonly id: string;
  readonly customerSubject: string;
  readonly subscriptionId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly quoteId: string;
  readonly amount: import('../domain').Money;
  readonly paymentMethod: 'CASH_ON_COMPLETION' | 'SHAM_CASH' | 'SYRIATEL_CASH';
  readonly status:
    | 'PENDING_PAYMENT'
    | 'PAYMENT_UNDER_REVIEW'
    | 'PAYMENT_UNKNOWN'
    | 'ACTIVATED'
    | 'REJECTED'
    | 'EXPIRED';
  readonly revision: number;
  readonly obligationId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PurchaseQuote {
  readonly quoteId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly customerSubject: string;
  readonly amount: import('../domain').Money;
  readonly expiresAt: Date;
}
export interface PurchaseOwners {
  quote(id: string, credential: string, correlationId: string): Promise<PurchaseQuote | null>;
  createObligation(
    quoteId: string,
    method: PurchaseRecord['paymentMethod'],
    credential: string,
    key: string,
    correlationId: string,
  ): Promise<PurchaseObligation>;
  obligation(id: string, credential: string, correlationId: string): Promise<PurchaseObligation>;
}
export interface PurchaseObligation {
  readonly obligationId: string;
  readonly quoteId: string;
  readonly status: string;
  readonly financialStatus: string;
  readonly amount: import('../domain').Money;
}

export class PurchaseOwnerRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PurchaseOwnerRefusal';
  }
}

export interface SubscriptionChangeRecord {
  readonly id: string;
  readonly subscriptionId: string;
  readonly expectedRevision: number;
  readonly action: 'FREEZE' | 'RESUME' | 'CANCEL';
  readonly reason: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly status: 'PENDING_REVIEW' | 'APPLIED' | 'REJECTED';
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
}

/** Service-to-service scopes Subscription itself defines (deny by default). */
export const SERVICE_SCOPES = [
  'subscription.entitlement.reserve',
  'subscription.entitlement.settle',
  'subscription.entitlement.resolve',
  'subscription.entitlement.read',
] as const;
export type ServiceScope = (typeof SERVICE_SCOPES)[number];

export interface ServiceCallerAuthority {
  /** The authenticated caller id holding `scope`, or null (unauthenticated or scope denied). */
  authorize(
    clientId: string | undefined,
    token: string | undefined,
    scope: ServiceScope,
  ): string | null;
}
