import {
  API_ERROR_STATUS,
  ContractViolation,
  apiError,
  billingV1,
  issuesFrom,
  type ApiErrorCode,
  type ApiErrorEnvelope,
} from '@carwash/contracts';
import { resolveCorrelationId } from '@carwash/service-kit';
import { BillingApplicationError } from '../../application';
import { MESSAGES, type RequestHeaders } from './http-support';

const REASONS = new Set<string>(billingV1.BILLING_V1.reasons);
const CODES: Readonly<Record<string, ApiErrorCode>> = {
  REQUEST_INVALID: 'REQUEST_INVALID',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  AUTH_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  UPSTREAM_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  SERVICE_NOT_READY: 'SERVICE_NOT_READY',
  SEPARATION_OF_DUTIES: 'AUTH_FORBIDDEN',
  REFUND_LIMIT_REACHED: 'VALIDATION_FAILED',
};
const REFUND_MESSAGES: Readonly<Record<string, string>> = {
  SERVICE_NOT_READY: 'This Billing operation is unavailable for the recorded payment source.',
  OBLIGATION_NOT_SETTLED: 'Only a settled obligation can be refunded.',
  REFUND_EXCEEDS_REFUNDABLE: 'The amount exceeds the remaining refundable amount.',
  REFUND_NOT_OPEN: 'This refund is not open for this outcome operation.',
  REFUND_REFERENCE_TAKEN: 'This refund reference was already recorded.',
  REFUND_LIMIT_REACHED: 'The obligation has reached the supported refund count.',
  SUBSCRIPTION_FUNDING_COMMITTED:
    'Cancel the funded subscription and settle its outstanding reservations before requesting a refund.',
};

/** Canonical errors use the published closed envelope, including normative retry flags. */
export function canonicalBillingFailure(
  error: unknown,
  headers: RequestHeaders,
  correlationId: string,
): {
  status: number;
  body: ApiErrorEnvelope;
} {
  const ids = { requestId: resolveCorrelationId(headers['x-request-id']), correlationId };
  if (error instanceof ContractViolation) {
    const reference =
      error.code === 'REFUND_REFERENCE_REQUIRED' || error.code === 'REFUND_REFERENCE_NOT_ALLOWED';
    const code: ApiErrorCode = reference
      ? 'BUSINESS_RULE_VIOLATION'
      : error.code === 'ZERO_REFUND'
        ? 'VALIDATION_FAILED'
        : 'REQUEST_INVALID';
    return {
      status: API_ERROR_STATUS[code],
      body: apiError(code, 'The Billing request is invalid.', ids, {
        ...(reference ? { reason: error.code } : {}),
        issues: issuesFrom(error),
      }),
    };
  }
  if (error instanceof BillingApplicationError) {
    const code: ApiErrorCode =
      error.code === 'IDEMPOTENCY_KEY_INVALID'
        ? headers['idempotency-key'] === undefined
          ? 'IDEMPOTENCY_KEY_REQUIRED'
          : 'REQUEST_INVALID'
        : (CODES[error.code] ??
          (error.status === 409
            ? 'CONFLICT'
            : error.status === 422
              ? 'BUSINESS_RULE_VIOLATION'
              : 'INTERNAL_ERROR'));
    return {
      status: API_ERROR_STATUS[code],
      body: apiError(
        code,
        REFUND_MESSAGES[error.code] ??
          MESSAGES[error.code] ??
          'The Billing request could not be completed.',
        ids,
        {
          ...(REASONS.has(error.code) ? { reason: error.code } : {}),
          ...(error.code === 'REFUND_LIMIT_REACHED'
            ? { issues: [{ field: '$.refunds', code: 'REFUND_LIMIT_REACHED' }] }
            : {}),
        },
      ),
    };
  }
  return {
    status: 500,
    body: apiError('INTERNAL_ERROR', 'The Billing request could not be completed.', ids),
  };
}
