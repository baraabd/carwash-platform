import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { ProbeService } from './probe/probe.service';
import { PrismaOutboxStore } from './outbox/prisma-outbox.store';
import { CatalogService } from './application';
import { PrismaCatalogRepository } from './infrastructure/persistence/prisma-catalog.repository';
import {
  IdentitySessionAuthority,
  identityAuthorityConfigFromEnv,
} from './infrastructure/identity/identity-session.authority';
import { RandomIds, Sha256Hasher, SystemClock } from './infrastructure/system/system.adapters';
import { CATALOG_SERVICE, CatalogController } from './transport/http/catalog.controller';
/**
 * Composition root for the catalog service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the owner API exists, but readiness promotion
 * is an E-owned gate that also needs published contracts and Identity grants.
 */
export const SERVICE_NAME = 'catalog';
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

@Module({
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  controllers: [CatalogController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    ProbeService,
    PrismaOutboxStore,
    PrismaCatalogRepository,
    {
      provide: CATALOG_SERVICE,
      inject: [PrismaCatalogRepository],
      useFactory: (repository: PrismaCatalogRepository) =>
        new CatalogService({
          repository,
          // An unset Identity origin is allowed so the foundation image still
          // boots; every protected request then fails closed with 503.
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
