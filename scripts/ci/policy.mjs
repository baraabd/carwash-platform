import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  classifyServiceRuntime,
  classifyWebRuntime,
  selectRuntimeServices,
} from '../../architecture/runtime-lifecycle.mjs';

export const REQUIRED_JOBS = [
  'plan',
  'targeted',
  'static',
  'integration',
  'images',
  'security',
  'codeql',
];
export const ROOT = path.resolve(import.meta.dirname, '../..');
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export function inventory(root = ROOT) {
  const catalog = readJson(path.join(root, 'architecture/service-catalog.json'));
  const runtime = selectRuntimeServices(catalog);
  for (const service of catalog.services) {
    assert.equal(service.path, `services/${service.id}`, 'Invalid service artifact path');
    if (!classifyServiceRuntime(service).runtime) {
      assert.ok(
        !existsSync(path.join(root, service.path, 'Dockerfile')),
        'Unclassified runtime image',
      );
      assert.ok(
        !existsSync(path.join(root, service.path, 'prisma/schema.prisma')),
        'Unclassified database owner',
      );
      assert.ok(
        !existsSync(path.join(root, service.path, 'src/main.ts')),
        'Unclassified runtime entry point',
      );
    }
  }
  assert.equal(
    classifyServiceRuntime(catalog.gateway).runtime,
    true,
    'Gateway runtime must be classified',
  );
  const runtimeApps = [];
  for (const app of catalog.apps) {
    assert.equal(app.path, `apps/${app.id}`, 'Invalid app artifact path');
    if (classifyWebRuntime(app).runtime) runtimeApps.push(app);
    else
      assert.ok(
        !existsSync(path.join(root, app.path, 'Dockerfile')),
        'Unclassified app runtime image',
      );
  }
  assert.ok(runtime.length > 0, 'No runtime services discovered');
  const targets = [
    ...runtime.map((s) => ({
      id: s.id,
      path: s.path,
      packageName: s.packageName,
      kind: 'service',
      port: 3000,
      database: s.database,
      runtimeRole: s.runtimeRole,
      migrationRole: s.migrationRole,
    })),
    {
      id: catalog.gateway.id,
      path: catalog.gateway.path,
      packageName: catalog.gateway.packageName,
      kind: 'gateway',
      port: 4000,
      database: null,
    },
    ...runtimeApps.map((app) => ({
      id: app.id,
      path: app.path,
      packageName: app.packageName,
      kind: 'web-app',
      port: 3000,
      database: null,
    })),
  ];
  for (const target of targets) {
    assert.match(target.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(
      existsSync(path.join(root, target.path, 'Dockerfile')),
      `Missing runtime Dockerfile: ${target.id}`,
    );
  }
  // An unknown directory or a new Dockerfile variant cannot bypass the image gate.
  const acceptedImages = new Set(targets.map((target) => `${target.path}/Dockerfile`));
  const acceptedImageContexts = new Set(
    targets.map((target) => `${target.path}/Dockerfile.dockerignore`),
  );
  function scanImages(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'dist-tests', 'generated', '.git'].includes(entry.name))
        continue;
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      assert.ok(!entry.isSymbolicLink(), `Unclassified runtime artifact symlink: ${relative}`);
      if (entry.isDirectory()) scanImages(file);
      else if (/^Dockerfile(?:\.|$)/.test(entry.name)) {
        assert.ok(
          acceptedImages.has(relative) || acceptedImageContexts.has(relative),
          `Unclassified runtime image: ${relative}`,
        );
      }
    }
  }
  scanImages(path.join(root, 'services'));
  scanImages(path.join(root, 'apps'));
  const declaredPaths = new Set([
    ...catalog.services.map((service) => service.path),
    catalog.gateway.path,
    ...catalog.apps.map((app) => app.path),
  ]);
  for (const directory of ['services', 'apps']) {
    const parent = path.join(root, directory);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const ownerPath = `${directory}/${entry.name}`;
      if (declaredPaths.has(ownerPath)) continue;
      for (const artifact of ['src/main.ts', 'prisma/schema.prisma']) {
        assert.ok(
          !existsSync(path.join(parent, entry.name, artifact)),
          `Unclassified runtime or database owner: ${ownerPath}/${artifact}`,
        );
      }
    }
  }
  assert.equal(new Set(targets.map((t) => t.id)).size, targets.length);
  return {
    targets,
    apps: catalog.apps,
    plannedServices: catalog.services.filter((s) => !runtime.includes(s)).map((s) => s.id),
  };
}

