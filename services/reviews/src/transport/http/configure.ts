import type { IncomingMessage } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ContractViolation } from '@carwash/contracts';
import { failure, requestIds, type HttpResponse } from './http-support';

/** Malformed or oversized JSON is rejected without logging the parser's body/error. */
export function configureReviewsTransport(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: 16_384, strict: true });
  app.use(
    (
      error: unknown,
      request: IncomingMessage,
      response: HttpResponse,
      next: (error: unknown) => void,
    ) => {
      if (!request.url?.startsWith('/internal/v1/reviews/')) return next(error);
      const ids = requestIds(request);
      const status =
        typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      const result = failure(
        status === 400 || status === 413 || status === 415
          ? new ContractViolation('INVALID_JSON', '$')
          : error,
        ids,
      );
      response.setHeader('x-request-id', ids.requestId);
      response.setHeader('x-correlation-id', ids.correlationId);
      response.setHeader('cache-control', 'no-store');
      response.status(result.status).json(result.body);
    },
  );
}
