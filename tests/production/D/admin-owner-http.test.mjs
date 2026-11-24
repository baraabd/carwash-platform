/**
 * Admin owner conformance on real Gateway, Identity, Workforce, Dispatch,
 * PostgreSQL and Redis. This suite does not claim browser or broker coverage.
 * Scheduling's committed hold enters Dispatch's own transactional inbox effect.
 */
/* global AbortSignal -- Node 24 web API */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, appDsn, context, sql } from '../../integration/_support.mjs';
import { hardenPrivileges, migrateDeploy } from '../../../scripts/acceptance/lib/migrations.mjs';
import { STAFF_ORIGIN, staff, startIdentity } from './_identity.mjs';
import {
  eligibleWorkforceResource,
  pendingWorkforceCase,
  workforceCommand,
} from './_admin-workforce.mjs';

const own = (service) => createRequire(path.join(ROOT, 'services', service, 'package.json'));
const dist = (service, file) => own(service)(path.join(ROOT, 'services', service, 'dist', file));
const key = () => randomUUID();
const zoneId = randomUUID();
const startsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
const endsAt = new Date(Date.now() + 4 * 3_600_000).toISOString();
const capacityToken = randomBytes(24).toString('hex');
const stack = {};
const environments = {};

async function startOwner(service, port = 0) {
  for (const [name, value] of Object.entries(environments[service])) process.env[name] = value;
  own(service)('reflect-metadata');
  const { createHttpApplication } = dist(service, 'transport/http/create-app.js');
  const app = await createHttpApplication();
  stack[service] = { app };
  await app.listen(port, '127.0.0.1');
  stack[service].origin = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return stack[service];
}

test.before(async () => {
  const ctx = { ...context, root: ROOT };
  for (const service of ['workforce', 'dispatch']) {
    const migrated = await migrateDeploy(ctx, service);
    assert.equal(migrated.code, 0, `${service} migrations failed`);
    const hardened = await hardenPrivileges(ctx, service);
    assert.equal(hardened.code, 0, `${service} hardening failed`);
  }
  stack.identity = await startIdentity();
  environments.workforce = {
    DATABASE_URL: appDsn(context, 'workforce'),
    IDENTITY_URL: stack.identity.base,
    WORKFORCE_SERVICE_CLIENTS: JSON.stringify([
      {
        id: 'dispatch',
        tokenSha256: createHash('sha256').update(capacityToken).digest('hex'),
        scopes: ['workforce.capacity.read'],
      },
    ]),
  };
  await startOwner('workforce');
  environments.dispatch = {
    DATABASE_URL: appDsn(context, 'dispatch'),
    IDENTITY_URL: stack.identity.base,
    DISPATCH_SERVICE_CLIENTS: '',
    DISPATCH_WORKFORCE_URL: stack.workforce.origin,
    DISPATCH_WORKFORCE_CLIENT_ID: 'dispatch',
    DISPATCH_WORKFORCE_CLIENT_TOKEN: capacityToken,
    DISPATCH_WORKFORCE_TIMEOUT_MS: '300',
  };
  await startOwner('dispatch');
  const gatewayRequire = createRequire(path.join(ROOT, 'apps/api-gateway/package.json'));
  gatewayRequire('reflect-metadata');
  const { createGatewayApplication, loadGatewayConfig } = gatewayRequire('./dist/index.js');
  const app = await createGatewayApplication(
    loadGatewayConfig({
      GATEWAY_UPSTREAMS: JSON.stringify({
        identity: stack.identity.base,
        workforce: stack.workforce.origin,
        dispatch: stack.dispatch.origin,
      }),
      IDENTITY_ISSUER: 'https://identity.washgo.invalid',
      IDENTITY_AUDIENCE: 'washgo-web',
      GATEWAY_ALLOWED_ORIGINS: STAFF_ORIGIN,
      GATEWAY_TIMEOUT_MS: '3000',
    }),
  );
  stack.gateway = { app };
  await app.listen(0, '127.0.0.1');
  stack.gateway.origin = await app.getUrl();
  stack.operations = await staff(stack.identity, ['operations']);
  stack.reviewer = await staff(stack.identity, ['reviewer']);
});

test.after(async () => {
  const closed = await Promise.allSettled(
    ['gateway', 'dispatch', 'workforce', 'identity'].map((name) => stack[name]?.app.close()),
  );
  const failed = closed.filter((result) => result.status === 'rejected');
  assert.equal(failed.length, 0, 'Every started owner must shut down');
});

