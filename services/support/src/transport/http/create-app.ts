import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppExceptionFilter, createLogger } from '@carwash/service-kit';
import { AppModule, SERVICE_NAME } from '../../app.module';

/** HTTP transport adapter. Business rules never live in this factory. */
export async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  // One public error envelope with a correlation id; internal faults never leak.
  app.useGlobalFilters(new AppExceptionFilter(createLogger({ service: SERVICE_NAME })));
  return app;
}
