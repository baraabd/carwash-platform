import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionsFixture } from './support/catalog-fixtures';
import { FixedClock, InMemoryCatalogRepository } from './support/in-memory-catalog.repository';
import { TOKENS, startCatalogHttp } from './support/catalog-http-harness';

/*
 * Real HTTP transport + application + Identity adapter. Persistence here is an
 * in-memory TEST DOUBLE; PostgreSQL behaviour is proven by the integration suite.
 */

const T0 = new Date('2026-10-07T10:00:00.000Z');
const KEY = (n: number) => `catalog-key-${String(n).padStart(8, '0')}`;
const PATH = '/internal/v1/catalog';

function publishBody(expectedRevision: number, effectiveFrom: string | null = null) {
  return { expectedRevision, effectiveFrom, definitions: definitionsFixture() };
}

async function harness(options: { identityConfigured?: boolean; identityTimeoutMs?: number } = {}) {
  const repository = new InMemoryCatalogRepository();
  const clock = new FixedClock(T0);
  const http = await startCatalogHttp({ repository, clock, ...options });
  return { repository, clock, http };
}

test('catalog http: missing, malformed and unknown credentials are 401', async () => {
  const { http } = await harness();
  try {
    assert.equal((await http.request('GET', `${PATH}/definitions`)).status, 401);
    const unknown = await http.request('GET', `${PATH}/definitions`, { token: TOKENS.unknown });
    assert.equal(unknown.status, 401);
    assert.equal((unknown.body.error as { code: string }).code, 'AUTH_REQUIRED');
    // A non-JWT-shaped credential is never forwarded to Identity.
    const before = http.identity.calls.length;
    const raw = await fetch(http.url + `${PATH}/definitions`, {
      headers: { authorization: 'Basic YWRtaW46YWRtaW4=' },
    });
    assert.equal(raw.status, 401);
    assert.equal(http.identity.calls.length, before);
  } finally {
    await http.close();
  }
});

test('catalog http: Identity outage, error, timeout or ambiguity fails closed with 503', async () => {
  const unconfigured = await harness({ identityConfigured: false });
  try {
    const response = await unconfigured.http.request('GET', `${PATH}/definitions`, {
      token: TOKENS.admin,
    });
    assert.equal(response.status, 503);
    assert.equal((response.body.error as { code: string }).code, 'AUTH_UNAVAILABLE');
  } finally {
    await unconfigured.http.close();
  }
  const { http, repository } = await harness({ identityTimeoutMs: 200 });
  try {
    for (const mode of ['error-500', 'garbage', 'hang'] as const) {
      http.identity.mode = mode;
      const started = Date.now();
      const response = await http.request('POST', `${PATH}/definitions`, {
        token: TOKENS.admin,
        key: KEY(1),
        body: publishBody(0),
      });
      assert.equal(response.status, 503, mode);
      assert.ok(Date.now() - started < 5_000, 'the Identity timeout is bounded');
    }
    assert.equal(repository.revisions.length, 0, 'no unauthorised effect');
    assert.equal(repository.receipts.size, 0);
  } finally {
    await http.close();
  }
});

test('catalog http: a customer can read but cannot publish or list revisions', async () => {
  const { http, repository } = await harness();
  try {
    const empty = await http.request('GET', `${PATH}/definitions`, { token: TOKENS.customer });
    assert.equal(empty.status, 404);
    assert.equal((empty.body.error as { code: string }).code, 'CATALOG_NOT_PUBLISHED');
    const publish = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.customer,
      key: KEY(2),
      body: publishBody(0),
    });
    assert.equal(publish.status, 403);
    assert.equal(repository.revisions.length, 0);
    assert.equal(repository.receipts.size, 0, 'unauthorised requests create no receipt');
    assert.equal(
      (await http.request('GET', `${PATH}/revisions`, { token: TOKENS.customer })).status,
      403,
    );
  } finally {
    await http.close();
  }
});

test('catalog http: malformed commands are rejected before any receipt', async () => {
  const { http, repository } = await harness();
  try {
    const noKey = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      body: publishBody(0),
    });
    assert.equal(noKey.status, 400);
    assert.equal((noKey.body.error as { code: string }).code, 'IDEMPOTENCY_KEY_INVALID');
    const shortKey = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: 'short',
      body: publishBody(0),
    });
    assert.equal(shortKey.status, 400);
    const unknownField = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(3),
      body: { ...publishBody(0), totalMinor: '1' },
    });
    assert.equal(unknownField.status, 400);
    const badTime = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(3),
      body: publishBody(0, '2026-02-30T00:00:00.000Z'),
    });
    assert.equal(badTime.status, 400);
    const semantic = definitionsFixture() as { packages: Record<string, unknown>[] };
    (semantic.packages[0] as Record<string, unknown>).allowedCategoryIds = ['bus'];
    const invalid = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(3),
      body: { expectedRevision: 0, effectiveFrom: null, definitions: semantic },
    });
    assert.equal(invalid.status, 422);
    assert.equal((invalid.body.error as { code: string }).code, 'DEFINITIONS_INVALID');
    assert.equal(repository.receipts.size, 0);
    assert.equal(repository.revisions.length, 0);
  } finally {
    await http.close();
  }
});

