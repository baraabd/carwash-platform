// Real disposable Git repositories and real producer subprocesses. These are
// local tooling regressions; no registry verification or launch is claimed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertExactSource,
  assertReportDestination,
  assertSameSource,
  SourceProvenanceError,
} from '../../../scripts/production/E/release/source-provenance.mjs';
import {
  assertCleanSource,
  sourceRecord,
} from '../../../scripts/production/E/release/build-release.mjs';
import { configDigest } from '../../../scripts/production/E/release/configuration.mjs';
import { releaseSourceContext, sha256Hex } from '../../../scripts/production/E/release/io.mjs';
import { manifestDigest, repositoryFor } from '../../../scripts/production/E/release/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PRODUCER = path.join(ROOT, 'scripts/production/E/release-receipt.mjs');
const digest = (c) => `sha256:${c.repeat(64)}`;
const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

function put(root, file, content) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'release-provenance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'provenance-fixture');
  git(root, 'config', 'user.email', 'provenance@test.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
  const files = {
    '.gitignore': '.acceptance/\ndist/\nnode_modules/\n',
    'source.txt': 'committed source\n',
    'package.json': '{}\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    Dockerfile: 'FROM scratch\n',
    'infra/web-runtime.mjs': 'export const runtime = true;\n',
    'infra/release/Dockerfile.migrate': 'FROM scratch\n',
    'scripts/ci/tools.lock.json': JSON.stringify({
      runtime: { image: `gcr.io/distroless/nodejs@${digest('e')}` },
      nativeLibraries: { image: `docker.io/library/node@${digest('f')}` },
    }),
    'architecture/service-catalog.json': JSON.stringify({
      services: [],
      gateway: {
        id: 'gateway',
        path: 'apps/api-gateway',
        runtimeImplementation: 'existing-health-only-shell',
      },
      apps: [],
    }),
    'architecture/release-barrier.json': readFileSync(
      path.join(ROOT, 'architecture/release-barrier.json'),
    ),
    'architecture/governance/main-ruleset.json': readFileSync(
      path.join(ROOT, 'architecture/governance/main-ruleset.json'),
    ),
  };
  for (const [file, content] of Object.entries(files)) put(root, file, content);
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'committed fixture');
  return { root, source: assertExactSource(root) };
}

function run(root, program, { family = 'E.design-lock', extra = [] } = {}) {
  return spawnSync(
    process.execPath,
    [
      PRODUCER,
      'run',
      '--root',
      root,
      '--family',
      family,
      '--receipts',
      path.join(root, 'release/receipts'),
      '--evidence-dir',
      path.join(root, 'release/evidence'),
      ...extra,
      '--',
      process.execPath,
      '-e',
      program,
    ],
    { encoding: 'utf8' },
  );
}

function receipt(root, family = 'E.design-lock') {
  return JSON.parse(readFileSync(path.join(root, 'release/receipts', `${family}.json`), 'utf8'));
}

test('all committed build inputs are guarded, including the web runtime and tool lock', (t) => {
  const { root, source } = fixture(t);
  const record = sourceRecord(root);
  assert.equal(record.sha, source.sha);
  assert.equal(record.tree, source.tree);
  assert.equal(record.configDigest, configDigest(root, source.sha));
  for (const file of [
    'infra/web-runtime.mjs',
    'scripts/ci/tools.lock.json',
    'architecture/service-catalog.json',
    'Dockerfile',
  ]) {
    put(root, file, 'changed\n');
    assert.throws(() => assertCleanSource(root), SourceProvenanceError, file);
    assert.throws(() => sourceRecord(root), /tracked files are modified/, file);
    git(root, 'restore', '--', file);
  }
  put(root, 'source.txt', 'staged change\n');
  git(root, 'add', 'source.txt');
  assert.throws(() => assertSameSource(root, source), /tracked files are modified/);
});

test('only generated reports may be untracked; new executable source is refused', (t) => {
  const { root, source } = fixture(t);
  for (const file of ['release/report.json', 'evidence/gate.log', '.acceptance/result.json'])
    put(root, file, '{}\n');
  assert.deepEqual(assertSameSource(root, source), source);
  for (const file of [
    'services/new/source.ts',
    'scripts/new-gate.mjs',
    'release/untracked-gate.mjs',
  ]) {
    put(root, file, 'export const uncommitted = true;\n');
    assert.throws(() => assertExactSource(root), /untracked source files/, file);
    rmSync(path.join(root, file));
  }
  assert.deepEqual(assertExactSource(root), source);
});

test('a different clean commit is source drift even when its tree is unchanged', (t) => {
  const { root, source } = fixture(t);
  git(root, 'commit', '--allow-empty', '-q', '-m', 'different commit');
  assert.equal(assertExactSource(root).tree, source.tree);
  assert.throws(() => assertSameSource(root, source), /commit or tree changed/);
});

