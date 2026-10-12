import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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
