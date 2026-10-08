/**
 * Child process for the crash-before-ACK test (tests/production/C/dispatch-inbox-rabbitmq.test.mjs).
 *
 * Runs the real InboxConsumer with the compiled dispatch consumer parts. After
 * the inbox transaction COMMITS and before the ACK it prints one line and then
 * blocks forever, so the parent can SIGKILL it exactly in the gap where a crash
 * turns into a broker redelivery.
 *
 *   node crash-consumer.mjs <queue>    (CW_PROD_C_CONTEXT must point at the stack context)
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const require = createRequire(import.meta.url);
const dist = (relative) => require(path.join(ROOT, 'services', 'dispatch', 'dist', relative));
const { BrokerConnection, InboxConsumer } = require(
  path.join(ROOT, 'packages', 'platform-messaging', 'dist', 'index.js'),
);
const { PrismaService } = dist('infrastructure/persistence/prisma.service.js');
const { PrismaDispatchStore } = dist('infrastructure/persistence/prisma-dispatch.store.js');
const { holdChangedConsumerParts } = dist('transport/messaging/hold-changed.consumer.js');
const { systemClock, uuidGenerator } = dist('infrastructure/runtime/system.js');

const queue = process.argv[2];
const context = JSON.parse(readFileSync(process.env.CW_PROD_C_CONTEXT, 'utf8'));
const prisma = new PrismaService(context.databases.dispatch.appUrl);
const parts = holdChangedConsumerParts(new PrismaDispatchStore(prisma), systemClock, uuidGenerator);
const connection = await BrokerConnection.open({
  url: context.brokerUrl,
  connectionName: 'dispatch-crash-consumer',
});
const consumer = new InboxConsumer({
  channel: connection.channel,
  queue,
  store: parts.store,
  parse: parts.parse,
  effect: parts.effect,
  onBeforeAck: async (event, outcome) => {
    process.stdout.write(
      `${JSON.stringify({ msg: 'committed', eventId: event.eventId, outcome })}\n`,
    );
    await new Promise(() => {}); // never ACK: the parent kills us here
  },
});
await consumer.start();
process.stdout.write(`${JSON.stringify({ msg: 'consuming' })}\n`);
