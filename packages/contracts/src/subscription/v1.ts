import type { OwnerContract } from '../common/route';
import { parseNonNegativeMoney, type Money } from '../common/money';
import { PAYMENT_METHODS, type PaymentMethod } from '../common/payment-method';
import { parsePrincipalRef, type PrincipalRef } from '../common/principal';
import { parseRevision } from '../common/protocol';
import { parseUtc, type UtcTimestamp } from '../common/time';
import { VEHICLE_TYPES, type VehicleType } from '../common/vehicle-type';
import { ContractViolation, closed, integer, list, oneOf, text, uuid } from '../common/wire';

/**
 * subscription.v1 — owner: Subscription service (Lane B). Contract-first (P05-E1):
 * no accepted provider exists; every route is `published-provider-pending`.
 *
 * Separate facts, never collapsed (W07-A-01, B/W06 SUBSCRIPTION_LIFECYCLE):
 *  - a PURCHASE is a request bound to one published plan version and one Pricing
 *    quote. It activates only after Billing verifies the obligation; a proof
 *    upload, a provider claim or a client acknowledgement never activates it;
 *  - a SUBSCRIPTION exists only once activated. Its units are owner-counted:
 *    available = total − reserved − consumed, never negative;
 *  - an entitlement RESERVATION binds one unit to one Booking. Reserve is not
 *    consume; CONSUMED is final and is never released to fabricate a unit;
 *  - a CHANGE (freeze/resume/cancel) is a request the owner evaluates under its
 *    current revision and approved policy. Cancelling never cancels a Booking and
 *    never refunds money: refunds are Billing facts, requested separately.
 *
 * Plan units, validity, prices and change rules are owner-published data and
 * approved policy. This contract fixes their wire shape only, never a value.
 */
export const SUBSCRIPTION_V1 = {
  id: 'subscription.v1',
  owner: 'subscription',
  prefix: '/internal/v1/subscription',
  routes: {
    listPlans: { method: 'GET', path: '/plans', access: 'public', paged: true },
    getPlan: { method: 'GET', path: '/plans/:planId', access: 'public' },
    createPurchase: { method: 'POST', path: '/purchases', access: 'principal', idempotent: true },
    getPurchase: { method: 'GET', path: '/purchases/:purchaseId', access: 'principal' },
    listSubscriptions: { method: 'GET', path: '/subscriptions', access: 'principal', paged: true },
    getSubscription: {
      method: 'GET',
      path: '/subscriptions/:subscriptionId',
      access: 'principal',
    },
    requestChange: {
      method: 'POST',
      path: '/subscriptions/:subscriptionId/changes',
      access: 'principal',
      idempotent: true,
    },
    reserveEntitlement: {
      method: 'POST',
      path: '/entitlement-reservations',
      access: 'service:subscription.entitlement.reserve',
      idempotent: true,
    },
    resolveEntitlement: {
      method: 'POST',
      path: '/entitlement-reservations/:reservationId/resolution',
      access: 'service:subscription.entitlement.resolve',
      idempotent: true,
    },
    getEntitlementReservation: {
      method: 'GET',
      path: '/entitlement-reservations/:reservationId',
      access: 'service:subscription.entitlement.read',
    },
  },
  reasons: [
    'PLAN_NOT_AVAILABLE',
    'PLAN_VERSION_CHANGED',
    'QUOTE_MISMATCH',
    'PURCHASE_NOT_ACTIVATABLE',
    'SUBSCRIPTION_NOT_ACTIVE',
    'ENTITLEMENT_EXHAUSTED',
    'PACKAGE_NOT_COVERED',
    'RESERVATION_NOT_ACTIVE',
    'RESERVATION_BOOKING_MISMATCH',
    'CHANGE_NOT_ALLOWED',
    'POLICY_UNAVAILABLE',
  ],
} as const satisfies OwnerContract;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_PLAN_PACKAGES = 20;
/** Upper wire bound only; real unit counts are owner-published plan data. */
export const MAX_PLAN_UNITS = 1000;

export const PLAN_STATUSES = ['PUBLISHED', 'RETIRED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface PlanV1 {
  readonly planId: string;
  /** Immutable publication version; a purchase binds exactly one. */
  readonly version: number;
  readonly status: PlanStatus;
  /** Arabic display name published by the owner (customer copy stays Arabic). */
  readonly name: string;
  readonly units: number;
  readonly validityDays: number;
  readonly price: Money;
  readonly packageIds: readonly string[];
  readonly vehicleTypes: readonly VehicleType[];
  readonly publishedAt: UtcTimestamp;
  readonly contentHash: string;
}

