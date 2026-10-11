import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { parseEnvelopeV2 } from '@carwash/event-contracts';
import {
  parseEntitlementChangedData,
  parseEntitlementReservedData,
  parseSubscriptionChangedData,
} from '../../src/application';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaSubscriptionRepository } from '../../src/infrastructure/persistence/prisma-subscription.repository';
import {
  CUSTOMER_SUBJECT,
  DAY,
  FixedClock,
  OTHER_CUSTOMER_SUBJECT,
  termsFixture,
} from '../support/subscription-fixtures';
import {
  BOOKING,
  DISPATCH,
  TOKENS,
  startSubscriptionHttp,
  type RequestOptions,
  type SubscriptionHttpHarness,
} from '../support/subscription-http-harness';

/*
 * REAL PostgreSQL evidence, run as the least-privileged runtime role
 * (cw_subscription_app) on a database migrated by cw_subscription_migrate
 * through scripts/production/B/postgres-acceptance.mjs. Two replicas with
 * separate connection pools share one database. Identity is a local HTTP stub;
 * service credentials go through the real shared ServiceClientAuthenticator.
 * No skip: missing configuration fails the run.
 */
const APP_URL = process.env.SUBSCRIPTION_TEST_DATABASE_URL;
if (!APP_URL) throw new Error('SUBSCRIPTION_TEST_DATABASE_URL_REQUIRED');
const DATABASE_URL: string = APP_URL;
const PATH = '/internal/v1/subscription';

let prismaA: PrismaService;
let prismaB: PrismaService;
let clock: FixedClock;
let replicaA: SubscriptionHttpHarness;
let replicaB: SubscriptionHttpHarness;
let sql: Client;
let seq = 0;
const key = () => `pg-sub-key-${String(++seq).padStart(6, '0')}-${process.pid}`;
const code = () => `plan-${process.pid}-${++seq}`;

type Body = Record<string, unknown>;

function errorCode(body: Body): string | undefined {
  return (body.error as { code?: string } | undefined)?.code;
}

/**
 * Like the Booking saga, a caller retries the SAME request on 503 SERVICE_BUSY
 * (nothing was committed). Every command is idempotent, so a retry can never
 * take a second unit; on a loaded host the busy answer is expected.
 */
async function call(
  method: 'GET' | 'POST',
  path: string,
  options: RequestOptions = {},
  replica = replicaA,
) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await replica.request(method, `${PATH}${path}`, options);
    const busy = response.status === 503 && errorCode(response.body) === 'SERVICE_BUSY';
    if (!busy || attempt >= 10) return response;
    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
  }
}

