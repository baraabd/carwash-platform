/* global document, MutationObserver -- evaluated in the browser page */
/**
 * P06-C full technician scope across REAL Lane C services (carries the P03-C
 * merge-candidate journey, which never reached main, and extends it with the
 * assignment race, reassignment, obstacles, collections and revoked
 * eligibility, at the API and in the technician app itself).
 *
 * Processes: compiled Workforce, Dispatch, Booking and Media APIs on the lane
 * PostgreSQL (one database and runtime role per service), SeaweedFS S3, and
 * RabbitMQ 4.2 carrying the PUBLISHED workforce.eligibility-changed.v1 from
 * Workforce's outbox (shared OutboxRelay) to Dispatch's inbox (shared
 * InboxConsumer).
 *
 * Doubles, declared: Identity's session view and Booking's owner services
 * (customer/vehicle/pricing/scheduling, from Booking's test support). The job
 * is opened in Dispatch by the COMMITTED scheduling.hold-changed.v1 that
 * Booking's saga produced on the scheduling double (published parser).
 *
 * Proves together:
 *   - real eligibility: Dispatch offers only to a resource Workforce lists as
 *     ELIGIBLE with a covering shift (operator created, verified, skilled and
 *     scheduled through Workforce's own API);
 *   - acceptance -> task; Booking's technician view authorized by Dispatch;
 *   - before/after photos uploaded to Media (presigned PUT to real S3,
 *     finalized), linked and claimed by Dispatch, readable via read-url;
 *   - the six phases to a cash handoff and Dispatch's work evidence COMPLETED;
 *   - assignment races: concurrent accept vs operations reassignment and a
 *     double accept resolve to exactly one winner and a definite refusal;
 *   - reassignment mid-job: the first technician's task ends REASSIGNED and
 *     is fenced; the second technician completes it;
 *   - obstacles and collections: help/payment notes, a technician release,
 *     cash not collected then an exact late collection;
 *   - revoked eligibility end to end: a Workforce suspension relayed over
 *     RabbitMQ withdraws live offers and not-yet-departed tasks and flags
 *     field work, never cancelling it;
 *   - the technician app (operator-web dist through the gateway harness of
 *     the requested CR-P03-C5 routes) completes a real job and shows the
 *     race, reassignment and eligibility outcomes.
 *
 * P06-CLOSE-07 adds, on the same real services: a replayed key applies once,
 * a stale revision and another technician's task or Media object are refused,
 * a lost response in the app is retried with the same key (one transition),
 * an interrupted object-store PUT resumes on the same reservation, and the
 * app renews short-lived read URLs before they lapse.
 *
 * Not exercised: the real Gateway (routes unpublished, Lane E), real
 * Identity sessions (double), Billing (no technician receipt path, B-P06-C-01;
 * the harness's billing upstream is a declared stub answering 503, so the app
 * holds no custody fact).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ROOT,
  digest,
  freePort,
  messaging,
  readContext,
  require,
  serviceDist,
  startProcess,
  waitHttp,
} from './_support.mjs';

const main = (service) => path.join(ROOT, 'services', service, 'dist', 'main.js');
const { startOwnerDoubles, bookingEnv } = require(
  path.join(ROOT, 'services', 'booking', 'dist-tests', 'test', 'support', 'owner-doubles.js'),
);
const { PrismaService: DispatchPrisma } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma.service.js',
);
const { PrismaDispatchStore } = serviceDist(
  'dispatch',
  'infrastructure/persistence/prisma-dispatch.store.js',
);
const { holdChangedConsumerParts } = serviceDist(
  'dispatch',
  'transport/messaging/hold-changed.consumer.js',
);
const { eligibilityChangedConsumerParts, ELIGIBILITY_CHANGED_ROUTING_KEY } = serviceDist(
  'dispatch',
  'transport/messaging/eligibility-changed.consumer.js',
);
const { systemClock, uuidGenerator } = serviceDist('dispatch', 'infrastructure/runtime/system.js');
const { PrismaService: WorkforcePrisma } = serviceDist(
  'workforce',
  'infrastructure/persistence/prisma.service.js',
);
const { PrismaOutboxStore: WorkforceOutbox } = serviceDist(
  'workforce',
  'infrastructure/messaging/prisma-outbox.store.js',
);
const { S3ObjectStore } = serviceDist('media', 'infrastructure/storage/s3-object-store.js');
const { BrokerConnection, InboxConsumer, OutboxRelay, ConfirmingPublisher, assertTopology } =
  messaging();

const T = (name) => `p06c-${name}-${randomUUID()}`;
const TOKENS = {
  customer: T('customer'),
  ops: T('ops'),
  reviewer: T('reviewer'),
};
const SUBJECTS = Object.fromEntries(Object.keys(TOKENS).map((k) => [k, randomUUID()]));
const CREDS = {
  dispatchToWorkforce: `dw-${'a'.repeat(40)}`,
  dispatchToMedia: `dm-${'b'.repeat(40)}`,
  bookingToDispatch: `bd-${'c'.repeat(40)}`,
};
const RUN = randomUUID().slice(0, 8);
const QUEUE = `p06c.dispatch.eligibility.${RUN}`;

let context;
let doubles;
let procs = [];
let ports = {};
let dispatchPrisma;
let workforcePrisma;
let connection;
let consumer;
let holdParts;

before(async () => {
  context = await readContext();
  doubles = await startOwnerDoubles();
  // Technicians are created per scenario by technician(): fresh subject, token and operator.
  const sessions = {
    customer: ['bookings.create:self', 'bookings.read:self'],
    ops: ['operations.dispatch'],
    reviewer: ['verification.review'],
  };
  for (const [name, permissions] of Object.entries(sessions)) {
    doubles.sessions.set(TOKENS[name], {
      subject: SUBJECTS[name],
      principalKind: 'account',
      permissions,
    });
  }
  for (const name of ['workforce', 'media', 'dispatch', 'booking']) ports[name] = await freePort();
  const s3 = {
    endpoint: context.s3.endpoint,
    region: context.s3.region,
    bucket: `p06c-${RUN}`,
    accessKeyId: context.s3.accessKeyId,
    secretAccessKey: context.s3.secretAccessKey,
  };
  await new S3ObjectStore({
    ...s3,
    requestTimeoutMs: 30_000, // setup only: a loaded host can be slow to answer the first S3 call
    maxConcurrentReads: 4,
  }).createBucketIfMissing();
  const mediaEnv = {
    MEDIA_S3_ENDPOINT: s3.endpoint,
    MEDIA_S3_REGION: s3.region,
    MEDIA_S3_BUCKET: s3.bucket,
    MEDIA_S3_ACCESS_KEY_ID: s3.accessKeyId,
    MEDIA_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
    MEDIA_S3_ALLOW_PLAINTEXT: 'true',
  };
  const local = (name) => `http://127.0.0.1:${ports[name]}`;
  const common = { HOST: '127.0.0.1', IDENTITY_URL: doubles.url };

  procs.push(
    startProcess(main('workforce'), {
      ...common,
      PORT: String(ports.workforce),
      DATABASE_URL: context.databases.workforce.appUrl,
      WORKFORCE_USER_REQUESTS_PER_MINUTE: '1000',
      WORKFORCE_SERVICE_CLIENTS: JSON.stringify([
        {
          id: 'dispatch',
          tokenSha256: digest(CREDS.dispatchToWorkforce),
          scopes: ['workforce.capacity.read'],
        },
      ]),
    }),
  );
  procs.push(
    startProcess(main('media'), {
      ...common,
      PORT: String(ports.media),
      DATABASE_URL: context.databases.media.appUrl,
      ...mediaEnv,
      MEDIA_USER_REQUESTS_PER_MINUTE: '1000',
      // The policy minimum, so the app's renewal of read URLs is observable in one test.
      MEDIA_READ_URL_TTL_SECONDS: '60',
      MEDIA_SERVICE_CLIENTS: JSON.stringify([
        {
          id: 'dispatch',
          tokenSha256: digest(CREDS.dispatchToMedia),
          scopes: ['media.object.read', 'media.object.claim'],
        },
      ]),
    }),
  );
  procs.push(
    startProcess(main('dispatch'), {
      ...common,
      PORT: String(ports.dispatch),
      DATABASE_URL: context.databases.dispatch.appUrl,
      DISPATCH_USER_REQUESTS_PER_MINUTE: '1000',
      DISPATCH_SERVICE_CLIENTS: JSON.stringify([
        {
          id: 'booking',
          tokenSha256: digest(CREDS.bookingToDispatch),
          scopes: ['dispatch.assignment.read'],
        },
      ]),
      DISPATCH_WORKFORCE_URL: local('workforce'),
      DISPATCH_WORKFORCE_CLIENT_ID: 'dispatch',
      DISPATCH_WORKFORCE_CLIENT_TOKEN: CREDS.dispatchToWorkforce,
      DISPATCH_MEDIA_URL: local('media'),
      DISPATCH_MEDIA_CLIENT_ID: 'dispatch',
      DISPATCH_MEDIA_CLIENT_TOKEN: CREDS.dispatchToMedia,
    }),
  );
  procs.push(
    startProcess(main('booking'), {
      ...bookingEnv(doubles, context.databases.booking.appUrl),
      ...common,
      PORT: String(ports.booking),
      BOOKING_USER_REQUESTS_PER_MINUTE: '1000',
      BOOKING_INLINE_SAGA_BUDGET_MS: '15000',
      BOOKING_DISPATCH_URL: local('dispatch'),
      BOOKING_DISPATCH_CLIENT_ID: 'booking',
      BOOKING_DISPATCH_CLIENT_TOKEN: CREDS.bookingToDispatch,
      BOOKING_DISPATCH_TIMEOUT_MS: '2000',
    }),
  );
  // procs were pushed in the same order as ports: workforce, media, dispatch, booking.
  for (const [index, name] of Object.keys(ports).entries()) {
    try {
      // Four Nest processes boot together; a loaded host needs more than the default 30 s.
      await waitHttp(`${local(name)}/health/live`, (status) => status === 200, 120_000);
    } catch (error) {
      const proc = procs[index];
      throw new Error(
        `${name} did not become live (exit ${proc.child.exitCode}): ${proc.stderr().slice(-1500)}`,
        { cause: error },
      );
    }
  }

  dispatchPrisma = new DispatchPrisma(context.databases.dispatch.appUrl);
  workforcePrisma = new WorkforcePrisma(context.databases.workforce.appUrl);
  holdParts = holdChangedConsumerParts(
    new PrismaDispatchStore(dispatchPrisma),
    systemClock,
    uuidGenerator,
  );

  connection = await BrokerConnection.open({
    url: context.brokerUrl,
    connectionName: 'p06c-real-services',
  });
  await assertTopology(connection.channel, {
    exchanges: [{ name: 'workforce.events', type: 'topic' }],
    queues: [{ name: QUEUE, queueType: 'quorum', deliveryLimit: 3 }],
    bindings: [
      { queue: QUEUE, exchange: 'workforce.events', routingKey: ELIGIBILITY_CHANGED_ROUTING_KEY },
    ],
  });
  // Older rows of other suites are relayed first; drain them before this suite listens.
  await relayWorkforceOutbox();
  await connection.channel.purgeQueue(QUEUE);
  const parts = eligibilityChangedConsumerParts(
    new PrismaDispatchStore(dispatchPrisma),
    systemClock,
    uuidGenerator,
  );
  consumer = new InboxConsumer({
    channel: connection.channel,
    queue: QUEUE,
    store: parts.store,
    parse: parts.parse,
    effect: parts.effect,
  });
  await consumer.start();
});

after(async () => {
  await consumer?.stop();
  await connection?.channel.deleteQueue(QUEUE).catch(() => {});
  await connection?.close();
  for (const proc of procs) await proc.kill();
  await dispatchPrisma?.client.$disconnect();
  await workforcePrisma?.client.$disconnect();
  await doubles?.close();
});

async function relayWorkforceOutbox() {
  const relay = new OutboxRelay({
    workerId: `p06c-relay-${randomUUID().slice(0, 8)}`,
    store: new WorkforceOutbox(workforcePrisma),
    publisher: new ConfirmingPublisher(connection.channel),
    batchSize: 200,
  });
  for (let i = 0; i < 100; i += 1) {
    if ((await relay.runOnce()).leased === 0) return;
  }
  throw new Error('workforce outbox did not drain');
}

async function call(service, method, route, token, { body, key, headers = {} } = {}) {
  const res = await fetch(`http://127.0.0.1:${ports[service]}/internal/v1/${service}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}

const key = () => `p06c-${randomUUID()}`;

async function until(probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(150);
  }
  throw new Error('condition not reached');
}

/** A CONFIRMED booking through Booking's API; the job opened in Dispatch from the committed hold. */
async function bookingWithJob() {
  const issued = doubles.issue({ kind: 'account', subjectId: SUBJECTS.customer });
  const created = await call('booking', 'POST', '/bookings', TOKENS.customer, {
    key: key(),
    body: {
      quote: { quoteId: issued.quoteId, revision: 1 },
      hold: { holdId: issued.holdId, revision: 1 },
      vehicle: {
        source: 'inline',
        inline: { type: 'sedan', make: 'Kia', model: 'Rio', color: null, plate: null },
      },
      address: { addressId: randomUUID(), revision: 1 },
      contact: { name: 'سارة أحمد', phone: '0912345678', notes: null },
      paymentMethod: 'CASH_ON_COMPLETION',
    },
  });
  assert.equal(created.status, 201, created.text);
  const hold = doubles.holds.get(issued.holdId);
  const raw = {
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: hold.holdId, version: hold.revision },
    actor: { kind: 'service', id: 'booking' },
    data: {
      state: 'COMMITTED',
      zoneId: hold.zoneId,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
      bookingId: created.body.bookingId,
    },
  };
  const text = JSON.stringify(raw);
  const message = holdParts.parse(JSON.parse(text));
  await holdParts.store.applyOnce(
    {
      eventId: message.eventId,
      eventType: message.eventType,
      payloadHash: createHash('sha256').update(text).digest('hex'),
      correlationId: message.correlationId,
    },
    (tx) => holdParts.effect(message, tx),
  );
  const job = await call(
    'dispatch',
    'GET',
    `/bookings/${created.body.bookingId}/assignment`,
    TOKENS.ops,
  );
  assert.equal(job.status, 200, job.text);
  return { bookingId: created.body.bookingId, hold, assignment: job.body };
}

