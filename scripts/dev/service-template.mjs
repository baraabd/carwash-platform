/**
 * Deterministic source renderer for a WashGo microservice foundation shell.
 *
 * The renderer is intentionally side-effect free. The writer lives in
 * generate-service-shells.mjs; tests can snapshot this module without touching
 * the repository.
 */

import { lstat, mkdir, writeFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  RUNTIME_IMPLEMENTATIONS,
  selectRuntimeServices,
} from '../../architecture/runtime-lifecycle.mjs';
import { readRegularFile } from '../lib/read-regular-file.mjs';

export const FOUNDATION_RUNTIME_IMPLEMENTATION = RUNTIME_IMPLEMENTATIONS.legacyFoundation;

export function selectFoundationShellServices(catalog) {
  const services = selectRuntimeServices(catalog).map((service) => service.id);

  if (
    services.length === 0 ||
    services.some((service) => typeof service !== 'string' || !/^[a-z][a-z0-9-]*$/.test(service)) ||
    new Set(services).size !== services.length
  ) {
    throw new Error('INVALID_FOUNDATION_SERVICE_SET');
  }

  return services;
}

/** Writing requires an explicit owner scope. Read-only checks may cover all runtimes. */
export function generationOptions(args, fallbackRoot) {
  const options = { root: fallbackRoot, checkOnly: false, ids: [] };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--check') options.checkOnly = true;
    else if (['--root', '--service', '--services'].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`GENERATOR_OPTION_REQUIRED: ${flag}`);
      if (flag === '--root') options.root = path.resolve(value);
      else options.ids.push(...value.split(','));
    } else throw new Error(`UNKNOWN_GENERATOR_OPTION: ${flag}`);
  }
  if (!options.checkOnly && options.ids.length === 0)
    throw new Error('EXPLICIT_SERVICE_SCOPE_REQUIRED');
  if (
    options.ids.some((id) => !/^[a-z][a-z0-9-]*$/.test(id)) ||
    new Set(options.ids).size !== options.ids.length
  )
    throw new Error('INVALID_GENERATOR_SCOPE');
  return options;
}

export function generationServices(catalog, options) {
  selectRuntimeServices(catalog); // Classify every declaration, including unknown states.
  const ids = options.ids.length ? options.ids : selectFoundationShellServices(catalog);
  return ids.map((id) => {
    const service = catalog.services.find((item) => item.id === id);
    if (!service) throw new Error(`UNKNOWN_GENERATOR_SERVICE: ${id}`);
    return service;
  });
}