async function publish(planCode: string, overrides: Record<string, unknown> = {}): Promise<Body> {
  const head = await call('GET', `/plans/${planCode}`, { token: TOKENS.admin });
  const revisions = head.status === 200 ? (head.body.revisions as Body[]) : [];
  const response = await call('POST', `/plans/${planCode}/revisions`, {
    token: TOKENS.admin,
    key: key(),
    body: {
      expectedRevision: revisions.length,
      effectiveFrom: null,
      terms: termsFixture(overrides),
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

/** A customer subscription activated by the admin on a fresh plan. */
async function activeSubscription(
  overrides: Record<string, unknown> = {},
  token = TOKENS.customer,
) {
  const planCode = code();
  await publish(planCode, overrides);
  const requested = await call('POST', '/subscriptions', { token, key: key(), body: { planCode } });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const id = requested.body.subscriptionId as string;
  // Staff never activate their own subscription: the second admin activates the first admin's.
  const activated = await call('POST', `/subscriptions/${id}/activate`, {
    token: token === TOKENS.admin ? TOKENS.secondAdmin : TOKENS.admin,
    key: key(),
    body: { expectedVersion: 1, paymentReference: randomUUID() },
  });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  return { id, planCode, body: activated.body };
}

function reserveBody(subscriptionId: string, overrides: Record<string, unknown> = {}): Body {
  return {
    subscriptionId,
    bookingId: randomUUID(),
    customerSubject: CUSTOMER_SUBJECT,
    packageId: 'exterior',
    scheduledFor: new Date(clock.now().getTime() + DAY).toISOString(),
    ...overrides,
  };
}

function reserve(body: Body, replica = replicaA) {
  return call('POST', '/reservations', { service: BOOKING, body }, replica);
}

async function period(
  subscriptionId: string,
): Promise<{ reserved: number; consumed: number; granted: number }> {
  const row = await sql.query(
    `SELECT reserved, consumed, granted FROM subscription_period WHERE subscription_id = $1 ORDER BY period_no DESC LIMIT 1`,
    [subscriptionId],
  );
  return row.rows[0] as { reserved: number; consumed: number; granted: number };
}

async function ledgerBalanced(subscriptionId: string): Promise<boolean> {
  const ledger = await call('GET', `/subscriptions/${subscriptionId}/ledger`, {
    token: TOKENS.admin,
  });
  assert.equal(ledger.status, 200, JSON.stringify(ledger.body));
  return ledger.body.balanced === true;
}

/** Runs statements in one transaction as the runtime role; returns the error message, if any. */
async function attack(statements: [string, unknown[]][]): Promise<string | null> {
  const client = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await client.connect();
  try {
    await client.query('SET search_path TO app');
    await client.query('BEGIN');
    for (const [statement, values] of statements) await client.query(statement, values);
    await client.query('COMMIT');
    return null;
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    return error instanceof Error ? error.message : String(error);
  } finally {
    await client.end();
  }
}

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  prismaA = new PrismaService(DATABASE_URL);
  prismaB = new PrismaService(DATABASE_URL);
  replicaA = await startSubscriptionHttp({
    repository: new PrismaSubscriptionRepository(prismaA),
    clock,
  });
  replicaB = await startSubscriptionHttp({
    repository: new PrismaSubscriptionRepository(prismaB),
    clock,
  });
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await sql.connect();
  await sql.query('SET search_path TO app');
});

after(async () => {
  await replicaA?.close();
  await replicaB?.close();
  await prismaA?.onModuleDestroy();
  await prismaB?.onModuleDestroy();
  await sql?.end();
});

test('runs as the runtime role, which cannot change the schema', async () => {
  const who = await sql.query('SELECT current_user');
  assert.equal(who.rows[0].current_user, 'cw_subscription_app');
  await assert.rejects(sql.query('CREATE TABLE app.intruder (id int)'));
});

test('plan revisions: linear chain, schedule windows, idempotent publish, staff-only, immutable', async () => {
  const planCode = code();
  const first = await publish(planCode);
  assert.equal(first.revision, 1);
  const stale = await call('POST', `/plans/${planCode}/revisions`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedRevision: 0, effectiveFrom: null, terms: termsFixture() },
  });
  assert.equal(stale.status, 409);
  assert.equal(errorCode(stale.body), 'REVISION_CONFLICT');

  const scheduledKey = key();
  const scheduledBody = {
    expectedRevision: 1,
    effectiveFrom: new Date(clock.now().getTime() + DAY).toISOString(),
    terms: termsFixture({ washUnits: 4 }),
  };
  const scheduled = await call('POST', `/plans/${planCode}/revisions`, {
    token: TOKENS.admin,
    key: scheduledKey,
    body: scheduledBody,
  });
  assert.equal(scheduled.status, 201);
  const replay = await call(
    'POST',
    `/plans/${planCode}/revisions`,
    { token: TOKENS.admin, key: scheduledKey, body: scheduledBody },
    replicaB,
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.deepEqual(replay.body, scheduled.body);
  const reused = await call('POST', `/plans/${planCode}/revisions`, {
    token: TOKENS.admin,
    key: scheduledKey,
    body: { ...scheduledBody, terms: termsFixture({ washUnits: 5 }) },
  });
  assert.equal(reused.status, 409);
  assert.equal(errorCode(reused.body), 'IDEMPOTENCY_CONFLICT');

  const plan = await call('GET', `/plans/${planCode}`, { token: TOKENS.admin });
  const windows = (plan.body.revisions as Body[]).map((r) => [r.revision, r.effectiveUntil]);
  assert.deepEqual(windows, [
    [1, scheduledBody.effectiveFrom],
    [2, null],
  ]);
  const offers = await call('GET', '/offers', { token: TOKENS.customer });
  const offered = (offers.body.offers as Body[]).find((o) => o.planCode === planCode);
  assert.equal(offered?.revision, 1, 'the scheduled revision is not yet in force');

  for (const token of [TOKENS.customer, TOKENS.reader]) {
    const denied = await call('POST', `/plans/${code()}/revisions`, {
      token,
      key: key(),
      body: { expectedRevision: 0, effectiveFrom: null, terms: termsFixture() },
    });
    assert.equal(denied.status, 403);
  }
  assert.equal((await call('GET', '/plans', { token: TOKENS.unknown })).status, 401);
  assert.equal((await call('GET', '/plans', { token: TOKENS.customer })).status, 403);

  const rejected = await call('POST', `/plans/${planCode}/revisions`, {
    token: TOKENS.admin,
    key: key(),
    body: {
      expectedRevision: 2,
      effectiveFrom: null,
      terms: termsFixture({ price: { currency: 'EUR', amountMinor: '1', scale: 2 } }),
    },
  });
  assert.equal(rejected.status, 422);
  assert.equal(errorCode(rejected.body), 'TERMS_INVALID');

  const tamper = await attack([
    [`UPDATE subscription_plan_revision SET wash_units = 9 WHERE plan_code = $1`, [planCode]],
  ]);
  assert.match(tamper ?? '', /SUBSCRIPTION_APPEND_ONLY/);
  const audit = await sql.query(
    `SELECT action, outcome FROM subscription_audit_event WHERE plan_code = $1 ORDER BY occurred_at, outcome`,
    [planCode],
  );
  assert.ok(
    audit.rows.some(
      (r) =>
        r.action === 'subscription.plan.revision-rejected' && r.outcome === 'REVISION_CONFLICT',
    ),
  );
  assert.equal(
    audit.rows.filter((r) => r.action === 'subscription.plan.revision-published').length,
    2,
  );
});

test('request and activation: snapshot terms, one open subscription, payment funds one period, separation of duties', async () => {
  const planCode = code();
  await publish(planCode);
  const guest = await call('POST', '/subscriptions', {
    token: TOKENS.guest,
    key: key(),
    body: { planCode },
  });
  assert.equal(guest.status, 403, 'a guest cannot own a subscription');
  const requested = await call('POST', '/subscriptions', {
    token: TOKENS.customer,
    key: key(),
    body: { planCode },
  });
  assert.equal(requested.status, 201);
  assert.equal(requested.body.status, 'PENDING_ACTIVATION');
  const id = requested.body.subscriptionId as string;
  const duplicate = await call('POST', '/subscriptions', {
    token: TOKENS.customer,
    key: key(),
    body: { planCode },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(errorCode(duplicate.body), 'SUBSCRIPTION_ALREADY_OPEN');
  assert.equal(
    (
      await call('POST', '/subscriptions', {
        token: TOKENS.customer,
        key: key(),
        body: { planCode: 'missing-plan' },
      })
    ).status,
    409,
  );

  // A newer revision does not change what this customer asked to buy.
  clock.advance(1_000);
  await publish(planCode, { washUnits: 9 });
  const payment = randomUUID();
  const stale = await call('POST', `/subscriptions/${id}/activate`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedVersion: 2, paymentReference: payment },
  });
  assert.equal(stale.status, 409);
  assert.equal(errorCode(stale.body), 'VERSION_CONFLICT');
  const activated = await call(
    'POST',
    `/subscriptions/${id}/activate`,
    { token: TOKENS.admin, key: key(), body: { expectedVersion: 1, paymentReference: payment } },
    replicaB,
  );
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  assert.equal(activated.body.status, 'ACTIVE');
  const activePeriod = activated.body.period as Body;
  assert.deepEqual(
    [activePeriod.granted, activePeriod.available, activePeriod.paymentReference],
    [2, 2, payment],
  );

  const own = await activeSubscriptionRequestByAdmin();
  const self = await call('POST', `/subscriptions/${own}/activate`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedVersion: 1, paymentReference: randomUUID() },
  });
  assert.equal(self.status, 403);
  assert.equal(errorCode(self.body), 'SELF_SERVICE_FORBIDDEN');
  const reusedPayment = await call('POST', `/subscriptions/${own}/activate`, {
    token: TOKENS.secondAdmin,
    key: key(),
    body: { expectedVersion: 1, paymentReference: payment },
  });
  assert.equal(reusedPayment.status, 409);
  assert.equal(errorCode(reusedPayment.body), 'PAYMENT_REFERENCE_USED');

  const customerView = await call('GET', `/subscriptions/${id}`, { token: TOKENS.customer });
  assert.equal(customerView.status, 200);
  assert.equal(
    (customerView.body.period as Body).paymentReference,
    undefined,
    'customers never see the funding reference',
  );
  assert.equal(
    (await call('GET', `/subscriptions/${id}`, { token: TOKENS.otherCustomer })).status,
    404,
  );
  assert.equal(
    (await call('GET', `/subscriptions/not-a-uuid`, { token: TOKENS.customer })).status,
    404,
  );
  const mine = await call('GET', '/subscriptions', { token: TOKENS.customer });
  assert.ok((mine.body.subscriptions as Body[]).some((s) => s.subscriptionId === id));
  const staffList = await call('GET', `/customers/${CUSTOMER_SUBJECT}/subscriptions`, {
    token: TOKENS.admin,
  });
  assert.ok((staffList.body.subscriptions as Body[]).some((s) => s.subscriptionId === id));

  const events = await sql.query(
    `SELECT payload FROM outbox_message WHERE payload::jsonb -> 'aggregate' ->> 'id' = $1 ORDER BY payload::jsonb -> 'aggregate' -> 'version'`,
    [id],
  );
  const parsed = events.rows.map((row: { payload: string }) =>
    parseEnvelopeV2(
      JSON.parse(row.payload),
      {
        eventType: 'subscription.subscription-changed.v1',
        producer: 'subscription',
        aggregateType: 'subscription',
      },
      parseSubscriptionChangedData,
    ),
  );
  assert.deepEqual(
    parsed.map((e) => [
      e.aggregate.version,
      e.data.previousStatus,
      e.data.status,
      e.data.unitsGranted,
    ]),
    [
      [1, null, 'PENDING_ACTIVATION', null],
      [2, 'PENDING_ACTIVATION', 'ACTIVE', 2],
    ],
  );
  assert.ok(
    events.rows.every((row: { payload: string }) => !row.payload.includes(payment)),
    'no payment reference in events',
  );
});

