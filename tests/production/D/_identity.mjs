/**
 * Lane D real-Identity support.
 *
 * Boots the REAL Identity Nest application against the acceptance stack's
 * identity database (runtime identity) and the disposable Redis started by
 * scripts/production/D/run-real-infra.mjs, with real Argon2 and RS256. Only
 * the OTP delivery port is captured in-process, exactly as Identity's own
 * acceptance fixture does: no mail/SMS provider belongs to this lane.
 *
 * Staff roles are granted the way production grants them, through Identity's
 * own `POST /accounts/:id/roles` by a super-admin. The single bootstrap
 * super-admin is seeded with the identity MIGRATION identity, which is how a
 * first operator account is created before any admin exists; nothing else is
 * written to Identity's database by these tests.
 */
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, appDsn, context, migrationDsn, sql } from '../../integration/_support.mjs';

export const STAFF_ORIGIN = 'https://admin.washgo.invalid';
const PASSWORD = 'Test-only staff correct horse battery 42';

const identityRequire = createRequire(path.join(ROOT, 'services/identity/package.json'));

function redisUrl() {
  const url = process.env.CW_D_REDIS_URL;
  if (!url)
    throw new Error('CW_D_REDIS_URL_REQUIRED: run node scripts/production/D/run-real-infra.mjs');
  return url;
}

/**
 * cookieSecure=false names cookies without the __Host- prefix, which is the
 * Identity/Gateway loopback mode a plain-HTTP browser test needs.
 */
export async function startIdentity({ cookieSecure = true, origins = [STAFF_ORIGIN] } = {}) {
  identityRequire('reflect-metadata');
  const { createIdentityApplication } = identityRequire('./dist/identity-runtime.js');
  const { ArgonPasswords } = identityRequire('./dist/infrastructure/security/passwords.js');
  const key = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const passwords = await ArgonPasswords.create({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const delivered = new Map();
  const app = await createIdentityApplication(
    {
      databaseUrl: appDsn(context, 'identity'),
      redisUrl: redisUrl(),
      issuer: 'https://identity.washgo.invalid',
      audience: 'washgo-web',
      privateKeyPem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      previousJwks: { keys: [] },
      otpPepper: randomBytes(32),
      csrfKey: randomBytes(32),
      rateKey: randomBytes(32),
      origins,
      cookieSecure,
      deliveryUrl: 'https://unused.test.invalid',
      deliveryToken: 'test-port-injected',
    },
    {
      delivery: {
        async deliver(input) {
          delivered.set(input.challengeId, input);
        },
      },
      clock: { now: () => Date.now() },
      passwords,
    },
  );
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1').replace('localhost', '127.0.0.1');
  const prefix = cookieSecure ? '__Host-wg_' : 'wg_';
  return { app, base, delivered, prefix, origin: origins[0] };
}

/** A browser-like cookie jar against one origin. */
export class Jar {
  constructor() {
    this.cookies = new Map();
  }
  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  absorb(response) {
    for (const cookie of response.headers.getSetCookie()) {
      const field = cookie.split(';')[0];
      const index = field.indexOf('=');
      const name = field.slice(0, index);
      if (/Max-Age=0(?:;|$)/.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, field.slice(index + 1));
    }
  }
}

async function call(identity, jar, route, method = 'GET', body) {
  const headers = { cookie: jar.header() };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers.origin = identity.origin;
    headers['x-csrf-token'] = jar.cookies.get(`${identity.prefix}csrf`) ?? '';
  }
  const response = await fetch(`${identity.base}/internal/v1/identity${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  jar.absorb(response);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function challenge(identity, jar, kind, email) {
  await call(identity, jar, '/csrf');
  const requested = await call(identity, jar, `/${kind}`, 'POST', { email, password: PASSWORD });
  if (requested.status !== 202) throw new Error(`${kind.toUpperCase()}_${requested.status}`);
  const otp = identity.delivered.get(requested.body.challengeId);
  const verified = await call(identity, jar, '/challenges/verify', 'POST', {
    challengeId: requested.body.challengeId,
    code: otp.code,
  });
  if (verified.status !== 200) throw new Error(`VERIFY_${verified.status}`);
  const token = jar.cookies.get(`${identity.prefix}access`);
  if (!token) throw new Error('ACCESS_COOKIE_MISSING');
  return { token, session: verified.body };
}

/** A fresh session of one account (a re-login picks up a new authVersion). */
export async function signIn(identity, email) {
  const jar = new Jar();
  const { token, session } = await challenge(identity, jar, 'login', email);
  return { jar, token, subject: session.subject, session, email };
}

/** Registers and verifies a fresh account with no staff role. */
export async function account(identity) {
  const jar = new Jar();
  const email = `p02d-${randomUUID()}@example.invalid`;
  const { token, session } = await challenge(identity, jar, 'register', email);
  return { jar, token, subject: session.subject, session, email };
}

/** Tokens are signed per Identity instance, so the admin is cached per instance. */
const admins = new WeakMap();

/** The bootstrap super-admin of one running Identity instance. */
export async function bootstrapAdmin(identity) {
  const cached = admins.get(identity);
  if (cached) return cached;
  const created = await account(identity);
  const seeded = await sql(
    migrationDsn(context, 'identity'),
    `UPDATE app.identity_account SET roles = ARRAY['super-admin']::text[], auth_version = auth_version + 1 WHERE id = '${created.subject}'`,
  );
  if (!seeded.ok) throw new Error(`BOOTSTRAP_ADMIN_SEED_FAILED ${seeded.message}`);
  const admin = await signIn(identity, created.email);
  if (!admin.session.roles.includes('super-admin')) throw new Error('BOOTSTRAP_ADMIN_NOT_ADMIN');
  admins.set(identity, admin);
  return admin;
}

/**
 * A staff account holding exactly `roles`, granted through Identity's own
 * role endpoint by the bootstrap super-admin, then signed in again so the
 * returned token carries the new authorization version.
 */
export async function staff(identity, roles) {
  const admin = await bootstrapAdmin(identity);
  const created = await account(identity);
  if (roles.length > 0) {
    const granted = await call(identity, admin.jar, `/accounts/${created.subject}/roles`, 'POST', {
      roles,
    });
    if (granted.status !== 204) throw new Error(`ROLE_GRANT_${granted.status}`);
  }
  const signed = await signIn(identity, created.email);
  const actual = [...signed.session.roles].sort();
  if (JSON.stringify(actual) !== JSON.stringify([...roles].sort()))
    throw new Error(`ROLES_NOT_APPLIED ${JSON.stringify(actual)}`);
  return signed;
}

/** Identity API call with the caller's cookies and CSRF, as a browser would make it. */
export function identityCall(identity, principal, route, method = 'GET', body) {
  return call(identity, principal.jar, route, method, body);
}

export function bearer(principal) {
  return `Bearer ${principal.token}`;
}
