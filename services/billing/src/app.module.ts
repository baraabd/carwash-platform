import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { BillingService, CashCustodyService } from './application';
import { PrismaBillingRepository } from './infrastructure/persistence/prisma-billing.repository';
import {
  IdentitySessionAuthority,
  identityAuthorityConfigFromEnv,
} from './infrastructure/identity/identity-session.authority';
import {
  PricingQuoteReader,
  pricingConfigFromEnv,
} from './infrastructure/pricing/pricing-quote.reader';
import { RandomIds, Sha256Hasher, SystemClock } from './infrastructure/system/system.adapters';
import { UnpublishedWorkAuthority } from './infrastructure/work/unpublished-work.authority';
import { BILLING_SERVICE, BillingController } from './transport/http/billing.controller';
import { CASH_CUSTODY_SERVICE, CustodyController } from './transport/http/custody.controller';
/**
 * Composition root for the billing service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the owner API exists, but readiness promotion
 * is an E-owned gate that also needs the published billing.v1 contract, the
 * reconciliation grant, broker topology and merchant setup. Cash collection
 * additionally waits for lane C's work-completion contract and the CR-B-08
 * grants (it fails closed until then). The outbox relay is
 * deliberately not started (billing event contracts are not registered yet).
 */
export const SERVICE_NAME = 'billing';
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
  controllers: [BillingController, CustodyController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaBillingRepository,
    {
      provide: BILLING_SERVICE,
      inject: [PrismaBillingRepository],
      useFactory: (repository: PrismaBillingRepository) =>
        new BillingService({
          repository,
          // Unset Identity / Pricing origins keep the foundation image bootable;
          // every protected command then fails closed with 503.
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          quotes: new PricingQuoteReader(pricingConfigFromEnv(process.env)),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
    {
      provide: CASH_CUSTODY_SERVICE,
      inject: [PrismaBillingRepository],
      useFactory: (repository: PrismaBillingRepository) =>
        new CashCustodyService({
          repository,
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          // No published work-completion contract exists yet (lane C): every
          // cash collection fails closed with 503 until it does.
          work: new UnpublishedWorkAuthority(),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
