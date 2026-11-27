import { Module } from '@nestjs/common';
import { PRICING_SERVICE_SCOPES } from './ports';
import { policyMatchesContract } from './domain';
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
import { PricingService } from './application';
import { PricingService as LegacyPricingService, PromotionService } from './application/legacy';
import { PrismaPricingRepository as LegacyPricingRepository } from './infrastructure/legacy/persistence/prisma-pricing.repository';
import { IdentitySessionAuthority as LegacyIdentityAuthority } from './infrastructure/legacy/identity/identity-session.authority';
import { PendingCatalogContractReader } from './infrastructure/legacy/catalog/pending-catalog-contract.reader';
import { ConfiguredServiceCallers } from './infrastructure/legacy/security/service-callers';
import {
  LEGACY_PRICING_SERVICE,
  PROMOTION_SERVICE,
  LegacyPricingController,
} from './transport/legacy/http/pricing.controller';
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
import { SubscriptionQuoteService } from './application/subscription-quote.service';
import { PrismaSubscriptionQuoteStore } from './infrastructure/persistence/prisma-subscription-quote.store';
import {
  SubscriptionPlanHttpReader,
  subscriptionPlanConfigFromEnv,
} from './infrastructure/subscription/subscription-plan.reader';
import {
  SUBSCRIPTION_QUOTE_SERVICE,
  SubscriptionQuoteController,
} from './transport/http/subscription-quote.controller';
/**
 * pricing HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'pricing';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'pricing_publication_lock',
  'price_version',
  'price_rate',
  'quote',
  'quote_line',
  'pricing_idempotency_receipt',
  'pricing_audit_event',
  'price_book',
  'price_book_entry',
  'pricing_quote',
  'pricing_quote_line',
  'pricing_audit_record',
  'pricing_subscription_quote',
  'promotion',
  'promotion_revision',
  'quote_discount',
  'promotion_redemption',
  'promotion_audit_event',
  'outbox_message',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_SESSION_ORIGIN, env),
    originCapability('catalog-contract', env.CATALOG_ORIGIN, env),
    originCapability('subscription-plan-contract', env.SUBSCRIPTION_ORIGIN, env),
    configurationCapability('price-policy', () => {
      const policy = new EnvPolicyProvider(env);
      const currency = policy.currencyPolicy();
      return (
        currency !== null && policyMatchesContract(currency) && policy.quoteTtlSeconds() !== null
      );
    }),
    serviceClientsCapability(
      'quote-validation-workloads',
      env.PRICING_SERVICE_CLIENTS,
      PRICING_SERVICE_SCOPES,
    ),
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
    PricingController,
    LegacyPricingController,
    SubscriptionQuoteController,
  ],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaPricingRepository,
    LegacyPricingRepository,
    PrismaSubscriptionQuoteStore,
    {
      provide: SUBSCRIPTION_QUOTE_SERVICE,
      inject: [PrismaSubscriptionQuoteStore],
      useFactory: (store: PrismaSubscriptionQuoteStore) =>
        new SubscriptionQuoteService({
          store,
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          plans: new SubscriptionPlanHttpReader(subscriptionPlanConfigFromEnv(process.env)),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
          policy: new EnvPolicyProvider(process.env),
        }),
    },
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
    {
      provide: LEGACY_PRICING_SERVICE,
      inject: [LegacyPricingRepository],
      useFactory: (repository: LegacyPricingRepository) =>
        new LegacyPricingService({
          repository,
          authority: new LegacyIdentityAuthority(identityAuthorityConfigFromEnv(process.env)),
          catalog: new PendingCatalogContractReader(),
          policy: new EnvPolicyProvider(process.env),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
    {
      provide: PROMOTION_SERVICE,
      inject: [LegacyPricingRepository],
      useFactory: (repository: LegacyPricingRepository) =>
        new PromotionService({
          repository,
          authority: new LegacyIdentityAuthority(identityAuthorityConfigFromEnv(process.env)),
          callers: ConfiguredServiceCallers.fromEnv(process.env),
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
