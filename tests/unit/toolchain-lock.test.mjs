import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './_load.mjs';

/**
 * Regression tests for the toolchain and lockfile guards.
 *
 * A guard that never fails is indistinguishable from no guard at all, so each
 * rule is exercised against a fixture that violates it as well as one that does
 * not. The fixtures are built from the real repository's declarations and then
 * damaged one field at a time, which also means a fixture cannot drift away
 * from the shape the checker actually reads.
 *
 * These run the checkers as child processes because their contract with CI is
 * their exit code, not a return value.
 */

const TOOLCHAIN = path.join(ROOT, 'scripts/verify-toolchain.mjs');
const FROZEN = path.join(ROOT, 'scripts/verify-frozen-install.mjs');

/** Run a checker against a fixture root and report exit code plus output. */
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * A minimal but valid tree: the files the toolchain checker reads, carrying the
 * same pins the repository declares. `mutate` then damages it.
 */
async function withToolchainFixture(mutate, body) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cw-toolchain-'));
  try {
    await mkdir(path.join(dir, '.github/workflows'), { recursive: true });
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await mkdir(path.join(dir, 'docs'), { recursive: true });

    const files = {
      '.nvmrc': '24.21.0\n',
      'package.json': JSON.stringify(
        {
          name: 'fixture',
          private: true,
          packageManager: 'pnpm@10.32.1',
          engines: { node: '>=24 <25', pnpm: '>=10.32.1 <11' },
          devDependencies: { typescript: '5.9.3' },
        },
        null,
        2,
      ),
      '.npmrc': [
        'engine-strict=true',
        'package-manager-strict=true',
        'registry=https://registry.npmjs.org/',
        '',
      ].join('\n'),
      'pnpm-workspace.yaml':
        "packages:\n  - 'services/*'\n\nonlyBuiltDependencies:\n  - 'prisma'\n",
      'docs/DEPENDENCY_POLICY_AR.md': '| `prisma` | CLI | reviewed |\n',
      Dockerfile: 'ARG NODE_IMAGE=node:24.21.0-bookworm-slim\nFROM ${NODE_IMAGE}\n',
      '.github/workflows/ci.yml': [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/setup-node@abc',
        '        with:',
        '          node-version-file: .nvmrc',
        '',
      ].join('\n'),
    };
    await mutate(files);
    for (const [relative, contents] of Object.entries(files)) {
      if (contents === null) continue;
      await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
      await writeFile(path.join(dir, relative), contents);
    }
    // The checker derives the expected image from .nvmrc, so it must be run with
    // a matching observed runtime unless the test is about the runtime itself.
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const AT_PIN = ['--observed-node', '24.21.0', '--observed-pnpm', '10.32.1'];

test('the real repository satisfies its own toolchain declaration', async () => {
  const { code, output } = run(TOOLCHAIN, ['--config-only']);
  assert.equal(code, 0, `config checks must pass on the committed tree:\n${output}`);
  assert.match(output, /Authoritative toolchain: Node 24\.21\.0, pnpm 10\.32\.1/);
});

test('a clean fixture passes every group', async () => {
  await withToolchainFixture(
    () => {},
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 0, output);
    },
  );
});

test('a wrong running Node version fails', async () => {
  await withToolchainFixture(
    () => {},
    (dir) => {
      const { code, output } = run(TOOLCHAIN, [
        '--root',
        dir,
        '--observed-node',
        '20.18.1',
        '--observed-pnpm',
        '10.32.1',
      ]);
      assert.equal(code, 1);
      assert.match(output, /FAIL running Node matches \.nvmrc/);
      assert.match(output, /running 20\.18\.1, declared 24\.21\.0/);
    },
  );
});

test('a wrong running pnpm version fails', async () => {
  await withToolchainFixture(
    () => {},
    (dir) => {
      const { code, output } = run(TOOLCHAIN, [
        '--root',
        dir,
        '--observed-node',
        '24.21.0',
        '--observed-pnpm',
        '9.15.0',
      ]);
      assert.equal(code, 1);
      assert.match(output, /FAIL pnpm matches packageManager/);
    },
  );
});

test('a floating Node pin is not accepted as a pin', async () => {
  await withToolchainFixture(
    (files) => {
      files['.nvmrc'] = '24\n';
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL \.nvmrc is an exact version/);
    },
  );
});

