import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AppExceptionFilter,
  CORRELATION_HEADER,
  createLogger,
  resolveCorrelationId,
} from '@carwash/service-kit';
import { AppModule } from '../../app.module';
import { classify, contractEnvelope } from './contract-errors';
import { VEHICLE_V1 } from './vehicle.controller';

/** Vehicle JSON bodies are small; anything larger is refused before parsing. */
const BODY_LIMIT = '16kb';

interface RawRequest {
  readonly headers: Record<string, unknown>;
}

interface RawResponse {
  status(code: number): RawResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
}

/**
 * Malformed or oversized JSON is refused by the body parser before any route
 * runs, so no controller filter sees it. This error middleware answers those
 * refusals on vehicle.v1 paths in the contract envelope as REQUEST_INVALID.
 */
function contractBodyErrors(
  error: unknown,
  request: RawRequest,
  response: RawResponse,
  next: (error: unknown) => void,
): void {
  const classified = classify(error);
  if (classified.code !== 'REQUEST_INVALID') {
    next(error);
    return;
  }
  const correlationId = resolveCorrelationId(request.headers[CORRELATION_HEADER]);
  const { status, body } = contractEnvelope(classified, correlationId, randomUUID());
  response.setHeader(CORRELATION_HEADER, correlationId);
  response.setHeader('cache-control', 'no-store');
  response.status(status).json(body);
}

/** HTTP transport adapter. Business rules never live in this factory. */
export async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.use(VEHICLE_V1, contractBodyErrors);
  app.useGlobalFilters(new AppExceptionFilter(createLogger({ service: 'vehicle' })));
  return app;
}