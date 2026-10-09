import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { CapacityResource } from '../../src/domain';
import {
  CAPACITY_READER,
  DAY,
  HOUR,
  OPS,
  REVIEWER,
  TestClock,
  eligibilityEvents,
  errorCode,
  key,
  meta,
  replica,
  seedOperator,
  shift,
  sqlState,
  technician,
  verify,
  type Replica,
} from './support';

/**
 * Published listCapacityResources and eligibility revision on the real lane
 * PostgreSQL 16 with the RUNTIME role. Two replicas (two pools) are used so
 * reads never see a writer's uncommitted state by accident of a shared pool.
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

/** A future working day: window 08:00–16:00 relative to "tomorrow". */
function day(offsetDays = 1) {
  const base = new Date(Math.floor(clock.now().getTime() / DAY) * DAY + offsetDays * DAY);
  return {
    base,
    at: (hours: number) => new Date(base.getTime() + hours * HOUR),
    from: new Date(base.getTime() + 8 * HOUR),
    to: new Date(base.getTime() + 16 * HOUR),
  };
}

async function list(
  r: Replica,
  zoneId: string,
  from: Date,
  to: Date,
  extra: { limit?: string; cursor?: string } = {},
) {
  return r.service.listCapacityResources(meta(CAPACITY_READER), {
    zoneId,
    from: from.toISOString(),
    to: to.toISOString(),
    ...extra,
  });
}

async function all(r: Replica, zoneId: string, from: Date, to: Date, limit: string) {
  const items: CapacityResource[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await list(r, zoneId, from, to, {
      limit,
      ...(cursor === null ? {} : { cursor }),
    });
    items.push(...page.items);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor !== null && pages < 50);
  return { items, pages };
}

async function one(r: Replica, zoneId: string, from: Date, to: Date, operatorId: string) {
  const { items } = await all(r, zoneId, from, to, '100');
  const found = items.find((item) => item.resourceId === operatorId);
  assert.ok(found, `resource ${operatorId} listed`);
  return found;
}

test('paging: keyset pages are complete, ordered, duplicate-free and stable under inserts', async () => {
  const zone = randomUUID();
  const d = day(2);
  const seeded = [];
  for (let i = 0; i < 7; i += 1) {
    seeded.push(await seedOperator(a, clock, { shifts: [shift(zone, d.at(7), 10)] }));
  }
  const expected = seeded.map((s) => s.operatorId).sort();

  const unpaged = await list(a, zone, d.from, d.to, { limit: '100' });
  assert.deepEqual(
    unpaged.items.map((item) => item.resourceId),
    expected,
  );
  assert.equal(unpaged.nextCursor, null);

  // Page 1 (limit 3), then concurrent inserts, then the rest of the pages.
  const first = await list(b, zone, d.from, d.to, { limit: '3' });
  assert.equal(first.items.length, 3);
  assert.ok(first.nextCursor);
  const late = [];
  for (let i = 0; i < 4; i += 1) {
    late.push(await seedOperator(a, clock, { shifts: [shift(zone, d.at(9), 2)] }));
  }
  const seen = first.items.map((item) => item.resourceId);
  let cursor: string | null = first.nextCursor;
  while (cursor !== null) {
    const page = await list(b, zone, d.from, d.to, { limit: '3', cursor });
    seen.push(...page.items.map((item) => item.resourceId));
    cursor = page.nextCursor;
  }
  assert.equal(new Set(seen).size, seen.length, 'no duplicates');
  assert.deepEqual([...seen].sort(), seen, 'ascending resource id order');
  for (const id of expected) assert.ok(seen.includes(id), 'no pre-existing resource skipped');
  const boundary = first.items[first.items.length - 1]?.resourceId ?? '';
  for (const added of late) {
    assert.equal(
      seen.includes(added.operatorId),
      added.operatorId > boundary,
      'a resource added during paging appears iff it sorts after the cursor',
    );
  }

  // The same cursor replayed returns the same page (cursor is a position, not a snapshot).
  const again = await list(b, zone, d.from, d.to, {
    limit: '3',
    cursor: first.nextCursor ?? '',
  });
  const replay = await list(a, zone, d.from, d.to, {
    limit: '3',
    cursor: first.nextCursor ?? '',
  });
  assert.deepEqual(
    again.items.map((item) => item.resourceId),
    replay.items.map((item) => item.resourceId),
  );

  // A cursor is bound to its query.
  assert.equal(
    await errorCode(list(a, randomUUID(), d.from, d.to, { cursor: first.nextCursor ?? '' })),
    'INVALID_CURSOR',
  );
  assert.equal(
    await errorCode(list(a, zone, d.from, d.at(17), { cursor: first.nextCursor ?? '' })),
    'INVALID_CURSOR',
  );
});

