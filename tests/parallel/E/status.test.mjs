import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  deriveServiceStatuses,
  persistenceModels,
  runAdversarialSelfTest,
  runtimeInventory,
  validateImplementationStatus,
} from '../../../architecture/implementation-status.mjs';
import { validateSchema } from '../../../scripts/ownership/schema.mts';
import {
  appDsn,
  BROKER_SERVICES,
  createRunContext,
  IMAGES,
  migrationDsn,
  runtimeDatabaseServices,
  SERVICES,
} from '../../../scripts/acceptance/lib/context.mjs';
import {
  allocateEnvironment,
  releaseEnvironment,
  validateActiveAllocation,
} from '../../../scripts/parallel/E/allocate-environment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
const catalog = await readJson('architecture/service-catalog.json');
const status = await readJson('architecture/implementation-status.json');
const schema = await readJson('architecture/implementation-status.schema.json');

test('source inventory recognizes all nineteen runtimes and keeps product acceptance separate', () => {
  const result = validateImplementationStatus(status, catalog);
  assert.deepEqual(runtimeInventory(catalog), {
    services: 19,
    runtimeServices: 19,
    foundationShells: 18,
    legacyFoundationShells: 9,
    onboardedFoundationShells: 9,
    capabilityRuntimes: 1,
    skeletons: 0,
  });
  assert.equal(result.productionReady, false);
  assert.equal(result.currentCandidateAcceptance, 'not-verified-on-current-candidate');
  assert.deepEqual(status.services.find((owner) => owner.id === 'identity').acceptedCapabilities, [
    'identity-security-v1',
  ]);
  assert.equal(
    status.applications['customer-web'].status,
    'react-session-demo-partially-implemented',
  );
  assert.equal(status.applications['operator-web'].status, 'technical-boot-shell-only');
  assert.equal(status.applications['admin-web'].status, 'technical-boot-shell-only');
});

test('unknown catalog lifecycles fail closed even before count/model comparison', () => {
  const unknown = globalThis.structuredClone(catalog);
  unknown.services.find((owner) => owner.id === 'vehicle').runtimeImplementation =
    'runtime-someday';
  assert.throws(() => deriveServiceStatuses(unknown), /Unclassified runtime state/);
  assert.throws(() => runtimeDatabaseServices(unknown), /Unclassified runtime state/);
  assert.throws(() => validateImplementationStatus(status, unknown), /Unclassified runtime state/);
  const duplicate = globalThis.structuredClone(catalog);
  duplicate.services[1] = globalThis.structuredClone(duplicate.services[0]);
  assert.throws(() => runtimeInventory(duplicate), /DUPLICATE_RUNTIME_SERVICE/);
});

test('historical verification cannot certify current onboarding or stale application claims', () => {
  assert.equal(
    status.verificationRecords['foundation-2026-10-01'].sourceSha,
    'f364792d78cf572444df8093c2e4c6315becdae9',
  );
  assert.equal(
    status.verificationRecords['foundation-2026-10-01'].appliesToCurrentCandidate,
    false,
  );
  assert.equal(runAdversarialSelfTest(status, catalog).length, 9);
  const falseDeployment = globalThis.structuredClone(catalog);
  falseDeployment.services[0].deployment.verified = true;
  const matchingOverclaim = globalThis.structuredClone(status);
  matchingOverclaim.services = deriveServiceStatuses(falseDeployment);
  assert.throws(() => validateImplementationStatus(matchingOverclaim, falseDeployment));
});

test('JSON schema accepts the fresh inventory and rejects stale and overclaimed records', () => {
  assert.deepEqual(validateSchema(schema, status), []);
  const stale = globalThis.structuredClone(status);
  stale.schemaVersion = 1;
  stale.services.find((owner) => owner.id === 'vehicle').runtimeImplementation = 'runtime-someday';
  assert.ok(validateSchema(schema, stale).length >= 2);
  const overclaim = globalThis.structuredClone(status);
  overclaim.currentCandidateAcceptance = 'verified';
  assert.ok(validateSchema(schema, overclaim).length > 0);
});