async function activeSubscriptionRequestByAdmin(): Promise<string> {
  const planCode = code();
  await publish(planCode);
  const requested = await call('POST', '/subscriptions', {
    token: TOKENS.admin,
    key: key(),
    body: { planCode },
  });
  assert.equal(requested.status, 201);
  return requested.body.subscriptionId as string;
}

test('race: concurrent bookings across replicas never consume the last unit twice', async () => {
  for (let round = 0; round < 5; round += 1) {
    const { id } = await activeSubscription({ washUnits: 2 });
    assert.equal((await reserve(reserveBody(id))).status, 201);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        reserve(reserveBody(id), index % 2 === 0 ? replicaA : replicaB),
      ),
    );
    const statuses = attempts.map((a) => a.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409], `round ${round}`);
    assert.ok(
      attempts
        .filter((a) => a.status === 409)
        .every((a) => errorCode(a.body) === 'ENTITLEMENT_EXHAUSTED'),
    );
    assert.deepEqual(await period(id), { reserved: 2, consumed: 0, granted: 2 });
    assert.equal(await ledgerBalanced(id), true);
  }
});

test('race: retried reserves for one booking return one reservation and take one unit', async () => {
  const { id } = await activeSubscription({ washUnits: 3 });
  const body = reserveBody(id);
  const attempts = await Promise.all(
    Array.from({ length: 6 }, (_, index) => reserve(body, index % 2 === 0 ? replicaA : replicaB)),
  );
  assert.deepEqual(attempts.map((a) => a.status).sort(), [200, 200, 200, 200, 200, 201]);
  assert.equal(new Set(attempts.map((a) => a.body.reservationId)).size, 1);
  assert.deepEqual(await period(id), { reserved: 1, consumed: 0, granted: 3 });
  const changed = await reserve({ ...body, packageId: 'interior' });
  assert.equal(changed.status, 409);
  assert.equal(errorCode(changed.body), 'RESERVATION_CONFLICT');

  const other = await activeSubscription({ washUnits: 3 });
  const elsewhere = await reserve({ ...body, subscriptionId: other.id });
  assert.equal(elsewhere.status, 409, 'a booking holds at most one live unit across subscriptions');
  assert.equal(errorCode(elsewhere.body), 'BOOKING_ALREADY_RESERVED');
  assert.deepEqual(await period(other.id), { reserved: 0, consumed: 0, granted: 3 });

  const recovery = await call('GET', `/reservations?bookingId=${body.bookingId as string}`, {
    service: BOOKING,
  });
  assert.equal((recovery.body.reservations as Body[]).length, 1);
});