/** A real Workforce operator: created, verified, skilled, with a shift covering `window`. */
async function eligibleOperator(subjectToken, subject, zoneId, window) {
  const created = await call('workforce', 'POST', '/operators', TOKENS.ops, {
    body: { identitySubject: subject, displayName: 'فني الاختبار', homeZoneId: zoneId },
  });
  assert.equal(created.status, 201, created.text);
  const operatorId = created.body.operatorId;
  const submitted = await call('workforce', 'POST', '/me/verification-cases', subjectToken, {
    key: key(),
    body: { evidenceRefs: [randomUUID()] },
  });
  assert.equal(submitted.status, 201, submitted.text);
  const reviewed = await call(
    'workforce',
    'POST',
    `/${submitted.body.caseId}/review`,
    TOKENS.reviewer,
    {
      body: {
        decision: 'APPROVE',
        validUntil: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      },
    },
  );
  assert.equal(reviewed.status, 200, reviewed.text);
  const skill = await call('workforce', 'POST', `/operators/${operatorId}/skills`, TOKENS.ops, {
    body: { skillCode: 'wash.exterior' },
  });
  assert.ok(skill.status === 200 || skill.status === 201, skill.text);
  const shift = await call('workforce', 'POST', `/operators/${operatorId}/shifts`, subjectToken, {
    key: key(),
    body: {
      zoneId,
      startsAt: new Date(Date.parse(window.startsAt) - 3_600_000).toISOString(),
      endsAt: new Date(Date.parse(window.endsAt) + 3_600_000).toISOString(),
    },
  });
  assert.equal(shift.status, 201, shift.text);
  return operatorId;
}