test('receipt producer preserves failed evidence when a successful command edits tracked source', (t) => {
  const { root, source } = fixture(t);
  const result = run(
    root,
    "require('node:fs').writeFileSync('source.txt', 'changed'); console.log('gate completed');",
  );
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const recorded = receipt(root);
  assert.equal(recorded.status, 'FAILED');
  assert.deepEqual(recorded.rc, source);
  assert.match(recorded.problems.join('\n'), /source provenance: tracked files are modified/);
  const bytes = readFileSync(path.join(root, recorded.evidence[0].path));
  assert.equal(recorded.evidence[0].sha256, `sha256:${sha256Hex(bytes)}`);
  assert.match(bytes.toString(), /gate completed/);
});

test('successful commands cannot issue passing receipts after moving HEAD or adding source', (t) => {
  for (const program of [
    "require('node:child_process').execFileSync('git', ['commit', '--allow-empty', '-qm', 'moved']);",
    "require('node:fs').writeFileSync('untracked.mjs', 'export const added = true;');",
  ]) {
    const { root } = fixture(t);
    const result = run(root, program);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(receipt(root).status, 'FAILED');
    assert.match(receipt(root).problems.join('\n'), /source provenance/);
  }
});

test('clean gate output can produce reports and repeated source checks remain valid', (t) => {
  const { root, source } = fixture(t);
  const result = run(
    root,
    "const fs = require('node:fs'); fs.mkdirSync('release', {recursive:true}); fs.writeFileSync('release/gate.json', '{}');",
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(receipt(root).status, 'PASSED');
  assert.deepEqual(assertSameSource(root, source), source);
  const failed = run(root, 'process.exit(4)', { family: 'E.security-scans' });
  assert.equal(failed.status, 2);
  assert.equal(
    receipt(root, 'E.security-scans').status,
    'FAILED',
    'fixture-only exit 4 is never a passing receipt',
  );
});

test('dirty or untracked source refuses execution before a gate can run', (t) => {
  for (const file of ['source.txt', 'new-source.mjs']) {
    const { root } = fixture(t);
    put(root, file, 'not committed\n');
    const result = run(
      root,
      "require('node:fs').mkdirSync('release', {recursive:true}); require('node:fs').writeFileSync('release/ran.log', 'ran');",
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(root, 'release/ran.log')), false);
    assert.equal(existsSync(path.join(root, 'release/receipts/E.design-lock.json')), false);
  }
});

