/**
 * Real Billing HTTP + its committed outbox -> production relay -> real RabbitMQ
 * -> production Wallet consumer -> Wallet's own PostgreSQL projection.
 * Identity/Pricing/WorkAuthority remain declared upstream test doubles. Synthetic
 * envelopes are used only to inject transport poison, ordering and retry faults.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};
const database = {
  billing: env('BILLING_TEST_DATABASE_URL'),
  wallet: env('WALLET_TEST_DATABASE_URL'),
};
const broker = { billing: env('BILLING_TEST_AMQP_URL'), wallet: env('WALLET_TEST_AMQP_URL') };
const logDir = env('CW_WALLET_BROKER_LOG_DIR');
const secrets = [...Object.values(database), ...Object.values(broker)].flatMap((url) => [
  url,
  new URL(url).password,
]);
const redact = (input) =>
  secrets.reduce((s, secret) => (secret ? s.split(secret).join('[REDACTED]') : s), String(input));
const owner = (service) => createRequire(path.join(ROOT, `services/${service}/package.json`));
const billing = owner('billing');
const wallet = owner('wallet');
const load = (service, file) =>
  owner(service)(path.join(ROOT, `services/${service}/dist-tests`, file));
const amqplib = createRequire(path.join(ROOT, 'packages/platform-messaging/package.json'))(
  'amqplib',
);
const { BrokerConnection, ConfirmingPublisher } = billing('@carwash/platform-messaging');
const { PrismaService } = load('billing', 'src/infrastructure/persistence/prisma.service.js');
const { PrismaBillingRepository } = load(
  'billing',
  'src/infrastructure/persistence/prisma-billing.repository.js',
);
const { startBillingHttp, FixedClock, SESSIONS, SUBJECTS, TOKENS } = load(
  'billing',
  'test/support/billing-http-harness.js',
);
const { startIdentityStub, startPricingStub } = load('billing', 'test/support/upstream-stubs.js');
const { startValidateStub, startBookingSagaHttp, WORKLOADS } = load(
  'billing',
  'test/support/booking-saga-harness.js',
);
const { WorkDouble } = load('billing', 'test/support/work-double.js');
const events = load('wallet', 'test/support/billing-events.js');
const { WALLET_CUSTODY_QUEUE } = load('wallet', 'src/transport/messaging/consumer.js');
const { WALLET_CUSTODY_DLQ, WALLET_CUSTODY_RETRY_HEADER, WALLET_CUSTODY_MAX_RETRIES } = load(
  'wallet',
  'src/transport/messaging/custody-topology.js',
);
const EXCHANGE = 'washgo.billing.events';
const PATH = '/internal/v1/billing';
const money = (minor) => ({ currency: 'SYP', amountMinor: String(minor), scale: 2 });
const key = () => `broker-${randomUUID()}`;
const workers = new Set();
let workerSeq = 0;
let walletWorker;
let billingSql;
let walletSql;
let prisma;
let identity;
let pricing;
let validate;
let work;
let api;
let bookings;
let billingConnection;
let publisher;
let readerConnection;
let reader;
let firstReceipt;

function startWorker(service, args = [], crash = false) {
  const entry =
    service === 'billing'
      ? 'outbox/relay.runner.js'
      : 'transport/messaging/custody-consumer.runner.js';
  const child = spawn(
    process.execPath,
    crash
      ? [path.join(ROOT, 'tests/production/B/support/custody-crash-worker.mjs'), service]
      : [path.join(ROOT, `services/${service}/dist`, entry), ...args],
    {
      cwd: ROOT,
      // No bootstrap, migration, peer database or peer broker credentials in an owner process.
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        DATABASE_URL: database[service],
        BROKER_URL: broker[service],
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const result = { child, lines: [], output: '', code: null, signal: null, done: false };
  const file = path.join(logDir, `${String(++workerSeq).padStart(2, '0')}-${service}.log`);
  let pending = '';
  const collect = (chunk) => {
    const text = String(chunk);
    result.output += text;
    pending += text;
    for (;;) {
      const end = pending.indexOf('\n');
      if (end < 0) break;
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      try {
        result.lines.push(JSON.parse(line));
      } catch {
        /* nonstructured startup output */
      }
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  result.exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      result.code = code;
      result.signal = signal;
      result.done = true;
      writeFileSync(file, redact(result.output));
      workers.delete(result);
      resolve(result);
    });
  });
  workers.add(result);
  return result;
}
async function until(probe, label, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(40);
  }
  throw new Error(`TIMEOUT: ${label}`);
}
async function stop(worker) {
  if (!worker || worker.done) return;
  worker.child.kill('SIGTERM');
  let timer;
  await Promise.race([
    worker.exited,
    new Promise((resolve) => {
      timer = setTimeout(resolve, 7_000);
    }),
  ]);
  clearTimeout(timer);
  if (!worker.done) {
    worker.child.kill('SIGKILL');
    await worker.exited;
  }
}
async function consume(crash = false) {
  walletWorker = startWorker('wallet', [], crash);
  await until(() => {
    if (walletWorker.done)
      throw new Error(
        `CONSUMER_EXIT_${walletWorker.code}: ${redact(walletWorker.output).slice(-1500)}`,
      );
    return walletWorker.lines.some((line) => line.event === 'consumer_started');
  }, 'production consumer attached');
  return walletWorker;
}
async function relay(args = [], expected = 0, crash = false) {
  const worker = startWorker('billing', ['--once', ...args], crash);
  await until(() => worker.done, 'production relay exit');
  assert.equal(worker.code, expected, redact(worker.output).slice(-3000));
  return worker;
}
async function publish(event) {
  await publisher.publish({
    exchange: EXCHANGE,
    routingKey: event.eventType,
    body: JSON.stringify(event),
    messageId: event.eventId,
    eventType: event.eventType,
    correlationId: event.correlationId,
  });
}
async function post(route, body, token) {
  const result = await api.request('POST', `${PATH}${route}`, { token, key: key(), body });
  assert.ok(
    result.status === 200 || result.status === 201,
    `${route}: ${JSON.stringify(result.body)}`,
  );
  return result.body;
}
async function collectCash(total = 12_000) {
  const quoteId = randomUUID();
  const bookingId = randomUUID();
  validate.quotes.set(quoteId, {
    beneficiary: { kind: 'account', subjectId: SUBJECTS.customer },
    revision: 1,
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: String(total),
  });
  const obligation = await bookings.request('POST', `${PATH}/booking-obligations`, {
    workload: WORKLOADS.booking,
    key: key(),
    body: { beneficiary: { kind: 'account', subjectId: SUBJECTS.customer }, quoteId, bookingId },
  });
  assert.equal(obligation.status, 201);
  const obligationId = obligation.body.obligationId;
  await post(
    `/obligations/${obligationId}/payment-intents`,
    { expectedRevision: 1, method: 'CASH_ON_COMPLETION' },
    TOKENS.customer,
  );
  work.book({ bookingId, technicianSubject: SUBJECTS.technician });
  const collected = await post(
    `/obligations/${obligationId}/cash-collections`,
    { expectedRevision: 2, bookingId, amount: money(total) },
    TOKENS.technician,
  );
  const outbox = await billingSql.query(
    `SELECT event_id, payload FROM app.outbox_message WHERE event_type = 'billing.cash-collected.v1' AND payload::jsonb -> 'aggregate' ->> 'id' = $1`,
    [collected.receipt.receiptId],
  );
  assert.equal(outbox.rowCount, 1);
  return { receipt: collected.receipt, event: JSON.parse(outbox.rows[0].payload) };
}
async function projected(eventId) {
  const result = await walletSql.query('SELECT * FROM app.wallet_inbox WHERE event_id = $1', [
    eventId,
  ]);
  return result.rows[0];
}
async function balance(holder) {
  const result = await walletSql.query(
    'SELECT held_minor, in_handover_minor, settled_minor, version FROM app.custody_account WHERE holder_subject = $1 AND currency = $2',
    [holder, 'SYP'],
  );
  return result.rows[0];
}
async function drainDeadLetter(eventId) {
  return until(async () => {
    const message = await reader.get(WALLET_CUSTODY_DLQ, { noAck: false });
    if (!message) return null;
    reader.ack(message);
    if (message.properties.messageId === eventId) return message;
    throw new Error('UNEXPECTED_DEAD_LETTER');
  }, 'durable dead letter');
}

