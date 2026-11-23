import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { createHttpApplication } from '../../src/transport/http/create-app';
import {
  TestClock,
  allowZones,
  replica,
  seedOperator,
  workforceAppUrl,
  type Replica,
} from './support';

/**
 * P05-C1 HTTP edge on the real lane PostgreSQL (runtime role): actor/object
 * authorization, closed bodies, idempotency headers, the profile view shape and
 * the shared error envelope. Identity is a local HTTP double of
 * `GET /internal/v1/identity/session` (the only substitute in this suite).
 */
const TECH = randomUUID();
const OTHER = randomUUID();
const OPS_SUBJECT = randomUUID();
const SESSIONS: Record<string, { subject: string; permissions: string[] }> = {
  'ops-token-000000001': { subject: OPS_SUBJECT, permissions: ['operations.dispatch'] },
  'tech-token-00000001': {
    subject: TECH,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'tech-ro-token-00001': { subject: TECH, permissions: ['work.read:assigned'] },
  'other-token-0000001': {
    subject: OTHER,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'customer-token-0001': { subject: randomUUID(), permissions: ['bookings.read:self'] },
};

let identity: Server;
let app: INestApplication;
let base: string;
let seed: Replica;
let operatorId: string;
const clock = new TestClock();
const zone = randomUUID();

before(async () => {
  identity = createServer((req, res) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const session = SESSIONS[token];
    if (req.url !== '/internal/v1/identity/session' || session === undefined) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ...session, sessionId: randomUUID(), authVersion: 1, roles: [] }));
  });
  await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
  process.env.DATABASE_URL = workforceAppUrl();
  process.env.IDENTITY_URL = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
  process.env.WORKFORCE_USER_REQUESTS_PER_MINUTE = '600';
  process.env.WORKFORCE_SERVICE_CLIENTS = '[]';
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/internal/v1/workforce`;
  seed = replica(clock);
  operatorId = (await seedOperator(seed, clock, { subject: TECH })).operatorId;
  await allowZones(seed, operatorId, [zone]);
  await seedOperator(seed, clock, { subject: OTHER });
});

after(async () => {
  await app.close();
  await seed.prisma.client.$disconnect();
  await new Promise<void>((resolve) => identity.close(() => resolve()));
});

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Reply> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

function reason(reply: Reply): string | null {
  const error = reply.body.error as { code?: string; reason?: string | null } | undefined;
  return error?.reason ?? error?.code ?? null;
}

test('GET /me/profile: own profile only, closed shape without subject or evidence', async () => {
  const reply = await call('GET', '/me/profile', 'tech-token-00000001');
  assert.equal(reply.status, 200);
  assert.deepEqual(Object.keys(reply.body).sort(), [
    'asOf',
    'availability',
    'displayName',
    'employmentStatus',
    'equipment',
    'exceptions',
    'operatorId',
    'readiness',
    'schedule',
    'serviceArea',
    'skillCodes',
    'suspended',
    'upcomingShifts',
    'verification',
    'version',
  ]);
  assert.equal(reply.body.operatorId, operatorId);
  const text = JSON.stringify(reply.body);
  assert.equal(text.includes(TECH), false, 'the Identity subject never leaves the service');
  assert.equal(text.includes('evidenceRefs'), false);
  const area = reply.body.serviceArea as { zoneIds: string[] };
  assert.ok(area.zoneIds.includes(zone));
  assert.equal((await call('GET', '/me/profile', null)).status, 401);
  assert.equal((await call('GET', '/me/profile', 'customer-token-0001')).status, 403);
  assert.equal(
    (await call('GET', `/operators/${operatorId}/profile`, 'tech-token-00000001')).status,
    403,
    'the operations route is not a technician route',
  );
  assert.equal(
    (await call('GET', `/operators/${operatorId}/profile`, 'ops-token-000000001')).status,
    200,
  );
});

test('schedule + exceptions over HTTP: closed bodies, idempotency key, object access', async () => {
  const windows = [{ weekday: 2, startMinute: 480, endMinute: 720, zoneId: zone }];
  const readOnly = await call('PUT', '/me/schedule', 'tech-ro-token-00001', {
    timeZone: 'Asia/Damascus',
    windows,
    expectedRevision: 0,
  });
  assert.equal(readOnly.status, 403, 'declaring work needs work.execute:assigned');
  const put = await call('PUT', '/me/schedule', 'tech-token-00000001', {
    timeZone: 'Asia/Damascus',
    windows,
    expectedRevision: 0,
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.revision, 1);
  const stale = await call('PUT', '/me/schedule', 'tech-token-00000001', {
    timeZone: 'Asia/Damascus',
    windows: [],
    expectedRevision: 0,
  });
  assert.equal(stale.status, 409);
  assert.equal(reason(stale), 'REVISION_CONFLICT');
  const extra = await call('PUT', '/me/schedule', 'tech-token-00000001', {
    timeZone: 'Asia/Damascus',
    windows,
    expectedRevision: 1,
    note: 'x',
  });
  assert.equal(extra.status, 400);

  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  const body = {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
    reason: 'LEAVE',
  };
  const noKey = await call('POST', '/me/availability-exceptions', 'tech-token-00000001', body);
  assert.equal(noKey.status, 400);
  const k = `http-${randomUUID()}`;
  const created = await call('POST', '/me/availability-exceptions', 'tech-token-00000001', body, {
    'idempotency-key': k,
  });
  assert.equal(created.status, 201);
  const replay = await call('POST', '/me/availability-exceptions', 'tech-token-00000001', body, {
    'idempotency-key': k,
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.exceptionId, created.body.exceptionId);
  const id = String(created.body.exceptionId);
  const foreign = await call(
    'POST',
    `/availability-exceptions/${id}/cancel`,
    'other-token-0000001',
    {},
  );
  assert.equal(foreign.status, 404, 'another technician learns nothing');
  const own = await call(
    'POST',
    `/availability-exceptions/${id}/cancel`,
    'tech-token-00000001',
    {},
  );
  assert.equal(own.status, 200);
  assert.equal(own.body.status, 'CANCELLED');
  const again = await call(
    'POST',
    `/availability-exceptions/${id}/cancel`,
    'tech-token-00000001',
    {},
  );
  assert.equal(again.status, 409);
  assert.equal(reason(again), 'EXCEPTION_NOT_ACTIVE');
});

test('equipment over HTTP: operations register, technician reports, unknown kind is 400', async () => {
  const registered = await call(
    'POST',
    `/operators/${operatorId}/equipment`,
    'ops-token-000000001',
    {
      kind: 'WATER_SUPPLY',
      required: true,
    },
  );
  assert.equal(registered.status, 201);
  assert.deepEqual(Object.keys(registered.body).sort(), [
    'issue',
    'kind',
    'required',
    'revision',
    'status',
    'updatedAt',
  ]);
  const byTech = await call('POST', `/operators/${operatorId}/equipment`, 'tech-token-00000001', {
    kind: 'VACUUM',
    required: false,
  });
  assert.equal(byTech.status, 403);
  const down = await call('PUT', '/me/equipment/WATER_SUPPLY/status', 'tech-token-00000001', {
    status: 'UNAVAILABLE',
    issue: 'SUPPLIES_EMPTY',
    expectedRevision: 1,
  });
  assert.equal(down.status, 200);
  const profile = await call('GET', '/me/profile', 'tech-token-00000001');
  const readiness = profile.body.readiness as { ready: boolean; reasons: string[] };
  assert.equal(readiness.ready, false);
  assert.ok(readiness.reasons.includes('EQUIPMENT_UNAVAILABLE'));
  const unknownKind = await call('PUT', '/me/equipment/DRONE/status', 'tech-token-00000001', {
    status: 'READY',
    issue: null,
    expectedRevision: 2,
  });
  assert.equal(unknownKind.status, 400);
  const notRegistered = await call('PUT', '/me/equipment/VACUUM/status', 'other-token-0000001', {
    status: 'READY',
    issue: null,
    expectedRevision: 1,
  });
  assert.equal(notRegistered.status, 404);
  assert.equal(reason(notRegistered), 'EQUIPMENT_NOT_FOUND');
  const fixed = await call('PUT', '/me/equipment/WATER_SUPPLY/status', 'tech-token-00000001', {
    status: 'READY',
    issue: null,
    expectedRevision: 2,
  });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.revision, 3);
});
