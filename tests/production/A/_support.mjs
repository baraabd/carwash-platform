/**
 * Lane A real-infrastructure test support.
 *
 * Boots the REAL Identity Nest application (real PostgreSQL, real Redis, real
 * Argon2 and RS256 signing) and gives tests registered, verified accounts. Only
 * the OTP delivery port is captured in-process, exactly as Identity's own
 * acceptance fixture does, because no mail/SMS provider is part of this lane.
 */
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ORIGIN = 'https://customer.washgo.invalid';
const PASSWORD = 'Test-only correct horse battery 42';

if (!process.env.P01A_CONTEXT_FILE) {
  throw new Error('P01A_CONTEXT_FILE_REQUIRED: run node scripts/production/A/acceptance-a.mjs');
}
export const context = JSON.parse(await readFile(process.env.P01A_CONTEXT_FILE, 'utf8'));
if (!/^cw-p01a-[0-9a-f]{12}$/.test(context.project)) throw new Error('DISPOSABLE_CONTEXT_REQUIRED');

const identityRequire = createRequire(path.join(ROOT, 'services/identity/package.json'));
const { createIdentityApplication } = identityRequire('./dist/identity-runtime.js');
const { ArgonPasswords } = identityRequire('./dist/infrastructure/security/passwords.js');
export const pg = identityRequire('pg');

export function serviceRequire(service) {
  return createRequire(path.join(ROOT, 'services', service, 'package.json'));
}

/** One short-lived pg client per statement; the caller's role is in the URL. */
export async function sql(url, statement, values = []) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    return await client.query(statement, values);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Resolves with the SQLSTATE of a refused statement, or null when it succeeded. */
export async function sqlState(url, statement, values = []) {
  try {
    await sql(url, statement, values);
    return null;
  } catch (error) {
    return error.code ?? 'UNKNOWN';
  }
}

export async function startIdentity() {
  const key = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const passwords = await ArgonPasswords.create({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const delivered = new Map();
  const delivery = {
    async deliver(input) {
      delivered.set(input.challengeId, input);
    },
  };
  const app = await createIdentityApplication(
    {
      databaseUrl: context.identityDatabaseUrl,
      redisUrl: context.redisUrl,
      issuer: 'https://identity.washgo.invalid',
      audience: 'washgo-web',
      privateKeyPem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      previousJwks: { keys: [] },
      otpPepper: randomBytes(32),
      csrfKey: randomBytes(32),
      rateKey: randomBytes(32),
      origins: [ORIGIN],
      cookieSecure: true,
      deliveryUrl: 'https://unused.test.invalid',
      deliveryToken: 'test-port-injected',
    },
    { delivery, clock: { now: () => Date.now() }, passwords },
  );
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1').replace('localhost', '127.0.0.1');
  return { app, base, delivered };
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

async function identityCall(identity, jar, route, method = 'GET', body) {
  const headers = { cookie: jar.header() };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers.origin = ORIGIN;
    headers['x-csrf-token'] = jar.cookies.get('__Host-wg_csrf') ?? '';
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

/** Registers and verifies a fresh account; returns its cookie jar and bearer token. */
export async function account(identity) {
  const jar = new Jar();
  await identityCall(identity, jar, '/csrf');
  const email = `p01a-${randomUUID()}@example.invalid`;
  const requested = await identityCall(identity, jar, '/register', 'POST', {
    email,
    password: PASSWORD,
  });
  if (requested.status !== 202) throw new Error(`REGISTER_${requested.status}`);
  const challenge = identity.delivered.get(requested.body.challengeId);
  const verified = await identityCall(identity, jar, '/challenges/verify', 'POST', {
    challengeId: requested.body.challengeId,
    code: challenge.code,
  });
  if (verified.status !== 200) throw new Error(`VERIFY_${verified.status}`);
  const token = jar.cookies.get('__Host-wg_access');
  if (!token) throw new Error('ACCESS_COOKIE_MISSING');
  return {
    jar,
    token,
    subject: verified.body.subject,
    logout: () => identityCall(identity, jar, '/logout', 'POST', {}),
  };
}

/** Starts an owner service's real HTTP adapter from its built dist output. */
export async function startService(service, databaseUrl, env) {
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  process.env.DATABASE_URL = databaseUrl;
  const own = serviceRequire(service);
  own('reflect-metadata');
  const { createHttpApplication } = own('./dist/transport/http/create-app.js');
  const app = await createHttpApplication();
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1').replace('localhost', '127.0.0.1');
  return { app, base };
}

export function idempotencyKey() {
  return randomBytes(18).toString('base64url');
}

/** Small HTTP client for an owner service. */
export function client(base, prefix) {
  return async function call(route, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${base}${prefix}${route}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  };
}
