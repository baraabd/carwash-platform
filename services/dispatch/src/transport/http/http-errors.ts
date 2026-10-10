import { randomUUID } from 'node:crypto';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  CORRELATION_HEADER,
  bestEffortLog,
  createLogger,
  resolveCorrelationId,
  type Logger,
} from '@carwash/service-kit';
import { DispatchError, type DispatchErrorCode } from '../../domain';
import { IdentityAuthFailure } from '../../infrastructure/identity/identity-session.client';
import {
  ConcurrencyViolation,
  isTransientConflict,
} from '../../infrastructure/persistence/prisma-dispatch.store';

/**
 * The shared API error envelope (@carwash/contracts common/errors.ts):
 *   {error:{code, reason, message, requestId, correlationId, retryable, retryAfterMs, issues}}
 * The package is not a declared dependency of this service (lockfile is Lane
 * E's), so the closed code subset used here is declared locally and every
 * produced body is verified against the PUBLISHED parser by
 * tests/production/C/dispatch-contract.test.mjs.
 */
type ApiErrorCode =
  | 'REQUEST_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS: Readonly<Record<ApiErrorCode, number>> = {
  REQUEST_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REVISION_CONFLICT: 412,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  BUSINESS_RULE_VIOLATION: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Must equal API_ERROR_RETRYABLE of the published contract for these codes. */
const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set(['RATE_LIMITED', 'DEPENDENCY_UNAVAILABLE']);

const DOMAIN: Readonly<Record<DispatchErrorCode, ApiErrorCode>> = {
  INVALID_INPUT: 'REQUEST_INVALID',
  FORBIDDEN: 'AUTH_FORBIDDEN',
  ASSIGNMENT_NOT_FOUND: 'NOT_FOUND',
  OFFER_NOT_FOUND: 'NOT_FOUND',
  ASSIGNMENT_CANCELLED: 'CONFLICT',
  ASSIGNMENT_ALREADY_ASSIGNED: 'CONFLICT',
  ASSIGNMENT_NOT_ASSIGNED: 'CONFLICT',
  LIVE_OFFER_EXISTS: 'CONFLICT',
  OFFER_NOT_LIVE: 'CONFLICT',
  OFFER_EXPIRED: 'CONFLICT',
  JOB_WINDOW_PASSED: 'CONFLICT',
  RESOURCE_BUSY: 'CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  RESOURCE_INELIGIBLE: 'BUSINESS_RULE_VIOLATION',
  ELIGIBILITY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  TASK_NOT_FOUND: 'NOT_FOUND',
  TASK_CLOSED: 'CONFLICT',
  TASK_STAGE_INVALID: 'CONFLICT',
  TECHNICIAN_BUSY: 'CONFLICT',
  CHECK_NOT_FOUND: 'NOT_FOUND',
  CHECKLIST_INCOMPLETE: 'BUSINESS_RULE_VIOLATION',
  EVIDENCE_REQUIRED: 'BUSINESS_RULE_VIOLATION',
  EVIDENCE_INVALID: 'BUSINESS_RULE_VIOLATION',
  EVIDENCE_IN_USE: 'CONFLICT',
  EVIDENCE_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  COLLECTION_NOT_OPEN: 'CONFLICT',
  RESCHEDULE_PENDING: 'CONFLICT',
  WORK_STARTED: 'BUSINESS_RULE_VIOLATION',
  WORK_COMPLETED: 'BUSINESS_RULE_VIOLATION',
  BOOKING_CANCELLED: 'BUSINESS_RULE_VIOLATION',
  ASSIGNMENT_NOT_OPEN: 'CONFLICT',
  CHANGE_MISMATCH: 'CONFLICT',
  CHANGE_NOT_FOUND: 'NOT_FOUND',
  CHANGE_REVERTED: 'CONFLICT',
  CHANGE_CONFIRMED: 'CONFLICT',
};

/** Fixed public messages; internal exception text is never reflected. */
const MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current state.',
  REVISION_CONFLICT: 'The resource changed; refetch it and retry.',
  IDEMPOTENCY_KEY_REQUIRED: 'A valid Idempotency-Key header is required.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  BUSINESS_RULE_VIOLATION: 'The request breaks a business rule.',
  RATE_LIMITED: 'Too many requests.',
  DEPENDENCY_UNAVAILABLE: 'A required dependency is temporarily unavailable.',
  INTERNAL_ERROR: 'The request could not be completed.',
};

