import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  fixture,
  register,
  login,
  email,
  PASSWORD,
  RedisRateBudget,
  context,
  secretDigest,
  AccessTokenVerifier,
  IDENTITY_V1,
  IDENTITY_ROLES,
  createRedisClient,
} from './_fixture.mjs';

async function withFixture(t) {
  const f = await fixture();
  t.after(() => f.close());
  return f;
}

test('F006 real API: registration verifies email, creates owned session and sets hardened cookies', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  assert.deepEqual(user.session.roles, ['customer']);
  assert.ok(!user.session.permissions.includes('identity.roles.assign'));
  assert.equal((await user.client.request('/session')).status, 200);
  const row = await f.db.identityAccount.findUnique({ where: { id: user.session.subject } });
  assert.ok(row.passwordHash.startsWith('$argon2id$'));
  assert.ok(row.passwordHash !== PASSWORD);
  const refresh = await f.db.identityRefresh.findMany({
    where: { sessionId: user.session.sessionId },
  });
  assert.equal(refresh.length, 1);
  assert.ok(refresh[0].digest === secretDigest(user.client.cookie('__Host-wg_refresh')));
  for (const name of ['__Host-wg_access', '__Host-wg_refresh']) {
    const cookie = user.cookies.find((value) => value.startsWith(name + '='));
    assert.ok(
      cookie?.includes('; HttpOnly') &&
        cookie.includes('; Secure') &&
        cookie.includes('SameSite=Strict') &&
        !cookie.includes('Domain='),
      'hardened session flags',
    );
  }
  assert.ok(
    !Object.hasOwn(user.session, 'accessToken') && !Object.hasOwn(user.session, 'refreshToken'),
  );
});
test('F006 real API: bad credentials, unknown accounts and suspended accounts share challenge response shape', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const client = f.client();
  await client.request('/csrf');
  const bad = await client.request('/login', {
    method: 'POST',
    body: { email: user.email, password: PASSWORD + 'wrong' },
  });
  const unknown = await client.request('/login', {
    method: 'POST',
    body: { email: email(), password: PASSWORD },
  });
  await f.db.identityAccount.update({
    where: { id: user.session.subject },
    data: { status: 'SUSPENDED' },
  });
  const suspended = await client.request('/login', {
    method: 'POST',
    body: { email: user.email, password: PASSWORD },
  });
  for (const result of [bad, unknown, suspended]) {
    assert.equal(result.status, 202);
    assert.deepEqual(Object.keys(result.body).sort(), ['challengeId', 'expiresIn', 'resendAfter']);
    assert.equal(f.delivered.has(result.body.challengeId), false);
  }
});
test('F006 real OTP: issue, resend cooldown, stale-code refusal and expiry', async (t) => {
  const f = await withFixture(t);
  const client = f.client();
  await client.request('/csrf');
  const start = await client.request('/register', {
    method: 'POST',
    body: { email: email(), password: PASSWORD },
  });
  const challengeId = start.body.challengeId;
  const original = f.delivered.get(challengeId).code;
  const early = await client.request('/challenges/resend', {
    method: 'POST',
    body: { challengeId },
  });
  assert.equal(early.status, 401);
  f.clock.offset += 31_000;
  const resent = await client.request('/challenges/resend', {
    method: 'POST',
    body: { challengeId },
  });
  assert.equal(resent.status, 202);
  const stored = await f.db.identityChallenge.findUnique({ where: { id: challengeId } });
  assert.equal(stored.generation, 2);
  assert.equal(stored.attempts, 0);
  assert.ok(original !== f.delivered.get(challengeId).code, 'resend must issue a different code');
  const stale = await client.request('/challenges/verify', {
    method: 'POST',
    body: { challengeId, code: original },
  });
  assert.equal(stale.status, 401);
  f.clock.offset += 300_000;
  const expired = await client.request('/challenges/verify', {
    method: 'POST',
    body: { challengeId, code: f.delivered.get(challengeId).code },
  });
  assert.equal(expired.status, 401);
  assert.ok(!client.cookie('__Host-wg_access'));
});
test('F006 real OTP: failed attempts persist, are bounded and are not reset by resend', async (t) => {
  const f = await withFixture(t);
  const client = f.client();
  await client.request('/csrf');
  const issued = await client.request('/register', {
    method: 'POST',
    body: { email: email(), password: PASSWORD },
  });
  const id = issued.body.challengeId;
  const actual = f.delivered.get(id).code;
  const wrong = actual === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(
      (
        await client.request('/challenges/verify', {
          method: 'POST',
          body: { challengeId: id, code: wrong },
        })
      ).status,
      401,
    );
  }
  const row = await f.db.identityChallenge.findUnique({ where: { id } });
  assert.equal(row.attempts, 5);
  assert.equal(row.state, 'INVALID');
  f.clock.offset += 31_000;
  assert.equal(
    (await client.request('/challenges/resend', { method: 'POST', body: { challengeId: id } }))
      .status,
    401,
  );
  assert.equal(
    (
      await client.request('/challenges/verify', {
        method: 'POST',
        body: { challengeId: id, code: actual },
      })
    ).status,
    401,
  );
});
test('F006 real OTP: provider failure invalidates the challenge without exposing delivery/account state', async (t) => {
  const f = await withFixture(t);
  f.delivery.fail = true;
  const client = f.client();
  await client.request('/csrf');
  const start = await client.request('/register', {
    method: 'POST',
    body: { email: email(), password: PASSWORD },
  });
  assert.equal(start.status, 202);
  const id = start.body.challengeId;
  assert.equal((await f.db.identityChallenge.findUnique({ where: { id } })).state, 'INVALID');
  assert.equal(
    (
      await client.request('/challenges/verify', {
        method: 'POST',
        body: { challengeId: id, code: f.delivered.get(id).code },
      })
    ).status,
    401,
  );
});
test('F006 real OTP: concurrent verification consumes one challenge exactly once locally', async (t) => {
  const f = await withFixture(t);
  const client = f.client();
  await client.request('/csrf');
  const issued = await client.request('/register', {
    method: 'POST',
    body: { email: email(), password: PASSWORD },
  });
  const body = {
    challengeId: issued.body.challengeId,
    code: f.delivered.get(issued.body.challengeId).code,
  };
  const other = client.clone();
  const results = await Promise.all([
    client.request('/challenges/verify', { method: 'POST', body }),
    other.request('/challenges/verify', { method: 'POST', body }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);
});
test('F006 real refresh: rotation changes the token and replay revokes the family durably', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const old = user.client.clone();
  const rotated = await user.client.request('/refresh', { method: 'POST', body: {} });
  assert.equal(rotated.status, 200);
  assert.ok(old.cookie('__Host-wg_refresh') !== user.client.cookie('__Host-wg_refresh'));
  assert.equal((await old.request('/refresh', { method: 'POST', body: {} })).status, 401);
  assert.equal((await user.client.request('/session')).status, 401);
  assert.equal((await user.client.request('/refresh', { method: 'POST', body: {} })).status, 401);
  const audit = await f.db.identityAudit.findMany({
    where: { subjectId: user.session.subject, action: 'refresh.replay' },
  });
  assert.equal(audit.length, 1);
});
test('F006 real refresh: competing rotations cannot both succeed', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const second = user.client.clone();
  const results = await Promise.all([
    user.client.request('/refresh', { method: 'POST', body: {} }),
    second.request('/refresh', { method: 'POST', body: {} }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);
  assert.equal((await user.client.request('/session')).status, 401);
});
test('F006 real sessions: logout and logout-all invalidate existing sessions', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const second = await login(f, user.email);
  const old = user.client.clone();
  assert.equal((await user.client.request('/logout', { method: 'POST', body: {} })).status, 204);
  assert.equal((await old.request('/session')).status, 401);
  assert.equal((await second.client.request('/session')).status, 200);
  const third = await login(f, user.email);
  assert.equal(
    (await second.client.request('/logout-all', { method: 'POST', body: {} })).status,
    204,
  );
  assert.equal((await third.client.request('/session')).status, 401);
});
test('F006 real CSRF: missing, wrong-session, mismatched header and foreign Origin are denied', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const foreign = f.client();
  await foreign.request('/csrf');
  for (const options of [
    { csrf: false },
    { origin: null },
    { origin: 'https://evil.invalid' },
    { csrf: false, headers: { 'x-csrf-token': foreign.cookie('__Host-wg_csrf') } },
    { headers: { 'sec-fetch-site': 'cross-site' } },
  ])
    assert.equal(
      (await user.client.request('/logout', { method: 'POST', body: {}, ...options })).status,
      403,
    );
  assert.equal((await user.client.request('/session')).status, 200);
});
test('F006 real authorization: client identity headers and self-assigned roles are not authority', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const anonymous = f.client();
  assert.equal(
    (
      await anonymous.request('/session', {
        headers: { 'x-user-id': user.session.subject, 'x-user-role': 'super-admin' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await user.client.request(`/accounts/${randomUUID()}/roles`, {
        method: 'POST',
        body: { roles: ['super-admin'] },
      })
    ).status,
    403,
  );
  await anonymous.request('/csrf');
  assert.equal(
    (
      await anonymous.request('/register', {
        method: 'POST',
        body: { email: email(), password: PASSWORD, roles: ['super-admin'] },
      })
    ).status,
    400,
  );
});
test('F006 real authorization: administrative suspension takes effect on previously issued access and refresh', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const seed = await register(f);
  // Test-only administrative bootstrap through the owning database, never a public endpoint.
  await f.db.identityAccount.update({
    where: { id: seed.session.subject },
    data: { roles: ['super-admin'] },
  });
  const admin = await login(f, seed.email);
  assert.equal(
    (
      await admin.client.request(`/accounts/${user.session.subject}/status`, {
        method: 'POST',
        body: { status: 'SUSPENDED' },
      })
    ).status,
    204,
  );
  assert.equal((await user.client.request('/session')).status, 401);
  assert.equal((await user.client.request('/refresh', { method: 'POST', body: {} })).status, 401);
});
test('F006 real roles: all seven roles are represented without broad implicit administration', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  for (const role of IDENTITY_ROLES) {
    await f.db.identityAccount.update({
      where: { id: user.session.subject },
      data: { roles: [role] },
    });
    const view = await user.client.request('/session');
    assert.equal(view.status, 200);
    assert.deepEqual(view.body.roles, [role]);
    assert.equal(view.body.permissions.includes('identity.roles.assign'), role === 'super-admin');
  }
});
test('F006 real audit: durable security records contain no credential, OTP or refresh fields', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const records = await f.db.identityAudit.findMany({ where: { subjectId: user.session.subject } });
  assert.ok(records.some((row) => row.action === 'login.succeeded'));
  const serialized = JSON.stringify(records);
  assert.ok(
    !serialized.includes(user.email) &&
      !serialized.includes(PASSWORD) &&
      !serialized.includes(user.client.cookie('__Host-wg_refresh')) &&
      !serialized.includes(user.client.cookie('__Host-wg_access')),
    'audit records contain only allowlisted non-secret fields',
  );
});
test('F006 real JWT: a separate public verifier can authenticate without private signing material', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const verifier = new AccessTokenVerifier(
    { issuer: f.config.issuer, audience: f.config.audience },
    new URL(`${f.base}${IDENTITY_V1}/.well-known/jwks.json`),
  );
  const result = await verifier.verify(user.client.cookie('__Host-wg_access'));
  assert.equal(result.subject, user.session.subject);
});
test('F006 real Redis: independent clients share an atomic limit, with bounded TTL reset', async (t) => {
  const pepper = randomBytes(32);
  const clients = await Promise.all([
    RedisRateBudget.open(context.redisUrl, pepper),
    RedisRateBudget.open(context.redisUrl, pepper),
  ]);
  t.after(() => clients.forEach((client) => client.close()));
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      clients[index % 2].take('integration-shared', 'same-subject', 7, 1_000),
    ),
  );
  assert.equal(results.filter((result) => result.allowed).length, 7);
  const ttl = Math.max(...results.map((result) => result.retryAfterMs));
  await delay(ttl + 30);
  assert.equal(
    (await clients[0].take('integration-shared', 'same-subject', 7, 1_000)).allowed,
    true,
  );
  clients[0].close();
  await assert.rejects(
    () => clients[0].take('integration-shared', 'same-subject', 7, 1_000),
    /RATE_BUDGET_UNAVAILABLE/,
  );
});
test('F006 real Redis: service credentials cannot write another namespace or administer Redis', async (t) => {
  const client = createRedisClient({ url: context.redisUrl });
  client.on('error', () => {});
  await client.connect();
  t.after(() => client.destroy());
  await assert.rejects(() => client.sendCommand(['FLUSHALL']), /NOPERM/);
  await assert.rejects(
    () =>
      client.eval("return redis.call('INCR', KEYS[1])", {
        keys: ['other-service:rate:key'],
        arguments: [],
      }),
    /NOPERM/,
  );
});

