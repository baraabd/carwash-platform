/**
 * P05-D5 configuration.v1 on real infrastructure.
 *
 * Real: the compiled configuration HTTP application (dist/), PostgreSQL 16
 * with the service's RUNTIME role, the REAL Identity service (Argon2, RS256,
 * Redis rate budget) for every deny path, RabbitMQ 4 with the SHARED
 * @carwash/platform-messaging OutboxRelay/ConfirmingPublisher, and the
 * PUBLISHED contract packages (packages/contracts dist, event-contracts dist)
 * used as the oracle for every response and event.
 *
 * Stubbed, and declared as such:
 *  - positive staff paths use a loopback Identity STUB serving the published
 *    session shape, because the real Identity grants none of
 *    configuration.read/write/approve/publish to any role (CR-D-P01-01,
 *    refreshed as CR-D-P05-D5-04). Same precedent as
 *    configuration-revisions.test.mjs. Every stubbed request is labelled
 *    `stub:` in the test names below.
 *  - the producer broker identity `cw_configuration_app` and the
 *    `configuration.events` exchange are NOT in the accepted bootstrap
 *    (CR-D-P05-D5-05). The suite creates exactly the requested identity and
 *    ACL as the infrastructure administrator, uses it, and deletes it.
 *  - no relay PROCESS exists for configuration (the platform-messaging
 *    dependency is a Lane E lockfile change, CR-D-P05-D5-01): the suite drives
 *    the service's own outbox store with the shared relay, in-process.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ROOT,
  amqp,
  appDsn,
  brokerUrlAs,
  context,
  eventually,
  infraBrokerUrl,
  messaging,
  serviceClient,
  sql,
} from '../../integration/_support.mjs';
import { composeExec } from '../../../scripts/acceptance/lib/infra.mjs';
import { account, bearer, staff, startIdentity } from './_identity.mjs';

const svcRequire = createRequire(path.join(ROOT, 'services', 'configuration', 'package.json'));
svcRequire('reflect-metadata');
const dist = (file) => svcRequire(path.join(ROOT, 'services', 'configuration', 'dist', file));
const { createHttpApplication } = dist('transport/http/create-app.js');
const { PrismaOutboxStore } = dist('infrastructure/messaging/prisma-outbox.store.js');
const ownerDomain = dist('domain/configuration-v1.js');
const rootRequire = createRequire(path.join(ROOT, 'package.json'));
const published = rootRequire(
  path.join(ROOT, 'packages', 'contracts', 'dist', 'configuration', 'v1.js'),
);
const wire = rootRequire(path.join(ROOT, 'packages', 'contracts', 'dist', 'common', 'wire.js'));
const { CONFIGURATION_PUBLISHED_V1 } = rootRequire(
  path.join(ROOT, 'packages', 'event-contracts', 'dist', 'business-v1.js'),
);
const { BrokerConnection, ConfirmingPublisher, OutboxRelay } = messaging();

/* ------------------------------- principals ------------------------------- */

const STUB = {
  author: { subject: randomUUID(), permissions: ['configuration.read', 'configuration.write'] },
  author2: { subject: randomUUID(), permissions: ['configuration.read', 'configuration.write'] },
  approver: { subject: randomUUID(), permissions: ['configuration.read', 'configuration.approve'] },
  publisher: {
    subject: randomUUID(),
    permissions: ['configuration.read', 'configuration.publish'],
  },
  // The requested super-admin mapping: every configuration permission.
  admin: {
    subject: randomUUID(),
    permissions: [
      'configuration.read',
      'configuration.write',
      'configuration.approve',
      'configuration.publish',
    ],
  },
  reader: { subject: randomUUID(), permissions: ['configuration.read'] },
};
const tokenOf = (name) => `stub-${name}-${'0'.repeat(24)}`;
const SESSIONS = Object.fromEntries(Object.entries(STUB).map(([k, v]) => [tokenOf(k), v]));

const stubIdentity = createServer((req, res) => {
  if (req.url !== '/internal/v1/identity/session') return void res.writeHead(404).end();
  const session = SESSIONS[(req.headers.authorization ?? '').replace(/^Bearer /, '')];
  if (!session)
    return void res
      .writeHead(401, { 'content-type': 'application/json' })
      .end('{"error":{"code":"AUTH_REQUIRED"}}');
  res
    .writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ ...session, sessionId: randomUUID(), authVersion: 1, roles: [] }));
});

const SERVICE_TOKEN = randomBytes(24).toString('hex');
const SERVICE_CLIENTS = JSON.stringify([
  {
    id: 'scheduling',
    tokenSha256: createHash('sha256').update(SERVICE_TOKEN).digest('hex'),
    scopes: ['configuration.read'],
  },
]);
const service = { 'x-service-client': 'scheduling', 'x-service-token': SERVICE_TOKEN };

const db = serviceClient('configuration');
const runtimeUrl = appDsn(context, 'configuration');
let identity;
let realApp;
let realBase;
let stubApp;
let stubBase;

/* --------------------------------- broker --------------------------------- */

const PRODUCER = 'cw_configuration_app';
const PRODUCER_PASSWORD = randomBytes(18).toString('hex');
const EXCHANGE = 'configuration.events';
let producer;
let consumerConnection;
const received = [];

