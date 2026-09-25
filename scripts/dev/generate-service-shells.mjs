#!/usr/bin/env node
/**
 * Materialises the deterministic F003 shell for every declared service.
 *
 * Only template-owned files are written. Existing business/domain files and the
 * F002 messaging slice are preserved. --check is read-only and fails on drift.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../acceptance/lib/context.mjs';
import {
  renderServiceFiles,
  selectFoundationShellServices,
} from './service-template.mjs';

const checkOnly = process.argv.includes('--check');
const drift = [];
const catalog = JSON.parse(
  await readFile(path.join(ROOT, 'architecture/service-catalog.json'), 'utf8'),
);
const services = selectFoundationShellServices(catalog);

for (const service of services) {
  const root = path.join(ROOT, 'services', service);
  for (const [relative, expected] of renderServiceFiles(service)) {
    const target = path.join(root, relative);
    if (checkOnly) {
      let actual;
      try {
        actual = await readFile(target, 'utf8');
      } catch {
        drift.push(`missing ${path.relative(ROOT, target)}`);
        continue;
      }
      if (actual !== expected) drift.push(`drift ${path.relative(ROOT, target)}`);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, expected, 'utf8');
    console.log(`wrote ${path.relative(ROOT, target)}`);
  }
}

if (checkOnly) {
  if (drift.length > 0) {
    console.error('SERVICE_TEMPLATE_DRIFT');
    for (const item of drift) console.error(`  ${item}`);
    process.exit(1);
  }
  console.log(`Service template check passed: ${services.length} service shell(s), no drift.`);
}
