/**
 * Workforce against the PUBLISHED contracts (built @carwash/contracts and
 * @carwash/event-contracts), on the real lane PostgreSQL with the compiled
 * service (exactly what the release image runs):
 *   - live HTTP responses of listCapacityResources validate with
 *     parsePage + parseCapacityResourceV1, page after page;
 *   - the local query parser admits exactly what parseCapacityResourceQueryV1
 *     admits (and normalises identically);
 *   - real outbox rows of workforce.eligibility-changed.v1 validate with the
 *     published business-v1 parser, which lists the event as published;
 *   - every error body the edge can produce validates with
 *     parseApiErrorEnvelope and agrees with API_ERROR_STATUS / RETRYABLE.
 * Substitute: Identity is a local HTTP double of /internal/v1/identity/session.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, digest, identityDouble, readContext, require, serviceDist } from './_support.mjs';

const load = (pkg, file) => require(path.join(ROOT, 'packages', pkg, 'dist', file));
const workforceV1 = load('contracts', path.join('workforce', 'v1.js'));
const protocol = load('contracts', path.join('common', 'protocol.js'));
const errors = load('contracts', path.join('common', 'errors.js'));
const events = load('event-contracts', 'index.js');

const { createHttpApplication } = serviceDist('workforce', 'transport/http/create-app.js');
const { errorBody, statusOf, RateLimited } = serviceDist(
  'workforce',
  'transport/http/http-errors.js',
);
const { WorkforceError, parseCapacityQuery } = serviceDist('workforce', 'domain/index.js');
const { WorkforceService } = serviceDist('workforce', 'application/index.js');
const { PrismaService } = serviceDist('workforce', 'infrastructure/persistence/prisma.service.js');
const { PrismaWorkforceStore } = serviceDist(
  'workforce',
  'infrastructure/persistence/prisma-workforce.store.js',
);
const { systemClock, uuidGenerator } = serviceDist('workforce', 'infrastructure/runtime/system.js');
const { IdentityAuthFailure } = serviceDist(
  'workforce',
  'infrastructure/identity/identity-session.client.js',
);
const { ConcurrencyViolation } = serviceDist(
  'workforce',
  'infrastructure/persistence/prisma-workforce.store.js',
);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CAPACITY_TOKEN = 'k'.repeat(48);
const TECH = randomUUID();
const OPS = { kind: 'USER', subject: randomUUID(), permissions: ['operations.dispatch'] };
const REVIEWER = { kind: 'USER', subject: randomUUID(), permissions: ['verification.review'] };
const tech = (subject) => ({
  kind: 'USER',
  subject,
  permissions: ['work.read:assigned', 'work.execute:assigned'],
});
const meta = (actor) => ({ actor, correlationId: randomUUID() });
const key = () => `lane-${randomUUID()}`;

let identity;
let app;
let base;
let prisma;
let service;
const zone = randomUUID();
const dayStart = Math.floor(Date.now() / DAY) * DAY + 7 * DAY;
const from = new Date(dayStart + 8 * HOUR).toISOString();
const to = new Date(dayStart + 16 * HOUR).toISOString();
const operators = [];

async function seed(subject = randomUUID(), { shifts = [] } = {}) {
  const operator = await service.createOperator(meta(OPS), {
    identitySubject: subject,
    displayName: 'Lane Operator',
    homeZoneId: randomUUID(),
  });
  const submitted = await service.submitVerification(meta(tech(subject)), [randomUUID()], key());
  await service.reviewVerification(meta(REVIEWER), submitted.id, {
    decision: 'APPROVE',
    validUntil: new Date(Date.now() + 365 * DAY),
  });
  await service.grantSkill(meta(OPS), operator.id, 'exterior-wash');
  for (const s of shifts) await service.createShift(meta(tech(subject)), operator.id, s, key());
  operators.push(operator.id);
  return operator.id;
}

before(async () => {
  const context = await readContext();
  const url = context.databases.workforce.appUrl;
  prisma = new PrismaService(url);
  const store = new PrismaWorkforceStore(prisma);
  service = new WorkforceService(store, store, systemClock, uuidGenerator);
  identity = await identityDouble({
    'technician-token-0001': {
      subject: TECH,
      permissions: ['work.read:assigned', 'work.execute:assigned'],
    },
  });
  process.env.DATABASE_URL = url;
  process.env.IDENTITY_URL = identity.url;
  process.env.WORKFORCE_SERVICE_CLIENTS = JSON.stringify([
    { id: 'dispatch', tokenSha256: digest(CAPACITY_TOKEN), scopes: ['workforce.capacity.read'] },
  ]);
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/internal/v1/workforce`;

  const shiftAt = (h, hours, z = zone) => ({
    zoneId: z,
    startsAt: new Date(dayStart + h * HOUR),
    endsAt: new Date(dayStart + (h + hours) * HOUR),
  });
  await seed(TECH, { shifts: [shiftAt(8, 4), shiftAt(13, 2, randomUUID())] });
  for (let i = 0; i < 4; i += 1) await seed(undefined, { shifts: [shiftAt(6 + i, 3)] });
  const suspended = operators[1];
  await service.setOperatorState(meta(OPS), suspended, { suspensionReason: 'SAFETY' });
});

after(async () => {
  await app?.close();
  await prisma?.client.$disconnect();
  await identity?.close();
});

const service_ = { 'x-service-client': 'dispatch', 'x-service-token': CAPACITY_TOKEN };

async function get(pathAndQuery, headers) {
  const response = await fetch(`${base}${pathAndQuery}`, { headers });
  return { status: response.status, body: await response.json() };
}

test('live listCapacityResources pages validate with the published Page<CapacityResourceV1>', async () => {
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const query = new globalThis.URLSearchParams({ zoneId: zone, from, to, limit: '2' });
    if (cursor) query.set('cursor', cursor);
    // The published query parser accepts exactly what we send.
    workforceV1.parseCapacityResourceQueryV1(Object.fromEntries(query));
    const reply = await get(`/capacity-resources?${query}`, service_);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const page = protocol.parsePage(reply.body, '$', workforceV1.parseCapacityResourceV1);
    assert.deepEqual(page, reply.body, 'the published parser accepts the body unchanged');
    seen.push(...page.items);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor !== null && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(
    seen.map((r) => r.resourceId),
    [...operators].sort(),
  );
  const mine = seen.find((r) => r.resourceId === operators[0]);
  assert.equal(mine.eligibility, 'ELIGIBLE');
  assert.equal(mine.zoneIds.length, 2, 'both zones of overlapping shifts');
  assert.equal(mine.shifts.length, 2);
  const suspended = seen.find((r) => r.resourceId === operators[1]);
  assert.equal(suspended.eligibility, 'INELIGIBLE');
  // create (1), verification submit (2), approve (3), skill grant (4); suspension (5).
  assert.equal(mine.eligibilityRevision, 4);
  assert.equal(suspended.eligibilityRevision, 5);
});

/** Result of a parser, or null when it refuses (optionally inspecting the refusal). */
function attempt(parse, inspect = () => {}) {
  try {
    return parse();
  } catch (error) {
    inspect(error);
    return null;
  }
}