async function rabbitctl(args) {
  const result = await composeExec(context, 'rabbitmq', ['rabbitmqctl', ...args]);
  return result;
}

before(async () => {
  identity = await startIdentity();
  await new Promise((resolve) => stubIdentity.listen(0, '127.0.0.1', resolve));
  process.env.DATABASE_URL = runtimeUrl;
  process.env.CONFIGURATION_SERVICE_CLIENTS = SERVICE_CLIENTS;
  // The suite is a burst far above a person's pace; the budget itself is
  // covered by the service's own spec.
  process.env.CONFIGURATION_RATE_COMMANDS_PER_MINUTE = '100000';
  process.env.CONFIGURATION_RATE_READS_PER_MINUTE = '100000';
  process.env.IDENTITY_ORIGIN = identity.base;
  realApp = await createHttpApplication();
  await realApp.listen(0, '127.0.0.1');
  realBase = `${await realApp.getUrl()}/internal/v1/configuration`;
  process.env.IDENTITY_ORIGIN = `http://127.0.0.1:${stubIdentity.address().port}`;
  stubApp = await createHttpApplication();
  await stubApp.listen(0, '127.0.0.1');
  stubBase = `${await stubApp.getUrl()}/internal/v1/configuration`;

  // Requested producer identity (CR-D-P05-D5-05): own exchange only, no read.
  await rabbitctl(['delete_user', PRODUCER]);
  for (const args of [
    ['add_user', PRODUCER, PRODUCER_PASSWORD],
    ['set_user_tags', PRODUCER],
    [
      'set_permissions',
      '-p',
      context.vhost,
      PRODUCER,
      '^configuration\\.events$',
      '^configuration\\.events$',
      '^$',
    ],
  ]) {
    const result = await rabbitctl(args);
    assert.equal(result.code, 0, `rabbitmqctl ${args[0]}: ${result.stderr}`);
  }
  // The infrastructure identity declares the exchange and a subscriber queue,
  // exactly as the bootstrap would (Lane E owns that step).
  const { connect } = amqp();
  consumerConnection = await connect(infraBrokerUrl(context));
  consumerConnection.on('error', () => {});
  const channel = await consumerConnection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  const { queue } = await channel.assertQueue('', { exclusive: true });
  await channel.bindQueue(queue, EXCHANGE, 'configuration.#');
  await channel.consume(queue, (message) => {
    received.push({
      body: JSON.parse(message.content.toString('utf8')),
      properties: message.properties,
      routingKey: message.fields.routingKey,
    });
    channel.ack(message);
  });
  producer = await BrokerConnection.open({
    url: brokerUrlAs(context, PRODUCER, PRODUCER_PASSWORD),
    connectionName: 'p05d5-configuration-relay',
  });
});

after(async () => {
  await producer?.close().catch(() => {});
  await consumerConnection?.close().catch(() => {});
  await rabbitctl(['delete_user', PRODUCER]);
  await realApp?.close();
  await stubApp?.close();
  await identity?.app.close();
  stubIdentity.closeAllConnections();
  stubIdentity.close();
  await db.$disconnect();
});

/* --------------------------------- helpers -------------------------------- */

