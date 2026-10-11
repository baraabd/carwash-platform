import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { PricingService } from './application';
import { PrismaPricingRepository } from './infrastructure/persistence/prisma-pricing.repository';
import {
  IdentitySessionAuthority,
  identityAuthorityConfigFromEnv,
} from './infrastructure/identity/identity-session.authority';
import { EnvPolicyProvider } from './infrastructure/policy/env-policy.provider';
import {
  CatalogV1HttpReader,
  catalogReaderConfigFromEnv,
} from './infrastructure/catalog/catalog-v1-http.reader';
import {
  ServiceClientAuthority,
  pricingServiceClientsFromEnv,
} from './infrastructure/service/service-client.authority';
import { RandomIds, Sha256Hasher, SystemClock } from './infrastructure/system/system.adapters';
import { PRICING_SERVICE, PricingController } from './transport/http/pricing.controller';
/**
 * Composition root for the pricing service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the owner API exists, but readiness promotion
 * is an E-owned gate that also needs published contracts, grants and policy.
 */
export const SERVICE_NAME = 'pricing';
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
  controllers: [PricingController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaPricingRepository,
    {
      provide: PRICING_SERVICE,
      inject: [PrismaPricingRepository],
      useFactory: (repository: PrismaPricingRepository) =>
        new PricingService({
          repository,
          // Unset Identity/Catalog origins, service clients or policy keep the
          // foundation image bootable; every affected command then fails closed.
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          services: new ServiceClientAuthority(pricingServiceClientsFromEnv(process.env)),
          catalog: new CatalogV1HttpReader(catalogReaderConfigFromEnv(process.env)),
          policy: new EnvPolicyProvider(process.env),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
