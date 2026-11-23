// P08-E1 final release barrier. Runs the real rules against a disposable git
// repository (real git objects/refs, real evidence files and sha256 digests).
// Nothing here deploys or calls GitHub; review/protection/authorization are
// receipts the owners must produce, and the barrier only verifies them.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs, {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  renameSync,
  symlinkSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateBarrier,
  canonicalJson,
  findSecretMaterial,
  BarrierInputError,
  RECEIPT_SCHEMA,
  CANDIDATE_SCHEMA,
} from '../../../scripts/production/E/release/barrier.mjs';
import { evidenceDigester, gitIo, sha256Hex } from '../../../scripts/production/E/release/io.mjs';
import {
  artifactDigests,
  manifestDigest,
  repositoryFor,
} from '../../../scripts/production/E/release/manifest.mjs';
import { inventory } from '../../../scripts/ci/policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const policy = JSON.parse(
  readFileSync(path.join(repoRoot, 'architecture/release-barrier.json'), 'utf8'),
);
const governance = JSON.parse(
  readFileSync(path.join(repoRoot, 'architecture/governance/main-ruleset.json'), 'utf8'),
);
const REQUIRED_CHECKS = governance.rules
  .find((rule) => rule.type === 'required_status_checks')
  .parameters.required_status_checks.map((check) => check.context);
const REQUIRED_APPROVALS = governance.rules.find((rule) => rule.type === 'pull_request').parameters
  .required_approving_review_count;
const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const TARGETS = inventory().targets;
const DIGEST = `sha256:${'a'.repeat(64)}`;
const LOCKED_BASE_IMAGES = {
  runtime: `gcr.io/distroless/base-nossl-debian13@${DIGEST}`,
  nativeLibraries: `gcr.io/distroless/cc-debian13@${DIGEST}`,
};
const MANIFEST_PATH = 'evidence/release-manifest.json';

function sh(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixtureRepo(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'p08e1-'));
  if (t) t.after(() => rmSync(dir, { recursive: true, force: true }));
  else process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'barrier@test.invalid');
  sh(dir, 'config', 'user.name', 'barrier-test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  sh(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(dir, 'source.txt'), 'release candidate\n');
  const file = (name, content) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  };
  file(
    'architecture/service-catalog.json',
    readFileSync(path.join(repoRoot, 'architecture/service-catalog.json')),
  );
  file('architecture/release-barrier.json', JSON.stringify(policy));
  file('architecture/governance/main-ruleset.json', JSON.stringify(governance));
  file('pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  file(
    'scripts/ci/tools.lock.json',
    JSON.stringify({
      runtime: { image: LOCKED_BASE_IMAGES.runtime },
      nativeLibraries: { image: LOCKED_BASE_IMAGES.nativeLibraries },
    }),
  );
  file('infra/release/Dockerfile.migrate', 'FROM scratch\n');
  for (const target of TARGETS.filter((target) => target.database)) {
    file(`${target.path}/prisma/schema.prisma`, '// synthetic migration schema\n');
    file(`${target.path}/prisma/migrations/20260101000000_fixture/migration.sql`, 'SELECT 1;\n');
  }
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'rc');
  mkdirSync(path.join(dir, 'evidence'));
  writeFileSync(path.join(dir, 'evidence/run.log'), 'gate output\n');
  const repo = {
    dir,
    sha: sh(dir, 'rev-parse', 'HEAD'),
    tree: sh(dir, 'rev-parse', 'HEAD^{tree}'),
    evidence: [{ path: 'evidence/run.log', sha256: `sha256:${sha256Hex('gate output\n')}` }],
  };
  const source = gitIo(dir).sourceContext(repo.sha);
  assert.ok(source);
  repo.configDigest = source.source.configDigest;
  const registry = 'ghcr.io/baraabd';
  const artifacts = TARGETS.flatMap((target) =>
    (target.database ? ['runtime', 'migration'] : ['runtime']).map((role) => {
      const repository = repositoryFor(registry, target.id, role);
      return {
        id: target.id,
        kind: target.kind,
        role,
        repository,
        digest: DIGEST,
        reference: `${repository}@${DIGEST}`,
        platform: 'linux/amd64',
        attestations: {
          sbom: true,
          provenance: true,
          sbomSha256: DIGEST,
          provenanceSha256: DIGEST,
          registryAttestationManifests: 1,
        },
        ...(role === 'migration'
          ? {
              database: target.database,
              migrationRole: target.migrationRole,
              runtimeRole: target.runtimeRole,
              migrationSet: source.migrationSets[target.id],
            }
          : {}),
      };
    }),
  );
  const body = {
    kind: 'carwash.release-manifest',
    schemaVersion: 1,
    source: source.source,
    registry,
    baseImages: {
      node: `docker.io/library/node@${DIGEST}`,
      ...LOCKED_BASE_IMAGES,
    },
    artifacts,
  };
  repo.manifest = { ...body, manifestDigest: manifestDigest(body) };
  const bytes = JSON.stringify(repo.manifest);
  writeFileSync(path.join(dir, MANIFEST_PATH), bytes);
  repo.manifestEvidence = { path: MANIFEST_PATH, sha256: `sha256:${sha256Hex(bytes)}` };
  return repo;
}