test('the local query parser admits exactly what the published parser admits', () => {
  const ok = { zoneId: zone, from, to };
  const variants = [
    ok,
    { ...ok, zoneId: zone.toUpperCase() },
    { ...ok, limit: '1' },
    { ...ok, limit: '100' },
    { ...ok, limit: '101' },
    { ...ok, limit: '0' },
    { ...ok, limit: '007' },
    { ...ok, limit: '1000' },
    { ...ok, limit: ' 5' },
    { ...ok, limit: ['5'] },
    { ...ok, cursor: 'abc_DEF-123' },
    { ...ok, cursor: '' },
    { ...ok, cursor: 'a'.repeat(512) },
    { ...ok, cursor: 'a'.repeat(513) },
    { ...ok, cursor: 'a+b' },
    { ...ok, from: '2026-10-10T08:00:00Z' },
    { ...ok, from: '2026-10-10T08:00:00.0000Z' },
    { ...ok, from: '2026-02-29T08:00:00.000Z' },
    { ...ok, to: from },
    { ...ok, zoneId: 'x' },
    { ...ok, zoneId: '00000000-0000-0000-0000-000000000000' },
    { from, to },
    { zoneId: zone, to },
  ];
  for (const raw of variants) {
    const published = attempt(() => workforceV1.parseCapacityResourceQueryV1(raw));
    const ours = attempt(
      () => parseCapacityQuery(raw),
      (error) => assert.ok(error instanceof WorkforceError && error.code === 'INVALID_INPUT'),
    );
    assert.equal(ours === null, published === null, JSON.stringify(raw).slice(0, 120));
    if (ours && published) {
      assert.deepEqual(
        {
          zoneId: ours.zoneId,
          from: ours.from.toISOString(),
          to: ours.to.toISOString(),
          page: { limit: ours.limit, cursor: ours.cursor },
        },
        published,
      );
    }
  }
  // Deliberately stricter than the published parser: unknown parameters are refused.
  assert.throws(() => parseCapacityQuery({ ...ok, extra: '1' }));
});

