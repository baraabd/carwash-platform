import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkforceError,
  cancelException,
  createException,
  createOperator,
  equipmentBlocks,
  expandWeek,
  initialSchedule,
  initialServiceArea,
  localToUtc,
  operationalReadiness,
  parseApplyCommand,
  parseEquipmentStatusCommand,
  parseExceptionCommand,
  parseScheduleCommand,
  registerEquipment,
  replaceSchedule,
  replaceServiceArea,
  reportEquipmentStatus,
  setEquipmentBlock,
  setEquipmentRequirement,
  subtractIntervals,
  toCapacityResource,
  type OperatorState,
} from '../../src/domain';

const ZONE = '33333333-3333-4333-8333-333333333333';
const ZONE_B = '44444444-4444-4444-8444-444444444444';
const OP = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-12T06:00:00.000Z'); // Monday 09:00 in Damascus (UTC+3)

function code(fn: () => unknown): string {
  try {
    fn();
    return 'OK';
  } catch (error) {
    return error instanceof WorkforceError ? error.code : String(error);
  }
}

function operator(): OperatorState {
  return createOperator({
    id: OP,
    identitySubject: '11111111-1111-4111-8111-111111111111',
    displayName: 'Operator',
    homeZoneId: ZONE,
    now: NOW,
  });
}

const at = (iso: string) => new Date(iso);

test('subtractIntervals cuts, splits and drops pieces without empty fragments', () => {
  const base = [
    { startsAt: at('2026-10-12T08:00:00.000Z'), endsAt: at('2026-10-12T16:00:00.000Z'), tag: 'a' },
  ];
  const out = subtractIntervals(base, [
    { startsAt: at('2026-10-12T10:00:00.000Z'), endsAt: at('2026-10-12T11:00:00.000Z') },
    { startsAt: at('2026-10-12T15:00:00.000Z'), endsAt: at('2026-10-12T18:00:00.000Z') },
  ]);
  assert.deepEqual(
    out.map((p) => [p.startsAt.toISOString(), p.endsAt.toISOString(), p.tag]),
    [
      ['2026-10-12T08:00:00.000Z', '2026-10-12T10:00:00.000Z', 'a'],
      ['2026-10-12T11:00:00.000Z', '2026-10-12T15:00:00.000Z', 'a'],
    ],
  );
  assert.deepEqual(
    subtractIntervals(base, [
      { startsAt: at('2026-10-12T07:00:00.000Z'), endsAt: at('2026-10-12T17:00:00.000Z') },
    ]),
    [],
  );
  // Touching boundaries do not cut (half-open intervals).
  assert.equal(
    subtractIntervals(base, [
      { startsAt: at('2026-10-12T16:00:00.000Z'), endsAt: at('2026-10-12T17:00:00.000Z') },
    ]).length,
    1,
  );
});

test('capacity projection removes ACTIVE exceptions from published shifts', () => {
  const op = operator();
  const resource = toCapacityResource(
    {
      operator: op,
      skillCodes: ['exterior-wash'],
      zoneIds: [ZONE],
      shifts: [
        {
          zoneId: ZONE,
          startsAt: at('2026-10-13T05:00:00.000Z'),
          endsAt: at('2026-10-13T13:00:00.000Z'),
        },
      ],
      exceptions: [
        { startsAt: at('2026-10-13T08:00:00.000Z'), endsAt: at('2026-10-13T09:00:00.000Z') },
      ],
    },
    { zoneId: ZONE, from: at('2026-10-13T00:00:00.000Z') },
  );
  assert.deepEqual(
    resource.shifts.map((s) => [s.startsAt.toISOString(), s.endsAt.toISOString()]),
    [
      ['2026-10-13T05:00:00.000Z', '2026-10-13T08:00:00.000Z'],
      ['2026-10-13T09:00:00.000Z', '2026-10-13T13:00:00.000Z'],
    ],
  );
});

test('service area: home zone implicit, distinct, bounded, revision-fenced', () => {
  const op = operator();
  const area = initialServiceArea(OP);
  const { next, changed } = replaceServiceArea(
    op,
    area,
    { zoneIds: [ZONE_B.toUpperCase(), ZONE], expectedRevision: 0 },
    NOW,
  );
  assert.equal(changed, true);
  assert.deepEqual(next.extraZoneIds, [ZONE_B]);
  assert.equal(next.revision, 1);
  assert.equal(
    replaceServiceArea(op, next, { zoneIds: [ZONE_B], expectedRevision: 1 }, NOW).changed,
    false,
  );
  assert.equal(
    code(() => replaceServiceArea(op, next, { zoneIds: [], expectedRevision: 0 }, NOW)),
    'REVISION_CONFLICT',
  );
  assert.equal(
    code(() =>
      replaceServiceArea(op, area, { zoneIds: [ZONE_B, ZONE_B], expectedRevision: 0 }, NOW),
    ),
    'INVALID_INPUT',
  );
  const many = Array.from(
    { length: 20 },
    (_, i) => `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`,
  );
  assert.equal(
    code(() => replaceServiceArea(op, area, { zoneIds: many, expectedRevision: 0 }, NOW)),
    'INVALID_INPUT',
  );
});

