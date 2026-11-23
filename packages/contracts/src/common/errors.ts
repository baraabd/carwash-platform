import { ContractViolation, closed, list, oneOf, text } from './wire';

/**
 * One error envelope for every business HTTP API, owner and Gateway alike.
 * Codes are stable machine values; `message` is diagnostic English and never
 * shown to customers verbatim (the UI owns localized copy).
 */
export const API_ERROR_CODES = [
  'REQUEST_INVALID',
  'VALIDATION_FAILED',
  'AUTH_REQUIRED',
  'AUTH_FORBIDDEN',
  'AUTH_CSRF',
  'NOT_FOUND',
  'CONFLICT',
  'REVISION_CONFLICT',
  'REVISION_REQUIRED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'BUSINESS_RULE_VIOLATION',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_INVALID',
  'OUTCOME_UNKNOWN',
  'SERVICE_NOT_READY',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  REQUEST_INVALID: 400,
  VALIDATION_FAILED: 422,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_CSRF: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REVISION_CONFLICT: 412,
  REVISION_REQUIRED: 428,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  BUSINESS_RULE_VIOLATION: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  UPSTREAM_UNAVAILABLE: 502,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_INVALID: 502,
  // The mutation may or may not have happened. Clients reconcile, never retry blindly.
  OUTCOME_UNKNOWN: 504,
  SERVICE_NOT_READY: 503,
  INTERNAL_ERROR: 500,
};

/** Whether the SAME request (same idempotency key) may be retried safely. */
export const API_ERROR_RETRYABLE: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'UPSTREAM_UNAVAILABLE',
  'SERVICE_NOT_READY',
]);

export interface FieldIssue {
  /** JSON-path-like pointer into the request body, e.g. "$.vehicle.plate". */
  readonly field: string;
  readonly code: string;
}

/**
 * Owner-specific refinement of `code`, e.g. QUOTE_EXPIRED under
 * BUSINESS_RULE_VIOLATION. Each owner contract lists its allowed reasons; the
 * Gateway forwards a reason only when it is in that owner's allowlist.
 */
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly reason: string | null;
    readonly message: string;
    readonly requestId: string;
    readonly correlationId: string;
    readonly retryable: boolean;
    /** Server hint for retryable codes only; null otherwise. */
    readonly retryAfterMs: number | null;
    readonly issues: readonly FieldIssue[];
  };
}

export interface ApiErrorOptions {
  readonly reason?: string;
  readonly retryAfterMs?: number;
  readonly issues?: readonly FieldIssue[];
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  ids: { readonly requestId: string; readonly correlationId: string },
  options: ApiErrorOptions = {},
): ApiErrorEnvelope {
  const retryable = API_ERROR_RETRYABLE.has(code);
  if (options.reason !== undefined && !REASON.test(options.reason)) {
    throw new ContractViolation('INVALID_ERROR_REASON', '$.error.reason');
  }
  if (
    options.retryAfterMs !== undefined &&
    (!retryable || !validRetryAfter(options.retryAfterMs))
  ) {
    throw new ContractViolation('INVALID_RETRY_AFTER', '$.error.retryAfterMs');
  }
  return {
    error: {
      code,
      reason: options.reason ?? null,
      message,
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      retryable,
      retryAfterMs: options.retryAfterMs ?? null,
      issues: options.issues ?? [],
    },
  };
}

function validRetryAfter(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 3_600_000
  );
}

export function issuesFrom(violation: ContractViolation): FieldIssue[] {
  return [{ field: violation.path, code: violation.code }];
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function parseApiErrorEnvelope(value: unknown): ApiErrorEnvelope {
  const root = closed(value, '$', ['error']);
  const e = closed(root.error, '$.error', [
    'code',
    'reason',
    'message',
    'requestId',
    'correlationId',
    'retryable',
    'retryAfterMs',
    'issues',
  ]);
  const code = oneOf(e.code, '$.error.code', API_ERROR_CODES);
  if (e.retryable !== API_ERROR_RETRYABLE.has(code)) {
    throw new ContractViolation('INCONSISTENT_RETRYABLE', '$.error.retryable');
  }
  if (e.reason !== null && (typeof e.reason !== 'string' || !REASON.test(e.reason))) {
    throw new ContractViolation('INVALID_ERROR_REASON', '$.error.reason');
  }
  if (e.retryAfterMs !== null && (!e.retryable || !validRetryAfter(e.retryAfterMs))) {
    throw new ContractViolation('INVALID_RETRY_AFTER', '$.error.retryAfterMs');
  }
  return {
    error: {
      code,
      reason: e.reason,
      retryAfterMs: e.retryAfterMs,
      message: text(e.message, '$.error.message', { max: 500 }),
      requestId: text(e.requestId, '$.error.requestId', { max: 128, pattern: ID }),
      correlationId: text(e.correlationId, '$.error.correlationId', { max: 128, pattern: ID }),
      retryable: e.retryable,
      issues: list(e.issues, '$.error.issues', 50, (issue, path) => {
        const i = closed(issue, path, ['field', 'code']);
        return {
          field: text(i.field, `${path}.field`, { max: 200 }),
          code: text(i.code, `${path}.code`, { max: 64, pattern: /^[A-Z][A-Z0-9_]*$/ }),
        };
      }),
    },
  };
}
