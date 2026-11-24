import type { IncomingMessage } from 'node:http';
import {
  API_ERROR_STATUS,
  apiError,
  ContractViolation,
  type ApiErrorCode,
} from '@carwash/contracts';
import { resolveCorrelationId } from '@carwash/service-kit';
import { ReviewsError } from '../../application/errors';

export interface HttpResponse {
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponse;
  json(value: unknown): unknown;
}

export function requestIds(request: IncomingMessage) {
  const text = (name: string) => {
    const value = request.headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    requestId: resolveCorrelationId(text('x-request-id')),
    correlationId: resolveCorrelationId(text('x-correlation-id')),
  };
}

export function credential(request: IncomingMessage): string | undefined {
  const count = request.rawHeaders.filter(
    (_, index) => index % 2 === 0 && request.rawHeaders[index]?.toLowerCase() === 'authorization',
  ).length;
  if (
    count > 1 ||
    request.headers['x-service-client'] !== undefined ||
    request.headers['x-service-token'] !== undefined
  )
    throw new ReviewsError('AUTH_REQUIRED');
  return request.headers.authorization;
}

export function failure(error: unknown, ids: { requestId: string; correlationId: string }) {
  const code: ApiErrorCode =
    error instanceof ReviewsError
      ? error.code
      : error instanceof ContractViolation
        ? 'REQUEST_INVALID'
        : 'INTERNAL_ERROR';
  return {
    status: API_ERROR_STATUS[code],
    body: apiError(code, 'The Reviews request could not be completed.', ids, {
      ...(error instanceof ReviewsError && error.reason ? { reason: error.reason } : {}),
      ...(error instanceof ContractViolation
        ? {
            issues: [
              {
                // Unknown field names are untrusted free text; do not echo them into error telemetry.
                field: /^[A-Za-z0-9_.$:[\]-]{1,160}$/.test(error.path) ? error.path : '$',
                code: error.code,
              },
            ],
          }
        : {}),
    }),
  };
}
