import { Module } from '@nestjs/common';
import {
  HealthController,
  HEALTH_OPTIONS,
  schemaReadinessProbe,
  type HealthOptions,
  type RuntimeCapability,
  databaseSchemaFromUrl,
  originCapability,
  createLogger,
  type DependencyProbe,
} from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PrismaInboxStore } from './inbox/prisma-inbox.store';
import { NotificationQueries, ReadBudget } from './application/notification-reads';
import { PrismaNotificationReader } from './infrastructure/persistence/prisma-notification.repository';
import {
  IdentitySessionClient,
  UnconfiguredSessionAuthority,
} from './infrastructure/identity/identity-session.client';
import type { SessionAuthority } from './ports/identity.ports';
import {
  NotificationsController,
  READ_BUDGET,
  SESSION_AUTHORITY,
} from './transport/http/notifications.controller';
/**
 * communications HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'communications';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'inbox_message',
  'probe_notification',
  'notification',
  'delivery_attempt',
  'booking_notification_cancellation',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [originCapability('identity-authority', env.IDENTITY_ORIGIN, env)];
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
 * Identity's internal origin, never defaulted to a guessed host. Without it
 * every read is refused with 503 (fail closed) while the process still boots;
 * a malformed origin is a startup error.
 */
export function sessionAuthorityFromEnv(env: NodeJS.ProcessEnv = process.env): SessionAuthority {
  const raw = env.IDENTITY_ORIGIN;
  if (!raw) return new UnconfiguredSessionAuthority();
  return new IdentitySessionClient(new URL(raw));
}

/** Per-subject staff reads per minute on one replica; bounded, never unlimited. */
export function readBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): ReadBudget {
  const raw = env.COMMUNICATIONS_READS_PER_MINUTE ?? '120';
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) throw new Error('COMMUNICATIONS_READS_PER_MINUTE_INVALID');
  return new ReadBudget(Number(raw));
}

@Module({
  controllers: [HealthController, NotificationsController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaInboxStore,
    {
      provide: NotificationQueries,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new NotificationQueries(new PrismaNotificationReader(prisma.client)),
    },
    { provide: SESSION_AUTHORITY, useFactory: () => sessionAuthorityFromEnv() },
    { provide: READ_BUDGET, useFactory: () => readBudgetFromEnv() },
  ],
  exports: [PrismaService],
})
export class AppModule {}
