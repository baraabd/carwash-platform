import { SCHEDULING_SCOPES } from './ports';
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
import { CapacityService, CommitmentsService, HoldsV1Service } from './application';
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PrismaSchedulingStore } from './infrastructure/persistence/prisma-scheduling.store';
import { systemClock, uuidGenerator } from './infrastructure/runtime/system';
import {
  PricingQuoteHttpReader,
  pricingReaderConfigFromEnv,
} from './infrastructure/pricing/pricing-quote-http.reader';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from './infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from './transport/http/actor-resolver';
import { SchedulingController } from './transport/http/scheduling.controller';
/**
 * scheduling HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'scheduling';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'capacity_window',
  'capacity_hold',
  'idempotency_record',
  'outbox_message',
  'audit_entry',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_URL, env),
    originCapability('pricing-quote-contract', env.PRICING_ORIGIN, env),
    serviceClientsCapability(
      'scheduling-workload-scopes',
      env.SCHEDULING_SERVICE_CLIENTS,
      SCHEDULING_SCOPES,
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
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_POSITIVE_INTEGER');
  return value;
}

@Module({
  controllers: [HealthController, SchedulingController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: PrismaSchedulingStore,
      useFactory: (prisma: PrismaService) => new PrismaSchedulingStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: HoldsV1Service,
      useFactory: (store: PrismaSchedulingStore) =>
        new HoldsV1Service(
          store,
          store,
          systemClock,
          uuidGenerator,
          new PricingQuoteHttpReader(pricingReaderConfigFromEnv(process.env)),
        ),
      inject: [PrismaSchedulingStore],
    },
    {
      provide: CommitmentsService,
      useFactory: (store: PrismaSchedulingStore) =>
        new CommitmentsService(store, store, systemClock, uuidGenerator),
      inject: [PrismaSchedulingStore],
    },
    {
      provide: CapacityService,
      useFactory: (store: PrismaSchedulingStore) =>
        new CapacityService(store, store, systemClock, uuidGenerator),
      inject: [PrismaSchedulingStore],
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
            parseServiceClients(process.env.SCHEDULING_SERVICE_CLIENTS),
          ),
          new RequestBudget(positiveInt(process.env.SCHEDULING_USER_REQUESTS_PER_MINUTE, 120)),
          new RequestBudget(positiveInt(process.env.SCHEDULING_SERVICE_REQUESTS_PER_MINUTE, 6_000)),
          new RequestBudget(positiveInt(process.env.SCHEDULING_PUBLIC_REQUESTS_PER_MINUTE, 600)),
        ),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