function details(kind, repo) {
  switch (kind) {
    case 'artifacts':
      return { manifestPath: MANIFEST_PATH };
    case 'review':
      return {
        pullRequest: 140,
        reviewer: 'independent-reviewer',
        author: 'rc-author',
        state: 'APPROVED',
        commitId: repo.sha,
      };
    case 'branch-protection':
      return {
        branch: 'main',
        requiredChecks: REQUIRED_CHECKS,
        enforceAdmins: true,
        requiredApprovals: REQUIRED_APPROVALS,
      };
    case 'authorization':
      return {
        authorizer: 'project-owner',
        candidateSha: repo.sha,
        artifactManifestDigest: repo.manifest.manifestDigest,
        scope: { liveMoney: false },
        notBefore: '2026-10-11T00:00:00Z',
        expiresAt: '2026-10-12T00:00:00Z',
      };
    case 'external':
      return { target: 'reviewed-target-reference' };
    case 'secret-references':
      return { references: [{ name: 'identity-db', ref: 'vault://carwash/prod/identity-db' }] };
    case 'incident-contacts':
      return {
        primary: { name: 'Primary Person', channel: 'pager://carwash/primary' },
        backup: { name: 'Backup Person', channel: 'pager://carwash/backup' },
      };
    case 'window-policy':
      return {
        approvedBy: 'project-owner',
        durationMinutes: 120,
        maxSampleGapMinutes: 5,
        thresholds: { http5xxRate: { bound: 'max', limit: 0.01, onBreach: 'rollback' } },
      };
    default:
      return undefined;
  }
}

function receiptFor(family, repo) {
  const receipt = {
    schema: RECEIPT_SCHEMA,
    family: family.id,
    status: 'PASSED',
    rc: { sha: repo.sha, tree: repo.tree },
    producedAt: '2026-10-11T10:00:00.000Z',
    producer: { actor: `owner-of-${family.id}` },
    configDigest: repo.configDigest,
    evidence: repo.evidence,
  };
  if (family.kind === 'acceptance')
    receipt.dependencies = { postgres: 'REAL (disposable container)', rabbitmq: 'REAL' };
  if (family.kind === 'artifacts') {
    receipt.artifacts = artifactDigests(repo.manifest);
    receipt.evidence = [...repo.evidence, repo.manifestEvidence];
  }
  const d = details(family.kind, repo);
  if (d) receipt.details = d;
  return receipt;
}

// Tests that never change the repository share one; mutating tests get their own.
let shared;
function setup(t, { fresh = false } = {}) {
  const repo = fresh ? fixtureRepo(t) : (shared ??= fixtureRepo());
  const candidate = {
    schema: CANDIDATE_SCHEMA,
    sha: repo.sha,
    tree: repo.tree,
    refs: { 'refs/heads/main': repo.sha },
    configDigest: repo.configDigest,
  };
  const receipts = Object.fromEntries(policy.families.map((f) => [f.id, receiptFor(f, repo)]));
  const evaluate = (overrides = {}) =>
    evaluateBarrier({
      policy: overrides.policy ?? policy,
      candidate: overrides.candidate ?? candidate,
      receipts:
        overrides.receipts ??
        Object.entries(receipts).map(([id, receipt]) => ({ source: `${id}.json`, receipt })),
      io: gitIo(repo.dir),
      now: overrides.now ?? NOW,
    });
  return { repo, candidate, receipts, evaluate };
}

const familyResult = (report, id) => report.families.find((f) => f.family === id);

function replaceManifest(repo, receipt, manifest, { rehash = true } = {}) {
  if (rehash && manifest && !Array.isArray(manifest) && typeof manifest === 'object') {
    const body = { ...manifest };
    delete body.manifestDigest;
    manifest.manifestDigest = manifestDigest(body);
  }
  const bytes = JSON.stringify(manifest);
  writeFileSync(path.join(repo.dir, MANIFEST_PATH), bytes);
  receipt.evidence = [
    ...repo.evidence,
    { path: MANIFEST_PATH, sha256: `sha256:${sha256Hex(bytes)}` },
  ];
  // A map is optional because the actual artifact receipt producer records the
  // full manifest as evidence. Its complete artifact inventory is authoritative.
  delete receipt.artifacts;
  return manifest?.manifestDigest;
}

test('policy: every family has a unique id, owner, action and a validator kind', () => {
  const ids = policy.families.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  const kinds = new Set([
    'check',
    'acceptance',
    'artifacts',
    'review',
    'branch-protection',
    'authorization',
    'external',
    'secret-references',
    'incident-contacts',
    'window-policy',
  ]);
  for (const f of policy.families) {
    assert.ok(f.owner && f.action, f.id);
    assert.ok(kinds.has(f.kind), `${f.id} kind ${f.kind}`);
  }
  for (const lane of ['A', 'B', 'C', 'D']) assert.ok(ids.includes(`${lane}.rc-acceptance`));
});

