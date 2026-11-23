/**
 * P03-D2 event-driven notifications and staff visibility on real infrastructure.
 *
 * Part E runs the real event-notification worker on the real broker. The
 * `booking.events` exchange and the Communications read grant are NOT in the
 * accepted bootstrap (CR-D-P03-07). The suite first proves the accepted ACL
 * refuses the binding, then applies exactly the requested grant as the
 * infrastructure administrator, runs the worker and restores the ACL. Booking
 * does not publish `booking.confirmed.v1` yet, so events are published by the
 * infrastructure identity in the PUBLISHED contract shape: consumer-side
 * contract evidence, not producer proof.
 *
 * Part S checks the new database invariants with the runtime identity.
 *
 * Part H serves the staff read API through the real HTTP adapter, authorized
 * by the REAL Identity service, while the real delivery worker (with a
 * declared scripted provider port: no provider account exists) moves the
 * intent, so staff see Communications' delivery state change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  ROOT,
  amqp,
  appDsn,
  brokerUrl,
  context,
  eventually,
  infraBrokerUrl,
  serviceClient,
  spawnWorker,
  sql,
} from '../../integration/_support.mjs';
import { composeExec } from '../../../scripts/acceptance/lib/infra.mjs';
import { account, bearer, staff, startIdentity } from './_identity.mjs';

const require = createRequire(path.join(ROOT, 'services', 'communications', 'package.json'));
const dist = (file) => require(path.join(ROOT, 'services', 'communications', 'dist', file));
const topology = dist('infrastructure/messaging/event-notifications-topology.js');
const { DeliveryWorker } = dist('application/notification.service.js');
const { PrismaNotificationRepository } = dist(
  'infrastructure/persistence/prisma-notification.repository.js',
);
const { BOOKING_CONFIRMED_POLICY } = dist('domain/event-notifications.js');

const client = serviceClient('communications');
test.after(() => client.$disconnect());

/* -------------------------------- fixtures -------------------------------- */

const vhost = context.vhost;
const READ_ACCEPTED = '^(communications\\.|catalog\\.events$)';
const READ_REQUESTED = '^(communications\\.|catalog\\.events$|booking\\.events$)';

async function setCommunicationsRead(pattern) {
  const result = await composeExec(context, 'rabbitmq', [
    'rabbitmqctl',
    'set_permissions',
    '-p',
    vhost,
    'cw_communications_app',
    '^communications\\.',
    '^communications\\.',
    pattern,
  ]);
  if (result.code !== 0) throw new Error(`SET_PERMISSIONS_FAILED ${result.stderr}`);
}

async function withChannel(url, fn) {
  const { connect } = amqp();
  const connection = await connect(url);
  connection.on('error', () => {});
  try {
    const channel = await connection.createConfirmChannel();
    channel.on('error', () => {});
    try {
      return await fn(channel);
    } finally {
      await channel.close().catch(() => {});
    }
  } finally {
    await connection.close().catch(() => {});
  }
}

/** The infrastructure bootstrap declares the producer exchange (E owns this step). */
async function declareBookingExchange() {
  await withChannel(infraBrokerUrl(context), (channel) =>
    channel.assertExchange('booking.events', 'topic', { durable: true }),
  );
}

async function publish(body) {
  await withChannel(
    infraBrokerUrl(context),
    (channel) =>
      new Promise((resolve, reject) => {
        channel.publish(
          'booking.events',
          'booking.confirmed.v1',
          Buffer.from(body, 'utf8'),
          { persistent: true, mandatory: true, contentType: 'application/json' },
          (error) => (error ? reject(error) : resolve()),
        );
      }),
  );
}

async function depth(queue) {
  return withChannel(brokerUrl(context, 'communications'), async (channel) => {
    const info = await channel.checkQueue(queue);
    return info.messageCount;
  });
}

function startWorker(extra = []) {
  return spawnWorker(
    [
      path.join(
        'services',
        'communications',
        'dist',
        'inbox',
        'event-notifications-consumer.runner.js',
      ),
      ...extra,
    ],
    {
      DATABASE_URL: appDsn(context, 'communications'),
      BROKER_URL: brokerUrl(context, 'communications'),
      LOG_LEVEL: 'info',
    },
    { label: 'communications-event-notifications' },
  );
}

const at = (worker, event, eventId) =>
  worker.lines.filter((l) => l.event === event && (eventId === undefined || l.eventId === eventId));

