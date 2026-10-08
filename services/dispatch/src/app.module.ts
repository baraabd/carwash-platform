import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import { DispatchService } from './application';
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

/**
 * Composition root for the dispatch service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false until release acceptance on exact source.
 */
export const SERVICE_NAME = 'dispatch';
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
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('INVALID_POSITIVE_INTEGER');
  }
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
  controllers: [DispatchController],
  providers: [
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
        new DispatchService(store, store, systemClock, uuidGenerator),
      inject: [PrismaDispatchStore],
    },
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
