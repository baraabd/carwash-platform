/**
 * Dispatch's local workforce.v1 capacity parser against the PUBLISHED one
 * (`parsePage` + `parseCapacityResourceV1` from the built @carwash/contracts).
 * Dispatch cannot depend on @carwash/contracts yet (lockfile is Lane E's), so
 * its consumer parser is a closed mirror; this suite proves both admit and
 * refuse the same corpus. The produced task events are checked as envelope v2.
 * Compiled-artifact contract checks; no database or broker.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, require, serviceDist } from './_support.mjs';

const published = {
  ...require(path.join(ROOT, 'packages', 'contracts', 'dist', 'index.js')),
  ...require(path.join(ROOT, 'packages', 'contracts', 'dist', 'workforce', 'v1.js')),
};
const events = require(path.join(ROOT, 'packages', 'event-contracts', 'dist', 'index.js'));
const { parseCapacityPage } = serviceDist(
  'dispatch',
  'infrastructure/workforce/workforce-capacity.client.js',
);
const domain = serviceDist('dispatch', 'domain/index.js');

const iso = (minutes) => new Date(Date.UTC(2026, 9, 10, 8, 0) + minutes * 60_000).toISOString();

function item(overrides = {}) {
  return {
    resourceId: randomUUID(),
    revision: 2,
    eligibility: 'ELIGIBLE',
    eligibilityRevision: 3,
    zoneIds: [randomUUID()],
    shifts: [
      { startsAt: iso(0), endsAt: iso(60) },
      { startsAt: iso(60), endsAt: iso(120) },
    ],
    ...overrides,
  };
}

function page(items, overrides = {}) {
  return { items, nextCursor: null, asOf: iso(5), ...overrides };
}

const zone = randomUUID();
const CORPUS = [
  ['valid page', page([item(), item({ eligibility: 'INELIGIBLE' })])],
  ['valid with cursor', page([item()], { nextCursor: 'abc_DEF-123' })],
  ['empty page', page([])],
  ['extra page field', { ...page([item()]), total: 1 }],
  ['extra item field', page([{ ...item(), name: 'x' }])],
  ['missing item field', page([(({ revision: _r, ...rest }) => rest)(item())])],
  ['empty zones', page([item({ zoneIds: [] })])],
  ['duplicate zone', page([item({ zoneIds: [zone, zone] })])],
  ['21 zones', page([item({ zoneIds: Array.from({ length: 21 }, () => randomUUID()) })])],
  ['unknown eligibility', page([item({ eligibility: 'SUSPENDED' })])],
  ['zero revision', page([item({ revision: 0 })])],
  ['float revision', page([item({ eligibilityRevision: 1.5 })])],
  [
    'non-UTC instant',
    page([item({ shifts: [{ startsAt: '2026-10-10T08:00:00+03:00', endsAt: iso(60) }] })]),
  ],
  [
    'instant without millis',
    page([item({ shifts: [{ startsAt: '2026-10-10T08:00:00Z', endsAt: iso(60) }] })]),
  ],
  ['inverted shift', page([item({ shifts: [{ startsAt: iso(60), endsAt: iso(0) }] })])],
  [
    'overlapping shifts',
    page([
      item({
        shifts: [
          { startsAt: iso(0), endsAt: iso(90) },
          { startsAt: iso(60), endsAt: iso(120) },
        ],
      }),
    ]),
  ],
  [
    'unsorted shifts',
    page([
      item({
        shifts: [
          { startsAt: iso(60), endsAt: iso(120) },
          { startsAt: iso(0), endsAt: iso(30) },
        ],
      }),
    ]),
  ],
  ['bad cursor', page([item()], { nextCursor: 'has space' })],
  ['bad asOf', page([item()], { asOf: 'yesterday' })],
  ['not an object', [item()]],
];

const accepts = (fn) => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};

test('local capacity page parser admits exactly what the published parser admits', () => {
  assert.equal(typeof published.parsePage, 'function');
  assert.equal(typeof published.parseCapacityResourceV1, 'function');
  for (const [name, sample] of CORPUS) {
    const theirs = accepts(() =>
      published.parsePage(sample, '$', published.parseCapacityResourceV1),
    );
    const ours = accepts(() => parseCapacityPage(sample));
    assert.equal(ours, theirs, `${name}: dispatch=${ours} published=${theirs}`);
  }
});

test('the produced task-progressed and cash-declared events are valid envelope v2', () => {
  const T0 = new Date('2026-10-10T08:00:00.000Z');
  const task = domain.createTask({
    id: randomUUID(),
    assignmentId: randomUUID(),
    offerId: randomUUID(),
    bookingId: randomUUID(),
    resourceId: randomUUID(),
    technicianSubject: randomUUID(),
    now: T0,
  });
  const input = {
    eventId: randomUUID(),
    correlationId: randomUUID(),
    causationId: null,
    actor: { kind: 'account', id: task.technicianSubject },
    task,
  };
  const progressed = domain.taskProgressedEvent(input);
  // Requested (unpublished) types: parsed with the published GENERIC envelope v2
  // parser and an exact data-shape check, standing in for E's future spec.
  const envelope = (event, eventType, keys) =>
    events.parseEnvelopeV2(
      event,
      { eventType, producer: 'dispatch', aggregateType: 'task' },
      (data) => {
        assert.deepEqual(Object.keys(data).sort(), keys);
        return data;
      },
    );
  envelope(progressed, 'dispatch.task-progressed.v1', [
    'assignmentId',
    'bookingId',
    'stage',
    'taskId',
  ]);
  assert.ok(!JSON.stringify(progressed.data).includes(task.technicianSubject));
  const closed = {
    ...task,
    stage: 'CLOSED',
    collection: {
      outcome: 'NOT_CASH',
      currency: null,
      amountMinor: null,
      reason: null,
      declaredAt: T0,
      lateAmountMinor: null,
      lateDeclaredAt: null,
    },
  };
  envelope(
    domain.cashDeclaredEvent({ ...input, task: closed, late: false }),
    'dispatch.cash-declared.v1',
    ['amount', 'bookingId', 'late', 'outcome', 'taskId'],
  );
});
