import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseSchemaFromUrl, serviceTelemetry } from '@carwash/service-kit';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';

/** Injection token for this service's own connection string. */
export const DATABASE_URL = 'CARWASH_DATABASE_URL';

/** Server-side fence for sessions orphaned by a crashed replica (see below). */
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 5_000;

/**
 * dispatch's OWN database adapter.
 *
 * Persistence is infrastructure. It is deliberately service-local and is never
 * exported from a shared business package. The application and domain layers
 * must depend on ports, not on this Prisma implementation.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(DATABASE_URL) url: string) {
    if (!url) throw new Error('DATABASE_URL_REQUIRED');
    const pool = new Pool({
      connectionString: url,
      // A replica killed mid-transaction leaves its backend "idle in transaction"
      // holding row locks until PostgreSQL notices the dead socket, which behind
      // a TCP proxy can take minutes. The server ends such a session (and
      // releases its locks) after this bound; a live unit of work never idles
      // between its statements for this long (transactions time out at 10 s).
      idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    });
    const telemetry = serviceTelemetry('dispatch');
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