test('settlement: commit/release are idempotent, release compensates, conflicting settlements race safely', async () => {
  const { id } = await activeSubscription({ washUnits: 2 });
  const held = await reserve(reserveBody(id));
  const reservationId = held.body.reservationId as string;
  const released = await call('POST', `/reservations/${reservationId}/release`, {
    service: BOOKING,
    body: { reason: 'BOOKING_CANCELLED' },
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.status, 'RELEASED');
  const again = await call(
    'POST',
    `/reservations/${reservationId}/release`,
    { service: BOOKING, body: { reason: 'SAGA_COMPENSATION' } },
    replicaB,
  );
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('idempotency-replayed'), 'true');
  assert.equal(again.body.reason, 'BOOKING_CANCELLED');
  const late = await call('POST', `/reservations/${reservationId}/commit`, { service: BOOKING });
  assert.equal(late.status, 409);
  assert.equal(errorCode(late.body), 'RESERVATION_NOT_RESERVED');
  assert.deepEqual(
    await period(id),
    { reserved: 0, consumed: 0, granted: 2 },
    'the released unit is available again',
  );

  for (let round = 0; round < 4; round += 1) {
    const next = await reserve(reserveBody(id));
    const rid = next.body.reservationId as string;
    const [commit, release] = await Promise.all([
      call('POST', `/reservations/${rid}/commit`, { service: DISPATCH }, replicaA),
      call(
        'POST',
        `/reservations/${rid}/release`,
        { service: BOOKING, body: { reason: 'BOOKING_FAILED' } },
        replicaB,
      ),
    ]);
    const winners = [commit, release].filter((r) => r.status === 200);
    assert.equal(winners.length, 1, `round ${round}: exactly one settlement wins`);
    assert.equal(
      errorCode([commit, release].find((r) => r.status === 409)?.body ?? {}),
      'RESERVATION_NOT_RESERVED',
    );
    if (commit.status === 200) {
      const replayed = await call('POST', `/reservations/${rid}/commit`, { service: BOOKING });
      assert.equal(replayed.headers.get('idempotency-replayed'), 'true');
      break;
    }
  }
  assert.equal(await ledgerBalanced(id), true);

  const events = await sql.query(
    `SELECT event_type, payload FROM outbox_message WHERE payload::jsonb -> 'aggregate' ->> 'id' = $1`,
    [reservationId],
  );
  const types = events.rows.map((r: { event_type: string }) => r.event_type).sort();
  assert.deepEqual(types, [
    'subscription.entitlement-reservation-changed.v1',
    'subscription.entitlement-reserved.v1',
  ]);
  for (const row of events.rows as { event_type: string; payload: string }[]) {
    const envelope = JSON.parse(row.payload) as unknown;
    if (row.event_type === 'subscription.entitlement-reserved.v1')
      parseEnvelopeV2(
        envelope,
        {
          eventType: row.event_type,
          producer: 'subscription',
          aggregateType: 'subscription-entitlement',
        },
        parseEntitlementReservedData,
      );
    else {
      const parsed = parseEnvelopeV2(
        envelope,
        {
          eventType: row.event_type,
          producer: 'subscription',
          aggregateType: 'subscription-entitlement',
        },
        parseEntitlementChangedData,
      );
      assert.deepEqual(
        [parsed.actor, parsed.data.status, parsed.data.reason],
        [{ kind: 'service', id: 'booking' }, 'RELEASED', 'BOOKING_CANCELLED'],
      );
    }
  }
});

