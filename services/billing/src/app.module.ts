import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import {
  BillingService,
  BookingObligationService,
  CashCustodyService,
  FinanceQueryService,
  ProviderPaymentsService,
  RefundService,
} from './application';
import type { PaymentProviderRegistry } from './ports';
import { PrismaBillingRepository } from './infrastructure/persistence/prisma-billing.repository';
import { PrismaFinanceReadModel } from './infrastructure/persistence/prisma-finance.read-model';
import {
  IdentitySessionAuthority,
  identityAuthorityConfigFromEnv,
} from './infrastructure/identity/identity-session.authority';
import {
  PricingQuoteReader,
  pricingConfigFromEnv,
} from './infrastructure/pricing/pricing-quote.reader';
import {
  PricingQuoteValidator,
  pricingCredentialFromEnv,
} from './infrastructure/pricing/pricing-quote.validator';
import { ServiceClientCallerAuthority } from './infrastructure/security/service-callers';
import { RandomIds, Sha256Hasher, SystemClock } from './infrastructure/system/system.adapters';
import { UnpublishedWorkAuthority } from './infrastructure/work/unpublished-work.authority';
import { productionProviderRegistry } from './infrastructure/providers/merchant-providers';
import { BILLING_SERVICE, BillingController } from './transport/http/billing.controller';
import {
  BOOKING_OBLIGATION_SERVICE,
  BookingObligationController,
} from './transport/http/booking-obligation.controller';
import { CASH_CUSTODY_SERVICE, CustodyController } from './transport/http/custody.controller';
import { FINANCE_QUERY_SERVICE, FinanceController } from './transport/http/finance.controller';
import {
  PROVIDER_PAYMENTS_SERVICE,
  ProviderController,
  REFUND_SERVICE,
} from './transport/http/provider.controller';
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
 * Payment providers run with the capabilities possible without an official
 * merchant API (statement evidence + manual refunds); provider notifications
 * and verified queries stay unavailable until LIVE_PROVIDER_ACCEPTANCE.
 */
export const PAYMENT_PROVIDERS = 'PAYMENT_PROVIDERS';
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
  controllers: [
    BillingController,
    CustodyController,
    ProviderController,
    FinanceController,
    BookingObligationController,
  ],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaBillingRepository,
    PrismaFinanceReadModel,
    // Fails startup on invalid merchant-account config or on automation
    // settings for an adapter that does not exist (never silently ignored).
    { provide: PAYMENT_PROVIDERS, useFactory: () => productionProviderRegistry(process.env) },
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
    {
      provide: PROVIDER_PAYMENTS_SERVICE,
      inject: [PrismaBillingRepository, PAYMENT_PROVIDERS],
      useFactory: (repository: PrismaBillingRepository, providers: PaymentProviderRegistry) =>
        new ProviderPaymentsService({
          repository,
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          providers,
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
    {
      provide: REFUND_SERVICE,
      inject: [PrismaBillingRepository, PAYMENT_PROVIDERS],
      useFactory: (repository: PrismaBillingRepository, providers: PaymentProviderRegistry) =>
        new RefundService({
          repository,
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          providers,
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
    {
      // Admin finance reads (P06-B6): read-only snapshot queries, billing.read only.
      provide: FINANCE_QUERY_SERVICE,
      inject: [PrismaFinanceReadModel],
      useFactory: (readModel: PrismaFinanceReadModel) =>
        new FinanceQueryService({
          readModel,
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          clock: new SystemClock(),
        }),
    },
    {
      provide: BOOKING_OBLIGATION_SERVICE,
      inject: [PrismaBillingRepository],
      useFactory: (repository: PrismaBillingRepository) =>
        new BookingObligationService({
          repository,
          // No configured workload (BILLING_SERVICE_CLIENTS) answers 401; no
          // Pricing workload credential fails every create closed with 503.
          services: ServiceClientCallerAuthority.fromEnv(process.env),
          quotes: new PricingQuoteValidator(
            pricingConfigFromEnv(process.env),
            pricingCredentialFromEnv(process.env),
          ),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