test('filtering: zone and half-open window, ACTIVE shifts only, zones and shifts per resource', async () => {
  const zone = randomUUID();
  const other = randomUUID();
  const d = day(3);
  const inZone = await seedOperator(a, clock, { shifts: [shift(zone, d.at(10), 2)] });
  const otherZoneOnly = await seedOperator(a, clock, { shifts: [shift(other, d.at(10), 2)] });
  const endsAtFrom = await seedOperator(a, clock, { shifts: [shift(zone, d.at(4), 4)] });
  const startsAtTo = await seedOperator(a, clock, { shifts: [shift(zone, d.at(16), 4)] });
  const cancelled = await seedOperator(a, clock, { shifts: [shift(zone, d.at(9), 2)] });
  const twoZones = await seedOperator(a, clock, {
    shifts: [shift(other, d.at(12), 2), shift(zone, d.at(8), 2), shift(zone, d.at(20), 2)],
  });
  const shiftsOfCancelled = await a.store.listShifts(cancelled.operatorId, d.base, d.at(24));
  const target = shiftsOfCancelled[0];
  assert.ok(target);
  await a.service.cancelShift(meta(technician(cancelled.subject)), target.id);

  const { items } = await all(a, zone, d.from, d.to, '100');
  const ids = items.map((item) => item.resourceId);
  assert.ok(ids.includes(inZone.operatorId));
  assert.ok(ids.includes(twoZones.operatorId));
  for (const absent of [otherZoneOnly, endsAtFrom, startsAtTo, cancelled]) {
    assert.ok(!ids.includes(absent.operatorId), 'excluded resource');
  }
  assert.equal(items.length, 2);

  const multi = items.find((item) => item.resourceId === twoZones.operatorId);
  assert.ok(multi);
  assert.deepEqual([...multi.zoneIds], [zone, other].sort());
  assert.deepEqual(
    multi.shifts.map((s) => [s.startsAt.toISOString(), s.endsAt.toISOString()]),
    [
      [d.at(8).toISOString(), d.at(10).toISOString()],
      [d.at(12).toISOString(), d.at(14).toISOString()],
    ],
    'only shifts overlapping the window, sorted, with their real bounds',
  );

  // Querying the other zone lists both resources that work there in the window.
  const otherIds = (await all(a, other, d.from, d.to, '100')).items.map((i) => i.resourceId);
  assert.deepEqual(otherIds.sort(), [otherZoneOnly.operatorId, twoZones.operatorId].sort());
});

