import type { PaymentRuleCode } from '../domain';

/**
 * Application failures with a fixed public code; the transport maps them to the
 * shared error envelope. Internal exception text is never reflected.
 */
export type BillingErrorCode =
  | 'REQUEST_INVALID'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'OBLIGATION_ALREADY_EXISTS'
  | 'QUOTE_NOT_USABLE'
  | 'AMOUNT_INVALID'
  | 'CURRENCY_UNSUPPORTED'
  | 'PROVIDER_REFERENCE_TAKEN'
  | 'REVISION_CONFLICT'
  | 'UPSTREAM_UNAVAILABLE'
  | PaymentRuleCode;

const STATUS: Readonly<Record<BillingErrorCode, number>> = {
  REQUEST_INVALID: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  OBLIGATION_ALREADY_EXISTS: 409,
  QUOTE_NOT_USABLE: 409,
  PROVIDER_REFERENCE_TAKEN: 409,
  REVISION_CONFLICT: 412,
  AMOUNT_INVALID: 422,
  CURRENCY_UNSUPPORTED: 422,
  AUTH_UNAVAILABLE: 503,
  UPSTREAM_UNAVAILABLE: 503,
  // Domain rule rejections: the current financial state forbids the command.
  OBLIGATION_SETTLED: 409,
  OBLIGATION_VOIDED: 409,
  VOID_NOT_ALLOWED: 409,
  METHOD_UNCHANGED: 409,
  PAYMENT_IN_REVIEW: 409,
  NO_ACTIVE_INTENT: 409,
  INTENT_NOT_ACCEPTING_ATTEMPTS: 409,
  ATTEMPT_NOT_OPEN: 409,
  ALREADY_UNKNOWN: 409,
  ATTEMPT_LIMIT_REACHED: 422,
  AMOUNT_NOT_EQUAL_OUTSTANDING: 422,
  OBSERVED_AMOUNT_REQUIRED: 422,
  OBSERVED_AMOUNT_NOT_ALLOWED: 422,
};

export class BillingApplicationError extends Error {
  readonly status: number;
  constructor(
    readonly code: BillingErrorCode,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(code);
    this.name = 'BillingApplicationError';
    this.status = STATUS[code];
  }
}
