#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  classifyServiceRuntime,
  RUNTIME_IMPLEMENTATIONS,
  selectRuntimeServices,
} from './runtime-lifecycle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_FILE = path.join(ROOT, 'architecture/implementation-status.json');
const CATALOG_FILE = path.join(ROOT, 'architecture/service-catalog.json');
const EXPECTED_FOUNDATION = Object.freeze(
  Array.from({ length: 10 }, (_, index) => `F${String(index + 1).padStart(3, '0')}`),
);
const HISTORICAL_FOUNDATION = 'foundation-2026-10-01';
const CANDIDATE_ACCEPTANCE = 'not-verified-on-current-candidate';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Read the owner's actual schema, independently of generators and central model mirrors. */
export function persistenceModels(servicePath, root = ROOT) {
  const file = path.join(root, servicePath, 'prisma/schema.prisma');
  if (!existsSync(file)) return [];
  const schema = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return [...schema.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
}

function assertEvidencePath(entry, root = ROOT) {
  if (/^PR #\d+$/.test(entry)) return;
  assert.ok(typeof entry === 'string' && entry.length > 0, 'Evidence path required');
  const target = path.resolve(root, entry);
  assert.ok(
    target.startsWith(`${path.resolve(root)}${path.sep}`),
    `Evidence escapes repository: ${entry}`,
  );
  assert.ok(existsSync(target), `Missing evidence path: ${entry}`);
  assert.ok(
    statSync(target).isFile() || statSync(target).isDirectory(),
    `Invalid evidence: ${entry}`,
  );
}

/** Runtime metadata and model inventory are each read from their own authorities. */
export function deriveServiceStatuses(catalog, { root = ROOT } = {}) {
  selectRuntimeServices(catalog); // Reject unknown lifecycle values and duplicate IDs.
  return catalog.services.map((owner) => {
    const lifecycle = classifyServiceRuntime(owner);
    return {
      id: owner.id,
      path: owner.path,
      runtimeImplementation: owner.runtimeImplementation,
      acceptedCapabilities: [...lifecycle.capabilities],
      database: owner.database,
      businessApi: owner.api.status,
      businessEvents: owner.events.status,
      deploymentVerified: owner.deployment.verified,
      persistenceModels: persistenceModels(owner.path, root),
      productDomainStatus:
        lifecycle.capabilities.length > 0
          ? 'identity-security-foundation-only'
          : lifecycle.runtime
            ? 'foundation-shell-only'
            : 'typescript-skeleton-only',
      runtimeAcceptance: CANDIDATE_ACCEPTANCE,
    };
  });
}

export function runtimeInventory(catalog) {
  const runtimes = selectRuntimeServices(catalog);
  const classified = catalog.services.map(classifyServiceRuntime);
  return {
    services: catalog.services.length,
    runtimeServices: runtimes.length,
    foundationShells: classified.filter((entry) => entry.foundation).length,
    legacyFoundationShells: runtimes.filter(
      (owner) => owner.runtimeImplementation === RUNTIME_IMPLEMENTATIONS.legacyFoundation,
    ).length,
    onboardedFoundationShells: runtimes.filter(
      (owner) => owner.runtimeImplementation === RUNTIME_IMPLEMENTATIONS.foundation,
    ).length,
    capabilityRuntimes: runtimes.filter(
      (owner) => owner.runtimeImplementation === RUNTIME_IMPLEMENTATIONS.capability,
    ).length,
    skeletons: classified.filter((entry) => !entry.runtime).length,
  };
}

export function validateImplementationStatus(
  status,
  catalog,
  { root = ROOT, persistenceRoot = root } = {},
) {
  assert.equal(status.schemaVersion, 2);
  assert.equal(status.$schema, './implementation-status.schema.json');
  assert.match(status.asOf?.date ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.match(status.asOf?.mainSha ?? '', /^[a-f0-9]{40}$/);
  assert.equal(status.asOf?.scope, 'candidate-source-inventory');
  assert.equal(status.product?.productionReady, false);
  assert.equal(status.product?.readiness, 'foundation-accepted-business-integration-pending');
  const historical = status.verificationRecords?.[HISTORICAL_FOUNDATION];
  assert.equal(historical?.date, '2026-10-01');
  assert.equal(historical?.sourceSha, 'f364792d78cf572444df8093c2e4c6315becdae9');
  assert.equal(historical?.scope, 'historical-F001-F010-foundation');
  assert.equal(historical?.appliesToCurrentCandidate, false);
  assert.equal(status.currentCandidateAcceptance, CANDIDATE_ACCEPTANCE);
  assert.ok(Array.isArray(historical?.evidence) && historical.evidence.length > 0);
  historical.evidence.forEach((entry) => assertEvidencePath(entry, root));
  const foundationIds = Object.keys(status.foundation ?? {}).sort();
  assert.deepEqual(foundationIds, [...EXPECTED_FOUNDATION].sort());
  for (const id of EXPECTED_FOUNDATION) {
    const sprint = status.foundation[id];
    assert.equal(sprint.status, 'merged-and-verified', `${id} historical status missing`);
    assert.equal(sprint.verificationRecord, HISTORICAL_FOUNDATION);
    assert.ok(typeof sprint.capability === 'string' && sprint.capability.length > 0);
    assert.ok(Array.isArray(sprint.evidence) && sprint.evidence.length > 0);
    sprint.evidence.forEach((entry) => assertEvidencePath(entry, root));
  }
  assert.ok(Array.isArray(catalog.services) && catalog.services.length === 19);
  for (const owner of catalog.services) {
    assert.equal(owner.api.status, 'planned-not-implemented');
    assert.equal(owner.events.status, 'planned-not-implemented');
    assert.equal(owner.deployment.verified, false);
    assert.equal(classifyServiceRuntime(owner).businessReady, false);
  }
  assert.deepEqual(
    status.services,
    deriveServiceStatuses(catalog, { root: persistenceRoot }),
    'Service source inventory drift',
  );
  const inventory = runtimeInventory(catalog);
  assert.deepEqual(
    status.runtimeInventory,
    inventory,
    'Runtime counts must come from lifecycle classification',
  );
  assert.deepEqual(Object.keys(status.applications ?? {}).sort(), [
    'admin-web',
    'api-gateway',
    'customer-web',
    'operator-web',
  ]);
  const expectedApps = {
    'customer-web': 'react-session-demo-partially-implemented',
    'operator-web': 'technical-boot-shell-only',
    'admin-web': 'technical-boot-shell-only',
    'api-gateway': 'foundation-gateway-runtime',
  };
  for (const [id, expected] of Object.entries(expectedApps)) {
    const app = status.applications[id];
    assert.equal(app.status, expected);
    assert.equal(app.productionReady, false);
    assert.equal(app.businessIntegration, 'not-implemented');
    assert.equal(app.currentCandidateAcceptance, CANDIDATE_ACCEPTANCE);
    assert.ok(Array.isArray(app.evidence) && app.evidence.length > 0);
    app.evidence.forEach((entry) => assertEvidencePath(entry, root));
  }
  assert.ok(['not-enforced', 'enforced', 'unknown'].includes(status.governance?.branchProtection));
  assert.ok(Number.isSafeInteger(status.governance?.rulesets) && status.governance.rulesets >= 0);
  assert.match(status.governance?.observedAt ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(typeof status.governance?.note === 'string' && status.governance.note.length > 0);
  return {
    ...inventory,
    foundationSprints: foundationIds.length,
    currentCandidateAcceptance: CANDIDATE_ACCEPTANCE,
    productionReady: status.product.productionReady,
  };
}

export function runAdversarialSelfTest(status, catalog, options = {}) {
  const mutations = [
    [
      'production-ready-overclaim',
      (value) => {
        value.product.productionReady = true;
      },
    ],
    [
      'unknown-runtime',
      (value) => {
        value.services[0].runtimeImplementation = 'production-ready';
      },
    ],
    [
      'service-runtime-drift',
      (value) => {
        value.services.find((service) => service.id === 'vehicle').runtimeImplementation =
          RUNTIME_IMPLEMENTATIONS.skeleton;
      },
    ],
    [
      'missing-service',
      (value) => {
        value.services.pop();
      },
    ],
    [
      'persistence-model-overclaim',
      (value) => {
        value.services
          .find((service) => service.id === 'customer')
          .persistenceModels.push('CustomerProfile');
      },
    ],
    [
      'candidate-verification-overclaim',
      (value) => {
        value.currentCandidateAcceptance = 'verified';
      },
    ],
    [
      'historical-verification-reuse',
      (value) => {
        value.verificationRecords[HISTORICAL_FOUNDATION].appliesToCurrentCandidate = true;
      },
    ],
    [
      'stale-customer-application',
      (value) => {
        value.applications['customer-web'].status = 'golden-html-prototype-only';
      },
    ],
    [
      'legacy-literal-runtime-count',
      (value) => {
        value.runtimeInventory.runtimeServices = 9;
      },
    ],
  ];
  for (const [id, mutate] of mutations) {
    const candidate = globalThis.structuredClone(status);
    mutate(candidate);
    assert.throws(
      () => validateImplementationStatus(candidate, catalog, options),
      undefined,
      `Mutation must fail closed: ${id}`,
    );
  }
  return mutations.map(([id]) => id);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const status = readJson(STATUS_FILE);
  const catalog = readJson(CATALOG_FILE);
  if (process.argv.includes('--refresh-inventory')) {
    // Refresh source-derived fields only; this never creates acceptance evidence.
    status.services = deriveServiceStatuses(catalog);
    status.runtimeInventory = runtimeInventory(catalog);
    writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`);
  }
  const result = validateImplementationStatus(status, catalog);
  const output = { sourceInventoryValid: true, ...result };
  if (process.argv.includes('--self-test')) {
    const cases = runAdversarialSelfTest(status, catalog);
    output.adversarial = { passed: cases.length, cases };
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
