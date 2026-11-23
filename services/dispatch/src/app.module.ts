import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
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
  controllers: [DispatchController, TaskController, BookingChangeController],
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
