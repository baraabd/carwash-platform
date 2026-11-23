import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../app.module';

/**
 * A complete price book (2 000 entries at most) is the largest pricing.v1
 * body; anything larger is refused before parsing.
 */
const BODY_LIMIT = '512kb';

/** HTTP transport adapter. Business rules never live in this factory. */
export async function createHttpApplication(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  return app;
}
