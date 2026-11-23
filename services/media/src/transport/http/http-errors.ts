import { randomUUID } from 'node:crypto';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  CORRELATION_HEADER,
  bestEffortLog,
  createLogger,
  resolveCorrelationId,
  type Logger,
} from '@carwash/service-kit';
import { MediaError, type MediaErrorCode } from '../../domain';
import { IdentityAuthFailure } from '../../infrastructure/identity/identity-session.client';
import {
  ConcurrencyViolation,
  isTransientConflict,
} from '../../infrastructure/persistence/prisma-media.store';

/**
 * The shared API error envelope (@carwash/contracts common/errors.ts):
 *   {error:{code, reason, message, requestId, correlationId, retryable, retryAfterMs, issues}}
 * The package is not a declared dependency of this service (the lockfile is
 * Lane E's), so the closed code subset used here is declared locally and
 * every produced body is verified against the PUBLISHED parser by
 * tests/production/C/media-s3.test.mjs.
 */
type ApiErrorCode =
  | 'REQUEST_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
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
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Must equal API_ERROR_RETRYABLE of the published contract for these codes. */
const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set(['RATE_LIMITED', 'DEPENDENCY_UNAVAILABLE']);

const DOMAIN: Readonly<Record<MediaErrorCode, ApiErrorCode>> = {
  INVALID_INPUT: 'REQUEST_INVALID',
  FORBIDDEN: 'AUTH_FORBIDDEN',
  OBJECT_NOT_FOUND: 'NOT_FOUND',
  OBJECT_NOT_AVAILABLE: 'CONFLICT',
  // 409, refined by reason. Retry the SAME request after uploading: a refused
  // finalize leaves no idempotency record, so the same key is still usable.
  UPLOAD_MISSING: 'CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  STORAGE_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
};

/** Fixed public messages; internal exception text is never reflected. */
const MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current state.',
  IDEMPOTENCY_KEY_REQUIRED: 'A valid Idempotency-Key header is required.',
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
  const getStatus = (error as { getStatus?: unknown } | null)?.getStatus;
  if (typeof getStatus !== 'function') return null;
  const status: unknown = (getStatus as () => unknown).call(error);
  return typeof status === 'number' ? status : null;
}

export function mapError(error: unknown): Mapped {
  if (error instanceof MediaError) {
    const code = DOMAIN[error.code];
    if (error.code === 'STORAGE_UNAVAILABLE') {
      return { code, reason: 'STORAGE_UNAVAILABLE', retryAfterMs: 1_000 };
    }
    // The domain code refines the shared code unless it IS the shared code.
    const plain = code === error.code || code === 'REQUEST_INVALID' || code === 'AUTH_FORBIDDEN';
    return { code, reason: plain ? null : error.code, retryAfterMs: null };
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

/** Only these error kinds are safe to log whole; anything else logs its name. */
function loggable(error: unknown): unknown {
  if (error instanceof MediaError) return { name: error.name, code: error.code };
  return { name: error instanceof Error ? error.name : 'UNKNOWN_ERROR' };
}

@Catch()
export class MediaHttpFilter implements ExceptionFilter {
  private readonly logger: Logger = createLogger({
    service: 'media',
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
    // Never the request URL (it carries object ids) and never an exception
    // message that could embed a presigned URL: code, status and ids only.
    bestEffortLog(this.logger, status >= 500 ? 'error' : 'warn', 'request_failed', {
      code: body.error.code,
      reason: body.error.reason,
      status,
      correlationId,
      requestId,
      method: request.method,
      ...(status >= 500 ? { error: loggable(error) } : {}),
    });
    response.setHeader(CORRELATION_HEADER, correlationId);
    if (body.error.retryAfterMs !== null) {
      response.setHeader('retry-after', String(Math.ceil(body.error.retryAfterMs / 1000)));
    }
    response.status(status).json(body);
  }
}
