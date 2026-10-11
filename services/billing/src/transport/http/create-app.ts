import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';

/**
 * HTTP transport adapter. Business rules never live in this factory. The raw
 * request bytes are kept (rawBody) because provider notification adapters
 * authenticate the exact bytes received.
 */
export function createHttpApplication(): Promise<INestApplication> {
  return NestFactory.create(AppModule, { logger: false, abortOnError: false, rawBody: true });
}
