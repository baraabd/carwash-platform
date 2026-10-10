import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkforceService, cursorScope, decodeCursor, encodeCursor } from '../../src/application';
import {
  WorkforceError,
  createOperator,
  parseCapacityQuery,
  recordSkillChange,
  setVerificationProjection,
  toCapacityResource,
  type CapacityCandidate,
  type OperatorState,
} from '../../src/domain';
import type { Actor, RequestMeta } from '../../src/ports';
import { MemoryStore } from './memory-store';

const ZONE = '33333333-3333-4333-8333-333333333333';
const OTHER_ZONE = '77777777-7777-4777-8777-777777777777';
const FROM = '2026-10-08T08:00:00.000Z';
const TO = '2026-10-08T12:00:00.000Z';
const now = new Date('2026-10-07T10:00:00.000Z');

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof WorkforceError ? error.code : String(error);
  }
  return 'OK';
}

function operator(id: string, verifiedUntil: Date | null = new Date('2027-01-01T00:00:00.000Z')) {
  const created = createOperator({
    id,
    identitySubject: id.replace(/^1/, '2'),
    displayName: 'Operator',
    homeZoneId: ZONE,
    now,
  });
  return verifiedUntil === null
    ? created
    : setVerificationProjection(created, 'VERIFIED', verifiedUntil, now);
}

function candidate(op: OperatorState, extra: Partial<CapacityCandidate> = {}): CapacityCandidate {
  return {
    operator: op,
    skillCodes: ['exterior-wash'],
    zoneIds: [ZONE],
    shifts: [
      {
        zoneId: ZONE,
        startsAt: new Date('2026-10-08T07:00:00.000Z'),
        endsAt: new Date('2026-10-08T15:00:00.000Z'),
      },
    ],
    ...extra,
  };
}

test('query: valid input is normalised exactly like the published parser', () => {
  const query = parseCapacityQuery({ zoneId: ZONE.toUpperCase(), from: FROM, to: TO });
  assert.equal(query.zoneId, ZONE);
  assert.equal(query.limit, 20);
  assert.equal(query.cursor, null);
  assert.equal(parseCapacityQuery({ zoneId: ZONE, from: FROM, to: TO, limit: '100' }).limit, 100);
});

test('query: malformed input is refused as INVALID_INPUT', () => {
  const base = { zoneId: ZONE, from: FROM, to: TO };
  const bad: Array<Record<string, unknown>> = [
    {},
    { ...base, zoneId: 'not-a-uuid' },
    { ...base, from: '2026-10-08T08:00:00Z' },
    { ...base, from: '2026-10-08T08:00:00.000+00:00' },
    { ...base, from: '2026-02-30T08:00:00.000Z' },
    { ...base, to: FROM },
    { ...base, from: TO, to: FROM },
    { ...base, limit: '0' },
    { ...base, limit: '101' },
    { ...base, limit: '1.5' },
    { ...base, limit: '-1' },
    { ...base, limit: ['10', '20'] },
    { ...base, zoneId: [ZONE, ZONE] },
    { ...base, cursor: '' },
    { ...base, cursor: 'has space' },
    { ...base, cursor: 'x'.repeat(513) },
    { ...base, extra: '1' },
  ];
  for (const raw of bad) {
    assert.equal(
      code(() => parseCapacityQuery(raw)),
      'INVALID_INPUT',
      JSON.stringify(raw),
    );
  }
});

test('projection: eligibility is readiness at the query `from`, not at the request time', () => {
  const expiresBeforeFrom = operator(
    '11111111-1111-4111-8111-000000000001',
    new Date('2026-10-08T07:59:59.999Z'),
  );
  const resource = toCapacityResource(candidate(expiresBeforeFrom), {
    zoneId: ZONE,
    from: new Date(FROM),
  });
  assert.equal(resource.eligibility, 'INELIGIBLE');
  const valid = toCapacityResource(candidate(operator('11111111-1111-4111-8111-000000000002')), {
    zoneId: ZONE,
    from: new Date(FROM),
  });
  assert.equal(valid.eligibility, 'ELIGIBLE');
  const noSkills = toCapacityResource(
    candidate(operator('11111111-1111-4111-8111-000000000003'), { skillCodes: [] }),
    { zoneId: ZONE, from: new Date(FROM) },
  );
  assert.equal(noSkills.eligibility, 'INELIGIBLE');
});

test('projection: revision = version, eligibilityRevision = persisted counter', () => {
  const op = recordSkillChange(operator('11111111-1111-4111-8111-000000000004'), now);
  const resource = toCapacityResource(candidate(op), { zoneId: ZONE, from: new Date(FROM) });
  assert.equal(resource.resourceId, op.id);
  assert.equal(resource.revision, op.version);
  assert.equal(resource.eligibilityRevision, op.eligibilityRevision);
});

