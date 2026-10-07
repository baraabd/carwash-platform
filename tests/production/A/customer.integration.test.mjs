/**
 * P01-A1 Customer provider: real PostgreSQL + real Identity + real HTTP adapter.
 *
 * Every assertion here crosses a real process boundary: Identity verifies the
 * session, the Customer adapter talks to its own database with its RUNTIME
 * identity, and constraints are proven by PostgreSQL itself.
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

const db = context.services.customer.app;
const identity = await startIdentity();
const customer = await startService('customer', db, {
  CUSTOMER_IDENTITY_ORIGIN: identity.base,
  CUSTOMER_IDENTITY_TIMEOUT_MS: '3000',
  CUSTOMER_MAX_ACTIVE_ADDRESSES: '3',
});
const call = client(customer.base, '/internal/v1/customer');

test.after(async () => {
  await customer.app.close();
  // The outage test closes Identity itself; closing twice is harmless here.
  await identity.app.close().catch(() => {});
});

const bearer = (user) => ({ authorization: `Bearer ${user.token}` });
const pinned = (latitude, longitude, source = 'pin') => ({
  kind: 'coordinates',
  source,
  coordinates: { crs: 'EPSG:4326', latitude, longitude },
});
const home = { label: 'البيت', line: 'حي تجريبي، شارع 1', location: { kind: 'manual' } };

async function bootstrapped() {
  const user = await account(identity);
  const created = await call('/me', { method: 'POST', headers: bearer(user) });
  assert.equal(created.status, 201);
  return { user, profile: created.body };
}

async function createAddress(user, body = home, key = idempotencyKey()) {
  return call('/me/addresses', {
    method: 'POST',
    headers: { ...bearer(user), 'idempotency-key': key },
    body,
  });
}

test('auth: no credential is 401, a forged token is 401, a real session is accepted', async () => {
  assert.equal((await call('/me')).status, 401);
  const forged = await call('/me', {
    headers: { authorization: 'Bearer eyJhbGciOiJub25lIn0.e30.' },
  });
  assert.equal(forged.status, 401);
  assert.equal(forged.body.error.code, 'AUTH_REQUIRED');
  const { user, profile } = await bootstrapped();
  const read = await call('/me', { headers: bearer(user) });
  assert.equal(read.status, 200);
  assert.equal(read.body.customerId, profile.customerId);
  assert.notEqual(read.body.customerId, user.subject, 'customer id is not the Identity subject');
  assert.equal(read.headers.get('etag'), '"1"');
  assert.equal(read.headers.get('cache-control'), 'no-store');
});

test('auth: a revoked session is refused although its token signature is still valid', async () => {
  const { user } = await bootstrapped();
  const logout = await user.logout();
  assert.equal(logout.status, 204);
  const after = await call('/me', { headers: bearer(user) });
  assert.equal(after.status, 401);
});

test('auth: cookie writes need Identity CSRF and origin; cookie reads do not', async () => {
  const { user } = await bootstrapped();
  const cookie = user.jar.header();
  assert.equal((await call('/me', { headers: { cookie } })).status, 200);
  const withoutCsrf = await call('/me', {
    method: 'PATCH',
    headers: { cookie, 'if-match': '"1"', origin: ORIGIN },
    body: { preferredLocale: 'en' },
  });
  assert.equal(withoutCsrf.status, 403);
  const foreignOrigin = await call('/me', {
    method: 'PATCH',
    headers: {
      cookie,
      'if-match': '"1"',
      origin: 'https://attacker.invalid',
      'x-csrf-token': user.jar.cookies.get('__Host-wg_csrf'),
    },
    body: { preferredLocale: 'en' },
  });
  assert.equal(foreignOrigin.status, 403);
  const accepted = await call('/me', {
    method: 'PATCH',
    headers: {
      cookie,
      'if-match': '"1"',
      origin: ORIGIN,
      'x-csrf-token': user.jar.cookies.get('__Host-wg_csrf'),
    },
    body: { preferredLocale: 'en' },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.preferredLocale, 'en');
});

test('duplicates: ten concurrent bootstraps for one principal create exactly one profile', async () => {
  const user = await account(identity);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => call('/me', { method: 'POST', headers: bearer(user) })),
  );
  const statuses = results.map((result) => result.status).sort();
  assert.equal(statuses.filter((status) => status === 201).length, 1, statuses.join(','));
  assert.equal(statuses.filter((status) => status === 200).length, 9);
  assert.equal(new Set(results.map((result) => result.body.customerId)).size, 1);
  const rows = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.customer_profile WHERE principal_kind = 'account' AND principal_subject = $1",
    [user.subject],
  );
  assert.equal(rows.rows[0].n, 1);
});

test('duplicates: the database refuses a second profile for the same principal', async () => {
  const subject = randomUUID();
  const insert = `INSERT INTO app.customer_profile
      (id, principal_kind, principal_subject, preferred_locale, revision, created_at, updated_at)
    VALUES ($1, 'account', $2, 'ar', 1, now(), now())`;
  assert.equal(await sqlState(db, insert, [randomUUID(), subject]), null);
  assert.equal(await sqlState(db, insert, [randomUUID(), subject]), '23505');
});

test('idempotency: concurrent creates with one key make one address and replay one answer', async () => {
  const { user } = await bootstrapped();
  const key = idempotencyKey();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => createAddress(user, home, key)),
  );
  assert.ok(
    results.every((result) => result.status === 201),
    results.map((r) => r.status).join(','),
  );
  assert.equal(new Set(results.map((result) => result.body.addressId)).size, 1);
  assert.equal(results.filter((result) => result.headers.get('idempotent-replayed')).length, 7);
  const list = await call('/me/addresses', { headers: bearer(user) });
  assert.equal(list.body.items.length, 1);
  const outbox = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.outbox_message WHERE event_type = 'customer.address-updated.v1' AND payload LIKE $1",
    [`%${results[0].body.addressId}%`],
  );
  assert.equal(outbox.rows[0].n, 1, 'a replay never emits a second event');
});

test('idempotency: a reused key with a different body is refused; a missing key is 428', async () => {
  const { user } = await bootstrapped();
  const key = idempotencyKey();
  assert.equal((await createAddress(user, home, key)).status, 201);
  const reused = await createAddress(user, { ...home, label: 'العمل' }, key);
  assert.equal(reused.status, 422);
  assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  const missing = await call('/me/addresses', {
    method: 'POST',
    headers: bearer(user),
    body: home,
  });
  assert.equal(missing.status, 428);
  const invalid = await createAddress(user, home, 'short');
  assert.equal(invalid.status, 400);
  // Keys are scoped per principal: another customer may use the same key.
  const { user: other } = await bootstrapped();
  assert.equal((await createAddress(other, home, key)).status, 201);
});

test('ownership: another customer cannot read, edit or archive an address (404, no leak)', async () => {
  const { user: owner } = await bootstrapped();
  const { user: intruder } = await bootstrapped();
  const created = await createAddress(owner, { ...home, location: pinned('36.2', '37.15') });
  const id = created.body.addressId;
  const read = await call(`/me/addresses/${id}`, { headers: bearer(intruder) });
  assert.equal(read.status, 404);
  const edit = await call(`/me/addresses/${id}`, {
    method: 'PATCH',
    headers: { ...bearer(intruder), 'if-match': '"1"' },
    body: { label: 'سرقة' },
  });
  assert.equal(edit.status, 404);
  const archive = await call(`/me/addresses/${id}/archive`, {
    method: 'POST',
    headers: { ...bearer(intruder), 'if-match': '"1"' },
  });
  assert.equal(archive.status, 404);
  assert.equal((await call('/me/addresses', { headers: bearer(intruder) })).body.items.length, 0);
  const untouched = await call(`/me/addresses/${id}`, { headers: bearer(owner) });
  assert.equal(untouched.body.label, home.label);
  assert.equal(untouched.body.revision, 1);
  const malformed = await call('/me/addresses/not-a-uuid', { headers: bearer(owner) });
  assert.equal(malformed.status, 404);
});

test('revisions: concurrent edits with one If-Match yield exactly one winner and one 412', async () => {
  const { user } = await bootstrapped();
  const [first, second] = await Promise.all([
    call('/me', {
      method: 'PATCH',
      headers: { ...bearer(user), 'if-match': '"1"' },
      body: { displayName: 'سامر' },
    }),
    call('/me', {
      method: 'PATCH',
      headers: { ...bearer(user), 'if-match': '"1"' },
      body: { displayName: 'رامي' },
    }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 412]);
  const current = await call('/me', { headers: bearer(user) });
  assert.equal(current.body.revision, 2);
  const stale = await call('/me', {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': '"1"' },
    body: { phone: '0900000000' },
  });
  assert.equal(stale.status, 412);
  assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
  const missing = await call('/me', {
    method: 'PATCH',
    headers: bearer(user),
    body: { phone: '0900000000' },
  });
  assert.equal(missing.status, 428);
});

test('revisions: address edits, archive is safe to retry, archived is read-only', async () => {
  const { user } = await bootstrapped();
  const created = await createAddress(user);
  const id = created.body.addressId;
  const edited = await call(`/me/addresses/${id}`, {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': '"1"' },
    body: { location: pinned('36.123456', '37.000001', 'device'), accessNote: 'البوابة الخلفية' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.revision, 2);
  assert.deepEqual(edited.body.location.coordinates, {
    crs: 'EPSG:4326',
    latitude: '36.123456',
    longitude: '37.000001',
  });
  const archived = await call(`/me/addresses/${id}/archive`, {
    method: 'POST',
    headers: { ...bearer(user), 'if-match': '"2"' },
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.status, 'ARCHIVED');
  const retried = await call(`/me/addresses/${id}/archive`, {
    method: 'POST',
    headers: { ...bearer(user), 'if-match': '"2"' },
  });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.revision, 3);
  const editArchived = await call(`/me/addresses/${id}`, {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': '"3"' },
    body: { label: 'x' },
  });
  assert.equal(editArchived.status, 409);
  assert.equal((await call('/me/addresses', { headers: bearer(user) })).body.items.length, 0);
  const all = await call('/me/addresses?includeArchived=true', { headers: bearer(user) });
  assert.equal(all.body.items.length, 1);
});

test('coordinates: non-finite, out-of-range and over-precise values are refused over HTTP', async () => {
  const { user } = await bootstrapped();
  for (const [latitude, longitude] of [
    ['NaN', '37'],
    ['Infinity', '37'],
    ['90.000001', '37'],
    ['36', '180.5'],
    ['36.1234567', '37'],
  ]) {
    const refused = await createAddress(user, { ...home, location: pinned(latitude, longitude) });
    assert.equal(refused.status, 422, `${latitude},${longitude}`);
    assert.equal(refused.body.error.code, 'INVALID_COORDINATES');
  }
  const numeric = await createAddress(user, {
    ...home,
    location: {
      kind: 'coordinates',
      source: 'pin',
      coordinates: { crs: 'EPSG:4326', latitude: 36.2, longitude: 37.1 },
    },
  });
  assert.equal(numeric.status, 422, 'binary floating point coordinates are not accepted');
  const artwork = await createAddress(user, { ...home, location: { x: 350, y: 240 } });
  assert.equal(artwork.status, 422);
  assert.equal(artwork.body.error.code, 'INVALID_LOCATION');
  assert.equal((await call('/me/addresses', { headers: bearer(user) })).body.items.length, 0);
});

test('coordinates: PostgreSQL itself refuses NaN, out-of-range and inconsistent locations', async () => {
  const { profile } = await bootstrapped();
  const insert = `INSERT INTO app.customer_address
      (id, customer_id, label, line, location_kind, location_source, latitude, longitude,
       status, revision, created_at, updated_at)
    VALUES ($1, $2, 'x', 'y', $3, $4, $5::numeric, $6::numeric, 'ACTIVE', 1, now(), now())`;
  const attempt = (kind, source, lat, lng) =>
    sqlState(db, insert, [randomUUID(), profile.customerId, kind, source, lat, lng]);
  assert.equal(await attempt('coordinates', 'pin', 'NaN', '37'), '23514');
  assert.equal(await attempt('coordinates', 'pin', '36', 'NaN'), '23514');
  assert.equal(await attempt('coordinates', 'pin', '90.5', '37'), '23514');
  assert.equal(await attempt('coordinates', 'pin', '36', '-180.5'), '23514');
  assert.equal(await attempt('coordinates', null, '36', '37'), '23514');
  assert.equal(await attempt('manual', null, '36', '37'), '23514');
  assert.equal(await attempt('coordinates', 'pin', '36.2', '37.1'), null);
  assert.equal(await attempt('manual', null, null, null), null);
});

test('limits: the active-address ceiling holds under concurrency and rolls back cleanly', async () => {
  const { user, profile } = await bootstrapped();
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      createAddress(user, { ...home, label: `عنوان ${index}` }),
    ),
  );
  const statuses = results.map((result) => result.status);
  assert.equal(statuses.filter((status) => status === 201).length, 3, statuses.join(','));
  assert.equal(statuses.filter((status) => status === 409).length, 3);
  const active = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.customer_address WHERE customer_id = $1 AND status = 'ACTIVE'",
    [profile.customerId],
  );
  assert.equal(active.rows[0].n, 3);
  const scope = `account:${user.subject}`;
  const keys = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.idempotency_record WHERE scope = $1',
    [scope],
  );
  assert.equal(keys.rows[0].n, 3, 'a refused write leaves no idempotency record behind');
  const events = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.outbox_message WHERE event_type = 'customer.address-updated.v1' AND payload LIKE $1",
    [`%${profile.customerId}%`],
  );
  assert.equal(events.rows[0].n, 3, 'a refused write leaves no event behind');
});

test('outbox: events carry references and revisions only, never contact or address text', async () => {
  const { user, profile } = await bootstrapped();
  const correlationId = randomUUID();
  const updated = await call('/me', {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': '"1"', 'x-correlation-id': correlationId },
    body: { displayName: 'سامر التجريبي', phone: '0900 000 000' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.phone, '0900000000');
  await createAddress(user, {
    ...home,
    accessNote: 'ملاحظة خاصة',
    location: pinned('36.2', '37.1'),
  });
  const rows = await sql(
    db,
    'SELECT event_type, payload, correlation_id FROM app.outbox_message WHERE payload LIKE $1 ORDER BY created_at',
    [`%${profile.customerId}%`],
  );
  assert.deepEqual(
    rows.rows.map((row) => row.event_type),
    ['customer.profile-updated.v1', 'customer.profile-updated.v1', 'customer.address-updated.v1'],
  );
  const patchEvent = rows.rows[1];
  assert.equal(patchEvent.correlation_id, correlationId);
  for (const row of rows.rows) {
    const payload = JSON.parse(row.payload);
    assert.deepEqual(Object.keys(payload).sort(), [
      'aggregateVersion',
      'correlationId',
      'data',
      'eventId',
      'eventType',
      'occurredAt',
      'producer',
      'schemaVersion',
    ]);
    for (const secret of [
      'سامر',
      '0900000000',
      'حي تجريبي',
      'ملاحظة',
      '36.2',
      '37.1',
      user.subject,
    ]) {
      assert.ok(!row.payload.includes(secret), `event must not carry ${secret}`);
    }
  }
});

test('audit: contact changes are recorded by id only and the table is append-only', async () => {
  const { user, profile } = await bootstrapped();
  await call('/me', {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': '"1"' },
    body: { phone: '0911111111' },
  });
  const audit = await sql(
    db,
    'SELECT action, actor_subject FROM app.audit_entry WHERE target_id = $1 ORDER BY at',
    [profile.customerId],
  );
  assert.deepEqual(
    audit.rows.map((row) => row.action),
    ['customer.profile.created', 'customer.contact.changed'],
  );
  assert.equal(audit.rows[0].actor_subject, user.subject);
  assert.equal(
    await sqlState(db, "UPDATE app.audit_entry SET action = 'x' WHERE target_id = $1", [
      profile.customerId,
    ]),
    '42501',
  );
  assert.equal(
    await sqlState(db, 'DELETE FROM app.audit_entry WHERE target_id = $1', [profile.customerId]),
    '42501',
  );
});

test('guest/account: principals never merge by subject, phone or address', async () => {
  const { user, profile } = await bootstrapped();
  await call('/me', {
    method: 'PATCH',
    headers: { ...bearer(user), 'if-match': '"1"' },
    body: { phone: '0922222222' },
  });
  // A guest profile for the SAME subject value is a different principal.
  const guestId = randomUUID();
  await sql(
    db,
    `INSERT INTO app.customer_profile
       (id, principal_kind, principal_subject, phone, preferred_locale, revision, created_at, updated_at)
     VALUES ($1, 'guest', $2, '0922222222', 'ar', 1, now(), now())`,
    [guestId, user.subject],
  );
  const read = await call('/me', { headers: bearer(user) });
  assert.equal(read.body.customerId, profile.customerId);
  // Another account with the same phone stays a separate customer.
  const { user: second, profile: secondProfile } = await bootstrapped();
  const same = await call('/me', {
    method: 'PATCH',
    headers: { ...bearer(second), 'if-match': '"1"' },
    body: { phone: '0922222222' },
  });
  assert.equal(same.status, 200);
  assert.notEqual(secondProfile.customerId, profile.customerId);
  const rows = await sql(
    db,
    "SELECT count(*)::int AS n FROM app.customer_profile WHERE phone = '0922222222'",
  );
  assert.equal(rows.rows[0].n, 3);
});

test('isolation: the customer runtime role cannot reach the Identity database', async () => {
  const state = await sqlState(context.crossServiceUrl.url, 'SELECT 1');
  assert.ok(['42501', '28P01', '3D000'].includes(state), `unexpected ${state}`);
});

test('identity outage: requests fail closed with 503 and write nothing', async () => {
  const { user, profile } = await bootstrapped();
  await identity.app.close();
  const read = await call('/me', { headers: bearer(user) });
  assert.equal(read.status, 503);
  assert.equal(read.body.error.code, 'IDENTITY_UNAVAILABLE');
  const write = await createAddress(user);
  assert.equal(write.status, 503);
  const rows = await sql(
    db,
    'SELECT count(*)::int AS n FROM app.customer_address WHERE customer_id = $1',
    [profile.customerId],
  );
  assert.equal(rows.rows[0].n, 0);
});
