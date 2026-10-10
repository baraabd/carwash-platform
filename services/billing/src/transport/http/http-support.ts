import {
  AppError,
  CORRELATION_HEADER,
  resolveCorrelationId,
  type Logger,
} from '@carwash/service-kit';
import {
  BillingApplicationError,
  type CommandResult,
  type RequestContext,
} from '../../application';

export const BILLING_V1 = 'internal/v1/billing';

/** Fixed public messages. Internal exception text is never reflected. */
export const MESSAGES: Readonly<Record<string, string>> = {
  REQUEST_INVALID: 'The request is invalid.',
  IDEMPOTENCY_KEY_INVALID: 'A valid Idempotency-Key header is required.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'The operation is not allowed.',
  AUTH_UNAVAILABLE: 'Authorization is temporarily unavailable.',
  NOT_FOUND: 'The requested resource was not found.',
  IDEMPOTENCY_CONFLICT: 'The Idempotency-Key was already used for a different request.',
  OBLIGATION_ALREADY_EXISTS: 'This quote already has a financial obligation.',
  QUOTE_NOT_USABLE: 'The quote is no longer usable; request a new quote.',
  AMOUNT_INVALID: 'The amount is not billable.',
  CURRENCY_UNSUPPORTED: 'The currency or scale is not supported.',
  PROVIDER_REFERENCE_TAKEN: 'This transaction reference was already reported.',
  REVISION_CONFLICT: 'The resource changed; refetch it and retry with a new command.',
  UPSTREAM_UNAVAILABLE: 'A required upstream service is unavailable.',
  OBLIGATION_SETTLED: 'The obligation is already paid.',
  OBLIGATION_VOIDED: 'The obligation was voided.',
  VOID_NOT_ALLOWED: 'A payment was already reported; the obligation cannot be voided.',
  METHOD_UNCHANGED: 'This payment method is already selected.',
  PAYMENT_IN_REVIEW: 'A payment is under review; the method cannot change.',
  NO_ACTIVE_INTENT: 'Choose a payment method first.',
  INTENT_NOT_ACCEPTING_ATTEMPTS: 'The selected method does not accept a transaction reference now.',
  ATTEMPT_NOT_OPEN: 'The payment attempt is already reconciled.',
  ALREADY_UNKNOWN: 'The payment attempt is already marked unknown.',
  ATTEMPT_LIMIT_REACHED: 'Too many transaction references were reported for this obligation.',
  AMOUNT_NOT_EQUAL_OUTSTANDING: 'The amount does not equal the outstanding amount.',
  OBSERVED_AMOUNT_NOT_ALLOWED: 'An unknown outcome must not carry an observed amount.',
  COLLECTION_ALREADY_RECORDED: 'Cash for this obligation or booking was already recorded.',
  TREASURY_REFERENCE_TAKEN: 'This treasury or settlement reference was already used.',
  INTENT_NOT_CASH: 'This obligation is not awaiting cash collection.',
  WORK_NOT_COMPLETED: 'The service is not completed yet.',
  BOOKING_MISMATCH: 'The requested resource was not found.',
  COLLECTOR_NOT_ASSIGNED: 'Only the assigned technician can record this collection.',
  SELF_COLLECTION_FORBIDDEN: 'The operation is not allowed.',
  SEPARATION_OF_DUTIES: 'This step must be done by a different person.',
  RECEIPT_ALREADY_REVERSED: 'The receipt was already reversed.',
  RECEIPT_NOT_HELD: 'The receipt is not held by the collector any more.',
  HANDOVER_NOT_PENDING: 'The handover is not pending.',
  HANDOVER_NOT_RECEIVED: 'The handover has not been received by the treasury.',
  HANDOVER_EMPTY: 'A handover needs at least one receipt.',
  HANDOVER_TOO_LARGE: 'Too many receipts in one handover.',
  HANDOVER_DUPLICATE_RECEIPT: 'A receipt is listed more than once.',
  HANDOVER_MIXED_CURRENCY: 'A handover must use one currency.',
  DECLARED_TOTAL_MISMATCH: 'The declared total does not equal the receipts.',
  CURRENCY_MISMATCH: 'The currency does not match.',
  PROVIDER_CREDIT_REQUIRED: 'Money is recognised only from a confirmed provider credit.',
  PROVIDER_CAPABILITY_MISSING: 'This payment provider does not support that operation.',
  MERCHANT_ACCOUNT_UNKNOWN: 'The merchant account is not configured for this provider.',
  PROVIDER_CREDIT_CONFLICT:
    'This provider transaction was already recorded with different details.',
  NOTIFICATION_REJECTED: 'The notification could not be authenticated.',
  PROVIDER_CREDIT_ALREADY_RECORDED: 'This provider transaction is already recorded.',
  PROVIDER_REFUND_REFERENCE_TAKEN: 'This refund transfer reference was already used.',
  CREDIT_NOT_PENDING: 'The provider credit is not awaiting approval.',
  CREDIT_NOT_CONFIRMED: 'The provider credit is not confirmed.',
  OCCURRED_IN_FUTURE: 'The transaction time is in the future.',
  CREDIT_NOT_REFUNDABLE: 'This provider credit cannot be refunded.',
  REFUND_REASON_NOT_ALLOWED: 'This refund reason does not apply to this credit.',
  REFUND_CURRENCY_MISMATCH: 'The refund currency does not match the credit.',
  REFUND_EXCEEDS_AVAILABLE: 'The refund exceeds the amount still refundable.',
  REFUND_NOT_REQUESTED: 'The refund is not awaiting a decision.',
  REFUND_NOT_EXECUTABLE: 'The refund is not approved for execution.',
  REFUND_NOT_PENDING_AT_PROVIDER: 'The refund has no open provider outcome.',
  REFUND_CHANNEL_MISMATCH: 'This refund is executed through a different channel.',
};

export interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
}

export type RequestHeaders = Record<string, string | undefined>;

export function contextOf(headers: RequestHeaders): RequestContext {
  return {
    credential: headers.authorization,
    correlationId: resolveCorrelationId(headers[CORRELATION_HEADER]),
  };
}

/** Maps application failures to the shared public error envelope. */
export async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof BillingApplicationError)
      throw new AppError({
        status: error.status,
        code: error.code,
        message: MESSAGES[error.code] ?? 'The request could not be completed.',
        ...(error.details ? { details: error.details } : {}),
      });
    throw error;
  }
}

/**
 * Runs one idempotent command and renders it. Logs carry the correlation ID,
 * status code and replay flag only: never amounts, references or subjects.
 */
export async function sendCommand(
  logger: Logger,
  event: string,
  headers: RequestHeaders,
  response: HttpResponse,
  work: (context: RequestContext, key: string | undefined) => Promise<CommandResult>,
): Promise<void> {
  const context = contextOf(headers);
  const result = await run(() => work(context, headers['idempotency-key']));
  logger.info(event, {
    correlationId: context.correlationId,
    status: result.status,
    replayed: result.replayed,
  });
  response.setHeader(CORRELATION_HEADER, context.correlationId);
  response.setHeader('idempotency-replayed', String(result.replayed));
  response.status(result.status).json(result.body);
}
