/**
 * P02-A2 Vehicle provider of vehicle.v1: real PostgreSQL + real Identity (account
 * and guest sessions) + the real HTTP adapter. Every success body and every
 * error is checked with the BUILT published parsers of @carwash/contracts and
 * every outbox row with the published @carwash/event-contracts parser.
 *
 * The infrastructure-free provider verification suite is imported so that the
 * acceptance harness (and its CI workflow) always runs it with this suite.
 */
import './vehicle.contract.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ORIGIN,
  account,
  client,
  context,
  contracts,
  eventContracts as events,
  guest as guestSession,
  idempotencyKey,
  sql,
  sqlState,
  serviceRequire,
  startIdentity,
  startService,
} from './_support.mjs';

const { vehicleV1, parseApiErrorEnvelope, parsePage } = contracts;

const db = context.services.vehicle.app;
const identity = await startIdentity();
const vehicle = await startService('vehicle', db, {
  VEHICLE_IDENTITY_ORIGIN: identity.base,
  VEHICLE_IDENTITY_TIMEOUT_MS: '3000',
});
const raw = client(vehicle.base, '/internal/v1/vehicle');

/**
 * Every response is verified against the published contract before a test
 * looks at it: 2xx bodies with the route's parser, errors with the envelope
 * parser (which also checks `retryable` against the code).
 */
async function call(route, options = {}, parse = null) {
  const response = await raw(route, options);
  if (response.status >= 400) {
    parseApiErrorEnvelope(response.body);
    assert.equal(response.status, contracts.API_ERROR_STATUS[response.body.error.code]);
    if (response.body.error.reason !== null) {
      assert.ok(vehicleV1.VEHICLE_V1.reasons.includes(response.body.error.reason));
    }
  } else if (parse) {
    parse(response.body);
  }
  return response;
}

test.after(async () => {
  await vehicle.app.close();
  // The outage test closes Identity itself; closing twice is harmless here.
  await identity.app.close().catch(() => {});
});

const bearer = (user) => ({ authorization: `Bearer ${user.token}` });
const sedan = {
  type: 'sedan',
  make: 'كيا',
  model: 'ريو',
  color: 'أبيض',
  nickname: 'سيارة العائلة',
  plate: { text: '١٢٣ حلب', region: null },
};
const page = (value) => parsePage(value, '$', vehicleV1.parseVehicleV1);
const one = (value) => vehicleV1.parseVehicleV1(value);

function list(user, query = '') {
  return call(`/mine${query}`, { headers: bearer(user) }, page);
}

function create(user, body = sedan, key = idempotencyKey()) {
  return call(
    '/mine',
    { method: 'POST', headers: { ...bearer(user), 'idempotency-key': key }, body },
    one,
  );
}

function patch(user, id, revision, body, key = idempotencyKey()) {
  return call(
    `/mine/${id}`,
    {
      method: 'PATCH',
      headers: { ...bearer(user), 'if-match': `"${revision}"`, 'idempotency-key': key },
      body,
    },
    one,
  );
}

function archive(user, id, revision, key = idempotencyKey()) {
  return call(
    `/mine/${id}/archive`,
    {
      method: 'POST',
      headers: { ...bearer(user), 'if-match': `"${revision}"`, 'idempotency-key': key },
    },
    one,
  );
}

/** A real Identity guest session (P01-E3): no account, cookies only. */
const guest = () => guestSession(identity);

test('auth: anonymous and forged requests are refused; a real session gets a contract page', async () => {
  const anonymous = await call('/mine');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error.code, 'AUTH_REQUIRED');
  const forged = await call('/mine', { headers: { authorization: 'Bearer abc.def.ghi' } });
  assert.equal(forged.status, 401);
  const user = await account(identity);
  const empty = await list(user);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.items, []);
  assert.equal(empty.body.nextCursor, null);
  assert.equal(empty.headers.get('cache-control'), 'no-store');
});

