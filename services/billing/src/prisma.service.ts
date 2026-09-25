import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseSchemaFromUrl } from '@carwash/service-kit';
import { PrismaClient } from './generated/prisma/client';

/** Injection token for this service's own connection string. */
export const DATABASE_URL = 'CARWASH_DATABASE_URL';

/**
 * billing's OWN database client.
 *
 * It is deliberately not exported from a shared package: a shared client is how
 * two services end up reading each other's tables. Nothing outside this service
 * may import this file.
 *
 * Connecting is lazy. The process starts even when the database is unreachable,
 * and the readiness probe is what reports the dependency as DOWN, so a database
 * blip cannot be mistaken for a crash loop.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(DATABASE_URL) url: string) {
    if (!url) throw new Error('DATABASE_URL_REQUIRED');
    // The schema must be passed explicitly: the pg driver ignores ?schema=.
    const adapter = new PrismaPg({ connectionString: url }, { schema: databaseSchemaFromUrl(url) });
    this.client = new PrismaClient({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  // Fail closed: an unset URL must stop the service, not silently default to a
  // local database that happens to exist.
  if (!url || url.length === 0) throw new Error('DATABASE_URL_REQUIRED');
  return url;
}
