import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/**
 * Establish the durable topology fixture BEFORE publishing any messages.
 * RabbitMQ 4.2's Ra registry auto-saves every 500 ms; publisher confirms do not
 * cover the newly declared queue's name-to-UID mapping. Sync only that metadata
 * table, never the message WAL. Read-only calls after the crash do not sync it.
 * https://github.com/rabbitmq/rabbitmq-server/discussions/17710
 * https://github.com/rabbitmq/ra/blob/v2.17.3/src/ra_directory.erl
 */
export async function inspectQuorumTopology(execute, container, { persist = false } = {}) {
  const expression = `
    {ok, Queue} = rabbit_amqqueue:lookup(rabbit_misc:r(<<"drill">>, queue, <<"drill.q">>)),
    {RaName, RaNode} = amqqueue:get_pid(Queue),
    true = (RaNode =:= node()),
    Uid = ra_directory:uid_of(quorum_queues, RaName),
    true = is_binary(Uid),
    Config = ra_system:fetch(quorum_queues),
    #{data_dir := DataDir} = Config,
    {ok, Registry} = ra_system:lookup_name(quorum_queues, directory_rev),
    [{RaName, Uid}] = dets:lookup(Registry, RaName),
    ${persist ? 'ok = dets:sync(Registry),' : ''}
    #{
      node => atom_to_binary(node(), utf8),
      raName => atom_to_binary(RaName, utf8),
      raUid => Uid,
      dataDir => unicode:characters_to_binary(DataDir),
      walDir => unicode:characters_to_binary(maps:get(wal_data_dir, Config, DataDir)),
      registryFile => unicode:characters_to_binary(dets:info(Registry, filename)),
      registrySynced => ${persist}
    }.
  `;
  const output = await execute(
    ['exec', container, 'rabbitmqctl', '-q', '--formatter', 'json', 'eval', expression],
    { timeoutMs: 15_000 },
  );
  const result = JSON.parse(output);
  assert.equal(result.result, 'ok', 'RabbitMQ topology probe failed');
  const evidence = result.value;
  assert.ok(evidence && typeof evidence === 'object', 'RabbitMQ topology evidence is missing');
  assert.equal(evidence.node, 'rabbit@drill-mq', 'unexpected RabbitMQ node identity');
  for (const key of ['raName', 'raUid']) {
    assert.equal(typeof evidence[key], 'string', `missing RabbitMQ ${key}`);
    assert.ok(evidence[key].length > 0, `empty RabbitMQ ${key}`);
  }
  for (const key of ['dataDir', 'walDir', 'registryFile']) {
    assert.ok(
      typeof evidence[key] === 'string' && evidence[key].startsWith('/var/lib/rabbitmq/'),
      `RabbitMQ ${key} is outside the persisted data volume: ${evidence[key]}`,
    );
  }
  assert.equal(evidence.registrySynced, persist, 'RabbitMQ topology barrier result mismatch');
  return evidence;
}

export function assertSameQuorumTopology(before, after) {
  for (const key of ['node', 'raName', 'raUid', 'dataDir', 'walDir', 'registryFile']) {
    assert.equal(after[key], before[key], `RabbitMQ ${key} changed across the crash`);
  }
}

export async function closeRecoveredQueue({ channel, connection }) {
  try {
    await channel?.close();
  } catch {
    // A failed recovery probe may already have closed the channel.
  }
  try {
    await connection?.close();
  } catch {
    // Preserve the recovery failure instead of replacing it with a close error.
  }
}

/**
 * A passive AMQP declaration asks the queue itself for its ready-message count.
 * Management HTTP statistics are sampled and optional, so they cannot be the
 * readiness condition for a persistence drill. A failed probe never consumes
 * messages and closes its connection before the caller retries it.
 */
export async function openRecoveredQueue(connect, queue, expectedCount) {
  const connection = await connect();
  // amqplib also emits errors whose in-flight RPCs reject below. Observe the
  // events so an expected broker/channel refusal cannot terminate the runner.
  connection.on('error', () => {});
  let channel;
  try {
    channel = await connection.createChannel();
    channel.on('error', () => {});
    const { messageCount, consumerCount } = await channel.checkQueue(queue);
    assert.equal(
      messageCount,
      expectedCount,
      `${queue}: expected ${expectedCount} ready messages, observed ${messageCount}; consumers=${consumerCount}`,
    );
    assert.equal(consumerCount, 0, `${queue}: unexpected consumer in the isolated recovery drill`);
    return { connection, channel, depth: messageCount };
  } catch (error) {
    await closeRecoveredQueue({ connection, channel });
    throw error;
  }
}

/** Consume and reconcile the exact confirmed payload set, including duplicates. */
export async function consumeRecoveredQueue(channel, queue, expectedDigests) {
  const recovered = new Set();
  for (let i = 0; i < expectedDigests.size; i++) {
    const message = await channel.get(queue, { noAck: false });
    assert.ok(
      message,
      `${queue}: recovered ${i} of ${expectedDigests.size} confirmed messages before queue was empty`,
    );
    assert.equal(message.properties.deliveryMode, 2, `${queue}: recovered non-persistent message`);
    const digest = createHash('sha256').update(message.content).digest('hex');
    assert.ok(expectedDigests.has(digest), `${queue}: recovered an unknown or corrupted payload`);
    assert.ok(!recovered.has(digest), `${queue}: recovered a duplicate payload`);
    recovered.add(digest);
    channel.ack(message);
  }
  assert.equal(
    await channel.get(queue, { noAck: false }),
    false,
    `${queue}: unexpected additional message after the confirmed set was recovered`,
  );
  return recovered;
}
