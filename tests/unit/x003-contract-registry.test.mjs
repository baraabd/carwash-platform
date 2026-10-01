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
    ],
  );
  assert.throws(() => httpRegistry.httpContract('customer.v1'), /UNKNOWN_HTTP_CONTRACT/);

  const docs = JSON.parse(readFileSync(path.join(root, 'docs/api/contract-registry.json'), 'utf8'));
  assert.equal(docs.schemaVersion, 1);
  assert.deepEqual(
    docs.contracts.map(({ id, domain, version, prefix, status }) => ({
      id,
      domain,
      version,
      prefix,
      status,
    })),
    httpRegistry.HTTP_CONTRACTS.map(({ id, domain, version, prefix, status }) => ({
      id,
      domain,
      version,
      prefix,
      status,
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
    eventRegistry.EVENT_CONTRACTS.map(({ id, producer, schemaVersion, status, asyncApi }) => ({
      id,
      producer,
      schemaVersion,
      status,
      asyncApi,
    })),
    [
      {
        id: 'foundation.probe.created.v1',
        producer: 'catalog',
        schemaVersion: 1,
        status: 'foundation-runtime',
        asyncApi: 'docs/asyncapi/foundation-probe.yaml',
      },
      {
        id: 'booking.confirmed.v1',
        producer: 'booking',
        schemaVersion: 1,
        status: 'contract-only',
        asyncApi: 'docs/asyncapi/booking-confirmed-v1.yaml',
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
  ]);
  assert.deepEqual(Object.keys(eventsPackage.exports), [
    '.',
    './booking-confirmed',
    './booking-confirmed-v1',
    './foundation-probe-created-v1',
    './registry',
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