test('GO only when every family has one valid PASSED receipt bound to the candidate', (t) => {
  const { evaluate, repo } = setup(t);
  const report = evaluate();
  assert.equal(report.verdict, 'GO', JSON.stringify(report.blockers, null, 2));
  assert.equal(report.deployment, 'AUTHORIZED_PENDING_RUNBOOK');
  assert.equal(
    repo.manifest.artifacts.filter((artifact) => artifact.role === 'runtime').length,
    23,
  );
  assert.equal(
    repo.manifest.artifacts.filter((artifact) => artifact.role === 'migration').length,
    19,
  );
  assert.equal(report.artifactManifestDigest, repo.manifest.manifestDigest);
  assert.deepEqual(report.blockers, []);
});

test('no receipts at all: NO_GO lists every family with owner and action', (t) => {
  const { evaluate } = setup(t);
  const report = evaluate({ receipts: [] });
  assert.equal(report.verdict, 'NO_GO');
  assert.equal(report.deployment, 'NOT_PERMITTED');
  assert.equal(report.blockers.length, policy.families.length);
  for (const b of report.blockers) {
    assert.equal(b.status, 'MISSING');
    assert.ok(b.owner && b.action);
  }
});

test('missing or FAILED lane acceptance blocks the release', (t) => {
  const { evaluate, receipts } = setup(t);
  const without = Object.entries(receipts)
    .filter(([id]) => id !== 'C.rc-acceptance')
    .map(([id, receipt]) => ({ source: id, receipt }));
  assert.equal(familyResult(evaluate({ receipts: without }), 'C.rc-acceptance').status, 'MISSING');
  receipts['B.rc-acceptance'].status = 'FAILED';
  const report = evaluate();
  assert.equal(report.verdict, 'NO_GO');
  assert.equal(familyResult(report, 'B.rc-acceptance').status, 'FAILED');
});

test('acceptance on a stub or mocked dependency is not production evidence', (t) => {
  const { evaluate, receipts } = setup(t);
  receipts['A.rc-acceptance'].dependencies.identity = 'LOCAL HTTP STUB';
  receipts['D.rc-acceptance'].dependencies.rabbitmq = 'REAL? NOT USED';
  const report = evaluate();
  assert.equal(familyResult(report, 'A.rc-acceptance').status, 'INVALID');
  assert.match(familyResult(report, 'A.rc-acceptance').problems.join(), /identity is not real/);
  assert.equal(familyResult(report, 'D.rc-acceptance').status, 'INVALID');
});

test('a receipt for another commit or tree is stale', (t) => {
  const { evaluate, receipts, repo } = setup(t, { fresh: true });
  writeFileSync(path.join(repo.dir, 'source.txt'), 'changed after acceptance\n');
  sh(repo.dir, 'commit', '-qam', 'later');
  receipts['E.ci-mandatory'].rc = {
    sha: sh(repo.dir, 'rev-parse', 'HEAD'),
    tree: sh(repo.dir, 'rev-parse', 'HEAD^{tree}'),
  };
  const report = evaluate();
  assert.equal(familyResult(report, 'E.ci-mandatory').status, 'INVALID');
  assert.match(familyResult(report, 'E.ci-mandatory').problems[0], /not the candidate/);
});

test('a moved ref or wrong candidate tree is NO_GO even with every receipt PASSED', (t) => {
  const { evaluate, candidate, repo } = setup(t, { fresh: true });
  writeFileSync(path.join(repo.dir, 'source.txt'), 'merged something else\n');
  sh(repo.dir, 'commit', '-qam', 'main moved');
  const moved = evaluate();
  assert.equal(moved.verdict, 'NO_GO');
  assert.match(
    moved.candidateChecks.find((c) => c.check === 'ref refs/heads/main').reason,
    /moved to/,
  );
  const wrongTree = evaluate({
    candidate: {
      ...candidate,
      refs: { 'refs/heads/main': sh(repo.dir, 'rev-parse', 'HEAD') },
      tree: 'f'.repeat(40),
    },
  });
  assert.equal(wrongTree.candidateChecks[0].status, 'FAILED');
  assert.equal(wrongTree.verdict, 'NO_GO');
});

test('tampered or missing evidence invalidates the receipt', (t) => {
  const { evaluate, receipts, repo } = setup(t, { fresh: true });
  writeFileSync(path.join(repo.dir, 'evidence/run.log'), 'edited after the fact\n');
  const report = evaluate();
  assert.equal(report.verdict, 'NO_GO');
  assert.match(familyResult(report, 'E.design-lock').problems.join(), /changed after the receipt/);
  receipts['E.design-lock'].evidence = [
    { path: '../outside.log', sha256: `sha256:${'0'.repeat(64)}` },
  ];
  assert.match(familyResult(evaluate(), 'E.design-lock').problems.join(), /missing/);
});

test('two receipts for one family are a conflict, not a choice', (t) => {
  const { evaluate, receipts } = setup(t);
  const list = Object.entries(receipts).map(([id, receipt]) => ({ source: id, receipt }));
  list.push({
    source: 'second.json',
    receipt: { ...receipts['E.security-scans'], status: 'FAILED' },
  });
  const r = familyResult(evaluate({ receipts: list }), 'E.security-scans');
  assert.equal(r.status, 'CONFLICT');
});