function confirmed({
  bookingId = randomUUID(),
  customerId = randomUUID(),
  occurredAt = Date.now(),
} = {}) {
  return {
    eventId: randomUUID(),
    eventType: 'booking.confirmed.v1',
    schemaVersion: 1,
    producer: 'booking',
    occurredAt: new Date(occurredAt).toISOString(),
    correlationId: randomUUID(),
    aggregateVersion: 1,
    data: { bookingId, customerId },
  };
}

function intents(bookingId) {
  return client.notification.findMany({
    where: { subjectType: 'booking', subjectRef: bookingId },
  });
}

/* --------------------------------- Part E --------------------------------- */

test('E1: the accepted broker ACL refuses the booking.events binding (CR-D-P03-07)', async () => {
  await declareBookingExchange();
  await setCommunicationsRead(READ_ACCEPTED);
  const { assertTopology } = require(
    path.join(ROOT, 'packages', 'platform-messaging', 'dist', 'index.js'),
  );
  await assert.rejects(
    withChannel(brokerUrl(context, 'communications'), (channel) =>
      assertTopology(channel, topology.eventNotificationsTopology()),
    ),
    (error) => error?.code === 403,
    'communications may not read a producer exchange it was never granted',
  );
});

test('E2: real worker — one intent per booking, crash before ACK, conflicts, late and malformed events', async (t) => {
  await declareBookingExchange();
  await setCommunicationsRead(READ_REQUESTED);
  t.after(() => setCommunicationsRead(READ_ACCEPTED));
  let worker = startWorker();
  t.after(() => worker.stop());
  await worker.waitFor((l) => l.event === 'consumer_started', { description: 'consumer start' });
  for (const queue of [topology.EVENT_NOTIFICATIONS_QUEUE, topology.EVENT_NOTIFICATIONS_DLQ])
    await withChannel(brokerUrl(context, 'communications'), (c) => c.purgeQueue(queue));

  // 1. The same bytes three times: one inbox effect, one intent.
  const bookingId = randomUUID();
  const customerId = randomUUID();
  const first = confirmed({ bookingId, customerId });
  const bytes = JSON.stringify(first);
  for (let i = 0; i < 3; i += 1) await publish(bytes);
  await eventually(() => at(worker, 'consumer_committed', first.eventId).length === 3, {
    description: 'three deliveries',
  });
  assert.deepEqual(
    at(worker, 'consumer_committed', first.eventId)
      .map((l) => l.outcome)
      .sort(),
    ['APPLIED', 'DUPLICATE', 'DUPLICATE'],
  );
  // 2. Booking re-publishes the same confirmation under a new event id: the
  //    inbox applies it, the business key replays the existing intent.
  const republished = { ...first, eventId: randomUUID(), correlationId: randomUUID() };
  await publish(JSON.stringify(republished));
  await eventually(() => at(worker, 'notification_intent', republished.eventId).length === 1, {
    description: 'republished confirmation',
  });
  assert.equal(at(worker, 'notification_intent', first.eventId)[0].outcome, 'CREATED');
  assert.equal(at(worker, 'notification_intent', republished.eventId)[0].outcome, 'REPLAYED');
  const rows = await intents(bookingId);
  assert.equal(rows.length, 1, 'exactly one intent for the booking');
  assert.equal(rows[0].state, 'QUEUED', 'persisting an intent sends nothing');
  assert.equal(rows[0].recipientRef, customerId);
  assert.deepEqual(rows[0].parameters, {
    bookingRef: bookingId.replaceAll('-', '').slice(0, 8).toUpperCase(),
  });
  assert.equal(
    rows[0].expiresAt.toISOString(),
    new Date(Date.parse(first.occurredAt) + BOOKING_CONFIRMED_POLICY.ttlMs).toISOString(),
  );
  assert.ok(await client.inboxMessage.findUnique({ where: { eventId: first.eventId } }));

  // 3. Crash after commit and before ACK: the redelivery is a DUPLICATE.
  await worker.stop();
  worker = startWorker(['--crash-before-ack-after', '1']);
  await worker.waitFor((l) => l.event === 'consumer_started', { description: 'crashing consumer' });
  const second = confirmed();
  await publish(JSON.stringify(second));
  await worker.exited;
  assert.equal(at(worker, 'consumer_crash_before_ack', second.eventId).length, 1);
  worker = startWorker();
  await eventually(() => at(worker, 'consumer_committed', second.eventId).length === 1, {
    description: 'redelivery after crash',
  });
  assert.equal(at(worker, 'consumer_committed', second.eventId)[0].outcome, 'DUPLICATE');
  assert.equal((await intents(second.data.bookingId)).length, 1);

  // 4. A confirmation past its window is recorded and skipped, never sent late.
  const late = confirmed({ occurredAt: Date.now() - BOOKING_CONFIRMED_POLICY.ttlMs - 60_000 });
  await publish(JSON.stringify(late));
  await eventually(() => at(worker, 'notification_intent', late.eventId).length === 1, {
    description: 'late confirmation',
  });
  assert.equal(at(worker, 'notification_intent', late.eventId)[0].outcome, 'SKIPPED');
  assert.equal((await intents(late.data.bookingId)).length, 0);
  assert.ok(await client.inboxMessage.findUnique({ where: { eventId: late.eventId } }));

  // 5. A rival customer for the same booking and an unpublished shape are
  //    never applied: both are dead-lettered after the delivery limit.
  const dlqBefore = await depth(topology.EVENT_NOTIFICATIONS_DLQ);
  const rival = { ...first, eventId: randomUUID(), data: { bookingId, customerId: randomUUID() } };
  await publish(JSON.stringify(rival));
  const malformed = {
    ...confirmed(),
    data: { bookingId: randomUUID(), customerId: randomUUID(), phone: '0999' },
  };
  await publish(JSON.stringify(malformed));
  await eventually(async () => (await depth(topology.EVENT_NOTIFICATIONS_DLQ)) === dlqBefore + 2, {
    description: 'rival and malformed dead-lettered',
    timeoutMs: 60_000,
  });
  assert.equal(at(worker, 'consumer_committed', rival.eventId).length, 0);
  assert.ok(
    at(worker, 'notification_integrity_conflict', rival.eventId).every(
      (l) => l.code === 'INTENT_CONFLICT',
    ),
  );
  assert.equal(await client.inboxMessage.findUnique({ where: { eventId: rival.eventId } }), null);
  assert.equal(
    (await intents(bookingId))[0].recipientRef,
    customerId,
    'the original intent is intact',
  );
  // Worker logs carry identifiers and outcomes only, never the recipient.
  assert.ok(!JSON.stringify(worker.lines).includes(customerId), 'no recipient reference in logs');
  // Correlation flows from the event into the worker's records.
  assert.equal(
    at(worker, 'notification_intent', late.eventId)[0].correlationId,
    late.correlationId,
  );
});