test('guest: a real Identity guest session saves and lists its own vehicles', async () => {
  const visitor = await guest();
  const created = await create(visitor, { ...sedan, plate: null });
  assert.equal(created.status, 201);
  const row = await sql(db, 'SELECT owner_kind, owner_subject FROM app.vehicle WHERE id = $1', [
    created.body.vehicleId,
  ]);
  assert.deepEqual(row.rows[0], { owner_kind: 'guest', owner_subject: visitor.subject });
  assert.equal((await list(visitor)).body.items.length, 1);
  const event = await sql(db, 'SELECT payload FROM app.outbox_message WHERE payload LIKE $1', [
    `%${created.body.vehicleId}%`,
  ]);
  const parsed = events.VEHICLE_UPDATED_V1.parse(JSON.parse(event.rows[0].payload));
  assert.deepEqual(parsed.actor, { kind: 'guest', id: visitor.subject });
});

test('auth: revoked sessions and cookie writes without CSRF are refused', async () => {
  const user = await account(identity);
  const cookie = user.jar.header();
  const noCsrf = await call('/mine', {
    method: 'POST',
    headers: { cookie, origin: ORIGIN, 'idempotency-key': idempotencyKey() },
    body: sedan,
  });
  assert.equal(noCsrf.status, 403);
  const withCsrf = await call(
    '/mine',
    {
      method: 'POST',
      headers: {
        cookie,
        origin: ORIGIN,
        'x-csrf-token': user.jar.cookies.get('__Host-wg_csrf'),
        'idempotency-key': idempotencyKey(),
      },
      body: sedan,
    },
    one,
  );
  assert.equal(withCsrf.status, 201);
  assert.equal((await user.logout()).status, 204);
  assert.equal((await call('/mine', { headers: bearer(user) })).status, 401);
});

