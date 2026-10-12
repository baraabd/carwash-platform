import { randomUUID } from 'node:crypto';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { resolveCorrelationId, type Logger } from '@carwash/service-kit';
import {
  CATALOG_ERROR_STATUS,
  CatalogApplicationError,
  type CatalogErrorCode,
  type CatalogReason,
  type FieldIssue,
} from '../../application';

/**
 * The published error envelope (@carwash/contracts common/errors), produced by
 * Catalog itself. Catalog may not depend on @carwash/contracts until Lane E
 * adds it to the lockfile; the provider suite parses every error body with the
 * published parseApiErrorEnvelope, so any drift fails acceptance.
 */
type EnvelopeCode = CatalogErrorCode | 'INTERNAL_ERROR';

const STATUS: Readonly<Record<EnvelopeCode, number>> = {
  ...CATALOG_ERROR_STATUS,
  INTERNAL_ERROR: 500,
};

/** Must equal the published API_ERROR_RETRYABLE restricted to Catalog's codes. */
const RETRYABLE: ReadonlySet<EnvelopeCode> = new Set<EnvelopeCode>(['DEPENDENCY_UNAVAILABLE']);

const MESSAGES: Readonly<Record<EnvelopeCode, string>> = {
  REQUEST_INVALID: 'The request is malformed.',
  VALIDATION_FAILED: 'The request body violates catalog.v1.',
  AUTH_REQUIRED: 'A current session is required.',
  AUTH_FORBIDDEN: 'The caller may not perform this operation.',
  NOT_FOUND: 'Not found.',
  REVISION_CONFLICT: 'The catalog changed; refetch it and publish against the new revision.',
  IDEMPOTENCY_KEY_REQUIRED: 'An Idempotency-Key header is required.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  BUSINESS_RULE_VIOLATION: 'The publication violates a catalog rule.',
  DEPENDENCY_UNAVAILABLE: 'A dependency is unavailable; the outcome is not a decision.',
  INTERNAL_ERROR: 'The request could not be completed.',
};

export interface ErrorEnvelope {
  readonly error: {
    readonly code: EnvelopeCode;
    readonly reason: CatalogReason | null;
    readonly message: string;
    readonly requestId: string;
    readonly correlationId: string;
    readonly retryable: boolean;
    readonly retryAfterMs: null;
    readonly issues: readonly FieldIssue[];
  };
}

export interface RequestIds {
  readonly requestId: string;
  /** Always a UUID: it is stored in audit rows and event envelopes. */
  readonly correlationId: string;
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const TRACEPARENT_HEADER = 'traceparent';
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

export interface IdentifiedRequest {
  headers: Record<string, unknown>;
  method?: string;
  catalogIds?: RequestIds;
}

export function requestIds(request: IdentifiedRequest): RequestIds {
  if (!request.catalogIds) {
    const requested = request.headers[REQUEST_ID_HEADER];
    request.catalogIds = {
      requestId: typeof requested === 'string' && ID.test(requested) ? requested : randomUUID(),
      correlationId: resolveCorrelationId(request.headers[CORRELATION_ID_HEADER]),
    };
  }
  return request.catalogIds;
}

export function traceParent(request: IdentifiedRequest): string | null {
  const value = request.headers[TRACEPARENT_HEADER];
  return typeof value === 'string' && TRACEPARENT.test(value) ? value : null;
}

export function envelope(
  rejection: {
    readonly code: EnvelopeCode;
    readonly reason: CatalogReason | null;
    readonly issues: readonly FieldIssue[];
  },
  ids: RequestIds,
): { status: number; body: ErrorEnvelope } {
  return {
    status: STATUS[rejection.code],
    body: {
      error: {
        code: rejection.code,
        reason: rejection.reason,
        message: MESSAGES[rejection.code],
        requestId: ids.requestId,
        correlationId: ids.correlationId,
        retryable: RETRYABLE.has(rejection.code),
        retryAfterMs: null,
        issues: rejection.issues,
      },
    },
  };
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

function classify(error: unknown): {
  code: EnvelopeCode;
  reason: CatalogReason | null;
  issues: readonly FieldIssue[];
} {
  if (error instanceof CatalogApplicationError)
    return { code: error.code, reason: error.reason, issues: error.issues };
  const status = frameworkStatus(error);
  if (status === 404) return { code: 'NOT_FOUND', reason: null, issues: [] };
  if (status !== null && status >= 400 && status < 500)
    return { code: 'REQUEST_INVALID', reason: null, issues: [] };
  return { code: 'INTERNAL_ERROR', reason: null, issues: [] };
}

interface ErrorResponse {
  status(code: number): ErrorResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
}

/**
 * Logs code/status/ids only: never the body, a token or a definition text.
 * Unexpected failures log the error class name, not its message.
 */
@Catch()
export class CatalogErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<IdentifiedRequest>();
    const response = http.getResponse<ErrorResponse>();
    const ids = requestIds(request);
    const rendered = envelope(classify(error), ids);
    const fields = {
      code: rendered.body.error.code,
      status: rendered.status,
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      method: request.method,
      ...(rendered.status >= 500 && error instanceof Error ? { errorName: error.name } : {}),
    };
    try {
      if (rendered.status >= 500) this.logger.error('request_failed', fields);
      else this.logger.warn('request_failed', fields);
    } catch {
      // Logging must never change the response.
    }
    response.setHeader(REQUEST_ID_HEADER, ids.requestId);
    response.setHeader(CORRELATION_ID_HEADER, ids.correlationId);
    response.setHeader('cache-control', 'no-store');
    response.status(rendered.status).json(rendered.body);
  }
}