// Conservative impact planning accelerates first feedback. It NEVER removes a
// mandatory security, integration, independent-build or container acceptance job.
export function affectedTargets(files, owners) {
  assert.ok(Array.isArray(files));
  const ids = new Set();
  for (const file of files) {
    assert.equal(typeof file, 'string');
    assert.ok(!path.isAbsolute(file) && !file.split('/').includes('..'));
    if (/^(?:docs\/|README(?:\.[^/]*)?$)/.test(file)) continue;
    const owner = owners.find((o) => file.startsWith(`${o.path}/`));
    if (owner) ids.add(owner.id);
    else for (const item of owners) ids.add(item.id);
  }
  return owners.filter((o) => ids.has(o.id));
}

export function assertJobResults(needs) {
  assert.ok(needs && typeof needs === 'object' && !Array.isArray(needs));
  assert.deepEqual(
    Object.keys(needs).sort(),
    [...REQUIRED_JOBS].sort(),
    'Missing or unexpected aggregate dependency',
  );
  for (const name of REQUIRED_JOBS)
    assert.equal(needs[name]?.result, 'success', `${name} did not succeed`);
}

export function assertEvidence(records, expected) {
  assert.ok(
    Array.isArray(records) && records.length === expected.ids.length,
    'Incomplete evidence set',
  );
  assert.deepEqual(
    records.map((r) => r.id).sort(),
    [...expected.ids].sort(),
    'Duplicate/missing stage evidence',
  );
  for (const r of records) {
    assert.equal(r.schemaVersion, 1);
    assert.equal(r.sourceSha, expected.sha, `${r.id}: wrong source`);
    assert.equal(r.sourceTree, expected.tree, `${r.id}: wrong tree`);
    assert.equal(r.runId, expected.runId, `${r.id}: wrong run`);
    assert.equal(r.runAttempt, expected.runAttempt, `${r.id}: wrong attempt`);
    assert.equal(r.sourceDirty, false, `${r.id}: dirty source`);
    assert.equal(r.status, 'passed', `${r.id}: failed stage`);
    assert.ok(
      r.steps.length > 0 && r.steps.every((s) => s.status === 'passed'),
      `${r.id}: absent/skipped steps`,
    );
    assert.match(r.tools.node, /^v24\./);
    assert.ok(r.tools.pnpm.length > 0);
  }
}

export function assertTap(output) {
  const values = Object.fromEntries(
    ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((key) => {
      const matches = [...output.matchAll(new RegExp(`^# ${key} ([0-9]+)\\s*$`, 'gm'))];
      assert.equal(matches.length, 1, `Missing or ambiguous TAP summary: ${key}`);
      return [key, Number(matches[0][1])];
    }),
  );
  assert.ok(values.tests > 0 && values.tests === values.pass, 'No complete passing TAP suite');
  for (const key of ['fail', 'cancelled', 'skipped', 'todo'])
    assert.equal(values[key], 0, `Unproven TAP result: ${key}`);
  return values;
}