test('create: vehicle.v1 shape, plate normalised, owner taken from the session only', async () => {
  const user = await account(identity);
  const created = await create(user, { ...sedan, plate: { text: ' ab   12 ', region: 'حلب' } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.plate, { text: 'AB 12', region: 'حلب' });
  assert.equal(created.body.nickname, 'سيارة العائلة');
  assert.equal(created.body.archived, false);
  assert.equal(created.headers.get('etag'), '"1"');
  const row = await sql(db, 'SELECT owner_kind, owner_subject FROM app.vehicle WHERE id = $1', [
    created.body.vehicleId,
  ]);
  assert.deepEqual(row.rows[0], { owner_kind: 'account', owner_subject: user.subject });
  const spoof = await create(user, { ...sedan, ownerSubject: randomUUID() });
  assert.equal(spoof.status, 422);
  assert.equal(spoof.body.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(spoof.body.error.issues, [
    { field: '$.ownerSubject', code: 'UNEXPECTED_FIELD' },
  ]);
  const partial = await create(user, { type: 'large' });
  assert.equal(partial.status, 422, 'VehicleInputV1 is closed: every key is required');
  const noPlate = await create(user, { ...sedan, type: 'large', plate: null });
  assert.equal(noPlate.status, 201);
  assert.equal(noPlate.body.plate, null);
  const tooLong = await create(user, { ...sedan, plate: { text: '1'.repeat(13), region: null } });
  assert.deepEqual(tooLong.body.error.issues, [{ field: '$.plate.text', code: 'INVALID_LENGTH' }]);
  const malformed = await call('/mine', {
    method: 'POST',
    headers: { ...bearer(user), 'idempotency-key': idempotencyKey() },
    body: '{bad json',
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'REQUEST_INVALID');
});

test('plates are not unique: two owners and one owner may save the same plate', async () => {
  const first = await account(identity);
  const second = await account(identity);
  assert.equal((await create(first)).status, 201);
  assert.equal((await create(second)).status, 201);
  assert.equal((await create(first)).status, 201, 'explicit create, no silent upsert by plate');
  const rows = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.vehicle WHERE owner_subject = ANY($1::uuid[]) AND plate = '١٢٣ حلب'",
    [[first.subject, second.subject]],
  );
  assert.equal(rows.rows[0].n, 3);
  assert.equal((await list(first)).body.items.length, 2);
});

test('ownership: another owner gets 404 for edit and archive, and nothing changes', async () => {
  const owner = await account(identity);
  const intruder = await account(identity);
  const id = (await create(owner)).body.vehicleId;
  const edit = await patch(intruder, id, 1, { ...sedan, color: 'أحمر' });
  assert.equal(edit.status, 404);
  assert.equal(edit.body.error.reason, 'VEHICLE_NOT_FOUND');
  assert.equal((await archive(intruder, id, 1)).status, 404);
  const [mine] = (await list(owner)).body.items;
  assert.equal(mine.revision, 1);
  assert.equal(mine.color, 'أبيض');
  assert.equal((await patch(owner, 'not-a-uuid', 1, sedan)).status, 404);
  const visitor = await guest();
  assert.equal((await patch(visitor, id, 1, sedan)).status, 404, 'a guest cannot reach it');
});

test('edit of a missing vehicle never falls back to creating one', async () => {
  const user = await account(identity);
  const missing = await patch(user, randomUUID(), 1, sedan);
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
  const outbox = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.outbox_message WHERE payload LIKE $1',
    [`%${results[0].body.vehicleId}%`],
  );
  assert.equal(outbox.rows[0].n, 1);
  const reused = await create(user, { ...sedan, color: 'أسود' }, key);
  assert.equal(reused.status, 409);
  assert.equal(reused.body.error.code, 'IDEMPOTENCY_CONFLICT');
  const missingKey = await call('/mine', { method: 'POST', headers: bearer(user), body: sedan });
  assert.equal(missingKey.status, 428);
  assert.equal(missingKey.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  const badKey = await create(user, sedan, 'short');
  assert.equal(badKey.status, 400);
  assert.deepEqual(badKey.body.error.issues, [
    { field: 'header.idempotency-key', code: 'INVALID_VALUE' },
  ]);
  const record = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.idempotency_record WHERE scope = $1 AND key = $2',
    [`vehicle.v1:account:${user.subject}`, key],
  );
  assert.equal(record.rows[0].n, 1, 'the scope is contract major + actor');
});

test('idempotency: expiry permits one new write under concurrent retries and replaces old payload', async () => {
  const user = await account(identity);
  const key = idempotencyKey();
  const scope = `vehicle.v1:account:${user.subject}`;
  const first = await create(user, sedan, key);
  assert.equal(first.status, 201);
  await sql(
    db,
    `UPDATE app.idempotency_record
    SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
    WHERE scope = $1 AND key = $2`,
    [scope, key],
  );
  const replacement = { ...sedan, type: 'pickup', plate: { text: '998', region: null } };
  const results = await Promise.all(
    Array.from({ length: 8 }, () => create(user, replacement, key)),
  );
  assert.ok(results.every((result) => result.status === 201));
  assert.equal(new Set(results.map((result) => result.body.vehicleId)).size, 1);
  assert.notEqual(results[0].body.vehicleId, first.body.vehicleId);
  assert.equal(results.filter((result) => result.headers.get('idempotent-replayed')).length, 7);
  const record = await sql(
    db,
    'SELECT response_body FROM app.idempotency_record WHERE scope = $1 AND key = $2',
    [scope, key],
  );
  assert.deepEqual(record.rows[0].response_body, results[0].body);
  const rows = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.vehicle WHERE owner_subject = $1',
    [user.subject],
  );
  assert.equal(rows.rows[0].n, 2);
});

test('idempotency: exact TTL boundary is expired and inactive expired payloads are purged', async () => {
  const own = serviceRequire('vehicle');
  const { PrismaService } = own('./dist/prisma.service.js');
  const { PrismaVehicleStore } = own('./dist/infrastructure/persistence/prisma-vehicle.store.js');
  const prisma = vehicle.app.get(PrismaService);
  const store = new PrismaVehicleStore(prisma.client);
  const now = new Date(Date.now() + 60_000);
  const expiresAt = new Date(now.getTime() + 86_400_000);
  const scope = `vehicle.v1:account:${randomUUID()}`;
  const key = idempotencyKey();
  const request = {
    scope,
    key,
    operation: 'vehicle.create',
    fingerprint: 'a'.repeat(64),
    now,
    expiresAt,
  };
  const exists = async () =>
    (
      await sql(db, 'SELECT 1 FROM app.idempotency_record WHERE scope = $1 AND key = $2', [
        scope,
        key,
      ])
    ).rows.length;
  await store.transaction(async (tx) => {
    assert.equal((await tx.claimIdempotency(request)).kind, 'claimed');
    await tx.completeIdempotency(scope, key, 201, { plate: '123' });
  });
  await store.transaction(async (tx) => {
    assert.equal(
      (await tx.claimIdempotency({ ...request, now: new Date(expiresAt.getTime() - 1) })).kind,
      'replay',
    );
  });
  await store.transaction(async (tx) => {
    const claim = await tx.claimIdempotency({
      ...request,
      now: expiresAt,
      expiresAt: new Date(expiresAt.getTime() + 86_400_000),
    });
    assert.equal(claim.kind, 'claimed');
    await tx.completeIdempotency(scope, key, 201, { plate: '456' });
  });
  await sql(
    db,
    `UPDATE app.idempotency_record
    SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
    WHERE scope = $1 AND key = $2`,
    [scope, key],
  );
  await store.transaction(async (tx) => {
    // The request's captured time predates expiry, while the maintenance clock
    // has advanced. Its replay must remain protected until the response commits.
    assert.equal(
      (await tx.claimIdempotency({ ...request, now: new Date(Date.now() - 7_200_000) })).kind,
      'replay',
    );
    await prisma.purgeExpiredIdempotency();
    assert.equal(await exists(), 1);
  });
  await prisma.purgeExpiredIdempotency();
  assert.equal(await exists(), 0);
});