test('unknown or unparseable receipts block GO', (t) => {
  const { evaluate, receipts } = setup(t);
  const list = Object.entries(receipts).map(([id, receipt]) => ({ source: id, receipt }));
  list.push({ source: 'broken.json', receipt: null });
  const report = evaluate({ receipts: list });
  assert.equal(report.verdict, 'NO_GO');
  assert.equal(report.unknownReceipts[0].source, 'broken.json');
});

test('review must be independent, APPROVED and on the candidate commit', (t) => {
  const { evaluate, receipts } = setup(t);
  receipts['review.independent'].details.reviewer = 'RC-Author';
  assert.match(familyResult(evaluate(), 'review.independent').problems.join(), /not independent/);
  receipts['review.independent'].details.reviewer = 'someone-else';
  receipts['review.independent'].details.state = 'COMMENTED';
  receipts['review.independent'].details.commitId = 'e'.repeat(40);
  const problems = familyResult(evaluate(), 'review.independent').problems.join();
  assert.match(problems, /not APPROVED/);
  assert.match(problems, /different commit/);
});

test('branch protection without required checks or enforce_admins is a blocker', (t) => {
  const { evaluate, receipts } = setup(t);
  receipts['repo.required-checks-enforced'].details = {
    branch: 'main',
    requiredChecks: [],
    enforceAdmins: false,
    requiredApprovals: 0,
  };
  const problems = familyResult(evaluate(), 'repo.required-checks-enforced').problems;
  assert.match(problems.join(), /no required status checks/);
  assert.match(problems.join(), /enforce_admins/);
  assert.doesNotMatch(problems.join(), /approving review/);
});

test('branch protection covers every pinned check while ordinary PR approvals follow owner policy', (t) => {
  const { evaluate, receipts } = setup(t);
  assert.equal(REQUIRED_APPROVALS, 0);
  assert.equal(REQUIRED_CHECKS.length, 14);
  assert.equal(evaluate().verdict, 'GO');
  receipts['repo.required-checks-enforced'].details.requiredChecks = REQUIRED_CHECKS.filter(
    (check) => check !== 'Release artifacts verified',
  );
  assert.match(
    familyResult(evaluate(), 'repo.required-checks-enforced').problems.join(),
    /required status check is not enforced: Release artifacts verified/,
  );
  receipts['repo.required-checks-enforced'].details.requiredChecks = REQUIRED_CHECKS;
  receipts['repo.required-checks-enforced'].details.requiredApprovals = -1;
  assert.match(
    familyResult(evaluate(), 'repo.required-checks-enforced').problems.join(),
    /required approving reviews/,
  );
  receipts['repo.required-checks-enforced'].details.requiredApprovals = 0;
  delete receipts['review.independent'];
  const report = evaluate();
  assert.equal(familyResult(report, 'repo.required-checks-enforced').status, 'PASSED');
  assert.equal(familyResult(report, 'review.independent').status, 'MISSING');
  assert.equal(report.verdict, 'NO_GO');
});

test('an arbitrary digest map cannot substitute for the full source-bound manifest', (t) => {
  const { evaluate, receipts } = setup(t);
  const artifactReceipt = receipts['E.artifacts-published'];
  artifactReceipt.artifacts = { gateway: DIGEST, billing: DIGEST };
  delete artifactReceipt.details.manifestPath;
  receipts['ext.production-authorization'].details.artifactManifestDigest = manifestDigest(
    artifactReceipt.artifacts,
  );
  const report = evaluate();
  assert.equal(report.verdict, 'NO_GO');
  assert.equal(report.artifactManifestDigest, null);
  assert.match(
    familyResult(report, 'E.artifacts-published').problems.join(),
    /full release manifest/,
  );
  assert.match(
    familyResult(report, 'ext.production-authorization').problems.join(),
    /no validated/,
  );
});

test('a rehashed, authorized manifest with a missing runtime or owner migration is refused', (t) => {
  const { evaluate, receipts, repo } = setup(t, { fresh: true });
  for (const role of ['runtime', 'migration']) {
    const manifest = structuredClone(repo.manifest);
    manifest.artifacts = manifest.artifacts.filter(
      (artifact) => !(artifact.id === 'billing' && artifact.role === role),
    );
    receipts['ext.production-authorization'].details.artifactManifestDigest = replaceManifest(
      repo,
      receipts['E.artifacts-published'],
      manifest,
    );
    const report = evaluate();
    assert.equal(report.verdict, 'NO_GO');
    assert.equal(report.artifactManifestDigest, null);
    assert.match(
      familyResult(report, 'E.artifacts-published').problems.join(),
      new RegExp(`${role.toUpperCase()}_ARTIFACT_MISSING: billing`),
    );
  }
});

