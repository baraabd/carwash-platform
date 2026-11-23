import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { CaseCommands, CaseQueries, RequestBudget } from './application';
import { PrismaCaseStore } from './infrastructure/persistence/prisma-case.store';
import {
  IdentitySessionClient,
  UnconfiguredSessionAuthority,
} from './infrastructure/identity/identity-session.client';
import { BillingOwnerClient } from './infrastructure/owners/billing-owner.client';
import { BookingOwnerClient } from './infrastructure/owners/booking-owner.client';
import { ownerEndpointFromEnv } from './infrastructure/owners/owner-http';
import { RandomIds, SystemClock } from './infrastructure/system/system.adapters';
import type { SessionAuthority } from './ports';
import {
  CasesController,
  REQUEST_BUDGET,
  SESSION_AUTHORITY,
} from './transport/http/cases.controller';
/**
 * Composition root for the support service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: refunds and booking changes have no owner
 * command yet, and the events have no accepted topology (CR-D-P04-01..03).
 */
export const SERVICE_NAME = 'support';
export const BUSINESS_READY = false;

const OWNERS = 'SUPPORT_OWNERS';
const STORE = 'SUPPORT_CASE_STORE';

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
 * every request is refused with 503 (fail closed) while the process still
 * boots; a malformed origin is a startup error.
 */
export function sessionAuthorityFromEnv(env: NodeJS.ProcessEnv = process.env): SessionAuthority {
  const raw = env.IDENTITY_ORIGIN;
  if (!raw) return new UnconfiguredSessionAuthority();
  return new IdentitySessionClient(new URL(raw));
}

/** Per-subject requests per minute on one replica; bounded, never unlimited. */
export function requestBudgetFromEnv(env: NodeJS.ProcessEnv = process.env): RequestBudget {
  const raw = env.SUPPORT_REQUESTS_PER_MINUTE ?? '120';
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) throw new Error('SUPPORT_REQUESTS_PER_MINUTE_INVALID');
  return new RequestBudget(Number(raw));
}

/** A resend inside this window after the previous send is refused as in progress. */
export function executionLeaseFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SUPPORT_EXECUTION_LEASE_MS ?? '15000';
  if (!/^[0-9]{3,6}$/.test(raw) || Number(raw) < 1_000)
    throw new Error('SUPPORT_EXECUTION_LEASE_MS_INVALID');
  return Number(raw);
}

export function ownersFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return {
    billing: new BillingOwnerClient(
      ownerEndpointFromEnv(env, 'BILLING_ORIGIN', 'BILLING_TIMEOUT_MS'),
    ),
    booking: new BookingOwnerClient(
      ownerEndpointFromEnv(env, 'BOOKING_ORIGIN', 'BOOKING_TIMEOUT_MS'),
    ),
  };
}

@Module({
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  controllers: [CasesController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: STORE,
      inject: [PrismaService],
      useFactory: (p: PrismaService) => new PrismaCaseStore(p.client),
    },
    { provide: OWNERS, useFactory: () => ownersFromEnv() },
    {
      provide: CaseCommands,
      inject: [STORE, OWNERS],
      useFactory: (store: PrismaCaseStore, owners: ReturnType<typeof ownersFromEnv>) =>
        new CaseCommands({
          store,
          reader: store,
          billing: owners.billing,
          booking: owners.booking,
          clock: new SystemClock(),
          ids: new RandomIds(),
          executionLeaseMs: executionLeaseFromEnv(),
        }),
    },
    {
      provide: CaseQueries,
      inject: [STORE, OWNERS],
      useFactory: (store: PrismaCaseStore, owners: ReturnType<typeof ownersFromEnv>) =>
        new CaseQueries(store, owners.billing, owners.booking, new SystemClock()),
    },
    { provide: SESSION_AUTHORITY, useFactory: () => sessionAuthorityFromEnv() },
    { provide: REQUEST_BUDGET, useFactory: () => requestBudgetFromEnv() },
  ],
  exports: [PrismaService],
})
export class AppModule {}