test('model inventory reads owner schemas and detects drift without generator/schema-mirror coupling', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'carwash-status-models-'));
  try {
    for (const owner of catalog.services) {
      const relative = path.join(owner.path, 'prisma/schema.prisma');
      if (!existsSync(path.join(ROOT, relative))) continue;
      await mkdir(path.dirname(path.join(fixture, relative)), { recursive: true });
      await writeFile(path.join(fixture, relative), await readFile(path.join(ROOT, relative)));
    }
    const fixtureStatus = globalThis.structuredClone(status);
    fixtureStatus.services = deriveServiceStatuses(catalog, { root: fixture });
    validateImplementationStatus(fixtureStatus, catalog, { persistenceRoot: fixture });
    const customerSchema = path.join(fixture, 'services/customer/prisma/schema.prisma');
    await writeFile(
      customerSchema,
      `${await readFile(customerSchema, 'utf8')}\n` +
        '/* model CommentOnly { bogus String } */\n' +
        '// model AnotherComment { bogus String }\n' +
        'model NewOwnedProfile {\n  id String @id\n}\n',
    );
    assert.deepEqual(persistenceModels('services/customer', fixture), [
      'ServiceMarker',
      'NewOwnedProfile',
    ]);
    assert.throws(
      () => validateImplementationStatus(fixtureStatus, catalog, { persistenceRoot: fixture }),
      /Service source inventory drift/,
    );
    fixtureStatus.services = deriveServiceStatuses(catalog, { root: fixture });
    validateImplementationStatus(fixtureStatus, catalog, { persistenceRoot: fixture });
    assert.equal(fixtureStatus.currentCandidateAcceptance, 'not-verified-on-current-candidate');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('acceptance selectors include new runtime DB owners while broker slice and toolchain pins stay exact', () => {
  assert.deepEqual(
    SERVICES,
    catalog.services.map((owner) => owner.id),
  );
  assert.equal(SERVICES.length, 19);
  assert.deepEqual(BROKER_SERVICES, ['catalog', 'communications', 'reporting']);
  assert.equal(IMAGES.node, 'node:24.21.0-bookworm-slim');
});

test('acceptance context consumes an active lane allocation without releasing peers or inventing DB provisioning', async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'carwash-context-allocation-'));
  const own = await allocateEnvironment({ stateRoot, lane: 'E', wave: 'W01', run: 'status-wire' });
  const peer = await allocateEnvironment({ stateRoot, lane: 'A', wave: 'W01', run: 'status-peer' });
  const previous = process.env.CW_PARALLEL_ALLOCATION;
  try {
    process.env.CW_PARALLEL_ALLOCATION = own.paths.manifest;
    const context = await createRunContext({
      parallelIdentity: { lane: 'E', wave: 'W01', run: 'status-wire' },
    });
    assert.equal(context.project, own.composeProject);
    assert.equal(context.runId, own.namespace);
    assert.deepEqual(context.ports, {
      postgres: own.ports.postgres,
      rabbitmq: own.ports.rabbitmq,
      rabbitmqManagement: own.ports.rabbitmqManagement,
    });
    assert.equal(context.vhost, own.broker.vhost);
    assert.equal(context.workDir, own.paths.temporary);
    assert.equal(context.evidenceDir, own.paths.artifacts);
    assert.equal(context.parallelAllocation.browserProfile, own.paths.browserProfile);
    assert.equal(context.services.length, 19);
    assert.equal(Object.keys(context.credentials).length, 44);
    assert.equal(context.databaseScope, 'isolated-compose-project');
    for (const owner of catalog.services) {
      assert.match(
        appDsn(context, owner.id),
        new RegExp(`^postgresql://${owner.runtimeRole}:.*\\/${owner.database}\\?schema=app$`),
      );
      assert.match(
        migrationDsn(context, owner.id),
        new RegExp(`^postgresql://${owner.migrationRole}:.*\\/${owner.database}\\?schema=app$`),
      );
      assert.equal(
        context.effectiveDbIdentities[owner.id].database,
        own.databases[owner.id].database,
      );
    }
    const env = await readFile(context.envFile, 'utf8');
    assert.ok(env.includes(`CW_SERVICES=${SERVICES.join(' ')}`));
    assert.equal((env.match(/_MIGRATION_PASSWORD=/g) ?? []).length, 19);
    assert.equal((env.match(/_DB_PASSWORD=/g) ?? []).length, 19);
    assert.throws(() => appDsn(context, 'unknown-owner'), /UNKNOWN_DATABASE_SERVICE/);
    await assert.rejects(
      () => createRunContext({ runId: 'other-run' }),
      /PARALLEL_ALLOCATION_RUN_MISMATCH/,
    );
    await assert.rejects(
      () => createRunContext({ parallelIdentity: { lane: 'B' } }),
      /ALLOCATION_IDENTITY_MISMATCH/,
    );
    await validateActiveAllocation(peer.paths.manifest, {
      lane: 'A',
      wave: 'W01',
      run: 'status-peer',
    });
    await releaseEnvironment({ ...own, confirmStopped: true });
    await assert.rejects(() => createRunContext(), /ALLOCATION_NOT_ACTIVE/);
    await validateActiveAllocation(peer.paths.manifest);
  } finally {
    if (previous === undefined) delete process.env.CW_PARALLEL_ALLOCATION;
    else process.env.CW_PARALLEL_ALLOCATION = previous;
    if ((await readJsonAbsolute(own.paths.manifest)).status === 'allocated') {
      await releaseEnvironment({ ...own, confirmStopped: true });
    }
    await releaseEnvironment({ ...peer, confirmStopped: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

async function readJsonAbsolute(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
