import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { subscriptionV1 } from '@carwash/contracts';
import { SubscriptionQuoteService } from '../../src/application/subscription-quote.service';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { PrismaSubscriptionQuoteStore } from '../../src/infrastructure/persistence/prisma-subscription-quote.store';
import { RandomIds, Sha256Hasher } from '../../src/infrastructure/system/system.adapters';
import { CUSTOMER, FixedClock, FixedPolicy } from '../support/pricing-fixtures';

const database = process.env.PRICING_TEST_DATABASE_URL;
if (!database) throw new Error('PRICING_TEST_DATABASE_URL_REQUIRED');
const clock = new FixedClock(new Date('2026-11-27T10:00:00.000Z'));
const plan = subscriptionV1.parsePlanV1({
  planId: randomUUID(),
  version: 1,
  status: 'PUBLISHED',
  name: 'Four prepaid washes',
  units: 4,
  validityDays: 30,
  price: { currency: 'SYP', amountMinor: '600000', scale: 2 },
  packageIds: [randomUUID()],
  vehicleTypes: ['sedan'],
  publishedAt: clock.now().toISOString(),
  contentHash: 'a'.repeat(64),
});
const context = {
  credential: 'Bearer test-pricing-customer-credential',
  correlationId: randomUUID(),
};
const prismas: PrismaService[] = [];
const services: SubscriptionQuoteService[] = [];
let sql: Client;
before(async () => {
  for (let i = 0; i < 2; i++) {
    const prisma = new PrismaService(database);
    prismas.push(prisma);
    services.push(
      new SubscriptionQuoteService({
        clock,
        policy: new FixedPolicy(),
        ids: new RandomIds(),
        hasher: new Sha256Hasher(),
        store: new PrismaSubscriptionQuoteStore(prisma),
        plans: { read: () => Promise.resolve(plan) },
        authority: {
          verify: () =>
            Promise.resolve({
              kind: 'account',
              subject: CUSTOMER.subjectId,
              sessionId: randomUUID(),
              permissions: ['bookings.create:self'],
            }),
        },
      }),
    );
  }
  sql = new Client({ connectionString: database.replace(/\?.*$/, '') });
  await sql.connect();
});
after(async () => {
  for (const prisma of prismas) await prisma.onModuleDestroy();
  await sql?.end();
});

test('subscription quote persists exact published price once across replicas and denies mutation', async () => {
  const key = randomUUID().replaceAll('-', '');
  const body = { planId: plan.planId, planVersion: 1 };
  const raced = await Promise.all(services.map((service) => service.create(context, key, body)));
  assert.equal(new Set(raced.map((result) => result.body.quoteId)).size, 1);
  const quote = raced[0]!.body;
  assert.deepEqual(quote.total, plan.price);
  assert.deepEqual((await services[1]!.get(context, quote.quoteId)).total, plan.price);
  const stored = await sql.query(
    'SELECT count(*) AS n FROM app.pricing_subscription_quote WHERE id=$1',
    [quote.quoteId],
  );
  assert.equal(Number(stored.rows[0].n), 1);
  await assert.rejects(
    sql.query('UPDATE app.pricing_subscription_quote SET total_minor=1 WHERE id=$1', [
      quote.quoteId,
    ]),
  );
  await assert.rejects(
    sql.query('DELETE FROM app.pricing_subscription_quote WHERE id=$1', [quote.quoteId]),
  );
  await assert.rejects(services[1]!.create(context, key, { ...body, planVersion: 2 }));
});