test('real outbox rows of workforce.eligibility-changed.v1 validate with the published parser', async () => {
  assert.ok(
    events.BUSINESS_EVENTS_V1.some((e) => e.eventType === 'workforce.eligibility-changed.v1'),
    'the event is published by Lane E',
  );
  const rows = await prisma.client.$queryRawUnsafe(
    `SELECT payload, exchange, routing_key FROM app.outbox_message
      WHERE event_type = 'workforce.eligibility-changed.v1'
        AND (payload::jsonb -> 'aggregate' ->> 'id') = ANY($1::text[])`,
    operators,
  );
  // Per operator: submit, approve, grant (3); plus the suspension of one.
  assert.equal(rows.length, operators.length * 3 + 1);
  const versions = new Map();
  for (const row of rows) {
    const event = events.WORKFORCE_ELIGIBILITY_CHANGED_V1.parse(JSON.parse(row.payload));
    assert.equal(row.exchange, 'workforce.events');
    assert.equal(row.routing_key, event.eventType);
    assert.equal(event.aggregate.type, 'capacity-resource');
    const list = versions.get(event.aggregate.id) ?? [];
    list.push(event.aggregate.version);
    versions.set(event.aggregate.id, list);
  }
  for (const [id, list] of versions) {
    list.sort((x, y) => x - y);
    assert.deepEqual(
      list,
      Array.from({ length: list.length }, (_, i) => i + 2),
      `gap-free eligibility revisions for ${id}`,
    );
  }
});

test('availability responses are exactly the requested view; errors use the envelope', async () => {
  const headers = { authorization: 'Bearer technician-token-0001' };
  const view = await get('/me/availability', headers);
  assert.equal(view.status, 200);
  assert.deepEqual(view.body, { status: 'ON_BREAK', revision: 0, updatedAt: null });
  const forbidden = await get('/me/availability', service_);
  assert.equal(forbidden.status, 403);
  errors.parseApiErrorEnvelope(forbidden.body);
  const invalid = await get('/capacity-resources?zoneId=nope', service_);
  assert.equal(invalid.status, 400);
  const parsed = errors.parseApiErrorEnvelope(invalid.body);
  assert.equal(errors.API_ERROR_STATUS[parsed.error.code], 400);
});

test('every edge error body satisfies the published error envelope', () => {
  const codes = [
    'INVALID_INPUT',
    'INVALID_CURSOR',
    'FORBIDDEN',
    'OPERATOR_NOT_FOUND',
    'CASE_NOT_FOUND',
    'SHIFT_NOT_FOUND',
    'SKILL_NOT_FOUND',
    'OPERATOR_EXISTS',
    'CASE_NOT_PENDING',
    'PENDING_CASE_EXISTS',
    'SELF_REVIEW_FORBIDDEN',
    'SKILL_EXISTS',
    'SHIFT_NOT_ACTIVE',
    'SHIFT_OVERLAPS',
    'VERSION_CONFLICT',
    'REVISION_CONFLICT',
    'IDEMPOTENCY_KEY_REUSED',
  ];
  const failures = [
    ...codes.map((code) => new WorkforceError(code, 'x')),
    new IdentityAuthFailure('UNAUTHENTICATED'),
    new IdentityAuthFailure('UNAVAILABLE'),
    new RateLimited(1500),
    new ConcurrencyViolation('OPERATOR'),
    { meta: { driverAdapterError: { cause: { code: '40P01' } } } },
    { code: 'P2028' },
    { getStatus: () => 404 },
    { getStatus: () => 413 },
    new Error('boom'),
  ];
  for (const error of failures) {
    const body = errorBody(error, randomUUID(), randomUUID());
    const parsed = errors.parseApiErrorEnvelope(body);
    assert.equal(statusOf(body), errors.API_ERROR_STATUS[parsed.error.code], parsed.error.code);
    assert.equal(body.error.retryable, errors.API_ERROR_RETRYABLE.has(body.error.code));
  }
  const conflict = errorBody(new WorkforceError('REVISION_CONFLICT', 'x'), randomUUID(), 'r');
  assert.equal(statusOf(conflict), 409);
  assert.equal(conflict.error.reason, 'REVISION_CONFLICT');
});
