import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { formatLocalDate, localToday } from '../../src/domain';
import {
  DAY,
  HOUR,
  OPS,
  CAPACITY_READER,
  TestClock,
  allowZones,
  eligibilityEvents,
  errorCode,
  key,
  meta,
  replica,
  seedOperator,
  shift,
  sqlState,
  technician,
  type Replica,
} from './support';

/**
 * P05-C1 on the real lane PostgreSQL with the RUNTIME role: service area,
 * weekly schedule application, availability exceptions, equipment and the
 * resulting eligibility revisions/events. Races use two "replicas" (separate
 * connection pools), like two service processes.
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

const tomorrow = () => new Date(Math.floor(clock.now().getTime() / DAY) * DAY + 2 * DAY);

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const [row] = await a.prisma.client.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM ${sql}`,
    ...values,
  );
  return row?.n ?? -1;
}

test('service area: shifts outside are refused; first writes race to exactly one winner', async () => {
  const seeded = await seedOperator(a, clock);
  const zone = randomUUID();
  const outside = shift(zone, new Date(tomorrow().getTime() + 8 * HOUR), 2);
  assert.equal(
    await errorCode(
      a.service.createShift(meta(technician(seeded.subject)), seeded.operatorId, outside, key()),
    ),
    'ZONE_OUTSIDE_SERVICE_AREA',
  );
  const results = await Promise.allSettled([
    a.profiles.setServiceArea(meta(OPS), seeded.operatorId, {
      zoneIds: [zone],
      expectedRevision: 0,
    }),
    b.profiles.setServiceArea(meta(OPS), seeded.operatorId, {
      zoneIds: [randomUUID()],
      expectedRevision: 0,
    }),
  ]);
  assert.equal(
    results.filter((r) => r.status === 'fulfilled').length,
    1,
    'exactly one first write',
  );
  const loser = results.find((r) => r.status === 'rejected');
  assert.equal(
    loser?.status === 'rejected' ? (loser.reason as { code?: string }).code : 'none',
    'REVISION_CONFLICT',
  );
  const area = await a.store.findServiceArea(seeded.operatorId);
  assert.equal(area?.revision, 1);
  assert.equal(
    await count('app.operator_service_zone WHERE operator_id=$1::uuid', seeded.operatorId),
    1,
  );
  await allowZones(a, seeded.operatorId, [zone]);
  const created = await a.service.createShift(
    meta(technician(seeded.subject)),
    seeded.operatorId,
    outside,
    key(),
  );
  assert.equal(created.zoneId, zone);
  // Technicians cannot move their own home zone (it anchors the area).
  assert.equal(
    await errorCode(
      a.service.updateMe(meta(technician(seeded.subject)), { homeZoneId: randomUUID() }),
    ),
    'FORBIDDEN',
  );
  // Only operations configure the area.
  assert.equal(
    await errorCode(
      a.profiles.setServiceArea(meta(technician(seeded.subject)), seeded.operatorId, {
        zoneIds: [],
        expectedRevision: 1,
      }),
    ),
    'FORBIDDEN',
  );
});

test('weekly schedule: apply creates exact UTC shifts once; replays, exceptions and races never duplicate', async () => {
  const seeded = await seedOperator(a, clock);
  const zone = randomUUID();
  await allowZones(a, seeded.operatorId, [zone]);
  const tech = technician(seeded.subject);
  const allDays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    startMinute: 8 * 60,
    endMinute: 12 * 60,
    zoneId: zone,
  }));
  // A window outside the area is refused at declaration time.
  assert.equal(
    await errorCode(
      a.profiles.setSchedule(meta(tech), {
        timeZone: 'Asia/Damascus',
        expectedRevision: 0,
        windows: [{ weekday: 1, startMinute: 480, endMinute: 600, zoneId: randomUUID() }],
      }),
    ),
    'ZONE_OUTSIDE_SERVICE_AREA',
  );
  const schedule = await a.profiles.setSchedule(meta(tech), {
    timeZone: 'Asia/Damascus',
    expectedRevision: 0,
    windows: allDays,
  });
  assert.equal(schedule.revision, 1);
  assert.equal(
    await errorCode(
      b.profiles.setSchedule(meta(tech), { timeZone: 'UTC', expectedRevision: 0, windows: [] }),
    ),
    'REVISION_CONFLICT',
  );

  // Local "tomorrow" in Damascus; block its second day with an exception.
  const today = localToday('Asia/Damascus', clock.now());
  const start = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const startDate = formatLocalDate({
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
    day: start.getUTCDate(),
  });
  const secondDay8 = new Date(start.getTime() + DAY + 5 * HOUR); // 08:00 +03:00
  await a.profiles.createMyException(
    meta(tech),
    {
      startsAt: secondDay8.toISOString(),
      endsAt: new Date(secondDay8.getTime() + 4 * HOUR).toISOString(),
      reason: 'LEAVE',
    },
    key(),
  );

  const body = { startDate, expectedRevision: 1 };
  const [first, second] = await Promise.all([
    a.profiles.applySchedule(meta(tech), body),
    b.profiles.applySchedule(meta(tech), body),
  ]);
  const created = first.created.length + second.created.length;
  assert.equal(created, 6, 'seven days minus the exception day, created exactly once');
  assert.equal(first.existing.length + second.existing.length, 6, 'the other apply saw replays');
  for (const result of [first, second]) {
    assert.deepEqual(
      result.skipped.map((s) => s.reason),
      ['EXCEPTION'],
    );
  }
  const shifts = [...first.created, ...second.created].sort(
    (x, y) => x.startsAt.getTime() - y.startsAt.getTime(),
  );
  assert.equal(
    shifts[0]?.startsAt.toISOString(),
    new Date(start.getTime() + 5 * HOUR).toISOString(),
  );
  assert.equal(shifts[0]?.endsAt.toISOString(), new Date(start.getTime() + 9 * HOUR).toISOString());
  assert.equal(
    await count(
      `app.work_shift WHERE operator_id=$1::uuid AND status='ACTIVE' AND idempotency_key LIKE 'wk:%'`,
      seeded.operatorId,
    ),
    6,
  );
  const replay = await a.profiles.applySchedule(meta(tech), body);
  assert.equal(replay.created.length, 0);
  assert.equal(replay.existing.length, 6);
  // A stale revision is refused before anything is written.
  assert.equal(
    await errorCode(a.profiles.applySchedule(meta(tech), { startDate, expectedRevision: 2 })),
    'REVISION_CONFLICT',
  );
});

test('exceptions: database exclusion holds under a race; capacity and eligibility skip the period', async () => {
  const zone = randomUUID();
  const day = tomorrow();
  const seeded = await seedOperator(a, clock, {
    shifts: [shift(zone, new Date(day.getTime() + 6 * HOUR), 8)],
  });
  const tech = technician(seeded.subject);
  const leave = {
    startsAt: new Date(day.getTime() + 8 * HOUR).toISOString(),
    endsAt: new Date(day.getTime() + 10 * HOUR).toISOString(),
    reason: 'SICKNESS',
  };
  const overlapping = {
    ...leave,
    startsAt: new Date(day.getTime() + 9 * HOUR).toISOString(),
    endsAt: new Date(day.getTime() + 11 * HOUR).toISOString(),
  };
  const raced = await Promise.allSettled([
    a.profiles.createMyException(meta(tech), leave, key()),
    b.profiles.createOperatorException(meta(OPS), seeded.operatorId, overlapping, key()),
  ]);
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = raced.find((r) => r.status === 'rejected');
  assert.equal(
    rejected?.status === 'rejected' ? (rejected.reason as { code?: string }).code : 'none',
    'EXCEPTION_OVERLAPS',
  );
  assert.equal(
    await count(
      `app.availability_exception WHERE operator_id=$1::uuid AND status='ACTIVE'`,
      seeded.operatorId,
    ),
    1,
  );
  const winner = raced.find((r) => r.status === 'fulfilled');
  assert.ok(winner?.status === 'fulfilled');
  const exception = winner.value;

  // Idempotent replay and key reuse.
  const k = key();
  const later = {
    startsAt: new Date(day.getTime() + 20 * HOUR).toISOString(),
    endsAt: new Date(day.getTime() + 21 * HOUR).toISOString(),
    reason: 'PERSONAL',
  };
  const once = await a.profiles.createMyException(meta(tech), later, k);
  const twice = await b.profiles.createMyException(meta(tech), later, k);
  assert.equal(twice.id, once.id);
  assert.equal(
    await errorCode(a.profiles.createMyException(meta(tech), { ...later, reason: 'OTHER' }, k)),
    'IDEMPOTENCY_KEY_REUSED',
  );

  // Capacity: the shift is published minus the exception.
  const page = await a.service.listCapacityResources(meta(CAPACITY_READER), {
    zoneId: zone,
    from: new Date(day.getTime() + 6 * HOUR).toISOString(),
    to: new Date(day.getTime() + 14 * HOUR).toISOString(),
  });
  const mine = page.items.find((item) => item.resourceId === seeded.operatorId);
  assert.ok(mine, 'resource listed');
  assert.ok(mine.shifts.length === 2, 'the shift is split around the exception');
  for (const piece of mine.shifts) {
    assert.ok(
      piece.endsAt.getTime() <= exception.startsAt.getTime() ||
        piece.startsAt.getTime() >= exception.endsAt.getTime(),
      'no published piece intersects the exception',
    );
  }
  const inside = new Date(exception.startsAt.getTime() + 30 * 60_000);
  const eligible = await a.service.eligible(
    meta({ kind: 'SERVICE', clientId: 'booking', scopes: ['workforce.eligibility.read'] }),
    { zoneId: zone, at: inside },
  );
  assert.equal(
    eligible.some((e) => e.operatorId === seeded.operatorId),
    false,
    'not offered inside an exception',
  );

  // Another technician cannot see or cancel it; the owner cancels once.
  assert.equal(
    await errorCode(a.profiles.cancelException(meta(technician(randomUUID())), exception.id)),
    'EXCEPTION_NOT_FOUND',
  );
  const cancelled = await a.profiles.cancelException(meta(OPS), exception.id);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(
    await errorCode(b.profiles.cancelException(meta(tech), exception.id)),
    'EXCEPTION_NOT_ACTIVE',
  );
  const restored = await a.service.listCapacityResources(meta(CAPACITY_READER), {
    zoneId: zone,
    from: new Date(day.getTime() + 6 * HOUR).toISOString(),
    to: new Date(day.getTime() + 14 * HOUR).toISOString(),
  });
  assert.equal(restored.items.find((i) => i.resourceId === seeded.operatorId)?.shifts.length, 1);

  // Constraint evidence: the runtime role cannot insert an inverted or overlong period.
  assert.equal(
    await sqlState(
      a.prisma.client.$executeRawUnsafe(
        `INSERT INTO app.availability_exception (id, operator_id, starts_at, ends_at, reason,
           requester, idempotency_key, request_fingerprint, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, now() + interval '2 day', now() + interval '1 day', 'LEAVE',
           'it', $3, repeat('0',64), now(), now())`,
        randomUUID(),
        seeded.operatorId,
        key(),
      ),
    ),
    '23514',
  );
});

test('equipment: a REQUIRED item going UNAVAILABLE moves eligibility and publishes it, in one transaction', async () => {
  const seeded = await seedOperator(a, clock);
  const tech = technician(seeded.subject);
  const before = await a.store.findOperator(seeded.operatorId);
  assert.ok(before);
  const van = await a.profiles.registerEquipment(meta(OPS), seeded.operatorId, {
    kind: 'SERVICE_VEHICLE',
    required: true,
  });
  await a.profiles.registerEquipment(meta(OPS), seeded.operatorId, {
    kind: 'VACUUM',
    required: false,
  });
  assert.equal(
    await errorCode(
      b.profiles.registerEquipment(meta(OPS), seeded.operatorId, {
        kind: 'SERVICE_VEHICLE',
        required: false,
      }),
    ),
    'EQUIPMENT_EXISTS',
  );
  assert.equal(
    await errorCode(
      a.profiles.registerEquipment(meta(tech), seeded.operatorId, {
        kind: 'VACUUM',
        required: true,
      }),
    ),
    'FORBIDDEN',
  );

  // Optional item down: no eligibility movement, no event.
  await a.profiles.reportMyEquipment(meta(tech), 'VACUUM', {
    status: 'UNAVAILABLE',
    issue: 'BREAKDOWN',
    expectedRevision: 1,
  });
  const afterOptional = await a.store.findOperator(seeded.operatorId);
  assert.equal(afterOptional?.eligibilityRevision, before.eligibilityRevision);

  // Required item down, raced by two replicas at the same revision: one wins.
  const raced = await Promise.allSettled([
    a.profiles.reportMyEquipment(meta(tech), 'SERVICE_VEHICLE', {
      status: 'UNAVAILABLE',
      issue: 'BREAKDOWN',
      expectedRevision: van.revision,
    }),
    b.profiles.reportMyEquipment(meta(tech), 'SERVICE_VEHICLE', {
      status: 'DEGRADED',
      issue: 'MAINTENANCE',
      expectedRevision: van.revision,
    }),
  ]);
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = raced.find((r) => r.status === 'rejected');
  assert.equal(
    lost?.status === 'rejected' ? (lost.reason as { code?: string }).code : 'none',
    'REVISION_CONFLICT',
  );
  const items = await a.store.listEquipment(seeded.operatorId);
  const vehicle = items.find((i) => i.kind === 'SERVICE_VEHICLE');
  assert.ok(vehicle);
  if (vehicle.status === 'DEGRADED') {
    // The DEGRADED report won; take it down now to reach the blocked state.
    await a.profiles.reportMyEquipment(meta(tech), 'SERVICE_VEHICLE', {
      status: 'UNAVAILABLE',
      issue: 'BREAKDOWN',
      expectedRevision: vehicle.revision,
    });
  }
  const blocked = await a.store.findOperator(seeded.operatorId);
  assert.ok(blocked);
  assert.equal(blocked.equipmentBlocked, true);
  assert.equal(blocked.eligibilityRevision, before.eligibilityRevision + 1);
  const readiness = await a.service.readiness(meta(OPS), seeded.operatorId);
  assert.deepEqual(readiness.reasons, ['EQUIPMENT_UNAVAILABLE']);
  let events = await eligibilityEvents(a, seeded.operatorId);
  const last = events[events.length - 1];
  assert.equal(last?.event.aggregate.version, blocked.eligibilityRevision);
  assert.equal(last?.event.data.eligibility, 'INELIGIBLE');

  // Operations make the vehicle optional: unblocked, ELIGIBLE published.
  const current = (await a.store.listEquipment(seeded.operatorId)).find(
    (i) => i.kind === 'SERVICE_VEHICLE',
  );
  assert.ok(current);
  await a.profiles.setEquipmentRequirement(meta(OPS), seeded.operatorId, 'SERVICE_VEHICLE', {
    required: false,
    expectedRevision: current.revision,
  });
  const unblocked = await a.store.findOperator(seeded.operatorId);
  assert.equal(unblocked?.equipmentBlocked, false);
  events = await eligibilityEvents(a, seeded.operatorId);
  assert.equal(events[events.length - 1]?.event.data.eligibility, 'ELIGIBLE');
  assert.equal(events[events.length - 1]?.event.aggregate.version, unblocked?.eligibilityRevision);

  // CHECK: READY never carries an issue; unknown kinds are refused by the database.
  assert.equal(
    await sqlState(
      a.prisma.client.$executeRawUnsafe(
        `UPDATE app.operator_equipment SET status='READY', issue='BREAKDOWN' WHERE id=$1::uuid`,
        van.id,
      ),
    ),
    '23514',
  );
  assert.equal(
    await sqlState(
      a.prisma.client.$executeRawUnsafe(
        `INSERT INTO app.operator_equipment (id, operator_id, kind, required, status, revision,
           created_at, updated_at) VALUES ($1::uuid, $2::uuid, 'DRONE', false, 'READY', 1, now(), now())`,
        randomUUID(),
        seeded.operatorId,
      ),
    ),
    '23514',
  );
});

test('revoked technician: no new working time, readable profile with the reason', async () => {
  const zone = randomUUID();
  const seeded = await seedOperator(a, clock);
  await allowZones(a, seeded.operatorId, [zone]);
  const tech = technician(seeded.subject);
  await a.service.setOperatorState(meta(OPS), seeded.operatorId, { suspensionReason: 'SAFETY' });
  assert.equal(
    await errorCode(
      a.service.setAvailability(meta(tech), { status: 'AVAILABLE', expectedRevision: 0 }),
    ),
    'OPERATOR_NOT_ACTIVE',
  );
  assert.equal(
    await errorCode(
      a.service.createShift(
        meta(tech),
        seeded.operatorId,
        shift(zone, new Date(tomorrow().getTime() + 8 * HOUR), 2),
        key(),
      ),
    ),
    'OPERATOR_NOT_ACTIVE',
  );
  await a.profiles.setSchedule(meta(tech), {
    timeZone: 'Asia/Damascus',
    expectedRevision: 0,
    windows: [{ weekday: 1, startMinute: 480, endMinute: 600, zoneId: zone }],
  });
  const today = localToday('Asia/Damascus', clock.now());
  assert.equal(
    await errorCode(
      a.profiles.applySchedule(meta(tech), {
        startDate: formatLocalDate(today),
        expectedRevision: 1,
      }),
    ),
    'OPERATOR_NOT_ACTIVE',
  );
  // Going on break is always allowed.
  const onBreak = await a.service.availability(meta(tech));
  assert.equal(onBreak.status, 'ON_BREAK');
  const profile = await a.profiles.myProfile(meta(tech));
  assert.deepEqual(profile.readiness.reasons, ['SUSPENDED']);
  assert.equal(profile.schedule.revision, 1);
  assert.equal(profile.latestVerification?.status, 'APPROVED');
  // A technician never reads another operator's profile through the operations route.
  assert.equal(
    await errorCode(a.profiles.operatorProfile(meta(tech), seeded.operatorId)),
    'FORBIDDEN',
  );
});
