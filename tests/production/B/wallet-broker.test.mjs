/**
 * P05-B3: REAL RabbitMQ -> Wallet custody projection -> REAL PostgreSQL.
 * Run through scripts/production/B/wallet-broker-acceptance.mjs (provides
 * WALLET_TEST_DATABASE_URL as the runtime role and WALLET_TEST_AMQP_URL).
 *
 * The amqplib consumer loop below is the test's broker adapter (manual ack,
 * nack+requeue for retryable outcomes). The Wallet runtime broker binding is
 * blocked on Lane E (CR-B-12.3). Billing is not running: events are built in the
 * registered billing.v1 envelope-v2 shape.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DB = process.env.WALLET_TEST_DATABASE_URL;
const AMQP = process.env.WALLET_TEST_AMQP_URL;
if (!DB || !AMQP) throw new Error('WALLET_TEST_DATABASE_URL_AND_WALLET_TEST_AMQP_URL_REQUIRED');

const wallet = createRequire(path.join(ROOT, 'services/wallet/package.json'));
const dist = (file) => wallet(path.join(ROOT, 'services/wallet/dist-tests', file));
const { Client } = wallet('pg');
const amqplib = createRequire(path.join(ROOT, 'packages/platform-messaging/package.json'))(
  'amqplib',
);
const { CustodyProjector } = dist('src/application/index.js');
const { PrismaService } = dist('src/infrastructure/persistence/prisma.service.js');
const { PrismaWalletRepository } = dist(
  'src/infrastructure/persistence/prisma-wallet.repository.js',
);
const { RandomIds, SystemClock } = dist('src/infrastructure/system/system.adapters.js');
const { createCustodyEventConsumer, WALLET_CUSTODY_QUEUE, WALLET_CUSTODY_BINDINGS } = dist(
  'src/transport/messaging/consumer.js',
);
const events = dist('test/support/billing-events.js');

const EXCHANGE = 'washgo.billing.events';
const DLX = 'washgo.wallet.dead-letter';
const DLQ = `${WALLET_CUSTODY_QUEUE}.dead`;

let prisma;
let adapter;
let sql;
let connection;
let publisher;
const deliveries = [];
/** Event ids whose first delivery is processed but whose ack is "lost" (channel dies). */
const loseAckOnce = new Set();

async function startConsumer() {
  const channel = await connection.createChannel();
  await channel.prefetch(1);
  await channel.consume(WALLET_CUSTODY_QUEUE, async (message) => {
    if (!message) return;
    const payload = JSON.parse(message.content.toString('utf8'));
    const result = await adapter.consume({
      id: message.properties.messageId ?? payload.eventId,
      type: message.fields.routingKey,
      payload,
      correlationId: message.properties.correlationId,
    });
    deliveries.push({
      eventId: payload.eventId,
      redelivered: message.fields.redelivered,
      result: result.kind,
    });
    if (result.kind === 'handled' && loseAckOnce.delete(payload.eventId)) {
      // Committed, but the consumer dies before acking: the broker must redeliver.
      await channel.close().catch(() => {});
      await startConsumer();
      return;
    }
    if (result.kind === 'handled') channel.ack(message);
    else if (result.retryable) {
      await delay(100);
      channel.nack(message, false, true);
    } else channel.nack(message, false, false);
  });
  return channel;
}

function publish(event) {
  publisher.publish(EXCHANGE, event.eventType, Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: 'application/json',
    messageId: event.eventId,
    correlationId: event.correlationId,
    type: event.eventType,
  });
}

async function held(holder) {
  const row = await sql.query(
    `SELECT held_minor, in_handover_minor, version FROM app.custody_account WHERE holder_subject = $1 AND currency = 'SYP'`,
    [holder],
  );
  return row.rowCount
    ? {
        held: Number(row.rows[0].held_minor),
        inHandover: Number(row.rows[0].in_handover_minor),
        version: row.rows[0].version,
      }
    : null;
}

async function eventually(probe, label) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`TIMEOUT: ${label}`);
    await delay(200);
  }
}

before(async () => {
  prisma = new PrismaService(DB);
  adapter = createCustodyEventConsumer(
    new CustodyProjector({
      repository: new PrismaWalletRepository(prisma),
      clock: new SystemClock(),
      ids: new RandomIds(),
    }),
  );
  sql = new Client({ connectionString: DB.replace(/\?.*$/, '') });
  await sql.connect();
  connection = await amqplib.connect(AMQP);
  publisher = await connection.createConfirmChannel();
  await publisher.assertExchange(EXCHANGE, 'topic', { durable: true });
  await publisher.assertExchange(DLX, 'fanout', { durable: true });
  await publisher.assertQueue(DLQ, { durable: true });
  await publisher.bindQueue(DLQ, DLX, '');
  await publisher.assertQueue(WALLET_CUSTODY_QUEUE, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': DLX },
  });
  for (const key of WALLET_CUSTODY_BINDINGS)
    await publisher.bindQueue(WALLET_CUSTODY_QUEUE, EXCHANGE, key);
  await startConsumer();
});

after(async () => {
  await connection?.close().catch(() => {});
  await prisma?.onModuleDestroy();
  await sql?.end();
});

test('real broker: a collection is applied once even when its ack is lost and it is published twice', async () => {
  const holder = randomUUID();
  const event = events.collected({ holder, amount: events.syp(12_000) });
  loseAckOnce.add(event.eventId);
  publish(event);
  publish(event);
  await publisher.waitForConfirms();
  await eventually(
    async () => deliveries.filter((d) => d.eventId === event.eventId).length >= 3,
    'three deliveries',
  );
  assert.ok(
    deliveries.some((d) => d.eventId === event.eventId && d.redelivered),
    'the broker redelivered the unacked message',
  );
  const state = await held(holder);
  assert.deepEqual([state?.held, state?.version], [12_000, 1]);
  const movements = await sql.query(
    `SELECT count(*)::int AS n FROM app.custody_movement WHERE event_id = $1`,
    [event.eventId],
  );
  assert.equal(movements.rows[0].n, 1);
});

test('real broker: an early handover is requeued until its collection arrives, then applied in order', async () => {
  const holder = randomUUID();
  const handoverId = randomUUID();
  const pending = events.handover({
    handoverId,
    holder,
    version: 1,
    previousStatus: null,
    status: 'PENDING',
    declared: events.syp(4_000),
  });
  publish(pending);
  await publisher.waitForConfirms();
  await eventually(
    async () =>
      deliveries.filter((d) => d.eventId === pending.eventId && d.result === 'failed').length >= 2,
    'deferred twice',
  );
  assert.equal(await held(holder), null, 'nothing applied while deferred');
  publish(events.collected({ holder, amount: events.syp(4_000) }));
  await publisher.waitForConfirms();
  const state = await eventually(async () => {
    const value = await held(holder);
    return value && value.inHandover === 4_000 ? value : null;
  }, 'handover applied');
  assert.deepEqual([state.held, state.inHandover, state.version], [0, 4_000, 2]);
});

test('real broker: a poison message is recorded as rejected and acked, never redelivered forever', async () => {
  const poison = { ...events.collected({}), data: { amount: 'not-money' } };
  publish(poison);
  await publisher.waitForConfirms();
  await eventually(async () => {
    const row = await sql.query(
      `SELECT outcome, reason FROM app.wallet_inbox WHERE event_id = $1`,
      [poison.eventId],
    );
    return row.rowCount === 1 ? row.rows[0] : null;
  }, 'poison recorded');
  await delay(500);
  assert.equal(deliveries.filter((d) => d.eventId === poison.eventId).length, 1);
});
