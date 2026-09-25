#!/usr/bin/env node
/**
 * F003 clean-architecture guard.
 *
 * This is deliberately stricter on the inward layers than on infrastructure and
 * transport. Domain/application/ports may not pull Nest, Prisma, pg or RabbitMQ
 * inward. Infrastructure may not depend on transport. The composition root may
 * wire both sides and is therefore checked separately.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectFoundationShellServices } from './dev/service-template.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rootArgIndex = process.argv.indexOf('--root');
let ROOT = path.resolve(HERE, '..');
if (rootArgIndex >= 0) {
  const rootArg = process.argv[rootArgIndex + 1];
  if (!rootArg) throw new Error('--root requires a path');
  ROOT = path.resolve(rootArg);
}

const catalog = JSON.parse(
  await readFile(path.join(ROOT, 'architecture/service-catalog.json'), 'utf8'),
);
const services = selectFoundationShellServices(catalog);
const LAYERS = ['domain', 'application', 'ports', 'infrastructure', 'transport'];
const FRAMEWORK_OR_IO = [
  /^@nestjs(?:\/|$)/,
  /^@prisma(?:\/|$)/,
  /^prisma(?:\/|$)/,
  /^amqplib(?:\/|$)/,
  /^pg(?:\/|$)/,
];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-tests', 'generated'].includes(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(target)));
    else if (/\.(?:ts|mts|js|mjs)$/.test(entry.name)) out.push(target);
  }
  return out;
}

function importSpecifiers(source) {
  return [
    ...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s*)['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
}

function targetLayer(file, specifier, serviceRoot) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(file), specifier);
  const relative = path.relative(path.join(serviceRoot, 'src'), resolved).replaceAll('\\', '/');
  const layer = LAYERS.find(
    (candidate) => relative === candidate || relative.startsWith(`${candidate}/`),
  );
  return layer ?? null;
}

function forbidExternal(layer, specifier, relativeFile) {
  if (FRAMEWORK_OR_IO.some((pattern) => pattern.test(specifier))) {
    throw new Error(`${layer} layer imports framework/IO dependency ${specifier}: ${relativeFile}`);
  }
}

let checkedFiles = 0;
for (const service of services) {
  const serviceRoot = path.join(ROOT, 'services', service);
  for (const layer of LAYERS) {
    const layerDir = path.join(serviceRoot, 'src', layer);
    if (!(await exists(layerDir))) {
      throw new Error(`${service} is missing required layer: src/${layer}`);
    }
    for (const file of await walk(layerDir)) {
      checkedFiles += 1;
      const relativeFile = path.relative(ROOT, file);
      const source = await readFile(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        const target = targetLayer(file, specifier, serviceRoot);
        if (layer === 'domain') {
          forbidExternal(layer, specifier, relativeFile);
          if (target && target !== 'domain') {
            throw new Error(`domain layer imports outward layer ${target}: ${relativeFile}`);
          }
        } else if (layer === 'application') {
          forbidExternal(layer, specifier, relativeFile);
          if (target === 'infrastructure' || target === 'transport') {
            throw new Error(`application layer imports outward layer ${target}: ${relativeFile}`);
          }
        } else if (layer === 'ports') {
          forbidExternal(layer, specifier, relativeFile);
          if (target === 'infrastructure' || target === 'transport') {
            throw new Error(`ports layer imports outward layer ${target}: ${relativeFile}`);
          }
        } else if (layer === 'infrastructure' && target === 'transport') {
          throw new Error(`infrastructure layer imports transport: ${relativeFile}`);
        }
      }
    }
  }

  const modulePath = path.join(serviceRoot, 'src/app.module.ts');
  const moduleSource = await readFile(modulePath, 'utf8');
  if (!/export const BUSINESS_READY = false;/.test(moduleSource)) {
    throw new Error(`${service} foundation shell must declare BUSINESS_READY = false`);
  }

  for (const testLayer of ['domain', 'unit', 'integration']) {
    const testDir = path.join(serviceRoot, 'test', testLayer);
    if (!(await exists(testDir))) {
      throw new Error(`${service} is missing required test layout: test/${testLayer}`);
    }
  }
  const testFiles = await readdir(path.join(serviceRoot, 'test'));
  if (!testFiles.some((file) => file.endsWith('.nest.spec.ts'))) {
    throw new Error(`${service} is missing its Nest framework spec`);
  }

  const dockerPath = path.join(serviceRoot, 'Dockerfile');
  if (!(await exists(dockerPath))) {
    throw new Error(`${service} is missing its generated Dockerfile`);
  }
  const docker = await readFile(dockerPath, 'utf8');
  const fromCount = [...docker.matchAll(/^FROM\s+/gm)].length;
  if (fromCount < 2 || !/^USER node$/m.test(docker) || !/--frozen-lockfile/.test(docker)) {
    throw new Error(`${service} Dockerfile must be multi-stage, frozen-install and non-root`);
  }
}

console.log(
  `Layer guard passed: ${services.length} service(s), ${checkedFiles} layered source file(s).`,
);
