import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException } from '@nestjs/common';
import { apiError, type GatewayErrorCode, type GatewayErrorEnvelope } from '@carwash/contracts';
import { GatewayFault } from '../../domain/policy';
import { contextFor, type GatewayRequest, type GatewayResponse } from './context';
const MESSAGES: Record<GatewayErrorCode, string> = {
  REQUEST_INVALID: 'The request is invalid.',
  AUTH_REQUIRED: 'Authentication is required.',
  AUTH_FORBIDDEN: 'This operation is not allowed.',
  AUTH_CSRF: 'The request origin could not be verified.',
  NOT_FOUND: 'The resource was not found.',
  CONFLICT: 'The request conflicts with the current state.',
  REVISION_CONFLICT: 'The resource changed; read the current revision.',
  REVISION_REQUIRED: 'A current resource revision is required.',
  IDEMPOTENCY_KEY_REQUIRED: 'An idempotency key is required.',
  IDEMPOTENCY_CONFLICT: 'The idempotency key belongs to another command.',
  IDEMPOTENCY_IN_PROGRESS: 'The same command is still being processed.',
  BUSINESS_RULE_VIOLATION: 'The operation is not allowed in the current state.',
  DEPENDENCY_UNAVAILABLE: 'A required service is temporarily unavailable.',
  OUTCOME_UNKNOWN: 'The outcome is unknown; reconcile before retrying.',
  SERVICE_NOT_READY: 'The required service is not ready.',
  VALIDATION_FAILED: 'The request could not be validated.',
  RATE_LIMITED: 'Please retry later.',
  UPSTREAM_UNAVAILABLE: 'The service is temporarily unavailable.',
  UPSTREAM_TIMEOUT: 'The service did not respond in time.',
  UPSTREAM_INVALID: 'The service returned an invalid response.',
  INTERNAL_ERROR: 'The request could not be completed.',
};
function parserStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const detail = error as Error & { type?: unknown; status?: unknown };
  if (detail.type === 'entity.too.large' && detail.status === 413) return 413;
  if (detail.type === 'entity.parse.failed' && detail.status === 400) return 400;
  return undefined;
}
@Catch()
export class GatewayFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<GatewayRequest>();
    const response = http.getResponse<GatewayResponse>();
    const context = request.gatewayContext ?? contextFor(request.headers);
    const status =
      error instanceof GatewayFault
        ? error.status
        : error instanceof HttpException && [400, 404, 413].includes(error.getStatus())
          ? error.getStatus()
          : (parserStatus(error) ?? 500);
    const code: GatewayErrorCode =
      error instanceof GatewayFault
        ? error.code
        : status === 404
          ? 'NOT_FOUND'
          : [400, 413].includes(status)
            ? 'REQUEST_INVALID'
            : 'INTERNAL_ERROR';
    const envelope = apiError(
      code,
      MESSAGES[code],
      context,
      error instanceof GatewayFault && error.reason ? { reason: error.reason } : {},
    );
    const body: GatewayErrorEnvelope = { error: { ...envelope.error, code } };
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-request-id', context.requestId);
    response.setHeader('x-correlation-id', context.correlationId);
    response.status(status).json(body);
  }
}
