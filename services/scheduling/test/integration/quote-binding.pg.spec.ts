import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HoldsV1Service } from '../../src/application';
import { SchedulingError } from '../../src/domain';
import {
  PricingUnavailable,
  type SchedulingQuote,
  type SchedulingQuoteReader,
  type SchedulingTransaction,
  type SchedulingUnitOfWork,
} from '../../src/ports';
import { uuidGenerator } from '../../src/infrastructure/runtime/system';
import { TestClock, defineWindow, key, meta, principal, replica } from './support';

/** Real runtime-role PostgreSQL; Pricing is an explicit controllable port double. */
const clock = new TestClock();
const owner = replica(clock);
after(async () => owner.prisma.onModuleDestroy());

async function fixture() {
  const who = principal();
  const window = await defineWindow(owner.capacity, clock, 2);
  const request = {
    beneficiary: { kind: who.principalKind, subjectId: who.subject },
    zoneId: window.zoneId,
    startsAt: window.startsAt,
    durationMinutes: 30,
    quoteRef: { quoteId: randomUUID(), revision: 1 },
  };
  const quote: SchedulingQuote = {
    ...request.quoteRef,
    status: 'USABLE',
    beneficiary: request.beneficiary,
    zoneId: window.zoneId,
    durationMinutes: 30,
    expiresAt: new Date(clock.now().getTime() + 300_000),
  };
  return { who, window, request, quote };
}

function service(reader: SchedulingQuoteReader, uow: SchedulingUnitOfWork = owner.store) {
  return new HoldsV1Service(uow, owner.store, clock, uuidGenerator, reader);
}

async function noHold(windowId: string) {
  const window = await owner.store.findWindow(windowId);
  assert.equal(window!.held, 0);
  const [row] = await owner.prisma.client.$queryRawUnsafe<{ count: number }[]>(
    'SELECT count(*)::int AS count FROM app.capacity_hold WHERE window_id = $1::uuid',
    windowId,
  );
  assert.equal(row!.count, 0);
}

test('quote ownership, identity, revision, zone and exact duration are mandatory before holding capacity', async () => {
  const f = await fixture();
  const cases: (SchedulingQuote | null)[] = [
    null,
    { ...f.quote, quoteId: randomUUID() },
    { ...f.quote, revision: 2 },
    { ...f.quote, status: 'EXPIRED' },
    { ...f.quote, status: 'REVOKED' },
    { ...f.quote, expiresAt: clock.now() },
    { ...f.quote, beneficiary: { ...f.quote.beneficiary, kind: 'account' } },
    { ...f.quote, beneficiary: { ...f.quote.beneficiary, subjectId: randomUUID() } },
    { ...f.quote, zoneId: randomUUID() },
    { ...f.quote, durationMinutes: 45 },
  ];
  for (const quote of cases) {
    await assert.rejects(
      service({ read: () => Promise.resolve(quote) }).createHold(meta(f.who), f.request, key()),
      (error: unknown) =>
        error instanceof SchedulingError &&
        ['QUOTE_NOT_USABLE', 'QUOTE_MISMATCH'].includes(error.code),
    );
    await noHold(f.window.id);
  }
});

test('a Pricing refusal stores no successful receipt: the corrected same key can proceed', async () => {
  const f = await fixture();
  let result: SchedulingQuote | null = null;
  const holds = service({ read: () => Promise.resolve(result) });
  const k = key();
  await assert.rejects(holds.createHold(meta(f.who), f.request, k), { code: 'QUOTE_NOT_USABLE' });
  result = { ...f.quote, zoneId: null };
  assert.equal((await holds.createHold(meta(f.who), f.request, k)).status, 201);
});

test('successful same-key receipt replays after quote and slot expiry without consulting Pricing', async () => {
  const f = await fixture();
  let reads = 0;
  let down = false;
  const holds = service({
    read: () => {
      reads += 1;
      if (down) throw new PricingUnavailable();
      return Promise.resolve(f.quote);
    },
  });
  const k = key();
  const response = await holds.createHold(meta(f.who), f.request, k);
  down = true;
  clock.advance(f.window.startsAt.getTime() - clock.now().getTime() + 1);
  assert.deepEqual(await holds.createHold(meta(f.who), f.request, k), response);
  assert.equal(reads, 1, 'no remote prerequisite on an already committed successful receipt');
  await assert.rejects(holds.createHold(meta(f.who), { ...f.request, durationMinutes: 45 }, k), {
    code: 'IDEMPOTENCY_KEY_REUSED',
  });
  assert.equal(reads, 1);
});

