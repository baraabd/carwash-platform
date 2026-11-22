import { randomUUID } from 'node:crypto';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  API_ERROR_STATUS,
  ContractViolation,
  apiError,
  issuesFrom,
  type ApiErrorCode,
} from '@carwash/contracts';
import { AppExceptionFilter, resolveCorrelationId } from '@carwash/service-kit';
import { ApplicationError, type ApplicationErrorCode } from '../../application';
import { CustomerDomainError } from '../../domain';

const CODES: Readonly<Record<ApplicationErrorCode, ApiErrorCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  IDENTITY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  PROFILE_NOT_FOUND: 'NOT_FOUND',
  PROFILE_CONTACT_MIGRATION_REQUIRED: 'CONFLICT',
  ADDRESS_MIGRATION_REQUIRED: 'CONFLICT',
  ADDRESS_NOT_FOUND: 'NOT_FOUND',
  REVISION_REQUIRED: 'REVISION_REQUIRED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_INVALID: 'REQUEST_INVALID',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_CONFLICT',
};

function isFrameworkInputError(error: unknown): boolean {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return status >= 400 && status < 500;
  }
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { readonly status?: unknown; readonly type?: unknown };
  return (
    typeof value.type === 'string' &&
    typeof value.status === 'number' &&
    value.status >= 400 &&
    value.status < 500
  );
}

/** Canonical customer.v1 failures use the published envelope, without contact values. */
@Catch()
export class CustomerContractExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, unknown> }>();
    const response = http.getResponse<{
      status(code: number): { json(body: unknown): void };
      setHeader(name: string, value: string): void;
    }>();
    const correlationId = resolveCorrelationId(request.headers['x-correlation-id']);
    const code =
      error instanceof ApplicationError
        ? CODES[error.code]
        : error instanceof ContractViolation || error instanceof CustomerDomainError
          ? 'VALIDATION_FAILED'
          : isFrameworkInputError(error)
            ? 'REQUEST_INVALID'
            : 'INTERNAL_ERROR';
    const reason =
      error instanceof ApplicationError &&
      [
        'PROFILE_NOT_FOUND',
        'PROFILE_CONTACT_MIGRATION_REQUIRED',
        'ADDRESS_MIGRATION_REQUIRED',
      ].includes(error.code)
        ? error.code
        : undefined;
    const body = apiError(
      code,
      code === 'INTERNAL_ERROR' ? 'The request could not be completed.' : code,
      { requestId: randomUUID(), correlationId },
      {
        ...(reason ? { reason } : {}),
        ...(error instanceof ContractViolation ? { issues: issuesFrom(error) } : {}),
      },
    );
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-correlation-id', correlationId);
    response.status(API_ERROR_STATUS[code]).json(body);
  }
}

/**
 * Body parsing happens before controller-scoped filters. Preserve the legacy
 * envelope elsewhere while canonical writes get the same strict error shape
 * for malformed JSON and size-limit failures as for application refusals.
 */
@Catch()
export class CustomerTransportExceptionFilter extends AppExceptionFilter {
  private readonly canonical = new CustomerContractExceptionFilter();

  override catch(error: unknown, host: ArgumentsHost): void {
    const request = host
      .switchToHttp()
      .getRequest<{ readonly url?: string; readonly method?: string }>();
    const path = request.url?.split('?')[0];
    const canonicalWrite =
      (path === '/internal/v1/customer/me' &&
        (request.method === 'PUT' || request.method === 'PATCH')) ||
      (path === '/internal/v1/customer/address-snapshots/resolve' && request.method === 'POST');
    if (canonicalWrite) this.canonical.catch(error, host);
    else super.catch(error, host);
  }
}
