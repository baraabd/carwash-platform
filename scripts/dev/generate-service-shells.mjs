#!/usr/bin/env node
/**
 * Writes the common NestJS shell for every service.
 *
 * The ten services share the same technical shape (config -> logger -> Prisma ->
 * health -> bootstrap) and nothing else. Generating that shape keeps it from
 * drifting into ten slightly different bootstraps, while the parts that differ
 * per service (the messaging slice) stay hand-written in the service itself.
 *
 * Generated files are committed and reviewed like any other source.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, SERVICES } from '../acceptance/lib/context.mjs';

const prismaService = (
  service,
) => `import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseSchemaFromUrl } from '@carwash/service-kit';
import { PrismaClient } from './generated/prisma/client';

/** Injection token for this service's own connection string. */
export const DATABASE_URL = 'CARWASH_DATABASE_URL';

/**
 * ${service}'s OWN database client.
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
`;

const appModule = (service, extraImports, extraProviders, extraModuleImports) =>
  `import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import { DATABASE_URL, PrismaService, databaseUrlFromEnv } from './prisma.service';
${extraImports}
/**
 * ${service} service module.
 *
 * businessReady is FALSE: this sprint delivers the runtime foundation, not the
 * ${service} business API. Readiness therefore answers 503 while still reporting
 * the real state of its dependencies. Flipping this to true without an
 * implemented API would be a false readiness claim.
 */
export const SERVICE_NAME = '${service}';
export const BUSINESS_READY = false;

export function postgresProbe(prisma: PrismaService): DependencyProbe {
  return {
    name: 'postgres',
    kind: 'postgres',
    check: async () => {
      await prisma.client.$queryRaw\`SELECT 1\`;
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
${extraModuleImports}  ],
  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
${extraProviders}  ],
  exports: [PrismaService],
})
export class AppModule {}
`;

const main = (service) => `import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger, loadServiceRuntimeConfig, resolveCorrelationId, CORRELATION_HEADER } from '@carwash/service-kit';
import { AppModule, SERVICE_NAME } from './app.module';

/**
 * ${service} bootstrap.
 *
 * Notably absent: any migration call. Schema changes are a separate job run by a
 * separate database identity; replicas that migrate on startup race each other
 * and make rollbacks unpredictable.
 */
async function bootstrap(): Promise<void> {
  const config = loadServiceRuntimeConfig(SERVICE_NAME);
  const logger = createLogger({ service: SERVICE_NAME, level: config.logLevel });

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Correlation propagation: a caller-supplied id is accepted only when it is a
  // well-formed UUID, so an untrusted header can never become a log label.
  app.use((req: { headers: Record<string, unknown> }, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    const correlationId = resolveCorrelationId(req.headers[CORRELATION_HEADER]);
    req.headers[CORRELATION_HEADER] = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    next();
  });

  app.enableShutdownHooks();

  // Loopback unless HOST is set explicitly: exposing a foundation shell on all
  // interfaces is never implicit.
  await app.listen(config.port, config.host);
  logger.info('service_started', { port: config.port, host: config.host, businessReady: false });

  const shutdown = (signal: string): void => {
    logger.info('service_stopping', { signal });
    // Controlled close: in-flight requests finish, then the process exits 0.
    void app
      .close()
      .then(() => {
        logger.info('service_stopped', { signal });
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error('service_stop_failed', { error: error instanceof Error ? error.name : 'UNKNOWN_ERROR' });
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  // Structured, redacted: a DSN in a startup error must not reach the log.
  createLogger({ service: SERVICE_NAME }).error('bootstrap_failed', { error });
  process.exitCode = 1;
});
`;

const SLICE = {
  catalog: {
    imports:
      "import { ProbeService } from './probe/probe.service';\nimport { PrismaOutboxStore } from './outbox/prisma-outbox.store';\n",
    providers: '    ProbeService,\n    PrismaOutboxStore,\n',
    moduleImports: '',
  },
  communications: {
    imports: "import { PrismaInboxStore } from './inbox/prisma-inbox.store';\n",
    providers: '    PrismaInboxStore,\n',
    moduleImports: '',
  },
  reporting: {
    imports: "import { PrismaInboxStore } from './inbox/prisma-inbox.store';\n",
    providers: '    PrismaInboxStore,\n',
    moduleImports: '',
  },
};

for (const service of SERVICES) {
  const dir = path.join(ROOT, 'services', service, 'src');
  await mkdir(dir, { recursive: true });
  const slice = SLICE[service] ?? { imports: '', providers: '', moduleImports: '' };
  await writeFile(path.join(dir, 'prisma.service.ts'), prismaService(service), 'utf8');
  await writeFile(
    path.join(dir, 'app.module.ts'),
    appModule(service, slice.imports, slice.providers, slice.moduleImports),
    'utf8',
  );
  await writeFile(path.join(dir, 'main.ts'), main(service), 'utf8');
  console.log(`wrote services/${service}/src/{prisma.service,app.module,main}.ts`);
}
