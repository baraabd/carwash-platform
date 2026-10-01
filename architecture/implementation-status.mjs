#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_FILE = path.join(ROOT, 'architecture/implementation-status.json');
const CATALOG_FILE = path.join(ROOT, 'architecture/service-catalog.json');
const EXPECTED_FOUNDATION = Object.freeze(
  Array.from({ length: 10 }, (_, index) => `F${String(index + 1).padStart(3, '0')}`),
);

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function prismaModels(servicePath) {
  const file = path.join(ROOT, servicePath, 'prisma/schema.prisma');
  if (!existsSync(file)) return [];
  return [...readFileSync(file, 'utf8').matchAll(/^model\s+(\w+)/gm)].map((match) => match[1]);
}

function assertEvidencePath(entry) {
  if (/^PR #\d+$/.test(entry)) return;
  const target = path.join(ROOT, entry);
  assert.ok(existsSync(target), `Missing evidence path: ${entry}`);
  assert.ok(statSync(target).isFile() || statSync(target).isDirectory(), `Invalid evidence: ${entry}`);
}

export function validateImplementationStatus(status, catalog) {
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.$schema, './implementation-status.schema.json');
  assert.match(status.asOf?.mainSha ?? '', /^[a-f0-9]{40}$/);
  assert.equal(status.product?.productionReady, false);
  assert.equal(status.product?.readiness, 'foundation-accepted-product-not-implemented');

  const foundationIds = Object.keys(status.foundation ?? {}).sort();
  assert.deepEqual(foundationIds, [...EXPECTED_FOUNDATION].sort());
  for (const id of EXPECTED_FOUNDATION) {
    const sprint = status.foundation[id];
    assert.equal(sprint.status, 'merged-and-verified', `${id} must be explicitly verified`);
    assert.ok(typeof sprint.capability === 'string' && sprint.capability.length > 0);
    assert.ok(Array.isArray(sprint.evidence) && sprint.evidence.length > 0);
    sprint.evidence.forEach(assertEvidencePath);
  }

  assert.ok(Array.isArray(catalog.services) && catalog.services.length === 19);
  assert.ok(Array.isArray(status.services) && status.services.length === catalog.services.length);
  const byId = new Map(status.services.map((service) => [service.id, service]));
  assert.equal(byId.size, catalog.services.length, 'Duplicate or missing service status');

  for (const owner of catalog.services) {
    const actual = byId.get(owner.id);
    assert.ok(actual, `Missing service status: ${owner.id}`);
    assert.equal(actual.path, owner.path);
    assert.equal(actual.database, owner.database);
    assert.equal(actual.runtimeImplementation, owner.runtimeImplementation);
    assert.equal(actual.businessApi, owner.api.status);
    assert.equal(actual.businessEvents, owner.events.status);
    assert.equal(actual.deploymentVerified, owner.deployment.verified);
    assert.deepEqual(actual.persistenceModels, prismaModels(owner.path));

    if (owner.id === 'identity') {
      assert.equal(actual.productDomainStatus, 'identity-security-foundation-only');
    } else if (owner.runtimeImplementation === 'existing-health-only-shell') {
      assert.equal(actual.productDomainStatus, 'foundation-shell-only');
    } else {
      assert.equal(actual.productDomainStatus, 'typescript-skeleton-only');
    }
  }

  assert.equal(
    status.services.filter((service) => service.runtimeImplementation === 'existing-health-only-shell').length,
    10,
  );
  assert.equal(
    status.services.filter(
      (service) => service.runtimeImplementation === 'directory-and-typescript-skeleton-only',
    ).length,
    9,
  );

  assert.deepEqual(Object.keys(status.applications ?? {}).sort(), [
    'admin-web',
    'api-gateway',
    'customer-web',
    'operator-web',
  ]);
  const expectedApps = {
    'customer-web': 'golden-html-prototype-only',
    'operator-web': 'planned-boundary-only',
    'admin-web': 'planned-boundary-only',
    'api-gateway': 'foundation-gateway-runtime',
  };
  for (const [id, expected] of Object.entries(expectedApps)) {
    const app = status.applications[id];
    assert.equal(app.status, expected);
    assert.ok(Array.isArray(app.evidence) && app.evidence.length > 0);
    app.evidence.forEach(assertEvidencePath);
  }

  assert.ok(['not-enforced', 'enforced', 'unknown'].includes(status.governance?.branchProtection));
  assert.ok(Number.isSafeInteger(status.governance?.rulesets) && status.governance.rulesets >= 0);
  assert.ok(typeof status.governance?.note === 'string' && status.governance.note.length > 0);

  return {
    services: status.services.length,
    foundationSprints: foundationIds.length,
    runtimeShells: status.services.filter(
      (service) => service.runtimeImplementation === 'existing-health-only-shell',
    ).length,
    skeletons: status.services.filter(
      (service) => service.runtimeImplementation === 'directory-and-typescript-skeleton-only',
    ).length,
    productionReady: status.product.productionReady,
  };
}

function clone(value) {
  return structuredClone(value);
}

export function runAdversarialSelfTest(status, catalog) {
  const mutations = [
    {
      id: 'production-ready-overclaim',
      mutate(value) {
        value.product.productionReady = true;
      },
    },
    {
      id: 'service-runtime-drift',
      mutate(value) {
        value.services.find((service) => service.id === 'vehicle').runtimeImplementation =
          'existing-health-only-shell';
      },
    },
    {
      id: 'missing-service',
      mutate(value) {
        value.services = value.services.filter((service) => service.id !== 'booking');
      },
    },
    {
      id: 'persistence-model-overclaim',
      mutate(value) {
        value.services.find((service) => service.id === 'customer').persistenceModels.push(
          'CustomerProfile',
        );
      },
    },
  ];
  for (const mutation of mutations) {
    const candidate = clone(status);
    mutation.mutate(candidate);
    assert.throws(
      () => validateImplementationStatus(candidate, catalog),
      undefined,
      `Mutation must fail closed: ${mutation.id}`,
    );
  }
  return mutations.map((mutation) => mutation.id);
}

const status = readJson(STATUS_FILE);
const catalog = readJson(CATALOG_FILE);
const result = validateImplementationStatus(status, catalog);
if (process.argv.includes('--self-test')) {
  const adversarial = runAdversarialSelfTest(status, catalog);
  console.log(
    JSON.stringify({ accepted: true, ...result, adversarial: { passed: adversarial.length, cases: adversarial } }, null, 2),
  );
} else {
  console.log(JSON.stringify({ accepted: true, ...result }, null, 2));
}
