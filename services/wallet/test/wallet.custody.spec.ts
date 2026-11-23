import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ProjectionDeferred,
  ProjectionRejected,
  ZERO,
  applyStep,
  cashCollected,
  cashReversed,
  handoverChanged,
} from '../src/domain';
import { CustodyProjector } from '../src/application';
import { RandomIds } from '../src/infrastructure/system/system.adapters';
import { BillingCustodyEventHandler } from '../src/transport/messaging/consumer';
import {
  FixedClock,
  HOLDER,
  OTHER_HOLDER,
  collected,
  handover,
  reversed,
  syp,
} from './support/billing-events';
import { InMemoryWalletRepository } from './support/in-memory-wallet.repository';

function setup() {
  const repository = new InMemoryWalletRepository();
  const projector = new CustodyProjector({
    repository,
    clock: new FixedClock(new Date()),
    ids: new RandomIds(),
  });
  return { repository, projector };
}

function balances(repository: InMemoryWalletRepository, holder = HOLDER) {
  const account = repository.accounts.get(`${holder}:SYP`);
  if (!account) return null;
  return Object.fromEntries(Object.entries(account.balances).map(([k, v]) => [k, Number(v)]));
}

test('domain: collection, reversal and handover lifecycle move exact buckets', () => {
  const receipt = cashCollected({
    receiptId: randomUUID(),
    version: 1,
    holder: HOLDER,
    currency: 'SYP',
    amountMinor: 500n,
  });
  let account = applyStep(ZERO, receipt);
  assert.equal(account.held, 500n);
  const reversal = cashReversed({
    receipt: receipt.source,
    version: 2,
    currency: 'SYP',
    amountMinor: 500n,
  });
  assert.equal(applyStep(account, reversal).held, 0n);
  assert.throws(
    () => cashReversed({ receipt: receipt.source, version: 2, currency: 'SYP', amountMinor: 400n }),
    (e: unknown) => e instanceof ProjectionRejected && e.reason === 'AMOUNT_MISMATCH',
  );
  assert.throws(
    () => cashReversed({ receipt: null, version: 2, currency: 'SYP', amountMinor: 500n }),
    (e: unknown) => e instanceof ProjectionDeferred && e.reason === 'RECEIPT_NOT_YET_PROJECTED',
  );

  const id = randomUUID();
  const base = {
    handoverId: id,
    holder: HOLDER,
    currency: 'SYP' as const,
    declaredMinor: 500n,
    countedMinor: null,
    shortageMinor: null,
    overageMinor: null,
  };
  const declared = handoverChanged(null, {
    ...base,
    version: 1,
    previousStatus: null,
    status: 'PENDING',
  });
  account = applyStep(account, declared);
  assert.deepEqual([account.held, account.inHandover], [0n, 500n]);
  assert.throws(
    () => applyStep(ZERO, declared),
    (e: unknown) => e instanceof ProjectionDeferred,
  );
  const received = handoverChanged(declared.source, {
    ...base,
    version: 2,
    previousStatus: 'PENDING',
    status: 'RECEIVED',
    countedMinor: 450n,
    shortageMinor: 50n,
    overageMinor: 0n,
  });
  account = applyStep(account, received);
  assert.deepEqual([account.inHandover, account.deposited, account.shortage], [0n, 450n, 50n]);
  assert.throws(
    () =>
      handoverChanged(declared.source, {
        ...base,
        version: 2,
        previousStatus: 'PENDING',
        status: 'RECEIVED',
        countedMinor: 450n,
        shortageMinor: 0n,
        overageMinor: 0n,
      }),
    (e: unknown) => e instanceof ProjectionRejected && e.reason === 'AMOUNT_MISMATCH',
  );
  const reconciled = handoverChanged(received.source, {
    ...base,
    version: 3,
    previousStatus: 'RECEIVED',
    status: 'RECONCILED',
    countedMinor: 450n,
    shortageMinor: 50n,
    overageMinor: 0n,
  });
  account = applyStep(account, reconciled);
  assert.deepEqual([account.deposited, account.settled], [0n, 450n]);
  assert.throws(
    () =>
      handoverChanged(declared.source, {
        ...base,
        version: 3,
        previousStatus: 'RECEIVED',
        status: 'RECONCILED',
      }),
    (e: unknown) => e instanceof ProjectionDeferred && e.reason === 'HANDOVER_TRANSITION_GAP',
  );
  const cancelled = handoverChanged(declared.source, {
    ...base,
    version: 2,
    previousStatus: 'PENDING',
    status: 'CANCELLED',
  });
  assert.deepEqual([cancelled.delta.held, cancelled.delta.inHandover], [500n, -500n]);
});

