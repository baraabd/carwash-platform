import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
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
 * Composition root for the reviews service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false until exact-source release acceptance and
 * deployment decisions exist; implementing the API alone is not readiness.
 */
export const SERVICE_NAME = 'reviews';
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
  controllers: [ReviewsController],
  providers: [
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
