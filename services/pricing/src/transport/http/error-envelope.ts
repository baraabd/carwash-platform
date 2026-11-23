import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { CORRELATION_HEADER, createLogger, resolveCorrelationId } from '@carwash/service-kit';
import { PricingApplicationError, RETRYABLE_CODES, type FieldIssue } from '../../application';

/**
 * Renders every failure as the shared contract envelope (`common/errors`
 * ApiErrorEnvelope): stable code, owner reason, fixed English message,
 * request/correlation ids, retryability and field issues. Internal exception
 * text, stack traces and upstream bodies are never reflected.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  VALIDATION_FAILED: 'The price book does not match the published catalog or policy.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  NOT_FOUND: 'The requested resource was not found.',
  REVISION_CONFLICT: 'The price book changed; refetch and retry with a new command.',
  IDEMPOTENCY_KEY_REQUIRED: 'An Idempotency-Key header is required.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  BUSINESS_RULE_VIOLATION: 'The request violates a pricing rule.',
  DEPENDENCY_UNAVAILABLE: 'A required dependency is unavailable.',
  UPSTREAM_UNAVAILABLE: 'A required upstream service is unavailable.',
  INTERNAL_ERROR: 'The request could not be completed.',
};
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface EnvelopeIds {
  readonly requestId: string;
  readonly correlationId: string;
}

export function envelopeIds(headers: Record<string, unknown> | undefined): EnvelopeIds {
  const correlationId = resolveCorrelationId(headers?.[CORRELATION_HEADER]);
  const raw = headers?.['x-request-id'];
  return {
    correlationId,
    requestId: typeof raw === 'string' && REQUEST_ID.test(raw) ? raw : correlationId,
  };
}

export function errorEnvelope(
  code: string,
  ids: EnvelopeIds,
  reason: string | null = null,
  issues: readonly FieldIssue[] = [],
): Record<string, unknown> {
  return {
    error: {
      code,
      reason: reason !== null && REASON.test(reason) ? reason : null,
      message: MESSAGES[code] ?? MESSAGES.INTERNAL_ERROR,
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      retryable: RETRYABLE_CODES.has(code),
      retryAfterMs: null,
      issues: issues.map((issue) => ({ field: issue.field, code: issue.code })),
    },
  };
}

function errorCodeOf(body: Record<string, unknown>): string | null {
  const error = body.error as { code?: unknown } | undefined;
  return typeof error?.code === 'string' ? error.code : null;
}

interface FilterResponse {
  status(code: number): FilterResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
}

@Catch()
export class PricingErrorFilter implements ExceptionFilter {
  private readonly logger = createLogger({
    service: 'pricing',
    base: { component: 'pricing-http' },
  });

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ headers?: Record<string, unknown>; method?: string }>();
    const response = http.getResponse<FilterResponse>();
    const ids = envelopeIds(request.headers);
    let status: number;
    let body: Record<string, unknown>;
    if (error instanceof PricingApplicationError) {
      status = error.status;
      body = errorEnvelope(error.code, ids, error.reason, error.issues);
    } else if (error instanceof HttpException && error.getStatus() < 500) {
      // Framework-level refusals (malformed JSON, oversize body, unknown route).
      status = error.getStatus() === 404 ? 404 : 400;
      body = errorEnvelope(status === 404 ? 'NOT_FOUND' : 'REQUEST_INVALID', ids);
    } else {
      status = 500;
      body = errorEnvelope('INTERNAL_ERROR', ids);
    }
    const fields = { status, correlationId: ids.correlationId, method: request.method };
    // Expected refusals (including fail-closed 502/503) are warnings with their
    // stable code; only an unexpected failure is an error with its (redacted) cause.
    if (status === 500) this.logger.error('pricing_request_failed', { ...fields, error });
    else this.logger.warn('pricing_request_refused', { ...fields, code: errorCodeOf(body) });
    response.setHeader(CORRELATION_HEADER, ids.correlationId);
    response.status(status).json(body);
  }
}
