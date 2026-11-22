import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { billingV1, parseApiErrorEnvelope } from '@carwash/contracts';
import { signProviderNotification } from '@carwash/service-kit';
import { Money } from '../../src/domain';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaBillingRepository } from '../../src/infrastructure/persistence/prisma-billing.repository';
import { StaticProviderRegistry } from '../../src/infrastructure/providers/merchant-providers';
import { SecretValue } from '../../src/infrastructure/providers/secret-value';
import {
  FixedClock,
  SESSIONS,
  TOKENS,
  startBillingHttp,
  type BillingHttpHarness,
  type HttpReply,
} from '../support/billing-http-harness';
import {
  startIdentityStub,
  startPricingStub,
  type PricingStub,
  type Stub,
} from '../support/upstream-stubs';
import { FakeSignedProvider } from '../support/fake-provider';

/**
 * Real Billing HTTP + PostgreSQL. Identity/Pricing are explicit HTTP doubles;
 * WASHGO_TEST is the authorized test HMAC scheme, never a live provider claim.
 */
const DATABASE_URL = process.env.BILLING_TEST_DATABASE_URL;
if (!DATABASE_URL) throw new Error('BILLING_TEST_DATABASE_URL_REQUIRED');
const PATH = '/internal/v1/billing';
const MERCHANT = 'canonical-test-merchant';
const prisms: PrismaService[] = [];
const replicas: BillingHttpHarness[] = [];
let production: BillingHttpHarness;
let first: BillingHttpHarness;
let second: BillingHttpHarness;
let fake: FakeSignedProvider;
let identity: Stub;
let pricing: PricingStub;
let clock: FixedClock;
let secret: SecretValue;
let sql: Client;
const key = () => `canonical-notification-${randomUUID()}`;
const reference = () => randomUUID().replaceAll('-', '').toUpperCase();

before(async () => {
  clock = new FixedClock(new Date(Math.floor(Date.now() / 1000) * 1000));
  identity = await startIdentityStub(SESSIONS);
  pricing = await startPricingStub();
  secret = SecretValue.of('AUTHORIZED_TEST_SIGNING_SECRET', randomUUID());
  fake = new FakeSignedProvider('SHAM_CASH', [MERCHANT], secret, 'WASHGO_TEST');
  const providers = new StaticProviderRegistry([
    fake,
    new FakeSignedProvider('SYRIATEL_CASH', [MERCHANT], secret, 'WASHGO_TEST'),
  ]);
  const start = async (enabled: boolean) => {
    const prisma = new PrismaService(DATABASE_URL);
    prisms.push(prisma);
    const http = await startBillingHttp({
      repository: new PrismaBillingRepository(prisma),
      clock,
      identity,
      pricing,
      ...(enabled ? { providers } : {}),
    });
    replicas.push(http);
    return http;
  };
  production = await start(false);
  first = await start(true);
  second = await start(true);
  sql = new Client({ connectionString: DATABASE_URL.replace(/\?schema=app$/, '') });
  await sql.connect();
});

after(async () => {
  for (const replica of replicas) await replica.close();
  for (const prisma of prisms) await prisma.onModuleDestroy();
  await identity?.close();
  await pricing?.close();
  await sql?.end();
});

function payload(ref: string, amount = '150000', merchant = MERCHANT) {
  return FakeSignedProvider.creditBody({
    merchantAccount: merchant,
    reference: ref,
    amount: Money.of('SYP', BigInt(amount)),
    occurredAt: new Date(clock.now().getTime() - 1_000),
  });
}

function signed(raw: string, at = clock.now()) {
  return signProviderNotification({
    rawBody: Buffer.from(raw),
    notificationId: randomUUID(),
    secret: Buffer.from(secret.reveal()),
    at,
  });
}

const post = (
  replica: BillingHttpHarness,
  raw: string,
  headers: Record<string, string> = signed(raw),
  provider = 'sham-cash',
) => replica.request('POST', `${PATH}/provider-notifications/${provider}`, { raw, headers });

function failure(reply: HttpReply, status: number, reason: string | null) {
  assert.equal(reply.status, status);
  const parsed = parseApiErrorEnvelope(reply.body);
  assert.equal(parsed.error.reason, reason);
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  return parsed;
}

async function credits(ref: string) {
  return (
    await sql.query<{ id: string; status: string; unallocated_reason: string | null }>(
      'SELECT id::text, status, unallocated_reason FROM app.provider_credit WHERE provider_reference = $1',
      [ref],
    )
  ).rows;
}

test('canonical notification: production stays disabled503, unknown provider404, legacy404 is preserved', async () => {
  for (const provider of billingV1.PAYMENT_PROVIDERS) {
    const reply = await post(production, '{}', {}, provider);
    const parsed = failure(reply, 503, 'NOTIFICATION_PROVIDER_DISABLED');
    assert.equal(parsed.error.code, 'SERVICE_NOT_READY');
    assert.equal(parsed.error.retryable, true);
  }
  failure(await post(production, '{}', {}, 'unknown-wallet'), 404, null);
  assert.equal(
    (await production.request('POST', `${PATH}/providers/sham_cash/notifications`, { body: {} }))
      .status,
    404,
  );
});