test('cancellation compensation: existing reservations stay settleable, new ones are refused', async () => {
  const { id } = await activeSubscription({ washUnits: 2 });
  const held = await reserve(reserveBody(id));
  const cancelled = await call('POST', `/subscriptions/${id}/cancel`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedVersion: 2, reason: 'PAYMENT_NOT_RECEIVED' },
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'CANCELLED');
  const refused = await reserve(reserveBody(id));
  assert.equal(refused.status, 409);
  assert.equal(errorCode(refused.body), 'SUBSCRIPTION_NOT_ACTIVE');
  const release = await call('POST', `/reservations/${held.body.reservationId as string}/release`, {
    service: BOOKING,
    body: { reason: 'SAGA_COMPENSATION' },
  });
  assert.equal(release.status, 200);
  assert.deepEqual(await period(id), { reserved: 0, consumed: 0, granted: 2 });
  const reopen = await call('POST', `/subscriptions/${id}/cancel`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedVersion: 3, reason: 'RECORDED_IN_ERROR' },
  });
  assert.equal(reopen.status, 409);
  assert.equal(errorCode(reopen.body), 'SUBSCRIPTION_CLOSED');
  assert.equal(await ledgerBalanced(id), true);
  // A new subscription to the same plan is allowed once the old one is closed.
  const { planCode } = await activeSubscriptionPlanOf(id);
  assert.equal(
    (
      await call('POST', '/subscriptions', {
        token: TOKENS.customer,
        key: key(),
        body: { planCode },
      })
    ).status,
    201,
  );
});