export function sarifFindings(sarif) {
  assert.equal(sarif.version, '2.1.0', 'Invalid SARIF');
  assert.ok(Array.isArray(sarif.runs) && sarif.runs.length > 0, 'Empty SARIF runs');
  const findings = [];
  for (const run of sarif.runs) {
    assert.ok(Array.isArray(run.results), 'Missing CodeQL results');
    assert.ok(run.tool?.driver?.name?.includes('CodeQL'), 'Expected CodeQL analysis');
    if (run.invocations)
      assert.ok(
        run.invocations.every((i) => i.executionSuccessful === true),
        'Incomplete CodeQL invocation',
      );
    const rules = new Map(
      [
        ...(run.tool.driver.rules ?? []),
        ...(run.tool.extensions ?? []).flatMap((e) => e.rules ?? []),
      ].map((r) => [r.id, r]),
    );
    for (const result of run.results) {
      const rule = rules.get(result.ruleId);
      assert.ok(rule, 'Unresolved SARIF rule');
      const raw = rule.properties?.['security-severity'];
      const severity = raw === undefined ? null : Number(raw);
      assert.ok(
        severity === null || (Number.isFinite(severity) && severity >= 0 && severity <= 10),
      );
      const level = result.level ?? rule.defaultConfiguration?.level ?? 'warning';
      findings.push({
        ruleId: result.ruleId,
        level,
        securitySeverity: severity,
        blocking: level === 'error' || (severity !== null && severity >= 7),
        locations: (result.locations ?? []).map(({ physicalLocation: location }) => {
          const uri = location?.artifactLocation?.uri;
          const line = location?.region?.startLine;
          assert.ok(
            typeof uri === 'string' &&
              uri.length <= 500 &&
              !path.isAbsolute(uri) &&
              !uri.split('/').includes('..'),
            'Unsafe SARIF source location',
          );
          assert.ok(Number.isSafeInteger(line) && line > 0, 'Invalid SARIF line');
          return { path: uri, line };
        }),
      });
    }
  }
  return findings;
}

export function trivyFindings(report) {
  assert.ok(report && report.SchemaVersion === 2, 'Invalid Trivy report');
  assert.ok(Array.isArray(report.Results) && report.Results.length > 0, 'No image scan results');
  return report.Results.flatMap((r) =>
    (r.Vulnerabilities ?? []).map((v) => {
      assert.ok(typeof v.VulnerabilityID === 'string' && typeof v.PkgName === 'string');
      assert.ok(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(v.Severity));
      return {
        id: v.VulnerabilityID,
        package: v.PkgName,
        installed: v.InstalledVersion,
        fixed: v.FixedVersion ?? null,
        severity: v.Severity,
        blocking: ['HIGH', 'CRITICAL', 'UNKNOWN'].includes(v.Severity),
      };
    }),
  );
}

export function auditSummary(report) {
  assert.ok(
    report && !report.error && report.metadata?.vulnerabilities,
    'Invalid dependency audit response',
  );
  const counts = report.metadata.vulnerabilities;
  for (const name of ['low', 'moderate', 'high', 'critical'])
    assert.ok(Number.isSafeInteger(counts[name]) && counts[name] >= 0);
  return {
    low: counts.low,
    moderate: counts.moderate,
    high: counts.high,
    critical: counts.critical,
  };
}

// Runtime identity comes from the catalog's ownership, not a guessed directory id.
export function runtimeEnvironment(target) {
  const env = ['-e', `PORT=${target.port}`, '-e', 'LOG_LEVEL=warn'];
  if (target.kind === 'web-app') return env;
  if (target.id === 'configuration') env.push('-e', 'IDENTITY_ORIGIN=http://127.0.0.1:9');
  if (target.database === null)
    env.push(
      '-e',
      'GATEWAY_UPSTREAMS={"identity":"http://127.0.0.1:9"}',
      '-e',
      'IDENTITY_ISSUER=https://identity.washgo.invalid',
      '-e',
      'IDENTITY_AUDIENCE=washgo-web',
      '-e',
      'GATEWAY_ALLOWED_ORIGINS=https://customer.washgo.invalid',
    );
  else
    env.push(
      '-e',
      `DATABASE_URL=postgresql://${target.runtimeRole}:changeme@127.0.0.1:9/${target.database}?schema=app`,
    );
  return env;
}
