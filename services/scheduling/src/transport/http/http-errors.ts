import { randomUUID } from 'node:crypto';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  CORRELATION_HEADER,
  bestEffortLog,
  createLogger,
  resolveCorrelationId,
  type Logger,
} from '@carwash/service-kit';
import { SchedulingError, type SchedulingErrorCode } from '../../domain';
import { IdentityAuthFailure } from '../../infrastructure/identity/identity-session.client';
import {
  ConcurrencyViolation,
  isTransientConflict,
} from '../../infrastructure/persistence/prisma-scheduling.store';

/**
 * The published error envelope (@carwash/contracts common/errors):
 *   {error:{code, reason, message, requestId, correlationId, retryable, retryAfterMs, issues}}
 * `code` comes from the closed cross-service list and fixes the status;
 * `retryable` is derived from `code` exactly as the published parser checks it.
 * Declared locally because the service cannot depend on @carwash/contracts yet
 * (CR-P02-C1 §2); tests/production/C/scheduling-v1-provider.test.mjs validates
 * real responses with the published parser.
 */
type ApiErrorCode =
  | 'REQUEST_INVALID'
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'BUSINESS_RULE_VIOLATION'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS: Readonly<Record<ApiErrorCode, number>> = {
  REQUEST_INVALID: 400,
  VALIDATION_FAILED: 422,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REVISION_CONFLICT: 412,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  BUSINESS_RULE_VIOLATION: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
]);

/** Domain code -> (published code, owner reason). Reasons are stable identifiers. */
const DOMAIN: Readonly<Record<SchedulingErrorCode, readonly [ApiErrorCode, string | null]>> = {
  INVALID_INPUT: ['VALIDATION_FAILED', null],
  FORBIDDEN: ['AUTH_FORBIDDEN', null],
  WINDOW_NOT_FOUND: ['NOT_FOUND', null],
  HOLD_NOT_FOUND: ['NOT_FOUND', null],
  WINDOW_EXISTS: ['CONFLICT', 'WINDOW_EXISTS'],
  WINDOW_OVERLAPS: ['CONFLICT', 'WINDOW_OVERLAPS'],
  WINDOW_CLOSED: ['BUSINESS_RULE_VIOLATION', 'SLOT_UNAVAILABLE'],
  WINDOW_STARTED: ['BUSINESS_RULE_VIOLATION', 'SLOT_UNAVAILABLE'],
  CAPACITY_EXHAUSTED: ['BUSINESS_RULE_VIOLATION', 'SLOT_UNAVAILABLE'],
  SLOT_UNAVAILABLE: ['BUSINESS_RULE_VIOLATION', 'SLOT_UNAVAILABLE'],
  OUTSIDE_HORIZON: ['BUSINESS_RULE_VIOLATION', 'OUTSIDE_HORIZON'],
  CAPACITY_BELOW_COMMITTED: ['BUSINESS_RULE_VIOLATION', 'CAPACITY_BELOW_COMMITTED'],
  HOLD_LIMIT_REACHED: ['BUSINESS_RULE_VIOLATION', 'HOLD_LIMIT_REACHED'],
  BOOKING_ALREADY_COMMITTED: ['CONFLICT', 'BOOKING_ALREADY_COMMITTED'],
  COMMITMENT_NOT_FOUND: ['CONFLICT', 'COMMITMENT_NOT_FOUND'],
  HOLD_EXPIRED: ['BUSINESS_RULE_VIOLATION', 'HOLD_EXPIRED'],
  HOLD_NOT_ACTIVE: ['BUSINESS_RULE_VIOLATION', 'HOLD_NOT_ACTIVE'],
  VERSION_CONFLICT: ['REVISION_CONFLICT', null],
  IDEMPOTENCY_KEY_REUSED: ['IDEMPOTENCY_CONFLICT', null],
  IDEMPOTENCY_KEY_REQUIRED: ['IDEMPOTENCY_KEY_REQUIRED', null],
  IDEMPOTENCY_IN_PROGRESS: ['IDEMPOTENCY_IN_PROGRESS', null],
};

/** Malformed request at the edge (shape, types); never reflects the input. */
export class RequestInvalid extends Error {
  constructor(readonly field: string) {
    super('REQUEST_INVALID');
    this.name = 'RequestInvalid';
  }
}

export class RateLimited extends Error {}

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly reason: string | null;
    readonly message: string;
    readonly requestId: string;
    readonly correlationId: string;
    readonly retryable: boolean;
    readonly retryAfterMs: number | null;
    readonly issues: readonly { readonly field: string; readonly code: string }[];
  };
}

