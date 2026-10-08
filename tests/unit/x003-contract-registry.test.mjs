import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const httpRegistry = require(path.join(root, 'packages/contracts/dist/registry.js'));
const eventRegistry = require(path.join(root, 'packages/event-contracts/dist/registry.js'));

test('X003 HTTP registry is versioned, bounded and source-linked', () => {
  assert.deepEqual(
    httpRegistry.HTTP_CONTRACTS.map(({ id, domain, version, prefix, status }) => ({
      id,
      domain,
      version,
      prefix,
      status,
    })),
    [
      {
        id: 'identity.v1',
        domain: 'identity',
        version: 1,
        prefix: '/internal/v1/identity',
        status: 'foundation-runtime',
      },
      {
        id: 'gateway.v1',
        domain: 'gateway',
        version: 1,
        prefix: '/api/v1',
        status: 'routing-contract-only',
      },
      {
        id: 'customer.v1',
        domain: 'customer',
        version: 1,
        prefix: '/internal/v1/customer',
        status: 'published-provider-pending',
      },
      {
        id: 'vehicle.v1',
        domain: 'vehicle',
        version: 1,
        prefix: '/internal/v1/vehicle',
        status: 'published-provider-pending',
      },
      {
        id: 'geo.v1',
        domain: 'geo',
        version: 1,
        prefix: '/internal/v1/geo',
        status: 'published-provider-pending',
      },
      {
        id: 'catalog.v1',
        domain: 'catalog',
        version: 1,
        prefix: '/internal/v1/catalog',
        status: 'published-provider-pending',
      },
      {
        id: 'pricing.v1',
        domain: 'pricing',
        version: 1,
        prefix: '/internal/v1/pricing',
        status: 'published-provider-pending',
      },
      {
        id: 'scheduling.v1',
        domain: 'scheduling',
        version: 1,
        prefix: '/internal/v1/scheduling',
        status: 'published-provider-pending',
      },
      {
        id: 'workforce.v1',
        domain: 'workforce',
        version: 1,
        prefix: '/internal/v1/workforce',
        status: 'published-provider-pending',
      },
      {
        id: 'configuration.v1',
        domain: 'configuration',
        version: 1,
        prefix: '/internal/v1/configuration',
        status: 'published-provider-pending',
      },
      {
        id: 'booking.v1',
        domain: 'booking',
        version: 1,
        prefix: '/internal/v1/booking',
        status: 'published-provider-pending',
      },
      {
        id: 'billing.v1',
        domain: 'billing',
        version: 1,
        prefix: '/internal/v1/billing',
        status: 'published-provider-pending',
      },
    ],
  );
  // Unpublished domains stay unknown; publication is explicit, never inferred.
  assert.throws(() => httpRegistry.httpContract('dispatch.v1'), /UNKNOWN_HTTP_CONTRACT/);

  const docs = JSON.parse(readFileSync(path.join(root, 'docs/api/contract-registry.json'), 'utf8'));
  assert.equal(docs.schemaVersion, 1);
  assert.deepEqual(
    docs.contracts.map(({ id, domain, version, prefix, status, openApi }) => ({
      id,
      domain,
      version,
      prefix,
      status,
      openApi,
    })),
    httpRegistry.HTTP_CONTRACTS.map(({ id, domain, version, prefix, status, openApi }) => ({
      id,
      domain,
      version,
      prefix,
      status,
      openApi,
    })),
  );
  for (const entry of docs.contracts) assert.ok(existsSync(path.join(root, entry.openApi)));

  const gateway = JSON.parse(
    readFileSync(path.join(root, 'docs/contracts/gateway.openapi.json'), 'utf8'),
  );
  assert.equal(gateway.openapi, '3.1.0');
  assert.equal(gateway.info.version, '1.0.0');
  assert.match(gateway.info.description, /does not assert business endpoints are implemented/);
});

