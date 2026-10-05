import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  RUNTIME_IMPLEMENTATIONS as states,
  classifyServiceRuntime,
  classifyWebRuntime,
  selectRuntimeServices,
} from '../../../architecture/runtime-lifecycle.mjs';
import {
  renderServiceFiles,
  writeGeneratedFiles,
  generationOptions,
} from '../../../scripts/dev/service-template.mjs';
import { ROOT, REQUIRED_JOBS, inventory, runtimeEnvironment } from '../../../scripts/ci/policy.mjs';

const service = (id, runtimeImplementation = states.foundation, extra = {}) => ({
  id,
  path: `services/${id}`,
  packageName: `@carwash/${id}`,
  database: `cw_${id}`,
  runtimeRole: `cw_${id}_app`,
  migrationRole: `cw_${id}_migrate`,
  runtimeImplementation,
  ...extra,
});
const gateway = {
  id: 'gateway',
  path: 'apps/api-gateway',
  packageName: '@carwash/api-gateway',
  database: null,
  runtimeImplementation: states.capability,
  acceptedCapabilities: ['gateway-routing-v1'],
};
async function fixture(t, services = [service('vehicle')], apps = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'cw-w01-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'architecture'), { recursive: true });
  await writeFile(
    path.join(root, 'architecture/service-catalog.json'),
    JSON.stringify({ services, gateway, apps }),
  );
  for (const target of [
    ...services.filter((item) => classifyServiceRuntime(item).runtime),
    gateway,
    ...apps.filter((app) => classifyWebRuntime(app).runtime),
  ]) {
    await mkdir(path.join(root, target.path), { recursive: true });
    await writeFile(path.join(root, target.path, 'Dockerfile'), '# reviewed image fixture\n');
  }
  return root;
}
const run = (script, root, ...args) => {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), '--root', root, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

for (const state of [states.legacyFoundation, states.foundation]) {
  test(`${state}: runtime onboarding preserves empty business readiness`, () => {
    const actual = classifyServiceRuntime(service('vehicle', state));
    assert.equal(actual.runtime, true);
    assert.equal(actual.foundation, true);
    assert.equal(actual.businessReady, false);
    assert.deepEqual(actual.capabilities, []);
    const files = renderServiceFiles('vehicle');
    assert.match(files.get('src/app.module.ts'), /BUSINESS_READY = false/);
    assert.match(files.get('src/main.ts'), /businessReady: BUSINESS_READY/);
  });
}
test('a reserved skeleton has no runtime and is excluded from acceptance targets', async (t) => {
  const skeleton = service('geo', states.skeleton);
  assert.equal(classifyServiceRuntime(skeleton).runtime, false);
  const root = await fixture(t, [service('vehicle'), skeleton]);
  assert.deepEqual(inventory(root).plannedServices, ['geo']);
  assert.deepEqual(
    inventory(root).targets.map(({ id }) => id),
    ['vehicle', 'gateway'],
  );
  await mkdir(path.join(root, 'services/geo/prisma'), { recursive: true });
  await writeFile(
    path.join(root, 'services/geo/prisma/schema.prisma'),
    'model Business { id String @id }',
  );
  assert.throws(() => inventory(root), /Unclassified database owner/);
});
test('implemented Identity is a bounded capability and retains fail-closed shell readiness', () => {
  const identity = service('identity', states.capability, {
    acceptedCapabilities: ['identity-security-v1'],
  });
  const actual = classifyServiceRuntime(identity);
  assert.deepEqual(actual.capabilities, ['identity-security-v1']);
  assert.equal(actual.runtime, true);
  assert.equal(actual.foundation, false);
  assert.equal(actual.businessReady, false);
  const http = renderServiceFiles('identity', { httpRuntime: 'identity-security-v1' }).get(
    'src/transport/http/create-app.ts',
  );
  assert.match(http, /createIdentityHttpApplication/);
  assert.throws(
    () => classifyServiceRuntime(service('identity', states.capability)),
    /CAPABILITY_LIFECYCLE_MISMATCH/,
  );
  assert.throws(
    () =>
      classifyServiceRuntime(
        service('vehicle', states.capability, { acceptedCapabilities: ['identity-security-v1'] }),
      ),
    /UNCLASSIFIED_RUNTIME_CAPABILITY/,
  );
  assert.throws(
    () =>
      classifyServiceRuntime(
        service('identity', states.capability, { acceptedCapabilities: ['unknown-v1'] }),
      ),
    /UNCLASSIFIED_RUNTIME_CAPABILITY/,
  );
  assert.throws(
    () =>
      classifyServiceRuntime(
        service('identity', states.legacyFoundation, {
          acceptedCapabilities: ['identity-security-v1'],
        }),
      ),
    /CAPABILITY_LIFECYCLE_MISMATCH/,
  );
});
test('unknown runtime states and duplicate service identities fail closed', () => {
  assert.throws(
    () => classifyServiceRuntime(service('vehicle', 'production-ready')),
    /Unclassified runtime state/,
  );
  assert.throws(
    () => selectRuntimeServices({ services: [service('vehicle'), service('vehicle')] }),
    /DUPLICATE_RUNTIME_SERVICE/,
  );
});
test('new empty web artifacts are accepted separately without gateway or database credentials', async (t) => {
  const app = {
    id: 'operator-web',
    path: 'apps/operator-web',
    packageName: '@carwash/operator-web',
    runtimeLifecycle: 'onboarded-foundation-web-runtime',
  };
  const root = await fixture(t, [service('vehicle')], [app]);
  const target = inventory(root).targets.find((item) => item.id === app.id);
  assert.equal(target.kind, 'web-app');
  assert.equal(target.database, null);
  assert.equal(classifyWebRuntime(app).businessReady, false);
  assert.ok(
    !runtimeEnvironment(target).some((value) => /(?:DATABASE_URL|GATEWAY_UPSTREAMS)=/.test(value)),
  );
  assert.throws(
    () => classifyWebRuntime({ ...app, runtimeLifecycle: 'ready' }),
    /Unclassified app runtime state/,
  );
});
for (const unclassified of [
  'services/unregistered/Dockerfile',
  'services/vehicle/Dockerfile.dev',
  'apps/extra/Dockerfile',
  'apps/operator-web/Dockerfile',
]) {
  test(`unknown image is rejected: ${unclassified}`, async (t) => {
    const root = await fixture(t);
    await mkdir(path.dirname(path.join(root, unclassified)), { recursive: true });
    await writeFile(path.join(root, unclassified), '# unknown\n');
    assert.throws(() => inventory(root), /Unclassified runtime image/);
  });
}
test('image context sidecars are not mistaken for images, and do not allow another Dockerfile', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'services/vehicle/Dockerfile.dockerignore'), '**\n');
  assert.equal(inventory(root).targets.length, 2);
  await writeFile(path.join(root, 'services/vehicle/Dockerfile.alternative'), '# unreviewed\n');
  assert.throws(() => inventory(root), /Unclassified runtime image/);
});

