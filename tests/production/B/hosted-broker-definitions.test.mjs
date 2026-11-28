import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  buildDefinitions,
  privateFile,
  reconcile,
} from '../../../infra/rabbitmq/hosted-definitions.mjs';
import { ownedBrokerContainer } from '../../../scripts/production/B/broker-diagnostics.mjs';

// Only fixed contract codes may enter public failure diagnostics; never echo child text.
const SAFE_CLI_REFUSALS = new Set([
  'SNAPSHOT_VERSION_OR_SCOPE',
  'SNAPSHOT_FIELDS',
  'INCOMPLETE_CLUSTER_EXPORT',
  'BUILTIN_INSPECTION_INCOMPLETE',
  'EXCHANGE_INSPECTION_INVALID',
  'EXCHANGE_INSPECTION_INCONSISTENT',
  'QUEUE_INSPECTION_INVALID',
  'QUEUE_INSPECTION_INCONSISTENT',
  'HIDDEN_OR_INCONSISTENT_RESOURCES',
  'ABSENT_VHOST_HAS_RESOURCES',
  'OPERATOR_POLICIES_PRESENT',
  'VHOST_LIMITS_PRESENT',
  'VHOST_PARAMETERS_PRESENT',
  'RUNTIME_IDENTITY_SHARED_WITH_OTHER_VHOST',
  'EXISTING_USER_MISMATCH',
  'INCOMPATIBLE_VHOSTS',
  'INCOMPATIBLE_PERMISSIONS',
  'INCOMPATIBLE_TOPIC_PERMISSIONS',
  'INCOMPATIBLE_POLICIES',
  'INCOMPATIBLE_QUEUES',
  'INCOMPATIBLE_EXCHANGES',
  'INCOMPATIBLE_BINDINGS',
  'POST_IMPORT_INCOMPLETE',
  'PRIVATE_DIRECTORY_REQUIRED',
  'PRIVATE_FILE_REQUIRED',
  'PRIVATE_JSON_INVALID',
]);

const parsePrivate = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('HOSTED_FIXTURE_INVALID_JSON');
  }
};
const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL('infra/rabbitmq/hosted-topology.v1.json', root), 'utf8'),
);
const { connect } = createRequire(new URL('packages/platform-messaging/package.json', root))(
  'amqplib',
);
const executable = new URL('infra/rabbitmq/hosted-definitions.mjs', root).pathname;

/**
 * Explicit transport-only fixtures in a new vhost on this CI job's owned broker.
 * No owner events are parsed or accepted as financial facts; no hosted apply.
 */
