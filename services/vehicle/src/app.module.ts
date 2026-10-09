import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import { VehicleApplication } from './application';
import {
  HttpIdentityAuthorizer,
  UnconfiguredIdentityAuthorizer,
} from './infrastructure/identity/http-identity-authorizer';
import { NoWorkloadIdentity } from './infrastructure/identity/no-workload-identity';
import { PrismaVehicleStore } from './infrastructure/persistence/prisma-vehicle.store';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
import { randomIds, systemClock } from './infrastructure/system/system';
import type { IdentityAuthorizer } from './ports';
import { VEHICLE_APPLICATION, VehicleController } from './transport/http/vehicle.controller';
/**
 * Composition root for the vehicle service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false: the saved-vehicle capability exists,
 * but readiness is only advertised after exact-source acceptance (Lane E).
 */
export const SERVICE_NAME = 'vehicle';
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

function positiveInteger(raw: string | undefined, fallback: number, code: string): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]{0,5}$/.test(raw)) throw new Error(code);
  return Number(raw);
}

/**
 * A missing Identity origin leaves every business endpoint failing closed with
 * DEPENDENCY_UNAVAILABLE; a present but invalid one stops startup.
 */
export function identityAuthorizerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): IdentityAuthorizer {
  const origin = env.VEHICLE_IDENTITY_ORIGIN;
  if (!origin) return new UnconfiguredIdentityAuthorizer();
  return new HttpIdentityAuthorizer({
    origin,
    timeoutMs: positiveInteger(
      env.VEHICLE_IDENTITY_TIMEOUT_MS,
      DEFAULT_IDENTITY_TIMEOUT_MS,
      'INVALID_IDENTITY_TIMEOUT',
    ),
  });
}

export function vehicleApplicationFactory(
  prisma: PrismaService,
  env: NodeJS.ProcessEnv = process.env,
): VehicleApplication {
  return new VehicleApplication(
    new PrismaVehicleStore(prisma.client),
    identityAuthorizerFromEnv(env),
    // Workload identity is P01-E5 (Lane E); service routes stay deny-by-default.
    new NoWorkloadIdentity(),
    systemClock,
    randomIds,
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
  controllers: [VehicleController],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
    {
      provide: VEHICLE_APPLICATION,
      useFactory: (prisma: PrismaService) => vehicleApplicationFactory(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}