test('the manifest source blobs, configuration and migration bytes must match the candidate git objects', (t) => {
  const { evaluate, receipts, repo } = setup(t, { fresh: true });
  const mutations = [
    [
      'source tree',
      (manifest) => {
        manifest.source.tree = 'f'.repeat(40);
      },
    ],
    [
      'source lockfileBlob',
      (manifest) => {
        manifest.source.lockfileBlob = 'f'.repeat(40);
      },
    ],
    [
      'source toolsLockBlob',
      (manifest) => {
        manifest.source.toolsLockBlob = 'f'.repeat(40);
      },
    ],
    [
      'source migrationDockerfileBlob',
      (manifest) => {
        manifest.source.migrationDockerfileBlob = 'f'.repeat(40);
      },
    ],
    [
      'source configDigest',
      (manifest) => {
        manifest.source.configDigest = `sha256:${'f'.repeat(64)}`;
      },
    ],
    [
      'migration set billing',
      (manifest) => {
        manifest.artifacts.find(
          (artifact) => artifact.id === 'billing' && artifact.role === 'migration',
        ).migrationSet.digest = `sha256:${'f'.repeat(64)}`;
      },
    ],
  ];
  for (const [reason, mutate] of mutations) {
    const manifest = structuredClone(repo.manifest);
    mutate(manifest);
    receipts['ext.production-authorization'].details.artifactManifestDigest = replaceManifest(
      repo,
      receipts['E.artifacts-published'],
      manifest,
    );
    const report = evaluate();
    assert.equal(report.verdict, 'NO_GO', reason);
    assert.equal(report.artifactManifestDigest, null);
    assert.ok(
      familyResult(report, 'E.artifacts-published').problems.some((problem) =>
        problem.includes(reason),
      ),
      reason,
    );
  }
});

test('a rehashed manifest cannot substitute either tool-lock-pinned base image', (t) => {
  const { evaluate, receipts, repo } = setup(t, { fresh: true });
  for (const name of ['runtime', 'nativeLibraries']) {
    const manifest = structuredClone(repo.manifest);
    manifest.baseImages[name] = LOCKED_BASE_IMAGES[name].replace(
      DIGEST,
      `sha256:${'f'.repeat(64)}`,
    );
    receipts['ext.production-authorization'].details.artifactManifestDigest = replaceManifest(
      repo,
      receipts['E.artifacts-published'],
      manifest,
    );
    const report = evaluate();
    assert.equal(report.verdict, 'NO_GO', name);
    assert.equal(report.artifactManifestDigest, null);
    assert.match(
      familyResult(report, 'E.artifacts-published').problems.join(),
      new RegExp(`base image ${name} differs from the pinned tool lock`),
    );
  }
});

test('manifest evidence and its canonical digest are both immutable receipt inputs', (t) => {
  const { evaluate, receipts, repo } = setup(t, { fresh: true });
  const manifest = structuredClone(repo.manifest);
  manifest.manifestDigest = `sha256:${'e'.repeat(64)}`;
  replaceManifest(repo, receipts['E.artifacts-published'], manifest, { rehash: false });
  assert.match(
    familyResult(evaluate(), 'E.artifacts-published').problems.join(),
    /canonical digest/,
  );
  replaceManifest(repo, receipts['E.artifacts-published'], repo.manifest);
  assert.equal(evaluate().verdict, 'GO');
  writeFileSync(path.join(repo.dir, MANIFEST_PATH), `${JSON.stringify(repo.manifest)}\n`);
  const report = evaluate();
  assert.equal(report.verdict, 'NO_GO');
  assert.match(familyResult(report, 'E.artifacts-published').problems.join(), /unchanged, hashed/);
});

test('malformed full manifest evidence is a blocker without crashing the barrier', (t) => {
  const { evaluate, receipts, repo } = setup(t, { fresh: true });
  for (const malformed of [null, [], 'manifest', { ...repo.manifest, artifacts: [null] }]) {
    replaceManifest(repo, receipts['E.artifacts-published'], malformed);
    const report = evaluate();
    assert.equal(report.verdict, 'NO_GO');
    assert.equal(report.artifactManifestDigest, null);
    assert.match(familyResult(report, 'E.artifacts-published').problems.join(), /OBJECT_REQUIRED/);
  }
});

test('authorization uses the complete manifest digest rather than a separately hashed artifact map', (t) => {
  const { evaluate, receipts, repo } = setup(t);
  const mapDigest = manifestDigest(artifactDigests(repo.manifest));
  assert.notEqual(mapDigest, repo.manifest.manifestDigest);
  receipts['ext.production-authorization'].details.artifactManifestDigest = mapDigest;
  assert.match(
    familyResult(evaluate(), 'ext.production-authorization').problems.join(),
    /different artifact manifest/,
  );
});

test('a failed artifact receipt or partial digest map cannot anchor production authorization', (t) => {
  const { evaluate, receipts } = setup(t);
  const receipt = receipts['E.artifacts-published'];
  receipt.status = 'FAILED';
  let report = evaluate();
  assert.equal(report.artifactManifestDigest, null);
  assert.equal(report.verdict, 'NO_GO');
  receipt.status = 'PASSED';
  delete receipt.artifacts['billing/migration'];
  report = evaluate();
  assert.equal(report.artifactManifestDigest, null);
  assert.equal(report.verdict, 'NO_GO');
  assert.match(
    familyResult(report, 'ext.production-authorization').problems.join(),
    /no validated/,
  );
});

