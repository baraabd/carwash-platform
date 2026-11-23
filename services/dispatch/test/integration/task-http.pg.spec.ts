import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { createHttpApplication } from '../../src/transport/http/create-app';
import {
  DISPATCH_CLIENT,
  DISPATCH_CLIENT_TOKEN,
  mediaDouble,
  workforceDouble,
  type Double,
  type MediaObjectSetting,
  type ResourceSetting,
} from './http-doubles';
import { TestClock, laneContext, openJob, replica, type Replica } from './support';

/**
 * Technician task routes over a real Nest HTTP server on real PostgreSQL.
 * Doubles (declared in evidence): Identity session view, Workforce
 * capacity-resources (PUBLISHED shape), Media object read/claim (REQUESTED shape).
 */
const TECH_A = randomUUID();
const TECH_B = randomUUID();
const OPS_SUBJECT = randomUUID();
const SESSIONS: Record<string, { subject: string; permissions: string[] }> = {
  'ops-token-0000000001': { subject: OPS_SUBJECT, permissions: ['operations.dispatch'] },
  'tech-a-token-0000001': {
    subject: TECH_A,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'tech-b-token-0000001': {
    subject: TECH_B,
    permissions: ['work.read:assigned', 'work.execute:assigned'],
  },
  'reader-token-0000001': { subject: TECH_A, permissions: ['work.read:assigned'] },
};
const RESOURCES = new Map<string, ResourceSetting>();
const OBJECTS = new Map<string, MediaObjectSetting>();
const CLAIMS = new Map<string, Set<string>>();

let identity: Server;
let workforce: Double;
let media: Double;
let app: INestApplication;
let base: string;
let seed: Replica;
const clock = new TestClock();

before(async () => {
  identity = createServer((req, res) => {
    const session = SESSIONS[(req.headers.authorization ?? '').replace(/^Bearer /, '')];
    if (req.url !== '/internal/v1/identity/session' || !session) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ...session, sessionId: randomUUID(), authVersion: 1, roles: [] }));
  });
  await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
  workforce = await workforceDouble(RESOURCES);
  media = await mediaDouble(OBJECTS, CLAIMS);
  Object.assign(process.env, {
    DATABASE_URL: laneContext().databases.dispatch!.appUrl,
    IDENTITY_URL: `http://127.0.0.1:${(identity.address() as AddressInfo).port}`,
    DISPATCH_USER_REQUESTS_PER_MINUTE: '600',
    DISPATCH_WORKFORCE_URL: workforce.url,
    DISPATCH_WORKFORCE_CLIENT_ID: DISPATCH_CLIENT,
    DISPATCH_WORKFORCE_CLIENT_TOKEN: DISPATCH_CLIENT_TOKEN,
    DISPATCH_MEDIA_URL: media.url,
    DISPATCH_MEDIA_CLIENT_ID: DISPATCH_CLIENT,
    DISPATCH_MEDIA_CLIENT_TOKEN: DISPATCH_CLIENT_TOKEN,
  });
  app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/internal/v1/dispatch`;
  seed = replica(clock);
});

after(async () => {
  await app.close();
  await seed.prisma.client.$disconnect();
  await workforce.close();
  await media.close();
  await new Promise<void>((resolve) => identity.close(() => resolve()));
});

type Json = Record<string, unknown> & { error?: { code: string; reason: string | null } };

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  idem = true,
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idem && method !== 'GET' ? { 'idempotency-key': `http-${randomUUID()}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Json };
}

const A = 'tech-a-token-0000001';
const B = 'tech-b-token-0000001';

async function acceptedTask(): Promise<{ taskId: string; revision: number }> {
  const { assignment } = await openJob(seed, clock);
  const resourceId = randomUUID();
  RESOURCES.set(resourceId, { eligibility: 'ELIGIBLE', eligibilityRevision: 1 });
  const offer = await call('POST', `/assignments/${assignment.id}/offers`, 'ops-token-0000000001', {
    expectedRevision: assignment.version,
    resourceId,
    technicianSubjectId: TECH_A,
  });
  assert.equal(offer.status, 201);
  const offerId = (offer.body.offer as { offerId: string }).offerId;
  const accepted = await call('POST', `/offers/${offerId}/accept`, A, {});
  assert.equal(accepted.status, 200);
  const taskId = accepted.body.taskId as string;
  assert.ok(taskId);
  return { taskId, revision: 1 };
}

function photo(owner = TECH_A, overrides: Partial<MediaObjectSetting> = {}): string {
  const id = randomUUID();
  OBJECTS.set(id, {
    status: 'AVAILABLE',
    purpose: 'WORK_EVIDENCE',
    contentType: 'image/jpeg',
    ownerSubjectId: owner,
    ...overrides,
  });
  return id;
}

