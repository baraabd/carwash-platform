import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import { BookingService } from './application';
import { IdentitySessionClient } from './infrastructure/identity/identity-session.client';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { compose, positiveInt } from './infrastructure/runtime/composition';
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
      provide: BookingService,
      useFactory: (prisma: PrismaService) =>
        compose(prisma, process.env, {
          instanceId: `api-${randomUUID().slice(0, 8)}`,
          component: 'api',
        }).service,
      inject: [PrismaService],
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
