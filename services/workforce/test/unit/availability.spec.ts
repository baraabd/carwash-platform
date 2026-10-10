import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkforceService } from '../../src/application';
import {
  WorkforceError,
  changeAvailability,
  createOperator,
  initialAvailability,
  parseAvailabilityCommand,
} from '../../src/domain';
import type { Actor, RequestMeta } from '../../src/ports';
import { MemoryStore } from './memory-store';

const OPERATOR = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';
const STRANGER = '99999999-9999-4999-8999-999999999999';
const ZONE = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-10-07T10:00:00.000Z');

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof WorkforceError ? error.code : String(error);
  }
  return 'OK';
}

test('domain: never set means ON_BREAK at revision 0 with no timestamp', () => {
  assert.deepEqual(initialAvailability(OPERATOR), {
    operatorId: OPERATOR,
    status: 'ON_BREAK',
    revision: 0,
    updatedAt: null,
  });
});

test('domain: a current revision changes status and moves the revision by one', () => {
  const first = changeAvailability(
    initialAvailability(OPERATOR),
    { status: 'AVAILABLE', expectedRevision: 0 },
    now,
  );
  assert.equal(first.changed, true);
  assert.deepEqual(first.next, {
    operatorId: OPERATOR,
    status: 'AVAILABLE',
    revision: 1,
    updatedAt: now,
  });
  const second = changeAvailability(first.next, { status: 'ON_BREAK', expectedRevision: 1 }, now);
  assert.equal(second.next.revision, 2);
  assert.equal(second.next.status, 'ON_BREAK');
});

test('domain: same status is a no-op; a stale revision is always a conflict', () => {
  const current = { ...initialAvailability(OPERATOR), status: 'AVAILABLE' as const, revision: 3 };
  const same = changeAvailability(current, { status: 'AVAILABLE', expectedRevision: 3 }, now);
  assert.equal(same.changed, false);
  assert.equal(same.next, current);
  assert.equal(
    code(() => changeAvailability(current, { status: 'ON_BREAK', expectedRevision: 2 }, now)),
    'REVISION_CONFLICT',
  );
  assert.equal(
    code(() => changeAvailability(current, { status: 'AVAILABLE', expectedRevision: 4 }, now)),
    'REVISION_CONFLICT',
    'stale even when the requested status is already in place',
  );
});

test('domain: the command body is closed and typed', () => {
  assert.deepEqual(parseAvailabilityCommand({ status: 'AVAILABLE', expectedRevision: 0 }), {
    status: 'AVAILABLE',
    expectedRevision: 0,
  });
  const bad: unknown[] = [
    null,
    [],
    'AVAILABLE',
    {},
    { status: 'AVAILABLE' },
    { expectedRevision: 0 },
    { status: 'BUSY', expectedRevision: 0 },
    { status: 'available', expectedRevision: 0 },
    { status: 'AVAILABLE', expectedRevision: -1 },
    { status: 'AVAILABLE', expectedRevision: 1.5 },
    { status: 'AVAILABLE', expectedRevision: '0' },
    { status: 'AVAILABLE', expectedRevision: 2_147_483_648 },
    { status: 'AVAILABLE', expectedRevision: 0, operatorId: OPERATOR },
  ];
  for (const body of bad) {
    assert.equal(
      code(() => parseAvailabilityCommand(body)),
      'INVALID_INPUT',
      JSON.stringify(body),
    );
  }
});

const technician = (subject: string, permissions: string[]): Actor => ({
  kind: 'USER',
  subject,
  permissions,
});
const meta = (actor: Actor): RequestMeta => ({
  actor,
  correlationId: '44444444-4444-4444-8444-444444444444',
});
const FULL = ['work.read:assigned', 'work.execute:assigned'];

function harness() {
  const store = new MemoryStore();
  const op = createOperator({
    id: OPERATOR,
    identitySubject: SUBJECT,
    displayName: 'Operator One',
    homeZoneId: ZONE,
    now,
  });
  store.operators.set(OPERATOR, op);
  const service = new WorkforceService(
    store,
    store,
    { now: () => now },
    { next: () => '66666666-6666-4666-8666-666666666666' },
  );
  return { store, service, op };
}

test('service: GET needs work.read:assigned, PUT needs work.execute:assigned', async () => {
  const { store, service } = harness();
  const denied: Array<[Actor, 'get' | 'put']> = [
    [technician(SUBJECT, []), 'get'],
    [technician(SUBJECT, ['work.execute:assigned']), 'get'],
    [technician(SUBJECT, ['work.read:assigned']), 'put'],
    [{ kind: 'SERVICE', clientId: 'dispatch', scopes: ['workforce.capacity.read'] }, 'get'],
    [{ kind: 'SERVICE', clientId: 'dispatch', scopes: ['workforce.capacity.read'] }, 'put'],
    [{ kind: 'SYSTEM', component: 'test' }, 'put'],
  ];
  for (const [actor, op] of denied) {
    await assert.rejects(
      () =>
        op === 'get'
          ? service.availability(meta(actor))
          : service.setAvailability(meta(actor), { status: 'AVAILABLE', expectedRevision: 0 }),
      (error: unknown) => error instanceof WorkforceError && error.code === 'FORBIDDEN',
    );
  }
  // Authorization precedes body validation: a malformed body is still 403.
  await assert.rejects(
    () => service.setAvailability(meta(technician(SUBJECT, ['work.read:assigned'])), 'garbage'),
    (error: unknown) => error instanceof WorkforceError && error.code === 'FORBIDDEN',
  );
  assert.equal(store.transactions, 0);
});

test('service: a subject without an operator profile gets OPERATOR_NOT_FOUND', async () => {
  const { service } = harness();
  for (const call of [
    () => service.availability(meta(technician(STRANGER, FULL))),
    () =>
      service.setAvailability(meta(technician(STRANGER, FULL)), {
        status: 'AVAILABLE',
        expectedRevision: 0,
      }),
  ]) {
    await assert.rejects(
      call,
      (error: unknown) => error instanceof WorkforceError && error.code === 'OPERATOR_NOT_FOUND',
    );
  }
});

test('service: self only, audited, never touches the operator, eligibility or outbox', async () => {
  const { store, service, op } = harness();
  const me = meta(technician(SUBJECT, FULL));
  assert.deepEqual(await service.availability(me), initialAvailability(OPERATOR));
  const set = await service.setAvailability(me, { status: 'AVAILABLE', expectedRevision: 0 });
  assert.equal(set.revision, 1);
  assert.deepEqual(await service.availability(me), set);
  const noop = await service.setAvailability(me, { status: 'AVAILABLE', expectedRevision: 1 });
  assert.equal(noop.revision, 1);
  await assert.rejects(
    () => service.setAvailability(me, { status: 'ON_BREAK', expectedRevision: 0 }),
    (error: unknown) => error instanceof WorkforceError && error.code === 'REVISION_CONFLICT',
  );
  const back = await service.setAvailability(me, { status: 'ON_BREAK', expectedRevision: 1 });
  assert.equal(back.revision, 2);
  assert.equal(store.outbox.length, 0, 'availability has no event');
  assert.deepEqual(store.operators.get(OPERATOR), op, 'operator row untouched');
  assert.deepEqual(
    store.audit.map((entry) => [entry.action, entry.targetId, entry.details.revision]),
    [
      ['AVAILABILITY_CHANGED', OPERATOR, 1],
      ['AVAILABILITY_CHANGED', OPERATOR, 2],
    ],
  );
});
