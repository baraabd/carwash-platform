import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOfficialLibraryImage,
  officialImagePullCandidates,
  pullImageWithMirrors,
} from '../../scripts/lib/image-references.mjs';

async function withEnv(values, fn) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('official image mirrors prefer Docker Hub locally and a mirror in CI', async () => {
  await withEnv(
    {
      CI: undefined,
      CW_PREFER_OFFICIAL_IMAGE_MIRROR: undefined,
      CW_OFFICIAL_IMAGE_MIRRORS: undefined,
    },
    async () => {
      assert.deepEqual(officialImagePullCandidates('postgres:16.10-alpine'), [
        'postgres:16.10-alpine',
        'public.ecr.aws/docker/library/postgres:16.10-alpine',
      ]);
    },
  );

  await withEnv({ CI: 'true', CW_PREFER_OFFICIAL_IMAGE_MIRROR: undefined }, async () => {
    assert.deepEqual(officialImagePullCandidates('node:24.21.0-bookworm-slim'), [
      'public.ecr.aws/docker/library/node:24.21.0-bookworm-slim',
      'node:24.21.0-bookworm-slim',
    ]);
  });
});

test('non-official images are never remapped to the official library mirror', () => {
  assert.equal(isOfficialLibraryImage('gcr.io/distroless/base-nossl-debian13@sha256:abc'), false);
  assert.deepEqual(
    officialImagePullCandidates(
      'chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d',
    ),
    ['chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d'],
  );
});

test('mirror pulls are tagged back to the canonical image name', async () => {
  await withEnv({ CI: 'true', CW_PREFER_OFFICIAL_IMAGE_MIRROR: undefined }, async () => {
    const calls = [];
    const result = await pullImageWithMirrors('postgres:16.10-alpine', async (args) => {
      calls.push(args);
      return { code: 0, outcome: 'exited', stdout: '', stderr: '' };
    });

    assert.equal(result.pullReference, 'public.ecr.aws/docker/library/postgres:16.10-alpine');
    assert.deepEqual(calls, [
      ['pull', 'public.ecr.aws/docker/library/postgres:16.10-alpine'],
      ['tag', 'public.ecr.aws/docker/library/postgres:16.10-alpine', 'postgres:16.10-alpine'],
    ]);
  });
});
