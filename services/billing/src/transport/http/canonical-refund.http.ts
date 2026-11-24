import type { IncomingMessage } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ContractViolation } from '@carwash/contracts';
import { CORRELATION_HEADER } from '@carwash/service-kit';
import { canonicalBillingFailure } from './canonical-http-support';
import { contextOf, type HttpResponse } from './http-support';

function canonicalRefundWrite(request: IncomingMessage): boolean {
  return (
    request.method === 'POST' &&
    /^\/internal\/v1\/billing\/(?:obligations\/[^/?]+\/refunds|refunds\/[^/?]+\/outcome)\/?(?:\?.*)?$/i.test(
      request.url ?? '',
    )
  );
}

/**
 * Body-parser failures precede controller handlers. Keep the ordinary JSON
 * parser and its default size limit; normalize only the canonical refund routes.
 * Install after provider-notification raw transport so signatures retain bytes.
 */
export function configureCanonicalRefundTransport(app: NestExpressApplication): void {
  app.useBodyParser('json');
  app.use(
    (
      error: unknown,
      request: IncomingMessage,
      response: HttpResponse,
      next: (error: unknown) => void,
    ) => {
      if (!canonicalRefundWrite(request)) return next(error);
      const textHeader = (name: string) => {
        const value = request.headers[name];
        return typeof value === 'string' ? value : undefined;
      };
      const headers = {
        'x-request-id': textHeader('x-request-id'),
        'x-correlation-id': textHeader('x-correlation-id'),
      };
      const context = contextOf(headers);
      const status =
        typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      const rejected =
        status === 400 || status === 413 || status === 415
          ? new ContractViolation('INVALID_JSON', '$')
          : error;
      const result = canonicalBillingFailure(rejected, headers, context.correlationId);
      response.setHeader(CORRELATION_HEADER, context.correlationId);
      response.setHeader('cache-control', 'no-store');
      response.status(result.status).json(result.body);
    },
  );
}
