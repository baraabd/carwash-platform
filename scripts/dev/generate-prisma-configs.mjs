#!/usr/bin/env node
/**
 * Writes each service's prisma.config.ts.
 *
 * Kept as a script so the ten configs cannot drift apart, and so the rule they
 * all encode stays in one place: the connection URL comes from the environment,
 * never from a committed file, because the MIGRATION identity and the RUNTIME
 * identity are different database accounts running in different jobs.
 */
import { readFile } from 'node:fs/promises';
import {
  generationOptions,
  generationServices,
  writeGeneratedFiles,
  checkGeneratedFiles,
} from './service-template.mjs';
import path from 'node:path';
import { ROOT } from '../acceptance/lib/context.mjs';

const template = (service) => `import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma configuration for the ${service} service.
 *
 * DATABASE_URL is supplied by whoever is running the command and decides the
 * identity that is used:
 *   - migration jobs run as cw_${service}_migrate (may change the schema),
 *   - application replicas run as cw_${service}_app (DML only, no DDL).
 *
 * Nothing here ever runs a migration on application startup.
 */
function datasourceUrl(): string {
  // Empty is tolerated so that \`prisma generate\` (which needs no database) can
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
`;

const options = generationOptions(process.argv.slice(2), ROOT);
const catalog = JSON.parse(
  await readFile(path.join(options.root, 'architecture/service-catalog.json'), 'utf8'),
);
const files = new Map(
  generationServices(catalog, options).map((service) => [
    `services/${service.id}/prisma.config.ts`,
    template(service.id),
  ]),
);
if (options.checkOnly) {
  await checkGeneratedFiles(options.root, files, (file, source) => {
    if (!source.includes('process.env.DATABASE_URL') || /postgres(?:ql)?:\/\//.test(source)) {
      throw new Error(`ENVIRONMENT_DATABASE_IDENTITY_REQUIRED: ${file}`);
    }
  });
  console.log(`Prisma configuration check passed: ${files.size} service(s).`);
} else {
  for (const file of await writeGeneratedFiles(options.root, files)) console.log(`wrote ${file}`);
}
