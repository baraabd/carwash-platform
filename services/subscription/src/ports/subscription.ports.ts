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

/** Service-to-service scopes Subscription itself defines (deny by default). */
export const SERVICE_SCOPES = [
  'subscription.entitlement.reserve',
  'subscription.entitlement.settle',
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
