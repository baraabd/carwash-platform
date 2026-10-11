import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CustodyIntegrityError,
  amountOf,
  applyHandoverFact,
  applyReceiptFact,
  parseWireAmount,
  positionOf,
  type HandoverFact,
  type HandoverState,
} from '../src/domain';
import { CustodyProjectionService, translate, WalletApplicationError } from '../src/application';
import { RandomIds, Sha256Hasher } from '../src/infrastructure/system/system.adapters';
import { BillingCustodyModel, prng, shuffle, type Currency } from './support/billing-history';
import { MemoryCustodyStore } from './support/memory-store';

const HOLDER = 'be6f7a8b-9c0d-4ebf-9a2b-5c6d7e8f9a0b';
const OTHER = 'cf7a8b9c-0d1e-4fc0-8b3c-6d7e8f9a0b1c';
const SYP = (minor: bigint) => amountOf('SYP', minor);
const fixedClock = { now: () => new Date('2026-10-11T09:00:00.000Z') };

function service(store = new MemoryCustodyStore()) {
  return {
    store,
    projection: new CustodyProjectionService({
      store,
      clock: fixedClock,
      hasher: new Sha256Hasher(),
      ids: new RandomIds(),
    }),
  };
}

const message = (e: { eventId: string; eventType: string }) => ({
  id: e.eventId,
  type: e.eventType,
  payload: e,
});

function handoverFact(overrides: Partial<HandoverFact> = {}): HandoverFact {
  return {
    kind: 'HANDOVER',
    eventId: randomUUID(),
    handoverId: 'aaaaaaaa-0000-4000-8000-000000000001',
    version: 1,
    holder: HOLDER,
    previousStatus: null,
    status: 'PENDING',
    receiptCount: 2,
    declared: SYP(1000n),
    counted: null,
    shortage: null,
    overage: null,
    ...overrides,
  };
}

// ------------------------------------------------------------------- domain

test('money: wire amounts are exact bigint minor units with the contract scale', () => {
  assert.equal(
    parseWireAmount({ currency: 'SYP', amountMinor: '999999999999999999', scale: 2 }).minor,
    999_999_999_999_999_999n,
  );
  assert.throws(() => parseWireAmount({ currency: 'SYP', amountMinor: '1.5', scale: 2 }));
  assert.throws(() => parseWireAmount({ currency: 'SYP', amountMinor: '100', scale: 3 }));
  assert.throws(() => parseWireAmount({ currency: 'EUR', amountMinor: '100', scale: 2 }));
  assert.throws(() => parseWireAmount({ currency: 'SYP', amountMinor: '-1', scale: 2 }));
});

test('receipt: collection then reversal; a repeat of either is STALE', () => {
  const collected = {
    kind: 'COLLECTED',
    eventId: randomUUID(),
    receiptId: 'r1',
    version: 1,
    holder: HOLDER,
    amount: SYP(500n),
  } as const;
  const first = applyReceiptFact(null, collected);
  assert.equal(first.outcome, 'APPLIED');
  if (first.outcome !== 'APPLIED') return;
  assert.deepEqual(
    first.movements.map((m) => m.kind),
    ['CASH_COLLECTED'],
  );
  assert.equal(
    applyReceiptFact(first.next, { ...collected, eventId: randomUUID() }).outcome,
    'STALE',
  );
  const reversal = {
    kind: 'REVERSED',
    eventId: randomUUID(),
    receiptId: 'r1',
    version: 2,
    amount: SYP(500n),
  } as const;
  const second = applyReceiptFact(first.next, reversal);
  assert.equal(second.outcome, 'APPLIED');
  if (second.outcome !== 'APPLIED') return;
  assert.equal(second.next.reversedEventId, reversal.eventId);
  assert.equal(applyReceiptFact(second.next, reversal).outcome, 'STALE');
});

test('receipt: a reversal before its collection is unattributed, then both attribute to the holder', () => {
  const reversal = {
    kind: 'REVERSED',
    eventId: randomUUID(),
    receiptId: 'r2',
    version: 2,
    amount: SYP(700n),
  } as const;
  const early = applyReceiptFact(null, reversal);
  assert.equal(early.outcome, 'APPLIED');
  if (early.outcome !== 'APPLIED') return;
  assert.equal(early.next.holder, null);
  assert.deepEqual(early.movements, []);
  const late = applyReceiptFact(early.next, {
    kind: 'COLLECTED',
    eventId: randomUUID(),
    receiptId: 'r2',
    version: 1,
    holder: HOLDER,
    amount: SYP(700n),
  });
  assert.equal(late.outcome, 'APPLIED');
  if (late.outcome !== 'APPLIED') return;
  assert.equal(late.next.holder, HOLDER);
  assert.deepEqual(
    late.movements.map((m) => [m.kind, m.eventId === reversal.eventId]),
    [
      ['CASH_COLLECTED', false],
      ['COLLECTION_REVERSED', true],
    ],
  );
  const position = positionOf(HOLDER, 'SYP', [late.next], []);
  assert.equal(position.collected, 700n);
  assert.equal(position.reversed, 700n);
  assert.equal(position.held, 0n);
});

