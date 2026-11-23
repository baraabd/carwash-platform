import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { WorkforceHttpFilter } from './http-errors';

/**
 * HTTP transport adapter. Business rules never live in this factory.
 *
 * The workforce filter is also global so that failures raised before a route
 * handler runs (malformed JSON, oversized body, unknown route) still answer
 * with the shared error envelope instead of the framework's default body.
 */
export async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.useGlobalFilters(new WorkforceHttpFilter());
  return app;
}