/* --------------------------------- Part S --------------------------------- */

test('S1: the database refuses half subjects and malformed subject types; runtime has DML only', async () => {
  const url = appDsn(context, 'communications');
  const insert = (subjectType, subjectRef) =>
    `INSERT INTO app.notification (id, source_service, idempotency_key, request_hash, recipient_ref, channel, template_key, template_version, parameters, state, next_attempt_at, expires_at, subject_type, subject_ref, created_at, updated_at)
     VALUES ('${randomUUID()}', 'booking', 'k-${randomUUID()}', '${'a'.repeat(64)}', '${randomUUID()}', 'SMS', 'booking.confirmed', 1, '{}', 'QUEUED', now(), now() + interval '1 hour', ${subjectType}, ${subjectRef}, now(), now())`;
  for (const [type, ref] of [
    ["'booking'", 'NULL'],
    ['NULL', `'${randomUUID()}'`],
    ["'Booking'", `'${randomUUID()}'`],
  ]) {
    const result = await sql(url, insert(type, ref));
    assert.equal(result.ok, false);
    assert.equal(result.code, '23514', result.message);
  }
  for (const statement of [
    'ALTER TABLE app.notification DROP CONSTRAINT notification_subject_complete',
    'TRUNCATE app.notification CASCADE',
  ]) {
    const result = await sql(url, statement);
    assert.equal(result.code, '42501', `${statement} refused for lack of privilege`);
  }
});

/* --------------------------------- Part H --------------------------------- */

const commRequire = createRequire(path.join(ROOT, 'services', 'communications', 'package.json'));