test('receipt: contradictory facts are integrity faults, never merged', () => {
  const collected = applyReceiptFact(null, {
    kind: 'COLLECTED',
    eventId: randomUUID(),
    receiptId: 'r3',
    version: 1,
    holder: HOLDER,
    amount: SYP(100n),
  });
  if (collected.outcome !== 'APPLIED') throw new Error('setup');
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return error instanceof CustodyIntegrityError ? error.code : 'OTHER';
    }
    return 'NONE';
  };
  assert.equal(
    code(() =>
      applyReceiptFact(collected.next, {
        kind: 'REVERSED',
        eventId: randomUUID(),
        receiptId: 'r3',
        version: 2,
        amount: SYP(99n),
      }),
    ),
    'RECEIPT_AMOUNT_CONFLICT',
  );
  assert.equal(
    code(() =>
      applyReceiptFact(collected.next, {
        kind: 'COLLECTED',
        eventId: randomUUID(),
        receiptId: 'r3',
        version: 1,
        holder: OTHER,
        amount: SYP(100n),
      }),
    ),
    'RECEIPT_HOLDER_CONFLICT',
  );
  assert.equal(
    code(() =>
      applyReceiptFact(null, {
        kind: 'REVERSED',
        eventId: randomUUID(),
        receiptId: 'r4',
        version: 1,
        amount: SYP(1n),
      }),
    ),
    'REVERSAL_VERSION_INVALID',
  );
  assert.equal(
    code(() =>
      applyReceiptFact(null, {
        kind: 'COLLECTED',
        eventId: randomUUID(),
        receiptId: 'r5',
        version: 2,
        holder: HOLDER,
        amount: SYP(1n),
      }),
    ),
    'COLLECTION_VERSION_INVALID',
  );
});

test('handover: forward transitions apply; older revisions are STALE; regressions are rejected', () => {
  const pending = applyHandoverFact(null, handoverFact());
  if (pending.outcome !== 'APPLIED') throw new Error('setup');
  const received = handoverFact({
    version: 2,
    previousStatus: 'PENDING',
    status: 'RECEIVED',
    counted: SYP(900n),
    shortage: SYP(100n),
    overage: SYP(0n),
  });
  const afterReceive = applyHandoverFact(pending.next, received);
  assert.equal(afterReceive.outcome, 'APPLIED');
  if (afterReceive.outcome !== 'APPLIED') return;
  assert.equal(applyHandoverFact(afterReceive.next, handoverFact()).outcome, 'STALE');
  // Out of order: RECEIVED known first, PENDING (v1) is then STALE.
  const early = applyHandoverFact(null, received);
  if (early.outcome !== 'APPLIED') throw new Error('setup');
  assert.equal(applyHandoverFact(early.next, handoverFact()).outcome, 'STALE');
  // A cancelled handover cannot be received later.
  const cancelled = applyHandoverFact(
    pending.next,
    handoverFact({ version: 2, previousStatus: 'PENDING', status: 'CANCELLED' }),
  );
  if (cancelled.outcome !== 'APPLIED') throw new Error('setup');
  assert.throws(
    () => applyHandoverFact(cancelled.next, { ...received, version: 3 }),
    (e: unknown) => e instanceof CustodyIntegrityError && e.code === 'HANDOVER_TRANSITION_INVALID',
  );
  // Same revision, different status: contradiction.
  assert.throws(
    () =>
      applyHandoverFact(
        afterReceive.next,
        handoverFact({ version: 2, previousStatus: 'PENDING', status: 'CANCELLED' }),
      ),
    CustodyIntegrityError,
  );
});

test('handover: shape rules mirror the producer constraints', () => {
  const bad: Partial<HandoverFact>[] = [
    { counted: SYP(1000n), shortage: SYP(0n), overage: SYP(0n) }, // PENDING with counted
    { version: 2 }, // first revision must be 1 with no previous status
    { version: 2, previousStatus: 'PENDING', status: 'RECEIVED' }, // missing counts
    {
      version: 2,
      previousStatus: 'PENDING',
      status: 'RECEIVED',
      counted: SYP(900n),
      shortage: SYP(50n),
      overage: SYP(0n),
    },
    {
      version: 2,
      previousStatus: 'PENDING',
      status: 'RECEIVED',
      counted: SYP(1000n),
      shortage: SYP(1n),
      overage: SYP(1n),
    },
    {
      version: 2,
      previousStatus: 'CANCELLED',
      status: 'RECEIVED',
      counted: SYP(1000n),
      shortage: SYP(0n),
      overage: SYP(0n),
    },
    // Mixed currencies inside one handover.
    {
      version: 2,
      previousStatus: 'PENDING',
      status: 'RECEIVED',
      declared: amountOf('USD', 1000n),
      counted: SYP(1000n),
      shortage: SYP(0n),
      overage: SYP(0n),
    },
  ];
  for (const [index, overrides] of bad.entries()) {
    assert.throws(
      () => applyHandoverFact(null, handoverFact(overrides)),
      CustodyIntegrityError,
      `case ${index}`,
    );
  }
});

