import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  TestClock,
  errorCode,
  meta,
  replica,
  seedOperator,
  technician,
  type Replica,
} from './support';

/**
 * Technician availability on the real lane PostgreSQL 16, RUNTIME role, two
 * replicas (two pools) racing on the same operator.
 */
const clock = new TestClock();
let a: Replica;
let b: Replica;

before(() => {
  a = replica(clock);
  b = replica(clock);
});

after(async () => {
  await a.prisma.client.$disconnect();
  await b.prisma.client.$disconnect();
});

async function auditCount(r: Replica, operatorId: string): Promise<number> {
  const rows = await r.prisma.client.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM app.audit_entry
      WHERE action = 'AVAILABILITY_CHANGED' AND target_id = $1::uuid`,
    operatorId,
  );
  return rows[0]?.n ?? -1;
}

async function race(
  subject: string,
  status: 'AVAILABLE' | 'ON_BREAK',
  expectedRevision: number,
  n: number,
) {
  return Promise.allSettled(
    Array.from({ length: n }, (_, i) =>
      (i % 2 === 0 ? a : b).service.setAvailability(meta(technician(subject)), {
        status,
        expectedRevision,
      }),
    ),
  );
}

function codes(results: PromiseSettledResult<unknown>[]): string[] {
  return results.map((r) => {
    if (r.status === 'fulfilled') return 'OK';
    const reason: unknown = r.reason;
    const code: unknown =
      typeof reason === 'object' && reason !== null ? Reflect.get(reason, 'code') : undefined;
    return typeof code === 'string' ? code : String(reason);
  });
}

test('never set: ON_BREAK at revision 0, no row', async () => {
  const seeded = await seedOperator(a, clock);
  const view = await a.service.availability(meta(technician(seeded.subject)));
  assert.deepEqual(view, {
    operatorId: seeded.operatorId,
    status: 'ON_BREAK',
    revision: 0,
    updatedAt: null,
  });
  const rows = await a.prisma.client.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM app.operator_availability WHERE operator_id = $1::uuid`,
    seeded.operatorId,
  );
  assert.equal(rows.length, 0);
});

test('race: concurrent first PUTs with expectedRevision 0 — exactly one wins', async () => {
  const seeded = await seedOperator(a, clock);
  const results = await race(seeded.subject, 'AVAILABLE', 0, 10);
  const outcome = codes(results);
  assert.equal(outcome.filter((c) => c === 'OK').length, 1, outcome.join(','));
  assert.equal(outcome.filter((c) => c === 'REVISION_CONFLICT').length, 9, outcome.join(','));
  const view = await b.service.availability(meta(technician(seeded.subject)));
  assert.equal(view.status, 'AVAILABLE');
  assert.equal(view.revision, 1);
  assert.equal(await auditCount(a, seeded.operatorId), 1, 'one audit row per committed change');
});

test('race: concurrent updates at revision n — exactly one wins, revision n+1', async () => {
  const seeded = await seedOperator(a, clock);
  const me = meta(technician(seeded.subject));
  await a.service.setAvailability(me, { status: 'AVAILABLE', expectedRevision: 0 });
  await a.service.setAvailability(me, { status: 'ON_BREAK', expectedRevision: 1 });
  const results = await race(seeded.subject, 'AVAILABLE', 2, 10);
  const outcome = codes(results);
  assert.equal(outcome.filter((c) => c === 'OK').length, 1, outcome.join(','));
  assert.equal(outcome.filter((c) => c === 'REVISION_CONFLICT').length, 9, outcome.join(','));
  const view = await a.service.availability(me);
  assert.equal(view.revision, 3);
  assert.equal(view.status, 'AVAILABLE');
  assert.equal(await auditCount(a, seeded.operatorId), 3);
});

test('stale revision conflicts, same status is a no-op, and nothing else moves', async () => {
  const seeded = await seedOperator(a, clock);
  const me = meta(technician(seeded.subject));
  const operatorBefore = await a.store.findOperator(seeded.operatorId);
  const eventsBefore = await eventCount(seeded.operatorId);
  const set = await a.service.setAvailability(me, { status: 'AVAILABLE', expectedRevision: 0 });
  assert.equal(set.revision, 1);
  assert.equal(
    await errorCode(a.service.setAvailability(me, { status: 'ON_BREAK', expectedRevision: 0 })),
    'REVISION_CONFLICT',
  );
  const same = await b.service.setAvailability(me, { status: 'AVAILABLE', expectedRevision: 1 });
  assert.equal(same.revision, 1);
  assert.equal(same.updatedAt?.toISOString(), set.updatedAt?.toISOString());
  assert.equal(await auditCount(a, seeded.operatorId), 1, 'a no-op is not audited');
  const operatorAfter = await a.store.findOperator(seeded.operatorId);
  assert.deepEqual(
    operatorAfter,
    operatorBefore,
    'operator version and eligibility revision unchanged',
  );
  assert.equal(await eventCount(seeded.operatorId), eventsBefore, 'availability writes no event');
});

async function eventCount(operatorId: string): Promise<number> {
  const rows = await a.prisma.client.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM app.outbox_message
      WHERE (payload::jsonb -> 'aggregate' ->> 'id') = $1
         OR (payload::jsonb -> 'data' ->> 'operatorId') = $1`,
    operatorId,
  );
  return rows[0]?.n ?? -1;
}

test('unknown subject: OPERATOR_NOT_FOUND for GET and PUT, nothing written', async () => {
  const stranger = randomUUID();
  assert.equal(
    await errorCode(a.service.availability(meta(technician(stranger)))),
    'OPERATOR_NOT_FOUND',
  );
  assert.equal(
    await errorCode(
      a.service.setAvailability(meta(technician(stranger)), {
        status: 'AVAILABLE',
        expectedRevision: 0,
      }),
    ),
    'OPERATOR_NOT_FOUND',
  );
});

test('isolation: each technician reads and writes only their own availability', async () => {
  const one = await seedOperator(a, clock);
  const two = await seedOperator(a, clock);
  await a.service.setAvailability(meta(technician(one.subject)), {
    status: 'AVAILABLE',
    expectedRevision: 0,
  });
  const twoView = await b.service.availability(meta(technician(two.subject)));
  assert.equal(twoView.status, 'ON_BREAK');
  assert.equal(twoView.revision, 0);
  const oneView = await b.service.availability(meta(technician(one.subject)));
  assert.equal(oneView.status, 'AVAILABLE');
});