async function activeSubscriptionPlanOf(id: string): Promise<{ planCode: string }> {
  const view = await call('GET', `/subscriptions/${id}`, { token: TOKENS.admin });
  return { planCode: view.body.planCode as string };
}

test('customer may withdraw only their own unactivated request', async () => {
  const planCode = code();
  await publish(planCode);
  const requested = await call('POST', '/subscriptions', {
    token: TOKENS.customer,
    key: key(),
    body: { planCode },
  });
  const id = requested.body.subscriptionId as string;
  const foreign = await call('POST', `/subscriptions/${id}/cancel`, {
    token: TOKENS.otherCustomer,
    key: key(),
    body: { expectedVersion: 1, reason: 'CUSTOMER_REQUEST' },
  });
  assert.equal(foreign.status, 404);
  const wrongReason = await call('POST', `/subscriptions/${id}/cancel`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedVersion: 1, reason: 'PLAN_WITHDRAWN' },
  });
  assert.equal(wrongReason.status, 400);
  const withdrawn = await call('POST', `/subscriptions/${id}/cancel`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedVersion: 1, reason: 'CUSTOMER_REQUEST' },
  });
  assert.equal(withdrawn.status, 200);
  const { id: activeId } = await activeSubscription();
  const tooLate = await call('POST', `/subscriptions/${activeId}/cancel`, {
    token: TOKENS.customer,
    key: key(),
    body: { expectedVersion: 2, reason: 'CUSTOMER_REQUEST' },
  });
  assert.equal(tooLate.status, 409);
  assert.equal(errorCode(tooLate.body), 'CUSTOMER_MAY_ONLY_CANCEL_PENDING');
});

test('freeze blocks new reservations only; staff reversal returns a consumed unit; ledger reconciles', async () => {
  const { id } = await activeSubscription({ washUnits: 2 });
  const frozen = await call('POST', `/subscriptions/${id}/freeze`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedVersion: 2, reason: 'UNDER_REVIEW' },
  });
  assert.equal(frozen.status, 200);
  const blocked = await reserve(reserveBody(id));
  assert.equal(errorCode(blocked.body), 'SUBSCRIPTION_FROZEN');
  assert.equal(
    (
      await call('POST', `/subscriptions/${id}/unfreeze`, {
        token: TOKENS.admin,
        key: key(),
        body: { expectedVersion: 3 },
      })
    ).status,
    200,
  );

  const held = await reserve(reserveBody(id));
  const rid = held.body.reservationId as string;
  assert.equal(
    (await call('POST', `/reservations/${rid}/commit`, { service: BOOKING })).status,
    200,
  );
  assert.deepEqual(await period(id), { reserved: 0, consumed: 1, granted: 2 });
  const customerTry = await call('POST', `/reservations/${rid}/reverse`, {
    token: TOKENS.customer,
    key: key(),
    body: { reason: 'GOODWILL' },
  });
  assert.equal(customerTry.status, 403);
  const reverseKey = key();
  const reversed = await call('POST', `/reservations/${rid}/reverse`, {
    token: TOKENS.admin,
    key: reverseKey,
    body: { reason: 'SERVICE_NOT_DELIVERED' },
  });
  assert.equal(reversed.status, 200);
  assert.equal(reversed.body.status, 'REVERSED');
  const replayed = await call(
    'POST',
    `/reservations/${rid}/reverse`,
    { token: TOKENS.admin, key: reverseKey, body: { reason: 'SERVICE_NOT_DELIVERED' } },
    replicaB,
  );
  assert.equal(replayed.headers.get('idempotency-replayed'), 'true');
  const twice = await call('POST', `/reservations/${rid}/reverse`, {
    token: TOKENS.secondAdmin,
    key: key(),
    body: { reason: 'GOODWILL' },
  });
  assert.equal(twice.status, 409);
  assert.equal(errorCode(twice.body), 'RESERVATION_NOT_COMMITTED');
  assert.deepEqual(await period(id), { reserved: 0, consumed: 0, granted: 2 });

  const ledger = await call('GET', `/subscriptions/${id}/ledger`, { token: TOKENS.admin });
  const periods = ledger.body.periods as Body[];
  assert.equal(ledger.body.balanced, true);
  assert.deepEqual(
    (periods[0]?.movements as Body[]).map((m) => m.kind),
    ['GRANT', 'RESERVE', 'COMMIT', 'REVERSE'],
  );
  assert.equal(
    (await call('GET', `/subscriptions/${id}/ledger`, { token: TOKENS.customer })).status,
    403,
  );

  const own = await activeSubscription({}, TOKENS.admin);
  const ownHeld = await call('POST', '/reservations', {
    service: BOOKING,
    body: reserveBody(own.id, { customerSubject: own.body.customerSubject as string }),
  });
  const ownRid = ownHeld.body.reservationId as string;
  await call('POST', `/reservations/${ownRid}/commit`, { service: BOOKING });
  const selfReverse = await call('POST', `/reservations/${ownRid}/reverse`, {
    token: TOKENS.admin,
    key: key(),
    body: { reason: 'GOODWILL' },
  });
  assert.equal(selfReverse.status, 403, 'staff never return a unit to their own subscription');
});