async function gateway(principal, route, { method = 'GET', body, idempotencyKey = key() } = {}) {
  const response = await fetch(`${stack.gateway.origin}/api/v1${route}`, {
    method,
    headers: {
      cookie: principal.jar.header(),
      origin: STAFF_ORIGIN,
      'x-correlation-id': randomUUID(),
      ...(method === 'GET'
        ? {}
        : {
            'content-type': 'application/json',
            'x-csrf-token': principal.jar.cookies.get('__Host-wg_csrf'),
            'idempotency-key': idempotencyKey,
          }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

async function resource() {
  const technician = await staff(stack.identity, ['technician']);
  const resourceId = await eligibleWorkforceResource({
    origin: stack.workforce.origin,
    operations: stack.operations,
    reviewer: stack.reviewer,
    technician,
    zoneId,
    startsAt,
    endsAt,
  });
  return { resourceId, technicianSubjectId: technician.subject };
}

async function assignment() {
  const { PrismaService } = dist('dispatch', 'infrastructure/persistence/prisma.service.js');
  const { PrismaDispatchStore } = dist(
    'dispatch',
    'infrastructure/persistence/prisma-dispatch.store.js',
  );
  const { holdChangedConsumerParts } = dist(
    'dispatch',
    'transport/messaging/hold-changed.consumer.js',
  );
  const { systemClock, uuidGenerator } = dist('dispatch', 'infrastructure/runtime/system.js');
  const prisma = new PrismaService(appDsn(context, 'dispatch'));
  const bookingId = randomUUID();
  const event = {
    eventId: randomUUID(),
    eventType: 'scheduling.hold-changed.v1',
    envelopeVersion: 2,
    producer: 'scheduling',
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    causationId: null,
    traceparent: null,
    aggregate: { type: 'hold', id: randomUUID(), version: 2 },
    actor: { kind: 'service', id: 'scheduling' },
    data: { state: 'COMMITTED', zoneId, startsAt, endsAt, bookingId },
  };
  try {
    const parts = holdChangedConsumerParts(
      new PrismaDispatchStore(prisma),
      systemClock,
      uuidGenerator,
    );
    const message = parts.parse(event);
    const outcome = await parts.store.applyOnce(
      {
        eventId: event.eventId,
        eventType: event.eventType,
        payloadHash: createHash('sha256').update(JSON.stringify(event)).digest('hex'),
        correlationId: event.correlationId,
      },
      (tx) => parts.effect(message, tx),
    );
    assert.equal(outcome, 'APPLIED');
  } finally {
    await prisma.client.$disconnect();
  }
  const read = await gateway(stack.operations, `/admin/bookings/${bookingId}/assignment`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.status, 'UNASSIGNED');
  return read.body;
}

test('real Gateway/Workforce: a repeated verification decision returns 409 and cannot rewrite the approval', async () => {
  const technician = await staff(stack.identity, ['technician']);
  const pending = await pendingWorkforceCase({
    origin: stack.workforce.origin,
    operations: stack.operations,
    technician,
    zoneId,
  });
  const body = {
    decision: 'APPROVE',
    validUntil: new Date(Date.now() + 300 * 86_400_000).toISOString(),
  };
  const first = await gateway(stack.reviewer, `/admin/reviews/${pending.caseId}`, {
    method: 'POST',
    body,
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.status, 'APPROVED');
  const repeat = await gateway(stack.reviewer, `/admin/reviews/${pending.caseId}`, {
    method: 'POST',
    body,
  });
  assert.equal(repeat.status, 409, JSON.stringify(repeat.body));
  assert.equal(repeat.body.error.code, 'CONFLICT');
  assert.equal(repeat.body.error.reason, null, 'Gateway keeps owner-internal reasons private');
  const ready = await workforceCommand(
    stack.workforce.origin,
    stack.operations,
    `/operators/${pending.operatorId}/readiness`,
  );
  assert.equal(ready.status, 200);
  assert.ok(!ready.body.reasons.includes('VERIFICATION_REQUIRED'));
});

test('real Gateway/Dispatch/Workforce: eligible offer and same-key replay create exactly one offer', async () => {
  const target = await resource();
  const job = await assignment();
  const body = { expectedRevision: job.revision, ...target };
  const idempotencyKey = key();
  const route = `/admin/assignments/${job.assignmentId}/offers`;
  const first = await gateway(stack.operations, route, { method: 'POST', body, idempotencyKey });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.status, 'OFFERED');
  assert.equal(first.body.offer.resourceId, target.resourceId);
  const replay = await gateway(stack.operations, route, { method: 'POST', body, idempotencyKey });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.offer.offerId, first.body.offer.offerId);
  const count = await sql(
    appDsn(context, 'dispatch'),
    `SELECT count(*)::int AS n FROM app.dispatch_offer WHERE assignment_id = '${job.assignmentId}'`,
  );
  assert.equal(count.ok, true);
  assert.equal(count.rows[0].n, 1);
});

test('real Workforce ineligibility and outage fail closed; a fresh owner answer permits the same command', async () => {
  const target = await resource();
  const job = await assignment();
  const route = `/admin/assignments/${job.assignmentId}/offers`;
  const command = {
    method: 'POST',
    body: { expectedRevision: job.revision, ...target },
    idempotencyKey: key(),
  };
  const suspended = await workforceCommand(
    stack.workforce.origin,
    stack.operations,
    `/operators/${target.resourceId}/status`,
    { method: 'PATCH', body: { suspensionReason: 'OPERATIONS' } },
  );
  assert.equal(suspended.status, 200);
  const denied = await gateway(stack.operations, route, command);
  assert.equal(denied.status, 422, JSON.stringify(denied.body));
  assert.equal(denied.body.error.code, 'BUSINESS_RULE_VIOLATION');
  assert.equal(denied.body.error.reason, null);
  const restored = await workforceCommand(
    stack.workforce.origin,
    stack.operations,
    `/operators/${target.resourceId}/status`,
    { method: 'PATCH', body: { suspensionReason: null } },
  );
  assert.equal(restored.status, 200);
  const port = Number(new URL(stack.workforce.origin).port);
  await stack.workforce.app.close();
  const unavailable = await gateway(stack.operations, route, command);
  assert.equal(unavailable.status, 503, JSON.stringify(unavailable.body));
  assert.equal(unavailable.body.error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(unavailable.body.error.reason, null);
  await startOwner('workforce', port);
  const accepted = await gateway(stack.operations, route, command);
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, 'OFFERED');
});
