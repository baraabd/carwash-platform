/**
 * Provider verification: Catalog's real HTTP adapter versus the PUBLISHED
 * catalog.v1 parsers and the published error envelope (@carwash/contracts).
 *
 * Catalog cannot depend on @carwash/contracts yet (the lockfile is Lane E's),
 * so it restates the request rules locally. This suite keeps that restatement
 * honest: every response body must parse with the published parser, and every
 * request document is accepted or rejected by BOTH the published parser and
 * the service. The single documented exception is CR-B-P06-01
 * (expectedCatalogRevision: 0 for the very first publication).
 *
 * Persistence is the in-memory test double: this is contract evidence, not
 * database evidence (see scripts/production/B/postgres-acceptance.mjs).
 *
 * Requires: pnpm run build:packages, and
 *           pnpm --filter @carwash/catalog run generate && run build:tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const contracts = (name) => require(path.join(ROOT, 'packages', 'contracts', 'dist', name));
const catalog = contracts('catalog/v1.js');
const { parseApiErrorEnvelope } = contracts('common/errors.js');
const { contractProblems } = contracts('common/route.js');
const support = (name) =>
  require(path.join(ROOT, 'services', 'catalog', 'dist-tests', 'test', 'support', name));
const { startCatalogHttp, TOKENS } = support('catalog-http-harness.js');
const { InMemoryCatalogRepository, FixedClock } = support('in-memory-catalog.repository.js');
const { definitionsFixture, publishBody } = support('catalog-fixtures.js');
const { CatalogController } = require(
  path.join(
    ROOT,
    'services',
    'catalog',
    'dist-tests',
    'src',
    'transport',
    'http',
    'catalog.controller.js',
  ),
);

const PREFIX = catalog.CATALOG_V1.prefix;
let seq = 0;
const key = () => `provider-key-${String(++seq).padStart(8, '0')}`;

async function harness() {
  return startCatalogHttp({
    repository: new InMemoryCatalogRepository(),
    clock: new FixedClock(new Date('2026-10-11T09:00:00.000Z')),
  });
}

function accepts(fn, value) {
  try {
    fn(value);
    return true;
  } catch {
    return false;
  }
}

test('catalog.v1: the published descriptor is structurally valid and matches the served routes', () => {
  assert.deepEqual(contractProblems(catalog.CATALOG_V1), []);
  assert.equal(PREFIX, '/internal/v1/catalog');
  const routes = Object.values(catalog.CATALOG_V1.routes).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(routes.sort(), [
    'GET /definitions',
    'GET /definitions/:definitionId',
    'POST /publications',
  ]);
  // Nest metadata of the real controller: the same three routes and nothing else.
  const proto = CatalogController.prototype;
  const served = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = proto[name];
      const route = Reflect.getMetadata('path', handler);
      const method = Reflect.getMetadata('method', handler);
      return route === undefined ? null : `${['GET', 'POST'][method]} /${route}`;
    })
    .filter(Boolean);
  assert.deepEqual(served.sort(), routes.sort());
  assert.equal(Reflect.getMetadata('path', CatalogController), PREFIX);
});

test('catalog.v1: every success body parses with the published parsers', async () => {
  const http = await harness();
  try {
    const published = await http.request('POST', `${PREFIX}/publications`, {
      token: TOKENS.admin,
      key: key(),
      body: publishBody(0, definitionsFixture()),
    });
    assert.equal(published.status, 201);
    const parsed = catalog.parseCatalogV1(published.body);
    assert.equal(parsed.catalogRevision, 1);

    const second = definitionsFixture();
    second[2] = { ...second[2], status: 'RETIRED' };
    second[0] = { ...second[0], description: { ar: 'وصف جديد', en: 'New' } };
    const next = await http.request('POST', `${PREFIX}/publications`, {
      token: TOKENS.admin,
      key: key(),
      // From revision 1 on, the request itself is a published-parser document.
      body: catalog.parsePublishCatalogRequestV1(publishBody(1, second, 'RETIRE_EXTRA')),
    });
    assert.equal(next.status, 201);
    const snapshot = catalog.parseCatalogV1(next.body);
    assert.deepEqual(
      snapshot.items.map((d) => [d.status, d.revision]),
      [
        ['PUBLISHED', 2],
        ['PUBLISHED', 1],
        ['RETIRED', 2],
      ],
    );

    const read = await http.request('GET', `${PREFIX}/definitions`);
    assert.deepEqual(catalog.parseCatalogV1(read.body), snapshot);
    for (const item of snapshot.items) {
      const one = await http.request('GET', `${PREFIX}/definitions/${item.definitionId}`);
      assert.deepEqual(catalog.parseDefinitionV1(one.body), item);
    }
  } finally {
    await http.close();
  }
});

test('catalog.v1: every error body parses with the published error envelope', async () => {
  const http = await harness();
  try {
    const cases = [
      await http.request('GET', `${PREFIX}/definitions`),
      await http.request('GET', `${PREFIX}/definitions/not-a-uuid`),
      await http.request('POST', `${PREFIX}/publications`, { key: key(), body: {} }),
      await http.request('POST', `${PREFIX}/publications`, {
        token: TOKENS.customer,
        key: key(),
        body: {},
      }),
      await http.request('POST', `${PREFIX}/publications`, { token: TOKENS.admin, body: {} }),
      await http.request('POST', `${PREFIX}/publications`, {
        token: TOKENS.admin,
        key: key(),
        rawBody: '{',
      }),
      await http.request('POST', `${PREFIX}/publications`, {
        token: TOKENS.admin,
        key: key(),
        body: { nope: true },
      }),
      await http.request('POST', `${PREFIX}/publications`, {
        token: TOKENS.admin,
        key: key(),
        body: publishBody(5, definitionsFixture()),
      }),
    ];
    http.identity.mode = 'error-500';
    cases.push(
      await http.request('POST', `${PREFIX}/publications`, {
        token: TOKENS.admin,
        key: key(),
        body: {},
      }),
    );
    for (const result of cases) {
      assert.ok(result.status >= 400);
      const envelope = parseApiErrorEnvelope(result.body);
      if (envelope.error.reason !== null)
        assert.ok(catalog.CATALOG_V1.reasons.includes(envelope.error.reason));
    }
    assert.deepEqual(
      cases.map((r) => [r.status, r.body.error.code]),
      [
        [404, 'NOT_FOUND'],
        [404, 'NOT_FOUND'],
        [401, 'AUTH_REQUIRED'],
        [403, 'AUTH_FORBIDDEN'],
        [428, 'IDEMPOTENCY_KEY_REQUIRED'],
        [400, 'REQUEST_INVALID'],
        [422, 'VALIDATION_FAILED'],
        [412, 'REVISION_CONFLICT'],
        [503, 'DEPENDENCY_UNAVAILABLE'],
      ],
    );
  } finally {
    await http.close();
  }
});

test('catalog.v1: the service and the published parser agree on every request document', async () => {
  const base = () => publishBody(1, definitionsFixture(), 'PARITY_CHECK');
  const d = definitionsFixture()[0];
  const mutate = (definition) => ({ ...base(), definitions: [definition] });
  const documents = [
    ['baseline', base()],
    ['extra root field', { ...base(), extra: true }],
    ['missing reasonCode', { expectedCatalogRevision: 1, definitions: definitionsFixture() }],
    ['lowercase reasonCode', { ...base(), reasonCode: 'nope' }],
    ['revision as string', { ...base(), expectedCatalogRevision: '1' }],
    ['fractional revision', { ...base(), expectedCatalogRevision: 1.5 }],
    ['empty definitions', { ...base(), definitions: [] }],
    ['201 definitions', { ...base(), definitions: Array.from({ length: 201 }, () => d) }],
    ['duplicate ids', { ...base(), definitions: [d, { ...d, code: 'other-code' }] }],
    [
      'duplicate codes',
      {
        ...base(),
        definitions: [d, { ...d, definitionId: '00000000-0000-4000-8000-0000000000ff' }],
      },
    ],
    ['uppercase uuid', mutate({ ...d, definitionId: d.definitionId.toUpperCase() })],
    ['bad uuid version', mutate({ ...d, definitionId: '00000000-0000-9000-8000-000000000001' })],
    ['unknown kind', mutate({ ...d, kind: 'BUNDLE' })],
    ['code too short', mutate({ ...d, code: 'a' })],
    ['code uppercase', mutate({ ...d, code: 'Exterior' })],
    ['code 40 chars', mutate({ ...d, code: `a${'b'.repeat(39)}` })],
    ['code 41 chars', mutate({ ...d, code: `a${'b'.repeat(40)}` })],
    ['name 80 code points', mutate({ ...d, name: { ar: '😀'.repeat(80), en: null } })],
    ['name 81 code points', mutate({ ...d, name: { ar: '😀'.repeat(81), en: null } })],
    ['name empty', mutate({ ...d, name: { ar: '', en: null } })],
    ['name missing en', mutate({ ...d, name: { ar: 'اسم' } })],
    ['name control char', mutate({ ...d, name: { ar: 'a\u0001', en: null } })],
    ['name tab allowed', mutate({ ...d, name: { ar: 'a\tb', en: null } })],
    ['description 500', mutate({ ...d, description: { ar: 'و'.repeat(500), en: null } })],
    ['description 501', mutate({ ...d, description: { ar: 'و'.repeat(501), en: null } })],
    ['duration 4', mutate({ ...d, durationMinutes: 4 })],
    ['duration 5', mutate({ ...d, durationMinutes: 5 })],
    ['duration 480', mutate({ ...d, durationMinutes: 480 })],
    ['duration 481', mutate({ ...d, durationMinutes: 481 })],
    ['vehicle types empty', mutate({ ...d, vehicleTypes: [] })],
    ['vehicle types duplicate', mutate({ ...d, vehicleTypes: ['suv', 'suv'] })],
    ['vehicle type unknown', mutate({ ...d, vehicleTypes: ['bus'] })],
    ['all vehicle types', mutate({ ...d, vehicleTypes: ['pickup', 'large', 'suv', 'sedan'] })],
    ['status unknown', mutate({ ...d, status: 'DRAFT' })],
    ['sortOrder 10000', mutate({ ...d, sortOrder: 10_000 })],
    ['sortOrder 10001', mutate({ ...d, sortOrder: 10_001 })],
    ['definition extra field', mutate({ ...d, price: 1 })],
    ['definition with revision', mutate({ ...d, revision: 1 })],
  ];
  const http = await harness();
  try {
    // Make revision 1 exist so the baseline-shaped documents reach the planner.
    const seeded = await http.request('POST', `${PREFIX}/publications`, {
      token: TOKENS.admin,
      key: key(),
      body: publishBody(0, definitionsFixture()),
    });
    assert.equal(seeded.status, 201);
    for (const [name, document] of documents) {
      const contractAccepts = accepts(catalog.parsePublishCatalogRequestV1, document);
      const result = await http.request('POST', `${PREFIX}/publications`, {
        token: TOKENS.admin,
        key: key(),
        body: document,
      });
      // Shape rejections are VALIDATION_FAILED; anything else reached the domain.
      const serviceAccepts = !(
        result.status === 422 && result.body.error.code === 'VALIDATION_FAILED'
      );
      assert.equal(serviceAccepts, contractAccepts, `${name}: ${JSON.stringify(result.body)}`);
    }
    assert.equal(accepts(catalog.parsePublishCatalogRequestV1, documents[0][1]), true);

    // CR-B-P06-01: the only deliberate superset.
    assert.equal(
      accepts(catalog.parsePublishCatalogRequestV1, publishBody(0, definitionsFixture())),
      false,
    );
  } finally {
    await http.close();
  }
});
