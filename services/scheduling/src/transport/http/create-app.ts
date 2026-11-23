import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SchedulingHttpFilter } from './http-errors';

/** HTTP transport adapter. Business rules never live in this factory. */
export async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  // Failures raised before a controller runs (malformed JSON, unknown route)
  // also answer in the published error envelope.
  app.useGlobalFilters(new SchedulingHttpFilter());
  return app;
}
