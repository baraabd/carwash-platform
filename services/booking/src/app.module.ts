import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import { BookingService, TechnicianViewQuery } from './application';
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
 * Composition root for the booking service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the booking aggregate, saga and API are
 * implemented, but Billing has no published contract (every booking is
 * rejected before its pivot until it has one), the Booking contracts are only
 * requested from Lane E, and no release acceptance ran on this exact source.
 */
export const SERVICE_NAME = 'booking';
export const BUSINESS_READY = false;
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
  imports: [
    HealthModule.forService({
      service: SERVICE_NAME,
      businessReady: BUSINESS_READY,
      logger: createLogger({ service: SERVICE_NAME }),
    }),
  ],
  controllers: [BookingController],
  providers: [
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