before(async () => {
  mkdirSync(logDir, { recursive: true });
  prisma = new PrismaService(database.billing);
  billingSql = new (billing('pg').Client)({ connectionString: database.billing });
  walletSql = new (wallet('pg').Client)({ connectionString: database.wallet });
  await billingSql.connect();
  await walletSql.connect();
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  validate = await startValidateStub();
  work = new WorkDouble();
  const clock = new FixedClock(new Date());
  const repository = new PrismaBillingRepository(prisma);
  api = await startBillingHttp({ repository, clock, identity, pricing, work });
  bookings = await startBookingSagaHttp({ repository, clock, identity, pricing, validate });
  billingConnection = await BrokerConnection.open({
    url: broker.billing,
    connectionName: 'billing-acceptance-publisher',
  });
  await billingConnection.channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  publisher = new ConfirmingPublisher(billingConnection.channel);
  readerConnection = await amqplib.connect(broker.wallet);
  reader = await readerConnection.createChannel();
  reader.on('error', () => {});
});
after(async () => {
  await Promise.allSettled([...workers].map(stop));
  await api?.close();
  await bookings?.close();
  await identity?.close();
  await pricing?.close();
  await validate?.close();
  await billingConnection?.close();
  await readerConnection?.close();
  await prisma?.onModuleDestroy();
  await billingSql?.end();
  await walletSql?.end();
});

