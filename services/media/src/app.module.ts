import { loadApiConfig, loadS3Config } from './infrastructure/config/media-config';
import { S3ObjectStore } from './infrastructure/storage/s3-object-store';
import { MEDIA_SCOPES } from './ports';
import { Module } from '@nestjs/common';
import {
  HealthController,
  HEALTH_OPTIONS,
  schemaReadinessProbe,
  type HealthOptions,
  type RuntimeCapability,
  databaseSchemaFromUrl,
  originCapability,
  configurationCapability,
  serviceClientsCapability,
  createLogger,
  type DependencyProbe,
} from '@carwash/service-kit';
import { MediaService } from './application';
import { loadPolicy, objectStoreFromEnv } from './infrastructure/config/media-config';
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PrismaMediaStore } from './infrastructure/persistence/prisma-media.store';
import { systemClock, uuidGenerator } from './infrastructure/runtime/system';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from './infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from './transport/http/actor-resolver';
import { MediaController } from './transport/http/media.controller';

/**
 * media HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'media';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'media_object',
  'object_claim',
  'object_owner_fence',
  'idempotency_record',
  'audit_entry',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_URL, env),
    configurationCapability('object-store-configuration', () => {
      const config = loadApiConfig(env);
      return config.s3.bucket.length > 0;
    }),
    serviceClientsCapability('media-workload-scopes', env.MEDIA_SERVICE_CLIENTS, MEDIA_SCOPES),
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
      {
        name: 'object-store',
        kind: 'http',
        check: () => new S3ObjectStore({ ...loadS3Config(env), requestTimeoutMs: 1_500 }).ping(),
      },
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

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('INVALID_POSITIVE_INTEGER');
  }
  return value;
}

@Module({
  controllers: [HealthController, MediaController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: PrismaMediaStore,
      useFactory: (prisma: PrismaService) => new PrismaMediaStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: MediaService,
      useFactory: (store: PrismaMediaStore) =>
        new MediaService(
          store,
          store,
          objectStoreFromEnv(process.env),
          systemClock,
          uuidGenerator,
          loadPolicy(process.env),
        ),
      inject: [PrismaMediaStore],
    },
    {
      provide: ActorResolver,
      useFactory: () =>
        new ActorResolver(
          new IdentitySessionClient({
            baseUrl: process.env.IDENTITY_URL,
            timeoutMs: positiveInt(process.env.IDENTITY_TIMEOUT_MS, 2_000),
          }),
          new ServiceClientAuthenticator(parseServiceClients(process.env.MEDIA_SERVICE_CLIENTS)),
          new RequestBudget(positiveInt(process.env.MEDIA_USER_REQUESTS_PER_MINUTE, 120)),
          new RequestBudget(positiveInt(process.env.MEDIA_SERVICE_REQUESTS_PER_MINUTE, 6_000)),
        ),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
