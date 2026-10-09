import { Module } from '@nestjs/common';
import {
  HealthModule,
  createLogger,
  databaseSchemaFromUrl,
  type DependencyProbe,
} from '@carwash/service-kit';
import { GeoApplication, ServiceabilityApplication } from './application';
import { DEFAULT_DECISION_TTL_MS } from './domain';
import {
  HttpIdentityAuthorizer,
  UnconfiguredIdentityAuthorizer,
} from './infrastructure/identity/http-identity-authorizer';
import { DenyAllWorkloadAuthenticator } from './infrastructure/identity/workload-authenticator';
import type { IdentityAuthorizer } from './ports';
import { PrismaGeoStore } from './infrastructure/persistence/prisma-geo.store';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { randomIds, systemClock } from './infrastructure/system/system';
import {
  GEO_APPLICATION,
  GEO_RATE_LIMIT,
  GeoController,
  SERVICEABILITY_APPLICATION,
  WORKLOAD_AUTHENTICATOR,
} from './transport/http/geo.controller';
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

const DEFAULT_IDENTITY_TIMEOUT_MS = 2_000;

/**
 * A missing Identity origin leaves serviceability failing closed with
 * DEPENDENCY_UNAVAILABLE; a present but invalid one stops startup.
 */
export function identityAuthorizerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): IdentityAuthorizer {
  const origin = env.GEO_IDENTITY_ORIGIN;
  if (!origin) return new UnconfiguredIdentityAuthorizer();
  const raw = env.GEO_IDENTITY_TIMEOUT_MS;
  if (raw !== undefined && raw !== '' && !/^[1-9][0-9]{0,5}$/.test(raw)) {
    throw new Error('INVALID_IDENTITY_TIMEOUT');
  }
  return new HttpIdentityAuthorizer({
    origin,
    timeoutMs: raw ? Number(raw) : DEFAULT_IDENTITY_TIMEOUT_MS,
  });
}

/** How long a decision may be relied on, in seconds (60..86400; default 1800). */
export function decisionTtlMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GEO_DECISION_TTL_SECONDS;
  if (raw === undefined || raw === '') return DEFAULT_DECISION_TTL_MS;
  if (!/^[1-9][0-9]{1,4}$/.test(raw) || Number(raw) < 60 || Number(raw) > 86_400) {
    throw new Error('INVALID_GEO_DECISION_TTL');
  }
  return Number(raw) * 1000;
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
    {
      provide: SERVICEABILITY_APPLICATION,
      useFactory: (prisma: PrismaService, url: string) =>
        new ServiceabilityApplication(
          new PrismaGeoStore(prisma.client, databaseSchemaFromUrl(url)),
          identityAuthorizerFromEnv(),
          systemClock,
          randomIds,
          { decisionTtlMs: decisionTtlMsFromEnv() },
        ),
      inject: [PrismaService, DATABASE_URL],
    },
    { provide: GEO_RATE_LIMIT, useFactory: () => rateLimitFromEnv() },
    { provide: WORKLOAD_AUTHENTICATOR, useFactory: () => new DenyAllWorkloadAuthenticator() },
  ],
  exports: [PrismaService],
})
export class AppModule {}