test('production workers: real Billing cash commit stays pending when unroutable, then survives consumer commit-before-ACK crash exactly once', async () => {
  firstReceipt = await collectCash();
  await relay([], 1); // No subscriber queue exists: broker confirm alone cannot mark success.
  const pending = await billingSql.query(
    'SELECT published_at, last_error FROM app.outbox_message WHERE event_id = $1',
    [firstReceipt.event.eventId],
  );
  assert.equal(pending.rows[0].published_at, null);
  assert.equal(pending.rows[0].last_error, 'UNROUTABLE');
  const crashed = await consume(true);
  await relay();
  await until(() => crashed.done, 'consumer killed after local commit');
  assert.equal(crashed.code, 9);
  assert.equal((await projected(firstReceipt.event.eventId)).outcome, 'APPLIED');
  const current = await consume();
  await until(
    () =>
      current.lines.some(
        (line) =>
          line.event === 'consumer_committed' &&
          line.eventId === firstReceipt.event.eventId &&
          line.outcome === 'DUPLICATE',
      ),
    'lost-ACK redelivery',
  );
  await publish(firstReceipt.event);
  await until(
    () =>
      current.lines.filter(
        (line) => line.eventId === firstReceipt.event.eventId && line.outcome === 'DUPLICATE',
      ).length >= 2,
    'explicit duplicate',
  );
  const moves = await walletSql.query(
    'SELECT count(*)::int AS n FROM app.custody_movement WHERE event_id = $1',
    [firstReceipt.event.eventId],
  );
  assert.equal(moves.rows[0].n, 1);
  assert.equal((await balance(SUBJECTS.technician)).held_minor, '12000');
  const excluded = await billingSql.query(
    "SELECT count(*)::int AS n FROM app.outbox_message WHERE event_type LIKE 'billing.obligation-%' AND published_at IS NULL AND attempts = 0",
  );
  assert.ok(
    excluded.rows[0].n >= 3,
    'unsubscribed obligation facts remain pending, not falsely published',
  );
});

test('production relay: crashed lease recovers; real Billing handover and treasury settlement arrive at Wallet without crossing databases', async () => {
  const job = await collectCash(4_000);
  await relay([], 8, true);
  const leased = await billingSql.query(
    'SELECT locked_by, published_at FROM app.outbox_message WHERE event_id = $1',
    [job.event.eventId],
  );
  assert.ok(leased.rows[0].locked_by);
  assert.equal(leased.rows[0].published_at, null);
  await until(
    async () =>
      (
        await billingSql.query(
          'SELECT locked_until < now() AS expired FROM app.outbox_message WHERE event_id = $1',
          [job.event.eventId],
        )
      ).rows[0].expired,
    'lease expiration',
  );
  await relay();
  await until(() => projected(job.event.eventId), 'reclaimed event applied');
  const declared = await post(
    '/custody/handovers',
    { receiptIds: [job.receipt.receiptId], declaredAmount: money(4_000) },
    TOKENS.technician,
  );
  const handover = declared.handover ?? declared;
  await post(
    `/custody/handovers/${handover.handoverId}/treasury-receipt`,
    {
      expectedRevision: handover.revision,
      countedAmount: money(4_000),
      treasuryReference: `DEP${randomUUID().replaceAll('-', '')}`,
    },
    TOKENS.treasury,
  );
  await post(
    `/custody/handovers/${handover.handoverId}/reconciliation`,
    {
      expectedRevision: handover.revision + 1,
      settlementReference: `SET${randomUUID().replaceAll('-', '')}`,
    },
    TOKENS.reconciler,
  );
  await relay();
  await until(
    async () => (await balance(SUBJECTS.technician))?.settled_minor === '4000',
    'actual treasury chain projected',
  );
  const state = await balance(SUBJECTS.technician);
  assert.equal(state.held_minor, '12000');
  assert.equal(state.in_handover_minor, '0');
  await post(
    `/cash-receipts/${firstReceipt.receipt.receiptId}/reversal`,
    { expectedRevision: firstReceipt.receipt.revision, reason: 'RECORDED_IN_ERROR' },
    TOKENS.corrector,
  );
  await relay();
  await until(
    async () => (await balance(SUBJECTS.technician))?.held_minor === '0',
    'actual cash reversal projected',
  );
});

