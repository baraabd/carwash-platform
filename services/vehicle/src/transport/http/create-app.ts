import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppExceptionFilter, createLogger } from '@carwash/service-kit';
import { AppModule } from '../../app.module';

/** Vehicle JSON bodies are small; anything larger is refused before parsing. */
const BODY_LIMIT = '16kb';

/** HTTP transport adapter. Business rules never live in this factory. */
export async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useGlobalFilters(new AppExceptionFilter(createLogger({ service: 'vehicle' })));
  return app;
}