test('F006 real API: distributed abuse budget is enforced before additional challenge work', async (t) => {
  const f = await withFixture(t);
  const client = f.client();
  await client.request('/csrf');
  const address = email();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await client.request('/login', {
      method: 'POST',
      body: { email: address, password: PASSWORD },
    });
    assert.equal(result.status, 202);
  }
  const denied = await client.request('/login', {
    method: 'POST',
    body: { email: address, password: PASSWORD },
  });
  assert.equal(denied.status, 429);
  assert.equal(denied.body.error.code, 'AUTH_RATE_LIMITED');
  assert.equal(await f.db.identityChallenge.count({ where: { email: address } }), 8);
});
test('F006 real roles: changing grants revokes stale sessions, new login receives only new permissions', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  const seed = await register(f);
  await f.db.identityAccount.update({
    where: { id: seed.session.subject },
    data: { roles: ['super-admin'] },
  });
  const admin = await login(f, seed.email);
  assert.equal(
    (
      await admin.client.request(`/accounts/${user.session.subject}/roles`, {
        method: 'POST',
        body: { roles: ['finance'] },
      })
    ).status,
    204,
  );
  assert.equal((await user.client.request('/session')).status, 401);
  const updated = await login(f, user.email);
  assert.deepEqual(updated.session.roles, ['finance']);
  assert.ok(updated.session.permissions.includes('billing.refund'));
  assert.ok(!updated.session.permissions.includes('identity.roles.assign'));
});
test('F006 real session expiry: an expired family cannot refresh or authorize', async (t) => {
  const f = await withFixture(t);
  const user = await register(f);
  f.clock.offset += 604_800_001;
  assert.equal((await user.client.request('/refresh', { method: 'POST', body: {} })).status, 401);
  assert.equal((await user.client.request('/session')).status, 401);
});
