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
  credentialCapability,
  createLogger,
  type DependencyProbe,
} from '@carwash/service-kit';
import {
  BookingService,
  BookingHoldsService,
  ChangeService,
  TechnicianViewQuery,
} from './application';
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { compose, positiveInt, type Composition } from './infrastructure/runtime/composition';
import { ActorResolver, RequestBudget } from './transport/http/actor-resolver';
import { BookingController } from './transport/http/booking.controller';

/**
 * booking HTTP composition. The foundation fallback remains unready.
 * Runtime promotion requires locally validated implemented capabilities and
 * this owner's live database/schema; release, workers and external acceptance
 * are separate gates and are never inferred from this health response.
 */
export const SERVICE_NAME = 'booking';
export const BUSINESS_READY = false;

/** Owner-local schema surface; the release migration gate still proves exact revisions. */
export const RUNTIME_TABLES = [
  'service_marker',
  'booking',
  'inbox_message',
  'booking_dispatch_projection',
  'booking_request',
  'booking_saga',
  'booking_entitlement_consumption',
  'outbox_message',
  'audit_entry',
  'booking_change',
  'booking_schedule',
] as const;

export function runtimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): readonly RuntimeCapability[] {
  return [
    originCapability('identity-authority', env.IDENTITY_URL, env),
    originCapability('pricing-contract', env.PRICING_URL, env),
    originCapability('billing-contract', env.BILLING_URL, env),
    originCapability('scheduling-contract', env.SCHEDULING_URL, env),
    originCapability('subscription-contract', env.SUBSCRIPTION_URL, env),
    originCapability('customer-contract', env.CUSTOMER_URL, env),
    originCapability('vehicle-contract', env.VEHICLE_URL, env),
    credentialCapability(
      'pricing-workload',
      env.BOOKING_SERVICE_CLIENT_ID ?? 'booking',
      env.BOOKING_TOKEN_PRICING,
    ),
    credentialCapability(
      'billing-workload',
      env.BOOKING_SERVICE_CLIENT_ID ?? 'booking',
      env.BOOKING_TOKEN_BILLING,
    ),
    credentialCapability(
      'scheduling-workload',
      env.BOOKING_SERVICE_CLIENT_ID ?? 'booking',
      env.BOOKING_TOKEN_SCHEDULING,
    ),
    credentialCapability(
      'subscription-workload',
      env.BOOKING_SERVICE_CLIENT_ID ?? 'booking',
      env.BOOKING_TOKEN_SUBSCRIPTION,
    ),
    credentialCapability(
      'customer-workload',
      env.BOOKING_SERVICE_CLIENT_ID ?? 'booking',
      env.BOOKING_TOKEN_CUSTOMER,
    ),
    credentialCapability(
      'vehicle-workload',
      env.BOOKING_SERVICE_CLIENT_ID ?? 'booking',
      env.BOOKING_TOKEN_VEHICLE,
    ),
    originCapability('dispatch-contract', env.BOOKING_DISPATCH_URL, env),
    credentialCapability(
      'dispatch-workload',
      env.BOOKING_DISPATCH_CLIENT_ID,
      env.BOOKING_DISPATCH_CLIENT_TOKEN,
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

const COMPOSITION = Symbol('BOOKING_COMPOSITION');

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
  controllers: [HealthController, BookingController],
  providers: [
    {
      provide: HEALTH_OPTIONS,
      inject: [PrismaService, DATABASE_URL],
      useFactory: (prisma: PrismaService, url: string) => runtimeHealthOptions(prisma, url),
    },
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      // One composition per process. Configuration (including BOOKING_DISPATCH_*)
      // is validated here, so a malformed value stops the process at startup.
      provide: COMPOSITION,
      useFactory: (prisma: PrismaService): Composition =>
        compose(prisma, process.env, {
          instanceId: `api-${randomUUID().slice(0, 8)}`,
          component: 'api',
        }),
      inject: [PrismaService],
    },
    {
      provide: BookingService,
      useFactory: (composition: Composition) => composition.service,
      inject: [COMPOSITION],
    },
    {
      provide: BookingHoldsService,
      useFactory: (composition: Composition) => composition.holds,
      inject: [COMPOSITION],
    },
    {
      provide: ChangeService,
      useFactory: (composition: Composition) => composition.changes,
      inject: [COMPOSITION],
    },
    {
      provide: TechnicianViewQuery,
      useFactory: (composition: Composition) => composition.technicianView,
      inject: [COMPOSITION],
    },
    {
      provide: ActorResolver,
      useFactory: () =>
        new ActorResolver(
          new IdentitySessionClient({
            baseUrl: process.env.IDENTITY_URL,
            timeoutMs: positiveInt(process.env.IDENTITY_TIMEOUT_MS, 2_000),
          }),
          new RequestBudget(positiveInt(process.env.BOOKING_USER_REQUESTS_PER_MINUTE, 60)),
        ),
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
