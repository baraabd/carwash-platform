import { WORKFORCE_SCOPES } from './ports';
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
import { OperatorProfileService, WorkforceService } from './application';
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PrismaWorkforceStore } from './infrastructure/persistence/prisma-workforce.store';
import { systemClock, uuidGenerator } from './infrastructure/runtime/system';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from './infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from './transport/http/actor-resolver';
import { OperatorProfileController } from './transport/http/operator-profile.controller';
import { WorkforceController } from './transport/http/workforce.controller';

export const SERVICE_NAME = 'workforce';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'operator',
  'work_grant',
  'verification_case',
  'work_shift',
  'operator_availability',
  'operator_service_area',
  'operator_service_zone',
  'operator_weekly_schedule',
  'operator_weekly_window',
  'availability_exception',
  'operator_equipment',
  'outbox_message',
  'audit_entry',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_URL, env),
    serviceClientsCapability(
      'workforce-workload-scopes',
      env.WORKFORCE_SERVICE_CLIENTS,
      WORKFORCE_SCOPES,
    ),
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

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('INVALID_POSITIVE_INTEGER');
  }
  return value;
}

@Module({
  controllers: [HealthController, WorkforceController, OperatorProfileController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: PrismaWorkforceStore,
      useFactory: (prisma: PrismaService) => new PrismaWorkforceStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: WorkforceService,
      useFactory: (store: PrismaWorkforceStore) =>
        new WorkforceService(store, store, systemClock, uuidGenerator),
      inject: [PrismaWorkforceStore],
    },
    {
      provide: OperatorProfileService,
      useFactory: (store: PrismaWorkforceStore) =>
        new OperatorProfileService(store, store, systemClock, uuidGenerator),
      inject: [PrismaWorkforceStore],
    },
    {
      provide: ActorResolver,
      useFactory: () =>
        new ActorResolver(
          new IdentitySessionClient({
            baseUrl: process.env.IDENTITY_URL,
            timeoutMs: positiveInt(process.env.IDENTITY_TIMEOUT_MS, 2_000),
          }),
          new ServiceClientAuthenticator(
            parseServiceClients(process.env.WORKFORCE_SERVICE_CLIENTS),
          ),
          new RequestBudget(positiveInt(process.env.WORKFORCE_USER_REQUESTS_PER_MINUTE, 120)),
          new RequestBudget(positiveInt(process.env.WORKFORCE_SERVICE_REQUESTS_PER_MINUTE, 6_000)),
        ),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
