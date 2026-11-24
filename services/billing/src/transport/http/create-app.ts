import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../app.module';
import { configureProviderNotificationTransport } from './provider-notification.http';
import { configureCanonicalRefundTransport } from './canonical-refund.http';

/**
 * HTTP transport adapter. Business rules never live in this factory. The raw
 * request bytes are kept (rawBody) because provider notification adapters
 * authenticate the exact bytes received.
 */
export async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
    rawBody: true,
  });
  configureProviderNotificationTransport(app);
  configureCanonicalRefundTransport(app);
  return app;
}
