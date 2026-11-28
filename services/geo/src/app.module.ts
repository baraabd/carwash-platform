import { Module } from '@nestjs/common';
import {
  HealthController,
  HEALTH_OPTIONS,
  schemaReadinessProbe,
  type HealthOptions,
  type RuntimeCapability,
  originCapability,
  serviceClientsCapability,
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
import { ServiceWorkloadAuthenticator } from './infrastructure/identity/workload-authenticator';
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
 * geo HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'geo';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'service_zone',
  'geo_dataset_state',
  'serviceability_decision',
  'outbox_message',
  'audit_entry',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.GEO_IDENTITY_ORIGIN, env),
    serviceClientsCapability('serviceability-workload', env.GEO_SERVICE_CLIENTS, [
      'geo.serviceability.validate',
    ]),
  ];
}

export function runtimeHealthOptions(
  prisma: PrismaService,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): HealthOptions {
  return {
    service: SERVICE_NAME,
    businessReady: BUSINESS_READY,
    runtimeCapabilities: runtimeCapabilities(env),
    dependencies: [
      postgresProbe(prisma),
      schemaReadinessProbe(RUNTIME_TABLES, async () => {
        const rows = await prisma.client.$queryRaw<
          Array<{
            table_name: string;
            role_name: string;
            session_role: string;
            database_name: string;
          }>
        >`
          SELECT table_name, current_user::text AS role_name, session_user::text AS session_role,
            current_database()::text AS database_name FROM information_schema.tables
          WHERE table_schema = ${databaseSchemaFromUrl(url)} AND table_type = 'BASE TABLE'
        `;
        if (
          rows.some(
            (row) =>
              row.role_name !== `cw_${SERVICE_NAME}_app` ||
              row.session_role !== `cw_${SERVICE_NAME}_app` ||
              row.database_name !== `cw_${SERVICE_NAME}`,
          )
        )
          throw new Error('OWNER_DATABASE_IDENTITY_MISMATCH');
        return rows.map((row) => row.table_name);
      }),
    ],
    logger: createLogger({ service: SERVICE_NAME }),
  };
}

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
  controllers: [HealthController, GeoController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
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
    {
      provide: WORKLOAD_AUTHENTICATOR,
      useFactory: () => new ServiceWorkloadAuthenticator(process.env.GEO_SERVICE_CLIENTS),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