/** A real JPEG-shaped object uploaded to Media through the presigned URL and finalized. */
async function uploadPhoto(token) {
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(randomUUID().repeat(20)),
    Buffer.from([0xff, 0xd9]),
  ]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const reserved = await call('media', 'POST', '/uploads', token, {
    key: key(),
    body: { purpose: 'WORK_EVIDENCE', contentType: 'image/jpeg', byteLength: bytes.length, sha256 },
  });
  assert.equal(reserved.status, 201, reserved.text);
  const upload = reserved.body.upload;
  const put = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: bytes,
  });
  assert.ok(put.ok, `S3 PUT ${put.status}`);
  const finalized = await call(
    'media',
    'POST',
    `/objects/${reserved.body.objectId}/finalize`,
    token,
    { key: key(), body: {} },
  );
  assert.equal(finalized.status, 200, finalized.text);
  assert.equal(finalized.body.status, 'AVAILABLE');
  return { objectId: reserved.body.objectId, bytes };
}

// ------------------------------------------------------------------ P06-C helpers

const TECH_PERMISSIONS = [
  'work.read:assigned',
  'work.execute:assigned',
  'profile.read:self',
  'profile.write:self',
];

/** A fresh technician identity (session double) with a real, eligible Workforce operator. */
async function technician(job, label = 'tech') {
  const subject = randomUUID();
  const token = T(label);
  doubles.sessions.set(token, { subject, principalKind: 'account', permissions: TECH_PERMISSIONS });
  const operatorId = await eligibleOperator(token, subject, job.hold.zoneId, job.hold);
  return { subject, token, operatorId };
}

const assignmentOf = async (job) =>
  (await call('dispatch', 'GET', `/bookings/${job.bookingId}/assignment`, TOKENS.ops)).body;

async function offerTo(job, tech) {
  const current = await assignmentOf(job);
  const res = await call(
    'dispatch',
    'POST',
    `/assignments/${current.assignmentId}/offers`,
    TOKENS.ops,
    {
      key: key(),
      body: {
        expectedRevision: current.revision,
        resourceId: tech.operatorId,
        technicianSubjectId: tech.subject,
      },
    },
  );
  assert.equal(res.status, 201, res.text);
  return res.body.offer.offerId;
}

async function reassign(job, tech, revision) {
  const current = await assignmentOf(job);
  return call('dispatch', 'POST', `/assignments/${current.assignmentId}/reassign`, TOKENS.ops, {
    key: key(),
    body: {
      expectedRevision: revision ?? current.revision,
      resourceId: tech.operatorId,
      technicianSubjectId: tech.subject,
    },
  });
}

async function accept(tech, offerId, idempotencyKey = key()) {
  return call('dispatch', 'POST', `/offers/${offerId}/accept`, tech.token, {
    key: idempotencyKey,
    body: {},
  });
}

/** A technician's task driver: every step revision-fenced with a fresh Idempotency-Key. */
function driver(tech, taskId) {
  const d = {
    task: null,
    async read() {
      const res = await call('dispatch', 'GET', `/me/tasks/${taskId}`, tech.token);
      d.task = res.status === 200 ? res.body : null;
      return res;
    },
    async step(method, route, body = {}) {
      return call('dispatch', method, `/tasks/${taskId}${route}`, tech.token, {
        key: key(),
        body: { expectedRevision: d.task.revision, ...body },
      });
    },
    async go(method, route, body = {}) {
      const res = await d.step(method, route, body);
      assert.equal(res.status, 200, `${route}: ${res.text}`);
      d.task = res.body;
      return res.body;
    },
    async toFinished() {
      if (d.task.stage === 'ACCEPTED') await d.go('POST', '/depart');
      if (d.task.stage === 'EN_ROUTE') await d.go('POST', '/arrive');
      const before = await uploadPhoto(tech.token);
      await d.go('PUT', '/evidence/BEFORE/0', { mediaObjectId: before.objectId });
      await d.go('POST', '/start');
      for (const code of ['exterior', 'wheels', 'interior', 'quality'])
        await d.go('PUT', `/checklist/${code}`, { checked: true });
      await d.go('POST', '/document');
      const afterPhoto = await uploadPhoto(tech.token);
      await d.go('PUT', '/evidence/AFTER/0', { mediaObjectId: afterPhoto.objectId });
      await d.go('POST', '/finish');
      return d.task;
    },
  };
  return d;
}

const reasonOf = (res) => res.body?.error?.reason ?? null;
const totalOf = async (job, tech) =>
  (await call('booking', 'GET', `/bookings/${job.bookingId}/technician-view`, tech.token)).body
    .total;

async function suspend(operatorId) {
  const res = await call('workforce', 'PATCH', `/operators/${operatorId}/status`, TOKENS.ops, {
    body: { suspensionReason: 'OPERATIONS' },
  });
  assert.equal(res.status, 200, res.text);
}

// ------------------------------------------------------------------- API journeys