test('position: held excludes declared/received/settled cash; shortage stays separate', () => {
  const r = (id: string, minor: bigint, reversed = false) => ({
    receiptId: id,
    holder: HOLDER,
    amount: SYP(minor),
    collectedEventId: randomUUID(),
    reversedEventId: reversed ? randomUUID() : null,
    version: reversed ? 2 : 1,
  });
  const h = (
    status: HandoverState['status'],
    declared: bigint,
    counted: bigint | null,
  ): HandoverState => ({
    handoverId: randomUUID(),
    holder: HOLDER,
    status,
    receiptCount: 1,
    declared: SYP(declared),
    counted: counted === null ? null : SYP(counted),
    shortage: counted === null ? null : SYP(counted < declared ? declared - counted : 0n),
    overage: counted === null ? null : SYP(counted > declared ? counted - declared : 0n),
    version: 1,
    lastEventId: randomUUID(),
  });
  const p = positionOf(
    HOLDER,
    'SYP',
    [r('a', 100n), r('b', 200n), r('c', 300n, true), r('d', 400n), r('e', 500n)],
    [
      h('PENDING', 200n, null),
      h('RECEIVED', 400n, 350n),
      h('RECONCILED', 500n, 510n),
      h('CANCELLED', 100n, null),
    ],
  );
  assert.equal(p.collected, 1500n);
  assert.equal(p.reversed, 300n);
  assert.equal(p.held, 100n);
  assert.equal(p.inHandover, 200n);
  assert.equal(p.outstanding, 300n);
  assert.equal(p.receivedByTreasury, 400n);
  assert.equal(p.settled, 500n);
  assert.equal(p.shortage, 50n);
  assert.equal(p.overage, 10n);
  assert.equal(p.complete, true);
});

// -------------------------------------------------------------- application

test('translate: only the three custody events are facts; others are ignored or poison', () => {
  const model = new BillingCustodyModel();
  const e = model.collect(HOLDER, 'SYP', 100n);
  assert.equal(translate(e.eventId, e.eventType, e).kind, 'FACT');
  assert.deepEqual(translate(e.eventId, 'billing.obligation-created.v1', {}), {
    kind: 'IGNORED',
    reason: 'NOT_CUSTODY_EVENT',
  });
  assert.deepEqual(translate(e.eventId, 'catalog.package-updated.v1', {}), {
    kind: 'IGNORED',
    reason: 'UNKNOWN_EVENT_TYPE',
  });
  assert.deepEqual(translate(randomUUID(), e.eventType, e), {
    kind: 'POISON',
    reason: 'MESSAGE_ID_MISMATCH',
  });
  const extra = { ...e, data: { ...(e.data as object), phone: '0999' } };
  assert.equal(translate(e.eventId, e.eventType, extra).kind, 'POISON');
  const guest = { ...e, actor: { kind: 'service', id: 'billing' } };
  assert.deepEqual(translate(e.eventId, e.eventType, guest), {
    kind: 'POISON',
    reason: 'COLLECTOR_NOT_ACCOUNT',
  });
});

test('projection: duplicate delivery is idempotent; same id with other bytes is a recorded conflict', async () => {
  const { store, projection } = service();
  const model = new BillingCustodyModel();
  const e = model.collect(HOLDER, 'SYP', 150_000n);
  assert.equal(await projection.apply(message(e)), 'APPLIED');
  assert.equal(await projection.apply(message(e)), 'DUPLICATE');
  // Key order does not change the fingerprint.
  const reordered = Object.fromEntries(Object.entries(e).reverse()) as typeof e;
  assert.equal(await projection.apply(message(reordered)), 'DUPLICATE');
  const tampered = {
    ...e,
    data: { ...(e.data as object), amount: { currency: 'SYP', amountMinor: '1', scale: 2 } },
  };
  await assert.rejects(
    projection.handle({ id: e.eventId, type: e.eventType, payload: tampered }),
    (error: unknown) => error instanceof WalletApplicationError && error.status === 409,
  );
  assert.equal(store.state.conflicts.length, 1);
  assert.equal(store.state.movements.length, 1);
  const [account] = await store.accounts(HOLDER);
  assert.equal(account?.totals.collected, 150_000n);
});

