import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
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
 * Composition root for the communications service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: no real delivery provider exists (external
 * blocker) and no producer emits the trigger events on the accepted topology.
 */
export const SERVICE_NAME = 'communications';
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
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [
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
