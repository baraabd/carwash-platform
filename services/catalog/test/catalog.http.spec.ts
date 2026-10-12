import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_DEFINITIONS_PUBLISHED_V1 } from '@carwash/event-contracts';
import { CATALOG_AGGREGATE_ID } from '../src/application';
import {
  definitionsFixture,
  fixtureId,
  publishBody,
  ADMIN_SUBJECT,
} from './support/catalog-fixtures';
import { FixedClock, InMemoryCatalogRepository } from './support/in-memory-catalog.repository';
import { TOKENS, errorOf, startCatalogHttp } from './support/catalog-http-harness';

/*
 * Real HTTP transport + application + Identity adapter. Persistence here is an
 * in-memory TEST DOUBLE; PostgreSQL behaviour is proven by the integration suite.
 */

const T0 = new Date('2026-10-11T10:00:00.000Z');
const KEY = (n: number) => `catalog-key-${String(n).padStart(8, '0')}`;
const PATH = '/internal/v1/catalog';
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

async function harness(options: { identityConfigured?: boolean; identityTimeoutMs?: number } = {}) {
  const repository = new InMemoryCatalogRepository();
  const clock = new FixedClock(T0);
  const http = await startCatalogHttp({ repository, clock, ...options });
  return { repository, clock, http };
}

test('catalog http: public reads need no credential and never call Identity', async () => {
  const { http } = await harness();
  try {
    const empty = await http.request('GET', `${PATH}/definitions`);
    assert.equal(empty.status, 404);
    assert.equal(errorOf(empty).code, 'NOT_FOUND');
    assert.equal(empty.headers.get('cache-control'), 'no-store');
    assert.ok(empty.headers.get('x-request-id'));
    assert.equal(http.identity.calls.length, 0);
  } finally {
    await http.close();
  }
});

test('catalog http: publish is deny-by-default (401 / 403 / 503 fail closed)', async () => {
  const { http, repository } = await harness();
  const body = publishBody(0, definitionsFixture());
  try {
    const none = await http.request('POST', `${PATH}/publications`, { key: KEY(1), body });
    assert.equal(none.status, 401);
    assert.equal(errorOf(none).code, 'AUTH_REQUIRED');
    const unknown = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.unknown,
      key: KEY(1),
      body,
    });
    assert.equal(unknown.status, 401);
    const customer = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.customer,
      key: KEY(1),
      body,
    });
    assert.equal(customer.status, 403);
    assert.equal(errorOf(customer).code, 'AUTH_FORBIDDEN');

    http.identity.mode = 'error-500';
    const down = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(1),
      body,
    });
    assert.equal(down.status, 503);
    assert.equal(errorOf(down).code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal((down.body.error as { retryable: boolean }).retryable, true);
    http.identity.mode = 'garbage';
    assert.equal(
      (
        await http.request('POST', `${PATH}/publications`, {
          token: TOKENS.admin,
          key: KEY(1),
          body,
        })
      ).status,
      503,
    );
    assert.equal(repository.publications.length, 0);
    assert.equal(repository.audit.length, 0);
  } finally {
    await http.close();
  }
});

test('catalog http: an unconfigured Identity origin refuses every publish with 503', async () => {
  const { http } = await harness({ identityConfigured: false });
  try {
    const result = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(1),
      body: publishBody(0, definitionsFixture()),
    });
    assert.equal(result.status, 503);
  } finally {
    await http.close();
  }
});

test('catalog http: idempotency key and body are validated before any write', async () => {
  const { http, repository } = await harness();
  try {
    const noKey = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      body: publishBody(0, definitionsFixture()),
    });
    assert.equal(noKey.status, 428);
    assert.equal(errorOf(noKey).code, 'IDEMPOTENCY_KEY_REQUIRED');
    const badKey = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: 'short',
      body: publishBody(0, definitionsFixture()),
    });
    assert.equal(badKey.status, 400);
    assert.deepEqual(errorOf(badKey).issues, [
      { field: 'header.idempotency-key', code: 'INVALID_IDEMPOTENCY_KEY' },
    ]);
    const malformed = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(2),
      rawBody: '{"expectedCatalogRevision":',
    });
    assert.equal(malformed.status, 400);
    assert.equal(errorOf(malformed).code, 'REQUEST_INVALID');
    const invalid = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(3),
      body: { ...publishBody(0, definitionsFixture()), effectiveFrom: null },
    });
    assert.equal(invalid.status, 422);
    assert.deepEqual(errorOf(invalid).issues, [
      { field: '$.effectiveFrom', code: 'UNEXPECTED_FIELD' },
    ]);
    assert.equal(repository.receipts.size, 0);
  } finally {
    await http.close();
  }
});