test('schedule command is closed, sorted and refuses overlapping or short windows', () => {
  const body = {
    timeZone: 'Asia/Damascus',
    expectedRevision: 0,
    windows: [
      { weekday: 2, startMinute: 600, endMinute: 900, zoneId: ZONE },
      { weekday: 1, startMinute: 480, endMinute: 960, zoneId: ZONE },
    ],
  };
  const parsed = parseScheduleCommand(body);
  assert.deepEqual(
    parsed.windows.map((w) => w.weekday),
    [1, 2],
  );
  assert.equal(
    code(() =>
      parseScheduleCommand({
        ...body,
        windows: [
          { weekday: 1, startMinute: 480, endMinute: 600, zoneId: ZONE },
          { weekday: 1, startMinute: 599, endMinute: 700, zoneId: ZONE },
        ],
      }),
    ),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() =>
      parseScheduleCommand({
        ...body,
        windows: [{ weekday: 1, startMinute: 480, endMinute: 490, zoneId: ZONE }],
      }),
    ),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => parseScheduleCommand({ ...body, timeZone: 'Mars/Olympus' })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => parseScheduleCommand({ ...body, extra: 1 })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() =>
      parseScheduleCommand({
        ...body,
        windows: [{ weekday: 8, startMinute: 0, endMinute: 60, zoneId: ZONE }],
      }),
    ),
    'INVALID_INPUT',
  );
});

test('local wall-clock to UTC: Damascus is UTC+3; a DST zone follows its offset', () => {
  assert.equal(
    localToUtc('Asia/Damascus', { year: 2026, month: 10, day: 13 }, 8 * 60).toISOString(),
    '2026-10-13T05:00:00.000Z',
  );
  assert.equal(
    localToUtc('Europe/Berlin', { year: 2026, month: 7, day: 1 }, 8 * 60).toISOString(),
    '2026-07-01T06:00:00.000Z',
  );
  assert.equal(
    localToUtc('Europe/Berlin', { year: 2026, month: 12, day: 1 }, 8 * 60).toISOString(),
    '2026-12-01T07:00:00.000Z',
  );
  // End of day (1440) is the next local midnight.
  assert.equal(
    localToUtc('Asia/Damascus', { year: 2026, month: 10, day: 13 }, 1440).toISOString(),
    '2026-10-13T21:00:00.000Z',
  );
});

test('expandWeek places each window on its weekday with stable keys; horizon and revision fenced', () => {
  const command = parseScheduleCommand({
    timeZone: 'Asia/Damascus',
    expectedRevision: 0,
    windows: [
      { weekday: 1, startMinute: 480, endMinute: 960, zoneId: ZONE }, // Monday
      { weekday: 3, startMinute: 540, endMinute: 720, zoneId: ZONE_B }, // Wednesday
    ],
  });
  const schedule = replaceSchedule(initialSchedule(OP), command, NOW).next;
  const week = expandWeek(
    schedule,
    parseApplyCommand({ startDate: '2026-10-12', expectedRevision: 1 }),
    NOW,
  );
  assert.deepEqual(
    week.map((o) => [o.startsAt.toISOString(), o.endsAt.toISOString(), o.key]),
    [
      ['2026-10-12T05:00:00.000Z', '2026-10-12T13:00:00.000Z', 'wk:2026-10-12:r1:1:480'],
      ['2026-10-14T06:00:00.000Z', '2026-10-14T09:00:00.000Z', 'wk:2026-10-12:r1:3:540'],
    ],
  );
  assert.equal(
    code(() =>
      expandWeek(
        schedule,
        parseApplyCommand({ startDate: '2026-10-12', expectedRevision: 2 }),
        NOW,
      ),
    ),
    'REVISION_CONFLICT',
  );
  assert.equal(
    code(() =>
      expandWeek(
        schedule,
        parseApplyCommand({ startDate: '2026-10-11', expectedRevision: 1 }),
        NOW,
      ),
    ),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() =>
      expandWeek(
        schedule,
        parseApplyCommand({ startDate: '2026-12-31', expectedRevision: 1 }),
        NOW,
      ),
    ),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() =>
      expandWeek(
        initialSchedule(OP),
        { startDate: { year: 2026, month: 10, day: 12 }, expectedRevision: 1 },
        NOW,
      ),
    ),
    'SCHEDULE_NOT_SET',
  );
  assert.equal(
    code(() => parseApplyCommand({ startDate: '2026-02-30', expectedRevision: 1 })),
    'INVALID_INPUT',
  );
});