test('revisions: one winner among concurrent edits; stale, missing and malformed If-Match refused', async () => {
  const user = await account(identity);
  const id = (await create(user)).body.vehicleId;
  const edits = await Promise.all(
    ['أحمر', 'أزرق', 'أخضر'].map((color) => patch(user, id, 1, { ...sedan, color })),
  );
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 412, 412]);
  const winner = edits.find((r) => r.status === 200);
  assert.equal(winner.headers.get('etag'), '"2"');
  assert.equal((await list(user)).body.items[0].revision, 2);
  const stale = edits.find((r) => r.status === 412);
  assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
  const missing = await call(`/mine/${id}`, {
    method: 'PATCH',
    headers: { ...bearer(user), 'idempotency-key': idempotencyKey() },
    body: sedan,
  });
  assert.equal(missing.status, 428);
  assert.equal(missing.body.error.code, 'REVISION_REQUIRED');
  const malformed = await call(`/mine/${id}`, {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': 'W/"2"', 'idempotency-key': idempotencyKey() },
    body: sedan,
  });
  assert.equal(malformed.status, 400);
  const unchanged = await patch(user, id, 2, { ...sedan, color: winner.body.color });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.revision, 2, 'an identical replacement is not a new revision');
});

test('archive: idempotent, archived is read-only and hidden from the list', async () => {
  const user = await account(identity);
  const id = (await create(user)).body.vehicleId;
  const key = idempotencyKey();
  const archived = await archive(user, id, 1, key);
  assert.equal(archived.status, 200);
  assert.equal(archived.body.archived, true);
  assert.equal(archived.body.revision, 2);
  const replay = await archive(user, id, 1, key);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  const again = await archive(user, id, 1);
  assert.equal(again.status, 200);
  assert.equal(again.body.revision, 2, 'archiving an archived vehicle changes nothing');
  const noKey = await call(`/mine/${id}/archive`, {
    method: 'POST',
    headers: { ...bearer(user), 'if-match': '"2"' },
  });
  assert.equal(noKey.status, 428);
  const edit = await patch(user, id, 2, sedan);
  assert.equal(edit.status, 409);
  assert.equal(edit.body.error.code, 'CONFLICT');
  assert.equal(edit.body.error.reason, 'VEHICLE_ARCHIVED');
  assert.equal((await list(user)).body.items.length, 0);
  const audit = await sql(
    db,
    'SELECT action, actor_kind FROM app.audit_entry WHERE vehicle_id = $1 ORDER BY at',
    [id],
  );
  assert.deepEqual(audit.rows, [
    { action: 'vehicle.created', actor_kind: 'principal' },
    { action: 'vehicle.archived', actor_kind: 'principal' },
  ]);
});

test('limits: MAX_SAVED_VEHICLES active vehicles hold under concurrency and roll back cleanly', async () => {
  const user = await account(identity);
  const results = await Promise.all(
    Array.from({ length: vehicleV1.MAX_SAVED_VEHICLES + 3 }, () => create(user)),
  );
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 201).length, vehicleV1.MAX_SAVED_VEHICLES);
  const refused = results.filter((r) => r.status === 422);
  assert.equal(refused.length, 3, statuses.join(','));
  assert.ok(refused.every((r) => r.body.error.reason === 'VEHICLE_LIMIT_REACHED'));
  const keys = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.idempotency_record WHERE scope = $1',
    [`vehicle.v1:account:${user.subject}`],
  );
  assert.equal(keys.rows[0].n, vehicleV1.MAX_SAVED_VEHICLES, 'refused writes leave no key');
  const [first] = (await list(user)).body.items;
  assert.equal((await archive(user, first.vehicleId, 1)).status, 200);
  assert.equal((await create(user)).status, 201, 'an archived vehicle frees a slot');
});

