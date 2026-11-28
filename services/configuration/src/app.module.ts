import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import {
  HealthController,
  HEALTH_OPTIONS,
  schemaReadinessProbe,
  type HealthOptions,
  type RuntimeCapability,
  databaseSchemaFromUrl,
  originCapability,
  serviceClientsCapability,
  createLogger,
  type DependencyProbe,
} from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import {
  PrismaConfigurationRepository,
  sha256Hex,
} from './infrastructure/persistence/prisma-configuration.repository';
import {
  IdentitySessionClient,
  UnconfiguredSessionAuthority,
} from './infrastructure/identity/identity-session.client';
import { ConfigurationServiceClients } from './infrastructure/identity/service-client.authenticator';
import { PrismaConfigurationV1Store } from './infrastructure/persistence/prisma-configuration-v1.store';
import {
  ConfigurationV1Commands,
  ConfigurationV1Queries,
} from './application/configuration-v1.service';
import {
  ConfigurationV1Controller,
  RATE_LIMITS,
  SERVICE_CALLERS,
} from './transport/http/configuration-v1.controller';
import { rateLimitsFromEnv } from './transport/http/rate-limit';
import type { SessionAuthority } from './ports/identity.ports';
import { ConfigurationCommands, ConfigurationQueries } from './application/configuration.service';
import {
  ConfigurationController,
  SESSION_AUTHORITY,
} from './transport/http/configuration.controller';

/**
 * configuration HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'configuration';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'config_revision',
  'config_review',
  'config_pointer',
  'config_audit',
  'config_scope',
  'config_draft',
  'config_version',
  'config_history',
  'config_idempotency',
  'outbox_message',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_ORIGIN, env),
    serviceClientsCapability('configuration-read-workloads', env.CONFIGURATION_SERVICE_CLIENTS, [
      'configuration.read',
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

/**
 * Identity's internal origin, never defaulted to a guessed host. Without it the
 * service still boots (image probe) and every protected route answers 503
 * AUTH_UNAVAILABLE: fail closed, never fail open.
 */
export function sessionAuthorityFromEnv(env: NodeJS.ProcessEnv = process.env): SessionAuthority {
  const raw = env.IDENTITY_ORIGIN;
  if (!raw) return new UnconfiguredSessionAuthority();
  return new IdentitySessionClient(new URL(raw));
}

const systemClock = { now: () => new Date() };

@Module({
  controllers: [HealthController, ConfigurationController, ConfigurationV1Controller],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: PrismaConfigurationRepository,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaConfigurationRepository(prisma.client),
    },
    {
      provide: ConfigurationCommands,
      inject: [PrismaConfigurationRepository],
      useFactory: (repository: PrismaConfigurationRepository) =>
        new ConfigurationCommands(repository, systemClock, sha256Hex, randomUUID),
    },
    {
      provide: ConfigurationQueries,
      inject: [PrismaConfigurationRepository],
      useFactory: (repository: PrismaConfigurationRepository) =>
        new ConfigurationQueries(repository),
    },
    {
      provide: PrismaConfigurationV1Store,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaConfigurationV1Store(prisma.client, sha256Hex),
    },
    {
      provide: ConfigurationV1Commands,
      inject: [PrismaConfigurationV1Store],
      useFactory: (store: PrismaConfigurationV1Store) =>
        new ConfigurationV1Commands(store, systemClock, sha256Hex, randomUUID),
    },
    {
      provide: ConfigurationV1Queries,
      inject: [PrismaConfigurationV1Store],
      useFactory: (store: PrismaConfigurationV1Store) => new ConfigurationV1Queries(store),
    },
    { provide: SESSION_AUTHORITY, useFactory: () => sessionAuthorityFromEnv() },
    { provide: SERVICE_CALLERS, useFactory: () => ConfigurationServiceClients.fromEnv() },
    { provide: RATE_LIMITS, useFactory: () => rateLimitsFromEnv() },
  ],
  exports: [PrismaService],
})
export class AppModule {}