test('a Node major outside the approved line fails', async () => {
  await withToolchainFixture(
    (files) => {
      files['.nvmrc'] = '22.14.0\n';
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL \.nvmrc is in the approved Node line/);
    },
  );
});

test('a pnpm major outside the approved line fails', async () => {
  await withToolchainFixture(
    (files) => {
      const manifest = JSON.parse(files['package.json']);
      manifest.packageManager = 'pnpm@12.6.0';
      manifest.engines.pnpm = '>=12.6.0 <13';
      files['package.json'] = JSON.stringify(manifest, null, 2);
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, [
        '--root',
        dir,
        '--observed-node',
        '24.21.0',
        '--observed-pnpm',
        '12.6.0',
      ]);
      assert.equal(code, 1);
      assert.match(output, /FAIL packageManager is in the approved pnpm line/);
    },
  );
});

test('an unbounded engines range fails', async () => {
  await withToolchainFixture(
    (files) => {
      const manifest = JSON.parse(files['package.json']);
      manifest.engines.node = '>=24';
      files['package.json'] = JSON.stringify(manifest, null, 2);
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL engines\.node is bounded/);
    },
  );
});

test('an engines range that excludes the pin fails', async () => {
  await withToolchainFixture(
    (files) => {
      const manifest = JSON.parse(files['package.json']);
      manifest.engines.node = '>=24.22.0 <25';
      files['package.json'] = JSON.stringify(manifest, null, 2);
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL engines\.node admits the pin/);
    },
  );
});

test('a prerelease in the core toolchain fails', async () => {
  await withToolchainFixture(
    (files) => {
      const manifest = JSON.parse(files['package.json']);
      manifest.devDependencies.typescript = '5.9.3';
      manifest.devDependencies.eslint = '11.0.0-rc.1';
      files['package.json'] = JSON.stringify(manifest, null, 2);
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL no prerelease in the root toolchain/);
    },
  );
});

test('a floating dependency range in the root toolchain fails', async () => {
  await withToolchainFixture(
    (files) => {
      const manifest = JSON.parse(files['package.json']);
      manifest.devDependencies.prettier = '^3.9.0';
      files['package.json'] = JSON.stringify(manifest, null, 2);
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL root toolchain versions are exact/);
    },
  );
});

test('a TypeScript older than the strict baseline fails', async () => {
  await withToolchainFixture(
    (files) => {
      const manifest = JSON.parse(files['package.json']);
      manifest.devDependencies.typescript = '5.8.3';
      files['package.json'] = JSON.stringify(manifest, null, 2);
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL TypeScript meets the strict baseline/);
    },
  );
});

test('a Dockerfile base image that drifts from .nvmrc fails', async () => {
  await withToolchainFixture(
    (files) => {
      files['Dockerfile'] = 'ARG NODE_IMAGE=node:24.12.0-bookworm-slim\nFROM ${NODE_IMAGE}\n';
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL Dockerfile base image matches \.nvmrc/);
      assert.match(output, /found "node:24\.12\.0-bookworm-slim"/);
    },
  );
});

test('a workflow that hardcodes a Node version instead of reading .nvmrc fails', async () => {
  await withToolchainFixture(
    (files) => {
      files['.github/workflows/ci.yml'] = [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/setup-node@abc',
        '        with:',
        "          node-version: '24'",
        '',
      ].join('\n');
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL ci\.yml reads \.nvmrc/);
      assert.match(output, /hardcoded node-version/);
    },
  );
});

test('dropping engine-strict from .npmrc fails', async () => {
  await withToolchainFixture(
    (files) => {
      files['.npmrc'] = 'package-manager-strict=true\nregistry=https://registry.npmjs.org/\n';
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL \.npmrc sets engine-strict=true/);
    },
  );
});

test('an unofficial registry fails', async () => {
  await withToolchainFixture(
    (files) => {
      files['.npmrc'] = [
        'engine-strict=true',
        'package-manager-strict=true',
        'registry=https://npm.internal.example/',
        '',
      ].join('\n');
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL \.npmrc sets registry=https:\/\/registry\.npmjs\.org\//);
    },
  );
});

test('enabling lifecycle scripts globally fails', async () => {
  await withToolchainFixture(
    (files) => {
      files['.npmrc'] += 'enable-pre-post-scripts=true\n';
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL lifecycle scripts are not enabled globally/);
    },
  );
});

