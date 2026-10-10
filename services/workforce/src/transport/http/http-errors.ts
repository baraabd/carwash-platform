import { randomUUID } from 'node:crypto';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  CORRELATION_HEADER,
  bestEffortLog,
  createLogger,
  resolveCorrelationId,
  type Logger,
} from '@carwash/service-kit';
import { WorkforceError, type WorkforceErrorCode } from '../../domain';
import { IdentityAuthFailure } from '../../infrastructure/identity/identity-session.client';
import {
  ConcurrencyViolation,
  isTransientConflict,
} from '../../infrastructure/persistence/prisma-workforce.store';

/**
 * The shared API error envelope (@carwash/contracts common/errors.ts):
 *   {error:{code, reason, message, requestId, correlationId, retryable, retryAfterMs, issues}}
 * The package is not a declared dependency of this service (the lockfile is
 * Lane E's), so the closed code subset used here is declared locally and every
 * produced body is verified against the PUBLISHED parser by
 * tests/production/C/workforce-contract.test.mjs.
 */
type ApiErrorCode =
  | 'REQUEST_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS: Readonly<Record<ApiErrorCode, number>> = {
  REQUEST_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Must equal API_ERROR_RETRYABLE of the published contract for these codes. */
const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set(['RATE_LIMITED', 'DEPENDENCY_UNAVAILABLE']);

/**
 * Domain code -> shared code. The domain code travels as `reason` unless it is
 * the plain shared meaning (invalid input, forbidden).
 *
 * REVISION_CONFLICT is answered as 409 CONFLICT + reason REVISION_CONFLICT,
 * because the P03-C interface requires 409 for a stale availability revision
 * while the shared code REVISION_CONFLICT is bound to 412 (If-Match semantics).
 */
const DOMAIN: Readonly<Record<WorkforceErrorCode, ApiErrorCode>> = {
  INVALID_INPUT: 'REQUEST_INVALID',
  INVALID_CURSOR: 'REQUEST_INVALID',
  FORBIDDEN: 'AUTH_FORBIDDEN',
  OPERATOR_NOT_FOUND: 'NOT_FOUND',
  CASE_NOT_FOUND: 'NOT_FOUND',
  SHIFT_NOT_FOUND: 'NOT_FOUND',
  SKILL_NOT_FOUND: 'NOT_FOUND',
  OPERATOR_EXISTS: 'CONFLICT',
  CASE_NOT_PENDING: 'CONFLICT',
  PENDING_CASE_EXISTS: 'CONFLICT',
  SELF_REVIEW_FORBIDDEN: 'CONFLICT',
  SKILL_EXISTS: 'CONFLICT',
  SHIFT_NOT_ACTIVE: 'CONFLICT',
  SHIFT_OVERLAPS: 'CONFLICT',
  VERSION_CONFLICT: 'CONFLICT',
  REVISION_CONFLICT: 'CONFLICT',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_CONFLICT',
};

/** Fixed public messages; internal exception text is never reflected. */
const MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current state.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
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
  if (typeof error !== 'object' || error === null) return null;
  const getStatus: unknown = Reflect.get(error, 'getStatus');
  if (typeof getStatus !== 'function') return null;
  const status: unknown = Reflect.apply(getStatus, error, []);
  return typeof status === 'number' ? status : null;
}

function errorCodeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
}

export function mapError(error: unknown): Mapped {
  if (error instanceof WorkforceError) {
    const plain = error.code === 'INVALID_INPUT' || error.code === 'FORBIDDEN';
    return { code: DOMAIN[error.code], reason: plain ? null : error.code, retryAfterMs: null };
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
  const code = errorCodeOf(error);
  if (code === 'P2028' || code === 'P2024' || isTransientConflict(error)) {
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
export class WorkforceHttpFilter implements ExceptionFilter {
  private readonly logger: Logger = createLogger({
    service: 'workforce',
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
    // Codes and ids only: no body, token, subject or profile data is logged.
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
