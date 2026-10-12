import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { CustodyProjector, CustodyQueries } from './application';
import { PrismaWalletRepository } from './infrastructure/persistence/prisma-wallet.repository';
import {
  IdentitySessionAuthority,
  identityAuthorityConfigFromEnv,
} from './infrastructure/identity/identity-session.authority';
import { RandomIds, SystemClock } from './infrastructure/system/system.adapters';
import { CUSTODY_QUERIES, WalletController } from './transport/http/wallet.controller';
/**
 * Composition root for the wallet service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the custody projection and read API exist, but
 * the broker binding, grants and readiness promotion are E-owned gates.
 */
export const SERVICE_NAME = 'wallet';
export const BUSINESS_READY = false;
export const CUSTODY_PROJECTOR = 'CUSTODY_PROJECTOR';

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
    PrismaWalletRepository,
    {
      provide: CUSTODY_QUERIES,
      inject: [PrismaWalletRepository],
      useFactory: (repository: PrismaWalletRepository) =>
        new CustodyQueries({
          repository,
          // An unset Identity origin keeps the image bootable; every read then fails closed (503).
          authority: new IdentitySessionAuthority(identityAuthorityConfigFromEnv(process.env)),
        }),
    },
    {
      // Wired for the broker adapter Lane E will bind (CR-B-12.3); no consumer runs yet.
      provide: CUSTODY_PROJECTOR,
      inject: [PrismaWalletRepository],
      useFactory: (repository: PrismaWalletRepository) =>
        new CustodyProjector({ repository, clock: new SystemClock(), ids: new RandomIds() }),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