test('the whole technician journey over HTTP, ending in a cash handoff', async () => {
  const { taskId } = await acceptedTask();
  const jobs = await call('GET', '/me/jobs', A);
  assert.equal(jobs.status, 200);
  assert.ok((jobs.body.tasks as Array<{ taskId: string }>).some((t) => t.taskId === taskId));
  let view = (await call('GET', `/me/tasks/${taskId}`, A)).body;
  const go = async (method: string, path: string, body: Record<string, unknown> = {}) => {
    const reply = await call(method, `/tasks/${taskId}${path}`, A, {
      expectedRevision: view.revision,
      ...body,
    });
    assert.equal(reply.status, 200, `${path}: ${JSON.stringify(reply.body.error)}`);
    view = reply.body;
    return view;
  };
  await go('POST', '/depart');
  await go('POST', '/arrive');
  assert.equal(view.arrivalMethod, 'MANUAL_CONFIRMATION');
  await go('PUT', '/evidence/BEFORE/0', { mediaObjectId: photo() });
  await go('PUT', '/condition-note', { text: 'خدش قديم على الصدام' });
  await go('POST', '/start');
  for (const code of ['exterior', 'wheels', 'interior', 'quality']) {
    await go('PUT', `/checklist/${code}`, { checked: true });
  }
  await go('POST', '/document');
  await go('PUT', '/evidence/AFTER/1', { mediaObjectId: photo() });
  const working = await call('GET', `/me/bookings/${view.bookingId as string}/work`, A);
  assert.equal(working.body.workState, 'IN_PROGRESS');
  await go('POST', '/finish');
  const done = await call('GET', `/me/bookings/${view.bookingId as string}/work`, A);
  assert.equal(done.status, 200);
  assert.equal(done.body.workState, 'COMPLETED');
  assert.equal(done.body.technicianSubjectId, TECH_A);
  assert.equal((await call('GET', `/me/bookings/${view.bookingId as string}/work`, B)).status, 404);
  await go('POST', '/close', {
    collection: {
      outcome: 'CASH_COLLECTED',
      amount: { currency: 'SYP', amountMinor: '1500000', scale: 2 },
    },
  });
  assert.equal(view.stage, 'CLOSED');
  assert.deepEqual(view.collection, {
    outcome: 'CASH_COLLECTED',
    amount: { currency: 'SYP', amountMinor: '1500000', scale: 2 },
    reason: null,
    declaredAt: (view.collection as { declaredAt: string }).declaredAt,
    lateAmount: null,
    lateDeclaredAt: null,
  });
  const evidence = view.evidence as { BEFORE: unknown[]; AFTER: unknown[] };
  assert.equal(evidence.BEFORE[1], null);
  assert.ok(evidence.AFTER[1]);
  assert.ok(typeof view.startsAt === 'string' && typeof view.zoneId === 'string');
});

test('object access, permissions and authentication fail closed with the shared envelope', async () => {
  const { taskId } = await acceptedTask();
  const other = await call('GET', `/me/tasks/${taskId}`, B);
  assert.equal(other.status, 404);
  assert.deepEqual(
    [other.body.error?.code, other.body.error?.reason],
    ['NOT_FOUND', 'TASK_NOT_FOUND'],
  );
  assert.equal(
    (await call('POST', `/tasks/${taskId}/depart`, B, { expectedRevision: 1 })).status,
    404,
  );
  assert.equal(
    (await call('POST', `/tasks/${taskId}/depart`, 'reader-token-0000001', { expectedRevision: 1 }))
      .status,
    403,
  );
  assert.equal(
    (await call('POST', `/tasks/${taskId}/depart`, 'ops-token-0000000001', { expectedRevision: 1 }))
      .status,
    403,
  );
  assert.equal((await call('GET', '/me/jobs', null)).status, 401);
  const missingKey = await call(
    'POST',
    `/tasks/${taskId}/depart`,
    A,
    { expectedRevision: 1 },
    false,
  );
  assert.equal(missingKey.status, 428);
  for (const body of [{}, { expectedRevision: '1' }, { expectedRevision: 1, extra: true }, []]) {
    assert.equal(
      (await call('POST', `/tasks/${taskId}/depart`, A, body)).status,
      400,
      JSON.stringify(body),
    );
  }
  assert.equal(
    (await call('POST', `/tasks/not-a-uuid/depart`, A, { expectedRevision: 1 })).status,
    400,
  );
  const stale = await call('POST', `/tasks/${taskId}/depart`, A, { expectedRevision: 9 });
  assert.equal(stale.status, 412);
  const wrongStage = await call('POST', `/tasks/${taskId}/arrive`, A, { expectedRevision: 1 });
  assert.deepEqual([wrongStage.status, wrongStage.body.error?.reason], [409, 'TASK_STAGE_INVALID']);
  const badPhase = await call('PUT', `/tasks/${taskId}/evidence/DURING/0`, A, {
    expectedRevision: 1,
    mediaObjectId: photo(),
  });
  assert.equal(badPhase.status, 400);
  const badMoney = await call('POST', `/tasks/${taskId}/close`, A, {
    expectedRevision: 1,
    collection: {
      outcome: 'CASH_COLLECTED',
      amount: { currency: 'SYP', amountMinor: 15000.5, scale: 2 },
    },
  });
  assert.equal(badMoney.status, 400);
});

