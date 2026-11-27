import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, chmod, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildDefinitions,
  exact,
  privateFile,
  reconcile,
  SECTIONS,
} from '../../../infra/rabbitmq/hosted-definitions.mjs';

const manifest = JSON.parse(
  await readFile(
    new URL('../../../infra/rabbitmq/hosted-topology.v1.json', import.meta.url),
    'utf8',
  ),
);
const owners = [...new Set(manifest.requiredBrokerRoles.map((role) => role.owner))].sort();
const credentials = {
  schemaVersion: 1,
  vhost: 'hosted_fixture',
  usernamePrefix: 'cw_fixture_',
  passwords: Object.fromEntries(
    owners.map((owner) => [owner, 'explicit-test-fixture-only-password-for-' + owner]),
  ),
};
const clone = (value) => structuredClone(value);
const empty = () => ({
  schemaVersion: 1,
  vhost: credentials.vhost,
  definitions: {
    rabbitmq_version: '4.2.0',
    ...Object.fromEntries(SECTIONS.map((key) => [key, []])),
  },
  exchanges: [],
  queues: [],
  operatorPolicies: [],
});
function installed(definitions = buildDefinitions(manifest, credentials)) {
  return {
    schemaVersion: 1,
    vhost: credentials.vhost,
    definitions: { rabbitmq_version: '4.2.0', ...clone(definitions) },
    exchanges: [
      ...definitions.exchanges.map(({ name, type }) => ({ name, type, internal: false })),
      ...[
        ['', 'direct'],
        ['amq.direct', 'direct'],
        ['amq.fanout', 'fanout'],
        ['amq.headers', 'headers'],
        ['amq.match', 'headers'],
        ['amq.topic', 'topic'],
      ].map(([name, type]) => ({ name, type, internal: false })),
      { name: 'amq.rabbitmq.trace', type: 'topic', internal: true },
    ],
    queues: definitions.queues.map(({ name, type }) => ({ name, type, exclusive: false })),
    operatorPolicies: [],
  };
}
const allowed = (expression, value) => new RegExp(expression).test(value);

test('hosted inventory selects all required broker roles and no legacy consumer or invented Catalog sink', async () => {
  const runtime = JSON.parse(
    await readFile(new URL('../../../infra/runtime-processes.json', import.meta.url), 'utf8'),
  );
  for (const [kind, usesBroker] of [
    ['requiredBrokerRoles', true],
    ['requiredNonBrokerRoles', false],
  ]) {
    assert.deepEqual(
      manifest[kind],
      runtime.processes
        .filter(
          (entry) =>
            entry.deploymentMode === 'required' &&
            entry.requiredEnv.includes('BROKER_URL') === usesBroker,
        )
        .map(({ id, owner }) => ({ id, owner })),
    );
  }
  assert.equal(manifest.requiredBrokerRoles.length, 10);
  assert.equal(manifest.requiredNonBrokerRoles.length, 3);
  assert.equal(owners.length, 9);
  const definitions = buildDefinitions(manifest, credentials);
  assert.equal(definitions.exchanges.length, 12);
  assert.equal(definitions.queues.length, 11);
  assert.equal(definitions.bindings.length, 30);
  assert.equal(definitions.topic_permissions.length, 99);
  assert.equal(
    definitions.bindings.some((entry) => entry.source === 'catalog.events'),
    false,
  );
  assert.equal(
    definitions.queues.find((entry) => entry.name === 'wallet.billing-custody.dlq').type,
    'quorum',
  );
  assert.equal(definitions.policies.length, 1);
  for (const queue of definitions.queues) {
    assert.equal(
      allowed(definitions.policies[0].pattern, queue.name),
      manifest.consumers.some((entry) => entry.queue === queue.name),
    );
  }
});

