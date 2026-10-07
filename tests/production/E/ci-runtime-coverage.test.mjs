// Guards that CI covers every deployable runtime and every app, so a new
// service or app cannot silently skip its build/boot gate.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const catalog = JSON.parse(read('architecture/service-catalog.json'));
const workflow = read('.github/workflows/sprint-02-ci.yml');
const pkg = JSON.parse(read('package.json'));

test('the image matrix boots exactly the catalog owner runtimes', () => {
  const match = /\n {8}service: \[([^\]]+)\]/.exec(workflow);
  assert.ok(match, 'images job must declare a service matrix');
  const matrix = match[1].split(',').map((s) => s.trim());
  const services = catalog.services.map((s) => s.id);
  assert.equal(services.length, 19);
  // identity needs Redis + key material to boot; it is excluded by name, never silently.
  const excluded = ['identity'];
  assert.deepEqual([...matrix].sort(), services.filter((id) => !excluded.includes(id)).sort());
  assert.match(workflow, /run: node scripts\/check-images\.mjs \$\{\{ matrix\.service \}\}/);
  assert.match(workflow, /fail-fast: false/);
  for (const id of services)
    assert.ok(existsSync(path.join(root, 'services', id, 'package.json')), id);
});

test('root build and typecheck cover all three web apps', () => {
  const apps = readdirSync(path.join(root, 'apps')).filter((d) => d.endsWith('-web'));
  assert.deepEqual(apps.sort(), ['admin-web', 'customer-web', 'operator-web']);
  for (const app of apps) {
    const scripts = JSON.parse(read(`apps/${app}/package.json`)).scripts;
    assert.match(scripts.build, /tsc -p tsconfig\.json --noEmit && vite build/, app);
    assert.match(scripts.typecheck, /tsc -p tsconfig\.json --noEmit/, app);
  }
  assert.match(pkg.scripts.build, /pnpm run build:apps$/);
  assert.match(pkg.scripts.typecheck, /pnpm run typecheck:apps$/);
  assert.equal(pkg.scripts['build:apps'], 'pnpm --filter "./apps/*-web" --sequential run build');
  assert.equal(
    pkg.scripts['typecheck:apps'],
    'pnpm --filter "./apps/*-web" --sequential run typecheck',
  );
  // The static job runs the root scripts, so the apps are gated on every PR.
  assert.match(workflow, /- name: Typecheck\n\s+run: pnpm typecheck\n/);
  assert.match(workflow, /- name: Build\n\s+run: pnpm build\n/);
});

test('Lane E production tests run in the static CI job', () => {
  assert.match(workflow, /pnpm test:production:e/);
  assert.equal(
    pkg.scripts['test:production:e'],
    'node --test --test-reporter=spec "tests/production/E/*.test.mjs"',
  );
});
