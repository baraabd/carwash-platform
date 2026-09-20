import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma configuration for the support service.
 *
 * DATABASE_URL is supplied by whoever is running the command and decides the
 * identity that is used:
 *   - migration jobs run as cw_support_migrate (may change the schema),
 *   - application replicas run as cw_support_app (DML only, no DDL).
 *
 * Nothing here ever runs a migration on application startup.
 */
function datasourceUrl(): string {
  // Empty is tolerated so that `prisma generate` (which needs no database) can
  // run in a build container. Every command that does touch a database fails
  // loudly instead of silently connecting somewhere unintended.
  return process.env.DATABASE_URL ?? '';
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  datasource: {
    url: datasourceUrl(),
    // Only ever set while AUTHORING a migration on a developer database. The
    // migration role deliberately lacks CREATEDB, so it can never create one.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? undefined,
  },
  adapter: async () => new PrismaPg({ connectionString: datasourceUrl() }),
});
