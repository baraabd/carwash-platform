/**
 * P02-A3 Geo provider (geo.v1): real PostgreSQL, real Identity (account and
 * guest sessions), real HTTP adapter, real operator CLI processes.
 *
 * Provider verification: every success and error body is parsed with the
 * PUBLISHED, BUILT @carwash/contracts geo.v1 / common parsers. Geo itself may
 * not depend on that package (Lane E lockfile), so this suite is the drift gate.
 *
 * Zone shapes here are SYNTHETIC squares around (0, 0) labelled
 * `test-fixture:*`. They are not service areas; no city geography is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ROOT,
  account,
  client,
  context,
  contracts,
  guest,
  serviceRequire,
  sql,
  sqlState,
  startIdentity,
  startService,
} from './_support.mjs';

const { geoV1, parseApiErrorEnvelope, API_ERROR_STATUS } = contracts;

const db = context.services.geo.app;
const work = await mkdtemp(path.join(tmpdir(), 'p02a3-'));
const identity = await startIdentity();
const geoEnv = {
  GEO_SERVICEABILITY_RATE_PER_MINUTE: '100000',
  GEO_IDENTITY_ORIGIN: identity.base,
  GEO_IDENTITY_TIMEOUT_MS: '3000',
};
const geo = await startService('geo', db, geoEnv);
const call = client(geo.base, '/internal/v1/geo');

test.after(async () => {
  await geo.app.close();
  // The outage test closes Identity itself; closing twice is harmless here.
  await identity.app.close().catch(() => {});
  await rm(work, { recursive: true, force: true });
});

const user = await account(identity);
const visitor = await guest(identity);
const bearer = { authorization: `Bearer ${user.token}` };

const point = (latitude, longitude) => ({ point: { latitude, longitude } });
async function check(latitude, longitude, headers = bearer) {
  const response = await call('/serviceability', {
    method: 'POST',
    headers,
    body: point(latitude, longitude),
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  // Provider verification: the published parser accepts the answer as-is.
  return geoV1.parseServiceabilityDecisionV1(response.body);
}

function refusal(response, code) {
  assert.equal(response.status, API_ERROR_STATUS[code], JSON.stringify(response.body));
  const parsed = parseApiErrorEnvelope(response.body);
  assert.equal(parsed.error.code, code);
  assert.equal(response.headers.get('x-correlation-id'), parsed.error.correlationId);
  return parsed.error;
}

async function zonesList() {
  const response = await call('/service-zones');
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ['items']);
  return response.body.items.map((item, index) =>
    geoV1.parseServiceZoneV1(item, `$.items[${index}]`),
  );
}

const square = (code, x0, y0, size, extra = {}) => ({
  code,
  name: `اختبار ${code}`,
  datasetRef: 'test-fixture:synthetic',
  polygon: [
    [x0, y0],
    [String(Number(x0) + size), y0],
    [String(Number(x0) + size), String(Number(y0) + size)],
    [x0, String(Number(y0) + size)],
    [x0, y0],
  ],
  ...extra,
});

let fileCounter = 0;
async function cli(script, args, zones) {
  const argv = [...args];
  if (zones !== undefined) {
    fileCounter += 1;
    const file = path.join(work, `zones-${fileCounter}.json`);
    await writeFile(file, JSON.stringify(zones));
    argv.splice(1, 0, file);
  }
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, `services/geo/dist/transport/cli/${script}.js`), ...argv],
      { env: { ...process.env, DATABASE_URL: db }, windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) =>
      resolve({
        code,
        stderr,
        stdout,
        lines: stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      }),
    );
  });
}
const zonesCli = (args, zones) => cli('zones', args, zones);
const actor = ['--actor', 'ops.p02a3-test'];
const datasetRevision = async () =>
  (await sql(db, 'SELECT revision FROM app.geo_dataset_state WHERE id = 1')).rows[0].revision;
const decisionCount = async () =>
  (await sql(db, 'SELECT count(*)::int AS n FROM app.serviceability_decision')).rows[0].n;

test('no approved data: no zone is seeded; the answer is INDETERMINATE / GEO_DATASET_UNAVAILABLE', async () => {
  const rows = await sql(db, 'SELECT count(*)::int AS n FROM app.service_zone');
  assert.equal(rows.rows[0].n, 0, 'no zone may be invented by a migration');
  assert.equal(await datasetRevision(), 1);
  const decision = await check('36.202100', '37.134300');
  assert.equal(decision.decision, 'INDETERMINATE');
  assert.equal(decision.reason, 'GEO_DATASET_UNAVAILABLE');
  assert.deepEqual(
    [decision.zoneId, decision.zoneRevision, decision.datasetRevision],
    [null, null, 1],
  );
  assert.deepEqual(decision.point, { latitude: '36.202100', longitude: '37.134300' });
  assert.equal(Date.parse(decision.expiresAt) - Date.parse(decision.checkedAt), 30 * 60_000);
  const stored = await sql(
    db,
    'SELECT decision, reason, detail, latitude::text AS lat FROM app.serviceability_decision WHERE id = $1',
    [decision.decisionId],
  );
  assert.deepEqual(stored.rows[0], {
    decision: 'INDETERMINATE',
    reason: 'GEO_DATASET_UNAVAILABLE',
    detail: 'NO_APPROVED_ZONES',
    lat: '36.202100',
  });
  assert.deepEqual(await zonesList(), []);
});

test('access: principal only; a guest session works; missing, forged and revoked sessions are refused', async () => {
  const asGuest = await check('0.500000', '0.500000', { cookie: visitor.jar.header() });
  assert.equal(asGuest.decision, 'INDETERMINATE');
  // Guests may also present the access token as a bearer.
  const guestBearer = await check('0.500000', '0.500000', {
    authorization: `Bearer ${visitor.token}`,
  });
  assert.equal(guestBearer.decision, 'INDETERMINATE');
  const body = point('0.500000', '0.500000');
  refusal(await call('/serviceability', { method: 'POST', body }), 'AUTH_REQUIRED');
  refusal(
    await call('/serviceability', {
      method: 'POST',
      headers: { authorization: 'Bearer not.a.token' },
      body,
    }),
    'AUTH_REQUIRED',
  );
  // A foreign cookie is never forwarded to Identity and never authenticates.
  refusal(
    await call('/serviceability', { method: 'POST', headers: { cookie: 'session=forged' }, body }),
    'AUTH_REQUIRED',
  );
  const leaving = await account(identity);
  await leaving.logout();
  refusal(
    await call('/serviceability', {
      method: 'POST',
      headers: { authorization: `Bearer ${leaving.token}` },
      body,
    }),
    'AUTH_REQUIRED',
  );
  // The zone list is public and identical with or without credentials.
  const anonymous = await call('/service-zones');
  const personal = await call('/service-zones', { headers: bearer });
  assert.deepEqual(anonymous.body, personal.body);
});

test('contract-invalid requests: VALIDATION_FAILED with field issues; nothing is recorded', async () => {
  const before = await decisionCount();
  for (const [body, field, code] of [
    [point('NaN', '0.500000'), '$.point.latitude', 'INVALID_COORDINATE'],
    [point('Infinity', '0.500000'), '$.point.latitude', 'INVALID_COORDINATE'],
    [point('0.500000', '-Infinity'), '$.point.longitude', 'INVALID_COORDINATE'],
    [point('1e1', '0.500000'), '$.point.latitude', 'INVALID_COORDINATE'],
    [point('0.5', '0.500000'), '$.point.latitude', 'INVALID_COORDINATE'],
    [point('0.1234567', '0.500000'), '$.point.latitude', 'INVALID_COORDINATE'],
    [point('-0.000000', '0.500000'), '$.point.latitude', 'INVALID_COORDINATE'],
    [point('90.000001', '0.500000'), '$.point.latitude', 'COORDINATE_OUT_OF_RANGE'],
    [point('0.500000', '180.000001'), '$.point.longitude', 'COORDINATE_OUT_OF_RANGE'],
    [{ point: { latitude: 0.5, longitude: 0.5 } }, '$.point.latitude', 'INVALID_COORDINATE'],
    [
      { coordinates: { crs: 'EPSG:4326', latitude: '0.5', longitude: '0.5' } },
      '$.point',
      'MISSING_FIELD',
    ],
    [
      { ...point('0.500000', '0.500000'), addressId: randomUUID() },
      '$.addressId',
      'UNEXPECTED_FIELD',
    ],
    [
      { point: { latitude: '0.500000', longitude: '0.500000', crs: 'EPSG:4326' } },
      '$.point.crs',
      'UNEXPECTED_FIELD',
    ],
    [{ x: 350, y: 240 }, '$.point', 'MISSING_FIELD'],
    [[], '$', 'EXPECTED_OBJECT'],
  ]) {
    const error = refusal(
      await call('/serviceability', { method: 'POST', headers: bearer, body }),
      'VALIDATION_FAILED',
    );
    assert.deepEqual(error.issues, [{ field, code }], JSON.stringify(body));
    assert.equal(error.retryable, false);
  }
  refusal(
    await call('/serviceability', { method: 'POST', headers: bearer, body: '{"point":' }),
    'REQUEST_INVALID',
  );
  refusal(
    await call('/serviceability', {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ point: { latitude: '0.500000', longitude: 'x'.repeat(20_000) } }),
    }),
    'REQUEST_INVALID',
  );
  assert.equal(await decisionCount(), before);
});

test('import: provenance recorded; dataset revision advances; zone list is geo.v1 without geometry', async () => {
  const first = await zonesCli(
    ['import', ...actor],
    [square('t-a', '0', '0', 1, { nameEn: 'Test A' })],
  );
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.lines[0], { target: '#0', outcome: 'created', code: 't-a', revision: 1 });
  assert.equal(await datasetRevision(), 2);
  const again = await zonesCli(
    ['import', ...actor],
    square('t-a', '0', '0', 1, { nameEn: 'Test A' }),
  );
  assert.equal(again.lines[0].outcome, 'unchanged', JSON.stringify(again.lines[0]) + again.stderr);
  assert.equal(await datasetRevision(), 2, 'a no-op import does not advance the dataset');
  const changed = await zonesCli(['import', ...actor], square('t-a', '0', '0', 2));
  assert.deepEqual(changed.lines[0], {
    target: '#0',
    outcome: 'refused',
    code: 'ZONE_CODE_CONFLICT:code',
  });
  const zones = await zonesList();
  assert.equal(zones.length, 1);
  assert.deepEqual(
    { name: zones[0].name, status: zones[0].status, revision: zones[0].revision },
    { name: { ar: 'اختبار t-a', en: 'Test A' }, status: 'ACTIVE', revision: 1 },
  );
  const raw = JSON.stringify((await call('/service-zones')).body);
  assert.ok(!raw.includes('polygon') && !raw.includes('test-fixture'), 'no geometry or provenance');
  const noProvenance = await zonesCli(['import', ...actor], {
    ...square('t-x', '5', '5', 1),
    datasetRef: undefined,
  });
  assert.equal(noProvenance.lines[0].code, 'INVALID_DATASET_REF:datasetRef');
});

test('serviceability: inside, outside and on-boundary answers are exact and contract-valid', async () => {
  const [zone] = await zonesList();
  const inside = await check('0.500000', '0.500000');
  assert.deepEqual(
    [inside.decision, inside.zoneId, inside.zoneRevision, inside.reason, inside.datasetRevision],
    ['SERVICEABLE', zone.zoneId, 1, null, 2],
  );
  assert.equal((await check('0.000001', '0.999999')).decision, 'SERVICEABLE');
  assert.equal((await check('0.500000', '1.000001')).decision, 'OUTSIDE_ZONE');
  assert.equal((await check('50.000000', '50.000000')).decision, 'OUTSIDE_ZONE');
  for (const [lat, lng] of [
    ['0.500000', '1.000000'],
    ['0.000000', '0.000000'],
  ]) {
    const edge = await check(lat, lng);
    assert.deepEqual(
      [edge.decision, edge.reason, edge.zoneId],
      ['INDETERMINATE', 'LOCATION_UNRESOLVED', null],
    );
  }
  const negative = await check('-0.500000', '-0.500000');
  assert.deepEqual(negative.point, { latitude: '-0.500000', longitude: '-0.500000' });
});

test('overlap: a point inside two ACTIVE zones is LOCATION_UNRESOLVED until a rule is approved', async () => {
  const imported = await zonesCli(['import', ...actor], [square('t-b', '0.5', '0.5', 1)]);
  assert.equal(imported.code, 0, JSON.stringify(imported.lines) + imported.stderr);
  assert.equal(await datasetRevision(), 3);
  const both = await check('0.750000', '0.750000');
  assert.deepEqual([both.decision, both.reason], ['INDETERMINATE', 'LOCATION_UNRESOLVED']);
  const detail = await sql(db, 'SELECT detail FROM app.serviceability_decision WHERE id = $1', [
    both.decisionId,
  ]);
  assert.equal(detail.rows[0].detail, 'OVERLAPPING_ZONES');
  assert.equal((await check('1.250000', '1.250000')).decision, 'SERVICEABLE');
});

test('concurrency: four simultaneous imports of one code create one zone and one dataset step', async () => {
  const before = await datasetRevision();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => zonesCli(['import', ...actor], square('t-c', '10', '10', 1))),
  );
  const outcomes = results.map((r) => r.lines[0].outcome).sort();
  assert.deepEqual(outcomes, ['created', 'unchanged', 'unchanged', 'unchanged']);
  const rows = await sql(db, "SELECT count(*)::int AS n FROM app.service_zone WHERE code = 't-c'");
  assert.equal(rows.rows[0].n, 1);
  assert.equal(await datasetRevision(), before + 1);
});

test('revisions: stale revise refused; concurrent revise with one revision has one winner', async () => {
  const stale = await zonesCli(
    ['revise', '--revision', '7', ...actor],
    square('t-c', '10', '10', 2),
  );
  assert.deepEqual(stale.lines[0], { target: '#0', outcome: 'refused', code: 'REVISION_CONFLICT' });
  const [one, two] = await Promise.all([
    zonesCli(['revise', '--revision', '1', ...actor], square('t-c', '10', '10', 2)),
    zonesCli(['revise', '--revision', '1', ...actor], square('t-c', '10', '10', 3)),
  ]);
  const outcomes = [one.lines[0], two.lines[0]].map((line) => line.outcome).sort();
  assert.deepEqual(outcomes, ['refused', 'revised']);
  const row = await sql(db, "SELECT revision FROM app.service_zone WHERE code = 't-c'");
  assert.equal(row.rows[0].revision, 2);
});

test('invalid geometry from a dataset is refused and writes nothing', async () => {
  const bowTie = {
    code: 't-bad',
    name: 'bad',
    datasetRef: 'test-fixture:synthetic',
    polygon: [
      ['20', '20'],
      ['23', '21'],
      ['23', '20'],
      ['20', '22'],
      ['20', '20'],
    ],
  };
  const before = await datasetRevision();
  const result = await zonesCli(['import', ...actor], bowTie);
  assert.deepEqual(result.lines[0], {
    target: '#0',
    outcome: 'refused',
    code: 'INVALID_POLYGON:polygon.selfIntersection',
  });
  assert.equal(await datasetRevision(), before);
});

test('validateDecision: use case on the real store; the HTTP route stays closed', async () => {
  const own = serviceRequire('geo');
  const { ServiceabilityApplication, VALIDATE_SCOPE } = own('./dist/application/index.js');
  const { PrismaGeoStore } = own('./dist/infrastructure/persistence/prisma-geo.store.js');
  const { PrismaService } = own('./dist/infrastructure/persistence/prisma.service.js');
  const prisma = new PrismaService(db);
  try {
    const app = new ServiceabilityApplication(
      new PrismaGeoStore(prisma.client, 'app'),
      { authorize: () => Promise.reject(new Error('not used')) },
      { now: () => new Date() },
      { uuid: () => randomUUID() },
      { decisionTtlMs: 30 * 60_000 },
    );
    const booking = { service: 'booking', scopes: [VALIDATE_SCOPE] };
    const decided = await check('10.500000', '10.500000');
    assert.equal(decided.decision, 'SERVICEABLE');
    const request = geoV1.parseValidateDecisionRequestV1({
      decisionId: decided.decisionId,
      expectedZoneRevision: decided.zoneRevision,
      point: decided.point,
      purpose: 'booking-create',
    });
    const valid = geoV1.parseValidateDecisionResultV1(await app.validate(booking, request));
    assert.deepEqual([valid.valid, valid.reason, valid.zoneId], [true, null, decided.zoneId]);
    const moved = geoV1.parseValidateDecisionResultV1(
      await app.validate(booking, {
        ...request,
        point: { ...request.point, latitude: '10.500001' },
      }),
    );
    assert.equal(moved.reason, 'POINT_MISMATCH');
    const revised = await zonesCli(
      ['revise', '--revision', '2', ...actor],
      square('t-c', '10', '10', 4),
    );
    assert.equal(revised.lines[0].outcome, 'revised');
    const changed = geoV1.parseValidateDecisionResultV1(await app.validate(booking, request));
    assert.deepEqual(
      [changed.valid, changed.reason, changed.zoneRevision],
      [false, 'ZONE_CHANGED', 3],
    );
    const outside = await check('40.000000', '40.000000');
    const notServiceable = geoV1.parseValidateDecisionResultV1(
      await app.validate(booking, {
        ...request,
        decisionId: outside.decisionId,
        point: outside.point,
      }),
    );
    assert.equal(notServiceable.reason, 'DECISION_NOT_FOUND');
    await assert.rejects(
      app.validate({ service: 'booking', scopes: [] }, request),
      /AUTH_FORBIDDEN/,
    );
  } finally {
    await prisma.onModuleDestroy();
  }
  for (const headers of [
    {},
    bearer,
    { 'x-service-client': 'booking', 'x-service-token': 'guess', ...bearer },
  ]) {
    refusal(
      await call('/serviceability/validate', {
        method: 'POST',
        headers,
        body: {
          decisionId: randomUUID(),
          expectedZoneRevision: 1,
          ...point('0.500000', '0.500000'),
          purpose: 'booking-create',
        },
      }),
      'AUTH_FORBIDDEN',
    );
  }
});

test('retire: retired zones stop counting and leave the list; audit is append-only', async () => {
  const retired = await zonesCli(['retire', 't-b', '--revision', '1', ...actor]);
  assert.deepEqual(retired.lines[0], {
    target: 't-b',
    outcome: 'retired',
    code: 't-b',
    revision: 2,
  });
  assert.equal((await check('0.750000', '0.750000')).decision, 'SERVICEABLE');
  assert.equal((await check('1.250000', '1.250000')).decision, 'OUTSIDE_ZONE');
  assert.equal(await sqlState(db, "UPDATE app.audit_entry SET actor = 'x'"), '42501');
  assert.equal(await sqlState(db, 'DELETE FROM app.audit_entry'), '42501');
  const active = (await sql(db, "SELECT id FROM app.service_zone WHERE status = 'ACTIVE'")).rows;
  const listed = (await zonesList()).map((z) => z.zoneId).sort();
  assert.deepEqual(listed, active.map((r) => r.id).sort());
});

test('database: decision invariants, immutability and the dataset singleton are enforced by PostgreSQL', async () => {
  const insert = `INSERT INTO app.serviceability_decision
      (id, decision, reason, detail, zone_id, zone_revision, dataset_revision, latitude, longitude, checked_at, expires_at)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, $6::numeric, '0.5'::numeric, now(), now() + $7::interval)`;
  const attempt = (o = {}) => {
    const v = {
      decision: 'OUTSIDE_ZONE',
      reason: null,
      detail: null,
      zoneId: null,
      zoneRevision: null,
      lat: '0.5',
      ttl: '1 minute',
      ...o,
    };
    return sqlState(db, insert, [
      v.decision,
      v.reason,
      v.detail,
      v.zoneId,
      v.zoneRevision,
      v.lat,
      v.ttl,
    ]);
  };
  assert.equal(await attempt(), null);
  assert.equal(await attempt({ decision: 'SERVICEABLE' }), '23514', 'serviceable needs a zone');
  assert.equal(
    await attempt({ zoneId: randomUUID(), zoneRevision: 1 }),
    '23514',
    'outside has no zone',
  );
  assert.equal(await attempt({ decision: 'INDETERMINATE' }), '23514', 'needs a reason');
  assert.equal(
    await attempt({
      decision: 'INDETERMINATE',
      reason: 'LOCATION_UNRESOLVED',
      detail: 'NO_APPROVED_ZONES',
    }),
    '23514',
  );
  assert.equal(await attempt({ decision: 'MAYBE' }), '23514');
  assert.equal(await attempt({ lat: 'NaN' }), '23514');
  assert.equal(await attempt({ lat: '91' }), '23514');
  assert.equal(await attempt({ ttl: '0 seconds' }), '23514');
  assert.equal(
    await sqlState(db, "UPDATE app.serviceability_decision SET reason = 'LOCATION_UNRESOLVED'"),
    '42501',
    'decisions are immutable',
  );
  assert.equal(
    await sqlState(db, 'INSERT INTO app.geo_dataset_state VALUES (2, 1, now())'),
    '23514',
  );
  assert.equal(await sqlState(db, 'UPDATE app.geo_dataset_state SET revision = 0'), '23514');
  assert.equal(
    await sqlState(db, "UPDATE app.service_zone SET name_en = ' ' WHERE code = 't-a'"),
    '23514',
  );
});

test('retention: the purge job removes only decisions past expiry + retention', async () => {
  const old = randomUUID();
  const recent = randomUUID();
  const insert = `INSERT INTO app.serviceability_decision
      (id, decision, dataset_revision, latitude, longitude, checked_at, expires_at)
    VALUES ($1, 'OUTSIDE_ZONE', 1, 0.5, 0.5, now() - $2::interval, now() - $3::interval)`;
  await sql(db, insert, [old, '26 hours', '25 hours']);
  await sql(db, insert, [recent, '2 hours', '1 hour']);
  const result = await cli('decisions', ['purge']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.lines[0].outcome, 'purged');
  assert.ok(result.lines[0].count >= 1);
  assert.ok(!/[0-9]+\.[0-9]{6}/.test(result.stdout), 'no coordinate is printed');
  const left = await sql(db, 'SELECT id FROM app.serviceability_decision WHERE id = ANY($1)', [
    [old, recent],
  ]);
  assert.deepEqual(
    left.rows.map((r) => r.id),
    [recent],
  );
});

test('events: zone references and revision only, never coordinates or provenance', async () => {
  const rows = await sql(
    db,
    "SELECT payload FROM app.outbox_message WHERE event_type = 'geo.zone-updated.v1'",
  );
  assert.ok(rows.rows.length >= 4);
  for (const row of rows.rows) {
    const payload = JSON.parse(row.payload);
    assert.deepEqual(Object.keys(payload.data).sort(), ['change', 'code', 'status', 'zoneId']);
    assert.ok(!row.payload.includes('polygon') && !row.payload.includes('test-fixture'));
    assert.ok(!/[0-9]+\.[0-9]{6}/.test(row.payload));
  }
});

test('rate limit: bounded per client before Identity is contacted; 429 carries retryAfterMs', async () => {
  const limited = await startService('geo', db, {
    ...geoEnv,
    GEO_SERVICEABILITY_RATE_PER_MINUTE: '3',
  });
  try {
    const ask = client(limited.base, '/internal/v1/geo');
    const statuses = [];
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await ask('/serviceability', { method: 'POST', body: point('0.500000', '0.500000') });
      statuses.push(last.status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 429, 429], 'the limiter runs before Identity');
    const error = refusal(last, 'RATE_LIMITED');
    assert.equal(error.retryable, true);
    assert.ok(error.retryAfterMs > 0 && error.retryAfterMs <= 60_000);
    assert.ok(Number(last.headers.get('retry-after')) >= 1);
  } finally {
    await limited.app.close();
    process.env.GEO_SERVICEABILITY_RATE_PER_MINUTE = '100000';
  }
});

test('database outage: DEPENDENCY_UNAVAILABLE, never a decision', async () => {
  const closed = db.replace(/@127\.0\.0\.1:[0-9]+\//, '@127.0.0.1:1/');
  assert.notEqual(closed, db);
  const down = await startService('geo', closed, geoEnv);
  try {
    const ask = client(down.base, '/internal/v1/geo');
    const error = refusal(
      await ask('/serviceability', {
        method: 'POST',
        headers: bearer,
        body: point('0.500000', '0.500000'),
      }),
      'DEPENDENCY_UNAVAILABLE',
    );
    assert.equal(error.retryable, true);
    refusal(await ask('/service-zones'), 'DEPENDENCY_UNAVAILABLE');
  } finally {
    await down.app.close();
    process.env.DATABASE_URL = db;
  }
});

test('isolation: the geo runtime role cannot reach the Identity database', async () => {
  const state = await sqlState(context.crossServiceUrl.url, 'SELECT 1');
  assert.ok(['42501', '28P01', '3D000'].includes(state), `unexpected ${state}`);
});

test('isolation: trigger functions grant no EXECUTE to foreign or runtime roles', async () => {
  // The disposable cluster's bootstrap superuser intentionally bypasses ACLs.
  // Select service identities by their provisioned names, not rolsuper=false:
  // a mistakenly elevated service identity must still fail this assertion.
  for (const fn of ['app.audit_entry_append_only()', 'app.serviceability_decision_immutable()']) {
    const result = await sql(
      db,
      `SELECT r.rolname FROM pg_roles r
         WHERE r.rolname ~ '^cw_[a-z0-9_]+_(app|migrate)$'
           AND r.rolname <> 'cw_geo_migrate'
           AND has_function_privilege(r.oid, $1, 'EXECUTE')`,
      [fn],
    );
    assert.deepEqual(result.rows, [], fn);
  }
});

test('Identity outage: serviceability fails closed with DEPENDENCY_UNAVAILABLE, never a decision', async () => {
  const before = await decisionCount();
  await identity.app.close();
  const error = refusal(
    await call('/serviceability', {
      method: 'POST',
      headers: bearer,
      body: point('0.500000', '0.500000'),
    }),
    'DEPENDENCY_UNAVAILABLE',
  );
  assert.equal(error.retryable, true);
  assert.equal(await decisionCount(), before);
  // Public zones do not depend on Identity.
  assert.equal((await call('/service-zones')).status, 200);
});