test('cross-family artifact maps must use canonical role-qualified keys and cannot be null', (t) => {
  const { evaluate, receipts } = setup(t);
  const receipt = receipts['E.recovery-rehearsal'];
  for (const artifacts of [null, [], { billing: DIGEST }, { 'billing/unknown': DIGEST }]) {
    receipt.artifacts = artifacts;
    assert.equal(familyResult(evaluate(), 'E.recovery-rehearsal').status, 'INVALID');
  }
  receipt.artifacts = { 'billing/runtime': DIGEST, 'billing/migration': DIGEST };
  assert.equal(evaluate().verdict, 'GO');
});

test('configuration cannot be omitted or forged consistently across candidate and receipts', (t) => {
  const { evaluate, candidate, receipts } = setup(t);
  delete receipts['E.design-lock'].configDigest;
  assert.match(
    familyResult(evaluate(), 'E.design-lock').problems.join(),
    /must declare its configuration/,
  );
  const forged = `sha256:${'e'.repeat(64)}`;
  for (const receipt of Object.values(receipts)) receipt.configDigest = forged;
  const report = evaluate({ candidate: { ...candidate, configDigest: forged } });
  assert.equal(report.verdict, 'NO_GO');
  assert.equal(
    report.candidateChecks.find((check) => check.check === 'candidate-configuration').status,
    'FAILED',
  );
});

test('the candidate git policy cannot be replaced with a policy that omits a mandatory family', (t) => {
  const { evaluate, receipts } = setup(t);
  const changedPolicy = {
    ...policy,
    families: policy.families.filter((family) => family.id !== 'review.independent'),
  };
  delete receipts['review.independent'];
  const report = evaluate({ policy: changedPolicy });
  assert.equal(report.verdict, 'NO_GO');
  assert.equal(
    report.candidateChecks.find((check) => check.check === 'candidate-release-policy').status,
    'FAILED',
  );
});

test('authorization: expired, not-yet-valid, wrong manifest or unstated live-money scope', (t) => {
  const { evaluate, receipts } = setup(t);
  assert.match(
    familyResult(
      evaluate({ now: Date.parse('2026-10-12T00:00:00Z') }),
      'ext.production-authorization',
    ).problems.join(),
    /not valid now/,
  );
  assert.match(
    familyResult(
      evaluate({ now: Date.parse('2026-10-10T23:59:59Z') }),
      'ext.production-authorization',
    ).problems.join(),
    /not valid now/,
  );
  receipts['ext.production-authorization'].details.artifactManifestDigest =
    `sha256:${'9'.repeat(64)}`;
  delete receipts['ext.production-authorization'].details.scope.liveMoney;
  const problems = familyResult(evaluate(), 'ext.production-authorization').problems.join();
  assert.match(problems, /different artifact manifest/);
  assert.match(problems, /liveMoney/);
});

test('any receipt naming a different artifact digest breaks identical-digest deployment', (t) => {
  const { evaluate, receipts } = setup(t);
  receipts['E.recovery-rehearsal'].artifacts = { 'gateway/runtime': `sha256:${'d'.repeat(64)}` };
  assert.match(
    familyResult(evaluate(), 'E.recovery-rehearsal').problems.join(),
    /differs from the published manifest/,
  );
});

test('a conflicting artifact manifest anchors nothing and authorization cannot match it', (t) => {
  const { evaluate, receipts } = setup(t);
  const list = Object.entries(receipts).map(([id, receipt]) => ({ source: id, receipt }));
  list.push({ source: 'dup.json', receipt: receipts['E.artifacts-published'] });
  const report = evaluate({ receipts: list });
  assert.equal(report.artifactManifestDigest, null);
  assert.equal(familyResult(report, 'E.artifacts-published').status, 'CONFLICT');
  assert.equal(report.verdict, 'NO_GO');
});

test('secret values are rejected; store references are accepted', (t) => {
  const { evaluate, receipts } = setup(t);
  assert.deepEqual(findSecretMaterial({ references: [{ name: 'x', ref: 'vault://a/b' }] }), []);
  receipts['ext.secrets-provisioned'].details.references.push({
    name: 'psp',
    ref: 'plain',
    password: 'hunter2',
  });
  const problems = familyResult(evaluate(), 'ext.secrets-provisioned').problems.join();
  assert.match(problems, /secret material at \$\.details\.references\[1\]\.password/);
  assert.match(problems, /reference 1 must be/);
});

test('incident contacts must be two distinct named people with channels', (t) => {
  const { evaluate, receipts } = setup(t);
  receipts['ext.incident-contacts'].details.backup = {
    name: ' primary person ',
    channel: 'pager://x',
  };
  assert.match(
    familyResult(evaluate(), 'ext.incident-contacts').problems.join(),
    /different people/,
  );
  delete receipts['ext.incident-contacts'].details.backup;
  assert.match(
    familyResult(evaluate(), 'ext.incident-contacts').problems.join(),
    /backup incident contact/,
  );
});

