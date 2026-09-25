import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
/**
 * Composition root for the media service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false while this is only a foundation shell.
 */
export const SERVICE_NAME = 'media';
export const BUSINESS_READY = false;

export function postgresProbe(prisma: PrismaService): DependencyProbe {
  return {
    name: 'postgres',
    kind: 'postgres',
    check: async () => {
      await prisma.client.$queryRaw`SELECT 1`;
    },
  };
}

@Module({
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
  ],
  exports: [PrismaService],
})
export class AppModule {}