async function safeTarget(root, relative) {
  const target = path.resolve(root, relative);
  const local = path.relative(root, target);
  if (!local || local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) {
    throw new Error(`UNSAFE_GENERATED_PATH: ${relative}`);
  }
  let current = root;
  for (const segment of local.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`GENERATED_SYMLINK_REFUSED: ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

/**
 * Preflight the entire scope before creating anything. Existing unequal files
 * are owner evolution and are never replaced. Exclusive links publish complete
 * temporary bytes atomically; a race fails closed, and new files are rolled back.
 */
export async function writeGeneratedFiles(root, files) {
  const missing = [];
  for (const [relative, expected] of files) {
    const target = await safeTarget(root, relative);
    try {
      const actual = readRegularFile(target, 4 * 1024 * 1024).toString('utf8');
      if (actual !== expected) throw new Error(`EVOLVED_FILE_OVERWRITE_REFUSED: ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push({ relative, target, expected });
    }
  }
  const created = [];
  try {
    for (const { relative, target, expected } of missing) {
      await mkdir(path.dirname(target), { recursive: true });
      await safeTarget(root, relative);
      const temporary = `${target}.generator-${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, expected, { encoding: 'utf8', flag: 'wx' });
        await link(temporary, target);
        created.push(target);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
  } catch (error) {
    for (const target of created.reverse()) await unlink(target);
    throw error;
  }
  return created.map((target) => path.relative(root, target));
}

/** Evolution is valid during --check; domain/source equality is not a gate. */
export async function checkGeneratedFiles(root, files, validate = () => {}) {
  for (const [relative] of files) {
    const target = await safeTarget(root, relative);
    let source;
    try {
      source = readRegularFile(target, 4 * 1024 * 1024).toString('utf8');
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new Error(`MISSING_GENERATED_FILE: ${relative}`, { cause: error });
      throw error;
    }
    await validate(relative, source);
  }
}

const SPECIAL_SLICES = {
  catalog: {
    imports:
      "import { ProbeService } from './probe/probe.service';\n" +
      "import { PrismaOutboxStore } from './outbox/prisma-outbox.store';\n",
    providers: '    ProbeService,\n    PrismaOutboxStore,\n',
  },
  communications: {
    imports: "import { PrismaInboxStore } from './inbox/prisma-inbox.store';\n",
    providers: '    PrismaInboxStore,\n',
  },
  reporting: {
    imports: "import { PrismaInboxStore } from './inbox/prisma-inbox.store';\n",
    providers: '    PrismaInboxStore,\n',
  },
};

function marker(layer, service) {
  return `/**
 * ${service} ${layer} layer.
 *
 * This marker is generated so the layer exists before business code arrives.
 * Keep business rules in domain/application and framework details outside them.
 */
export {};
`;
}

function prismaService(service) {
  return `import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseSchemaFromUrl, serviceTelemetry } from '@carwash/service-kit';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';

/** Injection token for this service's own connection string. */
export const DATABASE_URL = 'CARWASH_DATABASE_URL';

/**
 * ${service}'s OWN database adapter.
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
    const pool = new Pool({ connectionString: url });
    const telemetry = serviceTelemetry('${service}');
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
`;
}

function prismaCompatibility() {
  return `/**
 * F002 compatibility facade.
 *
 * Persistence moved into the infrastructure layer in F003. Existing acceptance
 * harnesses import this path, so the facade remains until those consumers are
 * migrated in a separately owned change.
 */
export * from './infrastructure/persistence/prisma.service';
`;
}

function appModule(service) {
  const slice = SPECIAL_SLICES[service] ?? { imports: '', providers: '' };
  const providers = slice.providers
    ? `  providers: [
    { provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() },
    PrismaService,
${slice.providers}  ],`
    : `  providers: [{ provide: DATABASE_URL, useFactory: () => databaseUrlFromEnv() }, PrismaService],`;
  return `import { Module } from '@nestjs/common';
import { HealthModule, createLogger, type DependencyProbe } from '@carwash/service-kit';
import {
  DATABASE_URL,
  PrismaService,
  databaseUrlFromEnv,
} from './infrastructure/persistence/prisma.service';
${slice.imports}/**
 * Composition root for the ${service} service.
 *
 * Nest belongs here at the outside edge. Domain/application/ports do not import
 * it. BUSINESS_READY stays false while this is only a foundation shell.
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
  ],
${providers}
  exports: [PrismaService],
})
export class AppModule {}
`;
}

function httpApplication(httpRuntime) {
  if (httpRuntime === 'identity-security-v1') {
    return `import type { INestApplication } from '@nestjs/common';
import { createIdentityHttpApplication } from '../../identity-runtime';

/** Identity owns its opt-in auth composition; other shells remain unchanged. */
export function createHttpApplication(): Promise<INestApplication> {
  return createIdentityHttpApplication();
}
`;
  }
  return `import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';

/** HTTP transport adapter. Business rules never live in this factory. */
export function createHttpApplication(): Promise<INestApplication> {
  return NestFactory.create(AppModule, { logger: false, abortOnError: false });
}
`;
}

function messageConsumer(service) {
  return `import {
  createMessageConsumerAdapter,
  type ApplicationMessageHandler,
  type MessageConsumerAdapter,
} from '@carwash/service-kit';

/**
 * Message transport adapter for ${service}.
 *
 * It delegates to an application handler. Broker ACK/retry/DLQ behavior is not
 * guessed here; the messaging foundation owns those transport semantics.
 */
export function createServiceMessageConsumer<TPayload>(
  handler: ApplicationMessageHandler<TPayload>,
): MessageConsumerAdapter<TPayload> {
  return createMessageConsumerAdapter({ service: '${service}', handler });
}
`;
}

function main(service) {
  return `import 'reflect-metadata';
import { bootstrapService, createLogger } from '@carwash/service-kit';
import { BUSINESS_READY, SERVICE_NAME } from './app.module';
import { createHttpApplication } from './transport/http/create-app';

void bootstrapService({
  service: SERVICE_NAME,
  businessReady: BUSINESS_READY,
  createApplication: createHttpApplication,
}).catch((error: unknown) => {
  createLogger({ service: '${service}' }).error('bootstrap_failed', { error });
  process.exitCode = 1;
});
`;
}

function dockerfile(service) {
  return `# Generated by scripts/dev/generate-service-shells.mjs for ${service}.
# Build from the repository root:
#   docker build -f services/${service}/Dockerfile -t washgo/${service}:dev .
ARG NODE_IMAGE=node:24.21.0-bookworm-slim
ARG RUNTIME_IMAGE=gcr.io/distroless/base-nossl-debian13@sha256:8c563c1fb5e120606f0d85733049775faed6192e2bd2223ef283a5393eec22b9
ARG NATIVE_RUNTIME_IMAGE=gcr.io/distroless/cc-debian13@sha256:54df941ed0d06a1bd95ef5e0ce391fd8d9f94b64782dc9a60062727849ee3f97

FROM \${NODE_IMAGE} AS builder
ARG SERVICE=${service}
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "./packages/*" --sequential run build
RUN pnpm --filter "@carwash/\${SERVICE}" run generate \\
 && pnpm --filter "@carwash/\${SERVICE}" run build
RUN pnpm --filter "@carwash/\${SERVICE}" --prod deploy --legacy /deploy

FROM \${NATIVE_RUNTIME_IMAGE} AS native_libraries

FROM \${RUNTIME_IMAGE} AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
# The distroless base-nossl runtime intentionally omits libstdc++/libgcc.
# Copy Debian 13 ABI libraries with their original package identities and licenses.
# Do not copy the donor OpenSSL libraries or hide copied binaries from scanners.
COPY --from=native_libraries /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so.6
COPY --from=native_libraries /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 /usr/lib/x86_64-linux-gnu/libgcc_s.so.1
COPY --from=native_libraries /var/lib/dpkg/status.d/libstdc++6 /var/lib/dpkg/status.d/libstdc++6
COPY --from=native_libraries /var/lib/dpkg/status.d/libgcc-s1 /var/lib/dpkg/status.d/libgcc-s1
COPY --from=native_libraries /usr/share/doc/libstdc++6 /usr/share/doc/libstdc++6
COPY --from=native_libraries /usr/share/doc/libgcc-s1 /usr/share/doc/libgcc-s1
COPY --from=builder --chown=1000:1000 /deploy /app
USER 1000:1000
ENTRYPOINT []
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \\
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
`;
}

/** The default is the byte-stable F003 shell; capability wiring is explicit. */
export function renderServiceFiles(service, { httpRuntime = 'foundation' } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(service)) throw new Error('INVALID_SERVICE_ID');
  if (
    httpRuntime !== 'foundation' &&
    !(httpRuntime === 'identity-security-v1' && service === 'identity')
  ) {
    throw new Error('INVALID_SERVICE_HTTP_RUNTIME');
  }
  return new Map([
    ['src/domain/index.ts', marker('domain', service)],
    ['src/application/index.ts', marker('application', service)],
    ['src/ports/index.ts', marker('ports', service)],
    ['src/infrastructure/persistence/prisma.service.ts', prismaService(service)],
    ['src/prisma.service.ts', prismaCompatibility()],
    ['src/app.module.ts', appModule(service)],
    ['src/transport/http/create-app.ts', httpApplication(httpRuntime)],
    ['src/transport/messaging/consumer.ts', messageConsumer(service)],
    ['src/main.ts', main(service)],
    ['test/domain/.gitkeep', ''],
    ['test/unit/.gitkeep', ''],
    ['test/integration/.gitkeep', ''],
    ['Dockerfile', dockerfile(service)],
  ]);
}