test('projection: poison and unknown events are recorded once and never change balances', async () => {
  const { store, projection } = service();
  const id = randomUUID();
  assert.equal(
    await projection.apply({ id, type: 'billing.cash-collected.v1', payload: '{not json' }),
    'POISON',
  );
  assert.equal(
    await projection.apply({ id, type: 'billing.cash-collected.v1', payload: '{not json' }),
    'DUPLICATE',
  );
  assert.equal(
    await projection.apply({
      id: randomUUID(),
      type: 'billing.refund-status-changed.v1',
      payload: {},
    }),
    'IGNORED',
  );
  assert.equal(store.state.inbox.get(id)?.reason, 'PAYLOAD_NOT_JSON');
  assert.equal(store.state.accounts.size, 0);
  await assert.rejects(
    projection.apply({ id: 'not-a-uuid', type: 'x.y', payload: {} }),
    WalletApplicationError,
  );
});

test('projection: a failed commit leaves no inbox row, so redelivery applies once', async () => {
  const { store, projection } = service();
  const e = new BillingCustodyModel().collect(HOLDER, 'USD', 4200n);
  store.failNextCommit = true;
  await assert.rejects(projection.apply(message(e)), /SIMULATED_COMMIT_FAILURE/);
  assert.equal(store.state.inbox.size, 0);
  assert.equal(await projection.apply(message(e)), 'APPLIED');
  assert.equal(store.state.movements.length, 1);
});

test('projection: integrity faults are recorded as POISON without touching state', async () => {
  const { store, projection } = service();
  const model = new BillingCustodyModel();
  const e = model.collect(HOLDER, 'SYP', 100n);
  await projection.apply(message(e));
  const r = model.reverse({ id: (e.aggregate as { id: string }).id });
  const wrong = {
    ...r,
    data: { ...(r.data as object), amount: { currency: 'SYP', amountMinor: '99', scale: 2 } },
  };
  assert.equal(
    await projection.apply({ id: r.eventId, type: r.eventType, payload: wrong }),
    'POISON',
  );
  assert.equal(store.state.inbox.get(r.eventId)?.reason, 'RECEIPT_AMOUNT_CONFLICT');
  const [account] = await store.accounts(HOLDER);
  assert.equal(account?.totals.reversed, 0n);
});

// ------------------------------------------------------------ model-based

test('model-based: any delivery order with duplicates converges to Billing truth', async () => {
  const holders = [HOLDER, OTHER, 'd08b9c0d-1e2f-4ad1-9c4d-7e8f9a0b1c2d'];
  const currencies: Currency[] = ['SYP', 'USD'];
  for (let seed = 1; seed <= 40; seed++) {
    const random = prng(seed);
    const model = new BillingCustodyModel(random);
    const steps = 20 + Math.floor(random() * 80);
    for (let i = 0; i < steps; i++) model.step(holders, currencies);
    const duplicates = model.events.filter(() => random() < 0.3);
    const deliveries = shuffle([...model.events, ...duplicates], random);
    const { store, projection } = service();
    const outcomes = new Map<string, number>();
    for (const event of deliveries) {
      const outcome = await projection.apply(message(event));
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
    }
    assert.equal(outcomes.get('CONFLICT') ?? 0, 0, `seed ${seed}`);
    assert.equal(outcomes.get('POISON') ?? 0, 0, `seed ${seed}`);
    for (const holder of holders) {
      for (const currency of currencies) {
        const truth = model.truth(holder, currency);
        const views = await store.accounts(holder);
        const view = views.find((v) => v.currency === currency);
        if (truth.collected === 0n) {
          assert.equal(view, undefined, `seed ${seed} ${holder} ${currency}`);
          continue;
        }
        const p = positionOf(
          holder,
          currency,
          [...store.state.receipts.values()],
          [...store.state.handovers.values()],
        );
        assert.deepEqual(
          {
            collected: p.collected,
            reversed: p.reversed,
            held: p.held,
            inHandover: p.inHandover,
            receivedByTreasury: p.receivedByTreasury,
            settled: p.settled,
            shortage: p.shortage,
            overage: p.overage,
          },
          truth,
          `seed ${seed} ${holder} ${currency}`,
        );
        assert.deepEqual(view?.totals, {
          collected: truth.collected,
          reversed: truth.reversed,
          inHandover: truth.inHandover,
          receivedByTreasury: truth.receivedByTreasury,
          settled: truth.settled,
          shortage: truth.shortage,
          overage: truth.overage,
        });
      }
    }
    // Every movement references a Billing event the inbox applied.
    for (const m of store.state.movements)
      assert.equal(store.state.inbox.get(m.eventId)?.outcome, 'APPLIED');
  }
});
