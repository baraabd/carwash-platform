/**
 * Application failures expressed in the shared API error vocabulary
 * (`common/errors` of @carwash/contracts): a stable `code`, an optional
 * owner `reason` and field `issues`. The transport renders the envelope;
 * internal exception text is never reflected.
 */
export type PricingErrorCode =
  | 'REQUEST_INVALID'
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE';

export const ERROR_STATUS: Readonly<Record<PricingErrorCode, number>> = {
  REQUEST_INVALID: 400,
  VALIDATION_FAILED: 422,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 412,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  BUSINESS_RULE_VIOLATION: 422,
  DEPENDENCY_UNAVAILABLE: 503,
  UPSTREAM_UNAVAILABLE: 502,
};

/** Codes a client may retry with the SAME request and key (contract API_ERROR_RETRYABLE). */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'DEPENDENCY_UNAVAILABLE',
  'UPSTREAM_UNAVAILABLE',
]);

export interface FieldIssue {
  readonly field: string;
  readonly code: string;
}

export class PricingApplicationError extends Error {
  readonly status: number;
  constructor(
    readonly code: PricingErrorCode,
    readonly reason: string | null = null,
    readonly issues: readonly FieldIssue[] = [],
  ) {
    super(code);
    this.name = 'PricingApplicationError';
    this.status = ERROR_STATUS[code];
  }
}

/** The body stored in an idempotency receipt for a refused command. */
export function errorOutcome(
  code: PricingErrorCode,
  reason: string | null = null,
  issues: readonly FieldIssue[] = [],
): { status: number; body: Record<string, unknown> } {
  return {
    status: ERROR_STATUS[code],
    body: { code, reason, issues: issues.map((i) => ({ field: i.field, code: i.code })) },
  };
}