test('projector: duplicate, stale, rejected and deferred deliveries never double-apply', async () => {
  const { repository, projector } = setup();
  const event = collected({ amount: syp(1_000) });
  assert.equal((await projector.project(event)).outcome, 'APPLIED');
  assert.equal((await projector.project(event)).outcome, 'DUPLICATE');
  assert.equal(balances(repository)?.held, 1_000);
  const receiptId = (event.aggregate as { id: string }).id;
  const stale = collected({ receiptId, amount: syp(1_000) });
  assert.equal((await projector.project(stale)).outcome, 'STALE');
  assert.equal(repository.inbox.get(stale.eventId as string)?.outcome, 'STALE');

  const early = reversed({ receiptId: randomUUID(), amount: syp(1_000) });
  await assert.rejects(projector.project(early), ProjectionDeferred);
  assert.equal(
    repository.inbox.has(early.eventId as string),
    false,
    'deferred events are not recorded',
  );

  const service = collected({ actor: { kind: 'service', id: 'booking' } });
  const rejected = await projector.project(service);
  assert.deepEqual(
    [rejected.outcome, rejected.outcome === 'REJECTED' ? rejected.reason : null],
    ['REJECTED', 'HOLDER_UNATTRIBUTABLE'],
  );
  assert.equal((await projector.project(service)).outcome, 'DUPLICATE');

  const poison = { ...collected({}), data: { amount: 'lots' } };
  const poisoned = await projector.project(poison);
  assert.deepEqual(
    [poisoned.outcome, poisoned.outcome === 'REJECTED' ? poisoned.reason : null],
    ['REJECTED', 'EVENT_INVALID'],
  );
  const unsupported = await projector.project({
    ...collected({}),
    eventType: 'billing.obligation-created.v1',
  });
  assert.equal(unsupported.outcome, 'REJECTED');
  const keyless = await projector.project({ hello: 'world' });
  assert.deepEqual(keyless, { outcome: 'REJECTED', eventId: null, reason: 'EVENT_UNSUPPORTED' });

  assert.equal(
    (await projector.project(reversed({ receiptId, amount: syp(1_000) }))).outcome,
    'APPLIED',
  );
  assert.equal(balances(repository)?.held, 0);
  assert.equal(repository.movements.length, 2);
  assert.equal(balances(repository, OTHER_HOLDER), null);
});

test('handler: deferred is a retryable 503 for the broker; rejected is acked', async () => {
  const { projector } = setup();
  const handler = new BillingCustodyEventHandler(projector);
  await assert.rejects(
    handler.handle({
      id: 'm1',
      type: 'billing.custody-handover-changed.v1',
      payload: handover({
        handoverId: randomUUID(),
        version: 1,
        previousStatus: null,
        status: 'PENDING',
        declared: syp(10),
      }),
    }),
    (e: unknown) =>
      (e as { status?: number; code?: string }).status === 503 &&
      (e as { code?: string }).code === 'PROJECTION_DEFERRED',
  );
  await handler.handle({ id: 'm2', type: 'x', payload: { nonsense: true } });
});
