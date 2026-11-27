import { SERVICE_SCOPES } from './ports';
import { Module } from '@nestjs/common';
import {
  HealthController,
  HEALTH_OPTIONS,
  schemaReadinessProbe,
  type HealthOptions,
  type RuntimeCapability,
  databaseSchemaFromUrl,
  originCapability,
  serviceClientsCapability,
  credentialCapability,
  createLogger,
  type DependencyProbe,
} from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { EntitlementService, SubscriptionService } from './application';
import { PrismaSubscriptionRepository } from './infrastructure/persistence/prisma-subscription.repository';
import {
  IdentitySessionAuthority,
  identityAuthorityConfigFromEnv,
} from './infrastructure/identity/identity-session.authority';
import { ConfiguredServiceCallers } from './infrastructure/security/service-callers';
import { RandomIds, Sha256Hasher, SystemClock } from './infrastructure/system/system.adapters';
import {
  BillingFundingAuthority,
  billingFundingConfigFromEnv,
} from './infrastructure/billing/billing-funding.authority';
import {
  PurchaseOwnersClient,
  purchaseOwnersConfigFromEnv,
} from './infrastructure/billing/purchase-owners.client';
import { CanonicalSubscriptionService } from './application/canonical-subscription.service';
import {
  ENTITLEMENT_SERVICE,
  CANONICAL_SUBSCRIPTION_SERVICE,
  SUBSCRIPTION_SERVICE,
  SubscriptionController,
} from './transport/http/subscription.controller';
/**
 * subscription HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'subscription';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'subscription_plan',
  'subscription_plan_revision',
  'customer_subscription',
  'subscription_funding_release',
  'subscription_purchase',
  'subscription_change_request',
  'subscription_period',
  'entitlement_reservation',
  'entitlement_movement',
  'subscription_idempotency_receipt',
  'subscription_audit_event',
  'subscription_workload_receipt',
  'outbox_message',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_SESSION_ORIGIN, env),
    originCapability('billing-funding-contract', env.SUBSCRIPTION_BILLING_ORIGIN, env),
    originCapability('pricing-purchase-contract', env.SUBSCRIPTION_PRICING_ORIGIN, env),
    credentialCapability(
      'billing-funding-workload',
      env.SUBSCRIPTION_BILLING_CLIENT_ID,
      env.SUBSCRIPTION_BILLING_SERVICE_TOKEN,
    ),
    serviceClientsCapability(
      'entitlement-workload-scopes',
      env.SUBSCRIPTION_SERVICE_CLIENTS,
      SERVICE_SCOPES,
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
  controllers: [HealthController, SubscriptionController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaSubscriptionRepository,
    {
      provide: CANONICAL_SUBSCRIPTION_SERVICE,
      inject: [PrismaSubscriptionRepository, SUBSCRIPTION_SERVICE],
      useFactory: (repository: PrismaSubscriptionRepository, legacy: SubscriptionService) =>
        new CanonicalSubscriptionService({
          repository,
          legacy,
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          funding: new BillingFundingAuthority(billingFundingConfigFromEnv(process.env)),
          owners: new PurchaseOwnersClient(purchaseOwnersConfigFromEnv(process.env)),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
    {
      provide: SUBSCRIPTION_SERVICE,
      inject: [PrismaSubscriptionRepository],
      useFactory: (repository: PrismaSubscriptionRepository) =>
        new SubscriptionService({
          repository,
          funding: new BillingFundingAuthority(billingFundingConfigFromEnv(process.env)),
          // An unset Identity origin keeps the foundation image bootable; every
          // protected command then fails closed with 503.
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
    {
      provide: ENTITLEMENT_SERVICE,
      inject: [PrismaSubscriptionRepository],
      useFactory: (repository: PrismaSubscriptionRepository) =>
        new EntitlementService({
          repository,
          funding: new BillingFundingAuthority(billingFundingConfigFromEnv(process.env)),
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          // No configured client means every entitlement route is refused.
          callers: ConfiguredServiceCallers.fromEnv(process.env),
          clock: new SystemClock(),
          ids: new RandomIds(),
          hasher: new Sha256Hasher(),
        }),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
