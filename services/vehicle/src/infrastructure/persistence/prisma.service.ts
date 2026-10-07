import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseSchemaFromUrl, serviceTelemetry } from '@carwash/service-kit';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';
import { IdempotencyRetention } from './idempotency-retention';

/** Injection token for this service's own connection string. */
export const DATABASE_URL = 'CARWASH_DATABASE_URL';

/**
 * vehicle's OWN database adapter.
 *
 * Persistence is infrastructure. It is deliberately service-local and is never
 * exported from a shared business package. The application and domain layers
 * must depend on ports, not on this Prisma implementation.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy, OnModuleInit {
  readonly client: PrismaClient;
  private readonly retention: IdempotencyRetention;

  constructor(@Inject(DATABASE_URL) url: string) {
    if (!url) throw new Error('DATABASE_URL_REQUIRED');
    const pool = new Pool({ connectionString: url });
    const telemetry = serviceTelemetry('vehicle');
    telemetry.metrics.observePool(() => pool);
    const adapter = new PrismaPg(pool, {
      schema: databaseSchemaFromUrl(url),
      disposeExternalPool: true,
    });
    this.client = new PrismaClient({ adapter });
    const logger = new Logger('VehicleIdempotencyRetention');
    this.retention = new IdempotencyRetention(
      () => this.purgeExpiredIdempotency(),
      () => logger.warn('IDEMPOTENCY_RETENTION_SWEEP_FAILED'),
    );
  }

  purgeExpiredIdempotency(): Promise<number> {
    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
        return tx.$executeRaw`
        DELETE FROM "app"."idempotency_record" WHERE (scope, key) IN (
          SELECT scope, key FROM "app"."idempotency_record"
          WHERE expires_at <= clock_timestamp()
          ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
        )`;
      },
      { maxWait: 2_000, timeout: 5_000 },
    );
  }

  onModuleInit(): void {
    this.retention.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.retention.stop();
    await this.client.$disconnect();
  }
}

export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url || url.length === 0) throw new Error('DATABASE_URL_REQUIRED');
  return url;
}