interface Mapped {
  readonly code: ApiErrorCode;
  readonly reason: string | null;
  readonly message: string;
  readonly retryAfterMs: number | null;
  readonly issues: readonly { readonly field: string; readonly code: string }[];
}

/** Translate known failures to the published vocabulary; unknown ones are 500. */
export function mapError(error: unknown): Mapped {
  const plain = (code: ApiErrorCode, message: string, reason: string | null = null): Mapped => ({
    code,
    reason,
    message,
    retryAfterMs: null,
    issues: [],
  });
  if (error instanceof SchedulingError) {
    const [code, reason] = DOMAIN[error.code];
    return plain(code, error.message, reason);
  }
  if (error instanceof RequestInvalid) {
    return {
      ...plain('REQUEST_INVALID', 'The request is invalid.'),
      issues: [{ field: error.field, code: 'INVALID' }],
    };
  }
  if (error instanceof IdentityAuthFailure) {
    return error.reason === 'UNAUTHENTICATED'
      ? plain('AUTH_REQUIRED', 'Authentication is required.')
      : {
          ...plain('DEPENDENCY_UNAVAILABLE', 'Authentication is unavailable.'),
          retryAfterMs: 1_000,
        };
  }
  if (error instanceof ConcurrencyViolation) {
    return plain('CONFLICT', 'The resource changed concurrently; read it again.');
  }
  if (error instanceof RateLimited) {
    return { ...plain('RATE_LIMITED', 'Too many requests.'), retryAfterMs: 60_000 };
  }
  // Prisma interactive-transaction timeout / pool exhaustion / deadlock: the
  // outcome is a rollback, so the caller may retry; never reported as success.
  const code = (error as { code?: unknown }).code;
  if (code === 'P2028' || code === 'P2024' || isTransientConflict(error)) {
    return { ...plain('DEPENDENCY_UNAVAILABLE', 'The store is busy.'), retryAfterMs: 500 };
  }
  return plain('INTERNAL_ERROR', 'Internal error.');
}

export function errorBody(mapped: Mapped, correlationId: string, requestId: string): ApiErrorBody {
  return {
    error: {
      code: mapped.code,
      reason: mapped.reason,
      message: mapped.message,
      requestId,
      correlationId,
      retryable: RETRYABLE.has(mapped.code),
      retryAfterMs: RETRYABLE.has(mapped.code) ? mapped.retryAfterMs : null,
      issues: mapped.issues,
    },
  };
}

export function statusOf(code: ApiErrorCode): number {
  return STATUS[code];
}

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

@Catch()
export class SchedulingHttpFilter implements ExceptionFilter {
  private readonly logger: Logger = createLogger({
    service: 'scheduling',
    base: { component: 'http' },
  });

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, unknown>; method?: string }>();
    const response = http.getResponse<HttpResponseLike>();
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_HEADER]);
    const presented = request.headers['x-request-id'];
    const requestId =
      typeof presented === 'string' && REQUEST_ID.test(presented) ? presented : randomUUID();
    const mapped = mapError(nestBodyError(error) ?? error);
    const status = STATUS[mapped.code];
    bestEffortLog(this.logger, status >= 500 ? 'error' : 'warn', 'request_failed', {
      code: mapped.code,
      reason: mapped.reason,
      status,
      correlationId,
      requestId,
      method: request.method,
      ...(status >= 500 ? { error } : {}),
    });
    response.setHeader(CORRELATION_HEADER, correlationId);
    if (mapped.code === 'RATE_LIMITED' && mapped.retryAfterMs !== null) {
      response.setHeader('retry-after', String(Math.ceil(mapped.retryAfterMs / 1000)));
    }
    response.status(status).json(errorBody(mapped, correlationId, requestId));
  }
}

/** Nest routing and body-parser failures (unknown route, malformed JSON, too large). */
function nestBodyError(error: unknown): RequestInvalid | SchedulingError | null {
  const status = (error as { status?: unknown; getStatus?: () => number }).getStatus?.();
  const raw = (error as { status?: unknown }).status;
  const code = typeof status === 'number' ? status : typeof raw === 'number' ? raw : undefined;
  if (code === 404) return new SchedulingError('HOLD_NOT_FOUND', 'Not found.');
  return code !== undefined && code >= 400 && code < 500 ? new RequestInvalid('$') : null;
}
