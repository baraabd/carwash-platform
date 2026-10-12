import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Logger } from '@carwash/service-kit';
import {
  CORRELATION_ID_HEADER,
  CatalogErrorFilter,
  REQUEST_ID_HEADER,
  requestIds,
  type IdentifiedRequest,
} from './error-envelope';

interface IdResponse {
  setHeader(name: string, value: string): void;
}

/** 200 definitions with 500-character descriptions stay well below this. */
const BODY_LIMIT = '512kb';

/**
 * Request ids, bounded JSON parsing and the shared error envelope. Shared by
 * the production factory and the HTTP test harness so both run the same edge.
 */
export function installCatalogHttp(app: NestExpressApplication, logger: Logger): void {
  app.use((request: IdentifiedRequest, response: IdResponse, next: () => void) => {
    const ids = requestIds(request);
    response.setHeader(REQUEST_ID_HEADER, ids.requestId);
    response.setHeader(CORRELATION_ID_HEADER, ids.correlationId);
    next();
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useGlobalFilters(new CatalogErrorFilter(logger));
}