test('pages: keyset paging covers every active vehicle once; bad queries are refused', async () => {
  const user = await account(identity);
  for (let i = 0; i < 7; i += 1) await create(user);
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const response = await list(user, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(response.status, 200);
    seen.push(...response.body.items.map((item) => item.vehicleId));
    cursor = response.body.nextCursor;
    pages += 1;
  } while (cursor !== null);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 7);
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?limit=abc',
    '?cursor=***',
    '?includeArchived=true',
  ]) {
    const refused = await call(`/mine${query}`, { headers: bearer(user) });
    assert.equal(refused.status, 400, query);
    assert.equal(refused.body.error.code, 'REQUEST_INVALID', query);
  }
  const intruder = await account(identity);
  const firstPage = await list(user, '?limit=3');
  const foreign = await list(intruder, `?cursor=${firstPage.body.nextCursor}`);
  assert.deepEqual(foreign.body.items, [], "a cursor never reveals another owner's vehicles");
});

test('snapshot resolve stays closed: no workload identity exists, user sessions are refused', async () => {
  const user = await account(identity);
  const id = (await create(user)).body.vehicleId;
  const body = {
    owner: { kind: 'account', subjectId: user.subject },
    vehicleId: id,
    expectedRevision: null,
    purpose: 'booking-create',
  };
  const anonymous = await call('/vehicle-snapshots/resolve', { method: 'POST', body });
  assert.equal(anonymous.status, 401);
  const asUser = await call('/vehicle-snapshots/resolve', {
    method: 'POST',
    headers: bearer(user),
    body,
  });
  assert.equal(asUser.status, 403);
  const reads = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.audit_entry WHERE vehicle_id = $1 AND actor_kind = 'service'",
    [id],
  );
  assert.equal(reads.rows[0].n, 0);
});

test('database: vehicle.v1 plate, region, audit-actor and archive invariants are enforced', async () => {
  const insert = `INSERT INTO app.vehicle
      (id, owner_kind, owner_subject, vehicle_type, plate, plate_region, status, revision, created_at, updated_at, archived_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 1, now(), now(), $8)`;
  const subject = randomUUID();
  const attempt = (kind, type, plate, region = null, status = 'ACTIVE', archivedAt = null) =>
    sqlState(db, insert, [randomUUID(), kind, subject, type, plate, region, status, archivedAt]);
  assert.equal(await attempt('account', 'sedan', '١٢٣ حلب'), null);
  assert.equal(await attempt('account', 'sedan', 'حلب'), null, 'vehicle.v1 plates need no digit');
  assert.equal(await attempt('account', 'sedan', '7', 'حلب'), null);
  assert.equal(await attempt('account', 'sedan', null), null);
  assert.equal(await attempt('account', 'sedan', null, 'حلب'), '23514', 'region without plate');
  assert.equal(await attempt('account', 'sedan', 'ab 12'), '23514', 'plates are stored uppercase');
  assert.equal(await attempt('account', 'sedan', '1'.repeat(13)), '23514');
  assert.equal(await attempt('account', 'sedan', ' 123'), '23514');
  assert.equal(await attempt('account', 'sedan', '12  34'), '23514');
  assert.equal(await attempt('account', 'sedan', '12#34'), '23514');
  assert.equal(await attempt('account', 'truck', null), '23514');
  assert.equal(await attempt('robot', 'sedan', null), '23514');
  assert.equal(await attempt('account', 'sedan', null, null, 'ARCHIVED', null), '23514');
  assert.equal(await attempt('account', 'sedan', null, null, 'ACTIVE', new Date()), '23514');
  const audit = `INSERT INTO app.audit_entry
      (id, actor_kind, actor_subject, actor_session_id, actor_service, purpose, action, vehicle_id, correlation_id, at)
    VALUES ($1, $2, $3, $4, $5, $6, 'vehicle.test', $7, $8, now())`;
  const auditAttempt = (kind, actorSubject, session, service, purpose) =>
    sqlState(db, audit, [
      randomUUID(),
      kind,
      actorSubject,
      session,
      service,
      purpose,
      randomUUID(),
      randomUUID(),
    ]);
  assert.equal(await auditAttempt('service', null, null, 'booking', 'booking-quote'), null);
  assert.equal(await auditAttempt('service', null, null, 'booking', null), '23514');
  assert.equal(await auditAttempt('service', null, null, 'booking', 'marketing'), '23514');
  assert.equal(await auditAttempt('principal', null, null, null, null), '23514');
  assert.equal(
    await auditAttempt('principal', randomUUID(), randomUUID(), 'booking', null),
    '23514',
  );
  assert.equal(await sqlState(db, "UPDATE app.audit_entry SET action = 'x'"), '42501');
  assert.equal(await sqlState(db, 'DELETE FROM app.audit_entry'), '42501');
  const pending = await sql(
    db,
    `SELECT conname, convalidated FROM pg_constraint
      WHERE conname IN ('vehicle_plate_v1_check', 'vehicle_nickname_v1_check') ORDER BY conname`,
  );
  assert.deepEqual(pending.rows, [
    { conname: 'vehicle_nickname_v1_check', convalidated: false },
    { conname: 'vehicle_plate_v1_check', convalidated: false },
  ]);
  const acl = await sql(
    db,
    `SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'app' AND p.proname = 'audit_entry_append_only'
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) AS public_execute`,
  );
  assert.equal(acl.rows[0].public_execute, false);
});