test('an undocumented lifecycle-script exception fails', async () => {
  await withToolchainFixture(
    (files) => {
      files['pnpm-workspace.yaml'] =
        "packages:\n  - 'services/*'\n\nonlyBuiltDependencies:\n  - 'prisma'\n  - 'sharp'\n";
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL lifecycle-script exceptions are documented/);
      assert.match(output, /sharp/);
    },
  );
});

test('a workflow that opts out of the frozen lockfile fails', async () => {
  await withToolchainFixture(
    (files) => {
      files['.github/workflows/ci.yml'] += '      - run: pnpm install --no-frozen-lockfile\n';
    },
    (dir) => {
      const { code, output } = run(TOOLCHAIN, ['--root', dir, ...AT_PIN]);
      assert.equal(code, 1);
      assert.match(output, /FAIL nothing opts out of the frozen lockfile/);
    },
  );
});

/**
 * Lockfile audit fixtures.
 *
 * These copy the real lockfile and manifests, so the audit is exercised against
 * the shape pnpm actually emits rather than a hand-written imitation. Only the
 * offline audit runs here: a clean install needs the network and the store, and
 * belongs to the CI gate rather than the unit suite.
 */
async function withLockFixture(mutate, body) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cw-lock-'));
  try {
    for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.npmrc']) {
      await cp(path.join(ROOT, file), path.join(dir, file));
    }
    for (const group of ['packages', 'services']) {
      const base = path.join(ROOT, group);
      const { readdirSync, existsSync } = await import('node:fs');
      for (const name of readdirSync(base)) {
        const manifest = path.join(base, name, 'package.json');
        if (!existsSync(manifest)) continue;
        await mkdir(path.join(dir, group, name), { recursive: true });
        await cp(manifest, path.join(dir, group, name, 'package.json'));
      }
    }
    await mutate(dir);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

test('the committed lockfile passes the offline audit', async () => {
  const { code, output } = run(FROZEN, ['--audit-only']);
  assert.equal(code, 0, output);
  assert.match(output, /ok\s+every resolution carries a verifiable integrity hash/);
});

test('a hand-edited integrity hash is rejected', async () => {
  await withLockFixture(
    async (dir) => {
      const lockPath = path.join(dir, 'pnpm-lock.yaml');
      const text = await readFile(lockPath, 'utf8');
      // A plausible-looking but wrong-length hash: what a person types, never
      // what pnpm writes.
      await writeFile(
        lockPath,
        text.replace(/integrity: sha512-[^}]+\}/, 'integrity: sha512-notarealhash==}'),
      );
    },
    async (dir) => {
      const { code, output } = run(FROZEN, ['--root', dir, '--audit-only']);
      assert.equal(code, 1);
      assert.match(output, /FAIL every resolution carries a verifiable integrity hash/);
    },
  );
});

test('a manifest bumped without re-resolving is rejected', async () => {
  await withLockFixture(
    async (dir) => {
      const manifestPath = path.join(dir, 'package.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.devDependencies.typescript = '5.9.2';
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    },
    async (dir) => {
      const { code, output } = run(FROZEN, ['--root', dir, '--audit-only']);
      assert.equal(code, 1);
      assert.match(output, /FAIL locked specifiers match the manifests/);
      assert.match(output, /typescript declares 5\.9\.2, lockfile recorded 5\.9\.3/);
    },
  );
});

test('a security override removed from the root but left in the lockfile is rejected', async () => {
  await withLockFixture(
    async (dir) => {
      const manifestPath = path.join(dir, 'package.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      delete manifest.pnpm.overrides.multer;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    },
    async (dir) => {
      const { code, output } = run(FROZEN, ['--root', dir, '--audit-only']);
      assert.equal(code, 1);
      assert.match(output, /FAIL security overrides are recorded as declared/);
      assert.match(output, /multer/);
    },
  );
});

test('a workspace package missing from the lockfile is rejected', async () => {
  await withLockFixture(
    async (dir) => {
      await mkdir(path.join(dir, 'services/newcomer'), { recursive: true });
      await writeFile(
        path.join(dir, 'services/newcomer/package.json'),
        JSON.stringify({ name: '@carwash/newcomer', version: '0.0.1' }, null, 2),
      );
    },
    async (dir) => {
      const { code, output } = run(FROZEN, ['--root', dir, '--audit-only']);
      assert.equal(code, 1);
      assert.match(output, /FAIL every workspace package is resolved/);
      assert.match(output, /services\/newcomer/);
    },
  );
});
