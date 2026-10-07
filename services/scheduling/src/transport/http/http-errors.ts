import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  AppError,
  CORRELATION_HEADER,
  bestEffortLog,
  createLogger,
  resolveCorrelationId,
  toErrorResponse,
  type Logger,
} from '@carwash/service-kit';
import { SchedulingError, type SchedulingErrorCode } from '../../domain';
import { IdentityAuthFailure } from '../../infrastructure/identity/identity-session.client';
import {
  ConcurrencyViolation,
  isTransientConflict,
} from '../../infrastructure/persistence/prisma-scheduling.store';

const STATUS: Readonly<Record<SchedulingErrorCode, number>> = {
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  WINDOW_NOT_FOUND: 404,
  HOLD_NOT_FOUND: 404,
  WINDOW_EXISTS: 409,
  WINDOW_OVERLAPS: 409,
  WINDOW_CLOSED: 409,
  WINDOW_STARTED: 409,
  CAPACITY_EXHAUSTED: 409,
  CAPACITY_BELOW_COMMITTED: 409,
  HOLD_EXPIRED: 409,
  HOLD_NOT_ACTIVE: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
};

export class RateLimited extends Error {}

/** Translate known failures to the public error vocabulary; unknown ones stay 500. */
export function toAppError(error: unknown): unknown {
  if (error instanceof SchedulingError) {
    return new AppError({ status: STATUS[error.code], code: error.code, message: error.message });
  }
  if (error instanceof IdentityAuthFailure) {
    return error.reason === 'UNAUTHENTICATED'
      ? new AppError({
          status: 401,
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required.',
        })
      : new AppError({
          status: 503,
          code: 'AUTH_UNAVAILABLE',
          message: 'Authentication is temporarily unavailable.',
        });
  }
  if (error instanceof ConcurrencyViolation) {
    return new AppError({
      status: 409,
      code: 'CONCURRENT_UPDATE',
      message: 'The resource changed concurrently; retry.',
    });
  }
  if (error instanceof RateLimited) {
    return new AppError({ status: 429, code: 'RATE_LIMITED', message: 'Too many requests.' });
  }
  // Prisma interactive-transaction timeout / pool exhaustion: the outcome is a
  // rollback, so the caller may retry; it is never reported as success.
  const code = (error as { code?: unknown }).code;
  if (code === 'P2028' || code === 'P2024' || isTransientConflict(error)) {
    return new AppError({
      status: 503,
      code: 'STORE_BUSY',
      message: 'The store is busy; retry later.',
    });
  }
  return error;
}

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
}

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
    const mapped = toAppError(error);
    const body = toErrorResponse(mapped, correlationId);
    bestEffortLog(this.logger, body.error.status >= 500 ? 'error' : 'warn', 'request_failed', {
      code: body.error.code,
      status: body.error.status,
      correlationId,
      method: request.method,
      ...(body.error.status >= 500 ? { error } : {}),
    });
    response.setHeader(CORRELATION_HEADER, correlationId);
    response.status(body.error.status).json(body);
  }
}