test('catalog http: publish, replay, key conflict and stale revision', async () => {
  const { http, repository } = await harness();
  try {
    const first = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(10),
      body: publishBody(0),
      correlationId: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.revision, 1);
    assert.equal(first.body.effectiveFrom, T0.toISOString());
    assert.equal(first.headers.get('idempotency-replayed'), 'false');
    assert.equal(
      http.identity.calls.at(-1)?.correlationId,
      '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
      'correlation is propagated to Identity',
    );

    const replay = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(10),
      body: publishBody(0),
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('idempotency-replayed'), 'true');
    assert.deepEqual(replay.body, first.body);

    const conflict = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(10),
      body: publishBody(1),
    });
    assert.equal(conflict.status, 409);
    assert.equal((conflict.body.error as { code: string }).code, 'IDEMPOTENCY_CONFLICT');

    // The same key from a different publisher is a different receipt scope.
    const stale = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.otherAdmin,
      key: KEY(10),
      body: publishBody(0),
    });
    assert.equal(stale.status, 409);
    assert.equal((stale.body.error as { code: string }).code, 'REVISION_CONFLICT');
    const staleReplay = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.otherAdmin,
      key: KEY(10),
      body: publishBody(0),
    });
    assert.equal(staleReplay.status, 409, 'terminal rejection is durable for the key');
    assert.equal(staleReplay.headers.get('idempotency-replayed'), 'true');

    assert.equal(repository.revisions.length, 1);
    assert.deepEqual(
      repository.audit.map((a) => a.outcome),
      ['PUBLISHED', 'REVISION_CONFLICT'],
    );
  } finally {
    await http.close();
  }
});

test('catalog http: scheduled revisions switch at their effective time', async () => {
  const { http, clock } = await harness();
  try {
    await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(20),
      body: publishBody(0),
    });
    const next = new Date(T0.getTime() + 3_600_000).toISOString();
    const scheduled = await http.request('POST', `${PATH}/definitions`, {
      token: TOKENS.admin,
      key: KEY(21),
      body: publishBody(1, next),
    });
    assert.equal(scheduled.status, 201);
    const now = await http.request('GET', `${PATH}/definitions`, { token: TOKENS.customer });
    assert.equal(now.body.revision, 1);
    assert.equal(now.body.effectiveUntil, next);
    clock.advance(3_600_000);
    const later = await http.request('GET', `${PATH}/definitions`, { token: TOKENS.customer });
    assert.equal(later.body.revision, 2);
    assert.equal(later.body.effectiveUntil, null);
    const pinned = await http.request('GET', `${PATH}/definitions/1`, { token: TOKENS.customer });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.body.effectiveUntil, next);
    for (const bad of ['0', '01', 'abc', '99999999999', '1.0'])
      assert.equal(
        (await http.request('GET', `${PATH}/definitions/${bad}`, { token: TOKENS.customer }))
          .status,
        404,
        bad,
      );
    const list = await http.request('GET', `${PATH}/revisions`, { token: TOKENS.admin });
    assert.deepEqual(
      (list.body.revisions as { revision: number }[]).map((r) => r.revision),
      [2, 1],
    );
  } finally {
    await http.close();
  }
});

test('catalog http: concurrent publishers against one head produce exactly one revision', async () => {
  const { http, repository } = await harness();
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        http.request('POST', `${PATH}/definitions`, {
          token: TOKENS.admin,
          key: KEY(100 + n),
          body: publishBody(0),
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 7);
    assert.equal(repository.revisions.length, 1);

    const sameKey = await Promise.all(
      Array.from({ length: 5 }, () =>
        http.request('POST', `${PATH}/definitions`, {
          token: TOKENS.admin,
          key: KEY(200),
          body: publishBody(1, '2026-10-08T00:00:00.000Z'),
        }),
      ),
    );
    assert.ok(sameKey.every((r) => r.status === 201 && r.body.revision === 2));
    assert.equal(
      sameKey.filter((r) => r.headers.get('idempotency-replayed') === 'false').length,
      1,
    );
    assert.equal(repository.revisions.length, 2);
  } finally {
    await http.close();
  }
});