test('all nine owners can declare and bind their native resources while financial and foreign authority stays denied', () => {
  const definitions = buildDefinitions(manifest, credentials);
  const grant = (owner) =>
    definitions.permissions.find((p) => p.user === credentials.usernamePrefix + owner + '_app');
  for (const producer of manifest.producers) {
    for (const owner of owners) {
      assert.equal(allowed(grant(owner).configure, producer.exchange), owner === producer.owner);
      assert.equal(allowed(grant(owner).write, producer.exchange), owner === producer.owner);
      assert.equal(allowed(grant(owner).write, 'amq.default'), false);
    }
    const topics = definitions.topic_permissions.find(
      (p) =>
        p.user === credentials.usernamePrefix + producer.owner + '_app' &&
        p.exchange === producer.exchange,
    );
    for (const key of producer.keys) assert.equal(allowed(topics.write, key), true);
    assert.equal(allowed(topics.write, '#'), false);
  }
  for (const consumer of manifest.consumers) {
    const permissions = grant(consumer.owner);
    for (const queue of [consumer.queue, consumer.dlq]) {
      assert.equal(allowed(permissions.configure, queue), true);
      assert.equal(allowed(permissions.write, queue), true);
    }
    assert.equal(allowed(permissions.read, consumer.queue), true);
    assert.equal(allowed(permissions.write, consumer.dlx), true);
    assert.equal(allowed(permissions.read, consumer.dlx), true);
    for (const binding of consumer.bindings) {
      assert.equal(allowed(permissions.read, binding.exchange), true);
      const topic = definitions.topic_permissions.find(
        (p) => p.user === permissions.user && p.exchange === binding.exchange,
      );
      for (const key of binding.keys) assert.equal(allowed(topic.read, key), true);
      assert.equal(allowed(topic.read, '#'), false);
    }
  }
  const wallet = grant('wallet');
  assert.equal(allowed(wallet.write, 'wallet.billing-custody.retry'), true);
  assert.equal(allowed(wallet.read, 'reporting.operations'), false);
  const billing = definitions.topic_permissions.find(
    (p) => p.user === grant('billing').user && p.exchange === 'washgo.billing.events',
  );
  assert.equal(allowed(billing.write, 'billing.refund-status-changed.v1'), false);
  const booking = definitions.topic_permissions.find(
    (p) => p.user === grant('booking').user && p.exchange === 'booking.events',
  );
  assert.equal(allowed(booking.write, 'booking.confirmed.v1'), false);
  assert.equal(allowed(exact(['a.b']), 'aXb'), false);
  for (const value of ['', 'amq.default', 'billing.cash-collected.v1', '#']) {
    assert.equal(allowed(exact([]), value), false);
  }
});

test('prepare is additive, replays preserve password hashes, and verify requires every desired resource', () => {
  const first = reconcile(manifest, credentials, empty());
  assert.equal(first.counts.users, 9);
  const complete = installed(first.definitions);
  const before = JSON.stringify(complete);
  assert.ok(
    Object.values(reconcile(manifest, credentials, complete, { verify: true }).counts).every(
      (count) => count === 0,
    ),
  );
  assert.equal(JSON.stringify(complete) === before, true);
  const partial = clone(complete);
  partial.definitions.bindings.pop();
  assert.equal(reconcile(manifest, credentials, partial).counts.bindings, 1);
  assert.throws(
    () => reconcile(manifest, credentials, partial, { verify: true }),
    /POST_IMPORT_INCOMPLETE/,
  );
  complete.definitions.users.push({
    name: 'unrelated-admin',
    tags: ['administrator'],
    password_hash: 'opaque-unrelated-hash',
  });
  complete.definitions.permissions.push({
    user: 'unrelated-admin',
    vhost: 'another_vhost',
    configure: '.*',
    write: '.*',
    read: '.*',
  });
  assert.equal(reconcile(manifest, credentials, complete, { verify: true }).counts.users, 0);
});