for (const artifact of ['src/main.ts', 'prisma/schema.prisma']) {
  test(`an undeclared runtime or database cannot bypass classification without an image: ${artifact}`, async (t) => {
    const root = await fixture(t);
    const file = path.join(root, 'services/unregistered', artifact);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'unclassified owner\n');
    assert.throws(() => inventory(root), /Unclassified runtime or database owner/);
  });
}
test('a symlink cannot conceal an unclassified artifact tree', async (t) => {
  const root = await fixture(t);
  const tree = path.join(root, 'hidden-runtime');
  await mkdir(tree);
  await writeFile(path.join(tree, 'Dockerfile'), '# concealed image\n');
  await symlink(tree, path.join(root, 'services/concealed'));
  assert.throws(() => inventory(root), /Unclassified runtime artifact symlink/);
});

test('scoped generation refuses any evolved file before writing another missing file', async (t) => {
  const root = await fixture(t, [
    service('vehicle', states.skeleton),
    service('geo', states.skeleton),
  ]);
  const evolved = 'model Vehicle { id String @id }\n';
  await mkdir(path.join(root, 'services/geo/prisma'), { recursive: true });
  await writeFile(path.join(root, 'services/geo/prisma/schema.prisma'), evolved);
  const result = run('scripts/dev/generate-service-schemas.mjs', root, '--services', 'vehicle,geo');
  assert.notEqual(result.code, 0);
  assert.match(result.output, /EVOLVED_FILE_OVERWRITE_REFUSED/);
  assert.equal(existsSync(path.join(root, 'services/vehicle/prisma/schema.prisma')), false);
  assert.equal(
    await readFile(path.join(root, 'services/geo/prisma/schema.prisma'), 'utf8'),
    evolved,
  );
});
for (const script of [
  'generate-service-shells.mjs',
  'generate-service-schemas.mjs',
  'generate-nest-tests.mjs',
  'generate-prisma-configs.mjs',
]) {
  test(`${script} requires explicit service scope for writes`, async (t) => {
    const root = await fixture(t, [service('vehicle', states.skeleton)]);
    const result = run(`scripts/dev/${script}`, root);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /EXPLICIT_SERVICE_SCOPE_REQUIRED/);
    assert.equal(existsSync(path.join(root, 'services/vehicle/prisma/schema.prisma')), false);
  });
}
test('schema bootstrap creates only the selected owner, and repeat generation changes no bytes', async (t) => {
  const root = await fixture(t, [
    service('vehicle', states.skeleton),
    service('geo', states.skeleton),
  ]);
  const args = ['--service', 'vehicle'];
  assert.equal(run('scripts/dev/generate-service-schemas.mjs', root, ...args).code, 0);
  const file = path.join(root, 'services/vehicle/prisma/schema.prisma');
  const initial = await readFile(file, 'utf8');
  assert.equal(existsSync(path.join(root, 'services/geo/prisma/schema.prisma')), false);
  assert.equal(run('scripts/dev/generate-service-schemas.mjs', root, ...args).code, 0);
  assert.equal(await readFile(file, 'utf8'), initial);
  assert.deepEqual(await readdir(path.dirname(file)), ['schema.prisma']);
});
test('schema --check accepts owner business evolution and rejects embedded connection URLs', async (t) => {
  const root = await fixture(t, [service('vehicle', states.skeleton)]);
  assert.equal(
    run('scripts/dev/generate-service-schemas.mjs', root, '--service', 'vehicle').code,
    0,
  );
  const file = path.join(root, 'services/vehicle/prisma/schema.prisma');
  const initial = await readFile(file, 'utf8');
  await writeFile(file, initial + '\nmodel Vehicle {\n  id String @id\n}\n');
  assert.equal(
    run('scripts/dev/generate-service-schemas.mjs', root, '--service', 'vehicle', '--check').code,
    0,
  );
  await writeFile(
    file,
    initial.replace(
      'provider = "postgresql"',
      'provider = "postgresql"\n  url = "postgresql://private.invalid"',
    ),
  );
  const bad = run(
    'scripts/dev/generate-service-schemas.mjs',
    root,
    '--service',
    'vehicle',
    '--check',
  );
  assert.notEqual(bad.code, 0);
  assert.match(bad.output, /OWNER_LOCAL_SCHEMA_REQUIRED/);
});
test('shell --check accepts owner code evolution while preserving service identity and 503 declaration', async (t) => {
  const root = await fixture(t, [service('vehicle')]);
  await rm(path.join(root, 'services/vehicle/Dockerfile'));
  const files = new Map(
    [...renderServiceFiles('vehicle')].map(([file, body]) => [`services/vehicle/${file}`, body]),
  );
  await writeGeneratedFiles(root, files);
  await writeFile(
    path.join(root, 'services/vehicle/src/domain/index.ts'),
    'export const ownedBusinessRule = 1;\n',
  );
  const good = run('scripts/dev/generate-service-shells.mjs', root, '--check');
  assert.equal(good.code, 0, good.output);
  const module = path.join(root, 'services/vehicle/src/app.module.ts');
  const source = await readFile(module, 'utf8');
  await writeFile(module, source.replace('BUSINESS_READY = false', 'BUSINESS_READY = true'));
  const bad = run('scripts/dev/generate-service-shells.mjs', root, '--check');
  assert.notEqual(bad.code, 0);
  assert.match(bad.output, /UNREADY_RUNTIME_REQUIRED/);
});
test('generator rejects symlink outputs and never writes through them', async (t) => {
  const root = await fixture(t, [service('vehicle', states.skeleton)]);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await mkdir(path.join(root, 'services/vehicle'), { recursive: true });
  await symlink(outside, path.join(root, 'services/vehicle/prisma'));
  await assert.rejects(
    writeGeneratedFiles(root, new Map([['services/vehicle/prisma/schema.prisma', 'new content']])),
    /GENERATED_SYMLINK_REFUSED/,
  );
  assert.deepEqual(await readdir(outside), []);
});
test('all original required aggregate jobs remain mandatory after onboarding', () => {
  assert.deepEqual(REQUIRED_JOBS, [
    'plan',
    'targeted',
    'static',
    'integration',
    'images',
    'security',
    'codeql',
  ]);
});
test('invalid or duplicate generation scopes and unknown flags are rejected', () => {
  for (const args of [
    ['--service', '../escape'],
    ['--services', 'vehicle,vehicle'],
    ['--all'],
    ['--service'],
  ]) {
    assert.throws(() => generationOptions(args, ROOT));
  }
});
