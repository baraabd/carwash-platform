// P01-E3 guest identity against REAL PostgreSQL and Redis (pnpm acceptance:identity).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, login, register, secretDigest } from './_fixture.mjs';

async function withFixture(t) {
  const f = await fixture();
  t.after(() => f.close());
  return f;
}

async function guest(f, client = f.client()) {
  await client.request('/csrf');
  const created = await client.request('/guest-sessions', { method: 'POST', body: {} });
  return { client, created };
}

const GUEST_PERMISSIONS = [
  'bookings.create:self',
  'bookings.read:self',
  'profile.read:self',
  'profile.write:self',
];

test('P01-E3 real guest: created without account data, self-service permissions only, hardened cookies', async (t) => {
  const f = await withFixture(t);
  const { client, created } = await guest(f);
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), ['guestExpiresAt', 'recoveryCode', 'session']);
  assert.match(created.body.recoveryCode, /^[A-Za-z0-9_-]{43}$/);
  const { session } = created.body;
  assert.equal(session.principalKind, 'guest');
  assert.deepEqual(session.roles, []);
  assert.deepEqual([...session.permissions].sort(), GUEST_PERMISSIONS);
  assert.ok(
    !Object.hasOwn(created.body, 'accessToken') && !Object.hasOwn(created.body, 'refreshToken'),
  );
  for (const name of ['__Host-wg_access', '__Host-wg_refresh']) {
    const cookie = created.cookies.find((value) => value.startsWith(name + '='));
    assert.ok(
      cookie?.includes('; HttpOnly') &&
        cookie.includes('; Secure') &&
        cookie.includes('SameSite=Strict'),
    );
  }

  const row = await f.db.identityAccount.findUnique({ where: { id: session.subject } });
  assert.equal(row.kind, 'guest');
  assert.equal(row.email, null);
  assert.equal(row.passwordHash, null);
  assert.deepEqual(row.roles, []);
  // Only the digest is persisted, never the code.
  assert.equal(row.recoveryDigest, secretDigest(created.body.recoveryCode));
  assert.equal(row.guestExpiresAt.toISOString(), created.body.guestExpiresAt);

  const current = await client.request('/session');
  assert.equal(current.status, 200);
  assert.equal(current.body.principalKind, 'guest');
  assert.equal((await client.request('/refresh', { method: 'POST', body: {} })).status, 200);

  const audit = await f.db.identityAudit.findMany({ where: { subjectId: session.subject } });
  assert.ok(audit.some((entry) => entry.action === 'guest.created' && entry.outcome === 'SUCCESS'));
  assert.ok(!JSON.stringify(audit).includes(created.body.recoveryCode));
});