test('conflicting state fails closed without rewriting users, permissions, queues, bindings or policies', () => {
  const cases = [
    (s) => {
      s.definitions.users[0].tags = ['administrator'];
    },
    (s) => {
      s.definitions.vhosts[0].limits = { 'max-queues': 1 };
    },
    (s) => {
      s.definitions.users[0].password_hash = 'not-the-configured-password';
    },
    (s) => {
      s.definitions.permissions[0].write = '.*';
    },
    (s) => {
      s.definitions.topic_permissions[0].write = '.*';
    },
    (s) => {
      s.definitions.queues[0].arguments['x-message-ttl'] = 1000;
    },
    (s) => {
      s.definitions.bindings.push({ ...s.definitions.bindings[0], routing_key: '#' });
    },
    (s) => {
      s.definitions.policies.push({ ...s.definitions.policies[0], name: 'foreign-policy' });
    },
    (s) => {
      s.operatorPolicies.push({ name: 'override', definition: { overflow: 'drop-head' } });
    },
    (s) => {
      s.definitions.parameters.push({ vhost: credentials.vhost, component: 'shovel' });
    },
    (s) => {
      s.definitions.permissions.push({ ...s.definitions.permissions[0], vhost: 'foreign' });
    },
    (s) => {
      s.definitions.permissions.push({ ...s.definitions.permissions[0], user: 'unknown-user' });
    },
  ];
  for (const mutate of cases) {
    const snapshot = installed();
    mutate(snapshot);
    const before = JSON.stringify(snapshot);
    assert.throws(() => reconcile(manifest, credentials, snapshot));
    assert.equal(JSON.stringify(snapshot) === before, true);
  }
});

test('protected inspections reject hidden internal/exclusive resources and require a complete supported export', () => {
  for (const mutate of [
    (s) => {
      s.exchanges.push({ name: 'hidden.internal', type: 'topic', internal: true });
    },
    (s) => {
      s.exchanges.find((e) => e.name === 'amq.rabbitmq.trace').internal = false;
    },
    (s) => {
      s.exchanges.push({ name: 'amq.unknown', type: 'topic', internal: false });
    },
    (s) => {
      s.queues.push({ name: 'hidden.exclusive', type: 'classic', exclusive: true });
    },
    (s) => {
      delete s.definitions.topic_permissions;
    },
    (s) => {
      s.definitions.rabbitmq_version = '4.3.0';
    },
    (s) => {
      s.vhost = 'wrong_vhost';
    },
  ]) {
    const snapshot = installed();
    mutate(snapshot);
    assert.throws(() => reconcile(manifest, credentials, snapshot));
  }
  const quorumShape = installed();
  quorumShape.queues
    .filter((q) => q.type === 'quorum')
    .forEach((q) => {
      q.exclusive = '';
    });
  assert.equal(reconcile(manifest, credentials, quorumShape, { verify: true }).counts.queues, 0);
});

test('private file interface refuses symlinks, public modes and replacement; CLI failures never echo secret input', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hosted-broker-unit-'));
  const target = path.join(directory, 'credentials.json');
  try {
    await privateFile(target, credentials);
    assert.equal(JSON.stringify(await privateFile(target)) === JSON.stringify(credentials), true);
    await assert.rejects(privateFile(target, {}), { code: 'EEXIST' });
    assert.equal(JSON.stringify(await privateFile(target)) === JSON.stringify(credentials), true);
    await symlink(target, path.join(directory, 'linked.json'));
    await assert.rejects(privateFile(path.join(directory, 'linked.json')));
    await chmod(target, 0o644);
    await assert.rejects(privateFile(target), /PRIVATE_FILE_REQUIRED/);
    await chmod(target, 0o600);
    const broken = path.join(directory, 'broken.json');
    const marker = 'private-fixture-marker-that-must-never-be-echoed';
    await writeFile(broken, '{"password":"' + marker, { mode: 0o600 });
    try {
      execFileSync(
        process.execPath,
        [
          new URL('../../../infra/rabbitmq/hosted-definitions.mjs', import.meta.url).pathname,
          'verify',
          '--credentials',
          broken,
          '--snapshot',
          target,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      assert.fail('malformed private input accepted');
    } catch (error) {
      assert.equal(error.status, 1);
      assert.equal((String(error.stdout) + String(error.stderr)).includes(marker), false);
      assert.match(String(error.stderr), /HOSTED_BROKER_DEFINITIONS_REFUSED/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('credentials reject ambiguous types, extra owners, shared passwords and invalid scope', () => {
  for (const mutate of [
    (c) => {
      c.usernamePrefix = [c.usernamePrefix];
    },
    (c) => {
      c.passwords.wallet = c.passwords.billing;
    },
    (c) => {
      c.passwords.wallet = 'short';
    },
    (c) => {
      c.passwords.unknown = 'unknown-fixture-password-more-than-thirty-two-bytes';
    },
    (c) => {
      c.vhost = '/';
    },
  ]) {
    const input = clone(credentials);
    mutate(input);
    assert.throws(() => buildDefinitions(manifest, input));
  }
});