test('a real technician job: eligibility, acceptance, six phases with real photos, cash handoff', async () => {
  const job = await bookingWithJob();
  const tech = await technician(job);
  const intruder = await technician(await bookingWithJob(), 'intruder');

  // A resource Workforce does not list is refused by real eligibility.
  const refused = await call(
    'dispatch',
    'POST',
    `/assignments/${job.assignment.assignmentId}/offers`,
    TOKENS.ops,
    {
      key: key(),
      body: {
        expectedRevision: job.assignment.revision,
        resourceId: randomUUID(),
        technicianSubjectId: tech.subject,
      },
    },
  );
  assert.deepEqual([refused.status, reasonOf(refused)], [422, 'RESOURCE_INELIGIBLE']);

  const offerId = await offerTo(job, tech);
  assert.equal(
    (await call('booking', 'GET', `/bookings/${job.bookingId}/technician-view`, tech.token)).status,
    404,
    'no Booking details before acceptance',
  );
  assert.equal((await accept(intruder, offerId)).status, 404, 'an offer is only for its addressee');
  const accepted = await accept(tech, offerId);
  assert.equal(accepted.status, 200, accepted.text);
  const d = driver(tech, accepted.body.taskId);
  await d.read();

  const view = await call(
    'booking',
    'GET',
    `/bookings/${job.bookingId}/technician-view`,
    tech.token,
  );
  assert.equal(view.status, 200, view.text);
  assert.equal(view.body.paymentMethod, 'CASH_ON_COMPLETION');
  assert.equal(
    (await call('booking', 'GET', `/bookings/${job.bookingId}/technician-view`, intruder.token))
      .status,
    404,
  );

  await d.go('POST', '/depart');
  await d.go('POST', '/arrive');
  // A photo owned by somebody else is never accepted as this job's evidence.
  const foreign = await uploadPhoto(intruder.token);
  const misuse = await d.step('PUT', '/evidence/BEFORE/0', { mediaObjectId: foreign.objectId });
  assert.deepEqual([misuse.status, reasonOf(misuse)], [422, 'EVIDENCE_INVALID']);
  await d.toFinished();

  const work = await call('dispatch', 'GET', `/me/bookings/${job.bookingId}/work`, tech.token);
  assert.deepEqual(
    [work.body.workState, work.body.technicianSubjectId],
    ['COMPLETED', tech.subject],
  );

  // The linked photos are claimed in Media and readable through a short-lived URL.
  const evidence = d.task.evidence.BEFORE[0].mediaObjectId;
  const meta = await call('media', 'GET', `/objects/${evidence}`, tech.token);
  assert.equal(meta.body.claimed, true);
  const readUrl = await call('media', 'POST', `/objects/${evidence}/read-url`, tech.token, {
    key: key(),
    body: {},
  });
  assert.equal(readUrl.status, 200, readUrl.text);
  assert.equal((await fetch(readUrl.body.url)).status, 200);
  const peek = await call('media', 'POST', `/objects/${evidence}/read-url`, intruder.token, {
    key: key(),
    body: {},
  });
  assert.equal(peek.status, 404, 'private media: another technician cannot read it');

  await d.go('POST', '/close', {
    collection: { outcome: 'CASH_COLLECTED', amount: view.body.total },
  });
  assert.equal(d.task.stage, 'CLOSED');
  assert.deepEqual(d.task.collection.amount, view.body.total);
});

test('assignment race: accept vs operations reassignment, and a double accept, each resolve to one winner', async () => {
  for (let round = 0; round < 3; round += 1) {
    const job = await bookingWithJob();
    const first = await technician(job, 'race-a');
    const second = await technician(job, 'race-b');
    const offerId = await offerTo(job, first);
    const revision = (await assignmentOf(job)).revision;
    const [accepted, moved] = await Promise.all([
      accept(first, offerId),
      reassign(job, second, revision),
    ]);
    if (accepted.status === 200) {
      // Acceptance won: the reassignment carried a stale assignment revision.
      assert.equal(moved.status, 412, `round ${round}: ${moved.text}`);
      assert.equal((await assignmentOf(job)).status, 'ASSIGNED');
      const jobs = await call('dispatch', 'GET', '/me/jobs', first.token);
      assert.ok(
        jobs.body.tasks.some((t) => t.bookingId === job.bookingId && t.stage === 'ACCEPTED'),
      );
    } else {
      // Reassignment won: the first offer is no longer live and no task exists for it.
      assert.equal(moved.status, 200, `round ${round}: ${moved.text}`);
      assert.deepEqual(
        [accepted.status, reasonOf(accepted)],
        [409, 'OFFER_NOT_LIVE'],
        `round ${round}: ${accepted.text}`,
      );
      const jobs = await call('dispatch', 'GET', '/me/jobs', first.token);
      assert.ok(!jobs.body.tasks.some((t) => t.bookingId === job.bookingId));
      const theirs = await call('dispatch', 'GET', '/me/jobs', second.token);
      assert.ok(
        theirs.body.offers.some((o) => o.job.bookingId === job.bookingId && o.status === 'OFFERED'),
      );
    }
  }

  // Double accept by the same technician with two different keys: one task. Accepting the
  // offer one already holds is Dispatch's natural replay (same task); a request that read the
  // offer before the other's commit may instead get a definite 409 OFFER_NOT_LIVE.
  const job = await bookingWithJob();
  const tech = await technician(job, 'double');
  const offerId = await offerTo(job, tech);
  const sameKey = key();
  const results = await Promise.all([accept(tech, offerId, sameKey), accept(tech, offerId)]);
  const winners = results.filter((r) => r.status === 200);
  assert.ok(winners.length >= 1, results.map((r) => r.text).join(' | '));
  assert.equal(new Set(winners.map((r) => r.body.taskId)).size, 1, 'one task id');
  for (const loser of results.filter((r) => r.status !== 200))
    assert.deepEqual([loser.status, reasonOf(loser)], [409, 'OFFER_NOT_LIVE']);
  const tasks = (await call('dispatch', 'GET', '/me/jobs', tech.token)).body.tasks.filter(
    (t) => t.bookingId === job.bookingId,
  );
  assert.equal(tasks.length, 1, 'exactly one task');
  if (results[0].status === 200) {
    const replay = await accept(tech, offerId, sameKey);
    assert.deepEqual(
      [replay.status, replay.body.taskId],
      [200, results[0].body.taskId],
      'same key replays',
    );
  }

  // One technician cannot hold two overlapping jobs.
  const overlapping = await bookingWithJob();
  const busy = await call(
    'dispatch',
    'POST',
    `/assignments/${overlapping.assignment.assignmentId}/offers`,
    TOKENS.ops,
    {
      key: key(),
      body: {
        expectedRevision: overlapping.assignment.revision,
        resourceId: tech.operatorId,
        technicianSubjectId: tech.subject,
      },
    },
  );
  assert.ok(busy.status >= 400 && busy.status < 500, busy.text);
  assert.ok(
    ['RESOURCE_BUSY', 'TECHNICIAN_BUSY', 'RESOURCE_INELIGIBLE'].includes(reasonOf(busy)),
    busy.text,
  );
});

test('reassignment mid-job: the first task ends REASSIGNED and is fenced; the second technician completes', async () => {
  const job = await bookingWithJob();
  const first = await technician(job, 'first');
  const second = await technician(job, 'second');
  const accepted = await accept(first, await offerTo(job, first));
  assert.equal(accepted.status, 200, accepted.text);
  const a = driver(first, accepted.body.taskId);
  await a.read();
  await a.go('POST', '/depart');
  const staleRevision = a.task.revision;

  const moved = await reassign(job, second);
  assert.equal(moved.status, 200, moved.text);
  const gone = await a.read();
  if (gone.status === 200)
    assert.deepEqual([a.task.stage, a.task.endReason], ['WITHDRAWN', 'REASSIGNED']);
  else assert.equal(gone.status, 404);
  const fenced = await call(
    'dispatch',
    'POST',
    `/tasks/${accepted.body.taskId}/arrive`,
    first.token,
    { key: key(), body: { expectedRevision: staleRevision } },
  );
  assert.ok([404, 409].includes(fenced.status), fenced.text);
  assert.ok(['TASK_CLOSED', 'TASK_NOT_FOUND'].includes(reasonOf(fenced)), fenced.text);
  assert.equal(
    (await call('booking', 'GET', `/bookings/${job.bookingId}/technician-view`, first.token))
      .status,
    404,
    'Booking details close for the replaced technician',
  );
  assert.equal(
    (await call('dispatch', 'GET', `/me/bookings/${job.bookingId}/work`, first.token)).status,
    404,
  );

  const offers = (await call('dispatch', 'GET', '/me/jobs', second.token)).body.offers;
  const offer = offers.find((o) => o.job.bookingId === job.bookingId && o.status === 'OFFERED');
  assert.ok(offer, 'the second technician holds the live offer');
  const taken = await accept(second, offer.offerId);
  assert.equal(taken.status, 200, taken.text);
  const b = driver(second, taken.body.taskId);
  await b.read();
  await b.toFinished();
  await b.go('POST', '/close', {
    collection: { outcome: 'CASH_COLLECTED', amount: await totalOf(job, second) },
  });
  assert.equal(b.task.stage, 'CLOSED');
});

