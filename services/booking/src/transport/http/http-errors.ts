import { randomUUID } from 'node:crypto';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  CORRELATION_HEADER,
  bestEffortLog,
  createLogger,
  resolveCorrelationId,
  type Logger,
} from '@carwash/service-kit';
import { BookingError, type BookingErrorCode } from '../../domain';
import { IdentityAuthFailure } from '../../infrastructure/identity/identity-session.client';
import {
  ConcurrencyViolation,
  isTransientConflict,
} from '../../infrastructure/persistence/prisma-booking.store';

export class RateLimited extends Error {}

/**
 * Platform error envelope (packages/contracts common/errors):
 *   {error:{code, reason, message, requestId, correlationId, retryable, retryAfterMs, issues}}
 * `code` is the closed cross-service list, `reason` an owner refinement.
 * Messages are fixed English; internal exception text is never reflected.
 */
type ApiCode =
  | 'REQUEST_INVALID'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'BUSINESS_RULE_VIOLATION'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS: Readonly<Record<ApiCode, number>> = {
  REQUEST_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  BUSINESS_RULE_VIOLATION: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Same set as API_ERROR_RETRYABLE for the codes this service emits. */
const RETRYABLE: ReadonlySet<ApiCode> = new Set<ApiCode>([
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
]);

const BY_DOMAIN: Readonly<Record<BookingErrorCode, ApiCode>> = {
  INVALID_INPUT: 'REQUEST_INVALID',
  FORBIDDEN: 'AUTH_FORBIDDEN',
  BOOKING_NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
  HOLD_ALREADY_BOOKED: 'BUSINESS_RULE_VIOLATION',
  QUOTE_ALREADY_BOOKED: 'BUSINESS_RULE_VIOLATION',
  QUOTE_NOT_USABLE: 'BUSINESS_RULE_VIOLATION',
  QUOTE_MISMATCH: 'BUSINESS_RULE_VIOLATION',
  VEHICLE_NOT_USABLE: 'BUSINESS_RULE_VIOLATION',
  ADDRESS_NOT_USABLE: 'BUSINESS_RULE_VIOLATION',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  ASSIGNMENT_UNVERIFIED: 'DEPENDENCY_UNAVAILABLE',
  INVALID_TRANSITION: 'CONFLICT',
  VERSION_CONFLICT: 'CONFLICT',
};

const MESSAGE: Readonly<Record<ApiCode, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The resource changed concurrently; reload it.',
  IDEMPOTENCY_KEY_REQUIRED: 'A valid Idempotency-Key header is required.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  IDEMPOTENCY_IN_PROGRESS: 'The same request is still being processed; retry shortly.',
  BUSINESS_RULE_VIOLATION: 'The booking cannot be made with these selections.',
  RATE_LIMITED: 'Too many requests.',
  DEPENDENCY_UNAVAILABLE: 'A required service is temporarily unavailable; retry.',
  INTERNAL_ERROR: 'An internal error occurred.',
};

const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface MappedError {
  readonly code: ApiCode;
  readonly status: number;
  readonly reason: string | null;
}

export function mapError(error: unknown): MappedError {
  const build = (code: ApiCode, reason: string | null = null): MappedError => ({
    code,
    status: STATUS[code],
    reason: reason !== null && REASON.test(reason) ? reason : null,
  });
  if (error instanceof BookingError) {
    const code = BY_DOMAIN[error.code];
    return build(
      code,
      code === 'BUSINESS_RULE_VIOLATION' ? (error.reason ?? error.code) : error.reason,
    );
  }
  if (error instanceof IdentityAuthFailure) {
    return error.reason === 'UNAUTHENTICATED'
      ? build('AUTH_REQUIRED')
      : build('DEPENDENCY_UNAVAILABLE');
  }
  if (error instanceof RateLimited) return build('RATE_LIMITED');
  if (error instanceof ConcurrencyViolation) return build('CONFLICT');
  // Interactive-transaction timeout, pool exhaustion, deadlock: rolled back, retryable.
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (prismaCode === 'P2028' || prismaCode === 'P2024' || isTransientConflict(error)) {
    return build('DEPENDENCY_UNAVAILABLE', 'STORE_BUSY');
  }
  // Malformed JSON body rejected by the platform body parser.
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 400 || status === 413) return build('REQUEST_INVALID');
  return build('INTERNAL_ERROR');
}

export function errorEnvelope(
  mapped: MappedError,
  ids: { requestId: string; correlationId: string },
) {
  const retryable = RETRYABLE.has(mapped.code);
  return {
    error: {
      code: mapped.code,
      reason: mapped.reason,
      message: MESSAGE[mapped.code],
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      retryable,
      retryAfterMs: retryable ? 1_000 : null,
      issues: [],
    },
  };
}

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
}

@Catch()
export class BookingHttpFilter implements ExceptionFilter {
  private readonly logger: Logger = createLogger({
    service: 'booking',
    base: { component: 'http' },
  });

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, unknown>; method?: string }>();
    const response = http.getResponse<HttpResponseLike>();
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_HEADER]);
    const mapped = mapError(error);
    const requestId = randomUUID();
    bestEffortLog(this.logger, mapped.status >= 500 ? 'error' : 'warn', 'request_failed', {
      code: mapped.code,
      reason: mapped.reason,
      status: mapped.status,
      correlationId,
      requestId,
      method: request.method,
      ...(mapped.status >= 500 ? { error } : {}),
    });
    response.setHeader(CORRELATION_HEADER, correlationId);
    response.status(mapped.status).json(errorEnvelope(mapped, { requestId, correlationId }));
  }
}