test('production consumer: early handover retries at the tail across process restart and then applies its later collection', async () => {
  const holder = randomUUID();
  const pending = events.handover({
    handoverId: randomUUID(),
    holder,
    version: 1,
    previousStatus: null,
    status: 'PENDING',
    declared: events.syp(4_000),
  });
  await publish(pending);
  await until(
    () =>
      walletWorker.lines.some(
        (line) => line.event === 'consumer_retry' && line.eventId === pending.eventId,
      ),
    'durable retry published',
  );
  await stop(walletWorker);
  await consume();
  await publish(events.collected({ holder, amount: events.syp(4_000) }));
  const result = await until(async () => {
    const state = await balance(holder);
    return state?.in_handover_minor === '4000' ? state : null;
  }, 'prerequisite behind deferred event');
  assert.equal(result.held_minor, '0');
  assert.equal(result.version, 2);
});

test('production consumer: malformed envelope goes to durable DLQ without financial effect', async () => {
  const poison = { ...events.collected({}), data: { amount: 'invalid' } };
  await publish(poison);
  await drainDeadLetter(poison.eventId);
  assert.equal(await projected(poison.eventId), undefined);
});

test('production consumer: missing dependency has bounded durable retries and remains uncredited in DLQ', async () => {
  const holder = randomUUID();
  const pending = events.handover({
    handoverId: randomUUID(),
    holder,
    version: 1,
    previousStatus: null,
    status: 'PENDING',
    declared: events.syp(4_000),
  });
  await publish(pending);
  const dead = await drainDeadLetter(pending.eventId);
  assert.equal(dead.properties.headers[WALLET_CUSTODY_RETRY_HEADER], WALLET_CUSTODY_MAX_RETRIES);
  assert.equal(await projected(pending.eventId), undefined);
  assert.equal(await balance(holder), undefined);
});

async function forbidden(url, operation) {
  const connection = await amqplib.connect(url);
  connection.on('error', () => {});
  const channel = await connection.createConfirmChannel();
  channel.on('error', () => {});
  try {
    await assert.rejects(() => operation(channel), /ACCESS_REFUSED|403|closed|closing/i);
  } finally {
    await connection.close().catch(() => {});
  }
}
test('real broker ACL: producer cannot read Wallet; Wallet cannot forge Billing or own foreign resources; default exchange is refused', async () => {
  await forbidden(broker.billing, (channel) => channel.get(WALLET_CUSTODY_QUEUE));
  await forbidden(broker.wallet, (channel) =>
    channel.assertExchange(EXCHANGE, 'topic', { durable: true }),
  );
  await forbidden(
    broker.wallet,
    (channel) =>
      new Promise((resolve, reject) => {
        channel.publish(EXCHANGE, 'billing.cash-collected.v1', Buffer.from('{}'), {}, (error) =>
          error ? reject(error) : resolve(),
        );
      }),
  );
  for (const url of Object.values(broker)) {
    await forbidden(url, (channel) =>
      channel.assertQueue('foreign.financial-queue', { durable: true }),
    );
    await forbidden(
      url,
      (channel) =>
        new Promise((resolve, reject) => {
          channel.publish('', WALLET_CUSTODY_QUEUE, Buffer.from('{}'), {}, (error) =>
            error ? reject(error) : resolve(),
          );
        }),
    );
  }
});