test('evidence rules and Media outage over HTTP: 422 unusable, 503 unavailable, nothing written', async () => {
  const { taskId } = await acceptedTask();
  await call('POST', `/tasks/${taskId}/depart`, A, { expectedRevision: 1 });
  await call('POST', `/tasks/${taskId}/arrive`, A, { expectedRevision: 2 });
  const foreign = await call('PUT', `/tasks/${taskId}/evidence/BEFORE/0`, A, {
    expectedRevision: 3,
    mediaObjectId: photo(TECH_B),
  });
  assert.deepEqual([foreign.status, foreign.body.error?.reason], [422, 'EVIDENCE_INVALID']);
  const notReady = await call('PUT', `/tasks/${taskId}/evidence/BEFORE/0`, A, {
    expectedRevision: 3,
    mediaObjectId: photo(TECH_A, { status: 'RESERVED' }),
  });
  assert.equal(notReady.status, 422);
  const start = await call('POST', `/tasks/${taskId}/start`, A, { expectedRevision: 3 });
  assert.deepEqual([start.status, start.body.error?.reason], [422, 'EVIDENCE_REQUIRED']);
  media.mode = 'down';
  try {
    const down = await call('PUT', `/tasks/${taskId}/evidence/BEFORE/0`, A, {
      expectedRevision: 3,
      mediaObjectId: photo(),
    });
    assert.deepEqual([down.status, down.body.error?.reason], [503, 'EVIDENCE_UNAVAILABLE']);
    assert.ok(
      Number(
        down.body.error && (down.body.error as unknown as { retryAfterMs: number }).retryAfterMs,
      ) > 0,
    );
  } finally {
    media.mode = 'ok';
  }
  const view = await call('GET', `/me/tasks/${taskId}`, A);
  assert.equal(view.body.revision, 3);
});

test('Workforce outage or malformed answer refuses acceptance with 503 and leaves the offer live', async () => {
  const { assignment } = await openJob(seed, clock);
  const resourceId = randomUUID();
  RESOURCES.set(resourceId, { eligibility: 'ELIGIBLE', eligibilityRevision: 1 });
  const offer = await call('POST', `/assignments/${assignment.id}/offers`, 'ops-token-0000000001', {
    expectedRevision: assignment.version,
    resourceId,
    technicianSubjectId: TECH_A,
  });
  const offerId = (offer.body.offer as { offerId: string }).offerId;
  for (const mode of ['down', 'malformed'] as const) {
    workforce.mode = mode;
    try {
      const refused = await call('POST', `/offers/${offerId}/accept`, A, {});
      assert.deepEqual(
        [refused.status, refused.body.error?.reason],
        [503, 'ELIGIBILITY_UNAVAILABLE'],
        mode,
      );
    } finally {
      workforce.mode = 'ok';
    }
  }
  const jobs = await call('GET', '/me/jobs', A);
  assert.ok((jobs.body.offers as Array<{ offerId: string }>).some((o) => o.offerId === offerId));
  RESOURCES.set(resourceId, { eligibility: 'INELIGIBLE', eligibilityRevision: 2 });
  const ineligible = await call('POST', `/offers/${offerId}/accept`, A, {});
  assert.deepEqual(
    [ineligible.status, ineligible.body.error?.reason],
    [422, 'RESOURCE_INELIGIBLE'],
  );
  const ops = await call('GET', `/assignments/${assignment.id}`, 'ops-token-0000000001');
  assert.equal(ops.body.status, 'UNASSIGNED');
});

test('decline with a note, release and help notes over HTTP', async () => {
  const { assignment } = await openJob(seed, clock);
  const resourceId = randomUUID();
  RESOURCES.set(resourceId, { eligibility: 'ELIGIBLE', eligibilityRevision: 1 });
  const offer = await call('POST', `/assignments/${assignment.id}/offers`, 'ops-token-0000000001', {
    expectedRevision: assignment.version,
    resourceId,
    technicianSubjectId: TECH_A,
  });
  const offerId = (offer.body.offer as { offerId: string }).offerId;
  assert.equal(
    (await call('POST', `/offers/${offerId}/decline`, A, { reason: 'OTHER', note: 'x' })).status,
    400,
  );
  const declined = await call('POST', `/offers/${offerId}/decline`, A, {
    reason: 'OTHER',
    note: 'السيارة بعيدة جدًا',
  });
  assert.equal(declined.status, 200);
  assert.equal(declined.body.status, 'DECLINED');
  const { taskId } = await acceptedTask();
  const help = await call('POST', `/tasks/${taskId}/notes`, A, {
    kind: 'HELP',
    text: 'لا أجد المدخل',
  });
  assert.equal(help.status, 200);
  assert.equal((help.body.notes as unknown[]).length, 1);
  const released = await call('POST', `/tasks/${taskId}/release`, A, {
    expectedRevision: 1,
    reason: 'ظرف طارئ',
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.stage, 'RELEASED');
  const afterRelease = await call('POST', `/tasks/${taskId}/depart`, A, { expectedRevision: 2 });
  assert.deepEqual([afterRelease.status, afterRelease.body.error?.reason], [409, 'TASK_CLOSED']);
});
