import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { CustodyProjectionService, CustodyQueryService } from './application';
import { PrismaCustodyStore } from './infrastructure/persistence/prisma-custody.store';
import {
  IdentitySessionAuthority,
  identityAuthorityConfigFromEnv,
} from './infrastructure/identity/identity-session.authority';
import { RandomIds, Sha256Hasher, SystemClock } from './infrastructure/system/system.adapters';
import { CUSTODY_QUERY_SERVICE, WalletController } from './transport/http/wallet.controller';
/**
 * Composition root for the wallet service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the custody projection and its read API
 * exist, but the billing.v1 broker binding is not started (no
 * platform-messaging dependency yet, CR-B-P06-WAL-01) and readiness promotion, route
 * registration and grants are Lane E gates (CONTRACT_REQUEST_E_WALLET.md).
 */
export const SERVICE_NAME = 'wallet';
export const BUSINESS_READY = false;
export const CUSTODY_PROJECTION_SERVICE = 'CUSTODY_PROJECTION_SERVICE';

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
  controllers: [WalletController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: PrismaCustodyStore,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaCustodyStore(prisma),
    },
    {
      provide: CUSTODY_QUERY_SERVICE,
      inject: [PrismaCustodyStore],
      useFactory: (store: PrismaCustodyStore) =>
        new CustodyQueryService({
          store,
          // An unset Identity origin keeps the image bootable; every read then
          // fails closed with 503.
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
          clock: new SystemClock(),
        }),
    },
    {
      // The application handler a broker binding will call (not bound yet).
      provide: CUSTODY_PROJECTION_SERVICE,
      inject: [PrismaCustodyStore],
      useFactory: (store: PrismaCustodyStore) =>
        new CustodyProjectionService({
          store,
          clock: new SystemClock(),
          hasher: new Sha256Hasher(),
          ids: new RandomIds(),
        }),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
