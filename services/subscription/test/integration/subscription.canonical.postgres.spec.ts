import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { subscriptionV1 } from '@carwash/contracts';
import { Money } from '../../src/domain';
import type {
  FundingAuthority,
  PurchaseObligation,
  PurchaseOwners,
  PurchaseQuote,
} from '../../src/ports';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaSubscriptionRepository } from '../../src/infrastructure/persistence/prisma-subscription.repository';
import { PrismaFundingReleaseQueue } from '../../src/infrastructure/persistence/prisma-funding-release.queue';
import { FundingRecoveryService } from '../../src/application/funding-recovery.service';
import { CUSTOMER_SUBJECT, FixedClock, DAY } from '../support/subscription-fixtures';
import {
  BOOKING,
  DISPATCH,
  TOKENS,
  startSubscriptionHttp,
  type SubscriptionHttpHarness,
  type RequestOptions,
} from '../support/subscription-http-harness';

// Real owner database, migrations, HTTP and workload authentication across two
// replicas. Pricing/Billing are explicitly named test doubles; their own adapter
// and real-PostgreSQL suites independently prove authoritative monetary facts.
const database = process.env.SUBSCRIPTION_TEST_DATABASE_URL;
if (!database) throw new Error('SUBSCRIPTION_TEST_DATABASE_URL_REQUIRED');
const path = '/internal/v1/subscription';
const clock = new FixedClock(new Date('2026-11-27T10:00:00.000Z'));
const quotes = new Map<string, PurchaseQuote>();
const obligations = new Map<string, PurchaseObligation>();
const createKeys = new Map<string, string>();
const verified = new Set<string>();
const loseAnswer = new Set<string>();
const loseClaimAnswer = new Set<string>();
const amount = Money.parse({ currency: 'SYP', amountMinor: '600000', scale: 2 });
const owners: PurchaseOwners = {
  quote: (id) => Promise.resolve(quotes.get(id) ?? null),
  createObligation: (quoteId, _method, _credential, key) => {
    const prior = createKeys.get(key);
    const quote = quotes.get(quoteId);
    if (!quote) throw new Error('QUOTE_NOT_FOUND');
    let obligation = prior ? obligations.get(prior) : undefined;
    if (!obligation) {
      obligation = {
        obligationId: randomUUID(),
        quoteId,
        amount: quote.amount,
        status: 'OPEN',
        financialStatus: 'DUE',
      };
      obligations.set(obligation.obligationId, obligation);
      createKeys.set(key, obligation.obligationId);
    }
    if (loseAnswer.delete(quoteId)) throw new Error('TEST_REPLY_LOST_AFTER_OWNER_COMMIT');
    return Promise.resolve(obligation);
  },
  obligation: (id) => {
    const found = obligations.get(id);
    if (!found) throw new Error('NOT_FOUND');
    return Promise.resolve(found);
  },
};
const funding: FundingAuthority = {
  claim: (input) =>
    Promise.resolve(
      loseClaimAnswer.delete(input.obligationId)
        ? 'UNAVAILABLE'
        : verified.has(input.obligationId)
          ? 'CLAIMED'
          : 'NOT_VERIFIED',
    ),
  release: () => Promise.resolve('RELEASED'),
  verify: (input) =>
    Promise.resolve(verified.has(input.obligationId) ? 'VERIFIED' : 'NOT_VERIFIED'),
};
let prismaA: PrismaService;
let prismaB: PrismaService;
let a: SubscriptionHttpHarness;
let b: SubscriptionHttpHarness;
let sql: Client;
const key = () => randomUUID().replaceAll('-', '');
const code = (body: Record<string, unknown>) => (body.error as { code?: string } | undefined)?.code;
async function call(
  method: 'GET' | 'POST',
  route: string,
  options: RequestOptions = {},
  replica?: SubscriptionHttpHarness,
) {
  for (let retry = 0; ; retry++) {
    const result = await (replica ?? a).request(method, path + route, options);
    if (!(result.status === 503 && code(result.body) === 'SERVICE_BUSY') || retry >= 8)
      return result;
    await new Promise((resolve) => setTimeout(resolve, 100 * (retry + 1)));
  }
}
before(async () => {
  prismaA = new PrismaService(database);
  prismaB = new PrismaService(database);
  a = await startSubscriptionHttp({
    repository: new PrismaSubscriptionRepository(prismaA),
    clock,
    funding,
    owners,
  });
  b = await startSubscriptionHttp({
    repository: new PrismaSubscriptionRepository(prismaB),
    clock,
    funding,
    owners,
  });
  sql = new Client({ connectionString: database.replace(/\?.*$/, '') });
  await sql.connect();
  await sql.query('SET search_path TO app');
});
after(async () => {
  await a?.close();
  await b?.close();
  await prismaA?.onModuleDestroy();
  await prismaB?.onModuleDestroy();
  await sql?.end();
});

