import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { configureReviewsTransport } from './configure';

/** HTTP transport adapter. Business rules never live in this factory. */
export async function createHttpApplication(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  configureReviewsTransport(app);
  return app;
}
