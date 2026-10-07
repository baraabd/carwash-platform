import { Module } from '@nestjs/common';
import {
  HealthModule,
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
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { randomIds, systemClock } from './infrastructure/system/system';
import type { IdentityAuthorizer } from './ports';
import { CUSTOMER_APPLICATION, CustomerController } from './transport/http/customer.controller';
/**
 * Composition root for the customer service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the profile and address capability exists,
 * but readiness is only advertised after exact-source acceptance (Lane E).
 */
export const SERVICE_NAME = 'customer';
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
  );
}

@Module({
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  controllers: [CustomerController],
  providers: [
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