export function parsePlanV1(value: unknown, path = '$'): PlanV1 {
  const v = closed(value, path, [
    'planId',
    'version',
    'status',
    'name',
    'units',
    'validityDays',
    'price',
    'packageIds',
    'vehicleTypes',
    'publishedAt',
    'contentHash',
  ]);
  const price = parseNonNegativeMoney(v.price, `${path}.price`);
  if (price.amountMinor === '0') throw new ContractViolation('ZERO_PLAN_PRICE', `${path}.price`);
  const packageIds = list(v.packageIds, `${path}.packageIds`, MAX_PLAN_PACKAGES, (id, at) =>
    uuid(id, at),
  );
  const vehicleTypes = list(v.vehicleTypes, `${path}.vehicleTypes`, VEHICLE_TYPES.length, (t, at) =>
    oneOf(t, at, VEHICLE_TYPES),
  );
  if (packageIds.length === 0 || new Set(packageIds).size !== packageIds.length)
    throw new ContractViolation('INVALID_PLAN_PACKAGES', `${path}.packageIds`);
  if (vehicleTypes.length === 0 || new Set(vehicleTypes).size !== vehicleTypes.length)
    throw new ContractViolation('INVALID_PLAN_VEHICLES', `${path}.vehicleTypes`);
  return {
    planId: uuid(v.planId, `${path}.planId`),
    version: parseRevision(v.version, `${path}.version`),
    status: oneOf(v.status, `${path}.status`, PLAN_STATUSES),
    name: text(v.name, `${path}.name`, { max: 80 }),
    units: integer(v.units, `${path}.units`, 1, MAX_PLAN_UNITS),
    validityDays: integer(v.validityDays, `${path}.validityDays`, 1, 3660),
    price,
    packageIds,
    vehicleTypes,
    publishedAt: parseUtc(v.publishedAt, `${path}.publishedAt`),
    contentHash: text(v.contentHash, `${path}.contentHash`, {
      min: 64,
      max: 64,
      pattern: SHA256_HEX,
    }),
  };
}

// ---------------------------------------------------------------------------
// Purchase
// ---------------------------------------------------------------------------

/**
 * PENDING_PAYMENT        obligation open; nothing verified
 * PAYMENT_UNDER_REVIEW   a payment claim awaits finance verification
 * PAYMENT_UNKNOWN        the payment outcome cannot be known yet; never success
 * ACTIVATED              Billing verified the obligation and the owner activated once
 * REJECTED / EXPIRED     terminal without activation; a subscription never exists
 */
