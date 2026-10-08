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
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
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

/** Identity's internal origin; required, never defaulted to a guessed host. */
export function identityOriginFromEnv(env: NodeJS.ProcessEnv = process.env): URL {
  const raw = env.IDENTITY_ORIGIN;
  if (!raw) throw new Error('IDENTITY_ORIGIN_REQUIRED');
  return new URL(raw);
}

/** Per-subject operations reads per minute on one replica; bounded, never unlimited. */
export function readBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): RequestBudget {
  const raw = env.REPORTING_READS_PER_MINUTE ?? '120';
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) throw new Error('REPORTING_READS_PER_MINUTE_INVALID');
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
  controllers: [OperationsController],
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
      useFactory: () => new IdentitySessionClient(identityOriginFromEnv()),
    },
    { provide: READ_BUDGET, useFactory: () => readBudgetFromEnv() },
  ],
  exports: [PrismaService],
})
export class AppModule {}
