import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppExceptionFilter, createLogger } from '@carwash/service-kit';
import { AppModule, SERVICE_NAME } from '../../app.module';
import { configureNotificationReceiptTransport } from './notification-receipts.http';

/** HTTP transport adapter. Business rules never live in this factory. */
export async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
    rawBody: true,
  });
  configureNotificationReceiptTransport(app);
  // One public error envelope with a correlation id; internal faults never leak.
  app.useGlobalFilters(new AppExceptionFilter(createLogger({ service: SERVICE_NAME })));
  return app;
}