test('projection: zones sorted and distinct, shifts sorted, capped at 20 zones / 100 shifts', () => {
  const op = operator('11111111-1111-4111-8111-000000000005');
  const zones = Array.from(
    { length: 30 },
    (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
  );
  const shifts = Array.from({ length: 101 }, (_, i) => ({
    zoneId: zones[i % 30] ?? ZONE,
    startsAt: new Date(Date.parse(FROM) + (100 - i) * 60_000),
    endsAt: new Date(Date.parse(FROM) + (100 - i) * 60_000 + 30_000),
  }));
  const resource = toCapacityResource(candidate(op, { zoneIds: [...zones, ZONE, ZONE], shifts }), {
    zoneId: ZONE,
    from: new Date(FROM),
  });
  assert.equal(resource.zoneIds.length, 20);
  assert.ok(resource.zoneIds.includes(ZONE), 'the queried zone is always present');
  assert.deepEqual([...resource.zoneIds], [...resource.zoneIds].sort());
  assert.equal(resource.shifts.length, 100);
  for (let i = 1; i < resource.shifts.length; i += 1) {
    assert.ok(
      (resource.shifts[i]?.startsAt.getTime() ?? 0) >=
        (resource.shifts[i - 1]?.endsAt.getTime() ?? 0),
    );
  }
});

test('projection: overlapping shifts are an internal fault, never published', () => {
  const op = operator('11111111-1111-4111-8111-000000000006');
  assert.throws(
    () =>
      toCapacityResource(
        candidate(op, {
          shifts: [
            { zoneId: ZONE, startsAt: new Date(FROM), endsAt: new Date(TO) },
            { zoneId: ZONE, startsAt: new Date(FROM), endsAt: new Date(TO) },
          ],
        }),
        { zoneId: ZONE, from: new Date(FROM) },
      ),
    /CAPACITY_SHIFTS_OVERLAP/,
  );
});

test('cursor: round trip, bound to its query, canonical encoding only', () => {
  const query = { zoneId: ZONE, from: new Date(FROM), to: new Date(TO) };
  const scope = cursorScope(query);
  const after = '11111111-1111-4111-8111-000000000007';
  const cursor = encodeCursor(scope, after);
  assert.match(cursor, /^[A-Za-z0-9_-]{1,512}$/);
  assert.equal(decodeCursor(cursor, scope), after);
  const otherZone = cursorScope({ ...query, zoneId: OTHER_ZONE });
  const otherWindow = cursorScope({ ...query, to: new Date('2026-10-08T13:00:00.000Z') });
  assert.equal(
    code(() => decodeCursor(cursor, otherZone)),
    'INVALID_CURSOR',
  );
  assert.equal(
    code(() => decodeCursor(cursor, otherWindow)),
    'INVALID_CURSOR',
  );
  const forged = [
    'abc',
    Buffer.from('[]').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 2, s: scope, a: after })).toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, s: scope, a: 'x' })).toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, s: scope, a: after, z: 1 })).toString('base64url'),
    Buffer.from(JSON.stringify({ a: after, s: scope, v: 1 })).toString('base64url'),
    `${cursor}A`,
  ];
  for (const value of forged) {
    assert.equal(
      code(() => decodeCursor(value, scope)),
      'INVALID_CURSOR',
      value,
    );
  }
});

const SERVICE = (
  scopes: Array<'workforce.capacity.read' | 'workforce.eligibility.read'>,
): Actor => ({
  kind: 'SERVICE',
  clientId: 'scheduling',
  scopes,
});
const meta = (actor: Actor): RequestMeta => ({
  actor,
  correlationId: '44444444-4444-4444-8444-444444444444',
});

function harness() {
  const store = new MemoryStore();
  const service = new WorkforceService(
    store,
    store,
    { now: () => new Date('2026-10-07T12:00:00.000Z') },
    { next: () => '66666666-6666-4666-8666-666666666666' },
  );
  return { store, service };
}

test('authorization: only workforce.capacity.read may list; checked before the query', async () => {
  const { store, service } = harness();
  const denied: Actor[] = [
    SERVICE(['workforce.eligibility.read']),
    {
      kind: 'USER',
      subject: '22222222-2222-4222-8222-222222222222',
      permissions: ['operations.dispatch', 'work.read:assigned'],
    },
    { kind: 'SYSTEM', component: 'test' },
  ];
  for (const actor of denied) {
    await assert.rejects(
      () => service.listCapacityResources(meta(actor), { zoneId: 'garbage' }),
      (error: unknown) => error instanceof WorkforceError && error.code === 'FORBIDDEN',
    );
  }
  assert.equal(store.lastCandidateQuery, null, 'no store access when denied');
});

test('paging: limit + 1 lookahead, opaque next cursor, last page has none', async () => {
  const { store, service } = harness();
  store.candidates = [1, 2, 3, 4, 5].map((i) =>
    candidate(operator(`11111111-1111-4111-8111-00000000000${i}`)),
  );
  const actor = SERVICE(['workforce.capacity.read']);
  const first = await service.listCapacityResources(meta(actor), {
    zoneId: ZONE,
    from: FROM,
    to: TO,
    limit: '2',
  });
  assert.equal(store.lastCandidateQuery?.limit, 3);
  assert.deepEqual(
    first.items.map((r) => r.resourceId.slice(-1)),
    ['1', '2'],
  );
  assert.ok(first.nextCursor);
  assert.equal(first.asOf.toISOString(), '2026-10-07T12:00:00.000Z');
  const seen = [...first.items.map((r) => r.resourceId)];
  let cursor: string | null = first.nextCursor;
  while (cursor !== null) {
    const page = await service.listCapacityResources(meta(actor), {
      zoneId: ZONE,
      from: FROM,
      to: TO,
      limit: '2',
      cursor,
    });
    seen.push(...page.items.map((r) => r.resourceId));
    cursor = page.nextCursor;
  }
  assert.equal(seen.length, 5);
  assert.equal(new Set(seen).size, 5);
  await assert.rejects(
    () =>
      service.listCapacityResources(meta(actor), {
        zoneId: OTHER_ZONE,
        from: FROM,
        to: TO,
        cursor: first.nextCursor ?? '',
      }),
    (error: unknown) => error instanceof WorkforceError && error.code === 'INVALID_CURSOR',
  );
});