test('Pricing read occurs outside the transaction, and expiry after the capacity lock rolls everything back', async () => {
  const f = await fixture();
  let inTransaction = false;
  const uow: SchedulingUnitOfWork = {
    run: async (work) =>
      owner.store.run(async (tx) => {
        inTransaction = true;
        const wrapped = new Proxy(tx, {
          get(target, property) {
            if (property === 'lockCoveringWindow')
              return async (...args: Parameters<SchedulingTransaction['lockCoveringWindow']>) => {
                const value = await target.lockCoveringWindow(...args);
                clock.advance(300_000);
                return value;
              };
            const value = Reflect.get(target, property) as unknown;
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        try {
          return await work(wrapped);
        } finally {
          inTransaction = false;
        }
      }),
  };
  const holds = service(
    {
      read: () => {
        assert.equal(inTransaction, false);
        return Promise.resolve(f.quote);
      },
    },
    uow,
  );
  const k = key();
  await assert.rejects(holds.createHold(meta(f.who), f.request, k), { code: 'QUOTE_NOT_USABLE' });
  await noHold(f.window.id);
  const [receipt] = await owner.prisma.client.$queryRawUnsafe<{ count: number }[]>(
    'SELECT count(*)::int AS count FROM app.idempotency_record WHERE key = $1',
    k,
  );
  assert.equal(receipt!.count, 0, 'failed expiry does not poison a subsequent corrected retry');
});

test('Pricing outage has an explicit retryable owner refusal and no capacity effect', async () => {
  const f = await fixture();
  await assert.rejects(
    service({
      read: () => {
        throw new PricingUnavailable();
      },
    }).createHold(meta(f.who), f.request, key()),
    { code: 'PRICING_UNAVAILABLE' },
  );
  await noHold(f.window.id);
});

test('historical success receipt gains only its persisted quoteRef, preserving its original state after commit', async () => {
  const f = await fixture();
  const holds = service({ read: () => Promise.resolve(f.quote) });
  const k = key();
  const created = await holds.createHold(meta(f.who), f.request, k);
  const body = created.body as { holdId: string; revision: number; quoteRef: unknown };
  await owner.prisma.client.$executeRawUnsafe(
    "UPDATE app.idempotency_record SET response_body = response_body - 'quoteRef' WHERE key = $1",
    k,
  );
  await holds.commitHold(
    meta({ kind: 'SERVICE', clientId: 'booking', scopes: ['scheduling.hold.commit'] }),
    body.holdId,
    { expectedRevision: body.revision, bookingId: randomUUID() },
    key(),
  );
  assert.deepEqual(
    await service({
      read: () => {
        throw new PricingUnavailable();
      },
    }).createHold(meta(f.who), f.request, k),
    created,
  );
  const [stored] = await owner.prisma.client.$queryRawUnsafe<{ has_ref: boolean }[]>(
    "SELECT response_body ? 'quoteRef' AS has_ref FROM app.idempotency_record WHERE key = $1",
    k,
  );
  assert.equal(stored!.has_ref, false, 'read-time upcast does not rewrite the historic receipt');
  await assert.rejects(
    owner.prisma.client.$executeRawUnsafe(
      'UPDATE app.capacity_hold SET quote_id = $2::uuid WHERE id = $1::uuid',
      body.holdId,
      randomUUID(),
    ),
    /CAPACITY_HOLD_QUOTE_BINDING_IMMUTABLE/,
  );
  await assert.rejects(
    owner.prisma.client.$executeRawUnsafe(
      'UPDATE app.capacity_hold SET quote_revision = quote_revision + 1 WHERE id = $1::uuid',
      body.holdId,
    ),
    /CAPACITY_HOLD_QUOTE_BINDING_IMMUTABLE/,
  );
});

test('a historical receipt with mismatched immutable owner facts is never reconstructed as success', async () => {
  const f = await fixture();
  const holds = service({ read: () => Promise.resolve(f.quote) });
  const k = key();
  await holds.createHold(meta(f.who), f.request, k);
  await owner.prisma.client.$executeRawUnsafe(
    "UPDATE app.idempotency_record SET response_body = jsonb_set(response_body - 'quoteRef', '{zoneId}', to_jsonb($2::text)) WHERE key = $1",
    k,
    randomUUID(),
  );
  await assert.rejects(
    holds.createHold(meta(f.who), f.request, k),
    /STORED_IDEMPOTENCY_RESPONSE_INVALID/,
  );
});

test('historical replacement receipts upcast both holds while preserving their original released/committed outcomes', async () => {
  const f = await fixture();
  const later = await defineWindow(owner.capacity, clock, 2, f.window.zoneId, 4 * 3_600_000);
  const second = {
    ...f.request,
    startsAt: later.startsAt,
    quoteRef: { quoteId: randomUUID(), revision: 1 },
  };
  const holds = service({
    read: (id) =>
      Promise.resolve(
        id === f.quote.quoteId ? f.quote : { ...f.quote, quoteId: second.quoteRef.quoteId },
      ),
  });
  const first = (await holds.createHold(meta(f.who), f.request, key())).body as { holdId: string };
  const target = (await holds.createHold(meta(f.who), second, key())).body as { holdId: string };
  const bookingId = randomUUID();
  const workload = meta({
    kind: 'SERVICE',
    clientId: 'booking',
    scopes: ['scheduling.hold.commit', 'scheduling.commitment.change'],
  });
  await holds.commitHold(workload, first.holdId, { bookingId, expectedRevision: 1 }, key());
  const change = { fromHoldId: first.holdId, toHoldId: target.holdId, toExpectedRevision: 1 };
  const k = key();
  const original = await owner.commitments.replaceCommitment(workload, bookingId, change, k);
  await owner.prisma.client.$executeRawUnsafe(
    "UPDATE app.idempotency_record SET response_body = jsonb_set(jsonb_set(response_body, '{released}', (response_body->'released') - 'quoteRef'), '{committed}', (response_body->'committed') - 'quoteRef') WHERE key = $1",
    k,
  );
  await owner.commitments.releaseCommitment(workload, bookingId, { holdId: target.holdId }, key());
  assert.deepEqual(
    await owner.commitments.replaceCommitment(workload, bookingId, change, k),
    original,
  );
});

test('runtime cannot downgrade, relocate, delete or replace the immutable hold authority of a historical receipt', async () => {
  const f = await fixture();
  const holds = service({ read: () => Promise.resolve(f.quote) });
  const k = key();
  const created = await holds.createHold(meta(f.who), f.request, k);
  const body = created.body as { holdId: string };
  const statements = [
    `UPDATE app.capacity_hold SET beneficiary_kind = NULL, beneficiary_subject = NULL,
       zone_id = NULL, booking_id = NULL, client_id = 'legacy-downgrade', holder_ref = gen_random_uuid(),
       idempotency_key = 'legacy-downgrade-key', request_fingerprint = repeat('a', 64)
       WHERE id = $1::uuid`,
    'UPDATE app.capacity_hold SET id = gen_random_uuid() WHERE id = $1::uuid',
    "UPDATE app.capacity_hold SET slot_ends_at = slot_ends_at + interval '1 minute' WHERE id = $1::uuid",
    'DELETE FROM app.capacity_hold WHERE id = $1::uuid',
    'WITH removed AS (DELETE FROM app.capacity_hold WHERE id = $1::uuid RETURNING *) INSERT INTO app.capacity_hold SELECT * FROM removed',
  ];
  for (const statement of statements) {
    await assert.rejects(
      owner.prisma.client.$executeRawUnsafe(statement, body.holdId),
      /CAPACITY_HOLD_SNAPSHOT_IMMUTABLE/,
    );
    assert.deepEqual(await holds.createHold(meta(f.who), f.request, k), created);
  }
  await assert.rejects(
    owner.prisma.client.$executeRawUnsafe(
      'UPDATE app.capacity_hold SET quote_id = gen_random_uuid() WHERE id = $1::uuid',
      body.holdId,
    ),
    /CAPACITY_HOLD_QUOTE_BINDING_IMMUTABLE/,
  );
  const [access] = await owner.prisma.client.$queryRawUnsafe<
    { truncate: boolean; execute: boolean }[]
  >(
    "SELECT has_table_privilege(current_user, 'app.capacity_hold', 'TRUNCATE') AS truncate, has_function_privilege(current_user, 'app.capacity_hold_quote_binding_immutable()', 'EXECUTE') AS execute",
  );
  assert.deepEqual(access, { truncate: false, execute: false });
  assert.equal(
    (await owner.store.findHold(body.holdId))?.quoteId,
    f.quote.quoteId,
    'the original hold and binding remain present after every denied replacement',
  );
});
