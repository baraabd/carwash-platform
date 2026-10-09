import type { INestApplication } from '@nestjs/common';
import { isIP } from 'node:net';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLogger } from '@carwash/service-kit';
import { AppModule } from '../../app.module';
import {
  CORRELATION_ID_HEADER,
  GeoErrorFilter,
  REQUEST_ID_HEADER,
  requestIds,
  type IdentifiedRequest,
} from './error-envelope';

interface IdResponse {
  setHeader(name: string, value: string): void;
}

/** Geo JSON bodies are small; anything larger is refused before parsing. */
const BODY_LIMIT = '16kb';

/** Trust only explicitly configured proxy hosts, never a hop count or all peers. */
export function trustedProxiesFromEnv(env: NodeJS.ProcessEnv = process.env): false | string[] {
  const raw = env.GEO_TRUSTED_PROXY_IPS;
  if (raw === undefined || raw === '') return false;
  const addresses = raw.split(',').map((address) => address.trim());
  if (addresses.length > 32 || addresses.some((address) => isIP(address) === 0)) {
    throw new Error('INVALID_GEO_TRUSTED_PROXY_IPS');
  }
  return [...new Set(addresses)];
}

/** HTTP transport adapter. Business rules never live in this factory. */
export async function createHttpApplication(): Promise<INestApplication> {
  const trustedProxies = trustedProxiesFromEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  // Express walks X-Forwarded-For from the socket backwards and stops at the
  // first untrusted address. Direct callers cannot choose their own rate key.
  app.set('trust proxy', trustedProxies);
  // Every response carries the request and correlation ids the caller can quote.
  app.use((request: IdentifiedRequest, response: IdResponse, next: () => void) => {
    const ids = requestIds(request);
    response.setHeader(REQUEST_ID_HEADER, ids.requestId);
    response.setHeader(CORRELATION_ID_HEADER, ids.correlationId);
    next();
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useGlobalFilters(new GeoErrorFilter(createLogger({ service: 'geo' })));
  return app;
}