test('exceptions: closed body, bounded duration, no past start, cancel once', () => {
  const body = {
    startsAt: '2026-10-13T00:00:00.000Z',
    endsAt: '2026-10-14T00:00:00.000Z',
    reason: 'SICKNESS',
  };
  const exception = createException({
    id: '66666666-6666-4666-8666-666666666666',
    operatorId: OP,
    command: parseExceptionCommand(body),
    requester: 'user:x',
    idempotencyKey: 'key-00000001',
    requestFingerprint: 'f'.repeat(64),
    now: NOW,
  });
  assert.equal(exception.status, 'ACTIVE');
  const cancelled = cancelException(exception, NOW);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.version, 2);
  assert.equal(
    code(() => cancelException(cancelled, NOW)),
    'EXCEPTION_NOT_ACTIVE',
  );
  assert.equal(
    code(() => cancelException(exception, at('2026-10-15T00:00:00.000Z'))),
    'EXCEPTION_NOT_ACTIVE',
  );
  assert.equal(
    code(() => parseExceptionCommand({ ...body, reason: 'HOLIDAY' })),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() => parseExceptionCommand({ ...body, note: 'x' })),
    'INVALID_INPUT',
  );
  const make = (startsAt: string, endsAt: string) =>
    code(() =>
      createException({
        id: '66666666-6666-4666-8666-666666666666',
        operatorId: OP,
        command: parseExceptionCommand({ startsAt, endsAt, reason: 'LEAVE' }),
        requester: 'user:x',
        idempotencyKey: 'key-00000001',
        requestFingerprint: 'f'.repeat(64),
        now: NOW,
      }),
    );
  assert.equal(make('2026-10-12T00:00:00.000Z', '2026-10-13T00:00:00.000Z'), 'INVALID_INPUT');
  assert.equal(make('2026-10-13T00:00:00.000Z', '2026-11-20T00:00:00.000Z'), 'INVALID_INPUT');
  assert.equal(make('2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z'), 'INVALID_INPUT');
});

test('equipment: READY carries no issue; a REQUIRED UNAVAILABLE item blocks readiness', () => {
  const van = registerEquipment({
    id: '77777777-7777-4777-8777-777777777777',
    operatorId: OP,
    kind: 'SERVICE_VEHICLE',
    required: true,
    now: NOW,
  });
  assert.equal(van.status, 'READY');
  assert.equal(
    code(() =>
      parseEquipmentStatusCommand({ status: 'READY', issue: 'BREAKDOWN', expectedRevision: 1 }),
    ),
    'INVALID_INPUT',
  );
  assert.equal(
    code(() =>
      parseEquipmentStatusCommand({ status: 'UNAVAILABLE', issue: null, expectedRevision: 1 }),
    ),
    'INVALID_INPUT',
  );
  const broken = reportEquipmentStatus(
    van,
    parseEquipmentStatusCommand({ status: 'UNAVAILABLE', issue: 'BREAKDOWN', expectedRevision: 1 }),
    NOW,
  );
  assert.equal(broken.changed, true);
  assert.equal(equipmentBlocks([broken.next]), true);
  assert.equal(
    code(() =>
      reportEquipmentStatus(
        broken.next,
        parseEquipmentStatusCommand({ status: 'READY', issue: null, expectedRevision: 1 }),
        NOW,
      ),
    ),
    'REVISION_CONFLICT',
  );
  const optional = setEquipmentRequirement(
    broken.next,
    { required: false, expectedRevision: 2 },
    NOW,
  );
  assert.equal(equipmentBlocks([optional.next]), false, 'optional items never block');
  const degraded = reportEquipmentStatus(
    van,
    parseEquipmentStatusCommand({ status: 'DEGRADED', issue: 'MAINTENANCE', expectedRevision: 1 }),
    NOW,
  );
  assert.equal(equipmentBlocks([degraded.next]), false, 'DEGRADED does not block');

  const op = operator();
  const blocked = setEquipmentBlock(op, true, NOW);
  assert.equal(blocked.eligibilityRevision, op.eligibilityRevision + 1);
  assert.equal(blocked.version, op.version + 1);
  assert.equal(setEquipmentBlock(blocked, true, NOW), blocked, 'no-op keeps the revision');
  assert.ok(
    operationalReadiness(blocked, ['exterior-wash'], NOW).reasons.includes('EQUIPMENT_UNAVAILABLE'),
  );
});
