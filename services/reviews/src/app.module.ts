import { randomUUID } from 'node:crypto';
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
import { ReviewsService } from './application/reviews.service';
import { IdentitySessionAuthority } from './infrastructure/identity/identity.authority';
import { HttpBookingAuthority } from './infrastructure/booking/booking.authority';
import { ownerEndpoint } from './infrastructure/http/owner-http';
import { PrismaReviewsStore } from './infrastructure/persistence/prisma-reviews.store';
import {
  REVIEWS_IDENTITY,
  REVIEWS_SERVICE,
  ReviewsController,
} from './transport/http/reviews.controller';
/**
 * reviews HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'reviews';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'review',
  'review_audit',
  'review_command_receipt',
  'outbox_message',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_SESSION_ORIGIN, env),
    originCapability('booking-owner-contract', env.REVIEWS_BOOKING_ORIGIN, env),
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
  controllers: [HealthController, ReviewsController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: REVIEWS_IDENTITY,
      useFactory: () =>
        new IdentitySessionAuthority(
          ownerEndpoint(process.env, 'IDENTITY_SESSION_ORIGIN', 'IDENTITY_SESSION_TIMEOUT_MS'),
        ),
    },
    {
      provide: REVIEWS_SERVICE,
      useFactory: (prisma: PrismaService) =>
        new ReviewsService({
          store: new PrismaReviewsStore(prisma),
          booking: new HttpBookingAuthority(
            ownerEndpoint(process.env, 'REVIEWS_BOOKING_ORIGIN', 'REVIEWS_BOOKING_TIMEOUT_MS'),
          ),
          uuid: randomUUID,
          now: () => new Date(),
        }),
      inject: [PrismaService],
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
