import type { IncomingMessage } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiError, billingV1, type ApiErrorCode } from '@carwash/contracts';
import { resolveCorrelationId } from '@carwash/service-kit';
import { BillingApplicationError } from '../../application';

export interface NotificationResponse {
  status(code: number): NotificationResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): unknown;
  end(): void;
}

export interface NotificationRequest extends IncomingMessage {
  readonly rawBody?: Buffer;
}

/** Express routes are case-insensitive; their raw-body boundary must be too. */
function notificationPath(request: IncomingMessage): boolean {
  return (
    request.method === 'POST' &&
    /^\/internal\/v1\/billing\/provider-notifications\/[^/?]+\/?(?:\?.*)?$/i.test(request.url ?? '')
  );
}

export function notificationHeaders(
  request: NotificationRequest,
  response: NotificationResponse,
): { requestId: string; correlationId: string } {
  const correlationId = resolveCorrelationId(request.headers['x-correlation-id']);
  response.setHeader('x-correlation-id', correlationId);
  response.setHeader('cache-control', 'no-store');
  return {
    requestId: resolveCorrelationId(request.headers['x-request-id']),
    correlationId,
  };
}

export function refuseNotification(
  response: NotificationResponse,
  ids: { requestId: string; correlationId: string },
  status: number,
  code: ApiErrorCode,
  reason?: string,
): void {
  response.status(status).json(
    apiError(code, 'The provider notification could not be accepted.', ids, {
      ...(reason ? { reason } : {}),
    }),
  );
}

/** Fixed public responses; never echo references, merchant details or adapter errors. */
export function notificationApplicationFailure(
  error: unknown,
  response: NotificationResponse,
  ids: { requestId: string; correlationId: string },
): number {
  if (error instanceof BillingApplicationError) {
    // This is called only after validating one of the two published slugs.
    // The legacy application intentionally represents a disabled adapter as404.
    if (error.code === 'NOT_FOUND' || error.code === 'PROVIDER_CAPABILITY_MISSING') {
      refuseNotification(response, ids, 503, 'SERVICE_NOT_READY', 'NOTIFICATION_PROVIDER_DISABLED');
      return 503;
    }
    if (
      [
        'NOTIFICATION_REJECTED',
        'MERCHANT_ACCOUNT_UNKNOWN',
        'PROVIDER_CREDIT_CONFLICT',
        'OCCURRED_IN_FUTURE',
      ].includes(error.code)
    ) {
      refuseNotification(
        response,
        ids,
        401,
        'AUTH_REQUIRED',
        error.details?.reason === 'STALE' ? 'NOTIFICATION_STALE' : 'NOTIFICATION_SIGNATURE_INVALID',
      );
      return 401;
    }
  }
  refuseNotification(response, ids, 500, 'INTERNAL_ERROR');
  return 500;
}

/**
 * Canonical ingress is read once as bounded raw bytes, before JSON/form parsing.
 * The provider adapter alone interprets authenticated content. This middleware
 * is also installed in the real HTTP tests; legacy routes keep their parser.
 */
export function configureProviderNotificationTransport(app: NestExpressApplication): void {
  app.useBodyParser('raw', {
    type: notificationPath,
    limit: billingV1.PROVIDER_NOTIFICATION_MAX_BYTES,
    inflate: false,
  });
  // Body parser errors occur before controller filters. Handle this one route
  // here so bootstrap's generic exception filter cannot change its contract.
  app.use(
    (
      error: unknown,
      request: NotificationRequest,
      response: NotificationResponse,
      next: (error: unknown) => void,
    ) => {
      if (!notificationPath(request)) return next(error);
      const ids = notificationHeaders(request, response);
      const status =
        typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      refuseNotification(
        response,
        ids,
        status === 413 ? 413 : status === 400 || status === 415 ? 400 : 500,
        status === 413 || status === 400 || status === 415 ? 'REQUEST_INVALID' : 'INTERNAL_ERROR',
      );
    },
  );
}