test('eligibility and its revision follow every input change; events match, profile edits do not', async () => {
  const zone = randomUUID();
  const d = day(4);
  const seeded = await seedOperator(a, clock, { shifts: [shift(zone, d.at(8), 8)] });
  const id = seeded.operatorId;
  const look = () => one(b, zone, d.from, d.to, id);

  const initial = await look();
  assert.equal(initial.eligibility, 'ELIGIBLE');
  let revision = initial.eligibilityRevision;
  let events = await eligibilityEvents(a, id);
  assert.equal(events.length, revision - 1, 'one event per revision after creation');

  const steps: Array<[string, () => Promise<unknown>, 'ELIGIBLE' | 'INELIGIBLE']> = [
    [
      'suspend',
      () => a.service.setOperatorState(meta(OPS), id, { suspensionReason: 'SAFETY' }),
      'INELIGIBLE',
    ],
    [
      'unsuspend',
      () => a.service.setOperatorState(meta(OPS), id, { suspensionReason: null }),
      'ELIGIBLE',
    ],
    [
      'deactivate',
      () => a.service.setOperatorState(meta(OPS), id, { employmentStatus: 'INACTIVE' }),
      'INELIGIBLE',
    ],
    [
      'reactivate',
      () => a.service.setOperatorState(meta(OPS), id, { employmentStatus: 'ACTIVE' }),
      'ELIGIBLE',
    ],
    ['revoke skill', () => a.service.revokeSkill(meta(OPS), id, 'exterior-wash'), 'INELIGIBLE'],
    ['grant skill', () => a.service.grantSkill(meta(OPS), id, 'interior-clean'), 'ELIGIBLE'],
    [
      'resubmit verification',
      () => a.service.submitVerification(meta(technician(seeded.subject)), [randomUUID()], key()),
      'INELIGIBLE',
    ],
  ];
  for (const [label, change, expected] of steps) {
    await change();
    const now = await look();
    assert.equal(now.eligibility, expected, label);
    assert.equal(now.eligibilityRevision, revision + 1, `${label}: revision +1`);
    revision = now.eligibilityRevision;
    events = await eligibilityEvents(a, id);
    const last = events[events.length - 1];
    assert.ok(last, label);
    assert.equal(last.event.aggregate.version, revision, `${label}: event at the new revision`);
    assert.equal(last.event.data.eligibility, expected, `${label}: event state`);
  }
  // Approving the pending case (verification status + validity) is one more input change.
  const pending = await a.prisma.client.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM app.verification_case WHERE pending_operator_id = $1::uuid`,
    id,
  );
  const caseId = pending[0]?.id;
  assert.ok(caseId);
  await a.service.reviewVerification(meta(REVIEWER), caseId, {
    decision: 'APPROVE',
    validUntil: new Date(clock.now().getTime() + 30 * DAY),
  });
  const approved = await look();
  assert.equal(approved.eligibility, 'ELIGIBLE');
  assert.equal(approved.eligibilityRevision, revision + 1);
  revision = approved.eligibilityRevision;

  // No-op and profile edits: version moves (or not), eligibility revision never.
  await a.service.setOperatorState(meta(OPS), id, { suspensionReason: null });
  await a.service.updateMe(meta(technician(seeded.subject)), { displayName: 'Renamed Operator' });
  const renamed = await look();
  assert.equal(renamed.eligibilityRevision, revision);
  assert.equal(renamed.revision, approved.revision + 1, 'profile edit bumps the resource revision');
  events = await eligibilityEvents(a, id);
  assert.deepEqual(
    events.map((e) => e.event.aggregate.version),
    Array.from({ length: revision - 1 }, (_, i) => i + 2),
    'exactly one event per revision 2..n, nothing for no-ops or profile edits',
  );
  for (const { row, event } of events) {
    assert.equal(row.exchange, 'workforce.events');
    assert.equal(row.routing_key, 'workforce.eligibility-changed.v1');
    assert.equal(event.aggregate.type, 'capacity-resource');
    assert.deepEqual(Object.keys(event.data), ['eligibility']);
    // The envelope actor is the acting account (opaque Identity subject); data never is.
    assert.ok(['account', 'service', 'system'].includes(event.actor.kind));
    assert.ok(!JSON.stringify(event.data).includes(seeded.subject), 'no subject in data');
    assert.ok(!row.payload.includes('Operator'), 'no display name in the event');
  }
});

test('eligibility is evaluated at the query `from`: verification expiring before it is INELIGIBLE', async () => {
  const zone = randomUUID();
  const d = day(1);
  // Verified until 10:00 of the shift day.
  const until = d.at(10).getTime() - clock.now().getTime();
  const seeded = await seedOperator(a, clock, {
    verifiedForMs: until,
    shifts: [shift(zone, d.at(8), 8)],
  });
  const early = await one(a, zone, d.at(8), d.at(9), seeded.operatorId);
  const late = await one(a, zone, d.at(10), d.at(11), seeded.operatorId);
  assert.equal(early.eligibility, 'ELIGIBLE');
  assert.equal(late.eligibility, 'INELIGIBLE');
  assert.equal(early.eligibilityRevision, late.eligibilityRevision, 'time is not an input change');
  // Re-verification restores eligibility for the later window and is an input change.
  await verify(a, clock, seeded.subject);
  const renewed = await one(a, zone, d.at(10), d.at(11), seeded.operatorId);
  assert.equal(renewed.eligibility, 'ELIGIBLE');
  assert.equal(renewed.eligibilityRevision, late.eligibilityRevision + 2, 'submit + approve');
});

test('concurrent input changes from two replicas serialise: revisions and events stay gap-free', async () => {
  const zone = randomUUID();
  const d = day(5);
  const seeded = await seedOperator(a, clock, { shifts: [shift(zone, d.at(8), 8)] });
  const before = await one(a, zone, d.from, d.to, seeded.operatorId);
  const skills = Array.from({ length: 8 }, (_, i) => `skill-${i}`);
  const results = await Promise.allSettled(
    skills.map((skill, i) =>
      (i % 2 === 0 ? a : b).service.grantSkill(meta(OPS), seeded.operatorId, skill),
    ),
  );
  assert.ok(
    results.every((r) => r.status === 'fulfilled'),
    JSON.stringify(results).slice(0, 300),
  );
  const afterAll = await one(b, zone, d.from, d.to, seeded.operatorId);
  assert.equal(afterAll.eligibilityRevision, before.eligibilityRevision + skills.length);
  const versions = (await eligibilityEvents(a, seeded.operatorId)).map(
    (e) => e.event.aggregate.version,
  );
  assert.deepEqual(
    versions,
    Array.from({ length: versions.length }, (_, i) => i + 2),
  );
});

test('the database rejects invariant breaks even from the runtime role directly', async () => {
  const seeded = await seedOperator(a, clock);
  const run = (sql: string, ...params: unknown[]) =>
    sqlState(a.prisma.client.$executeRawUnsafe(sql, ...params));
  assert.equal(
    await run(
      `UPDATE app.operator SET eligibility_revision = version + 1 WHERE id = $1::uuid`,
      seeded.operatorId,
    ),
    '23514',
    'eligibility revision cannot overtake the version',
  );
  assert.equal(
    await run(
      `UPDATE app.operator SET eligibility_revision = 0 WHERE id = $1::uuid`,
      seeded.operatorId,
    ),
    '23514',
  );
  assert.equal(
    await run(
      `INSERT INTO app.operator_availability (operator_id, status, version, updated_at)
       VALUES ($1::uuid, 'BUSY', 1, now())`,
      seeded.operatorId,
    ),
    '23514',
  );
  assert.equal(
    await run(
      `INSERT INTO app.operator_availability (operator_id, status, version, updated_at)
       VALUES ($1::uuid, 'AVAILABLE', 0, now())`,
      seeded.operatorId,
    ),
    '23514',
  );
  assert.equal(
    await run(
      `INSERT INTO app.operator_availability (operator_id, status, version, updated_at)
       VALUES ($1::uuid, 'AVAILABLE', 1, now())`,
      randomUUID(),
    ),
    '23503',
  );
  assert.equal(await run(`CREATE TABLE app.sneaky (id int)`), '42501');
  assert.equal(await run(`ALTER TABLE app.operator DROP COLUMN eligibility_revision`), '42501');
  assert.equal(await run(`SELECT 1 FROM app._prisma_migrations`), '42501');
});
