import { DISPATCH_SCOPES } from './ports';
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
import { BookingChangeService, DispatchService, TaskService } from './application';
import { ServiceHttp, parseServiceTarget } from './infrastructure/http/service-http';
import { MediaEvidenceClient } from './infrastructure/media/media-evidence.client';
import { WorkforceCapacityClient } from './infrastructure/workforce/workforce-capacity.client';
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PrismaDispatchStore } from './infrastructure/persistence/prisma-dispatch.store';
import { systemClock, uuidGenerator } from './infrastructure/runtime/system';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from './infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from './transport/http/actor-resolver';
import { DispatchController } from './transport/http/dispatch.controller';
import { TaskController } from './transport/http/task.controller';
import { BookingChangeController } from './transport/http/booking-change.controller';
import { DISPATCH_READ_MODEL } from './transport/http/tokens';

/**
 * Outbound adapters. Absent configuration means the dependency is unavailable
 * (offers/acceptance or evidence linking answer 503); partial or malformed
 * configuration refuses to start.
 */
function workforceFromEnv(): WorkforceCapacityClient | null {
  const target = parseServiceTarget(process.env, 'DISPATCH_WORKFORCE');
  return target === null ? null : new WorkforceCapacityClient(new ServiceHttp(target));
}

function mediaFromEnv(): MediaEvidenceClient | null {
  const target = parseServiceTarget(process.env, 'DISPATCH_MEDIA');
  return target === null ? null : new MediaEvidenceClient(new ServiceHttp(target));
}

/**
 * dispatch HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'dispatch';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'hold_observation',
  'assignment',
  'dispatch_offer',
  'automatic_assignment_policy',
  'automatic_assignment_attempt',
  'idempotency_record',
  'inbox_message',
  'outbox_message',
  'audit_entry',
  'resource_observation',
  'task',
  'task_evidence',
  'evidence_fence',
  'task_note',
  'task_event',
  'booking_change',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_URL, env),
    configurationCapability(
      'workforce-capacity-adapter',
      () => parseServiceTarget(env, 'DISPATCH_WORKFORCE') !== null,
    ),
    configurationCapability(
      'media-evidence-adapter',
      () => parseServiceTarget(env, 'DISPATCH_MEDIA') !== null,
    ),
    serviceClientsCapability(
      'dispatch-workload-scopes',
      env.DISPATCH_SERVICE_CLIENTS,
      DISPATCH_SCOPES,
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
  controllers: [HealthController, DispatchController, TaskController, BookingChangeController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: PrismaDispatchStore,
      useFactory: (prisma: PrismaService) => new PrismaDispatchStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: DispatchService,
      useFactory: (store: PrismaDispatchStore) =>
        new DispatchService(store, store, systemClock, uuidGenerator, workforceFromEnv()),
      inject: [PrismaDispatchStore],
    },
    {
      provide: BookingChangeService,
      useFactory: (store: PrismaDispatchStore) =>
        new BookingChangeService(store, store, systemClock, uuidGenerator),
      inject: [PrismaDispatchStore],
    },
    {
      provide: TaskService,
      useFactory: (store: PrismaDispatchStore) =>
        new TaskService(store, store, systemClock, uuidGenerator, mediaFromEnv()),
      inject: [PrismaDispatchStore],
    },
    { provide: DISPATCH_READ_MODEL, useExisting: PrismaDispatchStore },
    {
      provide: ActorResolver,
      useFactory: () =>
        new ActorResolver(
          new IdentitySessionClient({
            baseUrl: process.env.IDENTITY_URL,
            timeoutMs: positiveInt(process.env.IDENTITY_TIMEOUT_MS, 2_000),
          }),
          new ServiceClientAuthenticator(parseServiceClients(process.env.DISPATCH_SERVICE_CLIENTS)),
          new RequestBudget(positiveInt(process.env.DISPATCH_USER_REQUESTS_PER_MINUTE, 120)),
          new RequestBudget(positiveInt(process.env.DISPATCH_SERVICE_REQUESTS_PER_MINUTE, 6_000)),
        ),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
