import { BILLING_SERVICE_SCOPES } from './ports';
import { Module } from '@nestjs/common';
import {
  HealthController,
  HEALTH_OPTIONS,
  schemaReadinessProbe,
  type HealthOptions,
  type RuntimeCapability,
  databaseSchemaFromUrl,
  originCapability,
  configurationCapability,
  serviceClientsCapability,
  createLogger,
  type DependencyProbe,
} from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import {
  BillingService,
  BookingObligationService,
  CashCustodyService,
  CanonicalRefundService,
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
import { SubscriptionFundingService } from './application/subscription-funding.service';
import {
  SUBSCRIPTION_FUNDING_SERVICE,
  SubscriptionFundingController,
} from './transport/http/subscription-funding.controller';
import { RandomIds, Sha256Hasher, SystemClock } from './infrastructure/system/system.adapters';
import {
  DispatchWorkAuthority,
  dispatchWorkConfigFromEnv,
} from './infrastructure/work/dispatch-work.authority';
import { productionProviderRegistry } from './infrastructure/providers/merchant-providers';
import { BILLING_SERVICE, BillingController } from './transport/http/billing.controller';
import {
  BOOKING_OBLIGATION_SERVICE,
  BookingObligationController,
} from './transport/http/booking-obligation.controller';
import { CASH_CUSTODY_SERVICE, CustodyController } from './transport/http/custody.controller';
import { FINANCE_QUERY_SERVICE, FinanceController } from './transport/http/finance.controller';
import { ProviderNotificationController } from './transport/http/provider-notification.controller';
import {
  CANONICAL_REFUND_SERVICE,
  CanonicalRefundController,
} from './transport/http/canonical-refund.controller';
import {
  PROVIDER_PAYMENTS_SERVICE,
  ProviderController,
  REFUND_SERVICE,
} from './transport/http/provider.controller';
/**
 * billing HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const PAYMENT_PROVIDERS = 'PAYMENT_PROVIDERS';
export const SERVICE_NAME = 'billing';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'billing_obligation',
  'payment_intent',
  'payment_attempt',
  'ledger_journal',
  'ledger_line',
  'billing_idempotency_receipt',
  'billing_audit_event',
  'outbox_message',
  'cash_receipt',
  'cash_receipt_reversal',
  'custody_handover',
  'custody_handover_item',
  'provider_credit',
  'subscription_funding_command',
  'subscription_funding_namespace',
  'subscription_funding_claim',
  'payment_refund',
  'booking_obligation',
  'booking_compensation',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_SESSION_ORIGIN, env),
    originCapability('pricing-contract', env.PRICING_ORIGIN, env),
    originCapability('dispatch-work-contract', env.BILLING_DISPATCH_ORIGIN, env),
    configurationCapability('pricing-workload-credential', () => {
      const credential = pricingCredentialFromEnv(env);
      return credential !== null && /^[\x21-\x7e]{32,256}$/.test(credential.token);
    }),
    serviceClientsCapability(
      'billing-workload-scopes',
      env.BILLING_SERVICE_CLIENTS,
      BILLING_SERVICE_SCOPES,
    ),
    configurationCapability('merchant-statement-accounts', () =>
      productionProviderRegistry(env)
        .all()
        .every((provider) => provider.diagnostics().merchantAccountCount > 0),
    ),
    {
      ...configurationCapability('automated-provider-confirmation', () =>
        productionProviderRegistry(env)
          .all()
          .every(
            (provider) => provider.capabilities.notifications && provider.capabilities.creditQuery,
          ),
      ),
      required: false,
    },
  ];
}

export function runtimeHealthOptions(
  prisma: PrismaService,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): HealthOptions {
  return {
    service: SERVICE_NAME,
    businessReady: BUSINESS_READY,
    runtimeCapabilities: runtimeCapabilities(env),
    dependencies: [
      postgresProbe(prisma),
      schemaReadinessProbe(RUNTIME_TABLES, async () => {
        const rows = await prisma.client.$queryRaw<
          Array<{
            table_name: string;
            role_name: string;
            session_role: string;
            database_name: string;
          }>
        >`
          SELECT table_name, current_user::text AS role_name, session_user::text AS session_role,
            current_database()::text AS database_name FROM information_schema.tables
          WHERE table_schema = ${databaseSchemaFromUrl(url)} AND table_type = 'BASE TABLE'
        `;
        if (
          rows.some(
            (row) =>
              row.role_name !== `cw_${SERVICE_NAME}_app` ||
              row.session_role !== `cw_${SERVICE_NAME}_app` ||
              row.database_name !== `cw_${SERVICE_NAME}`,
          )
        )
          throw new Error('OWNER_DATABASE_IDENTITY_MISMATCH');
        return rows.map((row) => row.table_name);
      }),
    ],
    logger: createLogger({ service: SERVICE_NAME }),
  };
}

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
  controllers: [
    HealthController,
    BillingController,
    CustodyController,
    ProviderController,
    ProviderNotificationController,
    CanonicalRefundController,
    FinanceController,
    BookingObligationController,
    SubscriptionFundingController,
  ],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaBillingRepository,
    PrismaFinanceReadModel,
    {
      provide: SUBSCRIPTION_FUNDING_SERVICE,
      inject: [PrismaBillingRepository],
      useFactory: (repository: PrismaBillingRepository) =>
        new SubscriptionFundingService({
          repository,
          callers: ServiceClientCallerAuthority.fromEnv(process.env),
          clock: new SystemClock(),
          hasher: new Sha256Hasher(),
        }),
    },
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
          work: new DispatchWorkAuthority(dispatchWorkConfigFromEnv(process.env)),
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
      provide: CANONICAL_REFUND_SERVICE,
      inject: [PrismaBillingRepository],
      useFactory: (repository: PrismaBillingRepository) =>
        new CanonicalRefundService({
          repository,
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
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