async function plan(units = 2) {
  const planId = randomUUID();
  const packageId = randomUUID();
  const request = {
    expectedRevision: 0,
    status: 'PUBLISHED',
    name: 'Prepaid verified washes',
    units,
    validityDays: 30,
    price: amount.toWire(),
    packageIds: [packageId],
    vehicleTypes: ['sedan'],
  };
  const publishKey = key();
  const result = await call('POST', `/plans/${planId}/versions`, {
    token: TOKENS.admin,
    key: publishKey,
    body: request,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const published = subscriptionV1.parsePlanV1(result.body);
  const quoteId = randomUUID();
  quotes.set(quoteId, {
    quoteId,
    planId,
    planVersion: 1,
    customerSubject: CUSTOMER_SUBJECT,
    amount,
    expiresAt: new Date(clock.now().getTime() + 900000),
  });
  const purchaseBody = {
    planId,
    planVersion: 1,
    quoteId,
    total: amount.toWire(),
    paymentMethod: 'SHAM_CASH',
  };
  return { planId, packageId, published, request, publishKey, quoteId, purchaseBody };
}
async function activate(units = 2) {
  const p = await plan(units);
  const created = await call('POST', '/purchases', {
    token: TOKENS.customer,
    key: key(),
    body: p.purchaseBody,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const purchaseId = String(created.body.purchaseId);
  const obligationId = String(created.body.obligationId);
  obligations.set(obligationId, {
    ...obligations.get(obligationId)!,
    status: 'SETTLED',
    financialStatus: 'PAID',
  });
  verified.add(obligationId);
  const active = await call('GET', `/purchases/${purchaseId}`, { token: TOKENS.customer });
  assert.equal(active.status, 200, JSON.stringify(active.body));
  assert.equal(active.body.status, 'ACTIVATED');
  return { ...p, purchaseId, obligationId, subscriptionId: String(active.body.subscriptionId) };
}

test('canonical published plan is public, immutable, and old command replay returns its original version', async () => {
  const p = await plan();
  const publicRead = await call('GET', `/plans/${p.planId}`);
  assert.equal(publicRead.status, 200);
  assert.deepEqual(publicRead.body, p.published);
  clock.advance(1);
  const next = await call('POST', `/plans/${p.planId}/versions`, {
    token: TOKENS.admin,
    key: key(),
    body: { ...p.request, expectedRevision: 1, name: 'Next published revision' },
  });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.equal(next.body.version, 2);
  const replay = await call(
    'POST',
    `/plans/${p.planId}/versions`,
    { token: TOKENS.admin, key: p.publishKey, body: p.request },
    b,
  );
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, p.published);
  assert.equal(
    (
      await call('POST', `/plans/${p.planId}/versions`, {
        token: TOKENS.customer,
        key: key(),
        body: p.request,
      })
    ).status,
    403,
  );
  const list = await call('GET', '/plans?limit=100');
  assert.equal(list.status, 200);
  assert.ok(
    (list.body.items as Record<string, unknown>[]).some((item) => item.planId === p.planId),
  );
});

test('purchase survives a lost Billing reply and activates exactly once only after verified funding', async () => {
  const p = await plan();
  const k = key();
  loseAnswer.add(p.quoteId);
  const lost = await call('POST', '/purchases', {
    token: TOKENS.customer,
    key: k,
    body: p.purchaseBody,
  });
  assert.equal(lost.status, 503, JSON.stringify(lost.body));
  const recovered = await call('GET', `/purchases/by-request/${k}`, { token: TOKENS.customer }, b);
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(subscriptionV1.parsePurchaseV1(recovered.body).status, 'PENDING_PAYMENT');
  assert.equal(
    (await call('GET', `/purchases/by-request/${k}`, { token: TOKENS.otherCustomer })).status,
    404,
  );
  assert.equal(
    (await call('GET', `/purchases/by-request/${key()}`, { token: TOKENS.customer })).status,
    404,
  );
  const replay = await call(
    'POST',
    '/purchases',
    { token: TOKENS.customer, key: k, body: p.purchaseBody },
    b,
  );
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  const pending = subscriptionV1.parsePurchaseV1(replay.body);
  assert.equal(pending.purchaseId, recovered.body.purchaseId);
  assert.equal(pending.status, 'PENDING_PAYMENT');
  assert.equal(pending.subscriptionId, null);
  const obligationId = pending.obligationId!;
  const pendingRecord = await sql.query(
    'SELECT subscription_id FROM app.subscription_purchase WHERE id=$1',
    [pending.purchaseId],
  );
  const legacyActivation = await call(
    'POST',
    `/subscriptions/${String(pendingRecord.rows[0].subscription_id)}/activate`,
    {
      token: TOKENS.admin,
      key: key(),
      body: { expectedVersion: 1, paymentReference: obligationId },
    },
  );
  assert.equal(legacyActivation.status, 409);
  assert.equal(code(legacyActivation.body), 'PURCHASE_NOT_ACTIVATABLE');
  assert.equal([...obligations.values()].filter((o) => o.quoteId === p.quoteId).length, 1);
  obligations.set(obligationId, {
    ...obligations.get(obligationId)!,
    status: 'SETTLED',
    financialStatus: 'PAID',
  });
  const unverified = await call('GET', `/purchases/${pending.purchaseId}`, {
    token: TOKENS.customer,
  });
  assert.equal(
    unverified.body.status,
    'PENDING_PAYMENT',
    'a SETTLED label alone is not funding proof',
  );
  verified.add(obligationId);
  const activated = await Promise.all(
    [a, b].map((replica) =>
      call('GET', `/purchases/${pending.purchaseId}`, { token: TOKENS.customer }, replica),
    ),
  );
  for (const result of activated) {
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.status, 'ACTIVATED');
  }
  assert.equal(activated[0]!.body.subscriptionId, activated[1]!.body.subscriptionId);
  const id = String(activated[0]!.body.subscriptionId);
  const recoveredActive = await call(
    'GET',
    `/purchases/by-request/${k}`,
    { token: TOKENS.customer },
    b,
  );
  assert.equal(recoveredActive.status, 200);
  assert.equal(recoveredActive.body.status, 'ACTIVATED');
  assert.equal(recoveredActive.body.subscriptionId, id);
  assert.equal(
    Number(
      (
        await sql.query(
          'SELECT count(*) AS n FROM app.subscription_period WHERE subscription_id=$1',
          [id],
        )
      ).rows[0].n,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await sql.query(
          "SELECT count(*) AS n FROM app.entitlement_movement WHERE subscription_id=$1 AND kind='GRANT'",
          [id],
        )
      ).rows[0].n,
    ),
    1,
  );
  assert.equal(
    (await call('GET', `/purchases/${pending.purchaseId}`, { token: TOKENS.otherCustomer })).status,
    404,
  );
  const sub = await call('GET', `/subscriptions/${id}`, { token: TOKENS.customer });
  assert.deepEqual(subscriptionV1.parseSubscriptionV1(sub.body).units, {
    total: 2,
    reserved: 0,
    consumed: 0,
    available: 2,
  });
  const cash = await call('POST', '/purchases', {
    token: TOKENS.customer,
    key: key(),
    body: { ...p.purchaseBody, paymentMethod: 'CASH_ON_COMPLETION' },
  });
  assert.equal(cash.status, 400, 'future cash collection cannot pre-fund units');
});

test('historical staff activation can no longer create units from an arbitrary payment reference', async () => {
  const p = await plan();
  const pending = await call('POST', '/subscriptions', {
    token: TOKENS.customer,
    key: key(),
    body: { planCode: `p-${p.planId}` },
  });
  assert.equal(pending.status, 201, JSON.stringify(pending.body));
  const denied = await call(
    'POST',
    `/subscriptions/${String(pending.body.subscriptionId)}/activate`,
    {
      token: TOKENS.admin,
      key: key(),
      body: { expectedVersion: 1, paymentReference: randomUUID() },
    },
  );
  assert.equal(denied.status, 409, JSON.stringify(denied.body));
  assert.equal(code(denied.body), 'PAYMENT_NOT_VERIFIED');
  const periods = await sql.query(
    'SELECT count(*) AS n FROM app.subscription_period WHERE subscription_id=$1',
    [pending.body.subscriptionId],
  );
  assert.equal(Number(periods.rows[0].n), 0);
});

test('last entitlement unit is fenced across replicas, same-key recovery is durable, consumed units cannot release', async () => {
  const p = await activate(1);
  const request = {
    subscriptionId: p.subscriptionId,
    expectedRevision: 2,
    beneficiary: { kind: 'account', subjectId: CUSTOMER_SUBJECT },
    bookingId: randomUUID(),
    packageId: p.packageId,
    vehicleType: 'sedan',
    scheduledFor: new Date(clock.now().getTime() + DAY).toISOString(),
  };
  const legacyReserve = await call('POST', '/reservations', {
    service: BOOKING,
    body: {
      subscriptionId: p.subscriptionId,
      bookingId: request.bookingId,
      customerSubject: CUSTOMER_SUBJECT,
      packageId: p.packageId,
      scheduledFor: request.scheduledFor,
    },
  });
  assert.equal(legacyReserve.status, 409);
  assert.equal(code(legacyReserve.body), 'LEGACY_OPERATION_NOT_ALLOWED');
  assert.equal(
    (
      await call('POST', '/entitlement-reservations', {
        service: DISPATCH,
        key: key(),
        body: request,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call('POST', '/entitlement-reservations', {
        service: BOOKING,
        token: TOKENS.customer,
        key: key(),
        body: request,
      })
    ).status,
    403,
  );
  const k = key();
  const raced = await Promise.all([
    call('POST', '/entitlement-reservations', { service: BOOKING, key: k, body: request }),
    call(
      'POST',
      '/entitlement-reservations',
      { service: BOOKING, key: key(), body: { ...request, bookingId: randomUUID() } },
      b,
    ),
  ]);
  assert.deepEqual(raced.map((x) => x.status).sort(), [201, 409], JSON.stringify(raced));
  const winner = raced.find((x) => x.status === 201)!;
  const reservation = subscriptionV1.parseEntitlementReservationV1(winner.body);
  const legacyConsume = await call('POST', `/reservations/${reservation.reservationId}/commit`, {
    service: BOOKING,
    body: {},
  });
  assert.equal(legacyConsume.status, 409);
  assert.equal(code(legacyConsume.body), 'LEGACY_OPERATION_NOT_ALLOWED');
  const existing = await call(
    'GET',
    `/entitlement-reservations?bookingId=${reservation.bookingId}`,
    { service: BOOKING },
    b,
  );
  assert.equal((existing.body.items as unknown[]).length, 1);
  const response = await call(
    'POST',
    `/entitlement-reservations/${reservation.reservationId}/resolution`,
    {
      service: BOOKING,
      key: k + 'c',
      body: { bookingId: reservation.bookingId, action: 'CONSUME' },
    },
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, 'CONSUMED');
  const replay = await call(
    'POST',
    `/entitlement-reservations/${reservation.reservationId}/resolution`,
    {
      service: BOOKING,
      key: k + 'c',
      body: { bookingId: reservation.bookingId, action: 'CONSUME' },
    },
    b,
  );
  assert.deepEqual(replay.body, response.body);
  const release = await call(
    'POST',
    `/entitlement-reservations/${reservation.reservationId}/resolution`,
    {
      service: BOOKING,
      key: key(),
      body: { bookingId: reservation.bookingId, action: 'RELEASE' },
    },
  );
  assert.equal(release.status, 409);
  const legacyReverse = await call('POST', `/reservations/${reservation.reservationId}/reverse`, {
    token: TOKENS.admin,
    key: key(),
    body: { reason: 'SERVICE_NOT_DELIVERED' },
  });
  assert.equal(legacyReverse.status, 409);
  assert.equal(code(legacyReverse.body), 'LEGACY_OPERATION_NOT_ALLOWED');
  const exhausted = subscriptionV1.parseSubscriptionV1(
    (await call('GET', `/subscriptions/${p.subscriptionId}`, { token: TOKENS.customer })).body,
  );
  assert.equal(exhausted.status, 'EXHAUSTED');
  assert.deepEqual(exhausted.units, { total: 1, reserved: 0, consumed: 1, available: 0 });
  assert.equal(
    Number(
      (
        await sql.query(
          "SELECT count(*) AS n FROM app.entitlement_movement WHERE subscription_id=$1 AND kind='COMMIT'",
          [p.subscriptionId],
        )
      ).rows[0].n,
    ),
    1,
  );
});

test('customer change stays pending until real management authority decides, without extending paid time', async () => {
  const p = await activate();
  const before = subscriptionV1.parseSubscriptionV1(
    (await call('GET', `/subscriptions/${p.subscriptionId}`, { token: TOKENS.customer })).body,
  );
  const eligibility = {
    packageId: p.packageId,
    vehicleType: 'sedan',
    scheduledFor: new Date(clock.now().getTime() + DAY).toISOString(),
  };
  const allowed = await call('POST', `/subscriptions/${p.subscriptionId}/eligibility`, {
    token: TOKENS.customer,
    body: eligibility,
  });
  assert.equal(allowed.status, 200);
  assert.equal(subscriptionV1.parseEligibilityV1(allowed.body).eligible, true);
  const wrongVehicle = await call('POST', `/subscriptions/${p.subscriptionId}/eligibility`, {
    token: TOKENS.customer,
    body: { ...eligibility, vehicleType: 'suv' },
  });
  assert.equal(subscriptionV1.parseEligibilityV1(wrongVehicle.body).reason, 'PACKAGE_NOT_COVERED');
  assert.equal(
    (
      await call('POST', `/subscriptions/${p.subscriptionId}/eligibility`, {
        token: TOKENS.otherCustomer,
        body: eligibility,
      })
    ).status,
    404,
  );
  const request = { expectedRevision: before.revision, action: 'FREEZE', reason: 'TRAVEL' };
  const pending = await call('POST', `/subscriptions/${p.subscriptionId}/changes`, {
    token: TOKENS.customer,
    key: key(),
    body: request,
  });
  assert.equal(pending.status, 201, JSON.stringify(pending.body));
  assert.equal(pending.body.status, 'PENDING_REVIEW');
  assert.equal((pending.body.subscription as Record<string, unknown>).status, 'ACTIVE');
  const route = `/subscriptions/${p.subscriptionId}/changes/${String(pending.body.changeId)}/decision`;
  assert.equal(
    (await call('POST', route, { token: TOKENS.customer, key: key(), body: { approve: true } }))
      .status,
    403,
  );
  const applied = await call('POST', route, {
    token: TOKENS.admin,
    key: key(),
    body: { approve: true },
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const change = subscriptionV1.parseSubscriptionChangeV1(applied.body);
  assert.equal(change.status, 'APPLIED');
  assert.equal(change.subscription.status, 'FROZEN');
  assert.equal(change.subscription.expiresAt, before.expiresAt);
  assert.equal(change.subscription.revision, before.revision + 1);
  const frozen = await call('POST', `/subscriptions/${p.subscriptionId}/eligibility`, {
    token: TOKENS.customer,
    body: eligibility,
  });
  assert.equal(subscriptionV1.parseEligibilityV1(frozen.body).reason, 'SUBSCRIPTION_FROZEN');
  await assert.rejects(
    sql.query('UPDATE app.subscription_purchase SET quote_id=$1,revision=revision+1 WHERE id=$2', [
      randomUUID(),
      p.purchaseId,
    ]),
  );
  await assert.rejects(
    sql.query(
      "UPDATE app.subscription_change_request SET status='PENDING_REVIEW',decided_by=NULL,decided_at=NULL WHERE id=$1",
      [pending.body.changeId],
    ),
  );
});

async function renewalPurchase(
  p: Awaited<ReturnType<typeof activate>>,
  options: { changedPlan?: boolean } = {},
) {
  const old = subscriptionV1.parseSubscriptionV1(
    (await call('GET', `/subscriptions/${p.subscriptionId}`, { token: TOKENS.customer })).body,
  );
  clock.advance(31 * DAY);
  let planVersion = 1;
  let renewalAmount = amount;
  if (options.changedPlan) {
    renewalAmount = Money.of('SYP', 650000n);
    const publish = await call('POST', `/plans/${p.planId}/versions`, {
      token: TOKENS.admin,
      key: key(),
      body: { ...p.request, expectedRevision: 1, units: 3, price: renewalAmount.toWire() },
    });
    assert.equal(publish.status, 201, JSON.stringify(publish.body));
    planVersion = 2;
  }
  const quoteId = randomUUID();
  quotes.set(quoteId, {
    quoteId,
    planId: p.planId,
    planVersion,
    customerSubject: CUSTOMER_SUBJECT,
    amount: renewalAmount,
    expiresAt: new Date(clock.now().getTime() + 900000),
  });
  const body = {
    ...p.purchaseBody,
    quoteId,
    planVersion,
    total: renewalAmount.toWire(),
    expectedRevision: old.revision,
  };
  const requestKey = key();
  const created = await call('POST', `/subscriptions/${p.subscriptionId}/renewals`, {
    token: TOKENS.customer,
    key: requestKey,
    body,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.notEqual(created.body.purchaseId, p.purchaseId);
  assert.notEqual(created.body.obligationId, p.obligationId);
  assert.deepEqual(created.body.renewalOf, { subscriptionId: p.subscriptionId, periodNo: 2 });
  return { old, body, requestKey, created, quoteId, planVersion, renewalAmount };
}

async function fundPurchase(purchaseId: string, obligationId: string) {
  obligations.set(obligationId, {
    ...obligations.get(obligationId)!,
    status: 'SETTLED',
    financialStatus: 'PAID',
  });
  verified.add(obligationId);
  return call('GET', `/purchases/${purchaseId}`, { token: TOKENS.customer });
}

test('canonical manual renewal owns a fresh quote, purchase and obligation; lost claim replies cannot duplicate grants', async () => {
  const p = await activate(2);
  const before = subscriptionV1.parseSubscriptionV1(
    (await call('GET', `/subscriptions/${p.subscriptionId}`, { token: TOKENS.customer })).body,
  );
  const premature = await call('POST', `/subscriptions/${p.subscriptionId}/renewals`, {
    token: TOKENS.customer,
    key: key(),
    body: { ...p.purchaseBody, quoteId: randomUUID(), expectedRevision: before.revision },
  });
  assert.equal(premature.status, 409);
  assert.equal(code(premature.body), 'PERIOD_NOT_ENDED');
  const r = await renewalPurchase(p, { changedPlan: true });
  const recovery = await call(
    'GET',
    `/purchases/by-request/${r.requestKey}`,
    { token: TOKENS.customer },
    b,
  );
  assert.equal(recovery.body.purchaseId, r.created.body.purchaseId);
  const replay = await call(
    'POST',
    `/subscriptions/${p.subscriptionId}/renewals`,
    { token: TOKENS.customer, key: r.requestKey, body: r.body },
    b,
  );
  assert.equal(replay.body.purchaseId, r.created.body.purchaseId);
  assert.equal(
    (
      await call('POST', `/subscriptions/${p.subscriptionId}/renewals`, {
        token: TOKENS.otherCustomer,
        key: key(),
        body: r.body,
      })
    ).status,
    404,
  );
  const purchaseId = String(r.created.body.purchaseId);
  const obligationId = String(r.created.body.obligationId);
  loseClaimAnswer.add(obligationId);
  assert.equal((await fundPurchase(purchaseId, obligationId)).status, 503);
  const activated = await call('GET', `/purchases/${purchaseId}`, { token: TOKENS.customer }, b);
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  assert.equal(activated.body.status, 'ACTIVATED');
  const current = subscriptionV1.parseSubscriptionV1(
    (await call('GET', `/subscriptions/${p.subscriptionId}`, { token: TOKENS.customer })).body,
  );
  assert.equal(current.purchaseId, purchaseId);
  assert.equal(current.planVersion, 2);
  assert.equal(current.units.total, 3);
  assert.equal(current.periodNo, 2);
  assert.equal(current.renewalAvailable, false);
  assert.equal(
    current.units.available,
    3,
    'expired unused units do not roll into the new purchase',
  );
  const periods = await sql.query(
    'SELECT period_no,payment_reference FROM app.subscription_period WHERE subscription_id=$1 ORDER BY period_no',
    [p.subscriptionId],
  );
  assert.deepEqual(
    periods.rows.map((row) => row.period_no),
    [1, 2],
  );
  assert.deepEqual(
    periods.rows.map((row) => row.payment_reference),
    [p.obligationId, obligationId],
  );
  const grants = await sql.query(
    "SELECT count(*)::int AS n FROM app.entitlement_movement WHERE subscription_id=$1 AND kind='GRANT'",
    [p.subscriptionId],
  );
  assert.equal(grants.rows[0].n, 2);
  await assert.rejects(
    sql.query('UPDATE app.subscription_purchase SET period_no=3,revision=revision+1 WHERE id=$1', [
      purchaseId,
    ]),
  );
});

test('cancellation release waits for reservations in every period and safely retries a lost Billing answer', async () => {
  const p = await activate();
  const current = subscriptionV1.parseSubscriptionV1(
    (await call('GET', `/subscriptions/${p.subscriptionId}`, { token: TOKENS.customer })).body,
  );
  const bookingId = randomUUID();
  const reserve = await call('POST', '/entitlement-reservations', {
    service: BOOKING,
    key: key(),
    body: {
      subscriptionId: p.subscriptionId,
      expectedRevision: current.revision,
      beneficiary: { kind: 'account', subjectId: CUSTOMER_SUBJECT },
      bookingId,
      packageId: p.packageId,
      scheduledFor: new Date(clock.now().getTime() + 3600000).toISOString(),
      vehicleType: 'sedan',
    },
  });
  assert.equal(reserve.status, 201, JSON.stringify(reserve.body));
  const r = await renewalPurchase(p);
  assert.equal(
    (await fundPurchase(String(r.created.body.purchaseId), String(r.created.body.obligationId)))
      .status,
    200,
  );
  const latest = subscriptionV1.parseSubscriptionV1(
    (await call('GET', `/subscriptions/${p.subscriptionId}`, { token: TOKENS.customer })).body,
  );
  const requested = await call('POST', `/subscriptions/${p.subscriptionId}/changes`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedRevision: latest.revision, action: 'CANCEL', reason: 'CUSTOMER_REQUEST' },
  });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const cancelled = await call(
    'POST',
    `/subscriptions/${p.subscriptionId}/changes/${String(requested.body.changeId)}/decision`,
    { token: TOKENS.admin, key: key(), body: { approve: true } },
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  const calls: string[] = [];
  let lose = true;
  const recoveryFunding: FundingAuthority = {
    ...funding,
    release: (input) => {
      calls.push(input.subscriptionId);
      if (input.subscriptionId === p.subscriptionId && lose) {
        lose = false;
        return Promise.resolve('UNAVAILABLE');
      }
      return Promise.resolve('RELEASED');
    },
  };
  const worker = new FundingRecoveryService({
    queue: new PrismaFundingReleaseQueue(prismaA.client),
    funding: recoveryFunding,
    clock,
    workerId: randomUUID(),
  });
  await worker.runBatch();
  assert.ok(
    !calls.includes(p.subscriptionId),
    'the current period has no reserves but the previous period still does',
  );
  const waiting = await call('GET', '/administration/funding-recovery', { token: TOKENS.admin });
  assert.equal(waiting.status, 200, JSON.stringify(waiting.body));
  assert.equal(
    (waiting.body.items as Array<Record<string, unknown>>).find(
      (row) => row.subscriptionId === p.subscriptionId,
    )?.status,
    'WAITING_RESERVATIONS',
  );
  assert.equal(
    (await call('GET', '/administration/funding-recovery', { token: TOKENS.customer })).status,
    403,
  );
  const released = await call(
    'POST',
    `/entitlement-reservations/${String(reserve.body.reservationId)}/resolution`,
    {
      service: BOOKING,
      key: key(),
      body: { bookingId, action: 'RELEASE' },
    },
  );
  assert.equal(released.status, 200, JSON.stringify(released.body));
  await sql.query(
    'UPDATE app.subscription_funding_release SET attempt_limit=1 WHERE subscription_id=$1',
    [p.subscriptionId],
  );
  await worker.runBatch();
  assert.equal(calls.filter((id) => id === p.subscriptionId).length, 1);
  assert.equal(
    (
      await sql.query(
        'SELECT released_at FROM app.subscription_funding_release WHERE subscription_id=$1',
        [p.subscriptionId],
      )
    ).rows[0].released_at,
    null,
  );
  const exhausted = await call('GET', '/administration/funding-recovery', { token: TOKENS.admin });
  assert.equal(
    (exhausted.body.items as Array<Record<string, unknown>>).find(
      (row) => row.subscriptionId === p.subscriptionId,
    )?.status,
    'ATTENTION_REQUIRED',
  );
  const retryPath = `/administration/funding-recovery/${p.subscriptionId}/retry`;
  assert.equal(
    (await call('POST', retryPath, { key: key(), body: { expectedAttempts: 1 } })).status,
    401,
  );
  assert.equal(
    (
      await call('POST', retryPath, {
        token: TOKENS.customer,
        key: key(),
        body: { expectedAttempts: 1 },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call('POST', retryPath, {
        token: TOKENS.admin,
        key: key(),
        body: { expectedAttempts: 2 },
      })
    ).status,
    409,
  );
  const retryKey = key();
  const retried = await Promise.all(
    [a, b].map((replica) =>
      call(
        'POST',
        retryPath,
        { token: TOKENS.admin, key: retryKey, body: { expectedAttempts: 1 } },
        replica,
      ),
    ),
  );
  assert.ok(
    retried.every((reply) => reply.status === 200),
    JSON.stringify(retried),
  );
  assert.equal(retried[0]!.body.attempts, 1, 'redrive must not reset the acquisition fence');
  assert.equal(retried[0]!.body.attemptLimit, 101);
  assert.equal(
    (
      await sql.query(
        "SELECT count(*)::int AS n FROM app.subscription_audit_event WHERE subscription_id=$1 AND action='subscription.funding-release-retried'",
        [p.subscriptionId],
      )
    ).rows[0].n,
    1,
  );
  await worker.runBatch();
  assert.equal(calls.filter((id) => id === p.subscriptionId).length, 2);
  assert.ok(
    (
      await sql.query(
        'SELECT released_at FROM app.subscription_funding_release WHERE subscription_id=$1',
        [p.subscriptionId],
      )
    ).rows[0].released_at,
  );
  await worker.runBatch();
  assert.equal(calls.filter((id) => id === p.subscriptionId).length, 2);
});

test('persisted entitlement periods fail closed until Billing re-establishes the funding claim; release remains available', async () => {
  const p = await activate();
  const current = subscriptionV1.parseSubscriptionV1(
    (await call('GET', `/subscriptions/${p.subscriptionId}`, { token: TOKENS.customer })).body,
  );
  const eligibility = {
    packageId: p.packageId,
    vehicleType: 'sedan',
    scheduledFor: new Date(clock.now().getTime() + 3600000).toISOString(),
  };
  const bookingId = randomUUID();
  const body = {
    ...eligibility,
    subscriptionId: p.subscriptionId,
    expectedRevision: current.revision,
    beneficiary: { kind: 'account', subjectId: CUSTOMER_SUBJECT },
    bookingId,
  };
  verified.delete(p.obligationId);
  assert.equal(
    (
      await call('POST', `/subscriptions/${p.subscriptionId}/eligibility`, {
        token: TOKENS.customer,
        body: eligibility,
      })
    ).status,
    409,
  );
  assert.equal(
    (await call('POST', '/entitlement-reservations', { service: BOOKING, key: key(), body }))
      .status,
    409,
  );
  assert.equal(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM app.entitlement_reservation WHERE subscription_id=$1',
        [p.subscriptionId],
      )
    ).rows[0].n,
    0,
  );
  verified.add(p.obligationId);
  const held = await call('POST', '/entitlement-reservations', {
    service: BOOKING,
    key: key(),
    body,
  });
  assert.equal(held.status, 201, JSON.stringify(held.body));
  verified.delete(p.obligationId);
  const resolution = `/entitlement-reservations/${String(held.body.reservationId)}/resolution`;
  assert.equal(
    (
      await call('POST', resolution, {
        service: BOOKING,
        key: key(),
        body: { bookingId, action: 'CONSUME' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call('POST', resolution, {
        service: BOOKING,
        key: key(),
        body: { bookingId, action: 'RELEASE' },
      })
    ).status,
    200,
  );
});