test(
  'hosted definitions import all native resources, enforce owner ACLs and preserve messages on replay',
  { timeout: 180_000 },
  async () => {
    const container = process.env.CW_HOSTED_BROKER_CONTAINER;
    const ownerLabel = process.env.CW_HOSTED_BROKER_RUN;
    const port = Number(process.env.CW_HOSTED_BROKER_PORT);
    assert.ok(
      container && ownerLabel && Number.isInteger(port) && port > 0 && port <= 65535,
      'the existing acceptance runner must provide its owned disposable broker',
    );
    const run = randomBytes(6).toString('hex');
    const directory = await mkdtemp(path.join(tmpdir(), 'hosted-broker-ci-'));
    const brokerDirectory = '/tmp/cw-hosted-' + run;
    const credentials = {
      schemaVersion: 1,
      vhost: 'cw-hosted-' + run,
      usernamePrefix: 'cw_hosted_' + run + '_',
      passwords: Object.fromEntries(
        [...new Set(manifest.requiredBrokerRoles.map((r) => r.owner))].map((owner) => [
          owner,
          randomBytes(32).toString('base64url'),
        ]),
      ),
    };
    const credentialsPath = path.join(directory, 'credentials.json');
    const connections = [];
    let owned,
      imported = false,
      privateDirectoryCreated = false;
    let failure;
    let phase = 'OWNERSHIP';
    const docker = (args, input) => {
      const result = spawnSync('docker', args, {
        encoding: 'utf8',
        input,
        timeout: 30_000,
        maxBuffer: 12 * 1024 * 1024,
      });
      if (result.status !== 0 || result.signal || result.error) {
        // Child output can contain definitions/password hashes; never append it.
        throw new Error('HOSTED_FIXTURE_DOCKER_COMMAND_FAILED');
      }
      return result.stdout;
    };
    const ctl = (...args) =>
      docker([
        'exec',
        '--user',
        'rabbitmq',
        owned.id,
        'sh',
        '-ec',
        'umask 077; exec rabbitmqctl -q "$@"',
        'sh',
        ...args,
      ]);
    const inspect = (...args) => parsePrivate(ctl(...args, '--formatter=json'));
    const capture = () => {
      const file = brokerDirectory + '/export.json';
      ctl('export_definitions', file);
      const mode = docker([
        'exec',
        '--user',
        'rabbitmq',
        owned.id,
        'stat',
        '-c',
        '%a',
        file,
      ]).trim();
      assert.equal(mode, '600', 'exported credential hashes must remain owner-private');
      const definitions = parsePrivate(
        docker(['exec', '--user', 'rabbitmq', owned.id, 'cat', file]),
      );
      const exists = definitions.vhosts.some((vhost) => vhost.name === credentials.vhost);
      return {
        schemaVersion: 1,
        vhost: credentials.vhost,
        definitions,
        exchanges: exists
          ? inspect('list_exchanges', '-p', credentials.vhost, 'name', 'type', 'internal')
          : [],
        queues: exists
          ? inspect('list_queues', '-p', credentials.vhost, 'name', 'type', 'exclusive')
          : [],
        operatorPolicies: exists ? inspect('list_operator_policies', '-p', credentials.vhost) : [],
      };
    };
    const importDefinitions = (definitions) => {
      const target = brokerDirectory + '/patch.json';
      docker(
        [
          'exec',
          '-i',
          '--user',
          'rabbitmq',
          owned.id,
          'sh',
          '-ec',
          'umask 077; cat > "$1"',
          'sh',
          target,
        ],
        JSON.stringify(definitions),
      );
      ctl('import_definitions', target);
    };
    const cli = (command, args) => {
      const result = spawnSync(process.execPath, [executable, command, ...args], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      if (result.status !== 0) {
        const refusal = /^HOSTED_BROKER_DEFINITIONS_REFUSED:([A-Z_]{3,80})$/.exec(
          String(result.stderr ?? '').trim(),
        )?.[1];
        if (SAFE_CLI_REFUSALS.has(refusal)) phase += '_' + refusal;
      }
      assert.equal(result.status, 0, 'protected-file CLI must succeed without exposing its inputs');
      assert.equal(result.stderr === '', true, 'CLI must not emit private diagnostics');
      assert.equal(
        /password|hash|amqp:/i.test(result.stdout),
        false,
        'CLI summary must stay non-secret',
      );
      return parsePrivate(result.stdout);
    };
    const client = async (owner) => {
      const connection = await connect({
        protocol: 'amqp',
        hostname: '127.0.0.1',
        port,
        vhost: credentials.vhost,
        username: credentials.usernamePrefix + owner + '_app',
        password: credentials.passwords[owner],
      });
      connection.on('error', () => {});
      connections.push(connection);
      return connection;
    };
    const denied = async (connection, operation) => {
      const channel = await connection.createConfirmChannel();
      let refusedCode;
      channel.on('error', (error) => {
        refusedCode = error.code;
      });
      try {
        await assert.rejects(operation(channel));
        assert.equal(
          refusedCode,
          403,
          'the broker must explicitly deny authority with ACCESS_REFUSED',
        );
      } finally {
        await channel.close().catch(() => {});
      }
    };
    try {
      owned = await ownedBrokerContainer(
        async (args) => ({
          code: 0,
          signal: null,
          outcome: 'exited',
          stdout: docker(args),
        }),
        container,
        ownerLabel,
      );
      docker(['exec', '--user', 'rabbitmq', owned.id, 'mkdir', '-m', '700', brokerDirectory]);
      privateDirectoryCreated = true;
      await privateFile(credentialsPath, credentials);
      phase = 'PREPARE';
      const before = capture();
      assert.equal(
        before.definitions.vhosts.some((v) => v.name === credentials.vhost),
        false,
      );
      assert.equal(
        before.definitions.users.some((u) => u.name.startsWith(credentials.usernamePrefix)),
        false,
      );
      const snapshotPath = path.join(directory, 'before.json');
      await privateFile(snapshotPath, before);
      const patchPath = path.join(directory, 'patch.json');
      const prepared = cli('prepare', [
        '--credentials',
        credentialsPath,
        '--snapshot',
        snapshotPath,
        '--output',
        patchPath,
      ]);
      assert.equal(prepared.additions.users, 9);
      phase = 'IMPORT';
      importDefinitions(await privateFile(patchPath));
      imported = true;
      phase = 'VERIFY';
      const after = capture();
      const afterPath = path.join(directory, 'after.json');
      await privateFile(afterPath, after);
      assert.equal(
        cli('verify', ['--credentials', credentialsPath, '--snapshot', afterPath]).status,
        'VERIFIED',
      );

      phase = 'NATIVE_DECLARATIONS';
      const expected = buildDefinitions(manifest, credentials);
      const clients = new Map();
      for (const owner of Object.keys(credentials.passwords)) {
        const connection = await client(owner);
        clients.set(owner, connection);
        const channel = await connection.createConfirmChannel();
        channel.on('error', () => {});
        const grant = expected.permissions.find(
          (p) => p.user === credentials.usernamePrefix + owner + '_app',
        );
        for (const exchange of expected.exchanges.filter((e) =>
          new RegExp(grant.configure).test(e.name),
        )) {
          await channel.assertExchange(exchange.name, exchange.type, { durable: true });
        }
        for (const queue of expected.queues.filter((q) =>
          new RegExp(grant.configure).test(q.name),
        )) {
          await channel.assertQueue(queue.name, { durable: true, arguments: queue.arguments });
        }
        for (const binding of expected.bindings.filter((b) =>
          new RegExp(grant.write).test(b.destination),
        )) {
          await channel.bindQueue(binding.destination, binding.source, binding.routing_key);
        }
        await channel.close();
      }

      // Only this isolated namespace receives opaque test bytes, never fabricated money events.
      phase = 'ALLOWED_PUBLICATION';
      let returned = 0;
      for (const producer of manifest.producers) {
        const channel = await clients.get(producer.owner).createConfirmChannel();
        channel.on('error', () => {});
        channel.on('return', () => {
          returned += 1;
        });
        for (const key of producer.keys) {
          channel.publish(producer.exchange, key, Buffer.from('HOSTED_TOPOLOGY_FIXTURE_ONLY'), {
            persistent: true,
            mandatory: true,
          });
        }
        await channel.waitForConfirms();
        await channel.close();
      }
      assert.equal(
        returned,
        1,
        'Catalog must remain unroutable without an enabled legitimate subscriber',
      );
      for (const consumer of manifest.consumers) {
        const channel = await clients.get(consumer.owner).createChannel();
        const expectedCount = consumer.bindings.reduce(
          (total, binding) =>
            total +
            binding.keys.filter((key) =>
              manifest.producers.some(
                (p) => p.exchange === binding.exchange && p.keys.includes(key),
              ),
            ).length,
          0,
        );
        assert.equal((await channel.checkQueue(consumer.queue)).messageCount, expectedCount);
        const delivery = await channel.get(consumer.queue, { noAck: false });
        assert.ok(delivery, 'each owner can read its own main queue');
        channel.nack(delivery, false, true);
        await channel.close();
      }

      phase = 'DENIED_AUTHORITY';
      const wallet = clients.get('wallet');
      await denied(wallet, async (channel) => {
        channel.publish(
          'washgo.billing.events',
          'billing.cash-collected.v1',
          Buffer.from('DENIED'),
        );
        await channel.waitForConfirms();
      });
      await denied(wallet, (channel) => channel.get('reporting.operations'));
      await denied(wallet, (channel) =>
        channel.bindQueue(
          'wallet.billing-custody.v1',
          'washgo.billing.events',
          'billing.obligation-created.v1',
        ),
      );
      await denied(wallet, (channel) =>
        channel.assertExchange('foreign.events', 'topic', { durable: true }),
      );
      await denied(wallet, async (channel) => {
        channel.sendToQueue('wallet.billing-custody.v1', Buffer.from('DENIED'));
        await channel.waitForConfirms();
      });

      phase = 'NONDESTRUCTIVE_REPLAY';
      const stable = capture();
      const replay = reconcile(manifest, credentials, stable, { verify: true });
      assert.ok(Object.values(replay.counts).every((count) => count === 0));
      importDefinitions(replay.definitions);
      const confirmed = capture();
      reconcile(manifest, credentials, confirmed, { verify: true });
      const users = (snapshot) =>
        snapshot.definitions.users
          .filter((u) => u.name.startsWith(credentials.usernamePrefix))
          .sort((a, b) => a.name.localeCompare(b.name));
      assert.equal(
        JSON.stringify(users(confirmed)) === JSON.stringify(users(stable)),
        true,
        'replay must not rewrite existing runtime identities',
      );
      const queue = await wallet.createChannel();
      assert.equal(
        (await queue.checkQueue('wallet.billing-custody.v1')).messageCount,
        3,
        're-import must preserve already accepted durable test messages',
      );
      await queue.close();
    } catch {
      // Node assertion details must never serialize private definitions or credentials.
      failure = new Error('HOSTED_BROKER_FIXTURE_FAILED_' + phase);
    } finally {
      let cleanupFailed = false;
      const clean = async (operation) => {
        try {
          await operation();
        } catch {
          cleanupFailed = true;
        }
      };
      for (const connection of connections) await clean(() => connection.close());
      if (owned && imported) {
        // Only the newly-created fixture namespace and its random-prefixed users.
        await clean(() => ctl('delete_vhost', credentials.vhost));
        for (const owner of Object.keys(credentials.passwords)) {
          await clean(() => ctl('delete_user', credentials.usernamePrefix + owner + '_app'));
        }
      }
      if (owned && privateDirectoryCreated) {
        await clean(() =>
          docker(['exec', '--user', 'rabbitmq', owned.id, 'rm', '-rf', brokerDirectory]),
        );
      }
      await clean(() => rm(directory, { recursive: true, force: true }));
      if (cleanupFailed && !failure) failure = new Error('HOSTED_BROKER_FIXTURE_CLEANUP_FAILED');
    }
    if (failure) throw failure;
  },
);
