/**
 * Application failures with a fixed public code; the transport maps them to the
 * shared error envelope. Internal exception text is never reflected.
 */
export type PricingErrorCode =
  | 'REQUEST_INVALID'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'PRICES_NOT_PUBLISHED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATES_INVALID'
  | 'CATALOG_REVISION_UNKNOWN'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_SELECTION_MISMATCH'
  | 'POLICY_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE';

const STATUS: Readonly<Record<PricingErrorCode, number>> = {
  REQUEST_INVALID: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  QUOTE_EXPIRED: 409,
  QUOTE_SELECTION_MISMATCH: 409,
  RATES_INVALID: 422,
  CATALOG_REVISION_UNKNOWN: 422,
  AUTH_UNAVAILABLE: 503,
  PRICES_NOT_PUBLISHED: 503,
  POLICY_UNAVAILABLE: 503,
  UPSTREAM_UNAVAILABLE: 503,
};

export class PricingApplicationError extends Error {
  readonly status: number;
  constructor(
    readonly code: PricingErrorCode,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(code);
    this.name = 'PricingApplicationError';
    this.status = STATUS[code];
  }
}
