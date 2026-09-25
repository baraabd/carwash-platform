import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogDefinitions } from '../../dist/ownership/catalog.mjs';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const schema = JSON.parse(
  readFileSync(path.join(sourceRoot, 'architecture/service-catalog.schema.json'), 'utf8'),
);
export const catalog = JSON.parse(
  readFileSync(path.join(sourceRoot, 'architecture/service-catalog.json'), 'utf8'),
);
export function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'washgo-F001-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, value) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  const change = (file, edit) => {
    const value = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    edit(value);
    put(file, value);
  };
  put('package.json', { name: 'carwash-platform', version: '0.0.1', type: 'module', private: true });
  put('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'services/*'\n  - 'packages/*'\n");
  put('architecture/service-catalog.json', catalog);
  put('architecture/service-catalog.schema.json', schema);
  for (const entry of catalogDefinitions(catalog)) {
    // Explicitly synthetic framework fixtures, not copies of production services.
    put(`${entry.path}/package.json`, {
      name: entry.packageName,
      version: entry.version ?? '0.0.1',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts' },
    });
    put(`${entry.path}/src/index.ts`, 'export {};\n');
  }
  const rows = catalogDefinitions(catalog).map((entry) => ({
    name: entry.packageName,
    path: path.join(root, entry.path),
    private: true,
    version: entry.version ?? '0.0.1',
  }));
  return { root, put, change, rows };
}
