import assert from 'node:assert/strict';
import test from 'node:test';
import { pullRehearsalImage } from '../../../scripts/production/E/release/rehearsal-image.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
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

for (const tag of ['registry:3.0.0', 'postgres:16.10-alpine']) {
  imageTest(`${tag}: layer rate limiting falls back with the already resolved digest`, async () => {
    const calls = [];
    const name = tag.split(':')[0];
    const reference = await pullRehearsalImage(tag, async (args) => {
      calls.push(args);
      if (args[0] === 'buildx') return ok(JSON.stringify({ digest }));
      return args[1].startsWith(mirror) ? limited() : ok();
    });

    assert.equal(reference, `${name}@${digest}`);
    assert.deepEqual(calls, [
      ['buildx', 'imagetools', 'inspect', `${mirror}/${tag}`, '--format', '{{json .Manifest}}'],
      ['pull', `${mirror}/${name}@${digest}`],
      ['pull', `${name}@${digest}`],
    ]);
  });
}

imageTest(
  'manifest lookup failure can use the next registry before selecting a digest',
  async () => {
    const calls = [];
    const reference = await pullRehearsalImage('registry:3.0.0', async (args) => {
      calls.push(args);
      if (args[0] === 'buildx') {
        return args[3].startsWith(mirror) ? limited() : ok(JSON.stringify({ digest }));
      }
      return ok();
    });
    assert.equal(reference, `${mirror}/registry@${digest}`);
    assert.equal(calls.length, 3);
    assert.equal(calls[1][3], 'registry:3.0.0');
    assert.deepEqual(calls[2], ['pull', reference]);
  },
);

imageTest(
  'successful mirror acquisition returns its digest reference without retagging',
  async () => {
    const calls = [];
    const reference = await pullRehearsalImage('postgres:16.10-alpine', async (args) => {
      calls.push(args);
      return args[0] === 'buildx' ? ok(JSON.stringify({ digest })) : ok();
    });
    assert.equal(reference, `${mirror}/postgres@${digest}`);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], ['pull', reference]);
  },
);

imageTest('failure across all pulls is fatal and never re-resolves a mutable tag', async () => {
  const calls = [];
  await assert.rejects(
    pullRehearsalImage('registry:3.0.0', async (args) => {
      calls.push(args);
      return args[0] === 'buildx' ? ok(JSON.stringify({ digest })) : limited();
    }),
    (error) => {
      assert.match(error.message, /IMAGE_PULL_FAILED/);
      assert.ok(error.message.includes(`${mirror}/registry@${digest}`));
      assert.ok(error.message.includes(`registry@${digest}`));
      return true;
    },
  );
  assert.equal(calls.filter((args) => args[0] === 'buildx').length, 1);
  assert.equal(calls.filter((args) => args[0] === 'pull').length, 2);
});

imageTest('invalid manifest digests fail before any image can be pulled', async () => {
  const calls = [];
  await assert.rejects(
    pullRehearsalImage('registry:3.0.0', async (args) => {
      calls.push(args);
      return ok(JSON.stringify({ digest: 'sha256:invalid' }));
    }),
    /Invalid digest/,
  );
  assert.equal(calls.length, 1);
});

imageTest('exhausted manifest lookups retain both registry failures', async () => {
  await assert.rejects(
    pullRehearsalImage('registry:3.0.0', async () => limited()),
    (error) => {
      assert.match(error.message, /Cannot resolve registry:3.0.0 to a digest/);
      assert.ok(error.message.includes(`${mirror}/registry:3.0.0: toomanyrequests`));
      assert.ok(error.message.includes('\nregistry:3.0.0: toomanyrequests'));
      return true;
    },
  );
});