async function http(base, method, route, { auth, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(auth ? { authorization: auth } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    replayed: response.headers.get('idempotency-replayed'),
  };
}

const as = (name) => `Bearer ${tokenOf(name)}`;
const key = () => `p05d5-${randomUUID()}`;
const market = () => `sy-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const POLICY = Object.freeze({
  holdTtlSeconds: 600,
  quoteTtlSeconds: 900,
  minLeadMinutes: 30,
  horizonDays: 14,
  slotStepMinutes: 30,
  cancellationCutoffMinutes: 120,
});
const BOOKING = 'booking.policy.v1';
const PRESENTATION = 'market.presentation.v1';
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function stub(method, route, who, options = {}) {
  return http(stubBase, method, route, { auth: as(who), ...options });
}

function createDraft(m, ns, content, expectedVersion, who = 'author', idem = key()) {
  return stub('POST', `/scopes/${m}/${ns}/drafts`, who, {
    body: { expectedVersion, content },
    headers: { 'idempotency-key': idem },
  });
}

function transition(action, draftId, expectedRevision, who, idem = key()) {
  return stub('POST', `/drafts/${draftId}/${action}`, who, {
    body: { expectedRevision },
    headers: { 'idempotency-key': idem },
  });
}

/** create -> approve (other person) -> publish; returns the publish response. */
async function release(m, ns, content, expectedVersion) {
  const draft = await createDraft(m, ns, content, expectedVersion);
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const approved = await transition('approve', draft.body.draftId, 1, 'approver');
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const done = await transition('publish', draft.body.draftId, 2, 'publisher');
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body;
}

function relay({ workerId = `relay-${randomUUID().slice(0, 8)}`, leaseMs, onLeased } = {}) {
  return new OutboxRelay({
    workerId,
    store: new PrismaOutboxStore(db),
    publisher: new ConfirmingPublisher(producer.channel),
    batchSize: 200,
    ...(leaseMs ? { leaseMs } : {}),
    ...(onLeased ? { onLeased } : {}),
  });
}

async function drain(r) {
  for (let i = 0; i < 50; i += 1) if ((await r.runOnce()).leased === 0) return;
  throw new Error('relay did not drain');
}

const forScope = (scopeId) => (m) => m.body.aggregate?.id === scopeId;

async function scopeId(m, ns) {
  const row = await db.configScope.findUnique({
    where: { marketId_namespace: { marketId: m, namespace: ns } },
  });
  return row.id;
}

/* ------------------------- C: contract conformance ------------------------ */

test('V1-C1 contract: owner parsers accept/reject exactly like the PUBLISHED configuration.v1 parsers', () => {
  const contents = [
    [BOOKING, POLICY],
    [BOOKING, { ...POLICY, slotStepMinutes: 45 }],
    [BOOKING, { ...POLICY, slotStepMinutes: 15 }],
    [BOOKING, { ...POLICY, holdTtlSeconds: 59 }],
    [BOOKING, { ...POLICY, holdTtlSeconds: 3600 }],
    [BOOKING, { ...POLICY, holdTtlSeconds: 3601 }],
    [BOOKING, { ...POLICY, horizonDays: 0 }],
    [BOOKING, { ...POLICY, quoteTtlSeconds: 86_401 }],
    [BOOKING, { ...POLICY, minLeadMinutes: 1.5 }],
    [BOOKING, { ...POLICY, maxLatenessMinutes: 20 }],
    [BOOKING, { ...POLICY, cancellationCutoffMinutes: '120' }],
    [BOOKING, (({ horizonDays: _omit, ...rest }) => rest)(POLICY)],
    [BOOKING, null],
    [BOOKING, []],
    [PRESENTATION, { currency: 'SYP', defaultLocale: 'ar', timezone: 'Asia/Damascus' }],
    [PRESENTATION, { currency: 'USD', defaultLocale: 'en', timezone: 'Asia/Damascus' }],
    [PRESENTATION, { currency: 'EUR', defaultLocale: 'ar', timezone: 'Asia/Damascus' }],
    [PRESENTATION, { currency: 'SYP', defaultLocale: 'fr', timezone: 'Asia/Damascus' }],
    [PRESENTATION, { currency: 'SYP', defaultLocale: 'ar', timezone: 'Europe/Berlin' }],
    ['booking.policy.v2', POLICY],
    [42, POLICY],
  ];
  const bodies = [];
  for (const [ns, content] of contents) {
    for (const expectedVersion of [null, 1, 0, -1, 2_147_483_647, 2_147_483_648, '1']) {
      bodies.push([ns, { expectedVersion, content }]);
    }
  }
  bodies.push(
    [BOOKING, { content: POLICY }],
    [BOOKING, { expectedVersion: null, content: POLICY, x: 1 }],
  );
  bodies.push([BOOKING, 'text'], [BOOKING, null]);
  const outcome = (fn) => {
    try {
      return { ok: fn() };
    } catch (error) {
      return { code: error.code, path: error.path };
    }
  };
  let accepted = 0;
  for (const [ns, body] of bodies) {
    const theirs = outcome(() => published.parseCreateDraftRequestV1(ns, body));
    const ours = outcome(() => ownerDomain.parseCreateDraftRequestV1(ns, body));
    assert.deepEqual(ours, theirs, `drift for ${JSON.stringify([ns, body])}`);
    if (theirs.ok) accepted += 1;
  }
  assert.ok(accepted >= 8 && accepted < bodies.length, `matrix covers both sides (${accepted})`);
  for (const value of ['sy', 'sy-damas', 'SY', 's', 'sy-', 'sy-damascus1', 'sy_x', 3, null]) {
    assert.deepEqual(
      outcome(() => ownerDomain.parseMarketId(value, 'p')),
      outcome(() => published.parseMarketId(value, 'p')),
      `marketId ${value}`,
    );
  }
  for (const value of [
    { expectedRevision: 1 },
    { expectedRevision: 0 },
    {},
    { expectedRevision: 1, x: 1 },
  ]) {
    assert.deepEqual(
      outcome(() => ownerDomain.parseDraftTransitionRequestV1(value)),
      outcome(() => published.parseDraftTransitionRequestV1(value)),
    );
  }
  const sample = { b: [1, 'é'], a: { d: null, c: true } };
  assert.equal(ownerDomain.canonicalJson(sample), wire.canonicalJson(sample));
});

/* ------------------------- A: authorization (REAL) ------------------------ */

test('V1-A1 real Identity: every real role, super-admin included, is denied the configuration routes', async () => {
  const m = market();
  const draftId = randomUUID();
  const routes = [
    ['GET', `/scopes/${m}/${BOOKING}`],
    ['GET', `/scopes/${m}/${BOOKING}/versions`],
    ['GET', `/scopes/${m}/${BOOKING}/history`],
    ['GET', `/scopes/${m}/${BOOKING}/diff?from=1&to=2`],
    ['GET', `/drafts/${draftId}`],
    ['POST', `/scopes/${m}/${BOOKING}/drafts`, { expectedVersion: null, content: POLICY }],
    ['POST', `/drafts/${draftId}/approve`, { expectedRevision: 1 }],
    ['POST', `/drafts/${draftId}/publish`, { expectedRevision: 2 }],
    ['POST', `/drafts/${draftId}/withdraw`, { expectedRevision: 1 }],
  ];
  for (const [method, route, body] of routes) {
    const anonymous = await http(realBase, method, route, { body });
    assert.equal(anonymous.status, 401, `${method} ${route} without a session`);
  }
  const principals = [await account(identity)];
  // Identity allows 30 OTP challenges per IP per 15 minutes across the whole gate run.
  for (const roles of [['operations'], ['finance'], ['super-admin']]) {
    principals.push(await staff(identity, roles));
  }
  for (const principal of principals) {
    assert.equal(
      (principal.session.permissions ?? []).some((p) => p.startsWith('configuration.')),
      false,
      'real Identity grants no configuration permission (CR-D-P01-01 open)',
    );
    for (const [method, route, body] of routes) {
      const denied = await http(realBase, method, route, {
        auth: bearer(principal),
        body,
        headers: { 'idempotency-key': key() },
      });
      assert.equal(denied.status, 403, `${principal.session.roles} ${method} ${route}`);
      assert.equal(denied.body.error.code, 'AUTH_FORBIDDEN');
    }
  }
  const [someone] = principals;
  const mismatch = await http(realBase, 'GET', `/scopes/${m}/${BOOKING}`, {
    auth: bearer(someone),
    headers: { 'x-auth-subject': randomUUID() },
  });
  assert.equal(mismatch.status, 401, 'a forwarded subject that disagrees with Identity is refused');
  const staffOnServiceRoute = await http(realBase, 'GET', `/scopes/${m}/${BOOKING}/current`, {
    auth: bearer(principals.at(-1)),
  });
  assert.equal(
    staffOnServiceRoute.status,
    401,
    'a real super-admin session is not a service credential',
  );
  // Nothing was written by any denied command.
  assert.equal(await db.configScope.count({ where: { marketId: m } }), 0);
});

test('V1-A2 service scope: getCurrent needs a configured workload credential; POLICY_UNAVAILABLE before the first publish', async () => {
  const m = market();
  const route = `/scopes/${m}/${BOOKING}/current`;
  const cases = [
    [{}, 401],
    [{ 'x-service-client': 'scheduling' }, 401],
    [{ 'x-service-client': 'scheduling', 'x-service-token': 'x'.repeat(48) }, 401],
    [{ 'x-service-client': 'pricing', 'x-service-token': SERVICE_TOKEN }, 401],
    [{ 'x-service-client': 'scheduling', 'x-service-token': SERVICE_TOKEN.slice(0, 31) }, 401],
  ];
  for (const [headers, status] of cases) {
    const result = await http(realBase, 'GET', route, { headers });
    assert.equal(result.status, status, JSON.stringify(Object.keys(headers)));
    assert.equal(result.body.error.code, 'AUTH_REQUIRED');
  }
  const unavailable = await http(realBase, 'GET', route, { headers: service });
  assert.equal(unavailable.status, 404);
  assert.equal(unavailable.body.error.code, 'POLICY_UNAVAILABLE', 'no invented default');
  // An open, even approved, draft is not a policy.
  const draft = await createDraft(m, BOOKING, POLICY, null);
  await transition('approve', draft.body.draftId, 1, 'approver');
  assert.equal((await http(realBase, 'GET', route, { headers: service })).status, 404);
  await transition('publish', draft.body.draftId, 2, 'publisher');
  const current = await http(realBase, 'GET', route, { headers: service });
  assert.equal(current.status, 200);
  const parsed = published.parsePublishedConfigurationV1(current.body);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.content, POLICY);
  const malformed = await http(realBase, 'GET', `/scopes/${m}/booking.policy.v9/current`, {
    headers: service,
  });
  assert.equal(malformed.status, 422);
});

/* ----------------------------- L: lifecycle (stub) ------------------------ */

test('V1-L1 stub: draft -> four-eyes approve -> publish, idempotent replay, history and diff', async () => {
  const m = market();
  const idem = key();
  const created = await createDraft(m, BOOKING, POLICY, null, 'author', idem);
  assert.equal(created.status, 201);
  assert.equal(created.replayed, 'false');
  const draft = created.body;
  assert.deepEqual(Object.keys(draft).sort(), [
    'approvedAt',
    'approvedBy',
    'authorSubject',
    'baseVersion',
    'content',
    'contentHash',
    'createdAt',
    'draftId',
    'marketId',
    'namespace',
    'publishedAt',
    'publishedBy',
    'publishedVersion',
    'revision',
    'status',
    'withdrawnAt',
    'withdrawnBy',
  ]);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.revision, 1);
  assert.equal(draft.authorSubject, STUB.author.subject);
  assert.equal(draft.contentHash, sha(wire.canonicalJson(POLICY)), 'sha256 of canonical content');

  const replay = await createDraft(m, BOOKING, POLICY, null, 'author', idem);
  assert.deepEqual([replay.status, replay.replayed], [201, 'true']);
  assert.deepEqual(replay.body, draft, 'the original stored outcome');
  const conflict = await createDraft(
    m,
    BOOKING,
    { ...POLICY, horizonDays: 7 },
    null,
    'author',
    idem,
  );
  assert.deepEqual([conflict.status, conflict.body.error.code], [409, 'IDEMPOTENCY_CONFLICT']);
  const otherActorSameKey = await createDraft(m, BOOKING, POLICY, null, 'author2', idem);
  assert.equal(otherActorSameKey.status, 409, 'keys are per actor: this is a new command');
  assert.equal(otherActorSameKey.body.error.code, 'DRAFT_ALREADY_OPEN');

  const noKey = await stub('POST', `/scopes/${m}/${BOOKING}/drafts`, 'author', {
    body: { expectedVersion: null, content: POLICY },
  });
  assert.deepEqual([noKey.status, noKey.body.error.code], [400, 'IDEMPOTENCY_KEY_REQUIRED']);
  const invalid = await createDraft(m, BOOKING, { ...POLICY, maxLatenessMinutes: 20 }, null);
  assert.deepEqual([invalid.status, invalid.body.error.code], [422, 'VALIDATION_FAILED']);
  assert.match(invalid.body.error.message, /UNEXPECTED_FIELD at \$\.content\.maxLatenessMinutes/);

  const early = await transition('publish', draft.draftId, 1, 'publisher');
  assert.deepEqual([early.status, early.body.error.code], [409, 'DRAFT_NOT_APPROVED']);
  const self = await transition('approve', draft.draftId, 1, 'admin');
  assert.equal(self.status, 200, 'admin is a different person from the author');
  // A fresh scope to show the author cannot approve their own draft, even with every permission.
  const m2 = market();
  const own = await createDraft(m2, BOOKING, POLICY, null, 'admin');
  const selfApproval = await transition('approve', own.body.draftId, 1, 'admin');
  assert.deepEqual(
    [selfApproval.status, selfApproval.body.error.code],
    [422, 'SELF_APPROVAL_FORBIDDEN'],
  );
  const stale = await transition('publish', draft.draftId, 1, 'publisher');
  assert.deepEqual([stale.status, stale.body.error.code], [412, 'REVISION_CONFLICT']);
  const wrongPermission = await transition('publish', draft.draftId, 2, 'approver');
  assert.equal(wrongPermission.status, 403, 'approve does not imply publish');

  const publishKey = key();
  const done = await transition('publish', draft.draftId, 2, 'publisher', publishKey);
  assert.equal(done.status, 200);
  assert.deepEqual(Object.keys(done.body).sort(), ['draft', 'published']);
  const v1 = published.parsePublishedConfigurationV1(done.body.published);
  assert.equal(v1.version, 1);
  assert.equal(v1.contentHash, draft.contentHash);
  assert.equal(done.body.draft.status, 'PUBLISHED');
  assert.equal(done.body.draft.publishedVersion, 1);
  const again = await transition('publish', draft.draftId, 2, 'publisher', publishKey);
  assert.deepEqual([again.status, again.replayed], [200, 'true']);
  assert.deepEqual(again.body, done.body);

  const changed = { ...POLICY, holdTtlSeconds: 900, minLeadMinutes: 60 };
  const staleBase = await createDraft(m, BOOKING, changed, null);
  assert.deepEqual([staleBase.status, staleBase.body.error.code], [412, 'VERSION_CONFLICT']);
  const v2 = await release(m, BOOKING, changed, 1);
  assert.equal(v2.published.version, 2);

  const overview = await stub('GET', `/scopes/${m}/${BOOKING}`, 'reader');
  assert.equal(overview.status, 200);
  assert.deepEqual(Object.keys(overview.body).sort(), [
    'current',
    'marketId',
    'namespace',
    'openDraft',
    'publishedVersion',
  ]);
  assert.equal(overview.body.publishedVersion, 2);
  assert.equal(overview.body.openDraft, null);
  published.parsePublishedConfigurationV1(overview.body.current);

  const versions = await stub('GET', `/scopes/${m}/${BOOKING}/versions?limit=1`, 'reader');
  assert.deepEqual(
    versions.body.items.map((v) => v.version),
    [2],
  );
  const older = await stub('GET', `/scopes/${m}/${BOOKING}/versions?beforeVersion=2`, 'reader');
  assert.deepEqual(
    older.body.items.map((v) => v.version),
    [1],
  );

  const diff = await stub('GET', `/scopes/${m}/${BOOKING}/diff?from=1&to=2`, 'reader');
  assert.equal(diff.status, 200);
  assert.deepEqual(diff.body.from.content, POLICY);
  assert.deepEqual(diff.body.to.content, changed);
  assert.deepEqual(diff.body.changes, [
    { field: 'holdTtlSeconds', from: 600, to: 900 },
    { field: 'minLeadMinutes', from: 30, to: 60 },
  ]);
  assert.equal(
    (await stub('GET', `/scopes/${m}/${BOOKING}/diff?from=1&to=9`, 'reader')).status,
    404,
  );

  const history = await stub('GET', `/scopes/${m}/${BOOKING}/history`, 'reader');
  assert.deepEqual(
    history.body.items.map((h) => [h.action, h.actorSubject]),
    [
      ['DRAFT_PUBLISHED', STUB.publisher.subject],
      ['DRAFT_APPROVED', STUB.approver.subject],
      ['DRAFT_CREATED', STUB.author.subject],
      ['DRAFT_PUBLISHED', STUB.publisher.subject],
      ['DRAFT_APPROVED', STUB.admin.subject],
      ['DRAFT_CREATED', STUB.author.subject],
    ],
    'append-only, newest first, one row per command (failed commands leave none)',
  );
  assert.deepEqual(
    history.body.items.map((h) => h.version),
    [2, null, null, 1, null, null],
  );
  assert.ok(
    history.body.items.every((h) => h.reason === null),
    'no reason field in v1 bodies yet',
  );
  const page = await stub(
    'GET',
    `/scopes/${m}/${BOOKING}/history?limit=2&beforeSeq=${history.body.items[1].seq}`,
    'reader',
  );
  assert.deepEqual(
    page.body.items.map((h) => h.action),
    ['DRAFT_CREATED', 'DRAFT_PUBLISHED'],
  );
  const fetched = await stub('GET', `/drafts/${draft.draftId}`, 'reader');
  assert.equal(fetched.body.status, 'PUBLISHED');
  assert.equal((await stub('GET', `/drafts/${randomUUID()}`, 'reader')).status, 404);
  assert.equal((await stub('GET', `/scopes/${m}/${BOOKING}`, 'author')).status, 200);
  assert.equal(
    (await transition('withdraw', draft.draftId, 3, 'author')).body.error.code,
    'DRAFT_CLOSED',
  );
});

test('V1-L2 stub: an abandoned draft is withdrawn (audited), which frees the scope', async () => {
  const m = market();
  const draft = await createDraft(
    m,
    PRESENTATION,
    {
      currency: 'SYP',
      defaultLocale: 'ar',
      timezone: 'Asia/Damascus',
    },
    null,
  );
  assert.equal(draft.status, 201);
  const blocked = await createDraft(
    m,
    PRESENTATION,
    {
      currency: 'USD',
      defaultLocale: 'en',
      timezone: 'Asia/Damascus',
    },
    null,
    'author2',
  );
  assert.equal(blocked.body.error.code, 'DRAFT_ALREADY_OPEN');
  const reader = await transition('withdraw', draft.body.draftId, 1, 'reader');
  assert.equal(reader.status, 403);
  const withdrawn = await transition('withdraw', draft.body.draftId, 1, 'author2');
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.status, 'WITHDRAWN');
  assert.equal(withdrawn.body.withdrawnBy, STUB.author2.subject);
  const approveWithdrawn = await transition('approve', draft.body.draftId, 2, 'approver');
  assert.equal(approveWithdrawn.body.error.code, 'DRAFT_CLOSED');
  assert.equal(
    (
      await createDraft(
        m,
        PRESENTATION,
        {
          currency: 'USD',
          defaultLocale: 'en',
          timezone: 'Asia/Damascus',
        },
        null,
        'author2',
      )
    ).status,
    201,
  );
});

/* ------------------------- R: races on real PostgreSQL --------------------- */

test('V1-R1 stub: concurrent drafts on one expectedVersion: exactly one wins', async () => {
  const m = market();
  await release(m, BOOKING, POLICY, null);
  const racing = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      createDraft(m, BOOKING, { ...POLICY, horizonDays: i + 2 }, 1, i % 2 ? 'author' : 'author2'),
    ),
  );
  const statuses = racing.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409], JSON.stringify(statuses));
  assert.ok(
    racing.filter((r) => r.status === 409).every((r) => r.body.error.code === 'DRAFT_ALREADY_OPEN'),
  );
  const open = await db.configDraft.count({
    where: { scope: { marketId: m }, status: { in: ['DRAFT', 'APPROVED'] } },
  });
  assert.equal(open, 1);
});

test('V1-R2 stub: concurrent retries of ONE request (same key) replay one outcome', async () => {
  const m = market();
  const idem = key();
  const results = await Promise.all(
    Array.from({ length: 6 }, () => createDraft(m, BOOKING, POLICY, null, 'author', idem)),
  );
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results.map((r) => r.status)),
  );
  assert.equal(new Set(results.map((r) => r.body.draftId)).size, 1);
  assert.deepEqual(results.map((r) => r.replayed).sort(), [
    'false',
    'true',
    'true',
    'true',
    'true',
    'true',
  ]);
  assert.equal(await db.configDraft.count({ where: { scope: { marketId: m } } }), 1);
  assert.equal(
    await db.configHistory.count({ where: { scope: { marketId: m } } }),
    1,
    'one history row: replays write nothing',
  );
});

test('V1-R3 stub: concurrent publishes move the version exactly once; versions stay gap-free; the database refuses rewrites', async () => {
  const m = market();
  const draft = await createDraft(m, BOOKING, POLICY, null);
  await transition('approve', draft.body.draftId, 1, 'approver');
  const racing = await Promise.all(
    Array.from({ length: 6 }, () => transition('publish', draft.body.draftId, 2, 'publisher')),
  );
  const ok = racing.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, JSON.stringify(racing.map((r) => [r.status, r.body.error?.code])));
  assert.ok(
    racing
      .filter((r) => r.status !== 200)
      .every((r) => r.status === 412 && r.body.error.code === 'REVISION_CONFLICT'),
  );
  for (let expected = 2; expected <= 4; expected += 1) {
    const out = await release(m, BOOKING, { ...POLICY, horizonDays: expected }, expected - 1);
    assert.equal(out.published.version, expected);
  }
  const id = await scopeId(m, BOOKING);
  const versions = await db.configVersion.findMany({
    where: { scopeId: id },
    orderBy: { version: 'asc' },
  });
  assert.deepEqual(
    versions.map((v) => v.version),
    [1, 2, 3, 4],
  );
  assert.equal((await db.configScope.findUnique({ where: { id } })).publishedVersion, 4);

  const refused = async (statement, code) => {
    const result = await sql(runtimeUrl, statement);
    assert.equal(result.ok, false, `${statement} must be refused`);
    assert.equal(result.code, code, `${statement}: ${result.message}`);
  };
  await refused(
    `UPDATE app.config_scope SET published_version = published_version + 2 WHERE id = '${id}'`,
    '23514',
  );
  await refused(
    `UPDATE app.config_scope SET published_version = published_version - 1 WHERE id = '${id}'`,
    '23514',
  );
  await refused(
    `UPDATE app.config_version SET content_hash = content_hash WHERE scope_id = '${id}'`,
    '42501',
  );
  await refused(`DELETE FROM app.config_version WHERE scope_id = '${id}'`, '42501');
  await refused(`DELETE FROM app.config_history WHERE scope_id = '${id}'`, '42501');
  await refused(`TRUNCATE app.config_history`, '42501');
  await refused(`DELETE FROM app.config_draft WHERE scope_id = '${id}'`, '42501');
  await refused(
    `UPDATE app.config_draft SET approved_by = author_subject WHERE scope_id = '${id}' AND status = 'PUBLISHED'`,
    '23514',
  );
  await refused(
    `INSERT INTO app.config_version (id, scope_id, version, draft_id, content, content_hash, effective_at, published_by, published_at)
     SELECT gen_random_uuid(), scope_id, 4, gen_random_uuid(), content, content_hash, now(), published_by, now()
       FROM app.config_version WHERE scope_id = '${id}' AND version = 4`,
    '23505',
  );
});

test('V1-R4 history stays append-only after a provisioning replay re-grants table DML', async () => {
  const replay = await composeExec(
    context,
    'postgres',
    ['sh', '-c', 'CW_SERVICES=configuration sh -s'],
    {
      input: await readFile(path.join(ROOT, 'infra/postgres/provision.sh'), 'utf8'),
    },
  );
  assert.equal(replay.code, 0, replay.stderr);
  const granted = await sql(
    runtimeUrl,
    `SELECT has_table_privilege(current_user, 'app.config_history', 'DELETE') AS allowed`,
  );
  assert.equal(granted.ok, true, granted.message);
  const m = market();
  await release(m, BOOKING, POLICY, null);
  const id = await scopeId(m, BOOKING);
  for (const statement of [
    `DELETE FROM app.config_history WHERE scope_id = '${id}'`,
    `UPDATE app.config_history SET reason = 'rewritten' WHERE scope_id = '${id}'`,
    `UPDATE app.config_version SET effective_at = now() WHERE scope_id = '${id}'`,
    `DELETE FROM app.config_idempotency WHERE actor_subject = '${STUB.author.subject}'`,
  ]) {
    const result = await sql(runtimeUrl, statement);
    assert.equal(result.ok, false, statement);
    assert.equal(result.code, '42501', `${statement}: ${result.message}`);
  }
});

/* ----------------------------- M: outbox -> broker ------------------------ */

test('V1-M1 one published event per publish, committed with it, in commit order, parsed by the published event contract', async () => {
  const m = market();
  const first = await release(m, BOOKING, POLICY, null);
  const second = await release(m, BOOKING, { ...POLICY, horizonDays: 21 }, 1);
  const id = await scopeId(m, BOOKING);
  const rows = await db.outboxMessage.findMany({
    where: { payload: { contains: id } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  assert.equal(rows.length, 2, 'exactly one outbox row per publish');
  assert.ok(rows.every((r) => r.publishedAt === null));
  await drain(relay());
  const hits = await eventually(
    () => {
      const found = received.filter(forScope(id));
      return found.length >= 2 ? found : null;
    },
    { description: 'two published events' },
  );
  await drain(relay());
  await delay(300);
  assert.equal(received.filter(forScope(id)).length, 2, 'nothing republished');
  const parsed = hits.map((h) => CONFIGURATION_PUBLISHED_V1.parse(h.body));
  assert.deepEqual(
    parsed.map((p) => p.aggregate.version),
    [1, 2],
    'commit order',
  );
  for (const [i, event] of parsed.entries()) {
    const release = [first, second][i];
    assert.equal(event.envelopeVersion, 2);
    assert.equal(event.producer, 'configuration');
    assert.deepEqual(event.aggregate, { type: 'configuration-scope', id, version: i + 1 });
    assert.deepEqual(event.actor, { kind: 'account', id: STUB.publisher.subject });
    assert.deepEqual(Object.keys(hits[i].body.data).sort(), [
      'contentHash',
      'effectiveAt',
      'marketId',
      'namespace',
    ]);
    assert.deepEqual(event.data, {
      marketId: m,
      namespace: BOOKING,
      contentHash: release.published.contentHash,
      effectiveAt: release.published.effectiveAt,
    });
    assert.equal(hits[i].routingKey, 'configuration.configuration-published.v1');
    assert.equal(hits[i].properties.messageId, event.eventId);
    assert.equal(
      JSON.stringify(hits[i].body).includes('"holdTtlSeconds"'),
      false,
      'no content in events',
    );
  }
  const after = await db.outboxMessage.findMany({ where: { payload: { contains: id } } });
  assert.ok(after.every((r) => r.publishedAt !== null && r.attempts === 1 && r.lockedBy === null));
});

test('V1-M2 relay restart: a relay that dies after leasing loses nothing; the next relay publishes once', async () => {
  const m = market();
  await release(m, BOOKING, POLICY, null);
  const id = await scopeId(m, BOOKING);
  const crashing = relay({
    leaseMs: 1_000,
    onLeased: () => {
      throw new Error('SIMULATED_CRASH_AFTER_LEASE');
    },
  });
  await assert.rejects(() => crashing.runOnce(), /SIMULATED_CRASH_AFTER_LEASE/);
  const [row] = await db.outboxMessage.findMany({ where: { payload: { contains: id } } });
  assert.ok(row.lockedBy && row.publishedAt === null, 'leased, not published');
  const successor = relay();
  assert.equal((await successor.runOnce()).published, 0, 'a live lease is respected');
  // Measured on the database clock: the successor takes the row once the lease lapses.
  await eventually(async () => (await successor.runOnce()).published >= 1, {
    description: 'successor publishes after lease expiry',
  });
  await eventually(() => received.filter(forScope(id)).length >= 1);
  await delay(300);
  assert.equal(received.filter(forScope(id)).length, 1, 'exactly one delivery');
  const done = await db.outboxMessage.findUnique({ where: { id: row.id } });
  assert.equal(done.attempts, 2);
  assert.ok(done.publishedAt !== null);
});

test('V1-M3 competing relays lease disjoint rows: no event is published twice', async () => {
  const scopes = [];
  for (let i = 0; i < 6; i += 1) {
    const m = market();
    await release(m, BOOKING, POLICY, null);
    scopes.push(await scopeId(m, BOOKING));
  }
  const a = relay({ workerId: 'relay-a' });
  const b = relay({ workerId: 'relay-b' });
  await Promise.all([drain(a), drain(b), drain(relay({ workerId: 'relay-c' }))]);
  await eventually(() => scopes.every((s) => received.some(forScope(s))), {
    description: 'all six events',
  });
  await delay(300);
  for (const s of scopes) assert.equal(received.filter(forScope(s)).length, 1, s);
});

test('V1-M4 at-least-once, measured: a relay stalled past its lease can duplicate; the copy has the same eventId', async () => {
  const m = market();
  await release(m, BOOKING, POLICY, null);
  const id = await scopeId(m, BOOKING);
  let resumeStalled;
  const stalled = relay({
    workerId: 'relay-stalled',
    leaseMs: 400,
    onLeased: (records) =>
      records.length === 0 ? undefined : new Promise((resolve) => (resumeStalled = resolve)),
  });
  const stalledPass = stalled.runOnce();
  await eventually(() => resumeStalled !== undefined, { description: 'stalled relay leased' });
  const fresh = relay({ workerId: 'relay-fresh' });
  await eventually(async () => (await fresh.runOnce()).published >= 1, {
    description: 'fresh relay takes the expired lease',
  });
  resumeStalled();
  const pass = await stalledPass;
  assert.equal(pass.leaseLost >= 1, true, 'the stalled relay learns it lost the lease');
  const copies = await eventually(() => {
    const found = received.filter(forScope(id));
    return found.length >= 2 ? found : null;
  });
  assert.equal(new Set(copies.map((c) => c.body.eventId)).size, 1, 'duplicates share one eventId');
  const [row] = await db.outboxMessage.findMany({ where: { payload: { contains: id } } });
  assert.ok(row.publishedAt !== null && row.lockedBy === null, 'the fenced row was finalised once');
});

test('V1-M5 broker ACL: the configuration producer can publish only to its own exchange', async () => {
  const { connect } = amqp();
  const connection = await connect(brokerUrlAs(context, PRODUCER, PRODUCER_PASSWORD));
  connection.on('error', () => {});
  try {
    const channel = await connection.createConfirmChannel();
    channel.on('error', () => {});
    const closed = new Promise((resolve) => channel.once('close', resolve));
    channel.publish('catalog.events', 'catalog.anything', Buffer.from('{}'));
    await assert.rejects(
      Promise.race([
        closed.then(() => {
          throw new Error('ACCESS_REFUSED');
        }),
        delay(5_000).then(() => 'not refused'),
      ]),
      /ACCESS_REFUSED/,
    );
  } finally {
    await connection.close().catch(() => {});
  }
});
