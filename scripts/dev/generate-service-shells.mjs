#!/usr/bin/env node
/** Service-scoped, non-destructive shell bootstrap; --check verifies runtime invariants. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../acceptance/lib/context.mjs';
import {
  renderServiceFiles,
  generationOptions,
  generationServices,
  writeGeneratedFiles,
  checkGeneratedFiles,
} from './service-template.mjs';

const options = generationOptions(process.argv.slice(2), ROOT);
const catalog = JSON.parse(
  await readFile(path.join(options.root, 'architecture/service-catalog.json'), 'utf8'),
);
const services = generationServices(catalog, options);
const files = new Map();
for (const service of services) {
  const httpRuntime = service.id === 'identity' ? 'identity-security-v1' : 'foundation';
  for (const [relative, expected] of renderServiceFiles(service.id, { httpRuntime })) {
    files.set(`services/${service.id}/${relative}`, expected);
  }
}
if (options.checkOnly) {
  await checkGeneratedFiles(options.root, files, (relative, source) => {
    if (
      relative.endsWith('/src/app.module.ts') &&
      !/export const BUSINESS_READY = false;/.test(source)
    ) {
      throw new Error(`UNREADY_RUNTIME_REQUIRED: ${relative}`);
    }
    if (
      relative.endsWith('/src/app.module.ts') &&
      !source.includes(`export const SERVICE_NAME = '${relative.split('/')[1]}';`)
    ) {
      throw new Error(`SERVICE_RUNTIME_IDENTITY_REQUIRED: ${relative}`);
    }
    if (
      relative.endsWith('/src/infrastructure/persistence/prisma.service.ts') &&
      !/from ['"]\.\.\/\.\.\/generated\/prisma\/client['"]/.test(source)
    ) {
      throw new Error(`OWNER_LOCAL_PRISMA_REQUIRED: ${relative}`);
    }
    if (
      relative === 'services/identity/src/transport/http/create-app.ts' &&
      !source.includes('createIdentityHttpApplication')
    ) {
      throw new Error('IDENTITY_CAPABILITY_ADAPTER_REQUIRED');
    }
  });
  console.log(
    `Service template check passed: ${services.length} service runtime(s), invariants verified; owner evolution preserved.`,
  );
} else {
  const written = await writeGeneratedFiles(options.root, files);
  for (const file of written) console.log(`wrote ${file}`);
  console.log(
    `Scoped shell generation passed: ${services.length} service(s), ${written.length} new file(s); no overwrites.`,
  );
}