test('X003 event registry matches public code and AsyncAPI documents', () => {
  assert.deepEqual(
    eventRegistry.EVENT_CONTRACTS.map(
      ({ id, producer, schemaVersion, envelopeVersion, status, asyncApi }) => ({
        id,
        producer,
        schemaVersion,
        envelopeVersion,
        status,
        asyncApi,
      }),
    ),
    [
      {
        id: 'foundation.probe.created.v1',
        producer: 'catalog',
        schemaVersion: 1,
        envelopeVersion: 1,
        status: 'foundation-runtime',
        asyncApi: 'docs/asyncapi/foundation-probe.yaml',
      },
      {
        id: 'booking.confirmed.v1',
        producer: 'booking',
        schemaVersion: 1,
        envelopeVersion: 1,
        status: 'contract-only',
        asyncApi: 'docs/asyncapi/booking-confirmed-v1.yaml',
      },
      {
        id: 'customer.profile-updated.v1',
        producer: 'customer',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'customer.address-updated.v1',
        producer: 'customer',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'vehicle.vehicle-updated.v1',
        producer: 'vehicle',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'geo.zone-updated.v1',
        producer: 'geo',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'catalog.definitions-published.v1',
        producer: 'catalog',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'pricing.price-book-published.v1',
        producer: 'pricing',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'pricing.quote-issued.v1',
        producer: 'pricing',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'scheduling.hold-changed.v1',
        producer: 'scheduling',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'workforce.eligibility-changed.v1',
        producer: 'workforce',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'configuration.configuration-published.v1',
        producer: 'configuration',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-v1.yaml',
      },
      {
        id: 'booking.confirmed.v2',
        producer: 'booking',
        schemaVersion: 2,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-p02.yaml',
      },
      {
        id: 'booking.cancelled.v1',
        producer: 'booking',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-p02.yaml',
      },
      {
        id: 'billing.obligation-created.v1',
        producer: 'billing',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-p02.yaml',
      },
      {
        id: 'billing.obligation-status-changed.v1',
        producer: 'billing',
        schemaVersion: 1,
        envelopeVersion: 2,
        status: 'published-producer-pending',
        asyncApi: 'docs/asyncapi/business-events-p02.yaml',
      },
    ],
  );
  assert.throws(() => eventRegistry.eventContract('billing.paid.v1'), /UNKNOWN_EVENT_CONTRACT/);

  const docs = JSON.parse(
    readFileSync(path.join(root, 'docs/asyncapi/contract-registry.json'), 'utf8'),
  );
  assert.deepEqual(docs.contracts, eventRegistry.EVENT_CONTRACTS);
  for (const entry of docs.contracts) {
    const document = readFileSync(path.join(root, entry.asyncApi), 'utf8');
    assert.match(document, /asyncapi: '2\.6\.0'/);
    assert.ok(document.includes(entry.id));
    assert.ok(document.includes(`const: ${entry.producer}`));
  }
  assert.match(
    readFileSync(path.join(root, 'docs/asyncapi/booking-confirmed-v1.yaml'), 'utf8'),
    /business publisher is not implemented by X003/,
  );
});

test('X003 package exports expose versioned domains and reject private deep imports', (t) => {
  const contractsPackage = JSON.parse(
    readFileSync(path.join(root, 'packages/contracts/package.json'), 'utf8'),
  );
  const eventsPackage = JSON.parse(
    readFileSync(path.join(root, 'packages/event-contracts/package.json'), 'utf8'),
  );
  assert.deepEqual(Object.keys(contractsPackage.exports), [
    '.',
    './identity-v1',
    './gateway-v1',
    './registry',
    './customer-v1',
    './vehicle-v1',
    './geo-v1',
    './catalog-v1',
    './pricing-v1',
    './scheduling-v1',
    './workforce-v1',
    './configuration-v1',
    './booking-v1',
    './billing-v1',
    './common',
  ]);
  assert.deepEqual(Object.keys(eventsPackage.exports), [
    '.',
    './booking-confirmed',
    './booking-confirmed-v1',
    './foundation-probe-created-v1',
    './registry',
    './envelope-v2',
    './business-v1',
    './booking-billing-v1',
  ]);

  const consumer = mkdtempSync(path.join(tmpdir(), 'washgo-x003-consumer-'));
  t.after(() => rmSync(consumer, { recursive: true, force: true }));
  const scope = path.join(consumer, 'node_modules/@carwash');
  mkdirSync(scope, { recursive: true });
  symlinkSync(path.join(root, 'packages/contracts'), path.join(scope, 'contracts'), 'junction');
  symlinkSync(
    path.join(root, 'packages/event-contracts'),
    path.join(scope, 'event-contracts'),
    'junction',
  );

  const allowed = [
    '@carwash/contracts/identity-v1',
    '@carwash/contracts/gateway-v1',
    '@carwash/contracts/registry',
    '@carwash/event-contracts/booking-confirmed-v1',
    '@carwash/event-contracts/foundation-probe-created-v1',
    '@carwash/event-contracts/registry',
    '@carwash/event-contracts/envelope-v2',
    '@carwash/event-contracts/business-v1',
    '@carwash/contracts/customer-v1',
    '@carwash/contracts/vehicle-v1',
    '@carwash/contracts/geo-v1',
    '@carwash/contracts/catalog-v1',
    '@carwash/contracts/pricing-v1',
    '@carwash/contracts/scheduling-v1',
    '@carwash/contracts/workforce-v1',
    '@carwash/contracts/configuration-v1',
    '@carwash/contracts/common',
  ];
  for (const specifier of allowed) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(specifier)});`],
      { cwd: consumer, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${specifier}: ${result.stderr || result.error?.message}`);
  }

  for (const specifier of [
    '@carwash/contracts/identity',
    '@carwash/contracts/gateway',
    '@carwash/event-contracts/envelope',
    '@carwash/event-contracts/foundation-probe-created',
    '@carwash/contracts/customer/v1',
    '@carwash/contracts/common/money',
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(specifier)});`],
      { cwd: consumer, encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0, `${specifier} unexpectedly bypassed package exports`);
    assert.match(result.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
  }
});