test('periods: bookings outside the period are refused; renewal after expiry starts a new period, no carry-over', async () => {
  const { id } = await activeSubscription({ washUnits: 2, periodDays: 7 });
  const beyond = await reserve(
    reserveBody(id, { scheduledFor: new Date(clock.now().getTime() + 8 * DAY).toISOString() }),
  );
  assert.equal(beyond.status, 422);
  assert.equal(errorCode(beyond.body), 'SCHEDULE_OUTSIDE_PERIOD');
  const held = await reserve(reserveBody(id));
  const early = await call('POST', `/subscriptions/${id}/renew`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedVersion: 2, paymentReference: randomUUID() },
  });
  assert.equal(errorCode(early.body), 'PERIOD_NOT_ENDED');

  clock.advance(7 * DAY);
  const ended = await reserve(reserveBody(id));
  assert.equal(errorCode(ended.body), 'PERIOD_ENDED');
  assert.equal(
    (await call('GET', `/subscriptions/${id}`, { token: TOKENS.customer })).body.status,
    'EXPIRED',
  );
  const renewed = await call('POST', `/subscriptions/${id}/renew`, {
    token: TOKENS.admin,
    key: key(),
    body: { expectedVersion: 2, paymentReference: randomUUID() },
  });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  const next = renewed.body.period as Body;
  assert.deepEqual(
    [next.periodNo, next.granted, next.available, renewed.body.status],
    [2, 2, 2, 'ACTIVE'],
  );
  // The unit reserved in period 1 still settles against period 1.
  assert.equal(
    (
      await call('POST', `/reservations/${held.body.reservationId as string}/commit`, {
        service: BOOKING,
      })
    ).status,
    200,
  );
  const rows = await sql.query(
    `SELECT period_no, reserved, consumed FROM subscription_period WHERE subscription_id = $1 ORDER BY period_no`,
    [id],
  );
  assert.deepEqual(rows.rows, [
    { period_no: 1, reserved: 0, consumed: 1 },
    { period_no: 2, reserved: 0, consumed: 0 },
  ]);
  assert.equal(await ledgerBalanced(id), true);
});