test('operating window policy needs approver, duration and finite thresholds; none are defaulted', (t) => {
  const { evaluate, receipts } = setup(t);
  receipts['ext.operating-window-policy'].details = {
    approvedBy: 'owner',
    durationMinutes: 0,
    thresholds: {
      latency: { bound: 'max', limit: Number.POSITIVE_INFINITY, onBreach: 'rollback' },
    },
  };
  const problems = familyResult(evaluate(), 'ext.operating-window-policy').problems.join();
  assert.match(problems, /durationMinutes/);
  assert.match(problems, /maxSampleGapMinutes/);
  assert.match(problems, /threshold latency/);
});

test('config digest drift and future-dated receipts are invalid', (t) => {
  const { evaluate, receipts } = setup(t);
  receipts['E.migration-rehearsal'].configDigest = `sha256:${'1'.repeat(64)}`;
  receipts['E.contract-compatibility'].producedAt = '2026-10-11T13:00:00.000Z';
  const report = evaluate();
  assert.match(
    familyResult(report, 'E.migration-rehearsal').problems.join(),
    /configuration digest/,
  );
  assert.match(familyResult(report, 'E.contract-compatibility').problems.join(), /future/);
});

test('malformed candidate input is refused outright', (t) => {
  const { evaluate, candidate } = setup(t);
  assert.throws(() => evaluate({ candidate: { ...candidate, refs: {} } }), BarrierInputError);
  assert.throws(() => evaluate({ candidate: { ...candidate, sha: 'abc' } }), BarrierInputError);
  assert.throws(() => evaluate({ now: Number.NaN }), BarrierInputError);
});

test('canonical manifest digest ignores key order', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: [3] } }),
    canonicalJson({ a: { c: [3], d: 2 }, b: 1 }),
  );
});

