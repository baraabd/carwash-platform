/**
 * Broker helpers for the harness and the integration tests.
 *
 * The compiled messaging package is CommonJS (the services are CommonJS Nest
 * apps); this ESM harness loads it through createRequire rather than relying on
 * named-export interop guessing.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, infraBrokerUrl } from './context.mjs';

const require = createRequire(path.join(ROOT, 'package.json'));

export function messaging() {
  return require(path.join(ROOT, 'packages', 'platform-messaging', 'dist', 'index.js'));
}

export function amqp() {
  return require(path.join(ROOT, 'packages', 'platform-messaging', 'node_modules', 'amqplib'));
}

/**
 * Declare the exchanges that are shared between services.
 *
 * Done once, by the infrastructure identity that owns them. A subscriber cannot
 * do this (it has no `configure` permission on another service's exchange) and
 * must not need to.
 */
export async function bootstrapSharedTopology(context) {
  const { BrokerConnection, assertTopology, sharedTopology } = messaging();
  const connection = await BrokerConnection.open({
    url: infraBrokerUrl(context),
    connectionName: `cw-infra-topology-${context.runId}`,
  });
  try {
    await assertTopology(connection.channel, sharedTopology);
  } finally {
    await connection.close();
  }
}

/** Open a raw amqplib connection as a given identity. Used by ACL tests. */
export async function connectAs(url, connectionName) {
  const { connect } = amqp();
  return connect(url, { clientProperties: { connection_name: connectionName } });
}

/**
 * Run an operation that is EXPECTED to be refused by the broker ACL.
 * Returns the AMQP error so a test can assert on the real refusal rather than on
 * "something threw".
 */
export async function expectRefused(operation) {
  try {
    await operation();
    return { refused: false, code: null, message: null };
  } catch (error) {
    const code = error?.code ?? null;
    const message = String(error?.message ?? error);
    return {
      // 403 ACCESS_REFUSED is the ACL denial; 404/405 are different faults and
      // must not be mistaken for one.
      refused: code === 403 || /ACCESS_REFUSED/i.test(message),
      code,
      message,
    };
  }
}

export async function queueMessageCount(context, service, queue) {
  const { connect } = amqp();
  const { brokerUrl } = await import('./context.mjs');
  const connection = await connect(brokerUrl(context, service));
  try {
    const channel = await connection.createChannel();
    const info = await channel.checkQueue(queue);
    await channel.close();
    return info.messageCount;
  } finally {
    await connection.close();
  }
}