async function startCommunications(identityBase) {
  process.env.DATABASE_URL = appDsn(context, 'communications');
  process.env.IDENTITY_ORIGIN = identityBase;
  process.env.COMMUNICATIONS_READS_PER_MINUTE = '1000';
  commRequire('reflect-metadata');
  const { createHttpApplication } = commRequire('./dist/transport/http/create-app.js');
  const server = await createHttpApplication();
  await server.listen(0, '127.0.0.1');
  const base = (await server.getUrl())
    .replace('[::1]', '127.0.0.1')
    .replace('localhost', '127.0.0.1');
  return { server, base };
}

test('H1: staff see real delivery state by booking; finance and customers are refused', async (t) => {
  const identity = await startIdentity();
  t.after(() => identity.app.close().catch(() => {}));
  const comms = await startCommunications(identity.base);
  t.after(() => comms.server.close());
  const get = async (route, who, extra = {}) => {
    const response = await fetch(`${comms.base}/internal/v1/communications/notifications${route}`, {
      headers: { ...(who ? { authorization: bearer(who) } : {}), ...extra },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const operations = await staff(identity, ['operations']);
  const finance = await staff(identity, ['finance']);
  const superAdmin = await staff(identity, ['super-admin']);
  const customer = await account(identity);

  // An intent created through the same worker path as E2.
  await declareBookingExchange();
  await setCommunicationsRead(READ_REQUESTED);
  t.after(() => setCommunicationsRead(READ_ACCEPTED));
  const worker = startWorker();
  t.after(() => worker.stop());
  await worker.waitFor((l) => l.event === 'consumer_started', { description: 'consumer start' });
  const event = confirmed();
  const bookingId = event.data.bookingId;
  await publish(JSON.stringify(event));
  await eventually(() => at(worker, 'notification_intent', event.eventId).length === 1, {
    description: 'intent created',
  });

  const query = `?subjectType=booking&subjectRef=${bookingId}`;
  const queued = await get(query, operations);
  assert.equal(queued.status, 200);
  assert.equal(queued.body.items.length, 1);
  const item = queued.body.items[0];
  assert.equal(item.state, 'QUEUED');
  assert.deepEqual(item.subject, { type: 'booking', ref: bookingId });
  assert.ok(queued.body.authority.some((a) => a.owner === 'booking'));
  for (const hidden of [
    'recipientRef',
    'parameters',
    'providerMessageId',
    'requestHash',
    'leaseOwner',
  ])
    assert.ok(!(hidden in item), `${hidden} is never exposed`);
  assert.ok(!JSON.stringify(queued.body).includes(event.data.customerId));

  // The real delivery worker moves it (scripted provider: no provider exists).
  const repository = new PrismaNotificationRepository(client);
  const delivery = new DeliveryWorker(
    repository,
    {
      name: 'scripted-test-port',
      idempotentSubmission: false,
      submit: async () => ({ kind: 'ACCEPTED', messageId: `msg-${randomUUID()}` }),
    },
    { now: () => new Date() },
    () => 0.5,
    { workerId: 'p03d2-h1', batchSize: 50, submitTimeoutMs: 1_000 },
  );
  await delivery.runOnce();
  const detail = await get(`/${item.id}`, operations);
  assert.equal(detail.status, 200);
  assert.equal(
    detail.body.item.state,
    'PROVIDER_ACCEPTED',
    'accepted by the provider, not "delivered"',
  );
  assert.equal(detail.body.item.attempts.length, 1);
  assert.equal(detail.body.item.attempts[0].outcome, 'ACCEPTED');
  assert.ok(!('providerMessageId' in detail.body.item.attempts[0]));
  const byState = await get('?state=PROVIDER_ACCEPTED&limit=100', operations);
  assert.ok(byState.body.items.some((n) => n.id === item.id));

  // super-admin reads; finance, customers and anonymous callers do not.
  assert.equal((await get(query, superAdmin)).status, 200);
  assert.equal((await get(query, finance)).status, 403);
  assert.equal((await get(`/${item.id}`, customer)).status, 403);
  assert.equal((await get(query)).status, 401);
  assert.equal((await get(query, operations, { 'x-auth-subject': finance.subject })).status, 401);
  assert.equal((await get(`/${randomUUID()}`, operations)).status, 404);
  assert.equal((await get('/not-a-uuid', operations)).status, 422);
  assert.equal((await get('?subjectType=booking', operations)).status, 422);
  assert.equal((await get('?state=SENT', operations)).status, 422);
});