test('events: envelope v2 per change, verified by the published parser, never PII', async () => {
  const user = await account(identity);
  const id = (await create(user)).body.vehicleId;
  assert.equal((await patch(user, id, 1, { ...sedan, color: 'أسود' })).status, 200);
  assert.equal((await archive(user, id, 2)).status, 200);
  const rows = await sql(
    db,
    'SELECT exchange, routing_key, payload FROM app.outbox_message WHERE payload LIKE $1 ORDER BY created_at',
    [`%${id}%`],
  );
  const parsed = rows.rows.map((row) => events.VEHICLE_UPDATED_V1.parse(JSON.parse(row.payload)));
  assert.deepEqual(
    parsed.map((event) => [event.data.change, event.aggregate.version]),
    [
      ['CREATED', 1],
      ['UPDATED', 2],
      ['ARCHIVED', 3],
    ],
  );
  assert.ok(
    parsed.every((event) => event.actor.kind === 'account' && event.actor.id === user.subject),
  );
  assert.ok(rows.rows.every((row) => row.exchange === 'vehicle.events'));
  for (const secret of ['١٢٣', 'حلب', 'كيا', 'ريو', 'أبيض', 'أسود', 'العائلة']) {
    assert.ok(
      rows.rows.every((row) => !row.payload.includes(secret)),
      `event must not carry ${secret}`,
    );
  }
});

test('guest/account: a guest vehicle with the same subject value is invisible to the account', async () => {
  const user = await account(identity);
  await sql(
    db,
    `INSERT INTO app.vehicle (id, owner_kind, owner_subject, vehicle_type, plate, status, revision, created_at, updated_at)
     VALUES ($1, 'guest', $2, 'sedan', '123', 'ACTIVE', 1, now(), now())`,
    [randomUUID(), user.subject],
  );
  assert.equal((await list(user)).body.items.length, 0);
});

test('isolation: the vehicle runtime role cannot reach the Identity database', async () => {
  const state = await sqlState(context.crossServiceUrl.url, 'SELECT 1');
  assert.ok(['42501', '28P01', '3D000'].includes(state), `unexpected ${state}`);
});

test('identity outage: fail closed with retryable 503 and write nothing', async () => {
  const user = await account(identity);
  await identity.app.close();
  const read = await call('/mine', { headers: bearer(user) });
  assert.equal(read.status, 503);
  assert.equal(read.body.error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(read.body.error.retryable, true);
  assert.equal((await create(user)).status, 503);
  const rows = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.vehicle WHERE owner_subject = $1',
    [user.subject],
  );
  assert.equal(rows.rows[0].n, 0);
});