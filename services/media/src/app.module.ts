import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import { MediaService } from './application';
import { loadPolicy, objectStoreFromEnv } from './infrastructure/config/media-config';
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PrismaMediaStore } from './infrastructure/persistence/prisma-media.store';
import { systemClock, uuidGenerator } from './infrastructure/runtime/system';
import {
  ServiceClientAuthenticator,
  parseServiceClients,
} from './infrastructure/security/service-clients';
import { ActorResolver, RequestBudget } from './transport/http/actor-resolver';
import { MediaController } from './transport/http/media.controller';

/**
 * Composition root for the media service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false until Lane E publishes media.v1 and release
 * acceptance runs on exact source; /health/ready therefore answers 503.
 *
 * Fail fast: the process entry point (main.ts) validates the complete
 * configuration before this module is created. Composed without any MEDIA_S3_*
 * setting (a module compile check), the object store fails closed on use.
 */
export const SERVICE_NAME = 'media';
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
  controllers: [MediaController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: PrismaMediaStore,
      useFactory: (prisma: PrismaService) => new PrismaMediaStore(prisma),
      inject: [PrismaService],
    },
    {
      provide: MediaService,
      useFactory: (store: PrismaMediaStore) =>
        new MediaService(
          store,
          store,
          objectStoreFromEnv(process.env),
          systemClock,
          uuidGenerator,
          loadPolicy(process.env),
        ),
      inject: [PrismaMediaStore],
    },
    {
      provide: ActorResolver,
      useFactory: () =>
        new ActorResolver(
          new IdentitySessionClient({
            baseUrl: process.env.IDENTITY_URL,
            timeoutMs: positiveInt(process.env.IDENTITY_TIMEOUT_MS, 2_000),
          }),
          new ServiceClientAuthenticator(parseServiceClients(process.env.MEDIA_SERVICE_CLIENTS)),
          new RequestBudget(positiveInt(process.env.MEDIA_USER_REQUESTS_PER_MINUTE, 120)),
          new RequestBudget(positiveInt(process.env.MEDIA_SERVICE_REQUESTS_PER_MINUTE, 6_000)),
        ),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
