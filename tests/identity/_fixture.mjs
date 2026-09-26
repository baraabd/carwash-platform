import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const own = createRequire(path.join(ROOT, 'services/identity/package.json'));
const securityRequire = createRequire(path.join(ROOT, 'packages/security-kit/package.json'));
export const { createClient: createRedisClient } = securityRequire('@redis/client');
const { createIdentityApplication } = own('./dist/identity-runtime.js');
const { PrismaIdentityStore } = own('./dist/infrastructure/persistence/identity.store.js');
const { ArgonPasswords } = own('./dist/infrastructure/security/passwords.js');
export const { RedisRateBudget, secretDigest, AccessTokenVerifier } = own('@carwash/security-kit');
export const { IDENTITY_V1, IDENTITY_ROLES } = own('@carwash/contracts');
export const ORIGIN = 'https://customer.washgo.invalid';
export const PASSWORD = 'Test-only correct horse battery 42';

if (!process.env.F006_CONTEXT_FILE)
  throw new Error('F006_CONTEXT_FILE_REQUIRED: run pnpm acceptance:identity');
export const context = JSON.parse(await readFile(process.env.F006_CONTEXT_FILE, 'utf8'));
if (
  !/^cw-f006-[a-f0-9]{12}$/.test(context.project) ||
  context.runId !== context.project ||
  !context.sentinel
)
  throw new Error('DISPOSABLE_IDENTITY_CONTEXT_REQUIRED');
const url = new URL(context.databaseUrl);
if (
  url.hostname !== '127.0.0.1' ||
  url.pathname !== '/cw_identity' ||
  url.username !== 'cw_identity_app'
)
  throw new Error('DISPOSABLE_IDENTITY_RUNTIME_ROLE_REQUIRED');
const key = generateKeyPairSync('rsa', { modulusLength: 3072 });
const passwords = await ArgonPasswords.create({ memoryCost: 19456, timeCost: 2, parallelism: 1 });

export class ApiClient {
  constructor(base, origin = ORIGIN, jar = new Map()) {
    this.base = base;
    this.origin = origin;
    this.jar = jar;
  }
  clone() {
    return new ApiClient(this.base, this.origin, new Map(this.jar));
  }
  cookie(name) {
    return this.jar.get(name);
  }
  async request(
    route,
    { method = 'GET', body, csrf = true, origin = this.origin, headers = {} } = {},
  ) {
    const requestHeaders = { ...headers };
    if (this.jar.size)
      requestHeaders.cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (method !== 'GET') {
      requestHeaders['content-type'] = 'application/json';
      if (origin !== null) requestHeaders.origin = origin;
      if (csrf) requestHeaders['x-csrf-token'] = this.jar.get('__Host-wg_csrf') ?? '';
    }
    const response = await fetch(`${this.base}${IDENTITY_V1}${route}`, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      const field = cookie.split(';')[0];
      const index = field.indexOf('=');
      const name = field.slice(0, index);
      const value = field.slice(index + 1);
      if (/Max-Age=0(?:;|$)/.test(cookie)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      headers: response.headers,
      cookies,
    };
  }
}
export async function fixture({ origins = [ORIGIN] } = {}) {
  const store = new PrismaIdentityStore(context.databaseUrl);
  const sentinel = await store.client.serviceMarker.findUnique({
    where: { service: context.sentinel },
  });
  if (!sentinel) {
    await store.close();
    throw new Error('DISPOSABLE_DATABASE_SENTINEL_MISSING');
  }
  const delivered = new Map();
  const delivery = {
    fail: false,
    async deliver(input) {
      delivered.set(input.challengeId, input);
      if (this.fail) throw new Error('DELIVERY_TEST_FAILURE');
    },
  };
  const clock = {
    offset: 0,
    now() {
      return Date.now() + this.offset;
    },
  };
  const config = {
    databaseUrl: context.databaseUrl,
    redisUrl: context.redisUrl,
    issuer: 'https://identity.washgo.invalid',
    audience: 'washgo-web',
    privateKeyPem: key.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    previousJwks: { keys: [] },
    otpPepper: randomBytes(32),
    csrfKey: randomBytes(32),
    rateKey: randomBytes(32),
    origins,
    cookieSecure: true,
    deliveryUrl: 'https://unused.test.invalid',
    deliveryToken: 'test-port-injected',
  };
  let app;
  try {
    app = await createIdentityApplication(config, { delivery, clock, passwords });
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    await store.close();
    if (app) await app.close();
    throw error;
  }
  const base = await app.getUrl();
  return {
    app,
    base,
    config,
    delivered,
    delivery,
    clock,
    db: store.client,
    client: () => new ApiClient(base, origins[0]),
    async close() {
      await app.close();
      await store.close();
    },
  };
}
export function email() {
  return `fixture-${randomUUID()}@example.invalid`;
}
export async function register(f, client = f.client(), address = email()) {
  await client.request('/csrf');
  const requested = await client.request('/register', {
    method: 'POST',
    body: { email: address, password: PASSWORD },
  });
  if (requested.status !== 202) throw new Error(`REGISTRATION_REQUEST_FAILED_${requested.status}`);
  const challenge = f.delivered.get(requested.body.challengeId);
  if (!challenge) throw new Error('OTP_TEST_PORT_NOT_CALLED');
  const verified = await client.request('/challenges/verify', {
    method: 'POST',
    body: { challengeId: requested.body.challengeId, code: challenge.code },
  });
  if (verified.status !== 200)
    throw new Error(`REGISTRATION_VERIFY_FAILED_${verified.status}_${verified.body?.error?.code}`);
  return { client, email: address, session: verified.body, cookies: verified.cookies };
}
export async function login(f, address, client = f.client()) {
  await client.request('/csrf');
  const requested = await client.request('/login', {
    method: 'POST',
    body: { email: address, password: PASSWORD },
  });
  if (requested.status !== 202) throw new Error(`LOGIN_REQUEST_FAILED_${requested.status}`);
  const challenge = f.delivered.get(requested.body.challengeId);
  if (!challenge) throw new Error('LOGIN_TEST_OTP_MISSING');
  const verified = await client.request('/challenges/verify', {
    method: 'POST',
    body: { challengeId: requested.body.challengeId, code: challenge.code },
  });
  if (verified.status !== 200) throw new Error(`LOGIN_VERIFY_FAILED_${verified.status}`);
  return { client, email: address, session: verified.body };
}
