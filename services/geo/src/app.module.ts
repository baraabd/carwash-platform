import { Module } from '@nestjs/common';
import {
  HealthModule,
  createLogger,
  databaseSchemaFromUrl,
  type DependencyProbe,
} from '@carwash/service-kit';
import { GeoApplication } from './application';
import { PrismaGeoStore } from './infrastructure/persistence/prisma-geo.store';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { randomIds, systemClock } from './infrastructure/system/system';
import { GEO_APPLICATION, GEO_RATE_LIMIT, GeoController } from './transport/http/geo.controller';
import { FixedWindowRateLimit } from './transport/http/rate-limit';
/**
 * Composition root for the geo service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the zone and serviceability capability
 * exists, but there is no approved zone dataset and no exact-source acceptance.
 */
export const SERVICE_NAME = 'geo';
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

const DEFAULT_RATE_PER_MINUTE = 60;

export function rateLimitFromEnv(env: NodeJS.ProcessEnv = process.env): FixedWindowRateLimit {
  const raw = env.GEO_SERVICEABILITY_RATE_PER_MINUTE;
  if (raw !== undefined && raw !== '' && !/^[1-9][0-9]{0,5}$/.test(raw)) {
    throw new Error('INVALID_GEO_RATE_LIMIT');
  }
  return new FixedWindowRateLimit(raw ? Number(raw) : DEFAULT_RATE_PER_MINUTE, 60_000);
}

@Module({
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  controllers: [GeoController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: GEO_APPLICATION,
      useFactory: (prisma: PrismaService, url: string) =>
        new GeoApplication(
          new PrismaGeoStore(prisma.client, databaseSchemaFromUrl(url)),
          systemClock,
          randomIds,
        ),
      inject: [PrismaService, DATABASE_URL],
    },
    { provide: GEO_RATE_LIMIT, useFactory: () => rateLimitFromEnv() },
  ],
  exports: [PrismaService],
})
export class AppModule {}