test('receipt outputs cannot introduce source after the provenance check', (t) => {
  for (const option of ['--receipts', '--evidence-dir']) {
    const { root, source } = fixture(t);
    const result = run(root, "require('node:fs').writeFileSync('source.txt', 'gate ran');", {
      extra: [option, path.join(root, 'services/new-output')],
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /report output must be inside/);
    assert.equal(readFileSync(path.join(root, 'source.txt'), 'utf8'), 'committed source\n');
    assert.deepEqual(assertExactSource(root), source);
  }
});

test('candidate output never overwrites source or an existing candidate', (t) => {
  const { root, source } = fixture(t);
  const candidate = (out) =>
    spawnSync(
      process.execPath,
      [PRODUCER, 'candidate', '--root', root, '--ref', 'refs/heads/main', '--out', out],
      { encoding: 'utf8' },
    );
  for (const out of ['source.txt', 'services/new/candidate.json', '../candidate.json']) {
    const result = candidate(out);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  }
  assert.equal(readFileSync(path.join(root, 'source.txt'), 'utf8'), 'committed source\n');
  assert.deepEqual(assertExactSource(root), source);
  assert.equal(candidate('release/candidate.json').status, 0);
  const bytes = readFileSync(path.join(root, 'release/candidate.json'));
  assert.equal(candidate('release/candidate.json').status, 1);
  assert.deepEqual(readFileSync(path.join(root, 'release/candidate.json')), bytes);
  assert.deepEqual(assertExactSource(root), source);
});

test('report paths refuse tracked templates and symlinked source directories', (t) => {
  const { root } = fixture(t);
  put(root, 'release/template.json', '{}\n');
  git(root, 'add', 'release/template.json');
  git(root, 'commit', '-q', '-m', 'tracked release template');
  assert.throws(() => assertReportDestination(root, 'release/template.json'), /tracked source/);
  symlinkSync(path.join(root, 'architecture'), path.join(root, 'release/alias'), 'dir');
  assert.throws(
    () => assertReportDestination(root, 'release/alias/report.json'),
    /resolves outside/,
  );
});

test('a generated-report filename cannot exempt an untracked symlink from source checks', (t) => {
  const { root } = fixture(t);
  mkdirSync(path.join(root, 'release'));
  symlinkSync('../source.txt', path.join(root, 'release/route.json'));
  assert.throws(() => assertExactSource(root), /untracked source files/);
});

test('a gate cannot reroute later evidence or receipts into source through a new symlink', (t) => {
  for (const route of ['release/route.json', '.acceptance/route']) {
    for (const option of ['--receipts', '--evidence-dir']) {
      const { root } = fixture(t);
      put(root, 'services/source.txt', 'untouched source\n');
      git(root, 'add', 'services/source.txt');
      git(root, 'commit', '-q', '-m', 'source directory');
      const program = `const fs = require('node:fs'); fs.mkdirSync(${JSON.stringify(path.dirname(route))}, {recursive:true}); fs.symlinkSync('../services', ${JSON.stringify(route)}, 'dir');`;
      const result = run(root, program, { extra: [option, route] });
      assert.equal(result.status, 1, `${option} ${route}: ${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /report output resolves outside/);
      assert.deepEqual(readdirSync(path.join(root, 'services')), ['source.txt']);
      assert.equal(
        readFileSync(path.join(root, 'services/source.txt'), 'utf8'),
        'untouched source\n',
      );
      assert.equal(existsSync(path.join(root, 'release/receipts/E.design-lock.json')), false);
    }
  }
});

function manifestFixture(root) {
  const context = releaseSourceContext(root, git(root, 'rev-parse', 'HEAD'));
  assert.ok(context, 'fixture has every committed release input');
  const registry = 'registry.invalid/fixture';
  const body = {
    kind: 'carwash.release-manifest',
    schemaVersion: 1,
    source: context.source,
    registry,
    baseImages: {
      node: `docker.io/library/node@${digest('d')}`,
      runtime: `gcr.io/distroless/nodejs@${digest('e')}`,
      nativeLibraries: `docker.io/library/node@${digest('f')}`,
    },
    artifacts: context.targets.map((target) => {
      const repository = repositoryFor(registry, target.id, 'runtime');
      return {
        id: target.id,
        kind: target.kind,
        role: 'runtime',
        repository,
        digest: digest('a'),
        reference: `${repository}@${digest('a')}`,
        platform: 'linux/amd64',
        attestations: {
          sbom: true,
          provenance: true,
          sbomSha256: digest('b'),
          provenanceSha256: digest('c'),
          registryAttestationManifests: 1,
        },
      };
    }),
  };
  const manifest = { ...body, manifestDigest: manifestDigest(body) };
  put(root, 'release/manifest.json', `${JSON.stringify(manifest)}\n`);
  return manifest;
}

test('artifact receipts bind the complete manifest as immutable hashed evidence', (t) => {
  const { root, source } = fixture(t);
  manifestFixture(root);
  const result = run(root, "console.log('local verification command fixture');", {
    family: 'E.artifacts-published',
    extra: ['--artifact-manifest', 'release/manifest.json'],
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const recorded = receipt(root, 'E.artifacts-published');
  assert.equal(recorded.status, 'PASSED');
  assert.deepEqual(recorded.rc, source);
  assert.deepEqual(recorded.details, { manifestPath: 'release/manifest.json' });
  assert.equal(recorded.evidence.length, 2);
  const evidence = recorded.evidence.find((item) => item.path === recorded.details.manifestPath);
  assert.equal(
    evidence.sha256,
    `sha256:${sha256Hex(readFileSync(path.join(root, evidence.path)))}`,
  );
});

test('a manifest changed during a successful verification command produces FAILED evidence', (t) => {
  const { root } = fixture(t);
  manifestFixture(root);
  const result = run(root, "require('node:fs').appendFileSync('release/manifest.json', ' ');", {
    family: 'E.artifacts-published',
    extra: ['--artifact-manifest', 'release/manifest.json'],
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const recorded = receipt(root, 'E.artifacts-published');
  assert.equal(recorded.status, 'FAILED');
  assert.match(recorded.problems.join('\n'), /manifest changed during verification/);
});

test('artifact receipt mode refuses missing, incomplete, unrelated or escaping manifests', (t) => {
  const { root } = fixture(t);
  const original = manifestFixture(root);
  const options = {
    family: 'E.artifacts-published',
    extra: ['--artifact-manifest', 'release/manifest.json'],
  };
  assert.equal(run(root, '', { family: 'E.artifacts-published' }).status, 1);
  for (const change of [
    (m) => {
      m.artifacts = [];
    },
    (m) => {
      m.source.sha = 'f'.repeat(40);
    },
    (m) => {
      m.baseImages.runtime = `gcr.io/distroless/nodejs@${digest('9')}`;
    },
  ]) {
    const manifest = structuredClone(original);
    change(manifest);
    const body = { ...manifest };
    delete body.manifestDigest;
    manifest.manifestDigest = manifestDigest(body);
    put(root, 'release/manifest.json', JSON.stringify(manifest));
    assert.equal(run(root, '', options).status, 1);
  }
  const outside = mkdtempSync(path.join(tmpdir(), 'release-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  put(outside, 'manifest.json', JSON.stringify(original));
  assert.equal(
    run(root, '', {
      family: 'E.artifacts-published',
      extra: ['--artifact-manifest', path.join(outside, 'manifest.json')],
    }).status,
    1,
  );
  rmSync(path.join(root, 'release/manifest.json'));
  symlinkSync(path.join(outside, 'manifest.json'), path.join(root, 'release/manifest.json'));
  assert.equal(run(root, '', options).status, 1);
});
