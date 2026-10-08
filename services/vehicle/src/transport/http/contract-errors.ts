import { randomUUID } from 'node:crypto';
import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  CORRELATION_HEADER,
  bestEffortLog,
  resolveCorrelationId,
  type Logger,
} from '@carwash/service-kit';
import { ApplicationError } from '../../application';
import { VehicleRuleError, VehicleValidationError } from '../../domain';

/**
 * The vehicle.v1 error envelope (packages/contracts common/errors.ts):
 * {error:{code, reason, message, requestId, correlationId, retryable,
 * retryAfterMs, issues[]}}. The service cannot depend on @carwash/contracts yet
 * (request A-P02-01), so the code table is mirrored here and the provider
 * tests parse every error with the published parseApiErrorEnvelope.
 *
 * Messages are fixed English diagnostics and never echo a refused value.
 */
export type ContractErrorCode =
  | 'REQUEST_INVALID'
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'AUTH_FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'REVISION_CONFLICT'
  | 'REVISION_REQUIRED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS: Readonly<Record<ContractErrorCode, number>> = {
  REQUEST_INVALID: 400,
  VALIDATION_FAILED: 422,
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REVISION_CONFLICT: 412,
  REVISION_REQUIRED: 428,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  IDEMPOTENCY_CONFLICT: 409,
  BUSINESS_RULE_VIOLATION: 422,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Retryable with the same key, exactly as API_ERROR_RETRYABLE declares. */
const RETRYABLE: ReadonlySet<ContractErrorCode> = new Set(['DEPENDENCY_UNAVAILABLE']);

const MESSAGE: Readonly<Record<ContractErrorCode, string>> = {
  REQUEST_INVALID: 'The request is malformed.',
  VALIDATION_FAILED: 'The request body is invalid.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current state.',
  REVISION_CONFLICT: 'The resource has changed; reload it and try again.',
  REVISION_REQUIRED: 'An If-Match revision is required.',
  IDEMPOTENCY_KEY_REQUIRED: 'An Idempotency-Key header is required.',
  IDEMPOTENCY_CONFLICT: 'The idempotency key was used with a different request.',
  BUSINESS_RULE_VIOLATION: 'The request violates a business rule.',
  DEPENDENCY_UNAVAILABLE: 'A required dependency is unavailable.',
  INTERNAL_ERROR: 'The request could not be completed.',
};

export interface ContractError {
  readonly code: ContractErrorCode;
  readonly reason: string | null;
  readonly issues: readonly { readonly field: string; readonly code: string }[];
}

function frameworkStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as { getStatus?: unknown; status?: unknown; type?: unknown };
  if (typeof record.getStatus === 'function') {
    const status: unknown = (record.getStatus as () => unknown).call(error);
    return typeof status === 'number' ? status : null;
  }
  // body-parser errors (malformed JSON, oversized body) carry a numeric status.
  if (typeof record.type === 'string' && typeof record.status === 'number') return record.status;
  return null;
}

/** Inner-layer refusals and framework errors in contract vocabulary. */
export function classify(error: unknown): ContractError {
  if (error instanceof ApplicationError) {
    return {
      code: error.code,
      reason: error.reason,
      issues: error.field ? [{ field: error.field, code: 'INVALID_VALUE' }] : [],
    };
  }
  if (error instanceof VehicleValidationError) {
    return {
      code: 'VALIDATION_FAILED',
      reason: null,
      issues: [{ field: error.field, code: error.issue }],
    };
  }
  if (error instanceof VehicleRuleError) {
    return {
      code: error.reason === 'VEHICLE_ARCHIVED' ? 'CONFLICT' : 'BUSINESS_RULE_VIOLATION',
      reason: error.reason,
      issues: [],
    };
  }
  const status = frameworkStatus(error);
  if (status === 404) return { code: 'NOT_FOUND', reason: null, issues: [] };
  if (status !== null && status >= 400 && status < 500) {
    return { code: 'REQUEST_INVALID', reason: null, issues: [] };
  }
  return { code: 'INTERNAL_ERROR', reason: null, issues: [] };
}

export function contractEnvelope(error: ContractError, correlationId: string, requestId: string) {
  return {
    status: STATUS[error.code],
    body: {
      error: {
        code: error.code,
        reason: error.reason,
        message: MESSAGE[error.code],
        requestId,
        correlationId,
        retryable: RETRYABLE.has(error.code),
        retryAfterMs: null,
        issues: error.issues,
      },
    },
  };
}

interface FilterRequest {
  readonly headers?: Record<string, unknown>;
  readonly method?: string;
}

interface FilterResponse {
  status(code: number): FilterResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
}

/**
 * Applied to the vehicle controller (and globally by create-app) so every
 * vehicle.v1 route answers in the contract envelope. Controller-scoped filters
 * take precedence over the platform filter bootstrapService adds.
 */
@Catch()
export class ContractExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger?: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FilterRequest>();
    const response = http.getResponse<FilterResponse>();
    const correlationId = resolveCorrelationId(request.headers?.[CORRELATION_HEADER]);
    const classified = classify(error);
    const { status, body } = contractEnvelope(classified, correlationId, randomUUID());
    bestEffortLog(this.logger, status >= 500 ? 'error' : 'warn', 'request_failed', {
      code: classified.code,
      reason: classified.reason,
      status,
      correlationId,
      method: request.method,
      ...(status >= 500 ? { error } : {}),
    });
    response.setHeader(CORRELATION_HEADER, correlationId);
    response.setHeader('cache-control', 'no-store');
    response.status(status).json(body);
  }
}
