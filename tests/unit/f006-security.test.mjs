import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { ROOT } from './_load.mjs';

const identityRequire = createRequire(path.join(ROOT, 'services/identity/package.json'));
const { ArgonPasswords } = identityRequire('./dist/infrastructure/security/passwords.js');
const { IdentitySigningKeys } = identityRequire('./dist/infrastructure/security/signing-keys.js');
const { IdentitySecrets } = identityRequire('./dist/infrastructure/security/secrets.js');
const { loadIdentityConfig } = identityRequire('./dist/infrastructure/security/config.js');
const { permissionsFor, objectInput, normalizeEmail, rolesInput } = identityRequire(
  './dist/domain/auth-policy.js',
);
const { AccessTokenVerifier, CsrfTokens, allowedOrigin, sessionCookie, readCookies } =
  identityRequire('@carwash/security-kit');
const { IDENTITY_ROLES, isAccessPrincipal } = identityRequire('@carwash/contracts');
const { SignJWT, exportJWK } = identityRequire('jose');
const issuer = 'https://identity.washgo.invalid';
const audience = 'washgo-web';
const principal = { subject: randomUUID(), sessionId: randomUUID(), authVersion: 1 };
let pair;
let signing;
let passwords;
let jwksServer;
let remoteUrl;

before(async () => {
  pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  signing = await IdentitySigningKeys.load(
    pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    issuer,
    audience,
  );
  passwords = await ArgonPasswords.create({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
  jwksServer = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(signing.jwks));
  });
  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  remoteUrl = new URL(`http://127.0.0.1:${jwksServer.address().port}/jwks`);
});
after(async () => {
  if (jwksServer) await new Promise((resolve) => jwksServer.close(resolve));
});

const password = 'Correct horse battery staple 42';
test('F006 password: Argon2id PHC contains explicit parameters and fresh salts', async () => {
  const a = await passwords.hash(password);
  const b = await passwords.hash(password);
  assert.match(a, /^\$argon2id\$v=19\$/);
  assert.deepEqual(a.split('$')[3].split(',').sort(), ['m=19456', 'p=1', 't=2']);
  assert.notEqual(a, b);
  assert.equal(await passwords.verify(a, password), true);
  assert.equal(await passwords.verify(a, password + '!'), false);
  assert.equal(passwords.needsRehash(a), false);
});
test('F006 password: stronger policy upgrades a verified previous hash', async () => {
  const old = await passwords.hash(password);
  const stronger = await ArgonPasswords.create();
  assert.equal(await stronger.verify(old, password), true);
  assert.equal(stronger.needsRehash(old), true);
  const upgraded = await stronger.hash(password);
  assert.deepEqual(upgraded.split('$')[3].split(',').sort(), ['m=65536', 'p=1', 't=3']);
  assert.equal(stronger.needsRehash(upgraded), false);
});
test('F006 password: malformed or resource-exhausting hashes fail closed', async () => {
  assert.equal(await passwords.verify('not-a-hash', password), false);
  assert.equal(
    await passwords.verify('$argon2id$v=19$m=999999999,t=3,p=1$bad$bad', password),
    false,
  );
  assert.equal(passwords.needsRehash('not-a-hash'), true);
  await assert.rejects(
    () => ArgonPasswords.create({ memoryCost: 1, timeCost: 1, parallelism: 1 }),
    /INVALID_ARGON_POLICY/,
  );
});
test('F006 OTP: code fingerprints bind challenge, generation and a secret pepper', () => {
  const secrets = new IdentitySecrets(randomBytes(32));
  const code = secrets.otp();
  const id = randomUUID();
  assert.match(code, /^\d{6}$/);
  const digest = secrets.otpDigest(id, 1, code);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, code);
  assert.notEqual(digest, secrets.otpDigest(id, 2, code));
  assert.notEqual(digest, new IdentitySecrets(randomBytes(32)).otpDigest(id, 1, code));
  assert.equal(secrets.equal(digest, digest), true);
  assert.equal(secrets.equal(digest, 'different'), false);
});

test('F006 JWT: public verifier validates a private-key-signed access token', async () => {
  const token = await signing.sign(principal);
  assert.deepEqual(
    await new AccessTokenVerifier({ issuer, audience }, signing.jwks).verify(token),
    principal,
  );
  assert.ok(signing.jwks.keys.every((key) => !('d' in key) && key.kty === 'RSA' && key.kid));
});
test('F006 JWT: remote JWKS verification uses only the configured public endpoint', async () => {
  const verifier = new AccessTokenVerifier({ issuer, audience }, remoteUrl);
  assert.deepEqual(await verifier.verify(await signing.sign(principal)), principal);
});
for (const field of ['issuer', 'audience']) {
  test(`F006 JWT: wrong ${field} is refused`, async () => {
    const token = await signing.sign(principal);
    await assert.rejects(() =>
      new AccessTokenVerifier({ issuer, audience, [field]: 'untrusted' }, signing.jwks).verify(
        token,
      ),
    );
  });
}

