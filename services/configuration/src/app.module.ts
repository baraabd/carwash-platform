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
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import { ConfigurationCommands, ConfigurationQueries } from './application/configuration.service';
import {
  ConfigurationController,
  SESSION_AUTHORITY,
} from './transport/http/configuration.controller';

/**
 * Composition root for the configuration service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the revision API exists, but the permissions
 * it enforces are not yet published by Identity (CR-D-P01-01), so no caller can
 * use it and the service must not advertise business readiness.
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

/** Identity's internal origin; required, never defaulted to a guessed host. */
export function identityOriginFromEnv(env: NodeJS.ProcessEnv = process.env): URL {
  const raw = env.IDENTITY_ORIGIN;
  if (!raw) throw new Error('IDENTITY_ORIGIN_REQUIRED');
  return new URL(raw);
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
  controllers: [ConfigurationController],
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
      provide: SESSION_AUTHORITY,
      useFactory: () => new IdentitySessionClient(identityOriginFromEnv()),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
