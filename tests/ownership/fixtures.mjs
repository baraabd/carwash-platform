import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Every test owns a fresh temporary tree; no user checkout is ever modified. */
export function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'washgo-ownership-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  const change = (name, edit) => {
    const value = JSON.parse(readFileSync(path.join(root, name), 'utf8'));
    edit(value);
    put(name, value);
  };
  put('package.json', { name: 'carwash-platform', private: true, type: 'module' });
  put('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'services/*'\n  - 'packages/*'\n");
  put('architecture/service-catalog.json', {
    schemaVersion: 1,
    publicIngress: 'api-gateway',
    services: ['booking', 'billing'].map((id) => ({
      id,
      database: `cw_${id}`,
      runtimeRole: `cw_${id}_app`,
      migrationRole: `cw_${id}_migrate`,
      owns: [`${id}_records`],
    })),
  });
  const addPackage = (dir, dependencies = {}) => {
    const id = path.basename(dir);
    put(`${dir}/package.json`, {
      name: `@carwash/${id}`,
      version: '0.0.1',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts', './events': './src/events.ts', './blocked': null },
      dependencies,
    });
    put(`${dir}/src/index.ts`, `export const fixtureName = '${id}';\n`);
    put(`${dir}/src/events.ts`, 'export interface Event { readonly id: string }\n');
  };
  for (const id of ['booking', 'billing'])
    addPackage(`services/${id}`, { '@carwash/event-contracts': 'workspace:0.0.1' });
  for (const id of ['customer-web', 'operator-web', 'admin-web'])
    addPackage(`apps/${id}`, {
      '@carwash/event-contracts': 'workspace:0.0.1',
      '@carwash/ui': 'workspace:0.0.1',
    });
  addPackage('apps/api-gateway', { '@carwash/event-contracts': 'workspace:0.0.1' });
  for (const id of ['event-contracts', 'ui', 'observability', 'test-utils', 'eslint-config'])
    addPackage(`packages/${id}`);
  return { root, put, change, addPackage };
}
export function treeDigest(root) {
  const hash = createHash('sha256');
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        hash.update(path.relative(root, file));
        hash.update(readFileSync(file));
      }
    }
  };
  visit(root);
  return hash.digest('hex');
}
