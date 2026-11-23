import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
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
  ENTITLEMENT_SERVICE,
  SUBSCRIPTION_SERVICE,
  SubscriptionController,
} from './transport/http/subscription.controller';
/**
 * Composition root for the subscription service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the owner API exists, but readiness promotion
 * is an E-owned gate that also needs published contracts, grants and policy.
 */
export const SERVICE_NAME = 'subscription';
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
  controllers: [SubscriptionController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    PrismaSubscriptionRepository,
    {
      provide: SUBSCRIPTION_SERVICE,
      inject: [PrismaSubscriptionRepository],
      useFactory: (repository: PrismaSubscriptionRepository) =>
        new SubscriptionService({
          repository,
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
