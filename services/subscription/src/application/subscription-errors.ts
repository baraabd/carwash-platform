import type { SubscriptionRuleCode } from '../domain';

/**
 * Application failures with a fixed public code; the transport maps them to the
 * shared error envelope. Internal exception text is never reflected.
 */
export type SubscriptionErrorCode =
  | SubscriptionRuleCode
  | 'REQUEST_INVALID'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_UNAVAILABLE'
  | 'SERVICE_AUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'TERMS_INVALID'
  | 'REVISION_CONFLICT'
  | 'EFFECTIVE_FROM_IN_PAST'
  | 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS'
  | 'EFFECTIVE_FROM_TOO_FAR'
  | 'PLAN_NOT_OFFERED'
  | 'SUBSCRIPTION_ALREADY_OPEN'
  | 'PAYMENT_REFERENCE_USED'
  | 'SELF_SERVICE_FORBIDDEN'
  | 'RESERVATION_CONFLICT'
  | 'BOOKING_ALREADY_RESERVED'
  | 'SERVICE_BUSY';

const STATUS: Readonly<Record<SubscriptionErrorCode, number>> = {
  REQUEST_INVALID: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  AUTH_REQUIRED: 401,
  SERVICE_AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  SELF_SERVICE_FORBIDDEN: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  REVISION_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  SUBSCRIPTION_ALREADY_OPEN: 409,
  PAYMENT_REFERENCE_USED: 409,
  RESERVATION_CONFLICT: 409,
  BOOKING_ALREADY_RESERVED: 409,
  SUBSCRIPTION_NOT_PENDING: 409,
  SUBSCRIPTION_NOT_ACTIVE: 409,
  SUBSCRIPTION_NOT_FROZEN: 409,
  SUBSCRIPTION_CLOSED: 409,
  SUBSCRIPTION_FROZEN: 409,
  PERIOD_NOT_ENDED: 409,
  PERIOD_ENDED: 409,
  ENTITLEMENT_EXHAUSTED: 409,
  RESERVATION_NOT_RESERVED: 409,
  RESERVATION_NOT_COMMITTED: 409,
  CUSTOMER_MAY_ONLY_CANCEL_PENDING: 409,
  PLAN_NOT_OFFERED: 409,
  TERMS_INVALID: 422,
  EFFECTIVE_FROM_IN_PAST: 422,
  EFFECTIVE_FROM_NOT_AFTER_PREVIOUS: 422,
  EFFECTIVE_FROM_TOO_FAR: 422,
  SCHEDULE_OUTSIDE_PERIOD: 422,
  PACKAGE_NOT_COVERED: 422,
  RESERVATION_PACKAGE_MISMATCH: 409,
  AUTH_UNAVAILABLE: 503,
  SERVICE_BUSY: 503,
};

export function statusOf(code: SubscriptionErrorCode): number {
  return STATUS[code];
}

export class SubscriptionApplicationError extends Error {
  readonly status: number;
  constructor(
    readonly code: SubscriptionErrorCode,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(code);
    this.name = 'SubscriptionApplicationError';
    this.status = STATUS[code];
  }
}

/** Fixed public messages. Internal exception text is never reflected. */
export const MESSAGES: Readonly<Record<SubscriptionErrorCode, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  IDEMPOTENCY_KEY_INVALID: 'A valid Idempotency-Key header is required.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  AUTH_UNAVAILABLE: 'Authorization is temporarily unavailable.',
  SERVICE_AUTH_REQUIRED: 'A service credential with the required scope is required.',
  SELF_SERVICE_FORBIDDEN: 'Staff cannot perform this operation on their own subscription.',
  NOT_FOUND: 'The requested resource was not found.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  TERMS_INVALID: 'The plan terms are invalid.',
  REVISION_CONFLICT: 'The plan changed; refetch and retry with a new command.',
  VERSION_CONFLICT: 'The subscription changed; refetch and retry with a new command.',
  EFFECTIVE_FROM_IN_PAST: 'The effective time is in the past.',
  EFFECTIVE_FROM_NOT_AFTER_PREVIOUS: 'The effective time must follow the previous revision.',
  EFFECTIVE_FROM_TOO_FAR: 'The effective time is too far in the future.',
  PLAN_NOT_OFFERED: 'The plan is not offered at this time.',
  SUBSCRIPTION_ALREADY_OPEN: 'An open subscription to this plan already exists.',
  PAYMENT_REFERENCE_USED: 'The payment reference already funded a period.',
  RESERVATION_CONFLICT: 'The booking already holds a different reservation.',
  BOOKING_ALREADY_RESERVED: 'The booking already holds an entitlement.',
  SUBSCRIPTION_NOT_PENDING: 'The subscription is not awaiting activation.',
  SUBSCRIPTION_NOT_ACTIVE: 'The subscription is not active.',
  SUBSCRIPTION_NOT_FROZEN: 'The subscription is not frozen.',
  SUBSCRIPTION_CLOSED: 'The subscription is closed.',
  SUBSCRIPTION_FROZEN: 'The subscription is frozen.',
  PERIOD_NOT_ENDED: 'The current period has not ended.',
  PERIOD_ENDED: 'The current period has ended.',
  SCHEDULE_OUTSIDE_PERIOD: 'The booking time is outside the entitlement period.',
  PACKAGE_NOT_COVERED: 'The package is not covered by the plan.',
  ENTITLEMENT_EXHAUSTED: 'No wash units remain in this period.',
  RESERVATION_NOT_RESERVED: 'The reservation is no longer held.',
  RESERVATION_NOT_COMMITTED: 'The reservation was not consumed.',
  RESERVATION_PACKAGE_MISMATCH: 'The reservation was made for a different package.',
  CUSTOMER_MAY_ONLY_CANCEL_PENDING: 'Only a request that was never activated can be withdrawn.',
  SERVICE_BUSY: 'The service is busy; nothing was changed. Retry the same request.',
};