test('evidence digest reads the inspected file even if its pathname is replaced', (t) => {
  const repo = fixtureRepo(t);
  const target = path.join(repo.dir, 'evidence/run.log');
  const originalFstat = fs.fstatSync;
  let replaced = false;
  t.mock.method(fs, 'fstatSync', (fd) => {
    const result = originalFstat(fd);
    renameSync(target, `${target}.original`);
    writeFileSync(target, 'substituted output\n');
    replaced = true;
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.equal(evidenceDigester(repo.dir)('evidence/run.log'), repo.evidence[0].sha256);
  assert.equal(replaced, true);
  assert.equal(readFileSync(target, 'utf8'), 'substituted output\n');
});

test('evidence digest refuses missing, directory, traversal and outside symlink paths', (t) => {
  const repo = fixtureRepo(t);
  const outside = mkdtempSync(path.join(tmpdir(), 'release-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(path.join(outside, 'outside.log'), 'outside evidence\n');
  const digest = evidenceDigester(repo.dir);
  assert.equal(digest('evidence/missing.log'), null);
  assert.equal(digest('evidence'), null);
  assert.equal(digest('../outside.log'), null);
  symlinkSync(outside, path.join(repo.dir, 'outside'), 'junction');
  assert.equal(digest('outside/outside.log'), null);
});

test('receipt creation refuses a competing writer arriving at the write operation', (t) => {
  const repo = fixtureRepo(t);
  const receipts = path.join(repo.dir, 'release/receipts');
  const receiptPath = path.join(receipts, 'E.design-lock.json');
  const hook = path.join(repo.dir, 'competing-writer.mjs');
  writeFileSync(
    hook,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.writeFileSync;
fs.writeFileSync = (file, ...args) => {
  if (file === ${JSON.stringify(receiptPath)}) {
    original(file, 'competing receipt\\n', { flag: 'wx' });
  }
  return original(file, ...args);
};
syncBuiltinESMExports();
`,
  );
  sh(repo.dir, 'add', 'competing-writer.mjs');
  sh(repo.dir, 'commit', '-q', '-m', 'tracked test hook');
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      hook,
      path.join(repoRoot, 'scripts/production/E/release-receipt.mjs'),
      'run',
      '--root',
      repo.dir,
      '--family',
      'E.design-lock',
      '--receipts',
      receipts,
      '--evidence-dir',
      path.join(repo.dir, 'release/evidence'),
      '--',
      process.execPath,
      '-e',
      '',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /exists; remove it deliberately/);
  assert.equal(readFileSync(receiptPath, 'utf8'), 'competing receipt\n');
});

test('CLI artifact receipt with the full 42-artifact manifest is directly consumable by the barrier', (t) => {
  const { repo, receipts, evaluate } = setup(t, { fresh: true });
  const receiptsDirectory = path.join(repo.dir, 'release/generated-receipts');
  const run = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts/production/E/release-receipt.mjs'),
      'run',
      '--root',
      repo.dir,
      '--family',
      'E.artifacts-published',
      '--artifact-manifest',
      MANIFEST_PATH,
      '--receipts',
      receiptsDirectory,
      '--evidence-dir',
      path.join(repo.dir, 'release/evidence'),
      '--',
      process.execPath,
      '-e',
      'console.log("synthetic registry verification fixture")',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  const generated = JSON.parse(
    readFileSync(path.join(receiptsDirectory, 'E.artifacts-published.json'), 'utf8'),
  );
  assert.equal(generated.details.manifestPath, MANIFEST_PATH);
  assert.ok(
    generated.evidence.some(
      (item) => item.path === MANIFEST_PATH && item.sha256 === repo.manifestEvidence.sha256,
    ),
  );
  receipts['E.artifacts-published'] = generated;
  const now = Date.now();
  for (const [id, receipt] of Object.entries(receipts))
    if (id !== 'E.artifacts-published') receipt.producedAt = new Date(now - 60_000).toISOString();
  receipts['ext.production-authorization'].details.notBefore = new Date(now - 60_000).toISOString();
  receipts['ext.production-authorization'].details.expiresAt = new Date(now + 60_000).toISOString();
  const report = evaluate({ now });
  assert.equal(report.verdict, 'GO', JSON.stringify(report.blockers, null, 2));
  assert.equal(report.artifactManifestDigest, repo.manifest.manifestDigest);
});

test('CLI: receipt producer binds the exact tree, and barrier exits 2 on NO_GO', (t) => {
  const repo = fixtureRepo(t);
  const producer = path.join(repoRoot, 'scripts/production/E/release-receipt.mjs');
  const barrier = path.join(repoRoot, 'scripts/production/E/release-barrier.mjs');
  const node = process.execPath;
  const candidatePath = path.join(repo.dir, 'release/candidate.json');
  const cand = spawnSync(
    node,
    [producer, 'candidate', '--root', repo.dir, '--ref', 'refs/heads/main', '--out', candidatePath],
    { encoding: 'utf8' },
  );
  assert.equal(cand.status, 0, cand.stderr);
  const written = JSON.parse(readFileSync(candidatePath, 'utf8'));
  assert.equal(written.sha, repo.sha);
  assert.equal(written.tree, repo.tree);
  assert.match(written.configDigest, /^sha256:[0-9a-f]{64}$/);

  const receipts = path.join(repo.dir, 'release/receipts');
  const evidence = path.join(repo.dir, 'release/evidence');
  const ok = spawnSync(
    node,
    [
      producer,
      'run',
      '--root',
      repo.dir,
      '--family',
      'E.design-lock',
      '--receipts',
      receipts,
      '--evidence-dir',
      evidence,
      '--',
      node,
      '-e',
      'console.log("lock ok")',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(ok.status, 0, ok.stderr);
  const receipt = JSON.parse(readFileSync(path.join(receipts, 'E.design-lock.json'), 'utf8'));
  assert.equal(receipt.status, 'PASSED');
  assert.deepEqual(receipt.rc, { sha: repo.sha, tree: repo.tree });
  const log = readFileSync(path.join(repo.dir, receipt.evidence[0].path));
  assert.equal(receipt.evidence[0].sha256, `sha256:${sha256Hex(log)}`);
  assert.match(log.toString(), /lock ok/);

  const again = spawnSync(
    node,
    [
      producer,
      'run',
      '--root',
      repo.dir,
      '--family',
      'E.design-lock',
      '--receipts',
      receipts,
      '--evidence-dir',
      evidence,
      '--',
      node,
      '-e',
      '',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(again.status, 1);
  assert.match(again.stderr, /exists; remove it deliberately/);

  const failed = spawnSync(
    node,
    [
      producer,
      'run',
      '--root',
      repo.dir,
      '--family',
      'E.security-scans',
      '--receipts',
      receipts,
      '--evidence-dir',
      evidence,
      '--',
      node,
      '-e',
      'process.exit(3)',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(failed.status, 2);
  assert.equal(
    JSON.parse(readFileSync(path.join(receipts, 'E.security-scans.json'), 'utf8')).status,
    'FAILED',
  );

  writeFileSync(path.join(repo.dir, 'source.txt'), 'dirty\n');
  const dirty = spawnSync(
    node,
    [
      producer,
      'run',
      '--root',
      repo.dir,
      '--family',
      'E.ci-mandatory',
      '--receipts',
      receipts,
      '--evidence-dir',
      evidence,
      '--',
      node,
      '-e',
      '',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /tracked files are modified/);
  assert.equal(existsSync(path.join(receipts, 'E.ci-mandatory.json')), false);

  const out = path.join(repo.dir, 'release/report.json');
  const run = spawnSync(
    node,
    [
      barrier,
      '--root',
      repo.dir,
      '--candidate',
      candidatePath,
      '--receipts',
      receipts,
      '--out',
      out,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 2, run.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.verdict, 'NO_GO');
  assert.equal(familyResult(report, 'E.design-lock').status, 'PASSED');
  assert.equal(familyResult(report, 'E.security-scans').status, 'FAILED');
  assert.match(readFileSync(out.replace(/\.json$/, '.md'), 'utf8'), /# Release barrier: NO_GO/);

  const bad = spawnSync(node, [barrier, '--root', repo.dir, '--receipts', receipts], {
    encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
});
