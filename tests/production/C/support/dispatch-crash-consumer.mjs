/**
 * Child process for the crash-before-ACK test.
 *
 * Runs the real InboxConsumer with the compiled dispatch consumer parts. After
 * the inbox transaction COMMITS and before the ACK it prints one line and then
 * blocks forever, so the parent can SIGKILL it exactly in the gap where a crash
 * turns into a broker redelivery.
 *
 *   node dispatch-crash-consumer.mjs <queue>
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { messaging, serviceDist } from '../_support.mjs';

const { BrokerConnection, InboxConsumer } = messaging();
const { PrismaService } = serviceDist('dispatch', 'infrastructure/persistence/prisma.service.js');
const { PrismaDispatchStore } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);
const { holdChangedConsumerParts } = serviceDist(
  'dispatch',
  'transport/messaging/hold-changed.consumer.js',
);
const { systemClock, uuidGenerator } = serviceDist('dispatch', 'infrastructure/runtime/system.js');

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