test(
  'evidence access after reassignment: the superseded technician can no longer read the job photos',
  {
    todo: 'OPEN SECURITY FINDING OPS-F01 / CR-P08-C1: Media authorizes a user read by uploader only, so a reassigned technician keeps read access; needs a media.v1 fence (Lane E) before this can pass',
  },
  async (t) => {
    const job = await bookingWithJob();
    const first = await technician(job, 'fence-a');
    const second = await technician(job, 'fence-b');
    const accepted = await accept(first, await offerTo(job, first));
    assert.equal(accepted.status, 200, accepted.text);
    const a = driver(first, accepted.body.taskId);
    await a.read();
    await a.go('POST', '/depart');
    await a.go('POST', '/arrive');
    const photo = await uploadPhoto(first.token);
    await a.go('PUT', '/evidence/BEFORE/0', { mediaObjectId: photo.objectId });
    assert.equal((await reassign(job, second)).status, 200);

    const readBy = (tech) =>
      call('media', 'POST', `/objects/${photo.objectId}/read-url`, tech.token, {
        key: key(),
        body: {},
      });
    // Recorded, not asserted: whether the new holder may read earlier evidence is TI-D08 (owner).
    t.diagnostic(`second technician read-url: ${(await readBy(second)).status}`);
    const stale = await readBy(first);
    assert.equal(stale.status, 404, `superseded technician still reads evidence: ${stale.status}`);
  },
);

test('obstacles and collections: notes, a technician release, cash not collected then an exact late collection', async () => {
  // Release before departure: the job returns to operations, no work or money recorded.
  const released = await bookingWithJob();
  const tech = await technician(released, 'release');
  const acc = await accept(tech, await offerTo(released, tech));
  assert.equal(acc.status, 200, acc.text);
  const r = driver(tech, acc.body.taskId);
  await r.read();
  const help = await call('dispatch', 'POST', `/tasks/${acc.body.taskId}/notes`, tech.token, {
    key: key(),
    body: { kind: 'HELP', text: 'العنوان غير واضح والعميل لا يرد' },
  });
  assert.equal(help.status, 200, help.text);
  await r.read();
  await r.go('POST', '/release', { reason: 'تعذّر الوصول إلى الموقع' });
  assert.equal(r.task.stage, 'RELEASED');
  assert.equal((await assignmentOf(released)).status, 'UNASSIGNED');
  assert.equal((await r.step('POST', '/depart')).status, 409, 'a released task is fenced');

  // Cash not collected, then the exact amount collected later.
  const job = await bookingWithJob();
  const collector = await technician(job, 'collector');
  const taken = await accept(collector, await offerTo(job, collector));
  const c = driver(collector, taken.body.taskId);
  await c.read();
  await c.toFinished();
  const total = await totalOf(job, collector);
  await c.go('POST', '/close', {
    collection: { outcome: 'CASH_NOT_COLLECTED', reason: 'العميل سيحوّل المبلغ لاحقًا' },
  });
  assert.equal(c.task.stage, 'CLOSED');
  const followUp = await call(
    'dispatch',
    'POST',
    `/tasks/${taken.body.taskId}/notes`,
    collector.token,
    { key: key(), body: { kind: 'PAYMENT_FOLLOW_UP', text: 'اتفقنا على الدفع نقدًا غدًا' } },
  );
  assert.equal(followUp.status, 200, followUp.text);
  await c.read();

  // Dispatch records the technician's declared amount; it holds no price, so exactness is the
  // app's (reference) rule and reconciliation is Billing's (sprint 08, finding F-07-01).
  const lateKey = key();
  const collect = (idempotencyKey, expectedRevision) =>
    call('dispatch', 'POST', `/tasks/${taken.body.taskId}/cash-collection`, collector.token, {
      key: idempotencyKey,
      body: { expectedRevision, amount: total },
    });
  const late = await collect(lateKey, c.task.revision);
  assert.equal(late.status, 200, late.text);
  assert.deepEqual(late.body.collection.lateAmount, total, 'exact Booking Money');
  const replay = await collect(lateKey, c.task.revision);
  assert.deepEqual(
    [replay.status, replay.body.revision],
    [200, late.body.revision],
    'same key replays',
  );
  const again = await collect(key(), late.body.revision);
  assert.ok(again.status >= 400 && again.status < 500, `no second collection: ${again.text}`);
  const summary = (await call('dispatch', 'GET', '/me/jobs', collector.token)).body.tasks.find(
    (t) => t.taskId === taken.body.taskId,
  );
  assert.deepEqual(
    summary.collection.lateAmount,
    total,
    'the collections view reads the declaration',
  );
});

test('revoked eligibility end to end: offers and undeparted tasks withdrawn, field work flagged and still completable', async () => {
  const offered = await bookingWithJob();
  const offeredTech = await technician(offered, 'inel-offer');
  await offerTo(offered, offeredTech);

  const undeparted = await bookingWithJob();
  const waitingTech = await technician(undeparted, 'inel-wait');
  const waiting = await accept(waitingTech, await offerTo(undeparted, waitingTech));
  assert.equal(waiting.status, 200, waiting.text);

  const field = await bookingWithJob();
  const fieldTech = await technician(field, 'inel-field');
  const going = await accept(fieldTech, await offerTo(field, fieldTech));
  const f = driver(fieldTech, going.body.taskId);
  await f.read();
  await f.go('POST', '/depart');

  for (const t of [offeredTech, waitingTech, fieldTech]) await suspend(t.operatorId);
  // Pull path: Dispatch's own fresh read refuses a new offer at once.
  const next = await bookingWithJob();
  const refused = await call(
    'dispatch',
    'POST',
    `/assignments/${next.assignment.assignmentId}/offers`,
    TOKENS.ops,
    {
      key: key(),
      body: {
        expectedRevision: next.assignment.revision,
        resourceId: fieldTech.operatorId,
        technicianSubjectId: fieldTech.subject,
      },
    },
  );
  assert.deepEqual([refused.status, reasonOf(refused)], [422, 'RESOURCE_INELIGIBLE']);

  // Push path: the published event, relayed over RabbitMQ, is applied by Dispatch's inbox.
  await relayWorkforceOutbox();
  await until(async () => {
    const res = await call('dispatch', 'GET', '/me/jobs', offeredTech.token);
    return !res.body.offers.some(
      (o) => o.job.bookingId === offered.bookingId && o.status === 'OFFERED',
    );
  });
  const withdrawn = await until(async () => {
    const res = await call(
      'dispatch',
      'GET',
      `/me/tasks/${waiting.body.taskId}`,
      waitingTech.token,
    );
    return res.status === 404 || res.body.stage === 'WITHDRAWN' ? res : null;
  });
  if (withdrawn.status === 200) assert.equal(withdrawn.body.endReason, 'RESOURCE_INELIGIBLE');
  const flagged = await until(async () => {
    const res = await call('dispatch', 'GET', `/me/tasks/${going.body.taskId}`, fieldTech.token);
    return res.body.attentionReason === 'RESOURCE_INELIGIBLE' ? res.body : null;
  });
  assert.equal(flagged.stage, 'EN_ROUTE', 'field work is flagged for operations, not cancelled');
  f.task = flagged;
  await f.go('POST', '/arrive');
  assert.equal(f.task.attentionReason, 'RESOURCE_INELIGIBLE', 'the flag stays visible');
  // The flag may come from Dispatch's own fresh read first; the relayed event lands independently.
  await until(async () => {
    const [observed] = await dispatchPrisma.client.$queryRawUnsafe(
      `SELECT eligibility FROM app.resource_observation WHERE resource_id = $1::uuid`,
      fieldTech.operatorId,
    );
    return observed?.eligibility === 'INELIGIBLE';
  });
});