test('canonical notification: exact raw bytes and concurrent retries produce one immutable credit', async () => {
  const ref = reference();
  const raw = JSON.stringify(payload(ref), null, 2) + '\n';
  const headers = signed(raw);
  const replies = await Promise.all(
    Array.from({ length: 8 }, (_, i) => post(i % 2 ? first : second, raw, headers)),
  );
  assert.ok(replies.every((reply) => reply.status === 204 && Object.keys(reply.body).length === 0));
  const rows = await credits(ref);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'UNALLOCATED');
  const journals = () =>
    sql.query<{ id: string }>(
      'SELECT id::text FROM app.ledger_journal WHERE credit_id = $1 ORDER BY id',
      [rows[0]?.id],
    );
  const before = (await journals()).rows;
  assert.ok(before.length > 0);
  assert.equal((await post(second, raw, headers)).status, 204);
  assert.deepEqual((await journals()).rows, before);
});

test('canonical notification: forged, stale, relabelled and foreign-merchant claims never create a credit', async () => {
  const ref = reference();
  const raw = JSON.stringify(payload(ref));
  const headers = signed(raw);
  failure(
    await post(first, raw.replace('150000', '150001'), headers),
    401,
    'NOTIFICATION_SIGNATURE_INVALID',
  );
  failure(
    await post(first, raw, signed(raw, new Date(clock.now().getTime() - 301_000))),
    401,
    'NOTIFICATION_STALE',
  );
  failure(
    await post(first, raw, { ...headers, 'x-provider-notification-id': randomUUID() }),
    401,
    'NOTIFICATION_SIGNATURE_INVALID',
  );
  const foreign = JSON.stringify(payload(ref, '150000', 'not-our-merchant'));
  failure(await post(first, foreign), 401, 'NOTIFICATION_SIGNATURE_INVALID');
  assert.deepEqual(await credits(ref), []);
});

test('canonical notification: bounded raw parsing rejects oversize before authentication and never parses unauthenticated JSON', async () => {
  failure(await post(first, '{ malformed JSON', {}), 401, 'NOTIFICATION_SIGNATURE_INVALID');
  failure(
    await post(first, 'x'.repeat(billingV1.PROVIDER_NOTIFICATION_MAX_BYTES + 1), {}),
    413,
    null,
  );
  failure(await post(first, '', {}), 400, null);
  failure(await post(first, '<xml/>', { 'content-type': 'application/xml' }), 400, null);
  const exact = JSON.stringify({ type: 'credit.pending' }).padEnd(
    billingV1.PROVIDER_NOTIFICATION_MAX_BYTES,
    ' ',
  );
  assert.equal(
    (await post(first, exact)).status,
    204,
    'the exact16384-byte signed boundary is accepted',
  );
});

test('canonical notification: authentication sees only provider headers and pending acknowledgements carry no money effect', async () => {
  const ref = reference();
  const raw = JSON.stringify({ ...payload(ref), type: 'credit.pending' });
  const reply = await post(first, raw, {
    ...signed(raw),
    authorization: 'Bearer ignored-browser-credential',
    cookie: 'ignored=browser',
    'x-service-client': 'ignored',
    'x-service-token': 'ignored',
    'x-auth-subject': randomUUID(),
  });
  assert.equal(reply.status, 204);
  assert.deepEqual(
    fake.notificationHeaderNames.at(-1),
    ['content-type', ...billingV1.PROVIDER_NOTIFICATION_HEADERS].sort(),
  );
  assert.deepEqual(await credits(ref), []);
});

test('canonical notification: an acknowledged mismatched amount remains unallocated and never settles the customer claim', async () => {
  const quoteId = randomUUID();
  pricing.quotes.set(quoteId, {
    ownerToken: 'customer',
    status: 'USABLE',
    currency: 'SYP',
    totalMinor: '150000',
  });
  const created = await first.request('POST', `${PATH}/obligations`, {
    token: TOKENS.customer,
    key: key(),
    body: { quoteId },
  });
  assert.equal(created.status, 201);
  const id = String(created.body.obligationId);
  assert.equal(
    (
      await first.request('POST', `${PATH}/obligations/${id}/payment-intents`, {
        token: TOKENS.customer,
        key: key(),
        body: { expectedRevision: 1, method: 'SHAM_CASH' },
      })
    ).status,
    201,
  );
  const ref = reference();
  assert.equal(
    (
      await first.request('POST', `${PATH}/obligations/${id}/payment-attempts`, {
        token: TOKENS.customer,
        key: key(),
        body: { expectedRevision: 2, providerReference: ref },
      })
    ).status,
    202,
  );
  assert.equal((await post(first, JSON.stringify(payload(ref, '149999')))).status, 204);
  const view = await second.request('GET', `${PATH}/obligations/${id}`, { token: TOKENS.customer });
  assert.equal(view.status, 200);
  const obligation = billingV1.parseObligationV1(view.body);
  assert.equal(obligation.financialStatus, 'UNDER_REVIEW');
  assert.equal(obligation.verified.amountMinor, '0');
  const rows = await credits(ref);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'UNALLOCATED');
  assert.equal(rows[0]?.unallocated_reason, 'AMOUNT_MISMATCH');
});