test('P01-E3 real guest: recovery is single-use, rotates the code and revokes earlier sessions', async (t) => {
  const f = await withFixture(t);
  const { client: original, created } = await guest(f);
  const code = created.body.recoveryCode;

  const device = f.client();
  await device.request('/csrf');
  const recovered = await device.request('/guest-sessions/recover', {
    method: 'POST',
    body: { recoveryCode: code },
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.session.subject, created.body.session.subject);
  assert.notEqual(recovered.body.recoveryCode, code);
  assert.equal(recovered.body.session.authVersion, created.body.session.authVersion + 1);
  assert.equal((await device.request('/session')).status, 200);

  // The previous holder's access and refresh are dead.
  assert.equal((await original.request('/session')).status, 401);
  assert.equal((await original.request('/refresh', { method: 'POST', body: {} })).status, 401);

  // The old code cannot be replayed.
  const replay = f.client();
  await replay.request('/csrf');
  const again = await replay.request('/guest-sessions/recover', {
    method: 'POST',
    body: { recoveryCode: code },
  });
  assert.equal(again.status, 401);
  assert.equal(again.body.error.code, 'AUTH_INVALID');
  const row = await f.db.identityAccount.findUnique({
    where: { id: created.body.session.subject },
  });
  assert.equal(row.recoveryDigest, secretDigest(recovered.body.recoveryCode));
});

test('P01-E3 real guest: concurrent recoveries with one code yield exactly one session', async (t) => {
  const f = await withFixture(t);
  const { created } = await guest(f);
  const clients = [f.client(), f.client(), f.client()];
  for (const c of clients) await c.request('/csrf');
  const results = await Promise.all(
    clients.map((c) =>
      c.request('/guest-sessions/recover', {
        method: 'POST',
        body: { recoveryCode: created.body.recoveryCode },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401, 401]);
});

test('P01-E3 real guest: unknown, malformed, suspended and expired guests share one failure', async (t) => {
  const f = await withFixture(t);
  const attempt = async (recoveryCode) => {
    const c = f.client();
    await c.request('/csrf');
    return c.request('/guest-sessions/recover', { method: 'POST', body: { recoveryCode } });
  };
  const unknown = await attempt('A'.repeat(43));
  assert.equal(unknown.status, 401);
  assert.equal((await attempt('short')).status, 400);

  const suspended = await guest(f);
  await f.db.identityAccount.update({
    where: { id: suspended.created.body.session.subject },
    data: { status: 'SUSPENDED' },
  });
  const deniedSuspended = await attempt(suspended.created.body.recoveryCode);
  assert.equal(deniedSuspended.status, 401);
  assert.deepEqual(
    Object.keys(deniedSuspended.body.error).sort(),
    Object.keys(unknown.body.error).sort(),
  );
  assert.equal(deniedSuspended.body.error.code, unknown.body.error.code);
  assert.equal((await suspended.client.request('/session')).status, 401);

  const expiring = await guest(f);
  f.clock.offset += 2_592_000_001;
  assert.equal((await attempt(expiring.created.body.recoveryCode)).status, 401);
  assert.equal((await expiring.client.request('/session')).status, 401);
  assert.equal(
    (await expiring.client.request('/refresh', { method: 'POST', body: {} })).status,
    401,
  );
});

test('P01-E3 real guest: creation needs CSRF and is abuse-budgeted per client address', async (t) => {
  const f = await withFixture(t);
  const noCsrf = f.client();
  assert.equal(
    (await noCsrf.request('/guest-sessions', { method: 'POST', body: {}, csrf: false })).status,
    403,
  );
  const statuses = [];
  for (let i = 0; i < 11; i += 1) statuses.push((await guest(f)).created.status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
  assert.equal(statuses[10], 429);
  const body = (await guest(f)).created.body;
  assert.equal(body.error.code, 'AUTH_RATE_LIMITED');
});

test('P01-E3 real guest: staff role grants are refused for guests and the database rejects mixed shapes', async (t) => {
  const f = await withFixture(t);
  const target = await guest(f);
  const seed = await register(f);
  await f.db.identityAccount.update({
    where: { id: seed.session.subject },
    data: { roles: ['super-admin'] },
  });
  // A role change revokes sessions, so the seeded administrator signs in again.
  const signedIn = await login(f, seed.email);
  const denied = await signedIn.client.request(
    `/accounts/${target.created.body.session.subject}/roles`,
    {
      method: 'POST',
      body: { roles: ['finance'] },
    },
  );
  assert.equal(denied.status, 400);
  const row = await f.db.identityAccount.findUnique({
    where: { id: target.created.body.session.subject },
  });
  assert.deepEqual(row.roles, []);

  // CHECK identity_account_kind_shape, enforced by PostgreSQL itself.
  await assert.rejects(
    f.db.identityAccount.update({
      where: { id: target.created.body.session.subject },
      data: { roles: ['finance'] },
    }),
    /identity_account_kind_shape|check constraint/i,
  );
  await assert.rejects(
    f.db.identityAccount.update({
      where: { id: target.created.body.session.subject },
      data: { email: 'guest-turned-account@example.invalid' },
    }),
    /identity_account_kind_shape|check constraint/i,
  );
  await assert.rejects(
    f.db.identityAccount.update({
      where: { id: seed.session.subject },
      data: { recoveryDigest: 'a'.repeat(64) },
    }),
    /identity_account_kind_shape|check constraint/i,
  );
});