test('catalog http: publish commits snapshot, audit and a valid outbox event atomically', async () => {
  const { http, repository } = await harness();
  try {
    const result = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(1),
      body: publishBody(0, definitionsFixture()),
      traceparent: TRACEPARENT,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.headers.get('idempotency-replayed'), 'false');
    assert.equal(result.body.catalogRevision, 1);
    assert.equal(result.body.publishedAt, T0.toISOString());
    const items = result.body.items as {
      definitionId: string;
      revision: number;
      vehicleTypes: string[];
    }[];
    assert.deepEqual(
      items.map((d) => d.definitionId),
      [fixtureId(1), fixtureId(2), fixtureId(3)],
    );
    assert.deepEqual(items[0]?.vehicleTypes, ['sedan', 'suv']);

    const read = await http.request('GET', `${PATH}/definitions`);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body, result.body);
    const one = await http.request('GET', `${PATH}/definitions/${fixtureId(2).toUpperCase()}`);
    assert.equal(one.status, 200);
    assert.deepEqual(one.body, items[1]);
    assert.equal((await http.request('GET', `${PATH}/definitions/${fixtureId(99)}`)).status, 404);
    assert.equal((await http.request('GET', `${PATH}/definitions/not-a-uuid`)).status, 404);

    assert.equal(repository.audit.length, 1);
    assert.equal(repository.audit[0]?.action, 'catalog.definitions.published');
    assert.equal(repository.audit[0]?.reasonCode, 'INITIAL_PUBLICATION');
    assert.equal(repository.outbox.length, 1);
    const event = CATALOG_DEFINITIONS_PUBLISHED_V1.parse(JSON.parse(repository.outbox[0]!.payload));
    assert.equal(event.aggregate.id, CATALOG_AGGREGATE_ID);
    assert.equal(event.aggregate.version, 1);
    assert.equal(event.traceparent, TRACEPARENT);
    assert.deepEqual(event.actor, { kind: 'account', id: ADMIN_SUBJECT });
    assert.deepEqual(event.data.definitionIds, [fixtureId(1), fixtureId(2), fixtureId(3)]);
    assert.equal(repository.outbox[0]!.exchange, 'washgo.catalog.events');
  } finally {
    await http.close();
  }
});

test('catalog http: replay returns the recorded outcome; a reused key with a new body is 409', async () => {
  const { http, repository } = await harness();
  try {
    const body = publishBody(0, definitionsFixture());
    const first = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(1),
      body,
    });
    assert.equal(first.status, 201);
    const replay = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(1),
      body,
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('idempotency-replayed'), 'true');
    assert.deepEqual(replay.body, first.body);
    assert.equal(repository.publications.length, 1);
    assert.equal(repository.outbox.length, 1);

    const conflict = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(1),
      body: publishBody(0, definitionsFixture(), 'OTHER_REASON'),
    });
    assert.equal(conflict.status, 409);
    assert.equal(errorOf(conflict).code, 'IDEMPOTENCY_CONFLICT');

    // Keys are scoped per actor: the same key from another admin is a new command.
    const other = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.otherAdmin,
      key: KEY(1),
      body,
    });
    assert.equal(other.status, 412);
    assert.equal(errorOf(other).code, 'REVISION_CONFLICT');
    const otherReplay = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.otherAdmin,
      key: KEY(1),
      body,
    });
    assert.equal(otherReplay.status, 412);
    assert.equal(otherReplay.headers.get('idempotency-replayed'), 'true');
    assert.equal(repository.audit.at(-1)?.action, 'catalog.definitions.publish-rejected');
  } finally {
    await http.close();
  }
});

test('catalog http: rule violations carry the allowlisted reason or an issue code', async () => {
  const { http } = await harness();
  try {
    await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(1),
      body: publishBody(0, definitionsFixture()),
    });
    const retire = definitionsFixture();
    retire[2] = { ...retire[2]!, status: 'RETIRED' };
    const retired = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(2),
      body: publishBody(1, retire, 'RETIRE_TYRE_SHINE'),
    });
    assert.equal(retired.status, 201);
    const items = retired.body.items as { status: string; revision: number }[];
    assert.equal(items[2]?.status, 'RETIRED');
    assert.equal(items[2]?.revision, 2);

    const revive = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(3),
      body: publishBody(2, definitionsFixture(), 'REVIVE'),
    });
    assert.equal(revive.status, 422);
    assert.equal(errorOf(revive).code, 'BUSINESS_RULE_VIOLATION');
    assert.equal(errorOf(revive).reason, 'DEFINITION_RETIRED');

    const reuse = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(4),
      body: publishBody(
        2,
        [...retire, { ...retire[2], definitionId: fixtureId(7), status: 'PUBLISHED' }],
        'REUSE',
      ),
    });
    // Snapshots are complete, so the retired holder of the code is always in the
    // request too: reuse is caught as a catalog.v1 DUPLICATE_CODE violation.
    assert.equal(reuse.status, 422);
    assert.equal(errorOf(reuse).code, 'VALIDATION_FAILED');
    assert.deepEqual(errorOf(reuse).issues, [{ field: '$.definitions', code: 'DUPLICATE_CODE' }]);

    const missing = await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(5),
      body: publishBody(2, retire.slice(0, 2), 'DROP'),
    });
    assert.equal(missing.status, 422);
    assert.equal(errorOf(missing).reason, null);
    assert.deepEqual(errorOf(missing).issues, [
      { field: '$.definitions', code: 'DEFINITION_MISSING' },
    ]);
  } finally {
    await http.close();
  }
});

test('catalog http: concurrent publishers against one revision produce exactly one winner', async () => {
  const { http, repository } = await harness();
  try {
    await http.request('POST', `${PATH}/publications`, {
      token: TOKENS.admin,
      key: KEY(1),
      body: publishBody(0, definitionsFixture()),
    });
    const results = await Promise.all(
      [0, 1, 2, 3].map((n) => {
        const next = definitionsFixture();
        next[0] = { ...next[0]!, durationMinutes: 40 + n };
        return http.request('POST', `${PATH}/publications`, {
          token: TOKENS.admin,
          key: KEY(10 + n),
          body: publishBody(1, next, 'RACE'),
        });
      }),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 412, 412, 412]);
    assert.equal(repository.publications.length, 2);
  } finally {
    await http.close();
  }
});

test('catalog http: the pre-contract routes are gone', async () => {
  const { http } = await harness();
  try {
    assert.equal(
      (await http.request('GET', `${PATH}/revisions`, { token: TOKENS.admin })).status,
      404,
    );
    const legacy = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(1),
      body: {},
    });
    assert.equal(legacy.status, 404);
    assert.equal(errorOf(legacy).code, 'NOT_FOUND');
  } finally {
    await http.close();
  }
});
