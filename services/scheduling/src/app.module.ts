import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import { CapacityService, HoldsV1Service } from './application';
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PrismaSchedulingStore } from './infrastructure/persistence/prisma-scheduling.store';
import { systemClock, uuidGenerator } from './infrastructure/runtime/system';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from './infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from './transport/http/actor-resolver';
import { SchedulingController } from './transport/http/scheduling.controller';
/**
 * Composition root for the scheduling service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the capacity/hold API is implemented, but the
 * service is not accepted for production until its contracts are published by
 * Lane E and the release acceptance runs against this exact source.
 */
export const SERVICE_NAME = 'scheduling';
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

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('INVALID_POSITIVE_INTEGER');
  return value;
}

@Module({
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  controllers: [SchedulingController],
  providers: [
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
        new HoldsV1Service(store, store, systemClock, uuidGenerator),
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
