import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';

/** HTTP transport adapter. Business rules never live in this factory. */
export function createHttpApplication(): Promise<INestApplication> {
  return NestFactory.create(AppModule, { bufferLogs: false });
}