export class RateLimited extends Error {
  constructor(readonly retryAfterMs: number) {
    super('RATE_LIMITED');
    this.name = 'RateLimited';
  }
}

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
  readonly retryAfterMs: number | null;
}

function frameworkStatus(error: unknown): number | null {
  const getStatus = (error as { getStatus?: unknown } | null)?.getStatus;
  if (typeof getStatus !== 'function') return null;
  const status: unknown = (getStatus as () => unknown).call(error);
  return typeof status === 'number' ? status : null;
}

export function mapError(error: unknown): Mapped {
  if (error instanceof DispatchError) {
    const code = DOMAIN[error.code];
    // The domain code refines the shared code unless it IS the shared code.
    const plain = code === error.code || code === 'REQUEST_INVALID' || code === 'AUTH_FORBIDDEN';
    return {
      code,
      reason: plain ? null : error.code,
      retryAfterMs: code === 'DEPENDENCY_UNAVAILABLE' ? 1_000 : null,
    };
  }
  if (error instanceof IdentityAuthFailure) {
    return error.reason === 'UNAUTHENTICATED'
      ? { code: 'AUTH_REQUIRED', reason: null, retryAfterMs: null }
      : { code: 'DEPENDENCY_UNAVAILABLE', reason: 'IDENTITY_UNAVAILABLE', retryAfterMs: 1_000 };
  }
  if (error instanceof RateLimited) {
    return {
      code: 'RATE_LIMITED',
      reason: null,
      retryAfterMs: Math.max(0, Math.min(3_600_000, Math.ceil(error.retryAfterMs))),
    };
  }
  if (error instanceof ConcurrencyViolation) {
    return { code: 'CONFLICT', reason: 'CONCURRENT_UPDATE', retryAfterMs: null };
  }
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (prismaCode === 'P2028' || prismaCode === 'P2024' || isTransientConflict(error)) {
    return { code: 'DEPENDENCY_UNAVAILABLE', reason: 'STORE_BUSY', retryAfterMs: 500 };
  }
  const status = frameworkStatus(error);
  if (status === 404) return { code: 'NOT_FOUND', reason: null, retryAfterMs: null };
  if (status !== null && status >= 400 && status < 500) {
    return { code: 'REQUEST_INVALID', reason: null, retryAfterMs: null };
  }
  return { code: 'INTERNAL_ERROR', reason: null, retryAfterMs: null };
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function errorBody(error: unknown, correlationId: string, requestId: string): ApiErrorBody {
  const mapped = mapError(error);
  const retryable = RETRYABLE.has(mapped.code);
  return {
    error: {
      code: mapped.code,
      reason: mapped.reason,
      message: MESSAGES[mapped.code],
      requestId,
      correlationId,
      retryable,
      retryAfterMs: retryable ? mapped.retryAfterMs : null,
      issues: [],
    },
  };
}

export function statusOf(body: ApiErrorBody): number {
  return STATUS[body.error.code];
}

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
}

@Catch()
export class DispatchHttpFilter implements ExceptionFilter {
  private readonly logger: Logger = createLogger({
    service: 'dispatch',
    base: { component: 'http' },
  });

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{
      headers: Record<string, unknown>;
      method?: string;
    }>();
    const response = http.getResponse<HttpResponseLike>();
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_HEADER]);
    const presented = request.headers['x-request-id'];
    const requestId =
      typeof presented === 'string' && REQUEST_ID.test(presented) ? presented : randomUUID();
    const body = errorBody(error, correlationId, requestId);
    const status = statusOf(body);
    bestEffortLog(this.logger, status >= 500 ? 'error' : 'warn', 'request_failed', {
      code: body.error.code,
      reason: body.error.reason,
      status,
      correlationId,
      requestId,
      method: request.method,
      ...(status >= 500 ? { error } : {}),
    });
    response.setHeader(CORRELATION_HEADER, correlationId);
    if (body.error.retryAfterMs !== null) {
      response.setHeader('retry-after', String(Math.ceil(body.error.retryAfterMs / 1000)));
    }
    response.status(status).json(body);
  }
}