test('service authorization: deny by default, explicit scopes, owner-bound reservations', async () => {
  const { id } = await activeSubscription();
  const body = reserveBody(id);
  assert.equal((await call('POST', '/reservations', { body })).status, 401);
  assert.equal(
    (
      await call('POST', '/reservations', {
        body,
        service: { client: 'booking', token: 'w'.repeat(40) },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call('POST', '/reservations', {
        body,
        service: { client: 'dispatch', token: BOOKING.token },
      })
    ).status,
    401,
  );
  const wrongScope = await call('POST', '/reservations', { body, service: DISPATCH });
  assert.equal(wrongScope.status, 401, 'settle-only client cannot reserve');
  assert.equal(
    (await call('POST', '/reservations', { body, token: TOKENS.admin })).status,
    401,
    'a user token is not a service credential',
  );
  const foreign = await reserve({ ...body, customerSubject: OTHER_CUSTOMER_SUBJECT });
  assert.equal(foreign.status, 404, 'Booking cannot spend another customer’s entitlement');
  const malformed = await reserve({ ...body, extra: 1 });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await period(id), { reserved: 0, consumed: 0, granted: 2 });
});

test('database refuses tampering by the runtime role (direct SQL)', async () => {
  const { id } = await activeSubscription({ washUnits: 2 });
  const held = await reserve(reserveBody(id));
  const rid = held.body.reservationId as string;
  const cases: [string, [string, unknown[]][], RegExp][] = [
    [
      'counter without movement',
      [[`UPDATE subscription_period SET reserved = reserved + 1 WHERE subscription_id = $1`, [id]]],
      /ENTITLEMENT_LEDGER_UNBALANCED/,
    ],
    [
      'over-grant',
      [[`UPDATE subscription_period SET consumed = 2 WHERE subscription_id = $1`, [id]]],
      /subscription_period_counters/,
    ],
    [
      'grant edit',
      [[`UPDATE subscription_period SET granted = 50 WHERE subscription_id = $1`, [id]]],
      /PERIOD_IMMUTABLE/,
    ],
    [
      'illegal transition',
      [
        [
          `UPDATE entitlement_reservation SET status = 'REVERSED', version = version + 1, settled_at = now(), settled_by = 'x', reason = 'GOODWILL', live_slot = NULL WHERE id = $1`,
          [rid],
        ],
      ],
      /RESERVATION_TRANSITION_INVALID/,
    ],
    [
      'status without movement',
      [
        [
          `UPDATE entitlement_reservation SET status = 'RELEASED', version = version + 1, settled_at = now(), settled_by = 'x', reason = 'BOOKING_FAILED', live_slot = NULL WHERE id = $1`,
          [rid],
        ],
      ],
      /RESERVATION_LEDGER_MISMATCH|ENTITLEMENT_LEDGER_UNBALANCED/,
    ],
    [
      'movement delete',
      [[`DELETE FROM entitlement_movement WHERE subscription_id = $1`, [id]]],
      /SUBSCRIPTION_APPEND_ONLY/,
    ],
    [
      'reservation delete',
      [[`DELETE FROM entitlement_reservation WHERE id = $1`, [rid]]],
      /SUBSCRIPTION_APPEND_ONLY/,
    ],
    [
      'terms tamper',
      [
        [
          `UPDATE customer_subscription SET wash_units = 9, version = version + 1 WHERE id = $1`,
          [id],
        ],
      ],
      /SUBSCRIPTION_TERMS_NOT_REVISION/,
    ],
    [
      'period jump',
      [
        [
          `UPDATE customer_subscription SET current_period_no = 2, version = version + 1 WHERE id = $1`,
          [id],
        ],
      ],
      /SUBSCRIPTION_PERIOD_CHANGE_INVALID/,
    ],
    // The runtime role holds no TRUNCATE grant; the trigger is the second line of defence.
    [
      'audit truncate',
      [[`TRUNCATE subscription_audit_event`, []]],
      /permission denied|SUBSCRIPTION_APPEND_ONLY/,
    ],
    [
      'overlapping period',
      [
        [
          `INSERT INTO subscription_period (subscription_id, period_no, plan_revision, starts_at, ends_at, granted, reserved, consumed, payment_reference, granted_by, granted_at)
         SELECT subscription_id, 2, plan_revision, starts_at, ends_at, granted, 0, 0, gen_random_uuid(), granted_by, now() FROM subscription_period WHERE subscription_id = $1`,
          [id],
        ],
      ],
      /PERIOD_OVERLAP/,
    ],
    [
      'forged extra movement',
      [
        [
          `INSERT INTO entitlement_movement (id, subscription_id, period_no, reservation_id, kind, granted, reserved, consumed, occurred_at, actor_kind, actor_id, correlation_id)
         VALUES (gen_random_uuid(), $1, 1, $2, 'COMMIT', 0, -1, 1, now(), 'service', 'booking', gen_random_uuid())`,
          [id, rid],
        ],
      ],
      /ENTITLEMENT_LEDGER_UNBALANCED|RESERVATION_LEDGER_MISMATCH/,
    ],
  ];
  for (const [name, statements, expected] of cases) {
    const message = await attack(statements);
    assert.match(message ?? 'COMMITTED', expected, name);
  }
  assert.deepEqual(await period(id), { reserved: 1, consumed: 0, granted: 2 });
  assert.equal(await ledgerBalanced(id), true);
});

test('trigger functions are not executable by the runtime role or PUBLIC', async () => {
  const rows = await sql.query(
    `SELECT p.proname,
            has_function_privilege(current_user, p.oid, 'EXECUTE') AS runtime,
            coalesce(array_to_string(p.proacl, ','), '') AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app'`,
  );
  assert.equal(rows.rowCount, 7);
  for (const row of rows.rows as { proname: string; runtime: boolean; acl: string }[]) {
    assert.equal(row.runtime, false, row.proname);
    assert.doesNotMatch(row.acl, /(^|,)=X/, `${row.proname} must not grant EXECUTE to PUBLIC`);
  }
});
