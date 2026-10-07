/**
 * P01-A2 Vehicle provider: real PostgreSQL + real Identity + real HTTP adapter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ORIGIN,
  account,
  client,
  context,
  idempotencyKey,
  sql,
  sqlState,
  startIdentity,
  startService,
} from './_support.mjs';

const db = context.services.vehicle.app;
const identity = await startIdentity();
const vehicle = await startService('vehicle', db, {
  VEHICLE_IDENTITY_ORIGIN: identity.base,
  VEHICLE_IDENTITY_TIMEOUT_MS: '3000',
  VEHICLE_MAX_ACTIVE_VEHICLES: '3',
});
const call = client(vehicle.base, '/internal/v1/vehicle');

test.after(async () => {
  await vehicle.app.close();
  // The outage test closes Identity itself; closing twice is harmless here.
  await identity.app.close().catch(() => {});
});

const bearer = (user) => ({ authorization: `Bearer ${user.token}` });
const sedan = { type: 'sedan', plate: '١٢٣ حلب', displayName: 'كيا ريو', color: 'أبيض' };

function create(user, body = sedan, key = idempotencyKey()) {
  return call('', { method: 'POST', headers: { ...bearer(user), 'idempotency-key': key }, body });
}

test('auth: anonymous and forged requests are refused; a real session is accepted', async () => {
  assert.equal((await call('/mine')).status, 401);
  const forged = await call('/mine', { headers: { authorization: 'Bearer abc.def.ghi' } });
  assert.equal(forged.status, 401);
  const user = await account(identity);
  const list = await call('/mine', { headers: bearer(user) });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, { items: [] });
  assert.equal(list.headers.get('cache-control'), 'no-store');
});

test('auth: revoked sessions and cookie writes without CSRF are refused', async () => {
  const user = await account(identity);
  const cookie = user.jar.header();
  const noCsrf = await call('', {
    method: 'POST',
    headers: { cookie, origin: ORIGIN, 'idempotency-key': idempotencyKey() },
    body: sedan,
  });
  assert.equal(noCsrf.status, 403);
  const withCsrf = await call('', {
    method: 'POST',
    headers: {
      cookie,
      origin: ORIGIN,
      'x-csrf-token': user.jar.cookies.get('__Host-wg_csrf'),
      'idempotency-key': idempotencyKey(),
    },
    body: sedan,
  });
  assert.equal(withCsrf.status, 201);
  assert.equal((await user.logout()).status, 204);
  assert.equal((await call('/mine', { headers: bearer(user) })).status, 401);
});

test('create: plate normalised, owner taken from the session, never from the body', async () => {
  const user = await account(identity);
  const created = await create(user);
  assert.equal(created.status, 201);
  assert.equal(created.body.plate, '123 حلب');
  assert.equal(created.body.type, 'sedan');
  assert.equal(created.headers.get('etag'), '"1"');
  const row = await sql(db, 'SELECT owner_kind, owner_subject FROM app.vehicle WHERE id = $1', [
    created.body.vehicleId,
  ]);
  assert.deepEqual(row.rows[0], { owner_kind: 'account', owner_subject: user.subject });
  const spoof = await create(user, { ...sedan, ownerSubject: randomUUID() });
  assert.equal(spoof.status, 422);
  assert.equal(spoof.body.error.code, 'INVALID_INPUT');
  const noPlate = await create(user, { type: 'large' });
  assert.equal(noPlate.status, 201);
  assert.equal(noPlate.body.plate, null);
});

test('plates are not unique: two owners and one owner may save the same plate', async () => {
  const first = await account(identity);
  const second = await account(identity);
  assert.equal((await create(first)).status, 201);
  assert.equal((await create(second)).status, 201);
  assert.equal((await create(first)).status, 201, 'explicit create, no silent upsert by plate');
  const rows = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.vehicle WHERE owner_subject = ANY($1::uuid[]) AND plate = '123 حلب'",
    [[first.subject, second.subject]],
  );
  assert.equal(rows.rows[0].n, 3);
  const firstList = await call('/mine', { headers: bearer(first) });
  assert.equal(firstList.body.items.length, 2);
});

test('ownership: another owner gets 404 for read, edit and archive, and nothing changes', async () => {
  const owner = await account(identity);
  const intruder = await account(identity);
  const id = (await create(owner)).body.vehicleId;
  assert.equal((await call(`/${id}`, { headers: bearer(intruder) })).status, 404);
  const edit = await call(`/${id}`, {
    method: 'PATCH',
    headers: { ...bearer(intruder), 'if-match': '"1"' },
    body: { plate: '999' },
  });
  assert.equal(edit.status, 404);
  const archive = await call(`/${id}/archive`, {
    method: 'POST',
    headers: { ...bearer(intruder), 'if-match': '"1"' },
  });
  assert.equal(archive.status, 404);
  const mine = await call(`/${id}`, { headers: bearer(owner) });
  assert.equal(mine.body.revision, 1);
  assert.equal(mine.body.plate, '123 حلب');
  assert.equal((await call('/not-a-uuid', { headers: bearer(owner) })).status, 404);
});

test('edit of a missing vehicle never falls back to creating one', async () => {
  const user = await account(identity);
  const missing = await call(`/${randomUUID()}`, {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': '"1"' },
    body: { color: 'أحمر' },
  });
  assert.equal(missing.status, 404);
  const rows = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.vehicle WHERE owner_subject = $1',
    [user.subject],
  );
  assert.equal(rows.rows[0].n, 0);
});

test('idempotency: concurrent creates with one key make one vehicle and one event', async () => {
  const user = await account(identity);
  const key = idempotencyKey();
  const results = await Promise.all(Array.from({ length: 8 }, () => create(user, sedan, key)));
  assert.ok(
    results.every((r) => r.status === 201),
    results.map((r) => r.status).join(','),
  );
  assert.equal(new Set(results.map((r) => r.body.vehicleId)).size, 1);
  assert.equal(results.filter((r) => r.headers.get('idempotent-replayed')).length, 7);
  const events = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.outbox_message WHERE payload LIKE $1',
    [`%${results[0].body.vehicleId}%`],
  );
  assert.equal(events.rows[0].n, 1);
  const reused = await create(user, { ...sedan, color: 'أسود' }, key);
  assert.equal(reused.status, 422);
  assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  const missingKey = await call('', { method: 'POST', headers: bearer(user), body: sedan });
  assert.equal(missingKey.status, 428);
});

test('revisions: one winner among concurrent edits; stale and missing If-Match refused', async () => {
  const user = await account(identity);
  const id = (await create(user)).body.vehicleId;
  const edits = await Promise.all(
    ['أحمر', 'أزرق', 'أخضر'].map((color) =>
      call(`/${id}`, {
        method: 'PATCH',
        headers: { ...bearer(user), 'if-match': '"1"' },
        body: { color },
      }),
    ),
  );
  const statuses = edits.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 412, 412]);
  assert.equal((await call(`/${id}`, { headers: bearer(user) })).body.revision, 2);
  const missing = await call(`/${id}`, {
    method: 'PATCH',
    headers: bearer(user),
    body: { color: 'x' },
  });
  assert.equal(missing.status, 428);
});

test('archive: safe to retry, archived is read-only and hidden from the default list', async () => {
  const user = await account(identity);
  const id = (await create(user)).body.vehicleId;
  const archived = await call(`/${id}/archive`, {
    method: 'POST',
    headers: { ...bearer(user), 'if-match': '"1"' },
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.status, 'ARCHIVED');
  assert.ok(archived.body.archivedAt);
  const again = await call(`/${id}/archive`, {
    method: 'POST',
    headers: { ...bearer(user), 'if-match': '"1"' },
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.revision, 2);
  const edit = await call(`/${id}`, {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': '"2"' },
    body: { color: 'x' },
  });
  assert.equal(edit.status, 409);
  assert.equal((await call('/mine', { headers: bearer(user) })).body.items.length, 0);
  assert.equal(
    (await call('/mine?includeArchived=true', { headers: bearer(user) })).body.items.length,
    1,
  );
  const audit = await sql(
    db,
    'SELECT action FROM app.audit_entry WHERE vehicle_id = $1 ORDER BY at',
    [id],
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ['vehicle.created', 'vehicle.archived'],
  );
});

test('limits: the active-vehicle ceiling holds under concurrency and rolls back cleanly', async () => {
  const user = await account(identity);
  const results = await Promise.all(Array.from({ length: 6 }, () => create(user)));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 201).length, 3, statuses.join(','));
  assert.equal(statuses.filter((s) => s === 409).length, 3);
  const keys = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.idempotency_record WHERE scope = $1',
    [`account:${user.subject}`],
  );
  assert.equal(keys.rows[0].n, 3);
});

test('database: plate, type, status and archive invariants are enforced by PostgreSQL', async () => {
  const insert = `INSERT INTO app.vehicle
      (id, owner_kind, owner_subject, vehicle_type, plate, status, revision, created_at, updated_at, archived_at)
    VALUES ($1, $2, $3, $4, $5, $6, 1, now(), now(), $7)`;
  const subject = randomUUID();
  const attempt = (kind, type, plate, status = 'ACTIVE', archivedAt = null) =>
    sqlState(db, insert, [randomUUID(), kind, subject, type, plate, status, archivedAt]);
  assert.equal(await attempt('account', 'sedan', '123 حلب'), null);
  assert.equal(await attempt('account', 'sedan', null), null);
  assert.equal(await attempt('account', 'truck', null), '23514');
  assert.equal(await attempt('robot', 'sedan', null), '23514');
  assert.equal(await attempt('account', 'sedan', 'حلب'), '23514', 'a plate needs a digit');
  assert.equal(await attempt('account', 'sedan', ' 123'), '23514', 'a plate is stored trimmed');
  assert.equal(await attempt('account', 'sedan', '12  34'), '23514', 'inner spaces are collapsed');
  assert.equal(await attempt('account', 'sedan', '12#34'), '23514');
  assert.equal(await attempt('account', 'sedan', null, 'ARCHIVED', null), '23514');
  assert.equal(await attempt('account', 'sedan', null, 'ACTIVE', new Date()), '23514');
  assert.equal(await sqlState(db, "UPDATE app.audit_entry SET action = 'x'"), '42501');
});

test('events: references and revisions only, never plate, name, colour or owner', async () => {
  const user = await account(identity);
  const id = (await create(user)).body.vehicleId;
  const rows = await sql(db, 'SELECT payload FROM app.outbox_message WHERE payload LIKE $1', [
    `%${id}%`,
  ]);
  assert.equal(rows.rows.length, 1);
  const payload = JSON.parse(rows.rows[0].payload);
  assert.deepEqual(payload.data, { vehicleId: id, change: 'created', status: 'ACTIVE' });
  for (const secret of ['123', 'حلب', 'كيا', 'أبيض', user.subject]) {
    assert.ok(!rows.rows[0].payload.includes(secret), `event must not carry ${secret}`);
  }
});

test('guest/account: a guest vehicle with the same subject value is invisible to the account', async () => {
  const user = await account(identity);
  await sql(
    db,
    `INSERT INTO app.vehicle (id, owner_kind, owner_subject, vehicle_type, plate, status, revision, created_at, updated_at)
     VALUES ($1, 'guest', $2, 'sedan', '123 حلب', 'ACTIVE', 1, now(), now())`,
    [randomUUID(), user.subject],
  );
  assert.equal((await call('/mine', { headers: bearer(user) })).body.items.length, 0);
});

test('isolation: the vehicle runtime role cannot reach the Identity database', async () => {
  const state = await sqlState(context.crossServiceUrl.url, 'SELECT 1');
  assert.ok(['42501', '28P01', '3D000'].includes(state), `unexpected ${state}`);
});

test('identity outage: fail closed with 503 and write nothing', async () => {
  const user = await account(identity);
  await identity.app.close();
  assert.equal((await call('/mine', { headers: bearer(user) })).status, 503);
  assert.equal((await create(user)).status, 503);
  const rows = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.vehicle WHERE owner_subject = $1',
    [user.subject],
  );
  assert.equal(rows.rows[0].n, 0);
});
