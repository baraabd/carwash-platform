import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import {
  PrismaConfigurationRepository,
  sha256Hex,
} from './infrastructure/persistence/prisma-configuration.repository';
import {
  IdentitySessionClient,
  UnconfiguredSessionAuthority,
} from './infrastructure/identity/identity-session.client';
import { ConfigurationServiceClients } from './infrastructure/identity/service-client.authenticator';
import { PrismaConfigurationV1Store } from './infrastructure/persistence/prisma-configuration-v1.store';
import {
  ConfigurationV1Commands,
  ConfigurationV1Queries,
} from './application/configuration-v1.service';
import {
  ConfigurationV1Controller,
  RATE_LIMITS,
  SERVICE_CALLERS,
} from './transport/http/configuration-v1.controller';
import { rateLimitsFromEnv } from './transport/http/rate-limit';
import type { SessionAuthority } from './ports/identity.ports';
import { ConfigurationCommands, ConfigurationQueries } from './application/configuration.service';
import {
  ConfigurationController,
  SESSION_AUTHORITY,
} from './transport/http/configuration.controller';

/**
 * Composition root for the configuration service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the configuration.v1 API exists, but the
 * permissions it enforces are not granted by Identity (CR-D-P01-01 /
 * CR-D-P05-D5-04), there are no Gateway routes, no deployed relay process and
 * no broker producer identity, so the service must not advertise readiness.
 */
export const SERVICE_NAME = 'configuration';
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
 * Identity's internal origin, never defaulted to a guessed host. Without it the
 * service still boots (image probe) and every protected route answers 503
 * AUTH_UNAVAILABLE: fail closed, never fail open.
 */
export function sessionAuthorityFromEnv(env: NodeJS.ProcessEnv = process.env): SessionAuthority {
  const raw = env.IDENTITY_ORIGIN;
  if (!raw) return new UnconfiguredSessionAuthority();
  return new IdentitySessionClient(new URL(raw));
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
  controllers: [ConfigurationController, ConfigurationV1Controller],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: PrismaConfigurationRepository,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaConfigurationRepository(prisma.client),
    },
    {
      provide: ConfigurationCommands,
      inject: [PrismaConfigurationRepository],
      useFactory: (repository: PrismaConfigurationRepository) =>
        new ConfigurationCommands(repository, systemClock, sha256Hex, randomUUID),
    },
    {
      provide: ConfigurationQueries,
      inject: [PrismaConfigurationRepository],
      useFactory: (repository: PrismaConfigurationRepository) =>
        new ConfigurationQueries(repository),
    },
    {
      provide: PrismaConfigurationV1Store,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaConfigurationV1Store(prisma.client, sha256Hex),
    },
    {
      provide: ConfigurationV1Commands,
      inject: [PrismaConfigurationV1Store],
      useFactory: (store: PrismaConfigurationV1Store) =>
        new ConfigurationV1Commands(store, systemClock, sha256Hex, randomUUID),
    },
    {
      provide: ConfigurationV1Queries,
      inject: [PrismaConfigurationV1Store],
      useFactory: (store: PrismaConfigurationV1Store) => new ConfigurationV1Queries(store),
    },
    { provide: SESSION_AUTHORITY, useFactory: () => sessionAuthorityFromEnv() },
    { provide: SERVICE_CALLERS, useFactory: () => ConfigurationServiceClients.fromEnv() },
    { provide: RATE_LIMITS, useFactory: () => rateLimitsFromEnv() },
  ],
  exports: [PrismaService],
})
export class AppModule {}
