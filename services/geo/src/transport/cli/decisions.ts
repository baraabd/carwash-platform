import { databaseSchemaFromUrl } from '@carwash/service-kit';
import { ServiceabilityApplication } from '../../application';
import { DEFAULT_DECISION_TTL_MS } from '../../domain';
import { UnconfiguredIdentityAuthorizer } from '../../infrastructure/identity/http-identity-authorizer';
import { PrismaGeoStore } from '../../infrastructure/persistence/prisma-geo.store';
import { PrismaService, databaseUrlFromEnv } from '../../infrastructure/persistence/prisma.service';
import { randomIds, systemClock } from '../../infrastructure/system/system';

/**
 * Retention job for serviceability decisions (they hold a precise point).
 *
 *   node dist/transport/cli/decisions.js purge
 *
 * Deletes decisions whose expiry is older than the retention window, in
 * bounded batches, with the service RUNTIME identity (DATABASE_URL). Prints
 * one JSON line with the count; never prints a decision or a coordinate.
 * Intended to run on a schedule (e.g. hourly); safe to run concurrently.
 */
async function main(argv: readonly string[]): Promise<number> {
  if (argv.length !== 1 || argv[0] !== 'purge') throw new Error('USAGE: decisions.js purge');
  const url = databaseUrlFromEnv();
  const prisma = new PrismaService(url);
  try {
    const app = new ServiceabilityApplication(
      new PrismaGeoStore(prisma.client, databaseSchemaFromUrl(url)),
      // The purge never authorizes a principal.
      new UnconfiguredIdentityAuthorizer(),
      systemClock,
      randomIds,
      { decisionTtlMs: DEFAULT_DECISION_TTL_MS },
    );
    const purged = await app.purgeExpiredDecisions();
    console.log(JSON.stringify({ outcome: 'purged', count: purged }));
    return 0;
  } finally {
    await prisma.onModuleDestroy();
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      error instanceof Error && error.message.startsWith('USAGE')
        ? error.message
        : 'DECISIONS_COMMAND_FAILED',
    );
    process.exitCode = 2;
  },
);
