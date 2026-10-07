import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PricingService } from '../src/application';
import { InMemoryPricingRepository } from './support/in-memory-pricing.repository';
import {
  CUSTOMER_SUBJECT,
  FakeCatalogReader,
  FixedClock,
  FixedPolicy,
  ratesFixture,
  snapshotFixture,
} from './support/pricing-fixtures';

test('pricing application: quote locks before sampling time and reads only its transaction', async () => {
  const repository = new InMemoryPricingRepository();
  const catalog = new FakeCatalogReader();
  catalog.snapshots.set(1, snapshotFixture());
  const clock = new FixedClock(new Date('2026-10-07T10:00:00.000Z'));
  const service = new PricingService({
    repository,
    catalog,
    clock,
    policy: new FixedPolicy(),
    authority: {
      verify: () =>
        Promise.resolve({
          subject: CUSTOMER_SUBJECT,
          sessionId: randomUUID(),
          permissions: ['pricing.publish', 'bookings.create:self'],
        }),
    },
    ids: { uuid: randomUUID },
    hasher: { sha256Hex: (value) => createHash('sha256').update(value).digest('hex') },
  });
  const context = { credential: undefined, correlationId: randomUUID() };
  const scheduled = '2026-10-07T10:01:00.000Z';
  for (const [expectedVersion, effectiveFrom] of [
    [0, null],
    [1, scheduled],
  ] as const) {
    const result = await service.publish(context, randomUUID(), {
      expectedVersion,
      effectiveFrom,
      catalogRevision: 1,
      rates: ratesFixture(),
    });
    assert.equal(result.status, 201);
  }

  // The test double is serialised; this checks application ordering and port
  // selection, not PostgreSQL isolation (covered by the integration suite).
  const transaction = repository.transaction.bind(repository);
  repository.transaction = (work) =>
    transaction((uow) => {
      let locked = false;
      return work({
        ...uow,
        lockPrices: async () => {
          await uow.lockPrices();
          clock.advance(30_000);
          locked = true;
        },
        versionInForce: (at) => {
          assert.equal(locked, true, 'read after acquiring publication lock');
          assert.equal(at.toISOString(), '2026-10-07T10:00:30.000Z');
          return uow.versionInForce(at);
        },
        version: (version) => {
          assert.equal(locked, true);
          return uow.version(version);
        },
      });
    });
  repository.versionInForce = () => Promise.reject(new Error('ROOT_VERSION_READ'));
  repository.version = () => Promise.reject(new Error('ROOT_VERSION_READ'));

  const quote = await service.issueQuote(context, randomUUID(), {
    catalogRevision: 1,
    categoryId: 'suv',
    packageId: 'exterior',
    addonIds: [],
  });
  assert.equal(quote.status, 201);
  assert.equal(quote.body.priceVersion, 1);
  assert.equal(quote.body.issuedAt, '2026-10-07T10:00:30.000Z');
  assert.equal(quote.body.expiresAt, scheduled);
});
