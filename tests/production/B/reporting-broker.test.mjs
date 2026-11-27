/**
 * Actual Billing HTTP -> its transactional obligation outbox -> compiled relay
 * -> RabbitMQ -> compiled Reporting inbox -> own PostgreSQL -> Reporting HTTP.
 * Identity/Pricing/Dispatch are explicit upstream fixtures. Transport poison and
 * reordered envelopes below are fault injections, never evidence of payment.
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
  reporting: env('REPORTING_TEST_DATABASE_URL'),
};
const broker = {
  billing: env('BILLING_TEST_AMQP_URL'),
  reporting: env('REPORTING_TEST_AMQP_URL'),
};
const logDir = env('CW_FINANCE_BROKER_LOG_DIR');
const secrets = [...Object.values(database), ...Object.values(broker)].flatMap((url) => [
  url,
  new URL(url).password,
]);
const redact = (input) =>
  secrets.reduce((s, secret) => (secret ? s.split(secret).join('[REDACTED]') : s), String(input));
const owner = (service) => createRequire(path.join(ROOT, `services/${service}/package.json`));
const billing = owner('billing');
const reporting = owner('reporting');
const load = (service, file) =>
  owner(service)(path.join(ROOT, `services/${service}/dist-tests`, file));
const { Client } = billing('pg');
const amqplib = createRequire(path.join(ROOT, 'packages/platform-messaging/package.json'))(
  'amqplib',
);
const { BrokerConnection, ConfirmingPublisher } = billing('@carwash/platform-messaging');
const { parseCashKpisV1 } = billing('@carwash/contracts/reporting-v1');
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
const EXCHANGE = 'washgo.billing.events';
const QUEUE = 'reporting.operations';
const DLQ = 'reporting.operations.dlq';
const PREFIX = '/internal/v1/billing';
const money = (minor) => ({ currency: 'SYP', amountMinor: String(minor), scale: 2 });
const key = () => `reporting-broker-${randomUUID()}`;
const workers = new Set();
let sequence = 0;
let consumer;
let billingSql;
let reportingSql;
let prisma;
let identity;
let pricing;
let validate;
let work;
let api;
let bookings;
let reportingApi;
let reportingOrigin;
let billingConnection;
let publisher;
let readerConnection;
let reader;
let first;

async function until(probe, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(40);
  }
  throw new Error(`TIMEOUT: ${label}`);
}
function startWorker(service, args = [], crashLease = false) {
  const entry =
    service === 'billing' ? 'outbox/relay.runner.js' : 'inbox/operations-consumer.runner.js';
  const argv = crashLease
    ? [
        path.join(ROOT, 'tests/production/B/support/custody-crash-worker.mjs'),
        'billing',
        'obligations',
      ]
    : [path.join(ROOT, `services/${service}/dist`, entry), ...args];
  const child = spawn(process.execPath, argv, {
    cwd: ROOT,
    // Each compiled owner process receives only its own runtime credentials.
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      DATABASE_URL: database[service],
      BROKER_URL: broker[service],
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = {
    child,
    service,
    lines: [],
    output: '',
    done: false,
    code: null,
    signal: null,
    expectedExit: null,
    stopRequested: false,
    forced: false,
  };
  const file = path.join(logDir, `${String(++sequence).padStart(2, '0')}-${service}.log`);
  let pending = '';
  const collect = (chunk) => {
    result.output += String(chunk);
    pending += String(chunk);
    for (;;) {
      const index = pending.indexOf('\n');
      if (index < 0) break;
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      try {
        result.lines.push(JSON.parse(line));
      } catch {
        /* startup output */
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
      resolve(result);
    });
  });
  workers.add(result);
  return result;
}
async function stop(worker) {
  if (!worker) return;
  if (worker.done) {
    assert.notEqual(
      worker.expectedExit,
      null,
      `${worker.service} exited before requested shutdown: ${redact(worker.output).slice(-2000)}`,
    );
    assert.equal(worker.signal, null, `${worker.service} ended by an unexpected signal`);
    assert.equal(worker.code, worker.expectedExit, `${worker.service} unexpected exit`);
    return;
  }
  worker.stopRequested = true;
  worker.child.kill('SIGTERM');
  const timer = setTimeout(() => {
    worker.forced = true;
    worker.child.kill('SIGKILL');
  }, 7_000);
  try {
    await worker.exited;
  } finally {
    clearTimeout(timer);
  }
  assert.equal(worker.forced, false, `${worker.service} needed a forced kill`);
  assert.equal(worker.signal, null, `${worker.service} did not handle SIGTERM`);
  assert.equal(
    worker.code,
    0,
    `${worker.service} did not shut down cleanly: ${redact(worker.output).slice(-2000)}`,
  );
}
async function consume(crash = false) {
  consumer = startWorker('reporting', [
    '--prefetch',
    '1',
    ...(crash ? ['--crash-before-ack-after', '1'] : []),
  ]);
  consumer.expectedExit = crash ? 9 : null;
  await until(() => {
    if (consumer.done)
      throw new Error(`CONSUMER_EXIT_${consumer.code}: ${redact(consumer.output).slice(-2000)}`);
    return consumer.lines.some((line) => line.event === 'consumer_started');
  }, 'Reporting consumer attached');
  return consumer;
}
async function relay(expected = 0, crashLease = false) {
  const worker = startWorker('billing', ['--family', 'obligations', '--once'], crashLease);
  worker.expectedExit = expected;
  await until(() => worker.done, 'Billing obligation relay exit');
  assert.equal(worker.code, expected, redact(worker.output).slice(-3000));
}
async function post(route, body, token) {
  const result = await api.request('POST', `${PREFIX}${route}`, { token, key: key(), body });
  assert.ok([200, 201].includes(result.status), `${route}: ${JSON.stringify(result.body)}`);
  return result.body;
}
async function collectCash(total) {
  const quoteId = randomUUID();
  const bookingId = randomUUID();
  validate.quotes.set(quoteId, {
    beneficiary: { kind: 'account', subjectId: SUBJECTS.customer },
    revision: 1,
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: String(total),
  });
  const created = await bookings.request('POST', `${PREFIX}/booking-obligations`, {
    workload: WORKLOADS.booking,
    key: key(),
    body: { beneficiary: { kind: 'account', subjectId: SUBJECTS.customer }, quoteId, bookingId },
  });
  assert.equal(created.status, 201);
  const obligationId = created.body.obligationId;
  await post(
    `/obligations/${obligationId}/payment-intents`,
    { expectedRevision: 1, method: 'CASH_ON_COMPLETION' },
    TOKENS.customer,
  );
  work.book({ bookingId, technicianSubject: SUBJECTS.technician });
  const collected = await post(
    `/obligations/${obligationId}/cash-collections`,
    {
      expectedRevision: 2,
      bookingId,
      amount: money(total),
    },
    TOKENS.technician,
  );
  const result = await billingSql.query(
    `SELECT event_id, payload FROM app.outbox_message
      WHERE event_type = ANY($1::text[]) AND payload::jsonb #>> '{aggregate,id}' = $2
      ORDER BY (payload::jsonb #>> '{aggregate,version}')::int`,
    [['billing.obligation-created.v1', 'billing.obligation-status-changed.v1'], obligationId],
  );
  assert.equal(result.rowCount, 3);
  const events = result.rows.map((row) => JSON.parse(row.payload));
  assert.deepEqual(
    events.map((event) => event.data.financialStatus),
    ['UNPAID', 'AWAITING_CASH', 'CASH_COLLECTED'],
  );
  return { obligationId, events, receipt: collected.receipt };
}
async function projection(obligationId) {
  return (
    await reportingSql.query('SELECT * FROM app.ops_obligation WHERE obligation_id = $1', [
      obligationId,
    ])
  ).rows[0];
}
async function inbox(eventId) {
  return (
    await reportingSql.query('SELECT * FROM app.inbox_message WHERE event_id = $1', [eventId])
  ).rows[0];
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
async function deadLetter(eventId) {
  return until(async () => {
    const message = await reader.get(DLQ, { noAck: false });
    if (!message) return null;
    reader.ack(message);
    assert.equal(message.properties.messageId, eventId, 'unexpected dead letter');
    return message;
  }, 'durable Reporting dead letter');
}
async function kpis(token = TOKENS.finance) {
  const response = await fetch(`${reportingOrigin}/internal/v1/reporting/operations/kpis/cash`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  mkdirSync(logDir, { recursive: true });
  prisma = new PrismaService(database.billing);
  billingSql = new Client({ connectionString: database.billing });
  reportingSql = new Client({ connectionString: database.reporting });
  await billingSql.connect();
  await reportingSql.connect();
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  validate = await startValidateStub();
  work = new WorkDouble();
  const clock = new FixedClock(new Date());
  const repository = new PrismaBillingRepository(prisma);
  api = await startBillingHttp({ repository, clock, identity, pricing, work });
  bookings = await startBookingSagaHttp({ repository, clock, identity, pricing, validate });
  process.env.DATABASE_URL = database.reporting;
  process.env.IDENTITY_ORIGIN = identity.origin;
  reporting('reflect-metadata');
  const { createHttpApplication } = reporting(
    path.join(ROOT, 'services/reporting/dist/transport/http/create-app.js'),
  );
  reportingApi = await createHttpApplication();
  await reportingApi.listen(0, '127.0.0.1');
  reportingOrigin = await reportingApi.getUrl();
  billingConnection = await BrokerConnection.open({
    url: broker.billing,
    connectionName: 'billing-reporting-acceptance',
  });
  await billingConnection.channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  publisher = new ConfirmingPublisher(billingConnection.channel);
  readerConnection = await amqplib.connect(broker.reporting);
  reader = await readerConnection.createChannel();
  reader.on('error', () => {});
});
after(async () => {
  const outcomes = await Promise.allSettled([...workers].map(stop));
  outcomes.push(
    ...(await Promise.allSettled([reportingApi?.close(), api?.close(), bookings?.close()])),
  );
  outcomes.push(
    ...(await Promise.allSettled([
      identity?.close(),
      pricing?.close(),
      validate?.close(),
      billingConnection?.close(),
      readerConnection?.close(),
      prisma?.onModuleDestroy(),
      billingSql?.end(),
      reportingSql?.end(),
    ])),
  );
  const failed = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(
    failed.length,
    0,
    failed.map((outcome) => redact(outcome.reason?.stack ?? outcome.reason)).join('\n'),
  );
});

test('real Billing obligation facts: unroutable remains pending; crash after Reporting commit redelivers once; cash KPI preserves collection without treasury inference', async () => {
  assert.equal((await kpis(null)).status, 401);
  assert.equal((await kpis(TOKENS.customer)).status, 403);
  const empty = parseCashKpisV1((await kpis()).body);
  assert.deepEqual(empty.incompleteSources, ['billing']);
  first = await collectCash(12_345);
  await relay(1);
  const pending = await billingSql.query(
    'SELECT published_at, last_error FROM app.outbox_message WHERE event_id = ANY($1::uuid[])',
    [first.events.map((event) => event.eventId)],
  );
  assert.ok(
    pending.rows.every((row) => row.published_at === null && row.last_error === 'UNROUTABLE'),
  );
  const crashed = await consume(true);
  await relay();
  await until(() => crashed.done, 'Reporting crash after commit');
  assert.equal(crashed.code, 9);
  const committed = crashed.lines.find((line) => line.event === 'consumer_crash_before_ack');
  assert.ok(committed);
  assert.ok(await inbox(committed.eventId));
  const restarted = await consume();
  await until(
    () =>
      restarted.lines.some(
        (line) => line.eventId === committed.eventId && line.outcome === 'DUPLICATE',
      ),
    'committed delivery deduplicated after restart',
  );
  await until(
    async () => (await projection(first.obligationId))?.version === 3,
    'latest Billing revision projected',
  );
  const row = await projection(first.obligationId);
  assert.equal(row.cash_state, 'CASH_COLLECTED');
  assert.equal(row.outstanding_minor, '0');
  const response = await kpis();
  assert.equal(response.status, 200);
  const cash = parseCashKpisV1(response.body);
  assert.deepEqual(cash.incompleteSources, []);
  assert.equal(cash.states.find((state) => state.cashState === 'CASH_COLLECTED').count, 1);
  assert.equal(cash.states.find((state) => state.cashState === 'PAID').count, 0);
  const untouched = await billingSql.query(
    "SELECT attempts, published_at FROM app.outbox_message WHERE event_type = 'billing.cash-collected.v1'",
  );
  assert.ok(
    untouched.rows.length > 0 &&
      untouched.rows.every((fact) => fact.attempts === 0 && fact.published_at === null),
    'obligation worker does not lease custody facts',
  );
  await assert.rejects(
    () =>
      reportingSql.query(
        'UPDATE app.ops_obligation SET outstanding_minor = 1 WHERE obligation_id = $1',
        [first.obligationId],
      ),
    /ops_obligation_closed_settled/,
  );
  await assert.rejects(
    () =>
      reportingSql.query(
        "UPDATE app.ops_obligation SET cash_state = 'SETTLED' WHERE obligation_id = $1",
        [first.obligationId],
      ),
    /ops_obligation_state_known/,
  );
});

test('real obligation lease recovery and actual cash reversal converge without stale or duplicate financial effects', async () => {
  const second = await collectCash(400);
  await relay(8, true);
  const leased = await billingSql.query(
    'SELECT locked_by, published_at FROM app.outbox_message WHERE event_id = $1',
    [second.events[0].eventId],
  );
  assert.ok(leased.rows[0].locked_by);
  assert.equal(leased.rows[0].published_at, null);
  await until(
    async () =>
      (
        await billingSql.query(
          'SELECT locked_until < now() AS expired FROM app.outbox_message WHERE event_id = $1',
          [second.events[0].eventId],
        )
      ).rows[0].expired,
    'expired crashed producer lease',
  );
  await relay();
  await until(
    async () => (await projection(second.obligationId))?.cash_state === 'CASH_COLLECTED',
    'reclaimed obligation facts',
  );
  const current = first.events.at(-1);
  const duplicatesBefore = consumer.lines.filter(
    (line) => line.eventId === current.eventId && line.outcome === 'DUPLICATE',
  ).length;
  await publish(current);
  await until(
    () =>
      consumer.lines.filter(
        (line) => line.eventId === current.eventId && line.outcome === 'DUPLICATE',
      ).length > duplicatesBefore,
    'exact duplicate',
  );
  const stale = { ...first.events[0], eventId: randomUUID() };
  await publish(stale);
  await until(() => inbox(stale.eventId), 'older source revision processed');
  assert.equal((await projection(first.obligationId)).cash_state, 'CASH_COLLECTED');
  await post(
    `/cash-receipts/${first.receipt.receiptId}/reversal`,
    { expectedRevision: first.receipt.revision, reason: 'RECORDED_IN_ERROR' },
    TOKENS.corrector,
  );
  const authority = await api.request('GET', `${PREFIX}/obligations/${first.obligationId}`, {
    token: TOKENS.finance,
  });
  assert.equal(authority.status, 200);
  await relay();
  await until(
    async () => (await projection(first.obligationId))?.version === authority.body.revision,
    'actual Billing reversal revision',
  );
  const row = await projection(first.obligationId);
  assert.equal(row.cash_state, authority.body.financialStatus);
  assert.equal(row.outstanding_minor, authority.body.outstanding.amountMinor);
});

test('registered envelope poison and contradictory aggregate revisions dead-letter without changing the actual Billing projection', async () => {
  const before = await projection(first.obligationId);
  const actual = (
    await billingSql.query(
      "SELECT payload FROM app.outbox_message WHERE event_type = 'billing.obligation-status-changed.v1' AND payload::jsonb #>> '{aggregate,id}' = $1 ORDER BY (payload::jsonb #>> '{aggregate,version}')::int DESC LIMIT 1",
      [first.obligationId],
    )
  ).rows[0];
  const last = JSON.parse(actual.payload);
  const contradiction = {
    ...last,
    eventId: randomUUID(),
    data: {
      ...last.data,
      previousFinancialStatus: 'AWAITING_CASH',
      financialStatus: 'PAID',
      outstanding: money(0),
      verified: money(12_345),
    },
  };
  await publish(contradiction);
  await deadLetter(contradiction.eventId);
  assert.equal(
    await inbox(contradiction.eventId),
    undefined,
    'conflicting effect and inbox roll back together',
  );
  const malformed = {
    ...last,
    eventId: randomUUID(),
    data: { ...last.data, providerReference: 'SYNTHETIC_FORBIDDEN_FIELD' },
  };
  await publish(malformed);
  await deadLetter(malformed.eventId);
  assert.equal(await inbox(malformed.eventId), undefined);
  assert.deepEqual(await projection(first.obligationId), before);
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
const attemptPublish = (channel, exchange, routingKey) =>
  new Promise((resolve, reject) => {
    channel.publish(exchange, routingKey, Buffer.from('{}'), {}, (error) =>
      error ? reject(error) : resolve(),
    );
  });
test('real owner identities cannot cross databases, forge Billing, consume foreign custody topics or use the default exchange', async () => {
  await forbidden(broker.billing, (channel) => channel.get(QUEUE));
  await forbidden(broker.reporting, (channel) =>
    channel.assertExchange(EXCHANGE, 'topic', { durable: true }),
  );
  await forbidden(broker.reporting, (channel) =>
    attemptPublish(channel, EXCHANGE, 'billing.obligation-created.v1'),
  );
  await forbidden(broker.reporting, (channel) =>
    channel.bindQueue(QUEUE, EXCHANGE, 'billing.cash-collected.v1'),
  );
  await forbidden(broker.reporting, (channel) => channel.bindQueue(QUEUE, EXCHANGE, '#'));
  await forbidden(broker.billing, (channel) =>
    attemptPublish(channel, EXCHANGE, 'billing.provider-credit-changed.v1'),
  );
  for (const service of ['billing', 'reporting']) {
    await forbidden(broker[service], (channel) =>
      channel.assertQueue('foreign.financial-queue', { durable: true }),
    );
    await forbidden(broker[service], (channel) => attemptPublish(channel, '', QUEUE));
    const other = new URL(database[service]);
    other.pathname = service === 'billing' ? '/cw_reporting' : '/cw_billing';
    const foreign = new Client({
      connectionString: other.toString(),
      connectionTimeoutMillis: 3000,
    });
    try {
      await assert.rejects(() => foreign.connect(), /permission denied/);
    } finally {
      await foreign.end().catch(() => {});
    }
  }
});
