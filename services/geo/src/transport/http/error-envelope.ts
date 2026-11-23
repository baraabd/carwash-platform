import { randomUUID } from 'node:crypto';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Logger } from '@carwash/service-kit';
import { ApplicationError, type ApplicationErrorCode } from '../../application';
import { GeoDomainError } from '../../domain';
import { StoreUnavailableError } from '../../ports';

/**
 * The P01-E1 error envelope, produced by Geo itself.
 *
 * Geo may not depend on @carwash/contracts until Lane E adds it to the
 * lockfile, so the codes and statuses used here are the subset of the
 * published API_ERROR_CODES that Geo emits. The Lane A provider-verification
 * suite parses every error body with the published parseApiErrorEnvelope, so
 * any drift from the contract fails acceptance.
 */
export type GeoApiErrorCode =
  | 'REQUEST_INVALID'
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS: Readonly<Record<GeoApiErrorCode, number>> = {
  REQUEST_INVALID: 400,
  VALIDATION_FAILED: 422,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 412,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Must equal the published API_ERROR_RETRYABLE restricted to Geo's codes. */
const RETRYABLE: ReadonlySet<GeoApiErrorCode> = new Set(['RATE_LIMITED', 'DEPENDENCY_UNAVAILABLE']);

const MESSAGES: Readonly<Record<GeoApiErrorCode, string>> = {
  REQUEST_INVALID: 'The request is malformed.',
  VALIDATION_FAILED: 'The request body violates geo.v1.',
  AUTH_REQUIRED: 'A current session is required.',
  AUTH_FORBIDDEN: 'The caller may not perform this operation.',
  NOT_FOUND: 'Not found.',
  REVISION_CONFLICT: 'The resource changed.',
  RATE_LIMITED: 'Too many requests.',
  DEPENDENCY_UNAVAILABLE: 'A dependency is unavailable; the outcome is not a decision.',
  INTERNAL_ERROR: 'The request could not be completed.',
};

export interface FieldIssue {
  readonly field: string;
  readonly code: string;
}

export interface GeoErrorEnvelope {
  readonly error: {
    readonly code: GeoApiErrorCode;
    readonly reason: null;
    readonly message: string;
    readonly requestId: string;
    readonly correlationId: string;
    readonly retryable: boolean;
    readonly retryAfterMs: number | null;
    readonly issues: readonly FieldIssue[];
  };
}

/** Request/correlation identifiers assigned once per request by the middleware. */
export interface RequestIds {
  readonly requestId: string;
  readonly correlationId: string;
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

function header(value: unknown): string | undefined {
  return typeof value === 'string' && ID.test(value) ? value : undefined;
}

export function resolveRequestIds(headers: Readonly<Record<string, unknown>>): RequestIds {
  return {
    requestId: header(headers[REQUEST_ID_HEADER]) ?? randomUUID(),
    correlationId: header(headers[CORRELATION_ID_HEADER]) ?? randomUUID(),
  };
}

export interface IdentifiedRequest {
  headers: Record<string, unknown>;
  method?: string;
  geoIds?: RequestIds;
}

export function requestIds(request: IdentifiedRequest): RequestIds {
  request.geoIds ??= resolveRequestIds(request.headers);
  return request.geoIds;
}

const APPLICATION_CODES: Readonly<Record<ApplicationErrorCode, GeoApiErrorCode>> = {
  ZONE_NOT_FOUND: 'NOT_FOUND',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  IDENTITY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
};

interface Classified {
  readonly code: GeoApiErrorCode;
  readonly issues: readonly FieldIssue[];
  readonly retryAfterMs: number | null;
}

function frameworkStatus(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null;
  const e = error as { getStatus?: unknown; status?: unknown; type?: unknown };
  if (typeof e.getStatus === 'function') {
    const status: unknown = (e.getStatus as () => unknown).call(error);
    return typeof status === 'number' ? status : null;
  }
  // body-parser errors (malformed JSON, oversized body) carry `type` + `status`.
  if (typeof e.type === 'string' && typeof e.status === 'number') return e.status;
  return null;
}

export function classify(error: unknown): Classified {
  if (error instanceof ApplicationError) {
    const code = APPLICATION_CODES[error.code];
    return {
      code,
      issues: [],
      retryAfterMs: code === 'RATE_LIMITED' ? error.retryAfterMs : null,
    };
  }
  if (error instanceof GeoDomainError) {
    return {
      code: 'VALIDATION_FAILED',
      issues: [{ field: error.field ?? '$', code: error.code }],
      retryAfterMs: null,
    };
  }
  if (error instanceof StoreUnavailableError) {
    return { code: 'DEPENDENCY_UNAVAILABLE', issues: [], retryAfterMs: null };
  }
  const status = frameworkStatus(error);
  if (status === 404) return { code: 'NOT_FOUND', issues: [], retryAfterMs: null };
  if (status !== null && status >= 400 && status < 500) {
    return { code: 'REQUEST_INVALID', issues: [], retryAfterMs: null };
  }
  return { code: 'INTERNAL_ERROR', issues: [], retryAfterMs: null };
}

export function envelope(classified: Classified, ids: RequestIds): GeoErrorEnvelope {
  const retryable = RETRYABLE.has(classified.code);
  return {
    error: {
      code: classified.code,
      reason: null,
      message: MESSAGES[classified.code],
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      retryable,
      retryAfterMs: retryable ? classified.retryAfterMs : null,
      issues: classified.issues,
    },
  };
}

interface ErrorResponse {
  status(code: number): ErrorResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
}

/**
 * Logs code/status/ids only: never the body, a coordinate, a cookie or a
 * token. Unexpected failures log the error class name, not its message.
 */
@Catch()
export class GeoErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<IdentifiedRequest>();
    const response = http.getResponse<ErrorResponse>();
    const ids = requestIds(request);
    const classified = classify(error);
    const status = STATUS[classified.code];
    const fields = {
      code: classified.code,
      status,
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      method: request.method,
      ...(status >= 500 && error instanceof Error ? { errorName: error.name } : {}),
    };
    try {
      if (status >= 500) this.logger.error('request_failed', fields);
      else this.logger.warn('request_failed', fields);
    } catch {
      // Logging must never change the response.
    }
    response.setHeader(REQUEST_ID_HEADER, ids.requestId);
    response.setHeader(CORRELATION_ID_HEADER, ids.correlationId);
    response.setHeader('cache-control', 'no-store');
    if (classified.code === 'RATE_LIMITED' && classified.retryAfterMs !== null) {
      response.setHeader('retry-after', String(Math.ceil(classified.retryAfterMs / 1000)));
    }
    response.status(status).json(envelope(classified, ids));
  }
}
