import { Module } from '@nestjs/common';
import {
  HealthController,
  HEALTH_OPTIONS,
  schemaReadinessProbe,
  type HealthOptions,
  type RuntimeCapability,
  originCapability,
  serviceClientsCapability,
  createLogger,
  databaseSchemaFromUrl,
  type DependencyProbe,
} from '@carwash/service-kit';
import { CustomerApplication } from './application';
import {
  HttpIdentityAuthorizer,
  UnconfiguredIdentityAuthorizer,
} from './infrastructure/identity/http-identity-authorizer';
import { PrismaCustomerStore } from './infrastructure/persistence/prisma-customer.store';
import { ServiceWorkloadAuthenticator } from './infrastructure/identity/service-workload-authenticator';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { randomIds, systemClock } from './infrastructure/system/system';
import type { IdentityAuthorizer } from './ports';
import { CUSTOMER_APPLICATION, CustomerController } from './transport/http/customer.controller';
/**
 * customer HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'customer';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'customer_profile',
  'customer_address',
  'idempotency_record',
  'outbox_message',
  'audit_entry',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.CUSTOMER_IDENTITY_ORIGIN, env),
    serviceClientsCapability('address-snapshot-workload', env.CUSTOMER_SERVICE_CLIENTS, [
      'customer.address-snapshot.resolve',
    ]),
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

const DEFAULT_IDENTITY_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_ACTIVE_ADDRESSES = 100;

function positiveInteger(raw: string | undefined, fallback: number, code: string): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]{0,5}$/.test(raw)) throw new Error(code);
  return Number(raw);
}

/**
 * A missing Identity origin leaves every business endpoint failing closed with
 * IDENTITY_UNAVAILABLE; a present but invalid one stops startup.
 */
export function identityAuthorizerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): IdentityAuthorizer {
  const origin = env.CUSTOMER_IDENTITY_ORIGIN;
  if (!origin) return new UnconfiguredIdentityAuthorizer();
  return new HttpIdentityAuthorizer({
    origin,
    timeoutMs: positiveInteger(
      env.CUSTOMER_IDENTITY_TIMEOUT_MS,
      DEFAULT_IDENTITY_TIMEOUT_MS,
      'INVALID_IDENTITY_TIMEOUT',
    ),
  });
}

export function customerApplicationFactory(
  prisma: PrismaService,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): CustomerApplication {
  return new CustomerApplication(
    new PrismaCustomerStore(prisma.client, databaseSchemaFromUrl(url)),
    identityAuthorizerFromEnv(env),
    systemClock,
    randomIds,
    {
      maxActiveAddresses: positiveInteger(
        env.CUSTOMER_MAX_ACTIVE_ADDRESSES,
        DEFAULT_MAX_ACTIVE_ADDRESSES,
        'INVALID_MAX_ACTIVE_ADDRESSES',
      ),
    },
    new ServiceWorkloadAuthenticator(env.CUSTOMER_SERVICE_CLIENTS),
  );
}

@Module({
  controllers: [HealthController, CustomerController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: CUSTOMER_APPLICATION,
      useFactory: (prisma: PrismaService, url: string) => customerApplicationFactory(prisma, url),
      inject: [PrismaService, DATABASE_URL],
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
