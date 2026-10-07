/**
 * P01-A3 Geo provider: real PostgreSQL, real HTTP adapter, real operator CLI
 * process. Zone shapes here are SYNTHETIC squares around (0, 0) labelled
 * `test-fixture:*`. They are not service areas; no city geography is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, client, context, sql, sqlState, startService } from './_support.mjs';

const db = context.services.geo.app;
const work = await mkdtemp(path.join(tmpdir(), 'p01a3-'));
const geo = await startService('geo', db, { GEO_SERVICEABILITY_RATE_PER_MINUTE: '100000' });
const call = client(geo.base, '/internal/v1/geo');

test.after(async () => {
  await geo.app.close();
  await rm(work, { recursive: true, force: true });
});

const square = (code, x0, y0, size, datasetRef = 'test-fixture:synthetic') => ({
  code,
  name: `اختبار ${code}`,
  datasetRef,
  polygon: [
    [x0, y0],
    [String(Number(x0) + size), y0],
    [String(Number(x0) + size), String(Number(y0) + size)],
    [x0, String(Number(y0) + size)],
    [x0, y0],
  ],
});

let fileCounter = 0;
async function zonesCli(args, zones) {
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
      [path.join(ROOT, 'services/geo/dist/transport/cli/zones.js'), ...argv],
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
        lines: stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      }),
    );
  });
}

const actor = ['--actor', 'ops.p01a-test'];
const at = (longitude, latitude) => ({
  coordinates: { crs: 'EPSG:4326', latitude, longitude },
});
const ask = async (longitude, latitude) =>
  (await call('/serviceability', { method: 'POST', body: at(longitude, latitude) })).body;

test('no approved data: migrations seed no zones and every answer is INDETERMINATE', async () => {
  const rows = await sql(db, 'SELECT count(*)::int AS n FROM app.service_zone');
  assert.equal(rows.rows[0].n, 0, 'no zone may be invented by a migration');
  const response = await call('/serviceability', { method: 'POST', body: at('37.15', '36.2') });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { result: 'INDETERMINATE', reason: 'NO_APPROVED_ZONES' });
  assert.deepEqual((await call('/service-zones')).body, { items: [] });
});

test('import: provenance is recorded; identical re-import is a no-op; a changed shape is refused', async () => {
  const first = await zonesCli(['import', ...actor], [square('t-a', '0', '0', 1)]);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.lines[0], { target: '#0', outcome: 'created', code: 't-a', revision: 1 });
  const again = await zonesCli(['import', ...actor], square('t-a', '0', '0', 1));
  assert.equal(again.lines[0].outcome, 'unchanged');
  const changed = await zonesCli(['import', ...actor], square('t-a', '0', '0', 2));
  assert.equal(changed.code, 1);
  assert.deepEqual(changed.lines[0], {
    target: '#0',
    outcome: 'refused',
    code: 'ZONE_CODE_CONFLICT:code',
  });
  const stored = await sql(
    db,
    "SELECT dataset_ref, revision FROM app.service_zone WHERE code = 't-a'",
  );
  assert.deepEqual(stored.rows[0], { dataset_ref: 'test-fixture:synthetic', revision: 1 });
  const noProvenance = await zonesCli(['import', ...actor], {
    ...square('t-x', '5', '5', 1),
    datasetRef: undefined,
  });
  assert.equal(noProvenance.lines[0].code, 'INVALID_DATASET_REF:datasetRef');
});

test('serviceability: inside, outside and exactly-on-boundary answers are exact', async () => {
  const inside = await ask('0.5', '0.5');
  assert.equal(inside.result, 'SERVICEABLE');
  assert.equal(inside.zone.code, 't-a');
  assert.equal(inside.zone.revision, 1);
  assert.deepEqual(await ask('0.999999', '0.000001'), { ...inside });
  assert.deepEqual(await ask('1.000001', '0.5'), { result: 'OUTSIDE_ZONE' });
  assert.deepEqual(await ask('50', '50'), { result: 'OUTSIDE_ZONE' });
  assert.deepEqual(await ask('1', '0.5'), { result: 'INDETERMINATE', reason: 'ON_ZONE_BOUNDARY' });
  assert.deepEqual(await ask('0', '0'), { result: 'INDETERMINATE', reason: 'ON_ZONE_BOUNDARY' });
});

test('serviceability: invalid and non-finite input is refused, never evaluated', async () => {
  for (const body of [
    at('0.5', 'NaN'),
    at('0.5', 'Infinity'),
    at('0.5', '91'),
    at('0.1234567', '0.5'),
    { coordinates: { crs: 'EPSG:4326', latitude: 0.5, longitude: 0.5 } },
    { coordinates: { crs: 'EPSG:4326', latitude: '0.5', longitude: '0.5' }, addressId: 'x' },
    { x: 350, y: 240 },
  ]) {
    const response = await call('/serviceability', { method: 'POST', body });
    assert.equal(response.status, 422, JSON.stringify(body));
  }
});

test('overlap: a point inside two ACTIVE zones is INDETERMINATE until a rule is approved', async () => {
  const imported = await zonesCli(['import', ...actor], [square('t-b', '0.5', '0.5', 1)]);
  assert.equal(imported.code, 0);
  assert.deepEqual(await ask('0.75', '0.75'), {
    result: 'INDETERMINATE',
    reason: 'OVERLAPPING_ZONES',
  });
  assert.equal((await ask('1.25', '1.25')).zone.code, 't-b');
});

test('concurrency: four simultaneous imports of one code create exactly one zone', async () => {
  const results = await Promise.all(
    Array.from({ length: 4 }, () => zonesCli(['import', ...actor], square('t-c', '10', '10', 1))),
  );
  const outcomes = results.map((r) => r.lines[0].outcome).sort();
  assert.deepEqual(outcomes, ['created', 'unchanged', 'unchanged', 'unchanged']);
  const rows = await sql(db, "SELECT count(*)::int AS n FROM app.service_zone WHERE code = 't-c'");
  assert.equal(rows.rows[0].n, 1);
  const events = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.outbox_message WHERE payload LIKE \'%"t-c"%\'',
  );
  assert.equal(events.rows[0].n, 1);
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
  // Asymmetric bow-tie: edges cross, yet the signed area is non-zero, so it is
  // the simplicity check (not the area check) that must refuse it.
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
  const result = await zonesCli(['import', ...actor], bowTie);
  assert.deepEqual(result.lines[0], {
    target: '#0',
    outcome: 'refused',
    code: 'INVALID_POLYGON:polygon.selfIntersection',
  });
  const rows = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.service_zone WHERE code = 't-bad'",
  );
  assert.equal(rows.rows[0].n, 0);
});

test('retire: retired zones stop counting; retire is safe to retry; audit is append-only', async () => {
  const retired = await zonesCli(['retire', 't-b', '--revision', '1', ...actor]);
  assert.deepEqual(retired.lines[0], {
    target: 't-b',
    outcome: 'retired',
    code: 't-b',
    revision: 2,
  });
  assert.equal(
    (await ask('0.75', '0.75')).zone.code,
    't-a',
    'the overlap is resolved by retirement',
  );
  assert.deepEqual(await ask('1.25', '1.25'), { result: 'OUTSIDE_ZONE' });
  const again = await zonesCli(['retire', 't-b', '--revision', '1', ...actor]);
  assert.equal(again.lines[0].outcome, 'unchanged');
  const audit = await sql(
    db,
    "SELECT a.action, a.actor, a.dataset_ref FROM app.audit_entry a JOIN app.service_zone z ON z.id = a.zone_id WHERE z.code = 't-b' ORDER BY a.at",
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ['zone.created', 'zone.retired'],
  );
  assert.equal(audit.rows[0].actor, 'ops.p01a-test');
  assert.equal(audit.rows[0].dataset_ref, 'test-fixture:synthetic');
  assert.equal(await sqlState(db, "UPDATE app.audit_entry SET actor = 'x'"), '42501');
  assert.equal(await sqlState(db, 'DELETE FROM app.audit_entry'), '42501');
  const listed = (await call('/service-zones')).body.items.map((z) => z.code);
  assert.deepEqual(listed, ['t-a', 't-c']);
});

test('database: ring, bounding box, provenance and status invariants are enforced by PostgreSQL', async () => {
  const insert = `INSERT INTO app.service_zone
      (id, code, name, dataset_ref, ring, min_lat, max_lat, min_lng, max_lng, status, revision, created_at, updated_at, retired_at)
    VALUES (gen_random_uuid(), $1, 'zone', $2, $3::jsonb, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8, 1, now(), now(), $9)`;
  const ring = JSON.stringify([
    ['30', '30'],
    ['31', '30'],
    ['31', '31'],
    ['30', '30'],
  ]);
  let n = 0;
  const attempt = (overrides = {}) => {
    n += 1;
    const v = {
      code: `t-db-${n}`,
      ref: 'test-fixture:synthetic',
      ring,
      minLat: '30',
      maxLat: '31',
      minLng: '30',
      maxLng: '31',
      status: 'ACTIVE',
      retiredAt: null,
      ...overrides,
    };
    return sqlState(db, insert, [
      v.code,
      v.ref,
      v.ring,
      v.minLat,
      v.maxLat,
      v.minLng,
      v.maxLng,
      v.status,
      v.retiredAt,
    ]);
  };
  assert.equal(await attempt(), null);
  assert.equal(await attempt({ minLat: 'NaN' }), '23514');
  assert.equal(await attempt({ maxLng: 'NaN' }), '23514');
  assert.equal(await attempt({ minLat: '-91' }), '23514');
  assert.equal(await attempt({ minLat: '31', maxLat: '30' }), '23514');
  assert.equal(await attempt({ minLng: '-100', maxLng: '100' }), '23514');
  assert.equal(
    await attempt({
      ring: JSON.stringify([
        ['30', '30'],
        ['31', '30'],
        ['31', '31'],
        ['30', '31'],
      ]),
    }),
    '23514',
  );
  assert.equal(await attempt({ ring: '{"type":"Polygon"}' }), '23514');
  assert.equal(await attempt({ ref: 'X' }), '23514');
  assert.equal(await attempt({ code: 'Bad Code' }), '23514');
  assert.equal(await attempt({ status: 'RETIRED' }), '23514');
  assert.equal(await attempt({ status: 'PUBLISHED' }), '23514');
  assert.equal(await attempt({ code: 't-a' }), '23505', 'zone codes are unique');
  await sql(db, "DELETE FROM app.service_zone WHERE code LIKE 't-db-%'");
});

test('events: zone references and revision only, never polygon coordinates', async () => {
  const rows = await sql(
    db,
    "SELECT payload FROM app.outbox_message WHERE event_type = 'geo.zone-updated.v1'",
  );
  assert.ok(rows.rows.length >= 4);
  for (const row of rows.rows) {
    const payload = JSON.parse(row.payload);
    assert.deepEqual(Object.keys(payload.data).sort(), ['change', 'code', 'status', 'zoneId']);
    assert.ok(!row.payload.includes('polygon') && !row.payload.includes('test-fixture'));
  }
});

test('rate limit: the guest-safe route is bounded per client and answers 429', async () => {
  const limited = await startService('geo', db, { GEO_SERVICEABILITY_RATE_PER_MINUTE: '3' });
  try {
    const ask3 = client(limited.base, '/internal/v1/geo');
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push(
        (await ask3('/serviceability', { method: 'POST', body: at('0.5', '0.5') })).status,
      );
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  } finally {
    await limited.app.close();
    process.env.GEO_SERVICEABILITY_RATE_PER_MINUTE = '100000';
  }
});

test('isolation: the geo runtime role cannot reach the Identity database', async () => {
  const state = await sqlState(context.crossServiceUrl.url, 'SELECT 1');
  assert.ok(['42501', '28P01', '3D000'].includes(state), `unexpected ${state}`);
});

test('isolation: the audit trigger function grants no EXECUTE to foreign or runtime roles', async () => {
  // The disposable cluster's bootstrap superuser intentionally bypasses ACLs.
  // Select service identities by their provisioned names, not rolsuper=false:
  // a mistakenly elevated service identity must still fail this assertion.
  const result = await sql(
    db,
    `SELECT r.rolname FROM pg_roles r
       WHERE r.rolname ~ '^cw_[a-z0-9_]+_(app|migrate)$'
         AND r.rolname <> 'cw_geo_migrate'
         AND has_function_privilege(r.oid, 'app.audit_entry_append_only()', 'EXECUTE')`,
  );
  assert.deepEqual(result.rows, []);
  const owner = await sql(
    db,
    "SELECT has_function_privilege('cw_geo_migrate', 'app.audit_entry_append_only()', 'EXECUTE') AS allowed",
  );
  assert.equal(owner.rows[0].allowed, true);
});