test('F006 JWT: tamper, unsupported alg, unknown kid, missing claims and expired tokens fail', async () => {
  const verifier = new AccessTokenVerifier({ issuer, audience }, signing.jwks);
  const token = await signing.sign(principal);
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: randomUUID() })).toString('base64url');
  await assert.rejects(() => verifier.verify(parts.join('.')));
  const base = () =>
    new SignJWT({ sid: principal.sessionId, ver: 1 })
      .setSubject(principal.subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('5m');
  const hs = await base()
    .setProtectedHeader({ alg: 'HS256', kid: signing.kid, typ: 'at+jwt' })
    .sign(randomBytes(32));
  await assert.rejects(() => verifier.verify(hs));
  const unknown = await base()
    .setProtectedHeader({ alg: 'RS256', kid: 'unknown-key-id', typ: 'at+jwt' })
    .sign(pair.privateKey);
  await assert.rejects(() => verifier.verify(unknown));
  const expired = await base()
    .setProtectedHeader({ alg: 'RS256', kid: signing.kid, typ: 'at+jwt' })
    .setIssuedAt(10)
    .setExpirationTime(20)
    .sign(pair.privateKey);
  await assert.rejects(() => verifier.verify(expired));
  const missing = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: signing.kid, typ: 'at+jwt' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime('5m')
    .sign(pair.privateKey);
  await assert.rejects(() => verifier.verify(missing));
  const jku = await base()
    .setProtectedHeader({
      alg: 'RS256',
      kid: signing.kid,
      typ: 'at+jwt',
      jku: 'https://untrusted.invalid/jwks',
    })
    .sign(pair.privateKey);
  await assert.rejects(() => verifier.verify(jku));
});
test('F006 JWT: public key rotation accepts the retained previous key without disclosing it', async () => {
  const nextPair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const next = await IdentitySigningKeys.load(
    nextPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    issuer,
    audience,
    signing.jwks,
  );
  const verifier = new AccessTokenVerifier({ issuer, audience }, next.jwks);
  assert.deepEqual(await verifier.verify(await signing.sign(principal)), principal);
  assert.deepEqual(await verifier.verify(await next.sign(principal)), principal);
  const invalid = await exportJWK(pair.privateKey);
  assert.throws(
    () => new AccessTokenVerifier({ issuer, audience }, { keys: [invalid] }),
    /INVALID_PUBLIC_JWKS/,
  );
  assert.throws(
    () => new AccessTokenVerifier({ issuer, audience }, new URL('http://untrusted.invalid/jwks')),
    /JWKS_HTTPS_REQUIRED/,
  );
});

test('F006 CSRF: signed double-submit binds the header, cookie and session', () => {
  const csrf = new CsrfTokens(randomBytes(32));
  const session = randomBytes(32).toString('base64url');
  const token = csrf.issue(session);
  assert.equal(csrf.verify(token, token, session), true);
  assert.equal(csrf.verify(token, token, 'another-session'), false);
  assert.equal(csrf.verify(undefined, token, session), false);
  assert.equal(csrf.verify(token, undefined, session), false);
  assert.equal(csrf.verify(token + 'x', token, session), false);
  assert.equal(csrf.verify(token, token, ''), false);
});
test('F006 CSRF: exact Origin and fetch-site policy deny untrusted requests', () => {
  const allowed = ['https://customer.washgo.invalid'];
  assert.equal(allowedOrigin(allowed[0], allowed, 'same-origin'), true);
  for (const origin of [
    undefined,
    'null',
    'https://evil.invalid',
    'https://customer.washgo.invalid.evil.invalid',
    allowed[0] + '/',
  ])
    assert.equal(allowedOrigin(origin, allowed), false);
  assert.equal(allowedOrigin(allowed[0], allowed, 'cross-site'), false);
});
test('F006 cookies: hardened session attributes and duplicate-name rejection', () => {
  const cookie = sessionCookie('__Host-wg_refresh', 'opaque', {
    secure: true,
    httpOnly: true,
    maxAge: 300,
  });
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.throws(() =>
    sessionCookie('__Host-wg_refresh', 'opaque', { secure: false, httpOnly: true, maxAge: 300 }),
  );
  assert.throws(() =>
    sessionCookie('wg_refresh', 'injection\r\nheader: bad', {
      secure: true,
      httpOnly: true,
      maxAge: 300,
    }),
  );
  assert.throws(() => readCookies('wg_refresh=a; wg_refresh=b'), /DUPLICATE_COOKIE/);
});
for (const role of IDENTITY_ROLES) {
  test(`F006 permissions: ${role} has explicit grants`, () => {
    const permissions = permissionsFor([role]);
    assert.ok(permissions.length > 0);
    assert.equal(new Set(permissions).size, permissions.length);
    if (role !== 'super-admin') assert.ok(!permissions.includes('identity.roles.assign'));
    if (role !== 'finance' && role !== 'super-admin')
      assert.ok(!permissions.includes('billing.refund'));
  });
}
test('F006 contracts: user input cannot assign roles or supply unknown credential fields', () => {
  assert.equal(normalizeEmail('  CUSTOMER@EXAMPLE.INVALID  '), 'customer@example.invalid');
  assert.throws(() =>
    objectInput({ email: 'a@b.com', password, roles: ['super-admin'] }, ['email', 'password']),
  );
  assert.throws(() => rolesInput(['customer', 'fake-admin']));
  assert.throws(() => rolesInput(['customer', 'customer']));
  assert.equal(isAccessPrincipal(principal), true);
  assert.equal(isAccessPrincipal({ ...principal, authVersion: 0 }), false);
  assert.equal(isAccessPrincipal({ ...principal, subject: 'forged-header' }), false);
});
test('F006 config: missing production secrets/configuration never starts a fake identity service', () => {
  assert.throws(
    () => loadIdentityConfig({ APP_ENV: 'production', COOKIE_SECURE: 'false' }),
    /SECURE_COOKIES_REQUIRED/,
  );
  assert.throws(() => loadIdentityConfig({ APP_ENV: 'test' }), /INVALID_APP_ENV/);
});
