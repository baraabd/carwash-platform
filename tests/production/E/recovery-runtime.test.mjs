import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireDrillImage } from '../../../scripts/production/E/recovery/image-acquisition.mjs';
import { main } from '../../../scripts/production/E/recovery/drill.mjs';

const digest = `sha256:${'b'.repeat(64)}`;
const mirror = 'public.ecr.aws/docker/library';
const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const limited = () => ({ code: 1, stdout: '', stderr: 'toomanyrequests: Rate exceeded' });

function imageTest(name, fn) {
  test(name, async () => {
    const values = {
      CW_PREFER_OFFICIAL_IMAGE_MIRROR: 'true',
      CW_OFFICIAL_IMAGE_MIRRORS: mirror,
    };
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, values);
      await fn();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
}

imageTest(
  'recovery image layer rate limits fall back using the already resolved digest',
  async () => {
    const calls = [];
    const reference = await acquireDrillImage('node:24.21.0-bookworm-slim', async (cmd, args) => {
      assert.equal(cmd, 'docker');
      calls.push(args);
      if (args[0] === 'buildx') return ok(JSON.stringify({ digest }));
      return args.at(-1).startsWith(mirror) ? limited() : ok();
    });
    assert.equal(reference, `node@${digest}`);
    assert.deepEqual(calls.slice(1), [
      ['pull', '--quiet', `${mirror}/node@${digest}`],
      ['pull', '--quiet', `node@${digest}`],
    ]);
    assert.equal(calls.filter((args) => args[0] === 'buildx').length, 1);
  },
);

imageTest('metadata failures allow another registry to resolve the fixed version', async () => {
  const calls = [];
  const reference = await acquireDrillImage('redis:8.2.10-alpine', async (_, args) => {
    calls.push(args);
    if (args[0] === 'buildx') {
      return args[3].startsWith(mirror) ? limited() : ok(JSON.stringify({ digest }));
    }
    return ok();
  });
  assert.equal(reference, `${mirror}/redis@${digest}`);
  assert.equal(calls[1][3], 'redis:8.2.10-alpine');
  assert.equal(calls.length, 3);
});

imageTest(
  'third-party images stay in their own repositories and remain digest-pinned',
  async () => {
    const calls = [];
    const reference = await acquireDrillImage('prom/prometheus:v3.5.0', async (_, args) => {
      calls.push(args);
      return args[0] === 'buildx' ? ok(JSON.stringify({ digest })) : ok();
    });
    assert.equal(reference, `prom/prometheus@${digest}`);
    assert.equal(calls[0][3], 'prom/prometheus:v3.5.0');
    assert.deepEqual(calls[1], ['pull', '--quiet', reference]);
  },
);

imageTest('exhausted layer pulls fail without resolving a replacement mutable tag', async () => {
  const calls = [];
  await assert.rejects(
    acquireDrillImage('postgres:16.10-alpine', async (_, args) => {
      calls.push(args);
      return args[0] === 'buildx' ? ok(JSON.stringify({ digest })) : limited();
    }),
    /IMAGE_PULL_FAILED/,
  );
  assert.equal(calls.filter((args) => args[0] === 'buildx').length, 1);
  assert.equal(calls.filter((args) => args[0] === 'pull').length, 2);
});

imageTest('malformed image digests fail before acquisition', async () => {
  const calls = [];
  await assert.rejects(
    acquireDrillImage('postgres:16.10-alpine', async (_, args) => {
      calls.push(args);
      return ok(JSON.stringify({ digest: 'sha256:invalid' }));
    }),
    /Invalid image digest/,
  );
  assert.equal(calls.length, 1);
});

test('an image preparation failure still writes a truthful failed recovery report', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'cw-recovery-report-test-'));
  const reportFile = path.join(work, 'evidence', 'recovery.json');
  try {
    const report = await main({
      argv: ['--report', reportFile],
      resolveImage: async () => {
        throw new Error('image acquisition unavailable');
      },
    });
    assert.equal(report.accepted, false);
    assert.match(report.failures.preparation, /image acquisition unavailable/);
    assert.deepEqual(report.components, {});
    assert.ok(report.finishedAt);
    assert.deepEqual(JSON.parse(readFileSync(reportFile, 'utf8')), report);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
