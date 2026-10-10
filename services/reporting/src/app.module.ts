import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PrismaInboxStore } from './inbox/prisma-inbox.store';
import { RequestBudget } from './application/access';
import { OperationsQueries } from './application/operations.service';
import { PrismaOperationsReader } from './infrastructure/persistence/prisma-operations.store';
import { randomUUID } from 'node:crypto';
import { ReportExports, ReportQueries } from './application/reports.service';
import {
  PrismaExportStore,
  PrismaReportsReader,
} from './infrastructure/persistence/prisma-reports.store';
import { sha256Hex } from './infrastructure/persistence/prisma-projection.store';
import { EXPORT_BUDGET, ReportsController } from './transport/http/reports.controller';
import {
  IdentitySessionClient,
  UnconfiguredSessionAuthority,
} from './infrastructure/identity/identity-session.client';
import type { SessionAuthority } from './ports/identity.ports';
import {
  OperationsController,
  READ_BUDGET,
  SESSION_AUTHORITY,
} from './transport/http/operations.controller';
/**
 * Composition root for the reporting service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the operations read API exists, but no
 * producer of its source events runs on the accepted broker topology yet
 * (CR-D-P02-03), so the projections cannot be current in any deployment.
 */
export const SERVICE_NAME = 'reporting';
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

/** Per-subject operations reads per minute on one replica; bounded, never unlimited. */
export function readBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): RequestBudget {
  const raw = env.REPORTING_READS_PER_MINUTE ?? '120';
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) throw new Error('REPORTING_READS_PER_MINUTE_INVALID');
  return new RequestBudget(Number(raw));
}

/** Per-subject report exports per minute on one replica; deliberately small. */
export function exportBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): RequestBudget {
  const raw = env.REPORTING_EXPORTS_PER_MINUTE ?? '10';
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) throw new Error('REPORTING_EXPORTS_PER_MINUTE_INVALID');
  return new RequestBudget(Number(raw));
}

const systemClock = { now: () => new Date() };

@Module({
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  controllers: [OperationsController, ReportsController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaInboxStore,
    {
      provide: OperationsQueries,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new OperationsQueries(new PrismaOperationsReader(prisma.client), systemClock),
    },
    {
      provide: SESSION_AUTHORITY,
      useFactory: () => sessionAuthorityFromEnv(),
    },
    {
      provide: ReportQueries,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ReportQueries(new PrismaReportsReader(prisma.client), systemClock),
    },
    {
      provide: ReportExports,
      inject: [ReportQueries, PrismaService],
      useFactory: (queries: ReportQueries, prisma: PrismaService) =>
        new ReportExports(
          queries,
          new PrismaExportStore(prisma.client),
          sha256Hex,
          systemClock,
          randomUUID,
        ),
    },
    { provide: READ_BUDGET, useFactory: () => readBudgetFromEnv() },
    { provide: EXPORT_BUDGET, useFactory: () => exportBudgetFromEnv() },
  ],
  exports: [PrismaService],
})
export class AppModule {}
