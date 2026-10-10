import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseSchemaFromUrl, serviceTelemetry } from '@carwash/service-kit';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';

/** Injection token for this service's own connection string. */
export const DATABASE_URL = 'CARWASH_DATABASE_URL';
/** Optional injection token for pool options. */
export const PRISMA_OPTIONS = 'MEDIA_PRISMA_OPTIONS';

/**
 * Server-side fence for sessions orphaned by a crashed API replica. API
 * transactions never wait on the network inside a transaction, so 5 s is a
 * generous bound between two of their statements.
 */
export const API_IDLE_IN_TRANSACTION_TIMEOUT_MS = 5_000;
/**
 * The purge worker holds one row lock across one bounded object-store delete
 * (MEDIA_S3_TIMEOUT_MS ≤ 10 s), so its sessions get a longer bound.
 */
export const WORKER_IDLE_IN_TRANSACTION_TIMEOUT_MS = 25_000;

export interface PrismaOptions {
  readonly idleInTransactionTimeoutMs: number;
}

/**
 * media's OWN database adapter.
 *
 * Persistence is infrastructure. It is deliberately service-local and is never
 * exported from a shared business package. The application and domain layers
 * depend on ports, not on this Prisma implementation.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(
    @Inject(DATABASE_URL) url: string,
    @Optional() @Inject(PRISMA_OPTIONS) options?: PrismaOptions,
  ) {
    if (!url) throw new Error('DATABASE_URL_REQUIRED');
    const pool = new Pool({
      connectionString: url,
      // A replica killed mid-transaction leaves its backend "idle in
      // transaction" holding row locks until PostgreSQL notices the dead
      // socket, which behind a TCP proxy can take minutes. The server ends
      // such a session (and releases its locks) after this bound.
      idle_in_transaction_session_timeout:
        options?.idleInTransactionTimeoutMs ?? API_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    });
    const telemetry = serviceTelemetry('media');
    telemetry.metrics.observePool(() => pool);
    const adapter = new PrismaPg(pool, {
      schema: databaseSchemaFromUrl(url),
      disposeExternalPool: true,
    });
    this.client = new PrismaClient({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url || url.length === 0) throw new Error('DATABASE_URL_REQUIRED');
  return url;
}
