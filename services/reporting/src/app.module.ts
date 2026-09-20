import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import { DATABASE_URL, PrismaService, databaseUrlFromEnv } from './prisma.service';
import { PrismaInboxStore } from './inbox/prisma-inbox.store';

/**
 * reporting service module.
 *
 * businessReady is FALSE: this sprint delivers the runtime foundation, not the
 * reporting business API. Readiness therefore answers 503 while still reporting
 * the real state of its dependencies. Flipping this to true without an
 * implemented API would be a false readiness claim.
 */
export const SERVICE_NAME = 'reporting';
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
    PrismaInboxStore,
  ],
  exports: [PrismaService],
})
export class AppModule {}
