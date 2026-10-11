import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImage } from '../../scripts/check-images.mjs';

const nodeTag = 'node:24.21.0-bookworm-slim';
const mirror = 'public.ecr.aws/docker/library';
const digest = `sha256:${'a'.repeat(64)}`;
const ok = (stdout = '') => ({ code: 0, outcome: 'exited', stdout, stderr: '' });
const failed = (stderr) => ({ code: 1, outcome: 'exited', stdout: '', stderr });

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
  'Sprint image gate falls back from a rate-limited mirror and builds the acquired digest',
  async () => {
    const calls = [];
    const built = await buildImage('catalog', 'cw-test:run', async (args) => {
      calls.push(args);
      if (args[0] === 'pull' && args[1].startsWith(mirror)) {
        return failed('429 Too Many Requests - toomanyrequests: Data limit exceeded');
      }
      if (args[0] === 'image') return ok(JSON.stringify([`node@${digest}`]));
      return ok();
    });
    assert.equal(built.code, 0);
    assert.equal(built.baseImage, `node@${digest}`);
    assert.deepEqual(calls.slice(0, 3), [
      ['pull', `${mirror}/${nodeTag}`],
      ['pull', nodeTag],
      ['image', 'inspect', '--format', '{{json .RepoDigests}}', nodeTag],
    ]);
    assert.deepEqual(calls[3], [
      'build',
      '--file',
      'Dockerfile',
      '--build-arg',
      'SERVICE=catalog',
      '--build-arg',
      `NODE_IMAGE=node@${digest}`,
      '--tag',
      'cw-test:run',
      '.',
    ]);
  },
);

imageTest('successful mirror acquisition retains the mirror digest for the build', async () => {
  const calls = [];
  const baseImage = `${mirror}/node@${digest}`;
  const built = await buildImage('catalog', 'cw-test:run', async (args) => {
    calls.push(args);
    return args[0] === 'image' ? ok(JSON.stringify([baseImage])) : ok();
  });
  assert.equal(built.baseImage, baseImage);
  assert.equal(calls.filter((args) => args[0] === 'pull').length, 1);
  assert.ok(calls.at(-1).includes(`NODE_IMAGE=${baseImage}`));
});

imageTest(
  'application build failures remain failures and are not retried against another registry',
  async () => {
    const calls = [];
    const built = await buildImage('catalog', 'cw-test:run', async (args) => {
      calls.push(args);
      if (args[0] === 'image') return ok(JSON.stringify([`${mirror}/node@${digest}`]));
      if (args[0] === 'build') return failed('RUN pnpm build: TypeScript compilation failed');
      return ok();
    });
    assert.equal(built.code, 1);
    assert.match(built.stderr, /TypeScript compilation failed/);
    assert.equal(calls.filter((args) => args[0] === 'build').length, 1);
    assert.equal(calls.filter((args) => args[0] === 'pull').length, 1);
  },
);

imageTest('exhausted image acquisition fails before inspecting or building', async () => {
  const calls = [];
  await assert.rejects(
    buildImage('catalog', 'cw-test:run', async (args) => {
      calls.push(args);
      return failed('toomanyrequests: Rate exceeded');
    }),
    /IMAGE_PULL_FAILED/,
  );
  assert.deepEqual(
    calls.map((args) => args[0]),
    ['pull', 'pull'],
  );
});

for (const digests of [[], ['node:latest'], ['node@sha256:invalid'], [`unrelated@${digest}`]]) {
  imageTest(
    `invalid acquired digest ${JSON.stringify(digests)} cannot reach the build`,
    async () => {
      const calls = [];
      await assert.rejects(
        buildImage('catalog', 'cw-test:run', async (args) => {
          calls.push(args);
          return args[0] === 'image' ? ok(JSON.stringify(digests)) : ok();
        }),
        /Node base.*digest/,
      );
      assert.ok(calls.every((args) => args[0] !== 'build'));
    },
  );
}

imageTest(
  'digest selection ignores unrelated repositories and accepts the acquired repository',
  async () => {
    const baseImage = `${mirror}/node@${digest}`;
    const built = await buildImage('catalog', 'cw-test:run', async (args) => {
      if (args[0] === 'image') return ok(JSON.stringify([`other-image@${digest}`, baseImage]));
      return ok();
    });
    assert.equal(built.baseImage, baseImage);
  },
);

imageTest(
  'Docker Hub canonical repository spelling still identifies the acquired Node image',
  async () => {
    const baseImage = `docker.io/library/node@${digest}`;
    const built = await buildImage('catalog', 'cw-test:run', async (args) => {
      if (args[0] === 'pull' && args[1].startsWith(mirror)) return failed('Rate exceeded');
      if (args[0] === 'image') return ok(JSON.stringify([baseImage]));
      return ok();
    });
    assert.equal(built.baseImage, baseImage);
  },
);

imageTest('failed local image inspection cannot reach the build', async () => {
  const calls = [];
  await assert.rejects(
    buildImage('catalog', 'cw-test:run', async (args) => {
      calls.push(args);
      return args[0] === 'image' ? failed('No such image') : ok();
    }),
    /Cannot inspect acquired Node base/,
  );
  assert.ok(calls.every((args) => args[0] !== 'build'));
});