export const PURCHASE_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_UNDER_REVIEW',
  'PAYMENT_UNKNOWN',
  'ACTIVATED',
  'REJECTED',
  'EXPIRED',
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export interface PurchaseV1 {
  readonly purchaseId: string;
  readonly revision: number;
  readonly status: PurchaseStatus;
  readonly beneficiary: PrincipalRef;
  readonly planId: string;
  readonly planVersion: number;
  readonly quoteId: string;
  readonly total: Money;
  readonly paymentMethod: PaymentMethod;
  /** Billing obligation; null only before Billing accepted it (or when REJECTED before). */
  readonly obligationId: string | null;
  /** Non-null exactly when ACTIVATED. */
  readonly subscriptionId: string | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export function parsePurchaseV1(value: unknown, path = '$'): PurchaseV1 {
  const v = closed(value, path, [
    'purchaseId',
    'revision',
    'status',
    'beneficiary',
    'planId',
    'planVersion',
    'quoteId',
    'total',
    'paymentMethod',
    'obligationId',
    'subscriptionId',
    'createdAt',
    'updatedAt',
  ]);
  const status = oneOf(v.status, `${path}.status`, PURCHASE_STATUSES);
  const obligationId =
    v.obligationId === null ? null : uuid(v.obligationId, `${path}.obligationId`);
  const subscriptionId =
    v.subscriptionId === null ? null : uuid(v.subscriptionId, `${path}.subscriptionId`);
  if ((status === 'ACTIVATED') !== (subscriptionId !== null))
    throw new ContractViolation('INCONSISTENT_ACTIVATION', `${path}.subscriptionId`);
  // Activation, review and unknown outcomes all presuppose a Billing obligation.
  if (status !== 'REJECTED' && status !== 'PENDING_PAYMENT' && obligationId === null)
    throw new ContractViolation('OBLIGATION_REQUIRED', `${path}.obligationId`);
  const total = parseNonNegativeMoney(v.total, `${path}.total`);
  if (total.amountMinor === '0') throw new ContractViolation('ZERO_PURCHASE', `${path}.total`);
  const createdAt = parseUtc(v.createdAt, `${path}.createdAt`);
  const updatedAt = parseUtc(v.updatedAt, `${path}.updatedAt`);
  if (updatedAt < createdAt) throw new ContractViolation('TIME_TRAVEL', `${path}.updatedAt`);
  return {
    purchaseId: uuid(v.purchaseId, `${path}.purchaseId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    status,
    beneficiary: parsePrincipalRef(v.beneficiary, `${path}.beneficiary`),
    planId: uuid(v.planId, `${path}.planId`),
    planVersion: parseRevision(v.planVersion, `${path}.planVersion`),
    quoteId: uuid(v.quoteId, `${path}.quoteId`),
    total,
    paymentMethod: oneOf(v.paymentMethod, `${path}.paymentMethod`, PAYMENT_METHODS),
    obligationId,
    subscriptionId,
    createdAt,
    updatedAt,
  };
}

/**
 * The beneficiary is the verified caller, never a body field. `total` is a
 * consistency assertion against the quote (QUOTE_MISMATCH), not pricing authority.
 */
export interface CreatePurchaseRequestV1 {
  readonly planId: string;
  readonly planVersion: number;
  readonly quoteId: string;
  readonly total: Money;
  readonly paymentMethod: PaymentMethod;
}

export function parseCreatePurchaseRequestV1(value: unknown): CreatePurchaseRequestV1 {
  const v = closed(value, '$', ['planId', 'planVersion', 'quoteId', 'total', 'paymentMethod']);
  const total = parseNonNegativeMoney(v.total, '$.total');
  if (total.amountMinor === '0') throw new ContractViolation('ZERO_PURCHASE', '$.total');
  return {
    planId: uuid(v.planId, '$.planId'),
    planVersion: parseRevision(v.planVersion, '$.planVersion'),
    quoteId: uuid(v.quoteId, '$.quoteId'),
    total,
    paymentMethod: oneOf(v.paymentMethod, '$.paymentMethod', PAYMENT_METHODS),
  };
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_STATUSES = [
  'ACTIVE',
  'FROZEN',
  'EXHAUSTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface UnitsV1 {
  readonly total: number;
  readonly reserved: number;
  readonly consumed: number;
  /** total − reserved − consumed; the parser recomputes it. */
  readonly available: number;
}

export interface SubscriptionV1 {
  readonly subscriptionId: string;
  readonly revision: number;
  readonly status: SubscriptionStatus;
  readonly beneficiary: PrincipalRef;
  readonly planId: string;
  readonly planVersion: number;
  readonly purchaseId: string;
  readonly units: UnitsV1;
  readonly startsAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly frozenAt: UtcTimestamp | null;
  readonly cancelledAt: UtcTimestamp | null;
  readonly updatedAt: UtcTimestamp;
}

function parseUnits(value: unknown, path: string): UnitsV1 {
  const v = closed(value, path, ['total', 'reserved', 'consumed', 'available']);
  const total = integer(v.total, `${path}.total`, 1, MAX_PLAN_UNITS);
  const reserved = integer(v.reserved, `${path}.reserved`, 0, MAX_PLAN_UNITS);
  const consumed = integer(v.consumed, `${path}.consumed`, 0, MAX_PLAN_UNITS);
  const available = integer(v.available, `${path}.available`, 0, MAX_PLAN_UNITS);
  if (reserved + consumed > total || available !== total - reserved - consumed)
    throw new ContractViolation('INCONSISTENT_UNITS', path);
  return { total, reserved, consumed, available };
}

const nullableUtc = (value: unknown, path: string): UtcTimestamp | null =>
  value === null ? null : parseUtc(value, path);

export function parseSubscriptionV1(value: unknown, path = '$'): SubscriptionV1 {
  const v = closed(value, path, [
    'subscriptionId',
    'revision',
    'status',
    'beneficiary',
    'planId',
    'planVersion',
    'purchaseId',
    'units',
    'startsAt',
    'expiresAt',
    'frozenAt',
    'cancelledAt',
    'updatedAt',
  ]);
  const status = oneOf(v.status, `${path}.status`, SUBSCRIPTION_STATUSES);
  const units = parseUnits(v.units, `${path}.units`);
  const startsAt = parseUtc(v.startsAt, `${path}.startsAt`);
  const expiresAt = parseUtc(v.expiresAt, `${path}.expiresAt`);
  if (expiresAt <= startsAt) throw new ContractViolation('INVALID_VALIDITY', `${path}.expiresAt`);
  const frozenAt = nullableUtc(v.frozenAt, `${path}.frozenAt`);
  const cancelledAt = nullableUtc(v.cancelledAt, `${path}.cancelledAt`);
  if ((status === 'FROZEN') !== (frozenAt !== null))
    throw new ContractViolation('INCONSISTENT_FREEZE', `${path}.frozenAt`);
  if ((status === 'CANCELLED') !== (cancelledAt !== null))
    throw new ContractViolation('INCONSISTENT_CANCELLATION', `${path}.cancelledAt`);
  // EXHAUSTED means every unit was consumed; a reserved unit can still be released.
  if ((status === 'EXHAUSTED') !== (units.consumed === units.total))
    throw new ContractViolation('INCONSISTENT_EXHAUSTION', `${path}.status`);
  return {
    subscriptionId: uuid(v.subscriptionId, `${path}.subscriptionId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    status,
    beneficiary: parsePrincipalRef(v.beneficiary, `${path}.beneficiary`),
    planId: uuid(v.planId, `${path}.planId`),
    planVersion: parseRevision(v.planVersion, `${path}.planVersion`),
    purchaseId: uuid(v.purchaseId, `${path}.purchaseId`),
    units,
    startsAt,
    expiresAt,
    frozenAt,
    cancelledAt,
    updatedAt: parseUtc(v.updatedAt, `${path}.updatedAt`),
  };
}

// ---------------------------------------------------------------------------
// Change requests (freeze / resume / cancel)
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_CHANGE_ACTIONS = ['FREEZE', 'RESUME', 'CANCEL'] as const;
export type SubscriptionChangeAction = (typeof SUBSCRIPTION_CHANGE_ACTIONS)[number];
/** Closed on purpose: a change never carries free text (PII). */
export const SUBSCRIPTION_CHANGE_REASONS = [
  'CUSTOMER_REQUEST',
  'TRAVEL',
  'VEHICLE_UNAVAILABLE',
  'SERVICE_QUALITY',
  'OTHER',
] as const;
export type SubscriptionChangeReason = (typeof SUBSCRIPTION_CHANGE_REASONS)[number];
/**
 * APPLIED          the subscription is in the new state now (see `subscription`)
 * SCHEDULED        approved policy makes it effective at `effectiveAt` (future)
 * PENDING_REVIEW   staff must decide; nothing changed yet
 * REJECTED         not allowed under current revision/policy; nothing changed
 */
export const SUBSCRIPTION_CHANGE_STATUSES = [
  'APPLIED',
  'SCHEDULED',
  'PENDING_REVIEW',
  'REJECTED',
] as const;
export type SubscriptionChangeStatus = (typeof SUBSCRIPTION_CHANGE_STATUSES)[number];

export interface RequestSubscriptionChangeV1 {
  readonly expectedRevision: number;
  readonly action: SubscriptionChangeAction;
  readonly reason: SubscriptionChangeReason;
}

export function parseRequestSubscriptionChangeV1(value: unknown): RequestSubscriptionChangeV1 {
  const v = closed(value, '$', ['expectedRevision', 'action', 'reason']);
  return {
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    action: oneOf(v.action, '$.action', SUBSCRIPTION_CHANGE_ACTIONS),
    reason: oneOf(v.reason, '$.reason', SUBSCRIPTION_CHANGE_REASONS),
  };
}

export interface SubscriptionChangeV1 {
  readonly changeId: string;
  readonly action: SubscriptionChangeAction;
  readonly status: SubscriptionChangeStatus;
  /** Non-null for APPLIED and SCHEDULED. */
  readonly effectiveAt: UtcTimestamp | null;
  /** The subscription as it is NOW (unchanged unless APPLIED). */
  readonly subscription: SubscriptionV1;
}

export function parseSubscriptionChangeV1(value: unknown, path = '$'): SubscriptionChangeV1 {
  const v = closed(value, path, ['changeId', 'action', 'status', 'effectiveAt', 'subscription']);
  const action = oneOf(v.action, `${path}.action`, SUBSCRIPTION_CHANGE_ACTIONS);
  const status = oneOf(v.status, `${path}.status`, SUBSCRIPTION_CHANGE_STATUSES);
  const effectiveAt = nullableUtc(v.effectiveAt, `${path}.effectiveAt`);
  if ((status === 'APPLIED' || status === 'SCHEDULED') !== (effectiveAt !== null))
    throw new ContractViolation('INCONSISTENT_EFFECTIVE_AT', `${path}.effectiveAt`);
  const subscription = parseSubscriptionV1(v.subscription, `${path}.subscription`);
  if (status === 'APPLIED') {
    const expected = { FREEZE: 'FROZEN', CANCEL: 'CANCELLED', RESUME: 'ACTIVE' }[action];
    // RESUME of a fully used plan lands in EXHAUSTED, which is still a resume.
    const resumedExhausted = action === 'RESUME' && subscription.status === 'EXHAUSTED';
    if (subscription.status !== expected && !resumedExhausted)
      throw new ContractViolation('CHANGE_NOT_REFLECTED', `${path}.subscription.status`);
  }
  return {
    changeId: uuid(v.changeId, `${path}.changeId`),
    action,
    status,
    effectiveAt,
    subscription,
  };
}

// ---------------------------------------------------------------------------
// Entitlement reservations (Booking saga participant)
// ---------------------------------------------------------------------------

export const RESERVATION_STATUSES = ['RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const RESOLUTION_ACTIONS = ['CONSUME', 'RELEASE'] as const;
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

export interface EntitlementReservationV1 {
  readonly reservationId: string;
  readonly revision: number;
  readonly subscriptionId: string;
  readonly bookingId: string;
  readonly packageId: string;
  readonly status: ReservationStatus;
  readonly reservedAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  /** Non-null exactly when not RESERVED. */
  readonly resolvedAt: UtcTimestamp | null;
}

export function parseEntitlementReservationV1(
  value: unknown,
  path = '$',
): EntitlementReservationV1 {
  const v = closed(value, path, [
    'reservationId',
    'revision',
    'subscriptionId',
    'bookingId',
    'packageId',
    'status',
    'reservedAt',
    'expiresAt',
    'resolvedAt',
  ]);
  const status = oneOf(v.status, `${path}.status`, RESERVATION_STATUSES);
  const reservedAt = parseUtc(v.reservedAt, `${path}.reservedAt`);
  const expiresAt = parseUtc(v.expiresAt, `${path}.expiresAt`);
  if (expiresAt <= reservedAt) throw new ContractViolation('INVALID_EXPIRY', `${path}.expiresAt`);
  const resolvedAt = nullableUtc(v.resolvedAt, `${path}.resolvedAt`);
  if ((status === 'RESERVED') !== (resolvedAt === null))
    throw new ContractViolation('INCONSISTENT_RESOLUTION', `${path}.resolvedAt`);
  return {
    reservationId: uuid(v.reservationId, `${path}.reservationId`),
    revision: parseRevision(v.revision, `${path}.revision`),
    subscriptionId: uuid(v.subscriptionId, `${path}.subscriptionId`),
    bookingId: uuid(v.bookingId, `${path}.bookingId`),
    packageId: uuid(v.packageId, `${path}.packageId`),
    status,
    reservedAt,
    expiresAt,
    resolvedAt,
  };
}

/** One unit per Booking. The beneficiary is checked by the owner against the subscription. */
export interface ReserveEntitlementRequestV1 {
  readonly subscriptionId: string;
  readonly expectedRevision: number;
  readonly beneficiary: PrincipalRef;
  readonly bookingId: string;
  readonly packageId: string;
}

export function parseReserveEntitlementRequestV1(value: unknown): ReserveEntitlementRequestV1 {
  const v = closed(value, '$', [
    'subscriptionId',
    'expectedRevision',
    'beneficiary',
    'bookingId',
    'packageId',
  ]);
  return {
    subscriptionId: uuid(v.subscriptionId, '$.subscriptionId'),
    expectedRevision: parseRevision(v.expectedRevision, '$.expectedRevision'),
    beneficiary: parsePrincipalRef(v.beneficiary, '$.beneficiary'),
    bookingId: uuid(v.bookingId, '$.bookingId'),
    packageId: uuid(v.packageId, '$.packageId'),
  };
}

/**
 * CONSUME when the Booking reached the approved consume trigger; RELEASE as a
 * saga compensation before consumption. `bookingId` must equal the reservation's
 * (RESERVATION_BOOKING_MISMATCH). Releasing a CONSUMED reservation is refused
 * (RESERVATION_NOT_ACTIVE); a correction is a separate, audited owner action.
 */
export interface ResolveEntitlementRequestV1 {
  readonly action: ResolutionAction;
  readonly bookingId: string;
}

export function parseResolveEntitlementRequestV1(value: unknown): ResolveEntitlementRequestV1 {
  const v = closed(value, '$', ['action', 'bookingId']);
  return {
    action: oneOf(v.action, '$.action', RESOLUTION_ACTIONS),
    bookingId: uuid(v.bookingId, '$.bookingId'),
  };
}
