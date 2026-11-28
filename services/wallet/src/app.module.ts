import { Module } from '@nestjs/common';
import {
  HealthController,
  HEALTH_OPTIONS,
  schemaReadinessProbe,
  type HealthOptions,
  type RuntimeCapability,
  databaseSchemaFromUrl,
  originCapability,
  createLogger,
  type DependencyProbe,
} from '@carwash/service-kit';
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
 * wallet HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'wallet';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'wallet_inbox',
  'custody_source',
  'custody_account',
  'custody_movement',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [originCapability('identity-authority', env.IDENTITY_SESSION_ORIGIN, env)];
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
  controllers: [HealthController, WalletController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
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
      // HTTP composition exposes the projector; the standalone worker owns AMQP.
      provide: CUSTODY_PROJECTOR,
      inject: [PrismaWalletRepository],
      useFactory: (repository: PrismaWalletRepository) =>
        new CustodyProjector({ repository, clock: new SystemClock(), ids: new RandomIds() }),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