test("retries and fences: a replayed key applies once; a stale revision and another technician's task or photo are refused", async () => {
  const job = await bookingWithJob();
  const tech = await technician(job);
  const intruder = await technician(await bookingWithJob(), 'intruder');
  const offerId = await offerTo(job, tech);

  // The same accept key twice: one task, the replay returns it.
  const acceptKey = key();
  const accepted = await accept(tech, offerId, acceptKey);
  assert.equal(accepted.status, 200, accepted.text);
  const replayedAccept = await accept(tech, offerId, acceptKey);
  assert.equal(replayedAccept.status, 200, replayedAccept.text);
  assert.equal(replayedAccept.body.taskId, accepted.body.taskId);
  const d = driver(tech, accepted.body.taskId);
  await d.read();
  const start = d.task.revision;

  // The same depart key twice (a retry after a lost response): one transition.
  const departKey = key();
  const depart = () =>
    call('dispatch', 'POST', `/tasks/${accepted.body.taskId}/depart`, tech.token, {
      key: departKey,
      body: { expectedRevision: start },
    });
  const first = await depart();
  assert.equal(first.status, 200, first.text);
  const replay = await depart();
  assert.equal(replay.status, 200, replay.text);
  assert.deepEqual(
    [replay.body.stage, replay.body.revision],
    [first.body.stage, first.body.revision],
  );
  await d.read();
  assert.deepEqual([d.task.stage, d.task.revision], ['EN_ROUTE', start + 1], 'applied once');

  // A fresh key on the stale revision is a conflict, never a second transition.
  const stale = await call('dispatch', 'POST', `/tasks/${d.task.taskId}/arrive`, tech.token, {
    key: key(),
    body: { expectedRevision: start },
  });
  assert.deepEqual([stale.status, stale.body.error.code], [412, 'REVISION_CONFLICT'], stale.text);

  // Another technician can neither read nor move this task, even with its current revision.
  assert.equal(
    (await call('dispatch', 'GET', `/me/tasks/${d.task.taskId}`, intruder.token)).status,
    404,
  );
  const hijack = await call('dispatch', 'POST', `/tasks/${d.task.taskId}/arrive`, intruder.token, {
    key: key(),
    body: { expectedRevision: d.task.revision },
  });
  assert.equal(hijack.status, 404, hijack.text);
  await d.read();
  assert.deepEqual([d.task.stage, d.task.revision], ['EN_ROUTE', start + 1], 'unchanged');

  // ...nor touch this technician's Media reservation or object.
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
  const reserved = await call('media', 'POST', '/uploads', tech.token, {
    key: key(),
    body: {
      purpose: 'WORK_EVIDENCE',
      contentType: 'image/jpeg',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });
  assert.equal(reserved.status, 201, reserved.text);
  const objectId = reserved.body.objectId;
  for (const [method, route] of [
    ['GET', `/objects/${objectId}`],
    ['POST', `/objects/${objectId}/upload-url`],
    ['POST', `/objects/${objectId}/finalize`],
  ]) {
    const res = await call('media', method, route, intruder.token, {
      key: method === 'POST' ? key() : undefined,
      body: method === 'POST' ? {} : undefined,
    });
    assert.equal(res.status, 404, `${method} ${route}: ${res.text}`);
  }
  const claim = await call('media', 'POST', `/objects/${objectId}/claims`, intruder.token, {
    key: key(),
    body: { holder: 'dispatch.task-evidence', claimRef: randomUUID() },
  });
  assert.equal(claim.status, 403, 'claims are a service scope, never a user action');
  const own = await call('media', 'GET', `/objects/${objectId}`, tech.token);
  assert.deepEqual([own.status, own.body.status], [200, 'RESERVED'], 'the reservation is intact');
});

// ------------------------------------------------------------- technician app (browser)

let gateway;
let billingStub;
let browser;
let ui;
let accessCookie;

/** DECLARED stand-in for an absent Billing: every request is 503 DEPENDENCY_UNAVAILABLE. */
async function billingUnavailable() {
  const { createServer } = await import('node:http');
  billingStub = createServer((request, response) => {
    request.resume();
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          reason: null,
          message: 'Billing is not part of this suite.',
          retryable: true,
          retryAfterMs: null,
          issues: [],
        },
      }),
    );
  });
  await new Promise((resolve) => billingStub.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${billingStub.address().port}`;
}

async function appSession(tech, { clock = false } = {}) {
  if (!gateway) {
    const harness = await import('./support/operator-gateway.mjs');
    accessCookie = harness.ACCESS_COOKIE;
    const local = (name) => `http://127.0.0.1:${ports[name]}`;
    gateway = await harness.startOperatorGateway({
      upstreams: {
        identity: doubles.url,
        workforce: local('workforce'),
        dispatch: local('dispatch'),
        booking: local('booking'),
        media: local('media'),
        // Billing is out of this suite's scope (custody and receipts are sprint 08): it answers
        // 503 at once, so the app keeps no custody fact and nothing waits on a dead socket.
        billing: await billingUnavailable(),
      },
      mediaOrigins: [new URL(context.s3.endpoint).origin],
    });
    ui = await import('./support/operator-browser.mjs');
    browser = await ui.launch();
  }
  const ctx = await browser.newContext({
    viewport: { width: 390, height: ui.RENDERING.height },
    locale: ui.RENDERING.locale,
    timezoneId: ui.RENDERING.timezoneId,
    reducedMotion: 'reduce',
  });
  await ctx.addCookies([
    {
      name: accessCookie,
      value: tech.token,
      url: gateway.origin,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await ctx.newPage();
  const problems = ui.watch(page);
  if (clock) await page.clock.install();
  await ui.openApp(page, gateway.origin);
  return { ctx, page, problems };
}

after(async () => {
  await browser?.close();
  await gateway?.close();
  await new Promise((resolve) => (billingStub ? billingStub.close(resolve) : resolve()));
});

const PENDING_LOST = 'لم تعد هذه المهمة مسندة إليك. أُزيلت من قائمتك.';
const PENDING_ATTENTION =
  'تحتاج هذه المهمة مراجعة الإدارة لأن أهليتك للمهام تغيّرت. لم تُلغَ المهمة.';

const heading = (page, text) =>
  page.waitForFunction((t) => document.querySelector('#main h1')?.textContent === t, text, {
    timeout: 20_000,
  });
const atHome = (page) =>
  page.waitForFunction(() => document.documentElement.dataset.view === 'home', null, {
    timeout: 20_000,
  });
const openJob = (page, bookingId) =>
  page.locator(`[data-action="open-job"][data-id="${bookingId}"]`).first().click();
const cleanProblems = (problems) => problems.filter((p) => !/status of 40[49]/.test(p));

test('the technician app completes a real job through the requested gateway routes', async () => {
  const job = await bookingWithJob();
  const tech = await technician(job, 'ui');
  await offerTo(job, tech);
  const { ctx, page, problems } = await appSession(tech);
  try {
    // Readiness is Workforce's availability: switch to ready through the app.
    await page.locator('[data-action="ready"]').click();
    await until(
      async () =>
        (await call('workforce', 'GET', '/me/availability', tech.token)).body.status ===
        'AVAILABLE',
    );
    await openJob(page, job.bookingId);
    const primary = page.locator('[data-action="primary"]');
    await primary.click();
    await heading(page, 'جاهز للانطلاق؟');
    await page.waitForTimeout(460);
    await primary.click();
    await heading(page, 'في الطريق إلى اللمعة.');
    await page.waitForTimeout(460);
    await primary.click();
    await page.locator('#sheet[open] [data-action="arrived-confirm"]').click();
    await heading(page, 'قبل اللمعة.');
    await page.setInputFiles('#main input[data-upload="before"]', {
      name: 'before.jpg',
      mimeType: 'image/jpeg',
      buffer: await ui.generateJpeg(browser, { width: 1200, height: 900, hue: 40 }),
    });
    await page.waitForFunction(() => document.querySelector('.photo-grid img')?.complete, null, {
      timeout: 30_000,
    });
    await page.waitForTimeout(460);
    await primary.click();
    await heading(page, 'كل تفصيلة، بعناية.');
    for (let index = 0; index < 4; index += 1) {
      await page.locator(`[data-action="check"][data-index="${index}"]`).click();
      await page.waitForFunction(
        (i) =>
          document
            .querySelector(`[data-action="check"][data-index="${i}"]`)
            ?.getAttribute('aria-checked') === 'true',
        index,
      );
    }
    await page.waitForTimeout(460);
    await primary.click();
    await heading(page, 'دع النتيجة تتحدث.');
    await page.setInputFiles('#main input[data-upload="after"]', {
      name: 'after.jpg',
      mimeType: 'image/jpeg',
      buffer: await ui.generateJpeg(browser, { hue: 160 }),
    });
    await page.waitForFunction(() => document.querySelector('.photo-grid img')?.complete, null, {
      timeout: 30_000,
    });
    await page.waitForTimeout(460);
    await primary.click();
    await page.locator('#sheet[open] [data-action="finish-wash-confirm"]').click();
    await heading(page, 'اللمعة اكتملت. وقت التسليم.');

    const total = await totalOf(job, tech);
    assert.equal(BigInt(total.amountMinor) % 10n ** BigInt(total.scale), 0n, 'whole total');
    const major = (BigInt(total.amountMinor) / 10n ** BigInt(total.scale)).toString();
    await page.locator('[data-action="cash-dialog"]').first().click();
    await page.fill('#cash-amount', major);
    await page.check('#cash-check');
    await page.locator('#cash-confirm').click();
    await heading(page, 'لمعة تستحق المشاهدة.');

    const jobs = await call('dispatch', 'GET', '/me/jobs', tech.token);
    const taskId = jobs.body.tasks.find((t) => t.bookingId === job.bookingId).taskId;
    const task = (await call('dispatch', 'GET', `/me/tasks/${taskId}`, tech.token)).body;
    assert.equal(task.stage, 'CLOSED');
    assert.deepEqual(task.collection.amount, total, 'exact amount, from the real Booking total');
    assert.ok(task.evidence.BEFORE[0] && task.evidence.AFTER.some(Boolean), 'real Media linked');
    const evidence = await call(
      'media',
      'GET',
      `/objects/${task.evidence.BEFORE[0].mediaObjectId}`,
      tech.token,
    );
    assert.deepEqual([evidence.body.status, evidence.body.claimed], ['AVAILABLE', true]);

    // The collections view renders from the same server declaration (the reference shows the
    // bottom navigation outside the task view only).
    await page.locator('header [data-action="home"]').click();
    await atHome(page);
    await page.locator('nav [data-action="collections"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'collections');
    // A declaration is recorded cash, never a receipt: Billing (absent here) issues receipts.
    const shown = await page.locator('#main').textContent();
    assert.ok(shown.includes('الكاش المسجّل'), 'the reference label of the declaration');
    assert.ok(!shown.includes('إيصال'), 'no receipt is claimed from a Dispatch declaration');
    assert.deepEqual(cleanProblems(problems), [], 'no page errors or CSP violations');
  } finally {
    await ctx.close();
  }
});

test('the technician app: a real assignment race leaves the offer as a lost job', async () => {
  const job = await bookingWithJob();
  const tech = await technician(job, 'ui-race');
  const rival = await technician(job, 'ui-rival');
  await offerTo(job, tech);
  const { ctx, page, problems } = await appSession(tech);
  try {
    // The reference enables «استلام المهمة» only for a ready technician.
    await page.locator('[data-action="ready"]').click();
    await until(
      async () =>
        (await call('workforce', 'GET', '/me/availability', tech.token)).body.status ===
        'AVAILABLE',
    );
    await openJob(page, job.bookingId);
    const moved = await reassign(job, rival);
    assert.equal(moved.status, 200, moved.text);
    await page.locator('[data-action="primary"]').click();
    await atHome(page);
    assert.equal(await page.locator('#toast').textContent(), PENDING_LOST);
    assert.equal(
      await page.locator(`[data-action="open-job"][data-id="${job.bookingId}"]`).count(),
      0,
    );
    const mine = (await call('dispatch', 'GET', '/me/jobs', tech.token)).body;
    assert.ok(!mine.tasks.some((t) => t.bookingId === job.bookingId), 'no task was created');
    assert.deepEqual(cleanProblems(problems), []);
  } finally {
    await ctx.close();
  }
});

test('the technician app: revoked eligibility flags the open field task; an unassignment reaches it by the background re-read', async () => {
  const job = await bookingWithJob();
  const tech = await technician(job, 'ui-inel');
  const accepted = await accept(tech, await offerTo(job, tech));
  assert.equal(accepted.status, 200, accepted.text);
  const d = driver(tech, accepted.body.taskId);
  await d.read();
  await d.go('POST', '/depart');

  const { ctx, page, problems } = await appSession(tech, { clock: true });
  try {
    await openJob(page, job.bookingId);
    await heading(page, 'في الطريق إلى اللمعة.');
    await suspend(tech.operatorId);
    await relayWorkforceOutbox();
    await until(async () => {
      await d.read();
      return d.task?.attentionReason === 'RESOURCE_INELIGIBLE';
    });
    await page.clock.fastForward(31_000);
    await page.waitForFunction(
      (text) => {
        const el = document.querySelector('#storage-warning');
        return el && !el.hidden && el.textContent === text;
      },
      PENDING_ATTENTION,
      { timeout: 20_000 },
    );
    assert.equal(await page.locator('#main h1').textContent(), 'في الطريق إلى اللمعة.');

    // Operations then takes the job back: the open app learns it without any action.
    const current = await assignmentOf(job);
    const unassigned = await call(
      'dispatch',
      'POST',
      `/assignments/${current.assignmentId}/unassign`,
      TOKENS.ops,
      { key: key(), body: { expectedRevision: current.revision } },
    );
    assert.equal(unassigned.status, 200, unassigned.text);
    await page.clock.fastForward(31_000);
    await atHome(page);
    assert.equal(await page.locator('#toast').textContent(), PENDING_LOST);
    assert.deepEqual(cleanProblems(problems), []);
  } finally {
    await ctx.close();
  }
});

const PENDING_UNKNOWN = 'لم يتأكد حفظ آخر إجراء بعد. ستُعاد المحاولة بالطلب نفسه عند عودة الاتصال.';

/** An accepted real task, driven through the API to `stage`. */
async function acceptedTask(label, stage) {
  const job = await bookingWithJob();
  const tech = await technician(job, label);
  const accepted = await accept(tech, await offerTo(job, tech));
  assert.equal(accepted.status, 200, accepted.text);
  const d = driver(tech, accepted.body.taskId);
  await d.read();
  if (stage !== 'ACCEPTED') await d.go('POST', '/depart');
  if (stage === 'ARRIVED') await d.go('POST', '/arrive');
  return { job, tech, d };
}

test('the technician app: a lost response after real Dispatch applied a step is retried with the same key, one transition', async () => {
  const { job, tech, d } = await acceptedTask('ui-lost', 'ACCEPTED');
  const { ctx, page, problems } = await appSession(tech);
  try {
    await openJob(page, job.bookingId);
    await heading(page, 'جاهز للانطلاق؟');
    const seen = gateway.log.length;
    // The window also swallows Chromium's own transparent resend on a reused socket.
    gateway.injectFault({
      method: 'POST',
      path: /\/tasks\/[^/]+\/depart$/,
      mode: 'drop-after-upstream',
      windowMs: 1000,
    });
    // Real services answer fast: record every warning text instead of polling for a moment.
    await page.evaluate(() => {
      const el = document.querySelector('#storage-warning');
      globalThis.__warnings = [];
      new MutationObserver(() => {
        if (!el.hidden) globalThis.__warnings.push(el.textContent);
      }).observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    await page.locator('[data-action="primary"]').click();
    await heading(page, 'في الطريق إلى اللمعة.');
    await page.waitForFunction(
      () => document.querySelector('#storage-warning')?.hidden === true,
      null,
      {
        timeout: 20_000,
      },
    );
    const departs = gateway.log
      .slice(seen)
      .filter((e) => e.method === 'POST' && /\/depart$/.test(e.path));
    assert.ok(departs.length >= 2, 'dropped attempt(s) + the application retry');
    assert.equal(new Set(departs.map((e) => e.idempotencyKey)).size, 1, 'one key on every attempt');
    assert.ok(departs[0].fault, 'the first response was lost after the upstream answered');
    assert.ok(
      (await page.evaluate(() => globalThis.__warnings)).includes(PENDING_UNKNOWN),
      'UNKNOWN was shown, never success, until the replay confirmed it',
    );
    assert.deepEqual([departs.at(-1).fault, departs.at(-1).status], [null, 200]);
    const before = d.task.revision;
    await d.read();
    assert.deepEqual([d.task.stage, d.task.revision], ['EN_ROUTE', before + 1], 'applied once');
    assert.deepEqual(cleanProblems(problems), []);
  } finally {
    await ctx.close();
  }
});

test('the technician app: an interrupted photo upload resumes on the same reservation; read URLs are renewed before expiry', async () => {
  const { job, tech, d } = await acceptedTask('ui-media', 'ARRIVED');
  const { ctx, page, problems } = await appSession(tech, { clock: true });
  const s3Origin = new URL(context.s3.endpoint).origin;
  let aborted = 0;
  await page.route(
    (url) => url.origin === s3Origin,
    (route) => {
      if (route.request().method() === 'PUT' && aborted === 0) {
        aborted += 1;
        return route.abort('connectionreset');
      }
      return route.continue();
    },
  );
  try {
    await openJob(page, job.bookingId);
    await heading(page, 'قبل اللمعة.');
    const seen = gateway.log.length;
    await page.setInputFiles('#main input[data-upload="before"]', {
      name: 'before.jpg',
      mimeType: 'image/jpeg',
      buffer: await ui.generateJpeg(browser, { width: 1200, height: 900, hue: 210 }),
    });
    await page.waitForFunction(() => document.querySelector('.photo-grid img')?.complete, null, {
      timeout: 30_000,
    });
    assert.equal(aborted, 1, 'the first PUT to the object store was cut');
    const media = gateway.log.slice(seen).filter((e) => /\/media\//.test(e.path));
    assert.equal(media.filter((e) => /\/uploads$/.test(e.path)).length, 1, 'one reservation');
    assert.ok(
      media.some((e) => /\/upload-url$/.test(e.path) && e.status === 200),
      'fresh PUT URL',
    );
    assert.equal(media.filter((e) => /\/finalize$/.test(e.path) && e.status === 200).length, 1);

    await d.read();
    const objectId = d.task.evidence.BEFORE[0]?.mediaObjectId;
    assert.ok(objectId, 'the real task links the finalized object');
    const object = await call('media', 'GET', `/objects/${objectId}`, tech.token);
    assert.deepEqual([object.body.status, object.body.claimed], ['AVAILABLE', true]);

    // Read URLs live 60 s here; the background re-read renews one before it lapses.
    const first = await page.locator('.photo-grid img').first().getAttribute('src');
    const reads = () =>
      gateway.log.filter(
        (e) => e.path.endsWith(`/objects/${objectId}/read-url`) && e.status === 200,
      ).length;
    const issued = reads();
    // Background reads run every 30 s; a URL is renewed once less than 15 s of it is left.
    const renewedSrc = (src) => {
      const img = document.querySelector('.photo-grid img');
      return img && img.getAttribute('src') !== src && img.complete;
    };
    let renewedInTime = false;
    for (let step = 0; step < 4 && !renewedInTime; step += 1) {
      await page.clock.fastForward(30_000);
      renewedInTime = await page.waitForFunction(renewedSrc, first, { timeout: 5_000 }).then(
        () => true,
        () => false,
      );
    }
    assert.ok(renewedInTime, 'the background re-read renewed the read URL');
    assert.ok(reads() > issued, 'a new read URL was issued');
    const renewed = await page.locator('.photo-grid img').first().getAttribute('src');
    assert.equal((await fetch(renewed)).status, 200, 'the renewed URL reads the real object');
    assert.equal(await page.locator('#main h1').textContent(), 'قبل اللمعة.', 'screen kept');
    assert.deepEqual(cleanProblems(problems), []);
  } finally {
    await ctx.close();
  }
});

test('the technician app: a lost reservation response is resumed on its own with the same key; one object is attached', async () => {
  const { job, tech, d } = await acceptedTask('ui-resume', 'ARRIVED');
  const { ctx, page, problems } = await appSession(tech);
  try {
    await openJob(page, job.bookingId);
    await heading(page, 'قبل اللمعة.');
    const seen = gateway.log.length;
    gateway.injectFault({
      method: 'POST',
      path: /\/media\/uploads$/,
      mode: 'drop-after-upstream',
      windowMs: 1000,
    });
    await page.setInputFiles('#main input[data-upload="before"]', {
      name: 'before.jpg',
      mimeType: 'image/jpeg',
      buffer: await ui.generateJpeg(browser, { hue: 300 }),
    });
    // No user action: the UNKNOWN upload is resumed by the app's own backoff.
    await page.waitForFunction(() => document.querySelector('.photo-grid img')?.complete, null, {
      timeout: 30_000,
    });
    const reserves = gateway.log
      .slice(seen)
      .filter((e) => e.method === 'POST' && /\/media\/uploads$/.test(e.path));
    assert.ok(reserves.length >= 2 && reserves[0].fault, 'a lost reservation, then the resume');
    assert.equal(new Set(reserves.map((e) => e.idempotencyKey)).size, 1, 'one key');
    await d.read();
    const attached = d.task.evidence.BEFORE.filter(Boolean);
    assert.equal(attached.length, 1, 'one object attached');
    const object = await call('media', 'GET', `/objects/${attached[0].mediaObjectId}`, tech.token);
    assert.deepEqual([object.body.status, object.body.claimed], ['AVAILABLE', true]);
    assert.deepEqual(cleanProblems(problems), []);
  } finally {
    await ctx.close();
  }
});
